const path = require('path');
const {
  Constants,
  ContentTypes,
  AnnotationTypes,
} = require('librechat-data-provider');
const { retrieveAndProcessFile } = require('~/server/services/Files/process');
const { recordMessage } = require('~/models/Message');
const { spendTokens } = require('~/models/spendTokens');
const { saveConvo } = require('~/models/Conversation');
const { countTokens } = require('~/server/utils');

// Previously this file exported `buildConversationInput`,
// `getOrCreateOpenAIConversation`, and `appendItemsToOpenAIConversation`,
// which maintained an OpenAI Conversations-API conversation per LibreChat
// conversation. That path was removed: OpenAI replayed the full
// server-side history (including large tool outputs) into every
// `responses.create` call, driving per-request prompt size into the 100k+
// token range and triggering gpt-5.4-mini TPM rate limits. Botnim bots
// are memoryless per question (system prompts forbid cross-turn memory),
// so stateless is the correct design. LibreChat's UI history continues
// to render from MongoDB.

/**
 * Saves a user message to the DB in the Assistants endpoint format.
 *
 * NOTE: `thread_id` is no longer persisted — the Assistants threads/runs
 * path was removed with the Responses API migration, and each
 * `responses.create` is stateless (no Conversations-API linkage either).
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
};
