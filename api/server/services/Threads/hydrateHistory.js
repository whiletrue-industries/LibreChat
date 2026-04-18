const { getMessages } = require('~/models/Message');
const { logger } = require('~/config');

/**
 * Hydrate conversation history from MongoDB into a Responses-API
 * `input` array. No length caps — every prior user message and
 * plain-text assistant reply is included. If the cumulative prompt
 * exceeds the model's TPM or context-length limit the caller is
 * responsible for catching and surfacing a graceful "this conversation
 * is getting too long" message to the user (see
 * ``summarizeOversizedConversation`` and its caller in chatV2).
 *
 * Tool-call items (function_call, function_call_output) are still
 * filtered out — their YAML blobs drove 100k+ token prompts on the
 * previous Conversations-API path, and the user-facing "referent from
 * the last turn" continuity need doesn't depend on them.
 *
 * @param {Object} params
 * @param {string} params.conversationId - LibreChat conversationId.
 * @param {string} [params.excludeMessageId] - Message id to exclude
 *   (typically the current turn's user message).
 * @returns {Promise<Array<{role:'user'|'assistant', content:string}>>}
 *   Chronologically ordered (oldest first).
 */
async function hydrateRecentHistory({ conversationId, excludeMessageId = null } = {}) {
  if (!conversationId) {
    return [];
  }
  const dbMessages = await getMessages({ conversationId });
  if (!dbMessages || dbMessages.length === 0) {
    return [];
  }

  const out = [];
  for (const msg of dbMessages) {
    if (excludeMessageId && msg.messageId === excludeMessageId) {
      continue;
    }
    const text = extractPlainText(msg);
    if (!text) {
      continue;
    }
    out.push({
      role: msg.isCreatedByUser ? 'user' : 'assistant',
      content: text,
    });
  }

  if (out.length > 0) {
    logger.debug(`[hydrateRecentHistory] conversationId=${conversationId} hydrated=${out.length}`);
  }
  return out;
}

/**
 * Pull plain text out of a message document, skipping tool-call content
 * parts. Works with both the legacy `text` string field and the newer
 * `content` array of structured parts.
 */
function extractPlainText(msg) {
  if (typeof msg.text === 'string' && msg.text.trim()) {
    return msg.text.trim();
  }
  if (!Array.isArray(msg.content)) {
    return '';
  }
  const chunks = [];
  for (const part of msg.content) {
    if (!part || typeof part !== 'object') {
      continue;
    }
    const type = part.type || part.kind;
    if (type && type !== 'text') {
      continue;
    }
    const textField = part.text ?? part.value ?? part.content;
    if (typeof textField === 'string' && textField.trim()) {
      chunks.push(textField.trim());
      continue;
    }
    if (typeof textField === 'object' && textField !== null) {
      const nested = textField.value ?? textField.text;
      if (typeof nested === 'string' && nested.trim()) {
        chunks.push(nested.trim());
      }
    }
  }
  return chunks.join('\n\n');
}

module.exports = { hydrateRecentHistory, extractPlainText };
