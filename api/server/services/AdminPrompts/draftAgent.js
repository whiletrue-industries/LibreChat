'use strict';

// Draft-Agent mirror service (UPE Task 7, spec §5.4).
//
// Maintains a single "<canonical name> — DRAFT" Mongo Agent doc per bot
// that admins can chat with via /c/new?agent_id=<draftId>. The draft mirror
// inherits provider/model/model_parameters/actions from the canonical agent,
// but its `instructions` reflect the in-flight joined-draft text and its
// `tool_overrides` map carries draft-or-active description overrides keyed by
// tool name.
//
// Idempotent: ensureDraftAgent is an upsert. Re-saving any draft section just
// updates the same draft Agent doc; no new Agent records are ever spawned.

const crypto = require('node:crypto');

const aurora = require('~/server/services/AdminPrompts/aurora');
const { fetchCanonicalTools } = require('~/server/services/AdminPrompts/canonicalTools');
const { AdminPrompts } = require('@librechat/api');
const { logger } = require('@librechat/data-schemas');

const DRAFT_NAME_SUFFIX = ' — DRAFT';

// Resolve the canonical agent name for a bot. Mirrors seed-botnim-agent.js's
// SEED_AGENT_NAME default so a fresh deploy lands canonical + draft under
// the same family of names.
function canonicalAgentNameFor(bot) {
  if (bot === 'unified') {
    return process.env.SEED_AGENT_NAME || 'בוט מאוחד - תקנון, חוקים ותקציב';
  }
  throw new Error(`canonicalAgentNameFor: unsupported bot "${bot}"`);
}

function draftAgentNameFor(bot) {
  return `${canonicalAgentNameFor(bot)}${DRAFT_NAME_SUFFIX}`;
}

function generateAgentId() {
  return `agent_${crypto.randomBytes(16).toString('hex')}`;
}

function rowToAssembleSection(row) {
  return {
    sectionKey: row.section_key,
    ordinal: row.ordinal,
    headerText: row.header_text,
    body: row.body,
  };
}

// Build the would-be-joined draft instructions + tool override map by reading
// the latest draft-or-active state for the bot. Used by ensureDraftAgent and
// exported separately for tests / future hooks that want the payload alone.
async function composeDraftPayload(bot) {
  const sections = await aurora.listLatestDraftOrActiveSections(bot);
  const instructions = AdminPrompts.assemble(sections.map(rowToAssembleSection));

  let canonicalTools = {};
  try {
    canonicalTools = await fetchCanonicalTools(bot);
  } catch (err) {
    logger.warn('[draftAgent] fetchCanonicalTools failed; using empty canonical map', err);
  }
  const toolOverrides = await aurora.listLatestDraftOrActiveToolDescriptions(bot, canonicalTools);
  const tools = Object.keys(toolOverrides);
  return { instructions, tools, toolOverrides };
}

// Upsert the draft Agent doc for `bot`. Returns the updated/created doc.
//
// Lookup order for the canonical sibling:
//   1. Mongo Agent.findOne({ name: canonicalAgentNameFor(bot) })
//   2. None → throw (caller has no canonical to mirror; deploy must seed first)
//
// Side-effect free if `instructions` and `tools`/`toolOverrides` match what is
// already on the doc — Mongo upsert is a write either way, but the data is
// equivalent.
async function ensureDraftAgent({ bot, instructions, tools, toolOverrides, Agent }) {
  if (!Agent) {
    Agent = require('~/db/models').Agent;
  }
  const canonicalName = canonicalAgentNameFor(bot);
  const draftName = draftAgentNameFor(bot);

  const canonical = await Agent.findOne({ name: canonicalName }).lean();
  if (!canonical) {
    throw new Error(
      `draftAgent: canonical agent not found for bot=${bot} (name="${canonicalName}"); ` +
      'run seed-botnim-agent.js first',
    );
  }

  const update = {
    name: draftName,
    description: canonical.description,
    instructions,
    provider: canonical.provider,
    model: canonical.model,
    model_parameters: canonical.model_parameters,
    tools: tools || [],
    tool_overrides: toolOverrides || {},
    actions: canonical.actions,
    author: canonical.author,
    authorName: canonical.authorName,
    avatar: canonical.avatar,
    category: canonical.category || 'general',
    draft: true,
  };

  const existing = await Agent.findOne({ name: draftName });
  if (existing) {
    Object.assign(existing, update);
    existing.markModified('tool_overrides');
    existing.markModified('model_parameters');
    await existing.save();
    return existing.toObject();
  }
  const created = await Agent.create({
    id: generateAgentId(),
    ...update,
  });
  return created.toObject();
}

// Convenience wrapper used by the prompt + tool-override save hooks. Computes
// the joined-draft payload and upserts the draft mirror in one call. Errors
// are logged and swallowed so a save-draft API call never fails on draft-Agent
// mirror trouble — the in-flight Aurora row is already persisted.
async function refreshDraftAgentForBot(bot) {
  try {
    const payload = await composeDraftPayload(bot);
    return await ensureDraftAgent({
      bot,
      instructions: payload.instructions,
      tools: payload.tools,
      toolOverrides: payload.toolOverrides,
    });
  } catch (err) {
    logger.warn('[draftAgent] refreshDraftAgentForBot failed', err);
    return null;
  }
}

module.exports = {
  ensureDraftAgent,
  composeDraftPayload,
  refreshDraftAgentForBot,
  canonicalAgentNameFor,
  draftAgentNameFor,
};
