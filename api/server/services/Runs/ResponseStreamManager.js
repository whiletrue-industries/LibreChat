const throttle = require('lodash/throttle');
const {
  Time,
  CacheKeys,
  ContentTypes,
  ToolCallTypes,
  Constants,
} = require('librechat-data-provider');
const { processRequiredActions } = require('~/server/services/ToolService');
const { createOnProgress, sendMessage, sleep } = require('~/server/utils');
const getLogStores = require('~/cache/getLogStores');
const { logger } = require('~/config');

/**
 * Manages streaming responses using the OpenAI Responses API.
 *
 * The Responses API differs from the (retired) Assistants API in that:
 * - There are no threads or runs; conversation context lives either in an
 *   OpenAI Conversation (preferred) or is re-sent on every call as `input`
 * - Tool calls arrive as output items in the stream, not as run step events
 * - Follow-up calls with tool outputs are new `responses.create` calls,
 *   not `submitToolOutputs`
 * - The response object replaces the run object for status/usage tracking
 *
 * When `openaiConversationId` is provided the manager hands context
 * management to OpenAI — only the newest user turn is passed as `input`
 * and the `conversation` parameter points at the server-side OpenAI
 * conversation. Follow-up (tool-output) turns in the same stream still
 * reference the same `conversation` so the full history stays server-side.
 */
class ResponseStreamManager {
  constructor(fields) {
    this.index = 0;
    /** @type {Map<string, number>} */
    this.mappedOrder = new Map();
    /** @type {Map<number, Object>} */
    this.orderedRunSteps = new Map();
    /** @type {Set<string>} */
    this.processedFileIds = new Set();
    /** @type {Map<string, (delta: string) => Promise<void>>} */
    this.progressCallbacks = new Map();
    /** @type {Object|null} - The completed response object, mapped to the `run` interface */
    this.run = null;

    /** @type {Express.Request} */
    this.req = fields.req;
    /** @type {Express.Response} */
    this.res = fields.res;
    /** @type {OpenAI} */
    this.openai = fields.openai;
    /** @type {string} */
    this.apiKey = this.openai.apiKey;
    /** @type {string} */
    this.parentMessageId = fields.parentMessageId;
    /**
     * @type {Object.<string, (event: Object) => Promise<void>>}
     */
    this.clientHandlers = fields.handlers ?? {};
    /** @type {Partial<TMessage>} */
    this.finalMessage = fields.responseMessage ?? {};
    /** @type {Object[]} */
    this.messages = [];
    /** @type {string} */
    this.text = '';
    /** @type {string} */
    this.intermediateText = '';
    /** @type {Set<string>} */
    this.attachedFileIds = fields.attachedFileIds;
    /** @type {undefined | Promise<ChatCompletion>} */
    this.visionPromise = fields.visionPromise;
    /** @type {number} */
    this.streamRate = fields.streamRate ?? Constants.DEFAULT_STREAM_RATE;
    /**
     * OpenAI Conversations API id (e.g. `conv_abc123`). When set, requests
     * pass `conversation: <id>` and omit prior history from `input`.
     * @type {string|null}
     */
    this.openaiConversationId = fields.openaiConversationId ?? null;

    /**
     * Accumulated function call items from the stream.
     * Each entry: { id, name, arguments, call_id, type }
     * @type {Map<string, { id: string, name: string, arguments: string, call_id: string, type: string }>}
     */
    this._pendingFunctionCalls = new Map();

    /**
     * Tracks in-progress text output item IDs.
     * @type {Set<string>}
     */
    this._activeTextItems = new Set();

    /**
     * The latest response_id, used for follow-up calls.
     * @type {string|null}
     */
    this.responseId = null;
  }

  /**
   * Sends content data to the client via SSE.
   *
   * @param {StreamContentData} data
   * @returns {Promise<void>}
   */
  async addContentData(data) {
    const { type, index, edited } = data;
    /** @type {ContentPart} */
    const contentPart = data[type];
    this.finalMessage.content[index] = { type, [type]: contentPart };

    if (type === ContentTypes.TEXT && !edited) {
      this.text += contentPart.value;
      return;
    }

    const contentData = {
      index,
      type,
      [type]: contentPart,
      messageId: this.finalMessage.messageId,
      conversationId: this.finalMessage.conversationId,
    };

    sendMessage(this.res, contentData);
  }

