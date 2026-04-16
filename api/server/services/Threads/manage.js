const path = require('path');
const {
  Constants,
  ContentTypes,
  AnnotationTypes,
} = require('librechat-data-provider');
const { retrieveAndProcessFile } = require('~/server/services/Files/process');
const { recordMessage, getMessages } = require('~/models/Message');
const { spendTokens } = require('~/models/spendTokens');
const { saveConvo } = require('~/models/Conversation');
const { countTokens } = require('~/server/utils');

/**
 * Build the Responses API `input` array from the conversation history in MongoDB.
 *
 * The Responses API is stateless (when `conversation` is not used): every
 * request needs the full conversation history included in the `input`
 * field. This function loads prior messages for a conversation and converts
 * them into the item format accepted by `openai.responses.create`.
 *
 * Messages authored by the user become `{ role: 'user', content: text }`.
 * Assistant messages that contain function/tool calls are split into their
 * constituent `function_call` + `function_call_output` items so the model
 * can see the full tool-use history; assistant messages with plain text
 * become `{ role: 'assistant', content: text }`.
 *
 * NOTE: This function is used as a fallback. The preferred code path uses
 * the OpenAI Conversations API (see `getOrCreateOpenAIConversation`) which
 * lets OpenAI persist context server-side. `buildConversationInput` stays
 * here for seeding freshly-created Conversations with any prior MongoDB
 * history (e.g., when upgrading an existing DB to the Conversations path).
 *
 * @param {string} conversationId - The LibreChat conversationId to reconstruct.
 * @returns {Promise<Array<Object>>} The input array for `openai.responses.create`.
 */
async function buildConversationInput(conversationId) {
  if (!conversationId) {
    return [];
  }

  const dbMessages = await getMessages({ conversationId });
  if (!dbMessages || dbMessages.length === 0) {
    return [];
  }

  /** @type {Array<Object>} */
  const input = [];

  for (const msg of dbMessages) {
    if (msg.isCreatedByUser) {
      const text = typeof msg.text === 'string' ? msg.text : '';
      if (text) {
        input.push({ role: 'user', content: text });
      }
      continue;
    }

    // Assistant message. Check for stored content parts that may include
    // tool_call content types. If present, reconstruct function_call items.
    const contentParts = Array.isArray(msg.content) ? msg.content : [];
    let hasToolCalls = false;
    const toolCallItems = [];
    const toolOutputItems = [];
    let accumulatedText = '';

    for (const part of contentParts) {
      if (!part || typeof part !== 'object') {
        continue;
      }
      const type = part.type;
      if (type === ContentTypes.TEXT) {
        const value = part[ContentTypes.TEXT]?.value ?? '';
        if (value) {
          accumulatedText += value;
        }
      } else if (type === ContentTypes.TOOL_CALL) {
        const toolCall = part[ContentTypes.TOOL_CALL] ?? {};
        const callId = toolCall.id;
        const fn = toolCall.function ?? {};
        if (!callId || !fn.name) {
          continue;
        }
        hasToolCalls = true;
        toolCallItems.push({
          type: 'function_call',
          call_id: callId,
          name: fn.name,
          arguments: typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments ?? {}),
        });
        const output = fn.output;
        toolOutputItems.push({
          type: 'function_call_output',
          call_id: callId,
          output:
            typeof output === 'string'
              ? output
              : output == null
                ? ''
                : JSON.stringify(output),
        });
      }
    }

    if (hasToolCalls) {
      // Tool-call items must come in pairs and precede any assistant text.
      input.push(...toolCallItems, ...toolOutputItems);
    }

    const finalText = accumulatedText || (typeof msg.text === 'string' ? msg.text : '');
    if (finalText) {
      input.push({ role: 'assistant', content: finalText });
    }
  }

  return input;
}

/**
 * Look up (or create) the OpenAI Conversations API conversation id mapped to
 * a given LibreChat conversationId.
 *
 * The OpenAI Conversations API (`POST /conversations`, `POST /conversations/:id/items`)
 * replaces the old Assistants threads. We persist the OpenAI-side id on the
 * LibreChat conversation document as `openai_conversation_id` and pass it
 * as the `conversation` parameter to `responses.create`, which makes OpenAI
 * store and retrieve context server-side automatically.
 *
 * On a brand-new conversation we seed the OpenAI Conversation with any
 * prior MongoDB messages (usually none) so new clients that started
 * chatting before the migration don't lose their history.
 *
 * @param {Object} params
 * @param {OpenAIClient} params.openai - Authenticated OpenAI client (v4 SDK).
 * @param {string} params.conversationId - LibreChat conversation id.
 * @param {string} params.userId - The requesting user's id (for Mongo scoping).
 * @returns {Promise<{ openai_conversation_id: string, created: boolean }>}
 */
