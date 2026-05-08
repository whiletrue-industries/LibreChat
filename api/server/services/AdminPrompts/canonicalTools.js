'use strict';

// Resolves the canonical tool list (name → default description) for a given
// bot. Source of truth lives on the rebuilding-bots FastAPI side at
// `${BOTNIM_API_BASE}/botnim/config/<bot>`. Until that endpoint exists in
// every env, this helper degrades gracefully to an empty map so the GET
// /tools route still returns 200 and the UI can display the override-only
// view.
//
// Response shape from rb (`bot_config.load_bot_config`):
//
//   { ...,
//     "tools": [
//       { "type": "function", "name": "search_unified__legal_text",
//         "description": "...", "parameters": { ... } },
//       ...
//     ]
//   }
//
// We extract `name` + `description` from each array element. We also
// accept the legacy dict-keyed shape (`{name: desc}` or
// `{name: {description}}`) for forward compat in case rb ever changes.

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
  const tools = body?.tools;
  const out = {};
  if (Array.isArray(tools)) {
    for (const t of tools) {
      if (!t || typeof t !== 'object') {
        continue;
      }
      // OpenAI Responses-API shape — function tools have `name` +
      // `description` at the top level. Built-ins like `code_interpreter`
      // expose only `type` and have no name/description, so skip them.
      const name = t.name || (t.function && t.function.name);
      if (!name) {
        continue;
      }
      const description =
        t.description || (t.function && t.function.description) || '';
      out[name] = description;
    }
  } else if (tools && typeof tools === 'object') {
    // Legacy dict shape: `tools` is keyed by tool name.
    for (const name of Object.keys(tools)) {
      const t = tools[name] || {};
      out[name] = typeof t === 'string' ? t : t.description || '';
    }
  }
  return out;
}

module.exports = { fetchCanonicalTools };