  /* <------------------ Misc. Helpers ------------------> */

  /**
   * Returns the latest intermediate text.
   * @returns {string}
   */
  getText() {
    return this.intermediateText;
  }

  /**
   * Returns the current, intermediate message.
   * @returns {TMessage}
   */
  getIntermediateMessage() {
    return {
      conversationId: this.finalMessage.conversationId,
      messageId: this.finalMessage.messageId,
      parentMessageId: this.parentMessageId,
      model: this.req.body.assistant_id,
      endpoint: this.req.body.endpoint,
      isCreatedByUser: false,
      user: this.req.user.id,
      text: this.getText(),
      sender: 'Assistant',
      unfinished: true,
      error: false,
    };
  }

  /**
   * Gets the step index for a given step key, creating a new index if it doesn't exist.
   * @param {string} stepKey - The access key for the step.
   * @param {number|undefined} [overrideIndex] - An override index.
   * @returns {number|undefined}
   */
  getStepIndex(stepKey, overrideIndex) {
    if (!stepKey) {
      return;
    }

    if (!isNaN(overrideIndex)) {
      this.mappedOrder.set(stepKey, overrideIndex);
      return;
    }

    let index = this.mappedOrder.get(stepKey);

    if (index === undefined) {
      index = this.index;
      this.mappedOrder.set(stepKey, this.index);
      this.index++;
    }

    return index;
  }

  /* <------------------ Main Entry Point ------------------> */

  /**
   * Run a Responses API request and handle streaming events.
   * This is the Responses API equivalent of StreamRunManager.runAssistant().
   *
   * @param {Object} params - The parameters for running the response.
   * @param {Array<Object>} params.messages - The input messages array for the Responses API.
   * @param {Object} params.body - The body containing model, assistant_id, instructions, tools, etc.
   * @returns {Promise<void>}
   */
  async runResponse({ messages, body }) {
    const requestBody = this._buildRequestBody(messages, body);

    logger.debug('[ResponseStreamManager] Starting responses.create stream', {
      model: requestBody.model,
      inputLength: requestBody.input.length,
      toolCount: requestBody.tools?.length ?? 0,
    });

    const stream = await this.openai.responses.create(requestBody);

    await this._consumeStream(stream);

    // After the stream completes, check if there are pending function calls
    // that need tool execution (multi-tool-call followed by response.completed)
    if (this._pendingFunctionCalls.size > 0) {
      await this._executePendingToolCalls(messages, body);
    }
  }

  /**
   * Build the request body for openai.responses.create.
   *
   * @param {Array<Object>} input - The input items for this turn. When
   *   `openaiConversationId` is set, this should ONLY contain the new items
   *   for this turn (e.g. the user message, or function-call + output pairs
   *   for a follow-up). Prior history is held by the OpenAI Conversation.
   * @param {Object} body - The run body (assistant_id, model, instructions, etc.)
   * @returns {Object} The request body for responses.create.
   */
  _buildRequestBody(input, body) {
    const requestBody = {
      model: body.model,
      input,
      stream: true,
    };

    if (this.openaiConversationId) {
      // Tell OpenAI to link this response to the existing Conversation;
      // OpenAI will prepend the conversation's prior items automatically.
      requestBody.conversation = this.openaiConversationId;
    }

    if (body.instructions) {
      requestBody.instructions = body.instructions;
    }

    if (body.additional_instructions) {
      const combined = requestBody.instructions
        ? `${requestBody.instructions}\n${body.additional_instructions}`
        : body.additional_instructions;
      requestBody.instructions = combined;
    }

    // Pass through tools if provided
    if (body.tools && body.tools.length > 0) {
      requestBody.tools = body.tools;
    }

    // Pass through temperature if the BotConfig provides it. The
    // Responses API expects a flat `temperature` field.
    if (typeof body.temperature === 'number') {
      requestBody.temperature = body.temperature;
    }

    return requestBody;
  }

  /**
   * Consume the SSE stream from openai.responses.create.
   *
   * @param {AsyncIterable} stream - The streaming response.
   * @returns {Promise<void>}
   */
  async _consumeStream(stream) {
    for await (const event of stream) {
      await this._handleStreamEvent(event);
    }
  }