async function getOrCreateOpenAIConversation({ openai, conversationId, userId }) {
  // We resolve the existing mapping via the conversation document in Mongo.
  // Require at call-time to avoid a circular require with models/Conversation.
  const { Conversation } = require('~/models/Conversation');

  const existing = await Conversation.findOne(
    { conversationId, user: userId },
    'openai_conversation_id',
  ).lean();

  if (existing?.openai_conversation_id) {
    return {
      openai_conversation_id: existing.openai_conversation_id,
      created: false,
    };
  }

  // Seed the new OpenAI Conversation with any prior history. On a brand-new
  // chat the array will be empty, which is fine.
  const seedItems = await buildConversationInput(conversationId);

  // v4 SDK: use the generic `post` helper because
  // `openai.conversations.*` typed resources land in v5.15+.
  const created = await openai.post('/conversations', {
    body: {
      metadata: { librechat_conversation_id: conversationId },
      ...(seedItems.length ? { items: seedItems } : {}),
    },
  });

  if (!created?.id) {
    throw new Error(
      `[getOrCreateOpenAIConversation] OpenAI Conversations API returned no id for ${conversationId}`,
    );
  }

  // Persist the mapping. Use updateOne so we don't overwrite concurrent edits.
  await Conversation.updateOne(
    { conversationId, user: userId },
    { $set: { openai_conversation_id: created.id } },
    { upsert: true },
  );

  return {
    openai_conversation_id: created.id,
    created: true,
  };
}

/**
 * Append items (user message, tool calls, tool outputs, etc.) to an existing
 * OpenAI Conversation. Safe to call in a fire-and-forget manner when the
 * caller only cares about the network side-effect.
 *
 * @param {Object} params
 * @param {OpenAIClient} params.openai - Authenticated OpenAI client.
 * @param {string} params.openai_conversation_id - The OpenAI conversation id.
 * @param {Array<Object>} params.items - Items to append.
 * @returns {Promise<unknown>}
 */
async function appendItemsToOpenAIConversation({ openai, openai_conversation_id, items }) {
  if (!openai_conversation_id || !items?.length) {
    return null;
  }
  return openai.post(`/conversations/${openai_conversation_id}/items`, {
    body: { items },
  });
}

/**
 * Saves a user message to the DB in the Assistants endpoint format.
 *
 * NOTE: `thread_id` is no longer persisted — the Assistants threads/runs
 * path was removed with the Responses API migration. The
 * `openai_conversation_id` linkage lives on the conversation document,
 * not on each message.
 *
 * @param {Object} req - The request object.
 * @param {Object} params - The parameters of the user message
 * @param {string} params.user - The user's ID.
 * @param {string} params.text - The user's prompt.
 * @param {string} params.messageId - The user message Id.
 * @param {string} params.model - The model used by the assistant.
 * @param {string} params.assistant_id - The current assistant Id.
 * @param {string} params.conversationId - The message's conversationId
 * @param {string} params.endpoint - The conversation endpoint
 * @param {string} [params.parentMessageId] - Optional if initial message.
 * Defaults to Constants.NO_PARENT.
 * @param {string} [params.instructions] - Optional: from preset for `instructions` field.
 * @param {string} [params.promptPrefix] - Optional: from preset for `additional_instructions` field.
 * @param {import('librechat-data-provider').TFile[]} [params.files] - Optional. List of Attached File Objects.
 * @param {string[]} [params.file_ids] - Optional. List of File IDs attached to the userMessage.
 * @return {Promise<Run>} A promise that resolves to the created message.
 */
