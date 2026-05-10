#!/usr/bin/env node
/**
 * Idempotent seed script for the "Botnim" agent on upstream LibreChat v0.8.4.
 *
 * Reads from:
 *   - Aurora (agent_prompts table)  — agent instructions (sections)
 *   - /srv/specs/openapi/*.yaml     — one OpenAPI spec per tool family; each becomes
 *                                     one Action on the agent
 *
 * Authenticates as admin@botnim.local (credentials via env) and either
 * creates the Botnim agent or finds an existing one by name, then
 * (re-)creates the Actions from the OpenAPI specs.
 *
 * Run inside the LibreChat API container so it can require
 * `librechat-data-provider` directly (no bundling needed):
 *
 *   docker compose run --rm -T api node scripts/seed-botnim-agent.js
 *
 * Env:
 *   SEED_ADMIN_EMAIL    (default admin@botnim.local)
 *   SEED_ADMIN_PASSWORD (default admin123)
 *   SEED_API_BASE       (default http://localhost:3080)
 *   SEED_AGENT_NAME     (default "בוט מאוחד - תקנון, חוקים ותקציב")
 *   SEED_AGENT_BOT      (default unified) — agent_type used by the AdminPrompts
 *                        draft-mirror upsert (must match Aurora agent_prompts
 *                        rows for the canonical agent)
 *   SEED_MODEL          (default gpt-5.4-mini)
 *   SEED_SPECS_DIR      (default /srv/specs)
 *   MONGO_URI           — required for the global-share + draft-mirror steps;
 *                        if unset both are skipped with a warning
 *   DATABASE_URL        — Aurora connection (required unless DB_HOST/etc are set)
 *   DB_HOST             — Aurora host (use with DB_USER, DB_PASSWORD, DB_PORT, DB_NAME)
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const mongoose = require('mongoose');

// Register the `~` → api/ module alias used by api/server code we
// pull in (e.g. draftAgent.js requires `~/server/...` and `~/db/models`).
// Mirrors api/server/index.js bootstrap.
require('module-alias')({ base: path.resolve(__dirname, '..', 'api') });

const { openapiToFunction, validateAndParseOpenAPISpec } =
  require('librechat-data-provider');
const aurora = require(path.resolve(__dirname, '..', 'api', 'server', 'services', 'AdminPrompts', 'aurora'));
const draftAgentService = require(path.resolve(
  __dirname,
  '..',
  'api',
  'server',
  'services',
  'AdminPrompts',
  'draftAgent',
));
const { AdminPrompts } = require('@librechat/api');

const EMAIL = process.env.SEED_ADMIN_EMAIL || 'admin@botnim.local';
const PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'admin123';
const API = process.env.SEED_API_BASE || 'http://localhost:3080';
const AGENT_NAME = process.env.SEED_AGENT_NAME ||
  'בוט מאוחד - תקנון, חוקים ותקציב';
const AGENT_BOT = process.env.SEED_AGENT_BOT || 'unified';
const MODEL = process.env.SEED_MODEL || 'gpt-5.4-mini';
const SPECS_DIR = process.env.SEED_SPECS_DIR || '/srv/specs';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120 Safari/537.36';

async function httpJson(method, url, { token, body, headers } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      'User-Agent': UA,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers || {}),
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = { _raw: text }; }
  if (!res.ok) {
    const err = new Error(
      `${method} ${url} → ${res.status}: ${JSON.stringify(parsed).slice(0, 400)}`
    );
    err.status = res.status;
    err.body = parsed;
    throw err;
  }
  return parsed;
}

async function login() {
  const body = await httpJson('POST', `${API}/api/auth/login`, {
    body: { email: EMAIL, password: PASSWORD },
  });
  if (!body.token) throw new Error(`login returned no token: ${JSON.stringify(body)}`);
  return body.token;
}

async function listAgents(token) {
  const body = await httpJson('GET', `${API}/api/agents`, { token });
  return body.data || [];
}

async function listAgentActions(token, agentId) {
  // GET /api/agents/actions returns every action across all agents the
  // caller can edit. Filter to just our agent. Returns Action documents
  // (each with action_id, metadata.domain, etc.).
  const all = await httpJson('GET', `${API}/api/agents/actions`, { token });
  return (Array.isArray(all) ? all : []).filter((a) => a.agent_id === agentId);
}

async function deleteAgentAction(token, agentId, actionId) {
  // DELETE /api/agents/actions/{agentId}/{actionId} removes the action
  // doc AND prunes the agent's `actions[]` + `tools[]` arrays. Idempotent
  // on a re-run that finds nothing to delete.
  return await httpJson('DELETE', `${API}/api/agents/actions/${agentId}/${actionId}`, { token });
}

function rowToMongoose(row) {
  if (!row) return row;
  return {
    id: row.id,
    agentType: row.agent_type,
    sectionKey: row.section_key,
    ordinal: row.ordinal,
    headerText: row.header_text,
    body: row.body,
    active: row.active,
    isDraft: row.is_draft,
    parentVersionId: row.parent_version_id,
    changeNote: row.change_note,
    createdAt: row.created_at,
    createdBy: row.created_by,
    publishedAt: row.published_at,
  };
}

async function instructionsText() {
  try {
    const rows = await aurora.listSections('unified');
    if (!rows || rows.length === 0) {
      throw new Error(
        'No sections in agent_prompts for agent_type=unified. ' +
        'Aurora must be seeded before running seed-botnim-agent.js. ' +
        'Use the LibreChat admin UI at /admin/prompts to create sections, ' +
        'or ensure agent_prompts table is populated.',
      );
    }
    const sections = rows.map(rowToMongoose);
    return AdminPrompts.assemble(sections);
  } catch (err) {
    if (/Aurora.*requires DB_HOST/i.test(err.message) || /no sections/i.test(err.message)) {
      throw err;
    }
    // Re-throw any connection or query errors
    throw new Error(`Failed to read instructions from Aurora: ${err.message}`);
  }
}

function loadOpenApiSpecs() {
  const dir = path.join(SPECS_DIR, 'openapi');
  if (!fs.existsSync(dir)) {
    throw new Error(`OpenAPI directory not found at ${dir}`);
  }
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
  if (!files.length) throw new Error(`no .yaml files in ${dir}`);
  const botnimOverride = process.env.SEED_BOTNIM_API_BASE;
  // OpenAPI specs whose `servers[0].url` points at the botnim-api
  // backend and must be rewritten per env. budgetkey + takanon point
  // at external services and are intentionally NOT in this list.
  const BOTNIM_OWNED_SPECS = new Set(['botnim', 'generate_word_doc', 'knesset_sessions_live']);
  const raw = files.map((f) => {
    let body = fs.readFileSync(path.join(dir, f), 'utf8');
    const name = path.basename(f, path.extname(f));
    if (BOTNIM_OWNED_SPECS.has(name) && botnimOverride) {
      const parsed = yaml.load(body);
      if (parsed?.servers?.length) {
        parsed.servers[0].url = botnimOverride;
        body = JSON.stringify(parsed, null, 2);
        console.log(`[seed] ${name} spec server rewritten → ${botnimOverride}`);
      }
    }
    return { name, raw: body, path: path.join(dir, f) };
  });
  return mergeSameDomainSpecs(raw);
}

// LibreChat's `POST /api/agents/actions/:agent_id` removes ALL existing
// agent.tools whose name contains the action's encodedDomain BEFORE
// concatenating the new functions (api/server/routes/agents/actions.js
// lines ~173-184). Several of our specs (`botnim`, `generate_word_doc`,
// `knesset_sessions_live`) all target the SEED_BOTNIM_API_BASE host, so
// registering them as separate actions makes each one wipe out the
// previous's retrieval functions. The fix is to merge same-server-url
// specs into a single OpenAPI document before registering, so they go
// up as ONE action with the union of their paths.
function mergeSameDomainSpecs(specs) {
  const byServerUrl = new Map();
  const ordered = [];
  for (const s of specs) {
    let serverUrl = '';
    try {
      const parsed = yaml.load(s.raw);
      serverUrl = parsed?.servers?.[0]?.url || '';
    } catch (_) {
      serverUrl = '';
    }
    if (!serverUrl) {
      ordered.push(s);
      continue;
    }
    if (byServerUrl.has(serverUrl)) {
      const target = byServerUrl.get(serverUrl);
      const targetParsed = JSON.parse(target.raw);
      const sourceParsed = yaml.load(s.raw);
      targetParsed.paths = { ...(targetParsed.paths || {}), ...(sourceParsed.paths || {}) };
      const targetSchemas = (targetParsed.components && targetParsed.components.schemas) || {};
      const sourceSchemas = (sourceParsed.components && sourceParsed.components.schemas) || {};
      const mergedSchemas = { ...targetSchemas, ...sourceSchemas };
      if (Object.keys(mergedSchemas).length > 0) {
        targetParsed.components = { ...(targetParsed.components || {}), schemas: mergedSchemas };
      }
      target.raw = JSON.stringify(targetParsed, null, 2);
      target.name = `${target.name}+${s.name}`;
      console.log(`[seed] merged spec ${s.name} into ${target.name.split('+')[0]} (same server ${serverUrl})`);
      continue;
    }
    const cloned = { ...s, raw: JSON.stringify(yaml.load(s.raw), null, 2) };
    byServerUrl.set(serverUrl, cloned);
    ordered.push(cloned);
  }
  return ordered;
}

function parseSpecServerUrl(rawSpec) {
  const parsed = yaml.load(rawSpec);
  const url = parsed?.servers?.[0]?.url;
  if (!url) throw new Error('OpenAPI spec has no servers[0].url');
  return url;
}

async function ensureAgent(token, existing) {
  const instructions = await instructionsText();
  if (existing) {
    console.log(`[seed] reusing existing agent ${existing.id} ("${existing.name}")`);
    const updated = await httpJson('PATCH', `${API}/api/agents/${existing.id}`, {
      token,
      body: {
        name: AGENT_NAME,
        instructions,
        model: MODEL,
        provider: 'openAI',
      },
    });
    return updated;
  }
  console.log(`[seed] creating agent "${AGENT_NAME}" model=${MODEL}`);
  return await httpJson('POST', `${API}/api/agents`, {
    token,
    body: {
      name: AGENT_NAME,
      provider: 'openAI',
      model: MODEL,
      instructions,
      description:
        'עונה על שאלות מתוך תקנון הכנסת וחוקים נלווים וכן על שאלות בנושאי תקציב',
    },
  });
}

async function upsertAction(token, agentId, spec) {
  const validation = validateAndParseOpenAPISpec(spec.raw);
  if (!validation.status) {
    throw new Error(`OpenAPI spec ${spec.name} invalid: ${validation.message}`);
  }
  const { functionSignatures } = openapiToFunction(validation.spec);
  if (!functionSignatures?.length) {
    throw new Error(`OpenAPI spec ${spec.name} yielded no functions`);
  }
  const functions = functionSignatures.map((fn) => ({
    type: 'function',
    function: fn,
  }));
  const serverUrl = parseSpecServerUrl(spec.raw);
  // LibreChat's validateActionDomain compares the client-provided
  // domain against the spec server URL. For http:// specs we need
  // to pass the full `protocol://hostname` (no port) — otherwise it
  // defaults clientDomain's protocol to https:// and fails the match.
  const u = new URL(serverUrl);
  const domain = `${u.protocol}//${u.hostname}`;
  const metadata = {
    raw_spec: spec.raw,
    domain,
    auth: { type: 'none' },
    privacy_policy_url: '',
  };
  console.log(`[seed] action ${spec.name}: ${functions.length} functions, domain=${domain}`);
  return await httpJson('POST', `${API}/api/agents/actions/${agentId}`, {
    token,
    body: { functions, metadata },
  });
}

// Share the agent globally by linking it to LibreChat's `instance` project
// (Constants.GLOBAL_PROJECT_NAME). Agents in that project are visible to
// every authenticated user — both existing and any future signups —
// without per-user grants.
//
// Idempotent: $addToSet on both sides means re-runs are no-ops once the
// link is in place. Direct Mongo update because LibreChat does not expose
// a /api/projects route, so we can't do this via HTTP.
async function shareAgentWithGlobalProject(agentId) {
  const db = mongoose.connection.db;
  const project = await db.collection('projects').findOne({ name: 'instance' });
  if (!project) {
    console.warn('[seed] no `instance` project found — skipping global share');
    return;
  }
  const agent = await db.collection('agents').findOne({ id: agentId });
  if (!agent) {
    throw new Error(`agent ${agentId} not found in DB`);
  }
  const projectUpdate = await db.collection('projects').updateOne(
    { _id: project._id },
    { $addToSet: { agentIds: agent.id } },
  );
  const agentUpdate = await db.collection('agents').updateOne(
    { _id: agent._id },
    { $addToSet: { projectIds: project._id } },
  );
  console.log(
    `[seed] global share: project_modified=${projectUpdate.modifiedCount} ` +
      `agent_modified=${agentUpdate.modifiedCount} (0 means already linked)`,
  );
}

// Upsert the "<canonical name> — DRAFT" mirror Agent doc. The mirror
// shares provider/model/model_parameters/actions/tools with the canonical
// agent; its `instructions` reflect the latest draft-or-active joined
// prompt.
//
// On a fresh stack with no in-flight drafts the mirror's instructions
// equal the canonical's instructions. The doc is upserted by name so
// re-running the seed never produces duplicates.
async function ensureDraftAgentMirror() {
  const { Agent } = require('~/db/models');
  const { instructions } = await draftAgentService.composeDraftPayload(AGENT_BOT);
  const draft = await draftAgentService.ensureDraftAgent({
    bot: AGENT_BOT,
    instructions,
    Agent,
  });
  console.log(
    `[seed] draft mirror: id=${draft.id} name="${draft.name}" ` +
      `tools=${(draft.tools || []).length}`,
  );
}

async function withMongoConnection(fn) {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    console.warn('[seed] MONGO_URI not set — skipping Mongo-dependent steps');
    return;
  }
  await mongoose.connect(mongoUri);
  try {
    await fn();
  } finally {
    await mongoose.disconnect();
  }
}

async function main() {
  console.log(`[seed] login ${EMAIL} → ${API}`);
  const token = await login();
  console.log(`[seed] ok`);

  const agents = await listAgents(token);
  const existing = agents.find((a) => a.name === AGENT_NAME);
  const agent = await ensureAgent(token, existing);
  console.log(`[seed] agent id=${agent.id}`);

  // Wipe pre-existing actions before re-creating. POST /api/agents/actions
  // is append-only — it creates a NEW action doc each call and pushes a new
  // entry onto agent.actions/agent.tools. Without this cleanup, every deploy
  // adds 21 (17+3+1) duplicate function entries; after ~6 deploys we cross
  // the 128-tool limit OpenAI's Responses API enforces and the bot 400s on
  // every chat. We delete-then-create on every seed run so the agent ends
  // each deploy with exactly N_actions × N_functions tools.
  let existingActions = [];
  try {
    existingActions = await listAgentActions(token, agent.id);
  } catch (err) {
    console.error(`[seed] listAgentActions FAILED (continuing without cleanup): ${err.message}`);
  }
  if (existingActions.length > 0) {
    console.log(`[seed] deleting ${existingActions.length} pre-existing action(s) before re-create`);
    for (const action of existingActions) {
      try {
        await deleteAgentAction(token, agent.id, action.action_id);
      } catch (err) {
        console.error(
          `[seed] deleteAgentAction(${action.action_id}) FAILED (continuing): ${err.message}`,
        );
      }
    }
  }

  const specs = loadOpenApiSpecs();
  console.log(`[seed] found ${specs.length} OpenAPI spec(s): ${specs.map((s) => s.name).join(', ')}`);

  for (const spec of specs) {
    try {
      await upsertAction(token, agent.id, spec);
    } catch (err) {
      console.error(`[seed] action ${spec.name} FAILED: ${err.message}`);
      process.exitCode = 1;
    }
  }

  await withMongoConnection(async () => {
    try {
      await shareAgentWithGlobalProject(agent.id);
    } catch (err) {
      console.error(`[seed] global share FAILED: ${err.message}`);
      process.exitCode = 1;
    }
    try {
      await ensureDraftAgentMirror();
    } catch (err) {
      console.error(`[seed] draft mirror FAILED: ${err.message}`);
      process.exitCode = 1;
    }
  });

  console.log(`[seed] done.`);
}

main()
  .then(() => {
    // Explicit exit so the process doesn't hang on open Mongoose / fetch
    // keep-alive sockets after `[seed] done.`. Without this, ECS waits
    // the full 10-min stop budget on a successful seed, blocking
    // deploy.sh phase 9 (manifested 2026-05-10 as
    // "Waiter TasksStopped failed: Max attempts exceeded" even though
    // `[seed] done.` had been logged).
    // Exit code respects any process.exitCode set by partial failures
    // inside main() (e.g., draft mirror failure).
    process.exit(process.exitCode ?? 0);
  })
  .catch((err) => {
    console.error(`[seed] FATAL: ${err.message}`);
    if (err.body) console.error(JSON.stringify(err.body, null, 2));
    process.exit(1);
  });
