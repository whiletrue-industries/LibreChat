jest.mock('~/models/Message', () => ({ getMessages: jest.fn() }));
jest.mock('~/config', () => ({ logger: { debug: jest.fn(), error: jest.fn() } }));

const { getMessages } = require('~/models/Message');
const { hydrateRecentHistory, extractPlainText } = require('./hydrateHistory');

function userMsg(id, text, createdAt) {
  return { messageId: id, text, isCreatedByUser: true, createdAt: new Date(createdAt) };
}
function botMsg(id, text, createdAt) {
  return { messageId: id, text, isCreatedByUser: false, createdAt: new Date(createdAt) };
}
function structuredBotMsg(id, parts, createdAt) {
  return { messageId: id, content: parts, isCreatedByUser: false, createdAt: new Date(createdAt) };
}

describe('hydrateRecentHistory', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('returns empty list for missing conversationId', async () => {
    const out = await hydrateRecentHistory({});
    expect(out).toEqual([]);
    expect(getMessages).not.toHaveBeenCalled();
  });

  test('returns empty list when no messages exist', async () => {
    getMessages.mockResolvedValueOnce([]);
    const out = await hydrateRecentHistory({ conversationId: 'cid-1' });
    expect(out).toEqual([]);
  });

  test('hydrates chronological user/assistant pairs', async () => {
    getMessages.mockResolvedValueOnce([
      userMsg('u1', 'question one', '2026-04-17T10:00:00Z'),
      botMsg('a1', 'answer one', '2026-04-17T10:00:30Z'),
      userMsg('u2', 'follow up', '2026-04-17T10:01:00Z'),
      botMsg('a2', 'second answer', '2026-04-17T10:01:30Z'),
    ]);
    const out = await hydrateRecentHistory({ conversationId: 'cid-1' });
    expect(out).toEqual([
      { role: 'user',      content: 'question one' },
      { role: 'assistant', content: 'answer one' },
      { role: 'user',      content: 'follow up' },
      { role: 'assistant', content: 'second answer' },
    ]);
  });

  test('excludes the current turn user messageId', async () => {
    getMessages.mockResolvedValueOnce([
      userMsg('u1', 'past', '2026-04-17T10:00:00Z'),
      botMsg('a1', 'past reply', '2026-04-17T10:00:30Z'),
      userMsg('u-current', 'current turn', '2026-04-17T10:01:00Z'),
    ]);
    const out = await hydrateRecentHistory({
      conversationId: 'cid-1',
      excludeMessageId: 'u-current',
    });
    expect(out.map((m) => m.content)).toEqual(['past', 'past reply']);
  });

  test('hydrates a very long history without capping', async () => {
    // No length cap is applied in the hydrator itself. If the resulting
    // prompt trips the model's limit, the chatV2 controller catches the
    // error and surfaces a recap — see oversizedConversation.spec.js.
    const fixture = [];
    for (let i = 0; i < 200; i++) {
      fixture.push(userMsg(`u${i}`, `msg ${i}`, `2026-04-17T10:${String(i).padStart(3,'0')}Z`));
    }
    getMessages.mockResolvedValueOnce(fixture);
    const out = await hydrateRecentHistory({ conversationId: 'cid-1' });
    expect(out).toHaveLength(200);
    expect(out[0].content).toBe('msg 0');
    expect(out[199].content).toBe('msg 199');
  });

  test('skips function_call structured content parts', async () => {
    getMessages.mockResolvedValueOnce([
      userMsg('u1', 'question', '2026-04-17T10:00:00Z'),
      structuredBotMsg('a1', [
        { type: 'function_call', name: 'search', arguments: '{}' },
        { type: 'text', text: 'Here is the answer.' },
        { type: 'function_call_output', output: 'big yaml blob' },
      ], '2026-04-17T10:00:30Z'),
    ]);
    const out = await hydrateRecentHistory({ conversationId: 'cid-1' });
    expect(out).toEqual([
      { role: 'user',      content: 'question' },
      { role: 'assistant', content: 'Here is the answer.' },
    ]);
  });

  test('drops messages with no extractable text', async () => {
    getMessages.mockResolvedValueOnce([
      userMsg('u1', 'valid', '2026-04-17T10:00:00Z'),
      structuredBotMsg('a1', [
        { type: 'function_call', name: 'search', arguments: '{}' },
      ], '2026-04-17T10:00:30Z'),
      userMsg('u2', 'also valid', '2026-04-17T10:01:00Z'),
    ]);
    const out = await hydrateRecentHistory({ conversationId: 'cid-1' });
    expect(out.map((m) => m.content)).toEqual(['valid', 'also valid']);
  });
});

describe('extractPlainText', () => {
  test('prefers top-level .text', () => {
    expect(extractPlainText({ text: 'hello' })).toBe('hello');
  });
  test('handles value-nested content parts', () => {
    const msg = { content: [{ type: 'text', text: { value: 'nested' } }] };
    expect(extractPlainText(msg)).toBe('nested');
  });
  test('returns empty for pure tool-call messages', () => {
    const msg = { content: [{ type: 'function_call', name: 'x', arguments: '{}' }] };
    expect(extractPlainText(msg)).toBe('');
  });
});