async function saveUserMessage(req, params) {
  const tokenCount = await countTokens(params.text);

  const userMessage = {
    user: params.user,
    endpoint: params.endpoint,
    messageId: params.messageId,
    conversationId: params.conversationId,
    parentMessageId: params.parentMessageId ?? Constants.NO_PARENT,
    /* For messages, use the assistant_id instead of model */
    model: params.assistant_id,
    sender: 'User',
    text: params.text,
    isCreatedByUser: true,
    tokenCount,
  };

  const convo = {
    endpoint: params.endpoint,
    conversationId: params.conversationId,
    promptPrefix: params.promptPrefix,
    instructions: params.instructions,
    assistant_id: params.assistant_id,
    model: params.model,
  };

  if (params.files?.length) {
    userMessage.files = params.files.map(({ file_id }) => ({ file_id }));
    convo.file_ids = params.file_ids;
  }

  const message = await recordMessage(userMessage);
  await saveConvo(req, convo, {
    context: 'api/server/services/Threads/manage.js #saveUserMessage',
  });
  return message;
}

/**
 * Saves an Assistant message to the DB in the Assistants endpoint format.
 *
 * NOTE: `thread_id` is no longer persisted (see `saveUserMessage`).
 *
 * @param {Object} req - The request object.
 * @param {Object} params - The parameters of the Assistant message
 * @param {string} params.user - The user's ID.
 * @param {string} params.messageId - The message Id.
 * @param {string} params.text - The concatenated text of the message.
 * @param {string} params.assistant_id - The assistant Id.
 * @param {string} params.model - The model used by the assistant.
 * @param {ContentPart[]} params.content - The message content parts.
 * @param {string} params.conversationId - The message's conversationId
 * @param {string} params.endpoint - The conversation endpoint
 * @param {string} params.parentMessageId - The latest user message that triggered this response.
 * @param {string} [params.response_id] - Optional: the Responses API response id.
 * @param {string} [params.instructions] - Optional: from preset for `instructions` field.
 * @param {string} [params.promptPrefix] - Optional: from preset for `additional_instructions` field.
 * @return {Promise<Run>} A promise that resolves to the created message.
 */
async function saveAssistantMessage(req, params) {
  const message = await recordMessage({
    user: params.user,
    endpoint: params.endpoint,
    messageId: params.messageId,
    conversationId: params.conversationId,
    parentMessageId: params.parentMessageId,
    /* For messages, use the assistant_id instead of model */
    model: params.assistant_id,
    content: params.content,
    response_id: params.response_id,
    sender: 'Assistant',
    isCreatedByUser: false,
    text: params.text,
    unfinished: false,
  });

  await saveConvo(
    req,
    {
      endpoint: params.endpoint,
      conversationId: params.conversationId,
      promptPrefix: params.promptPrefix,
      instructions: params.instructions,
      assistant_id: params.assistant_id,
      model: params.model,
    },
    { context: 'api/server/services/Threads/manage.js #saveAssistantMessage' },
  );

  return message;
}

/**
 * Records token usage for a given completion request.
 *
 * @param {Object} params - The parameters.
 * @param {number} params.prompt_tokens - The number of prompt tokens used.
 * @param {number} params.completion_tokens - The number of completion tokens used.
 * @param {string} params.model - The model used.
 * @param {string} params.user - The user's ID.
 * @param {string} params.conversationId - LibreChat conversation ID.
 * @param {string} [params.context='message'] - The context of the usage.
 * @return {Promise<void>}
 */
const recordUsage = async ({
  prompt_tokens,
  completion_tokens,
  model,
  user,
  conversationId,
  context = 'message',
}) => {
  await spendTokens(
    {
      user,
      model,
      context,
      conversationId,
    },
    { promptTokens: prompt_tokens, completionTokens: completion_tokens },
  );
};

const uniqueCitationStart = '^====||===';
const uniqueCitationEnd = '==|||||^';

/** Helper function to escape special characters in regex
 * @param {string} string - The string to escape.
 * @returns {string} The escaped string.
 */
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Sorts, processes, and flattens messages to a single string.
 *
 * Used by the benchmark/processMessages test fixture; retained for that
 * use-case even though the chat controller no longer calls it.
 *
 * @param {object} params - The parameters for processing messages.
 * @param {OpenAIClient} params.openai - The OpenAI client instance.
 * @param {RunClient} params.client - The client that manages the run.
 * @param {ThreadMessage[]} params.messages - An array of messages.
 * @returns {Promise<{messages: ThreadMessage[], text: string, edited: boolean}>}
 */
