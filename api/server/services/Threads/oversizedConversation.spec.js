const {
  isConversationTooLongError,
  isRateLimitError,
  isContextLengthError,
  computeBackoffDelayMs,
  retryOnRateLimit,
  buildRecap,
  CONVERSATION_TOO_LONG_HEBREW,
  CONVERSATION_TOO_LONG_ENGLISH,
} = require('./oversizedConversation');

describe('isConversationTooLongError', () => {
  test('detects HTTP 429 rate-limit objects', () => {
    expect(isConversationTooLongError({ status: 429, message: 'Rate limit reached for gpt-5.4-mini' })).toBe(true);
  });

  test('detects HTTP 400 + context_length_exceeded', () => {
    expect(isConversationTooLongError({ status: 400, code: 'context_length_exceeded', message: 'too many tokens' })).toBe(true);
  });

  test('detects by message substring when status is missing', () => {
    expect(isConversationTooLongError({ message: 'This model has a maximum context length of 200000 tokens' })).toBe(true);
    expect(isConversationTooLongError({ message: 'rate limit reached' })).toBe(true);
    expect(isConversationTooLongError({ message: 'tokens per min (TPM): Limit 200000' })).toBe(true);
  });

  test('returns false for unrelated errors', () => {
    expect(isConversationTooLongError({ status: 500, message: 'internal server error' })).toBe(false);
    expect(isConversationTooLongError({ status: 401, message: 'invalid api key' })).toBe(false);
    expect(isConversationTooLongError(null)).toBe(false);
    expect(isConversationTooLongError(undefined)).toBe(false);
  });
});

describe('buildRecap', () => {
  test('includes Hebrew + English explanatory headers', () => {
    const recap = buildRecap([], 'current question');
    expect(recap).toContain(CONVERSATION_TOO_LONG_HEBREW);
    expect(recap).toContain(CONVERSATION_TOO_LONG_ENGLISH);
  });

  test('renders each prior turn as a bullet', () => {
    const history = [
      { role: 'user',      content: 'what was the 2025 education budget?' },
      { role: 'assistant', content: 'It was 89.8B NIS.' },
      { role: 'user',      content: 'and 2024?' },
      { role: 'assistant', content: 'I need to look that up.' },
    ];
    const recap = buildRecap(history, 'can you also do 2023?');
    // One bullet per prior turn + one for the current unanswered question
    expect(recap.match(/^- /gm)).toHaveLength(5);
    expect(recap).toContain('what was the 2025 education budget?');
    expect(recap).toContain('can you also do 2023?');
  });

  test('truncates long individual messages but never drops them', () => {
    const huge = 'x'.repeat(10000);
    const recap = buildRecap([{ role: 'user', content: huge }], 'new question');
    expect(recap).toContain('…');
    // ensure neither bullet vanished
    expect(recap.match(/^- /gm).length).toBe(2);
  });

  test('works with empty history (first-turn failure)', () => {
    const recap = buildRecap([], 'the very first question');
    expect(recap).toContain('the very first question');
    expect(recap.match(/^- /gm)).toHaveLength(1);
  });
});

describe('isRateLimitError', () => {
  test('matches 429 status + rate-limit messages', () => {
    expect(isRateLimitError({ status: 429, message: 'Rate limit reached' })).toBe(true);
    expect(isRateLimitError({ message: 'Rate limit reached for gpt-5.4-mini' })).toBe(true);
    expect(isRateLimitError({ message: 'tokens per min (TPM): Limit 200000' })).toBe(true);
  });

  test('does not match context-length errors', () => {
    expect(isRateLimitError({ status: 400, code: 'context_length_exceeded' })).toBe(false);
  });
});

