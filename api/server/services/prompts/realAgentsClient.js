const crypto = require('node:crypto');

// Browser-looking UA so LibreChat's uaParser middleware doesn't reject us
// with "Illegal request" (non-browser violation). Self-calls from inside
// the api container still pass through that same middleware.
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0 Safari/537.36';

const UUID_ZERO = '00000000-0000-0000-0000-000000000000';

function buildRealAgentsClient({ apiBase, authToken }) {
  const baseHeaders = {
    Authorization: `Bearer ${authToken}`,
    'User-Agent': BROWSER_UA,
  };

  async function httpJson(method, path, body) {
    const res = await fetch(`${apiBase}${path}`, {
      method,
      headers: { ...baseHeaders, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} ${method} ${path} ${text.slice(0, 200)}`);
    }
    return res.status === 204 ? null : res.json();
  }

  async function consumeSSE(url, onEvent) {
    const res = await fetch(url, {
      headers: { ...baseHeaders, Accept: 'text/event-stream' },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} GET ${url}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split('\n\n');
      buffer = chunks.pop() || '';
      for (const chunk of chunks) {
        const dataLine = chunk.split('\n').find((l) => l.startsWith('data: '));
        if (!dataLine) continue;
        try {
          onEvent(JSON.parse(dataLine.slice(6)));
        } catch {
          /* ignore malformed events */
        }
      }
    }
  }

  return {
    async getAgent(id) {
      const a = await httpJson('GET', `/api/agents/${encodeURIComponent(id)}`);
      return {
        id: a.id,
        name: a.name,
        model: a.model,
        provider: a.provider ?? 'openAI',
        instructions: a.instructions ?? '',
        actions: a.actions,
      };
    },
    async createAgent(input) {
      const a = await httpJson('POST', '/api/agents', input);
      return { id: a.id, ...input };
    },
    async patchAgent(id, patch) {
      const a = await httpJson(
        'PATCH',
        `/api/agents/${encodeURIComponent(id)}`,
        patch,
      );
      return { id, ...patch, ...a };
    },
    async deleteAgent(id) {
      await httpJson('DELETE', `/api/agents/${encodeURIComponent(id)}`);
    },
    // v0.8.4 chat is a 2-phase SSE flow. POST starts the run, returns a
    // streamId. GET on /chat/stream/:streamId yields SSE events we drain
    // to accumulate the final answer + tool-call trace.
    async chat(id, message) {
      const conversationId = crypto.randomUUID();
      const messageId = crypto.randomUUID();
      const live = await this.getAgent(id).catch(() => null);
      const start = await httpJson('POST', '/api/agents/chat/agents', {
        conversationId,
        parentMessageId: UUID_ZERO,
        messageId,
        text: message,
        endpoint: 'agents',
        agent_id: id,
        model: live?.model ?? 'gpt-5.4-mini',
        isContinued: false,
        isEdited: false,
        ephemeralAgent: null,
      });
      const streamId = start?.streamId;
      if (!streamId) {
        throw new Error(`chat start: no streamId returned`);
      }

      let answer = '';
      const toolCalls = [];
      await consumeSSE(
        `${apiBase}/api/agents/chat/stream/${encodeURIComponent(streamId)}`,
        (evt) => {
          // Final assembled message — preferred when present
          if (evt?.final?.responseMessage?.text) {
            answer = evt.final.responseMessage.text;
          } else if (evt?.message && !evt.message.isCreatedByUser && evt.message.text) {
            answer = evt.message.text;
          }
          // Assistant text deltas (streaming typing animation)
          const delta = evt?.data?.delta;
          if (delta?.type === 'text' && typeof delta.text === 'string') {
            answer += delta.text;
          }
          if (delta?.content) {
            for (const part of Array.isArray(delta.content) ? delta.content : []) {
              if (part?.type === 'text' && typeof part.text === 'string') {
                answer += part.text;
              }
            }
          }
          // Tool-call steps (agent invoked a function)
          if (
            evt?.event === 'on_run_step' &&
            evt?.data?.stepDetails?.type === 'tool_calls'
          ) {
            for (const tc of evt.data.stepDetails.tool_calls || []) {
              toolCalls.push({ name: tc.name, id: tc.id, args: tc.args });
            }
          }
        },
      );

      return { answer, toolCalls };
    },
  };
}

module.exports = { buildRealAgentsClient };
