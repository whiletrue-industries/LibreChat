'use strict';

// Draft-Agent mirror service.
//
// Maintains a single "<canonical name> — DRAFT" Mongo Agent doc per bot
// that admins can chat with via /c/new?agent_id=<draftId>. The draft mirror
// inherits provider/model/model_parameters/actions/tools verbatim from the
// canonical agent; only its `instructions` differ — they reflect the
// in-flight joined-draft text.
//
// Idempotent: ensureDraftAgent is an upsert. Re-saving any draft section just
// updates the same draft Agent doc; no new Agent records are ever spawned.

const crypto = require('node:crypto');

const aurora = require('~/server/services/AdminPrompts/aurora');
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

// Build the would-be-joined draft instructions by reading the latest
// draft-or-active state for the bot. Used by ensureDraftAgent and exported
// separately for tests / future hooks that want the payload alone.
async function composeDraftPayload(bot) {
  const sections = await aurora.listLatestDraftOrActiveSections(bot);
  const instructions = AdminPrompts.assemble(sections.map(rowToAssembleSection));
  return { instructions };
}

// Upsert the draft Agent doc for `bot`. Returns the updated/created doc.
//
// Lookup order for the canonical sibling:
//   1. Mongo Agent.findOne({ name: canonicalAgentNameFor(bot) })
//   2. None → throw (caller has no canonical to mirror; deploy must seed first)
//
// Side-effect free if `instructions` matches what is already on the doc —
// Mongo upsert is a write either way, but the data is equivalent.
async function ensureDraftAgent({ bot, instructions, Agent }) {
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

  // The DRAFT mirrors canonical verbatim except for `instructions` (in-flight
  // joined draft text). Tools/actions are taken straight from canonical so the
  // LLM sees exactly the same tool surface during draft chat.
  const update = {
    name: draftName,
    description: canonical.description,
    instructions,
    provider: canonical.provider,
    model: canonical.model,
    model_parameters: canonical.model_parameters,
    tools: canonical.tools || [],
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
    });
  } catch (err) {
    logger.warn('[draftAgent] refreshDraftAgentForBot failed', err);
    return null;
  }
}

// Lookup-only helper for the admin UI. Returns the draft agent's `id` if the
// mirror exists for `bot`, otherwise null. Never throws — callers should
// degrade gracefully when null (e.g. disable "Try draft" button).
async function getDraftAgentId(bot, Agent) {
  try {
    if (!Agent) {
      Agent = require('~/db/models').Agent;
    }
    const draftName = draftAgentNameFor(bot);
    const doc = await Agent.findOne({ name: draftName }).lean();
    return doc?.id || null;
  } catch (err) {
    logger.warn('[draftAgent] getDraftAgentId failed', err);
    return null;
  }
}

module.exports = {
  ensureDraftAgent,
  composeDraftPayload,
  refreshDraftAgentForBot,
  getDraftAgentId,
  canonicalAgentNameFor,
  draftAgentNameFor,
};
