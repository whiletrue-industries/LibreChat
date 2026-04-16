/**
 * BotConfigService — fetches the Responses-API-shaped bot configuration
 * (model, instructions, tools, temperature) from the botnim API.
 *
 * This replaces the previous chat-time call to
 * `openai.beta.assistants.retrieve(assistant_id)`. The Assistants API is
 * retiring 2026-08-26 and its `Prompts` replacement is dashboard-only, so
 * botnim serves the config itself (rebuilt on every request from the
 * committed `specs/<bot>/` tree). See
 * `rebuilding-bots/docs/LIBRECHAT_SYNC_CONTRACT.md` for the full contract.
 *
 * Shape:
 *   {
 *     slug: "unified",
 *     name: "...",
 *     description: "...",
 *     environment: "staging",
 *     model: "gpt-5.4-mini",
 *     instructions: "...",
 *     temperature: 0.00001,
 *     tools: [ { type: "function", name, description, parameters }, ... ]
 *   }
 *
 * The endpoint re-reads `specs/` on every request, so we only need a short
 * client-side TTL to absorb burst load — there's no meaningful staleness
 * cost to a 60-second cache.
 */

const { logger } = require('~/config');

const DEFAULT_TTL_MS = 60 * 1000;
const FETCH_TIMEOUT_MS = 10 * 1000;

/** @type {Map<string, { value: Object, expiresAt: number }>} */
const cache = new Map();

/**
 * Resolve the base URL for the botnim API. In the local/production Docker
 * network this points at `http://botnim_api:8000`; operators can also
 * route via nginx (`http://LibreChat-NGINX`) which prefixes everything
 * with `/botnim`. The env var defaults to the direct internal URL.
 *
 * @returns {{ baseUrl: string, pathPrefix: string }}
 */
function resolveEndpoint() {
  const raw = (process.env.BOTNIM_API ?? 'http://botnim_api:8000').replace(/\/+$/, '');
  // If the operator points us at nginx (no explicit port), assume the
  // `/botnim` prefix the proxy adds. Otherwise use the direct routes.
  const usesNginxProxy = /LibreChat-NGINX|nginx/i.test(raw);
  return {
    baseUrl: raw,
    pathPrefix: usesNginxProxy ? '/botnim' : '',
  };
}

/**
 * Fetch the BotConfig for `(bot, environment)` from the botnim API.
 *
 * @param {Object} opts
 * @param {string} opts.bot - The bot slug (`unified`, `budgetkey`, `takanon`).
 * @param {string} [opts.environment] - The environment (`local`, `staging`, `production`).
 * @param {number} [opts.ttlMs] - Client-side cache TTL. Defaults to 60s.
 * @returns {Promise<Object>} The BotConfig bundle.
 */
async function getBotConfig({ bot, environment, ttlMs = DEFAULT_TTL_MS }) {
  if (!bot) {
    throw new Error('[BotConfigService] `bot` is required');
  }

  const env = environment ?? process.env.BOTNIM_ENVIRONMENT ?? 'staging';
  const cacheKey = `${bot}::${env}`;

  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const { baseUrl, pathPrefix } = resolveEndpoint();
  const url = `${baseUrl}${pathPrefix}/config/${encodeURIComponent(bot)}?environment=${encodeURIComponent(env)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } catch (err) {
    clearTimeout(timer);
    throw new Error(
      `[BotConfigService] Failed to fetch ${url}: ${err.message}`,
    );
  }
  clearTimeout(timer);

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `[BotConfigService] ${url} returned ${response.status}: ${body.slice(0, 500)}`,
    );
  }

  const config = await response.json();

  if (!config?.model || !Array.isArray(config.tools)) {
    throw new Error(
      `[BotConfigService] Malformed config from ${url}: missing model or tools`,
    );
  }

  cache.set(cacheKey, {
    value: config,
    expiresAt: Date.now() + ttlMs,
  });

  logger.debug(
    `[BotConfigService] Fetched config for ${bot}/${env} — model=${config.model} tools=${config.tools.length}`,
  );

  return config;
}

/**
 * Clear the in-process cache. Intended for tests and admin-triggered
 * invalidations (there's no current invalidation path from the bot side —
 * the server re-reads specs/ on every request, so the TTL is enough).
 */
function clearCache() {
  cache.clear();
}

module.exports = {
  getBotConfig,
  clearCache,
};