  /**
   * Route a single streaming event to the appropriate handler.
   *
   * @param {Object} event - A Responses API streaming event.
   * @returns {Promise<void>}
   */
  async _handleStreamEvent(event) {
    const eventType = event.type;

    // Call client-provided handler if one exists for this event type
    const clientHandler = this.clientHandlers[eventType];
    if (clientHandler) {
      await clientHandler.call(this, event);
    }

    switch (eventType) {
    case 'response.created':
      this._onResponseCreated(event);
      break;

    case 'response.output_item.added':
      await this._onOutputItemAdded(event);
      break;

    case 'response.content_part.added':
      // Content part started; no action needed, handled by deltas
      break;

    case 'response.output_text.delta':
      await this._onOutputTextDelta(event);
      break;

    case 'response.function_call_arguments.delta':
      await this._onFunctionCallArgumentsDelta(event);
      break;

    case 'response.output_item.done':
      await this._onOutputItemDone(event);
      break;

    case 'response.completed':
      this._onResponseCompleted(event);
      break;

    case 'response.failed':
      this._onResponseFailed(event);
      break;

    case 'response.content_part.done':
      // Content part finished; text already accumulated via deltas
      break;

    case 'response.output_text.done':
      // Full text available; we already have it from deltas
      break;

    case 'response.function_call_arguments.done':
      // Full arguments available; we already have them from deltas
      break;

    case 'response.in_progress':
    case 'response.output_item.in_progress':
      // Progress indicators; no action needed
      break;

    default:
      logger.debug(`[ResponseStreamManager] Unhandled event type: ${eventType}`);
      break;
    }
  }

  /* <------------------ Stream Event Handlers ------------------> */

  /**
   * Handle response.created event.
   * @param {Object} event
   */
  _onResponseCreated(event) {
    const response = event.response;
    this.responseId = response.id;

    // Map response to a run-like object for compatibility
    this.run = {
      id: response.id,
      status: 'in_progress',
      model: response.model,
      usage: null,
    };

    logger.debug('[ResponseStreamManager] Response created', { id: response.id });
  }

  /**
   * Handle response.output_item.added event.
   * A new output item is starting: either a text message or a function_call.
   *
   * @param {Object} event
   */
  async _onOutputItemAdded(event) {
    const item = event.item;

    if (item.type === 'message') {
      // Text message output - set up streaming progress callback
      this._activeTextItems.add(item.id);
      const stepKey = item.id;
      const index = this.getStepIndex(stepKey);
      this.orderedRunSteps.set(index, item);

      const messageCache = getLogStores(CacheKeys.MESSAGES);
      const { onProgress: progressCallback } = createOnProgress({
        onProgress: throttle(
          () => {
            messageCache.set(this.finalMessage.messageId, this.getText(), Time.FIVE_MINUTES);
          },
          3000,
          { trailing: false },
        ),
      });

      const onProgress = progressCallback({
        index,
        res: this.res,
        messageId: this.finalMessage.messageId,
        conversationId: this.finalMessage.conversationId,
        type: ContentTypes.TEXT,
      });

      this.progressCallbacks.set(stepKey, onProgress);
    } else if (item.type === 'function_call') {
      // Function call output - initialize accumulator
      this._pendingFunctionCalls.set(item.id || item.call_id, {
        id: item.id,
        call_id: item.call_id,
        name: item.name,
        arguments: '',
        type: 'function',
      });

      // Create a tool call content entry for the UI
      const toolCall = {
        id: item.call_id || item.id,
        type: ToolCallTypes.FUNCTION,
        function: {
          name: item.name,
          arguments: '',
          output: null,
        },
        progress: 0.01,
      };

      const stepKey = `function_call_${item.id || item.call_id}`;
      const index = this.getStepIndex(stepKey);
      this.getStepIndex(toolCall.id, index);
      this.orderedRunSteps.set(index, toolCall);

      this.addContentData({
        [ContentTypes.TOOL_CALL]: toolCall,
        type: ContentTypes.TOOL_CALL,
        index,
      });
    }
  }

  /**
   * Handle response.output_text.delta event.
   * Streaming text chunk from the model.
   *
   * @param {Object} event
   */
  async _onOutputTextDelta(event) {
    const delta = event.delta;
    const itemId = event.item_id;

    if (!delta) {
      return;
    }

    this.intermediateText += delta;

    const onProgress = this.progressCallbacks.get(itemId);
    if (onProgress) {
      onProgress(delta);
      await sleep(this.streamRate);
    }
  }

