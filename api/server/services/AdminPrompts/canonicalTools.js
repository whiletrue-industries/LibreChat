'use strict';

// Resolves the canonical tool list (name → default description) for a given
// bot. Source of truth lives on the rebuilding-bots FastAPI side at
// `${BOTNIM_API_BASE}/botnim/config/<bot>` (Task 3 of the unified-prompt-editor
// plan). Until that endpoint exists in every env, this helper degrades
// gracefully to an empty map so the GET /tools route still returns 200 and
// the UI can display the override-only view.

async function fetchCanonicalTools(agentType) {
  const base = process.env.BOTNIM_API_BASE;
  if (!base) {
    return {};
  }
  const url = `${base.replace(/\/$/, '')}/botnim/config/${encodeURIComponent(agentType)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} GET ${url}`);
  }
  const body = await res.json();
  const tools = body?.tools || {};
  const out = {};
  for (const name of Object.keys(tools)) {
    const t = tools[name] || {};
    out[name] = typeof t === 'string' ? t : t.description || '';
  }
  return out;
}

module.exports = { fetchCanonicalTools };