describe('isContextLengthError', () => {
  test('matches the canonical 400 + code pair', () => {
    expect(isContextLengthError({ status: 400, code: 'context_length_exceeded', message: 'too many tokens' })).toBe(true);
  });

  test('matches by message substring fallback', () => {
    expect(isContextLengthError({ message: 'This model has a maximum context length of 200000 tokens' })).toBe(true);
  });

  test('does not match 429 rate limits', () => {
    expect(isContextLengthError({ status: 429, message: 'Rate limit reached' })).toBe(false);
  });
});

describe('computeBackoffDelayMs', () => {
  let spy;
  afterEach(() => { if (spy) spy.mockRestore(); });

  test('bounded by the min/max window', () => {
    spy = jest.spyOn(Math, 'random').mockReturnValue(0.99);
    // attempt 0 → upper = min(60000, 1000 * 2^0) = 1000
    expect(computeBackoffDelayMs(0)).toBeLessThanOrEqual(1000);
    // attempt 3 → upper = min(60000, 1000 * 8) = 8000
    expect(computeBackoffDelayMs(3)).toBeLessThanOrEqual(8000);
    // attempt 10 → capped at 60s
    expect(computeBackoffDelayMs(10)).toBeLessThanOrEqual(60000);
  });

  test('yields 0 when Math.random returns 0', () => {
    spy = jest.spyOn(Math, 'random').mockReturnValue(0);
    expect(computeBackoffDelayMs(3)).toBe(0);
  });

  test('honors custom min/max', () => {
    spy = jest.spyOn(Math, 'random').mockReturnValue(0.99);
    // attempt 0 with custom minMs=100 → upper = min(maxMs, 100) = 100
    expect(computeBackoffDelayMs(0, { minMs: 100, maxMs: 200 })).toBeLessThanOrEqual(100);
    // attempt 10 → upper capped at maxMs=200
    expect(computeBackoffDelayMs(10, { minMs: 100, maxMs: 200 })).toBeLessThanOrEqual(200);
  });
});

describe('retryOnRateLimit', () => {
  // Use 0ms backoffs so the tests run instantly.
  const fastOpts = { minBackoffMs: 0, maxBackoffMs: 0 };

  test('returns the value on first success', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const out = await retryOnRateLimit(fn, fastOpts);
    expect(out).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('retries through 429s then succeeds', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(Object.assign(new Error('Rate limit reached'), { status: 429 }))
      .mockRejectedValueOnce(Object.assign(new Error('Rate limit reached'), { status: 429 }))
      .mockResolvedValue('ok');
    const out = await retryOnRateLimit(fn, fastOpts);
    expect(out).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test('stops after maxAttempts and re-throws the last 429', async () => {
    const err = Object.assign(new Error('Rate limit reached'), { status: 429 });
    const fn = jest.fn().mockRejectedValue(err);
    await expect(retryOnRateLimit(fn, { ...fastOpts, maxAttempts: 3 })).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test('does not retry on context-length errors', async () => {
    const err = Object.assign(new Error('maximum context length'), { status: 400, code: 'context_length_exceeded' });
    const fn = jest.fn().mockRejectedValue(err);
    await expect(retryOnRateLimit(fn, fastOpts)).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('does not retry on unrelated errors', async () => {
    const err = Object.assign(new Error('invalid api key'), { status: 401 });
    const fn = jest.fn().mockRejectedValue(err);
    await expect(retryOnRateLimit(fn, fastOpts)).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('invokes onRetry hook with error, attempt index, and delay', async () => {
    const onRetry = jest.fn();
    const fn = jest.fn()
      .mockRejectedValueOnce(Object.assign(new Error('Rate limit'), { status: 429 }))
      .mockResolvedValue('ok');
    await retryOnRateLimit(fn, { ...fastOpts, onRetry });
    expect(onRetry).toHaveBeenCalledTimes(1);
    const [errArg, attemptArg, delayArg] = onRetry.mock.calls[0];
    expect(errArg).toBeInstanceOf(Error);
    expect(attemptArg).toBe(0);
    expect(typeof delayArg).toBe('number');
  });
});