async function processMessages({ openai, client, messages = [] }) {
  const sorted = messages.sort((a, b) => a.created_at - b.created_at);

  let text = '';
  let edited = false;
  const sources = new Map();
  const fileRetrievalPromises = [];

  for (const message of sorted) {
    message.files = [];
    for (const content of message.content) {
      const type = content.type;
      const contentType = content[type];
      const currentFileId = contentType?.file_id;

      if (type === ContentTypes.IMAGE_FILE && !client.processedFileIds.has(currentFileId)) {
        fileRetrievalPromises.push(
          retrieveAndProcessFile({
            openai,
            client,
            file_id: currentFileId,
            basename: `${currentFileId}.png`,
          })
            .then((file) => {
              client.processedFileIds.add(currentFileId);
              message.files.push(file);
            })
            .catch((error) => {
              console.error(`Failed to retrieve file: ${error.message}`);
            }),
        );
        continue;
      }

      let currentText = contentType?.value ?? '';

      /** @type {{ annotations: Annotation[] }} */
      const { annotations } = contentType ?? {};

      if (!annotations?.length) {
        text += currentText;
        continue;
      }

      const replacements = [];
      const annotationPromises = annotations.map(async (annotation) => {
        const type = annotation.type;
        const annotationType = annotation[type];
        const file_id = annotationType?.file_id;
        const alreadyProcessed = client.processedFileIds.has(file_id);

        let file;
        let replacementText = '';

        try {
          if (alreadyProcessed) {
            file = await retrieveAndProcessFile({ openai, client, file_id, unknownType: true });
          } else if (type === AnnotationTypes.FILE_PATH) {
            const basename = path.basename(annotation.text);
            file = await retrieveAndProcessFile({
              openai,
              client,
              file_id,
              basename,
            });
            replacementText = file.filepath;
          } else if (type === AnnotationTypes.FILE_CITATION && file_id) {
            replacementText = '';
          }

          replacements.push({
            start: annotation.start_index,
            end: annotation.end_index,
            text: replacementText,
          });
          edited = true;
        } catch (error) {
          console.error(`Failed to process annotation: ${error.message}`);
        }
      });

      await Promise.all(annotationPromises);

      // Apply replacements in reverse order
      replacements.sort((a, b) => b.start - a.start);
      for (const { start, end, text: replacementText } of replacements) {
        currentText = currentText.slice(0, start) + replacementText + currentText.slice(end);
      }

      text += currentText;
    }
  }

  await Promise.all(fileRetrievalPromises);

  // Handle adjacent identical citations with the unique format
  const adjacentCitationRegex = new RegExp(
    `${escapeRegExp(uniqueCitationStart)}(\\d+)${escapeRegExp(
      uniqueCitationEnd,
    )}(\\s*)${escapeRegExp(uniqueCitationStart)}(\\d+)${escapeRegExp(uniqueCitationEnd)}`,
    'g',
  );
  text = text.replace(adjacentCitationRegex, (match, num1, space, num2) => {
    return num1 === num2
      ? `${uniqueCitationStart}${num1}${uniqueCitationEnd}`
      : `${uniqueCitationStart}${num1}${uniqueCitationEnd}${space}${uniqueCitationStart}${num2}${uniqueCitationEnd}`;
  });

  // Remove any remaining adjacent identical citations
  const remainingAdjacentRegex = new RegExp(
    `(${escapeRegExp(uniqueCitationStart)}(\\d+)${escapeRegExp(uniqueCitationEnd)})\\s*\\1+`,
    'g',
  );
  text = text.replace(remainingAdjacentRegex, '$1');

  // Replace the unique citation format with the final format
  text = text.replace(new RegExp(escapeRegExp(uniqueCitationStart), 'g'), '^');
  text = text.replace(new RegExp(escapeRegExp(uniqueCitationEnd), 'g'), '^');

  if (sources.size) {
    text += '\n\n';
    Array.from(sources.entries()).forEach(([source, index], arrayIndex) => {
      text += `^${index}.^ ${source}${arrayIndex === sources.size - 1 ? '' : '\n'}`;
    });
  }

  return { messages: sorted, text, edited };
}

module.exports = {
  recordUsage,
  processMessages,
  saveUserMessage,
  saveAssistantMessage,
  buildConversationInput,
  getOrCreateOpenAIConversation,
  appendItemsToOpenAIConversation,
};