  /**
   * Handle response.function_call_arguments.delta event.
   * Streaming function call arguments chunk.
   *
   * @param {Object} event
   */
  async _onFunctionCallArgumentsDelta(event) {
    const delta = event.delta;
    const itemId = event.item_id;

    if (!delta) {
      return;
    }

    const pending = this._pendingFunctionCalls.get(itemId);
    if (pending) {
      pending.arguments += delta;

      // Update the tool call content for the UI
      const stepKey = `function_call_${itemId}`;
      const index = this.mappedOrder.get(stepKey);
      if (index !== undefined) {
        const toolCall = this.orderedRunSteps.get(index);
        if (toolCall && toolCall.function) {
          toolCall.function.arguments = pending.arguments;

          this.addContentData({
            [ContentTypes.TOOL_CALL]: toolCall,
            type: ContentTypes.TOOL_CALL,
            index,
          });

          await sleep(this.streamRate);
        }
      }
    }
  }

  /**
   * Handle response.output_item.done event.
   * An output item is complete. If it's a function_call, mark it ready for execution.
   *
   * @param {Object} event
   */
  async _onOutputItemDone(event) {
    const item = event.item;

    if (item.type === 'message') {
      // Text message completed
      this._activeTextItems.delete(item.id);

      // Build a message-like object for compatibility
      const messageObj = {
        id: item.id,
        role: 'assistant',
        content: item.content || [],
        created_at: Math.floor(Date.now() / 1000),
      };
      this.messages.push(messageObj);

      // Finalize text content
      const index = this.mappedOrder.get(item.id);
      if (index !== undefined) {
        this.addContentData({
          [ContentTypes.TEXT]: { value: this.intermediateText },
          type: ContentTypes.TEXT,
          index,
        });
      }
    } else if (item.type === 'function_call') {
      // Update pending function call with final arguments from the item
      const key = item.id || item.call_id;
      const pending = this._pendingFunctionCalls.get(key);
      if (pending) {
        pending.arguments = item.arguments || pending.arguments;
        pending.name = item.name || pending.name;
        pending.call_id = item.call_id || pending.call_id;
      }

      logger.info(JSON.stringify({
        event: 'response_function_call_done',
        response_id: this.responseId,
        call_id: item.call_id,
        function_name: item.name,
        timestamp: new Date().toISOString(),
      }));
    }
  }

  /**
   * Handle response.completed event.
   * The response is complete. Extract usage and set final status.
   *
   * @param {Object} event
   */
  _onResponseCompleted(event) {
    const response = event.response;

    this.run = {
      id: response.id,
      status: 'completed',
      model: response.model,
      usage: response.usage
        ? {
          prompt_tokens: response.usage.input_tokens,
          completion_tokens: response.usage.output_tokens,
          total_tokens: (response.usage.input_tokens || 0) + (response.usage.output_tokens || 0),
        }
        : null,
    };

    this.responseId = response.id;
    logger.debug('[ResponseStreamManager] Response completed', {
      id: response.id,
      usage: this.run.usage,
    });
  }

  /**
   * Handle response.failed event.
   *
   * @param {Object} event
   */
  _onResponseFailed(event) {
    const response = event.response;
    const error = response.error || response.last_error;

    this.run = {
      id: response.id,
      status: 'failed',
      model: response.model,
      usage: null,
      last_error: error,
    };

    logger.error('[ResponseStreamManager] Response failed', {
      id: response.id,
      error,
    });
  }

  /* <------------------ Tool Call Execution ------------------> */

