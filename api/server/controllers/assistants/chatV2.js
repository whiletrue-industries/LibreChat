const { v4 } = require('uuid');
const {
  Time,
  Constants,
  RunStatus,
  CacheKeys,
  ContentTypes,
  ToolCallTypes,
  retrievalMimeTypes,
} = require('librechat-data-provider');
const {
  recordUsage,
  saveUserMessage,
  saveAssistantMessage,
  hydrateRecentHistory,
} = require('~/server/services/Threads');
const {
  isContextLengthError,
  isRateLimitError,
  retryOnRateLimit,
  buildRecap,
} = require('~/server/services/Threads/oversizedConversation');
const { createOnTextProgress } = require('~/server/services/AssistantService');
const { sendMessage, isEnabled, countTokens } = require('~/server/utils');
const { createErrorHandler } = require('~/server/controllers/assistants/errors');
const validateAuthor = require('~/server/middleware/assistants/validateAuthor');
const { ResponseStreamManager } = require('~/server/services/Runs');
const { getBotConfig } = require('~/server/services/BotConfigService');
const { addTitle } = require('~/server/services/Endpoints/assistants');
const { getTransactions } = require('~/models/Transaction');
const checkBalance = require('~/models/checkBalance');
const { getConvo } = require('~/models/Conversation');
const getLogStores = require('~/cache/getLogStores');
const { getModelMaxTokens } = require('~/utils');
const { getOpenAIClient } = require('./helpers');
const { logger } = require('~/config');

const ten_minutes = 1000 * 60 * 10;

/**
 * @route POST /
 * @desc Chat with an assistant via the OpenAI Responses API.
 *
 * The Assistants API chat path (threads/runs) was removed as part of the
 * Responses-API migration; the Assistants API retires 2026-08-26.
 *
 * Each user turn runs `responses.create` **without** a `conversation:`
 * field — we don't use the OpenAI Conversations API. Continuity across
 * turns comes from hydrating the ENTIRE MongoDB history (user +
 * assistant text, tool-call items excluded) into the `input` array via
 * `hydrateRecentHistory`. No length cap is applied.
 *
 * Two failure modes we handle explicitly:
 * - **Rate limit (HTTP 429 / TPM)** — transient. We retry with
 *   exponential backoff + jitter, matching OpenAI's own Tenacity
 *   example (min 1 s, max 60 s, up to 6 attempts).
 * - **Context length exceeded (HTTP 400 / context_length_exceeded)** —
 *   not recoverable. The prompt is genuinely too big; no amount of
 *   retrying helps. Fall through to the recap path immediately.
 *
 * If retries exhaust on a sustained rate limit, or the error was
 * context-length from the start, we build a recap from the same
 * hydrated mongo history and stream it back as the assistant message
 * with a "this conversation is getting too long, consider starting a
 * new one" nudge. Silent truncation mid-conversation is avoided.
 *
 * @access Public
 * @param {Express.Request} req - The request object, containing the request data.
 * @param {Express.Response} res - The response object, used to send back a response.
 * @returns {void}
 */
