const { trace } = require('@opentelemetry/api');
const { logger } = require('@librechat/data-schemas');
const { Constants, ViolationTypes } = require('librechat-data-provider');
const {
  sendEvent,
  getViolationInfo,
  buildMessageFiles,
  GenerationJobManager,
  decrementPendingRequest,
  sanitizeMessageForTransmit,
  checkAndIncrementPendingRequest,
} = require('@librechat/api');
const { disposeClient, clientRegistry, requestDataMap } = require('~/server/cleanup');
const { handleAbortError } = require('~/server/middleware');
const { logViolation } = require('~/cache');
const { saveMessage } = require('~/models');

function createCloseHandler(abortController) {
  return function (manual) {
    if (!manual) {
      logger.debug('[AgentController] Request closed');
    }
    if (!abortController) {
      return;
    } else if (abortController.signal.aborted) {
      return;
    } else if (abortController.requestCompleted) {
      return;
    }

    abortController.abort();
    logger.debug('[AgentController] Request aborted on close');
  };
}

/**
 * Resumable Agent Controller - Generation runs independently of HTTP connection.
 * Returns streamId immediately, client subscribes separately via SSE.
 */
const ResumableAgentController = async (req, res, next, initializeClient, addTitle) => {
  const {
    text,
    isRegenerate,
    endpointOption,
    conversationId: reqConversationId,
    isContinued = false,
    editedContent = null,
    parentMessageId = null,
    overrideParentMessageId = null,
    responseMessageId: editedResponseMessageId = null,
  } = req.body;

  const userId = req.user.id;

  const { allowed, pendingRequests, limit } = await checkAndIncrementPendingRequest(userId);
  if (!allowed) {
    const violationInfo = getViolationInfo(pendingRequests, limit);
    await logViolation(req, res, ViolationTypes.CONCURRENT, violationInfo, violationInfo.score);
    return res.status(429).json(violationInfo);
  }

  // Generate conversationId upfront if not provided - streamId === conversationId always
  // Treat "new" as a placeholder that needs a real UUID (frontend may send "new" for new convos)
  const conversationId =
    !reqConversationId || reqConversationId === 'new' ? crypto.randomUUID() : reqConversationId;
  const streamId = conversationId;

  let client = null;

  try {
    logger.debug(`[ResumableAgentController] Creating job`, {
      streamId,
      conversationId,
      reqConversationId,
      userId,
    });

    const job = await GenerationJobManager.createJob(streamId, userId, conversationId);
    const jobCreatedAt = job.createdAt; // Capture creation time to detect job replacement
    req._resumableStreamId = streamId;

    // Send JSON response IMMEDIATELY so client can connect to SSE stream
    // This is critical: tool loading (MCP OAuth) may emit events that the client needs to receive
    res.json({ streamId, conversationId, status: 'started' });

    // Note: We no longer use res.on('close') to abort since we send JSON immediately.
    // The response closes normally after res.json(), which is not an abort condition.
    // Abort handling is done through GenerationJobManager via the SSE stream connection.

    // Track if partial response was already saved to avoid duplicates
    let partialResponseSaved = false;

    /**
     * Listen for all subscribers leaving to save partial response.
     * This ensures the response is saved to DB even if all clients disconnect
     * while generation continues.
     *
     * Note: The messageId used here falls back to `${userMessage.messageId}_` if the
     * actual response messageId isn't available yet. The final response save will
     * overwrite this with the complete response using the same messageId pattern.
     */
    job.emitter.on('allSubscribersLeft', async (aggregatedContent) => {
      if (partialResponseSaved || !aggregatedContent || aggregatedContent.length === 0) {
        return;
      }

      const resumeState = await GenerationJobManager.getResumeState(streamId);
      if (!resumeState?.userMessage) {
        logger.debug('[ResumableAgentController] No user message to save partial response for');
        return;
      }

      partialResponseSaved = true;
      const responseConversationId = resumeState.conversationId || conversationId;

      try {
        const partialMessage = {
          messageId: resumeState.responseMessageId || `${resumeState.userMessage.messageId}_`,
          conversationId: responseConversationId,
          parentMessageId: resumeState.userMessage.messageId,
          sender: client?.sender ?? 'AI',
          content: aggregatedContent,
          unfinished: true,
          error: false,
          isCreatedByUser: false,
          user: userId,
          endpoint: endpointOption.endpoint,
          model: endpointOption.modelOptions?.model || endpointOption.model_parameters?.model,
        };

        if (req.body?.agent_id) {
          partialMessage.agent_id = req.body.agent_id;
        }

        await saveMessage(req, partialMessage, {
          context: 'api/server/controllers/agents/request.js - partial response on disconnect',
        });

        logger.debug(
          `[ResumableAgentController] Saved partial response for ${streamId}, content parts: ${aggregatedContent.length}`,
        );
      } catch (error) {
        logger.error('[ResumableAgentController] Error saving partial response:', error);
        // Reset flag so we can try again if subscribers reconnect and leave again
        partialResponseSaved = false;
      }
    });

    /** @type {{ client: TAgentClient; userMCPAuthMap?: Record<string, Record<string, string>> }} */
    const result = await initializeClient({
      req,
      res,
      endpointOption,
      // Use the job's abort controller signal - allows abort via GenerationJobManager.abortJob()
      signal: job.abortController.signal,
    });

    if (job.abortController.signal.aborted) {
      GenerationJobManager.completeJob(streamId, 'Request aborted during initialization');
      await decrementPendingRequest(userId);
      return;
    }

    client = result.client;

    if (client?.sender) {
      GenerationJobManager.updateMetadata(streamId, { sender: client.sender });
    }

    // Store reference to client's contentParts - graph will be set when run is created
    if (client?.contentParts) {
      GenerationJobManager.setContentParts(streamId, client.contentParts);
    }

    let userMessage;

    const getReqData = (data = {}) => {
      if (data.userMessage) {
        userMessage = data.userMessage;
      }
      // conversationId is pre-generated, no need to update from callback
    };

    // Start background generation - readyPromise resolves immediately now
    // (sync mechanism handles late subscribers)
    const startGeneration = async () => {
      try {
        // Short timeout as safety net - promise should already be resolved
        await Promise.race([job.readyPromise, new Promise((resolve) => setTimeout(resolve, 100))]);
      } catch (waitError) {
        logger.warn(
          `[ResumableAgentController] Error waiting for subscriber: ${waitError.message}`,
        );
      }

      try {
        const onStart = (userMsg, respMsgId, _isNewConvo) => {
          userMessage = userMsg;

          // Store userMessage and responseMessageId upfront for resume capability
          GenerationJobManager.updateMetadata(streamId, {
            responseMessageId: respMsgId,
            userMessage: {
              messageId: userMsg.messageId,
              parentMessageId: userMsg.parentMessageId,
              conversationId: userMsg.conversationId,
              text: userMsg.text,
            },
          });

          GenerationJobManager.emitChunk(streamId, {
            created: true,
            message: userMessage,
            streamId,
          });
        };

        const messageOptions = {
          user: userId,
          onStart,
          getReqData,
          isContinued,
          isRegenerate,
          editedContent,
          conversationId,
          parentMessageId,
          abortController: job.abortController,
          overrideParentMessageId,
          isEdited: !!editedContent,
          userMCPAuthMap: result.userMCPAuthMap,
          responseMessageId: editedResponseMessageId,
          progressOptions: {
            res: {
              write: () => true,
              end: () => {},
              headersSent: false,
              writableEnded: false,
            },
          },
        };

        // Wrap the LLM call in an explicit chat.turn span so the trace_id
        // capture below has a guaranteed active span (regardless of whether
        // the upstream HttpInstrumentation has propagated context this far).
        // We capture the trace_id INSIDE the span (before .end()) and close
        // over it for the metadata write below.
        //
        // We also monkey-patch http.request/https.request for the duration
        // of sendMessage so EVERY outbound HTTP call to /botnim/retrieve
        // (which is how the agent invokes tools) becomes a guaranteed
        // tool.call span — independent of whether @librechat/agents uses
        // fetch / node-fetch / axios / etc. underneath. The patch is
        // restored in a finally block; nothing leaks.
        const _phxTracer = trace.getTracer('librechat.agent');
        const _phxStartMs = Date.now();
        let _phxTraceId = null;
        const _phxRetrieveSpans = [];     // captured from http patch — for retrospection
        const _phxRetrieveResponses = []; // captured /retrieve response bodies
        const response = await _phxTracer.startActiveSpan('chat.turn', async (_phxSpan) => {
          const _http = require('http');
          const _https = require('https');
          const _otelApi = require('@opentelemetry/api');
          const _origHttpRequest = _http.request;
          const _origHttpsRequest = _https.request;
          const _origHttpGet = _http.get;
          const _origHttpsGet = _https.get;

          function _shouldInstrument(opts) {
            try {
              const path = (typeof opts === 'string')
                ? new URL(opts).pathname
                : (opts?.path || opts?.pathname || '');
              return /\/botnim\/retrieve\//.test(path);
            } catch { return false; }
          }
          function _toolNameFromPath(opts) {
            try {
              const path = (typeof opts === 'string')
                ? new URL(opts).pathname
                : (opts?.path || opts?.pathname || '');
              const m = path.match(/\/botnim\/retrieve\/([^/?]+)\/([^/?]+)/);
              return m ? `search_${m[1]}__${m[2]}` : 'search_unknown';
            } catch { return 'search_unknown'; }
          }
          function _queryFromPath(opts) {
            try {
              const fullPath = (typeof opts === 'string')
                ? new URL(opts).pathname + new URL(opts).search
                : (opts?.path || '');
              const m = fullPath.match(/[?&]query=([^&]+)/);
              return m ? decodeURIComponent(m[1]) : '';
            } catch { return ''; }
          }

          function _wrap(orig, isHttps) {
            return function patched(opts, cb) {
              if (!_shouldInstrument(opts)) {
                return orig.apply(this, arguments);
              }
              const _toolName = _toolNameFromPath(opts);
              const _query = _queryFromPath(opts);
              const _ctx = _otelApi.context.active();
              const _span = _phxTracer.startSpan('tool.call', {}, _ctx);
              // Use setAttribute (not the constructor attributes option) — the
              // SDK we ship sometimes drops construction-time attributes that
              // aren't passed via the explicit setter.
              _span.setAttribute('openinference.span.kind', 'TOOL');
              _span.setAttribute('tool.name', _toolName);
              _span.setAttribute('tool.parameters', JSON.stringify({ query: _query }));
              _span.setAttribute(
                'http.url',
                (typeof opts === 'string')
                  ? opts
                  : `${isHttps ? 'https' : 'http'}://${opts.hostname || opts.host}${opts.path || ''}`,
              );
              _phxRetrieveSpans.push({ span: _span, toolName: _toolName, query: _query });

              // Run the actual request inside the new span context so any
              // child instrumentation also sees this as parent.
              return _otelApi.context.with(_otelApi.trace.setSpan(_ctx, _span), () => {
                const req = orig.call(this, opts, (res) => {
                  let body = '';
                  res.on('data', (chunk) => {
                    if (body.length < 32 * 1024) body += chunk.toString();
                  });
                  res.on('end', () => {
                    try {
                      _span.setAttribute('http.status_code', res.statusCode || 0);
                      const preview = body.slice(0, 8000);
                      _span.setAttribute('tool.response.preview', preview);
                      _phxRetrieveResponses.push({ toolName: _toolName, query: _query, body: preview });
                      // Lightweight doc count for the pill summary
                      const docMatches = preview.match(/^- /gm);
                      if (docMatches) {
                        _span.setAttribute('retrieval.documents.count', docMatches.length);
                      }
                    } finally {
                      _span.end();
                    }
                  });
                  res.on('error', () => _span.end());
                  if (cb) cb(res);
                });
                req.on('error', (err) => {
                  _span.recordException(err);
                  _span.end();
                });
                return req;
              });
            };
          }

          _http.request = _wrap(_origHttpRequest, false);
          _https.request = _wrap(_origHttpsRequest, true);
          _http.get = _wrap(_origHttpGet, false);
          _https.get = _wrap(_origHttpsGet, true);

          try {
            _phxSpan.setAttribute('conversation.id', String(reqConversationId || ''));
            _phxSpan.setAttribute('agent.id', String(endpointOption?.agent?.id || ''));
            _phxTraceId = _phxSpan.spanContext().traceId;
            const r = await client.sendMessage(text, messageOptions);
            // Restore http patches AS SOON AS sendMessage returns — before
            // the retrospective emission so the spans below don't double-fire.
            _http.request = _origHttpRequest;
            _https.request = _origHttpsRequest;
            _http.get = _origHttpGet;
            _https.get = _origHttpsGet;

            // ----------------------------------------------------------------
            // Emit retrospective semantic spans so the AdminTracePanel can see:
            //   • llm.completion  — one per LLM turn (token accounting)
            //   • tool.call       — one per tool the LLM dispatched
            //
            // Data sources (available after sendMessage returns):
            //   client.collectedUsage  — array of UsageMetadata per LLM turn
            //   client.contentParts    — ordered content parts incl. tool_calls
            //   client.model           — model name string
            // ----------------------------------------------------------------
            try {
              const _agentModel =
                client.model ||
                endpointOption?.agent?.model_parameters?.model ||
                'unknown';

              // --- LLM completion spans (one per collected usage entry) ---
              const _usages = Array.isArray(client.collectedUsage) ? client.collectedUsage : [];
              if (_usages.length === 0) {
                // Fallback: emit a single aggregated span using whatever token
                // data the base client recorded on the response message.
                const _llmSpan = _phxTracer.startSpan('llm.completion', {
                  attributes: {
                    'openinference.span.kind': 'LLM',
                    'llm.model_name': _agentModel,
                  },
                });
                _llmSpan.end();
              } else {
                _usages.forEach((_u, _i) => {
                  const _prompt = _u?.prompt_tokens ?? _u?.input_tokens ?? _u?.inputTokens ?? 0;
                  const _compl = _u?.completion_tokens ?? _u?.output_tokens ?? _u?.outputTokens ?? 0;
                  const _llmSpan = _phxTracer.startSpan('llm.completion', {
                    attributes: {
                      'openinference.span.kind': 'LLM',
                      'llm.model_name': _agentModel,
                      'llm.token_count.prompt': _prompt,
                      'llm.token_count.completion': _compl,
                      'llm.token_count.total': _prompt + _compl,
                      'llm.turn_index': _i,
                    },
                  });
                  _llmSpan.end();
                });
              }

              // Tool.call spans for each /botnim/retrieve are already emitted
              // live by the http.request monkey-patch above (see _phxRetrieveSpans).
              // We don't need a retrospective tool emission here because the
              // patched request creates the span inline with the actual call,
              // capturing real timing + response preview.
              logger.info(
                `[phoenix] turn complete: trace_id=${_phxTraceId} ` +
                `llm_turns=${_usages.length} tool_calls=${_phxRetrieveSpans.length}`,
              );
            } catch (_phxEmitErr) {
              logger.warn(
                `[phoenix] error emitting semantic spans: ${_phxEmitErr?.message}`,
              );
            }

            return r;
          } finally {
            // Belt + suspenders: restore http patches even if sendMessage threw.
            _http.request = _origHttpRequest;
            _https.request = _origHttpsRequest;
            _http.get = _origHttpGet;
            _https.get = _origHttpsGet;
            // End any retrieve spans the http hook didn't get to close
            // (e.g. if the response stream errored mid-flight).
            for (const _entry of _phxRetrieveSpans) {
              try { _entry.span.end(); } catch (_e) { /* already ended is fine */ }
            }
            _phxSpan.end();
          }
        });

        const messageId = response.messageId;
        const endpoint = endpointOption.endpoint;
        response.endpoint = endpoint;

        const databasePromise = response.databasePromise;
        delete response.databasePromise;

        const { conversation: convoData = {} } = await databasePromise;
        const conversation = { ...convoData };
        conversation.title =
          conversation && !conversation.title ? null : conversation?.title || 'New Chat';

        if (req.body.files && Array.isArray(client.options.attachments)) {
          const files = buildMessageFiles(req.body.files, client.options.attachments);
          if (files.length > 0) {
            userMessage.files = files;
          }
          delete userMessage.image_urls;
        }

        // Check abort state BEFORE calling completeJob (which triggers abort signal for cleanup)
        const wasAbortedBeforeComplete = job.abortController.signal.aborted;
        const isNewConvo = !reqConversationId || reqConversationId === 'new';
        const shouldGenerateTitle =
          addTitle &&
          parentMessageId === Constants.NO_PARENT &&
          isNewConvo &&
          !wasAbortedBeforeComplete;

        // Save user message BEFORE sending final event to avoid race condition
        // where client refetch happens before database is updated
        if (!client.skipSaveUserMessage && userMessage) {
          await saveMessage(req, userMessage, {
            context: 'api/server/controllers/agents/request.js - resumable user message',
          });
        }

        // Persist the chat.turn trace_id (captured inside the wrapper above)
        // to message metadata for the phoenix admin panel. Mutate the in-flight
        // `response` object so the downstream saveMessage call (if it fires)
        // picks it up — AND fire a direct Mongo update so the trace_id lands
        // even when the streaming flow already saved the message (in which case
        // the `savedMessageIds.has(messageId)` guard below skips that save).
        try {
          if (_phxTraceId) {
            // Tally docs read across all retrieve responses (lightweight: count
            // top-level "- " bullets in YAML/text response previews).
            let _docCount = 0;
            for (const _resp of _phxRetrieveResponses) {
              const _ms = (_resp.body || '').match(/^- /gm);
              if (_ms) _docCount += _ms.length;
            }
            const meta = {
              phoenix_trace_id: _phxTraceId,
              phoenix_summary: {
                totalMs: Date.now() - _phxStartMs,
                toolCount: _phxRetrieveSpans.length,
                docCount: _docCount,
                citedCount: 0, // TODO: cited heuristic in a follow-up
              },
            };
            response.metadata = { ...(response.metadata || {}), ...meta };
            // Direct update — idempotent, only sets phoenix_* keys.
            const { Message } = require('~/db/models');
            Message.updateOne(
              { messageId, user: userId },
              { $set: { 'metadata.phoenix_trace_id': meta.phoenix_trace_id,
                        'metadata.phoenix_summary': meta.phoenix_summary } },
            ).catch((e) => logger.warn(`[phoenix] direct metadata update failed: ${e.message}`));
            logger.info(`[phoenix] captured trace_id=${_phxTraceId} for messageId=${messageId}`);
          } else {
            logger.warn('[phoenix] no trace_id captured — chat.turn span did not produce one');
          }
        } catch (_traceErr) {
          logger.warn(`[phoenix] capture path errored: ${_traceErr?.message}`);
        }

        // CRITICAL: Save response message BEFORE emitting final event.
        // This prevents race conditions where the client sends a follow-up message
        // before the response is saved to the database, causing orphaned parentMessageIds.
        if (client.savedMessageIds && !client.savedMessageIds.has(messageId)) {
          await saveMessage(
            req,
            { ...response, user: userId, unfinished: wasAbortedBeforeComplete },
            { context: 'api/server/controllers/agents/request.js - resumable response end' },
          );
        }

        // Check if our job was replaced by a new request before emitting
        // This prevents stale requests from emitting events to newer jobs
        const currentJob = await GenerationJobManager.getJob(streamId);
        const jobWasReplaced = !currentJob || currentJob.createdAt !== jobCreatedAt;

        if (jobWasReplaced) {
          logger.debug(`[ResumableAgentController] Skipping FINAL emit - job was replaced`, {
            streamId,
            originalCreatedAt: jobCreatedAt,
            currentCreatedAt: currentJob?.createdAt,
          });
          // Still decrement pending request since we incremented at start
          await decrementPendingRequest(userId);
          return;
        }

        if (!wasAbortedBeforeComplete) {
          const finalEvent = {
            final: true,
            conversation,
            title: conversation.title,
            requestMessage: sanitizeMessageForTransmit(userMessage),
            responseMessage: { ...response },
          };

          logger.debug(`[ResumableAgentController] Emitting FINAL event`, {
            streamId,
            wasAbortedBeforeComplete,
            userMessageId: userMessage?.messageId,
            responseMessageId: response?.messageId,
            conversationId: conversation?.conversationId,
          });

          await GenerationJobManager.emitDone(streamId, finalEvent);
          GenerationJobManager.completeJob(streamId);
          await decrementPendingRequest(userId);
        } else {
          const finalEvent = {
            final: true,
            conversation,
            title: conversation.title,
            requestMessage: sanitizeMessageForTransmit(userMessage),
            responseMessage: { ...response, unfinished: true },
          };

          logger.debug(`[ResumableAgentController] Emitting ABORTED FINAL event`, {
            streamId,
            wasAbortedBeforeComplete,
            userMessageId: userMessage?.messageId,
            responseMessageId: response?.messageId,
            conversationId: conversation?.conversationId,
          });

          await GenerationJobManager.emitDone(streamId, finalEvent);
          GenerationJobManager.completeJob(streamId, 'Request aborted');
          await decrementPendingRequest(userId);
        }

        if (shouldGenerateTitle) {
          addTitle(req, {
            text,
            response: { ...response },
            client,
          })
            .catch((err) => {
              logger.error('[ResumableAgentController] Error in title generation', err);
            })
            .finally(() => {
              if (client) {
                disposeClient(client);
              }
            });
        } else {
          if (client) {
            disposeClient(client);
          }
        }
      } catch (error) {
        // Check if this was an abort (not a real error)
        const wasAborted = job.abortController.signal.aborted || error.message?.includes('abort');

        if (wasAborted) {
          logger.debug(`[ResumableAgentController] Generation aborted for ${streamId}`);
          // abortJob already handled emitDone and completeJob
        } else {
          logger.error(`[ResumableAgentController] Generation error for ${streamId}:`, error);
          await GenerationJobManager.emitError(streamId, error.message || 'Generation failed');
          GenerationJobManager.completeJob(streamId, error.message);
        }

        await decrementPendingRequest(userId);

        if (client) {
          disposeClient(client);
        }

        // Don't continue to title generation after error/abort
        return;
      }
    };

    // Start generation and handle any unhandled errors
    startGeneration().catch(async (err) => {
      logger.error(
        `[ResumableAgentController] Unhandled error in background generation: ${err.message}`,
      );
      GenerationJobManager.completeJob(streamId, err.message);
      await decrementPendingRequest(userId);
    });
  } catch (error) {
    logger.error('[ResumableAgentController] Initialization error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || 'Failed to start generation' });
    } else {
      // JSON already sent, emit error to stream so client can receive it
      await GenerationJobManager.emitError(streamId, error.message || 'Failed to start generation');
    }
    GenerationJobManager.completeJob(streamId, error.message);
    await decrementPendingRequest(userId);
    if (client) {
      disposeClient(client);
    }
  }
};

