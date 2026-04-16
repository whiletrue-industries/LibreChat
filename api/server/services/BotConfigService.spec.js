/**
 * Tests for BotConfigService. Uses a mocked `global.fetch` so no network
 * calls are made.
 */

jest.mock('~/config', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const { getBotConfig, clearCache } = require('./BotConfigService');

describe('BotConfigService', () => {
  const sampleConfig = {
    slug: 'unified',
    name: 'Unified',
    description: 'desc',
    environment: 'staging',
    model: 'gpt-5.4-mini',
    instructions: 'You are helpful.',
    temperature: 0.00001,
    tools: [
      {
        type: 'function',
        name: 'search',
        description: 'Search',
        parameters: { type: 'object', properties: {}, required: [] },
      },
    ],
  };

  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    clearCache();
    process.env.BOTNIM_API = 'http://botnim_api:8000';
    process.env.BOTNIM_ENVIRONMENT = 'staging';
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
    jest.clearAllMocks();
  });

  test('fetches and returns config on first call', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => sampleConfig,
    });

    const result = await getBotConfig({ bot: 'unified', environment: 'staging' });
    expect(result).toEqual(sampleConfig);
    expect(global.fetch).toHaveBeenCalledWith(
      'http://botnim_api:8000/config/unified?environment=staging',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  test('uses in-memory cache on repeat calls within TTL', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => sampleConfig,
    });

    await getBotConfig({ bot: 'unified', environment: 'staging' });
    await getBotConfig({ bot: 'unified', environment: 'staging' });

    // fetch only happened once; the second call was served from cache.
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('re-fetches when TTL expires', async () => {
    global.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => sampleConfig })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ...sampleConfig, model: 'gpt-5-new' }) });

    const a = await getBotConfig({ bot: 'unified', environment: 'staging', ttlMs: 0 });
    const b = await getBotConfig({ bot: 'unified', environment: 'staging', ttlMs: 0 });

    expect(a.model).toBe('gpt-5.4-mini');
    expect(b.model).toBe('gpt-5-new');
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('falls back to BOTNIM_ENVIRONMENT env var when no environment arg', async () => {
    process.env.BOTNIM_ENVIRONMENT = 'production';
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ...sampleConfig, environment: 'production' }),
    });

    await getBotConfig({ bot: 'budgetkey' });
    const [url] = global.fetch.mock.calls[0];
    expect(url).toContain('environment=production');
    expect(url).toContain('/config/budgetkey');
  });

  test('adds the /botnim prefix when routed via nginx', async () => {
    process.env.BOTNIM_API = 'http://LibreChat-NGINX';
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => sampleConfig,
    });

    await getBotConfig({ bot: 'unified', environment: 'staging' });
    const [url] = global.fetch.mock.calls[0];
    expect(url).toBe(
      'http://LibreChat-NGINX/botnim/config/unified?environment=staging',
    );
  });

  test('throws on non-OK response', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => '{"detail":"Unknown bot"}',
    });
    await expect(
      getBotConfig({ bot: 'nope', environment: 'staging' }),
    ).rejects.toThrow(/returned 404/);
  });

  test('throws on malformed config (missing model)', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ...sampleConfig, model: undefined }),
    });
    await expect(
      getBotConfig({ bot: 'unified', environment: 'staging' }),
    ).rejects.toThrow(/Malformed config/);
  });

  test('throws when `bot` is missing', async () => {
    await expect(getBotConfig({ bot: '' })).rejects.toThrow(/`bot` is required/);
  });
});
