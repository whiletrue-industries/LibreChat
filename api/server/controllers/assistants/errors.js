// errorHandler.js
const { sendResponse } = require('~/server/utils');
const { logger } = require('~/config');
const getLogStores = require('~/cache/getLogStores');
const { CacheKeys, ViolationTypes } = require('librechat-data-provider');

/**
 * @typedef {Object} ErrorHandlerContext
 * @property {OpenAIClient} openai - The OpenAI client
 * @property {string} run_id - The run ID (response ID under Responses API)
 * @property {boolean} completedRun - Whether the run has completed
 * @property {string} assistant_id - The assistant ID
 * @property {string} conversationId - The conversation ID
 * @property {string} parentMessageId - The parent message ID
 * @property {string} responseMessageId - The response message ID
 * @property {string} endpoint - The endpoint being used
 * @property {string} cacheKey - The cache key for the current request
 */

/**
 * @typedef {Object} ErrorHandlerDependencies
 * @property {Express.Request} req - The Express request object
 * @property {Express.Response} res - The Express response object
 * @property {() => ErrorHandlerContext} getContext - Function to get the current context
 * @property {string} [originPath] - The origin path for the error handler
 */

/**
 * Creates an error handler function with the given dependencies.
 *
 * The Assistants-API branches (cancel/retrieve/checkMessageGaps) have been
 * removed along with the rest of the Assistants chat path. Under the
 * Responses API there is no server-side run to cancel or reconcile; if the
 * stream fails mid-flight we just surface the error and clean up the cache.
 *
 * @param {ErrorHandlerDependencies} dependencies - The dependencies for the error handler
 * @returns {(error: Error) => Promise<void>} The error handler function
 */
const createErrorHandler = ({ req, res, getContext, originPath = '/assistants/chat/' }) => {
  const cache = getLogStores(CacheKeys.ABORT_KEYS);

  /**
   * Handles errors that occur during the chat process
   * @param {Error} error - The error that occurred
   * @returns {Promise<void>}
   */
  return async (error) => {
    const {
      cacheKey,
      completedRun,
      assistant_id,
      conversationId,
      parentMessageId,
      responseMessageId,
      endpoint,
    } = getContext();

    const defaultErrorMessage =
      'The Assistant run failed to initialize. Try sending a message in a new conversation.';
    const messageData = {
      assistant_id,
      conversationId,
      parentMessageId,
      sender: 'System',
      user: req.user.id,
      shouldSaveMessage: false,
      messageId: responseMessageId,
      endpoint,
    };

    if (error.message === 'Run cancelled') {
      return res.end();
    } else if (error.message === 'Request closed' && completedRun) {
      return;
    } else if (error.message === 'Request closed') {
      logger.debug(`[${originPath}] Request aborted on close`);
    } else if (/Files.*are invalid/.test(error.message)) {
      const errorMessage = `Files are invalid, or may not have uploaded yet.${
        endpoint === 'azureAssistants'
          ? ' If using Azure OpenAI, files are only available in the region of the assistant\'s model at the time of upload.'
          : ''
      }`;
      return sendResponse(req, res, messageData, errorMessage);
    } else if (error?.message?.includes('string too long')) {
      return sendResponse(
        req,
        res,
        messageData,
        'Message too long. The Assistants API has a limit of 32,768 characters per message. Please shorten it and try again.',
      );
    } else if (error?.message?.includes(ViolationTypes.TOKEN_BALANCE)) {
      return sendResponse(req, res, messageData, error.message);
    } else {
      logger.error(`[${originPath}]`, error);
    }

    // Responses API: no server-side run to cancel / retrieve / reconcile.
    // Surface the original error to the client and stop.
    try {
      await cache.delete(cacheKey);
    } catch (cacheErr) {
      logger.error(`[${originPath}] Error clearing cache`, cacheErr);
    }
    return sendResponse(
      req,
      res,
      messageData,
      error?.message ?? defaultErrorMessage,
    );
  };
};

module.exports = { createErrorHandler };