  /**
   * Execute pending tool calls by calling processRequiredActions,
   * then make a follow-up responses.create call with the tool outputs.
   *
   * @param {Array<Object>} originalMessages - The original input messages.
   * @param {Object} body - The original request body.
   * @returns {Promise<void>}
   */
  async _executePendingToolCalls(originalMessages, body) {
    const pendingCalls = Array.from(this._pendingFunctionCalls.values());

    if (pendingCalls.length === 0) {
      return;
    }

    // Build action objects compatible with processRequiredActions
    const actions = pendingCalls.map((call) => {
      let args = {};
      try {
        args = JSON.parse(call.arguments);
      } catch (e) {
        logger.error('[ResponseStreamManager] Failed to parse function call arguments', {
          call_id: call.call_id,
          name: call.name,
          arguments: call.arguments,
          error: e.message,
        });
      }

      return {
        tool: call.name,
        toolInput: args,
        toolCallId: call.call_id,
      };
    });

    // Log each tool call before execution
    const toolCallStart = Date.now();
    for (const action of actions) {
      logger.info(JSON.stringify({
        event: 'tool_call_start',
        response_id: this.responseId,
        tool_call_id: action.toolCallId,
        operationId: action.tool,
        toolInput: action.toolInput,
        timestamp: new Date().toISOString(),
      }));
    }

    const { tool_outputs: preliminaryOutputs } = await processRequiredActions(this, actions);
    const tool_outputs = this._checkMissingOutputs(preliminaryOutputs, actions);

    // Log each tool result after execution
    const duration_ms = Date.now() - toolCallStart;
    for (const output of tool_outputs) {
      const matchingAction = actions.find((a) => a.toolCallId === output.tool_call_id);
      const outputStr = typeof output.output === 'string'
        ? output.output
        : JSON.stringify(output.output);
      const isError = outputStr.startsWith('Error') || outputStr.startsWith('API call to');
      logger.info(JSON.stringify({
        event: 'tool_call_end',
        response_id: this.responseId,
        tool_call_id: output.tool_call_id,
        operationId: matchingAction?.tool,
        status: isError ? 'error' : 'success',
        response_size: outputStr.length,
        duration_ms,
        timestamp: new Date().toISOString(),
      }));
    }

    // Clear pending calls
    this._pendingFunctionCalls.clear();

    // Build follow-up input with function call items and their outputs.
    //
    // When backed by an OpenAI Conversation:
    //   - The user turn AND the `function_call` items emitted by the
    //     previous `response.create` are already in the conversation
    //     server-side. Re-sending them as `input` yields:
    //       `400 Duplicate item found with id fc_...`
    //   - We only need to send the matching `function_call_output`s.
    //
    // Otherwise (stateless mode):
    //   - OpenAI has no memory of prior turns, so we must echo the user
    //     message, the function_call items, and their outputs every time.
    const functionCallItems = pendingCalls.map((call) => ({
      type: 'function_call',
      id: call.id,
      call_id: call.call_id,
      name: call.name,
      arguments: call.arguments,
    }));

    const functionOutputItems = tool_outputs.map((output) => ({
      type: 'function_call_output',
      call_id: output.tool_call_id,
      output: typeof output.output === 'string' ? output.output : JSON.stringify(output.output),
    }));

    const followUpInput = this.openaiConversationId
      ? [...functionOutputItems]
      : [...originalMessages, ...functionCallItems, ...functionOutputItems];

    logger.info(JSON.stringify({
      event: 'tool_outputs_submitted',
      response_id: this.responseId,
      tool_count: tool_outputs.length,
      timestamp: new Date().toISOString(),
    }));

    // Make follow-up call
    const followUpBody = this._buildRequestBody(followUpInput, body);

    try {
      const stream = await this.openai.responses.create(followUpBody);
      await this._consumeStream(stream);

      // Recursive: if the follow-up also has tool calls, execute those too
      if (this._pendingFunctionCalls.size > 0) {
        await this._executePendingToolCalls(followUpInput, body);
      }
    } catch (error) {
      logger.error('[ResponseStreamManager] Follow-up responses.create failed', {
        response_id: this.responseId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Check for missing tool outputs and provide fallback error messages.
   *
   * @param {Array<Object>} tool_outputs - The tool outputs from processRequiredActions.
   * @param {Array<Object>} actions - The required actions.
   * @returns {Array<Object>} The complete outputs including fallbacks for missing ones.
   */
  _checkMissingOutputs(tool_outputs, actions) {
    const missingOutputs = [];

    for (const item of actions) {
      const { tool, toolCallId } = item;
      const outputExists = tool_outputs.some((output) => output.tool_call_id === toolCallId);

      if (!outputExists) {
        logger.warn(
          `[ResponseStreamManager] The "${tool}" tool (ID: ${toolCallId}) failed to produce an output. response_id: ${this.responseId}`,
        );
        missingOutputs.push({
          tool_call_id: toolCallId,
          output:
            'The tool failed to produce an output. The tool may not be currently available or experienced an unhandled error.',
        });
      }
    }

    return [...tool_outputs, ...missingOutputs];
  }
}

module.exports = ResponseStreamManager;