const chatV2 = async (req, res) => {
  logger.debug('[/assistants/chat/] req.body', req.body);

  /** @type {{files: MongoFile[]}} */
  const {
    text,
    model,
    endpoint,
    files = [],
    promptPrefix,
    assistant_id,
    instructions,
    endpointOption,
    messageId: _messageId,
    conversationId: convoId,
    parentMessageId: _parentId = Constants.NO_PARENT,
  } = req.body;

  /** @type {OpenAIClient} */
  let openai;
  /** @type {string|undefined} - the current run id (response id under Responses API) */
  let run_id;
  /** @type {string|undefined} - the parent messageId */
  let parentMessageId = _parentId;
  /** @type {TMessage[]} */
  let previousMessages = [];
  /** @type {import('librechat-data-provider').TConversation | null} */
  let conversation = null;
  /** @type {string[]} */
  let file_ids = [];
  /** @type {Set<string>} */
  let attachedFileIds = new Set();
  /** @type {TMessage | null} */
  let requestMessage = null;

  const userMessageId = v4();
  const responseMessageId = v4();

  /** @type {string} - The conversation UUID - created if undefined */
  const conversationId = convoId ?? v4();

  const cache = getLogStores(CacheKeys.ABORT_KEYS);
  const cacheKey = `${req.user.id}:${conversationId}`;

  /** @type {Run | undefined} - The completed run, undefined if incomplete */
  let completedRun;

  const getContext = () => ({
    openai,
    run_id,
    endpoint,
    cacheKey,
    completedRun,
    assistant_id,
    conversationId,
    parentMessageId,
    responseMessageId,
  });

  const handleError = createErrorHandler({ req, res, getContext });

  try {
    res.on('close', async () => {
      if (!completedRun) {
        await handleError(new Error('Request closed'));
      }
    });

    if (!assistant_id) {
      completedRun = true;
      throw new Error('Missing assistant_id');
    }

    const checkBalanceBeforeRun = async () => {
      if (!isEnabled(process.env.CHECK_BALANCE)) {
        return;
      }
      const transactions =
        (await getTransactions({
          user: req.user.id,
          context: 'message',
          conversationId,
        })) ?? [];

      const totalPreviousTokens = Math.abs(
        transactions.reduce((acc, curr) => acc + curr.rawAmount, 0),
      );

      // TODO: make promptBuffer a config option; buffer for titles, needs buffer for system instructions
      const promptBuffer = parentMessageId === Constants.NO_PARENT ? 200 : 0;
      // 5 is added for labels
      let promptTokens = (await countTokens(text + (promptPrefix ?? ''))) + 5;
      promptTokens += totalPreviousTokens + promptBuffer;
      // Count tokens up to the current context window
      promptTokens = Math.min(promptTokens, getModelMaxTokens(model));

      await checkBalance({
        req,
        res,
        txData: {
          model,
          user: req.user.id,
          tokenType: 'prompt',
          amount: promptTokens,
        },
      });
    };

    const { openai: _openai, client } = await getOpenAIClient({
      req,
      res,
      endpointOption,
      initAppClient: true,
    });

    openai = _openai;
    await validateAuthor({ req, openai });

    if (previousMessages.length) {
      parentMessageId = previousMessages[previousMessages.length - 1].messageId;
    }

    let userMessage = {
      role: 'user',
      content: [
        {
          type: ContentTypes.TEXT,
          text,
        },
      ],
      metadata: {
        messageId: userMessageId,
      },
    };

    /** @type {CreateRunBody | undefined} */
    const body = {
      assistant_id,
      model,
    };

    if (promptPrefix) {
      body.additional_instructions = promptPrefix;
    }

    if (typeof endpointOption.artifactsPrompt === 'string' && endpointOption.artifactsPrompt) {
      body.additional_instructions = `${body.additional_instructions ?? ''}\n${endpointOption.artifactsPrompt}`.trim();
    }

    if (instructions) {
      body.instructions = instructions;
    }

    const getRequestFileIds = async () => {
      let thread_file_ids = [];
      if (convoId) {
        const convo = await getConvo(req.user.id, convoId);
        if (convo && convo.file_ids) {
          thread_file_ids = convo.file_ids;
        }
      }

      if (files.length || thread_file_ids.length) {
        attachedFileIds = new Set([...file_ids, ...thread_file_ids]);

        let attachmentIndex = 0;
        for (const file of files) {
          file_ids.push(file.file_id);
          if (file.type.startsWith('image')) {
            userMessage.content.push({
              type: ContentTypes.IMAGE_FILE,
              [ContentTypes.IMAGE_FILE]: { file_id: file.file_id },
            });
          }

          if (!userMessage.attachments) {
            userMessage.attachments = [];
          }

          userMessage.attachments.push({
            file_id: file.file_id,
            tools: [{ type: ToolCallTypes.CODE_INTERPRETER }],
          });

          if (file.type.startsWith('image')) {
            continue;
          }

          const mimeType = file.type;
          const isSupportedByRetrieval = retrievalMimeTypes.some((regex) => regex.test(mimeType));
          if (isSupportedByRetrieval) {
            userMessage.attachments[attachmentIndex].tools.push({
              type: ToolCallTypes.FILE_SEARCH,
            });
          }

          attachmentIndex++;
        }
      }
    };

    /** @type {Promise<Run>|undefined} */
    let userMessagePromise;

    const initializeRequest = async () => {
      await getRequestFileIds();

      createOnTextProgress({
        openai,
        conversationId,
        userMessageId,
        messageId: responseMessageId,
      });

      requestMessage = {
        user: req.user.id,
        text,
        messageId: userMessageId,
        parentMessageId,
        // TODO: make sure client sends correct format for `files`, use zod
        files,
        file_ids,
        conversationId,
        isCreatedByUser: true,
        assistant_id,
        model: assistant_id,
        endpoint,
      };

      previousMessages.push(requestMessage);

      /* asynchronous */
      userMessagePromise = saveUserMessage(req, { ...requestMessage, model });

      conversation = {
        conversationId,
        endpoint,
        promptPrefix: promptPrefix,
        instructions: instructions,
        assistant_id,
        // model,
      };

      if (file_ids.length) {
        conversation.file_ids = file_ids;
      }
    };

    const promises = [initializeRequest(), checkBalanceBeforeRun()];
    await Promise.all(promises);

    const sendInitialResponse = () => {
      sendMessage(res, {
        sync: true,
        conversationId,
        // messages: previousMessages,
        requestMessage,
        responseMessage: {
          user: req.user.id,
          messageId: openai.responseMessage.messageId,
          parentMessageId: userMessageId,
          conversationId,
          assistant_id,
          model: assistant_id,
        },
      });
    };

    /** @type {ResponseStreamManager | undefined} */
    let response;

    const processRun = async () => {
      // Fetch the BotConfig bundle from botnim-api. Its tool shape is
      // already the flat Responses-API form, so we pass it straight
      // through. This replaces the old
      // `openai.beta.assistants.retrieve(assistant_id)` call — per the
      // contract at rebuilding-bots/docs/LIBRECHAT_SYNC_CONTRACT.md the
      // Assistants API has no equivalent `Prompts` REST surface, so
      // botnim-api re-emits the config from `specs/<bot>/` on every
      // request and LibreChat caches it briefly.
      const botSlug = process.env.BOTNIM_BOT_SLUG ?? 'unified';
      const botEnv = process.env.BOTNIM_ENVIRONMENT ?? 'staging';
      const botConfig = await getBotConfig({ bot: botSlug, environment: botEnv });

      // Keep only function tools — the tool-execution loop in
      // ResponseStreamManager only handles `function_call` output items.
      // Other tool types (code_interpreter, file_search, …) are dropped
      // here; if/when we add support they can be re-enabled by removing
      // this filter.
      const responsesTools = (botConfig.tools ?? []).filter(
        (tool) => tool?.type === 'function',
      );

      // BotConfig is the authoritative source for model/instructions/tools
      // — it's the whole point of the code-managed config pattern. Let
      // BotConfig override whatever model the UI sent. LibreChat's endpoint
      // list ships older models (e.g. gpt-4.1) that users may still have
      // selected in their UI; ignoring those on the server side keeps the
      // assistant's model in sync with what's defined in specs/<bot>/.
      // Only fall back to the client-sent value if BotConfig somehow lacks
      // one, which would indicate a misconfigured spec.
      const effectiveBody = {
        ...body,
        model: botConfig.model ?? body.model,
        instructions: botConfig.instructions ?? body.instructions ?? undefined,
        tools: responsesTools,
      };

      if (typeof botConfig.temperature === 'number') {
        effectiveBody.temperature = botConfig.temperature;
      }

      // Stateless mode — no OpenAI Conversations API. Instead we hydrate
      // the full MongoDB history (user + assistant text, tool-call items
      // excluded) into this turn's input so follow-ups like "what about
      // 2024?" have the prior exchange to point at.
      //
      // We deliberately do NOT cap the hydration. Truncating silently is
      // confusing; users notice when the bot "forgets" things earlier
      // than they expect. Instead, if the resulting prompt exceeds the
      // model's TPM / context-length ceiling, we catch the failure below
      // and tell the user "this conversation is too long — start a new
      // one, here's a recap." That surfaces the limit honestly and puts
      // the choice in the user's hands.
      const priorMessages = await hydrateRecentHistory({
        conversationId,
        excludeMessageId: userMessageId,
      });
      const messagesInput = [
        ...priorMessages,
        { role: 'user', content: text },
      ];

      /** @type {undefined | TAssistantEndpoint} */
      const config = req.app.locals[endpoint] ?? {};
      /** @type {undefined | TBaseEndpoint} */
      const allConfig = req.app.locals.all;

      const responseStreamManager = new ResponseStreamManager({
        req,
        res,
        openai,
        handlers: {},
        attachedFileIds,
        parentMessageId: userMessageId,
        responseMessage: openai.responseMessage,
        streamRate: allConfig?.streamRate ?? config.streamRate,
      });

      // Send the initial sync response before streaming starts, so the client
      // receives the placeholder responseMessage immediately.
      await cache.set(cacheKey, `${conversationId}:${responseMessageId}`, ten_minutes);
      sendInitialResponse();

      try {
        // 429 / TPM: OpenAI's own guide (Example 1, Tenacity) recommends
        // wait_random_exponential(min=1, max=60) + stop_after_attempt(6).
        // We mirror that here: up to 6 tries, 1-60 s jittered backoff,
        // retry ONLY on rate-limit errors. Context-length and every other
        // failure propagate immediately — waiting doesn't fix a prompt
        // that's genuinely too large.
        await retryOnRateLimit(
          () => responseStreamManager.runResponse({
            messages: messagesInput,
            body: effectiveBody,
          }),
          {
            onRetry: (err, attempt, delay) => {
              logger.warn(
                '[/assistants/chat/] rate-limit on responses.create (attempt %d); sleeping %dms — %s',
                attempt + 1, delay, err.message,
              );
              // Stream a tool-call-style status bubble to the UI so the
              // user sees why their message is taking longer than usual.
              // Fire-and-forget: if emitting fails we shouldn't derail
              // the retry itself.
              Promise.resolve(
                responseStreamManager.emitRetryNotice({
                  attempt,
                  delayMs: delay,
                  reason: 'rate_limit',
                })
              ).catch((e) => {
                logger.warn('[/assistants/chat/] emitRetryNotice failed: %s', e.message);
              });
            },
          },
        );
      } catch (err) {
        // Either: (a) context-length exceeded — prompt too big, never
        // fixable by retry, show recap; or (b) rate limit still firing
        // after 6 attempts — show recap too, with an apology; or (c)
        // something else entirely — let the generic error path handle it.
        const isContextLen = isContextLengthError(err);
        const exhaustedRateLimit = isRateLimitError(err);
        if (!isContextLen && !exhaustedRateLimit) {
          throw err;
        }
        logger.warn(
          '[/assistants/chat/] conversation too long (%s: %s); returning recap',
          isContextLen ? 'context_length_exceeded' : 'rate_limit_after_retries',
          err.message,
        );
        const recapText = buildRecap(priorMessages, text);
        responseStreamManager.intermediateText = recapText;
        responseStreamManager.run = {
          id: run_id || `recap_${responseMessageId}`,
          status: RunStatus.COMPLETED,
          created_at: Math.floor(Date.now() / 1000),
        };
      }

      response = responseStreamManager;
      response.text = responseStreamManager.intermediateText;
      run_id = responseStreamManager.responseId;

      const messageCache = getLogStores(CacheKeys.MESSAGES);
      messageCache.set(
        responseMessageId,
        {
          complete: true,
          text: response.text,
        },
        Time.FIVE_MINUTES,
      );
    };

    await processRun();
    logger.debug('[/assistants/chat/] response', {
      run: response.run,
      steps: response.steps,
    });

    if (response.run.status === RunStatus.CANCELLED) {
      logger.debug('[/assistants/chat/] Run cancelled, handled by `abortRun`');
      return res.end();
    }

    completedRun = response.run;

    /** @type {ResponseMessage} */
    const responseMessage = {
      ...(response.responseMessage ?? response.finalMessage),
      text: response.text,
      parentMessageId: userMessageId,
      conversationId,
      user: req.user.id,
      assistant_id,
      model: assistant_id,
      endpoint,
    };

    if (response.responseId) {
      responseMessage.response_id = response.responseId;
    }

    sendMessage(res, {
      final: true,
      conversation,
      requestMessage: {
        parentMessageId,
      },
    });
    res.end();

    if (userMessagePromise) {
      await userMessagePromise;
    }
    await saveAssistantMessage(req, { ...responseMessage, model });

    if (parentMessageId === Constants.NO_PARENT) {
      addTitle(req, {
        text,
        responseText: response.text,
        conversationId,
        client,
      });
    }

    // Responses API exposes usage directly on the response object captured
    // into `response.run.usage`. No thread/run retrieval needed.
    if (response.run?.usage) {
      await recordUsage({
        ...response.run.usage,
        user: req.user.id,
        model: response.run.model ?? model,
        conversationId,
      });
    }

  } catch (error) {
    await handleError(error);
  }
};

module.exports = chatV2;
