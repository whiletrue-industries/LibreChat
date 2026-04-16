const { CacheKeys, isUUID } = require('librechat-data-provider');
const { deleteMessages } = require('~/models/Message');
const { getConvo } = require('~/models/Conversation');
const getLogStores = require('~/cache/getLogStores');
const { sendMessage } = require('~/server/utils');
const { logger } = require('~/config');

const three_minutes = 1000 * 60 * 3;

/**
 * Abort an in-flight chat request.
 *
 * Under the Responses API there is no server-side run to cancel — the HTTP
 * stream is already closing (the frontend aborted its fetch). We mark the
 * cache, clean up any unfinished placeholder messages in MongoDB, and send
 * a `final` event back to the client so the UI can stop listening.
 */
async function abortRun(req, res) {
  res.setHeader('Content-Type', 'application/json');
  const { abortKey } = req.body;
  const [conversationId] = abortKey.split(':');
  const conversation = await getConvo(req.user.id, conversationId);

  if (conversation?.model) {
    req.body.model = conversation.model;
  }

  if (!isUUID.safeParse(conversationId).success) {
    logger.error('[abortRun] Invalid conversationId', { conversationId });
    return res.status(400).send({ message: 'Invalid conversationId' });
  }

  const cacheKey = `${req.user.id}:${conversationId}`;
  const cache = getLogStores(CacheKeys.ABORT_KEYS);

  try {
    await cache.set(cacheKey, 'cancelled', three_minutes);
  } catch (error) {
    logger.error('[abortRun] Error marking cache cancelled', error);
  }
  try {
    await deleteMessages({
      user: req.user.id,
      unfinished: true,
      conversationId,
    });
  } catch (error) {
    logger.error('[abortRun] Error deleting unfinished messages', error);
  }

  const finalEvent = { final: true, conversation, runMessages: [] };
  if (res.headersSent) {
    return sendMessage(res, finalEvent);
  }
  return res.json(finalEvent);
}

module.exports = {
  abortRun,
};
