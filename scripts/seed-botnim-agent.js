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
 *   SEED_MODEL          (default gpt-5.4-mini)
 *   SEED_SPECS_DIR      (default /srv/specs)
 *   DATABASE_URL        — Aurora connection (required unless DB_HOST/etc are set)
 *   DB_HOST             — Aurora host (use with DB_USER, DB_PASSWORD, DB_PORT, DB_NAME)
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const { openapiToFunction, validateAndParseOpenAPISpec } =
  require('librechat-data-provider');
const aurora = require(path.resolve(__dirname, '..', 'api', 'server', 'services', 'AdminPrompts', 'aurora'));
const { AdminPrompts } = require('@librechat/api');

const EMAIL = process.env.SEED_ADMIN_EMAIL || 'admin@botnim.local';
const PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'admin123';
const API = process.env.SEED_API_BASE || 'http://localhost:3080';
const AGENT_NAME = process.env.SEED_AGENT_NAME ||
  'בוט מאוחד - תקנון, חוקים ותקציב';
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
  return files.map((f) => {
    let raw = fs.readFileSync(path.join(dir, f), 'utf8');
    const name = path.basename(f, path.extname(f));
    // Rewrite the botnim.yaml server URL for local docker testing:
    // the shipped spec points at staging.botnim.co.il; locally we want
    // the in-compose botnim_api service.
    if (name === 'botnim' && botnimOverride) {
      const parsed = yaml.load(raw);
      if (parsed?.servers?.length) {
        parsed.servers[0].url = botnimOverride;
        raw = JSON.stringify(parsed, null, 2);
        console.log(`[seed] botnim spec server rewritten → ${botnimOverride}`);
      }
    }
    return { name, raw, path: path.join(dir, f) };
  });
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

async function main() {
  console.log(`[seed] login ${EMAIL} → ${API}`);
  const token = await login();
  console.log(`[seed] ok`);

  const agents = await listAgents(token);
  const existing = agents.find((a) => a.name === AGENT_NAME);
  const agent = await ensureAgent(token, existing);
  console.log(`[seed] agent id=${agent.id}`);

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

  console.log(`[seed] done.`);
}

main().catch((err) => {
  console.error(`[seed] FATAL: ${err.message}`);
  if (err.body) console.error(JSON.stringify(err.body, null, 2));
  process.exit(1);
});