/**
 * Agent Controller - Routes to ResumableAgentController for all requests.
 * The legacy non-resumable path is kept below but no longer used by default.
 */
const AgentController = async (req, res, next, initializeClient, addTitle) => {
  return ResumableAgentController(req, res, next, initializeClient, addTitle);
};

/**
 * Legacy Non-resumable Agent Controller - Uses GenerationJobManager for abort handling.
 * Response is streamed directly to client via res, but abort state is managed centrally.
 * @deprecated Use ResumableAgentController instead
 */
const _LegacyAgentController = async (req, res, next, initializeClient, addTitle) => {
  const {
    text,
    isRegenerate,
    endpointOption,
    conversationId: reqConversationId,
    isContinued = false,
    editedContent = null,
    parentMessageId = null,
    overrideParentMessageId = null,
    responseMessageId: editedResponseMessageId = null,
  } = req.body;

  // Generate conversationId upfront if not provided - streamId === conversationId always
  // Treat "new" as a placeholder that needs a real UUID (frontend may send "new" for new convos)
  const conversationId =
    !reqConversationId || reqConversationId === 'new' ? crypto.randomUUID() : reqConversationId;
  const streamId = conversationId;

  let userMessage;
  let userMessageId;
  let responseMessageId;
  let client = null;
  let cleanupHandlers = [];

  // Match the same logic used for conversationId generation above
  const isNewConvo = !reqConversationId || reqConversationId === 'new';
  const userId = req.user.id;

  // Create handler to avoid capturing the entire parent scope
  let getReqData = (data = {}) => {
    for (let key in data) {
      if (key === 'userMessage') {
        userMessage = data[key];
        userMessageId = data[key].messageId;
      } else if (key === 'responseMessageId') {
        responseMessageId = data[key];
      } else if (key === 'promptTokens') {
        // Update job metadata with prompt tokens for abort handling
        GenerationJobManager.updateMetadata(streamId, { promptTokens: data[key] });
      } else if (key === 'sender') {
        GenerationJobManager.updateMetadata(streamId, { sender: data[key] });
      }
      // conversationId is pre-generated, no need to update from callback
    }
  };

  // Create a function to handle final cleanup
  const performCleanup = async () => {
    logger.debug('[AgentController] Performing cleanup');
    if (Array.isArray(cleanupHandlers)) {
      for (const handler of cleanupHandlers) {
        try {
          if (typeof handler === 'function') {
            handler();
          }
        } catch (e) {
          logger.error('[AgentController] Error in cleanup handler', e);
        }
      }
    }

    // Complete the job in GenerationJobManager
    if (streamId) {
      logger.debug('[AgentController] Completing job in GenerationJobManager');
      await GenerationJobManager.completeJob(streamId);
    }

    // Dispose client properly
    if (client) {
      disposeClient(client);
    }

    // Clear all references
    client = null;
    getReqData = null;
    userMessage = null;
    cleanupHandlers = null;

    // Clear request data map
    if (requestDataMap.has(req)) {
      requestDataMap.delete(req);
    }
    logger.debug('[AgentController] Cleanup completed');
  };

  try {
    let prelimAbortController = new AbortController();
    const prelimCloseHandler = createCloseHandler(prelimAbortController);
    res.on('close', prelimCloseHandler);
    const removePrelimHandler = (manual) => {
      try {
        prelimCloseHandler(manual);
        res.removeListener('close', prelimCloseHandler);
      } catch (e) {
        logger.error('[AgentController] Error removing close listener', e);
      }
    };
    cleanupHandlers.push(removePrelimHandler);

    /** @type {{ client: TAgentClient; userMCPAuthMap?: Record<string, Record<string, string>> }} */
    const result = await initializeClient({
      req,
      res,
      endpointOption,
      signal: prelimAbortController.signal,
    });

    if (prelimAbortController.signal?.aborted) {
      prelimAbortController = null;
      throw new Error('Request was aborted before initialization could complete');
    } else {
      prelimAbortController = null;
      removePrelimHandler(true);
      cleanupHandlers.pop();
    }
    client = result.client;

    // Register client with finalization registry if available
    if (clientRegistry) {
      clientRegistry.register(client, { userId }, client);
    }

    // Store request data in WeakMap keyed by req object
    requestDataMap.set(req, { client });

    // Create job in GenerationJobManager for abort handling
    // streamId === conversationId (pre-generated above)
    const job = await GenerationJobManager.createJob(streamId, userId, conversationId);

    // Store endpoint metadata for abort handling
    GenerationJobManager.updateMetadata(streamId, {
      endpoint: endpointOption.endpoint,
      iconURL: endpointOption.iconURL,
      model: endpointOption.modelOptions?.model || endpointOption.model_parameters?.model,
      sender: client?.sender,
    });

    // Store content parts reference for abort
    if (client?.contentParts) {
      GenerationJobManager.setContentParts(streamId, client.contentParts);
    }

    const closeHandler = createCloseHandler(job.abortController);
    res.on('close', closeHandler);
    cleanupHandlers.push(() => {
      try {
        res.removeListener('close', closeHandler);
      } catch (e) {
        logger.error('[AgentController] Error removing close listener', e);
      }
    });

    /**
     * onStart callback - stores user message and response ID for abort handling
     */
    const onStart = (userMsg, respMsgId, _isNewConvo) => {
      sendEvent(res, { message: userMsg, created: true });
      userMessage = userMsg;
      userMessageId = userMsg.messageId;
      responseMessageId = respMsgId;

      // Store metadata for abort handling (conversationId is pre-generated)
      GenerationJobManager.updateMetadata(streamId, {
        responseMessageId: respMsgId,
        userMessage: {
          messageId: userMsg.messageId,
          parentMessageId: userMsg.parentMessageId,
          conversationId,
          text: userMsg.text,
        },
      });
    };

    const messageOptions = {
      user: userId,
      onStart,
      getReqData,
      isContinued,
      isRegenerate,
      editedContent,
      conversationId,
      parentMessageId,
      abortController: job.abortController,
      overrideParentMessageId,
      isEdited: !!editedContent,
      userMCPAuthMap: result.userMCPAuthMap,
      responseMessageId: editedResponseMessageId,
      progressOptions: {
        res,
      },
    };

    let response = await client.sendMessage(text, messageOptions);

    // Extract what we need and immediately break reference
    const messageId = response.messageId;
    const endpoint = endpointOption.endpoint;
    response.endpoint = endpoint;

    // Store database promise locally
    const databasePromise = response.databasePromise;
    delete response.databasePromise;

    // Resolve database-related data
    const { conversation: convoData = {} } = await databasePromise;
    const conversation = { ...convoData };
    conversation.title =
      conversation && !conversation.title ? null : conversation?.title || 'New Chat';

    if (req.body.files && Array.isArray(client.options.attachments)) {
      const files = buildMessageFiles(req.body.files, client.options.attachments);
      if (files.length > 0) {
        userMessage.files = files;
      }
      delete userMessage.image_urls;
    }

    // Only send if not aborted
    if (!job.abortController.signal.aborted) {
      // Create a new response object with minimal copies
      const finalResponse = { ...response };

      sendEvent(res, {
        final: true,
        conversation,
        title: conversation.title,
        requestMessage: sanitizeMessageForTransmit(userMessage),
        responseMessage: finalResponse,
      });
      res.end();

      // Save the message if needed
      if (client.savedMessageIds && !client.savedMessageIds.has(messageId)) {
        await saveMessage(
          req,
          { ...finalResponse, user: userId },
          { context: 'api/server/controllers/agents/request.js - response end' },
        );
      }
    }
    // Edge case: sendMessage completed but abort happened during sendCompletion
    // We need to ensure a final event is sent
    else if (!res.headersSent && !res.finished) {
      logger.debug(
        '[AgentController] Handling edge case: `sendMessage` completed but aborted during `sendCompletion`',
      );

      const finalResponse = { ...response };
      finalResponse.error = true;

      sendEvent(res, {
        final: true,
        conversation,
        title: conversation.title,
        requestMessage: sanitizeMessageForTransmit(userMessage),
        responseMessage: finalResponse,
        error: { message: 'Request was aborted during completion' },
      });
      res.end();
    }

    // Save user message if needed
    if (!client.skipSaveUserMessage) {
      await saveMessage(req, userMessage, {
        context: "api/server/controllers/agents/request.js - don't skip saving user message",
      });
    }

    // Add title if needed - extract minimal data
    if (addTitle && parentMessageId === Constants.NO_PARENT && isNewConvo) {
      addTitle(req, {
        text,
        response: { ...response },
        client,
      })
        .then(() => {
          logger.debug('[AgentController] Title generation started');
        })
        .catch((err) => {
          logger.error('[AgentController] Error in title generation', err);
        })
        .finally(() => {
          logger.debug('[AgentController] Title generation completed');
          performCleanup();
        });
    } else {
      performCleanup();
    }
  } catch (error) {
    // Handle error without capturing much scope
    handleAbortError(res, req, error, {
      conversationId,
      sender: client?.sender,
      messageId: responseMessageId,
      parentMessageId: overrideParentMessageId ?? userMessageId ?? parentMessageId,
      userMessageId,
    })
      .catch((err) => {
        logger.error('[api/server/controllers/agents/request] Error in `handleAbortError`', err);
      })
      .finally(() => {
        performCleanup();
      });
  }
};

module.exports = AgentController;
