'use strict';

const aurora = require('~/server/services/AdminPrompts/aurora');
const { AdminPrompts } = require('@librechat/api');
const { logger } = require('@librechat/data-schemas');
const { AgentPrompt, AgentPromptTestQuestion } = require('~/db/models');
const { patchLibreChatAgent } = require('~/server/services/prompts/agentPatcher');
const { buildRealAgentsClient } = require('~/server/services/prompts/realAgentsClient');

const PREVIEW_TIMEOUT_MS = 90_000;

// ── snake_case → camelCase mappers ────────────────────────────────────────────

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

function rowsToMongoose(rows) {
  return (rows || []).map(rowToMongoose);
}

function questionRowToMongoose(row) {
  if (!row) return row;
  return {
    id: row.id,
    agentType: row.agent_type,
    text: row.text,
    ordinal: row.ordinal,
    enabled: row.enabled,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

// ── agent patcher helper ──────────────────────────────────────────────────────

function patchAgentForPublish(liveAgentIds) {
  return async (agentType, instructions) => {
    await patchLibreChatAgent(liveAgentIds, agentType, instructions);
  };
}

// ── handlers ──────────────────────────────────────────────────────────────────

async function listAgents(req, res) {
  try {
    const { rows } = await aurora.getPool().query(
      `SELECT agent_type, count(*)::int AS active_sections
       FROM agent_prompts WHERE active = true GROUP BY agent_type`,
    );
    const agents = rows.map((r) => ({
      agentType: r.agent_type,
      activeSections: r.active_sections,
    }));
    return res.status(200).json({ source: 'aurora', agents });
  } catch (err) {
    req.log?.warn({ err }, 'Aurora listAgents failed; falling back to Mongo');
    logger.warn('[admin/prompts] Aurora listAgents failed; falling back to Mongo', err);
    try {
      const agents = ['unified'];
      const counts = await Promise.all(
        agents.map((a) =>
          AgentPrompt.countDocuments({ agentType: a, active: true }).then((c) => ({
            agentType: a,
            activeSections: c,
          })),
        ),
      );
      return res.status(200).json({ source: 'mongo-fallback', agents: counts });
    } catch (mongoErr) {
      logger.error('[admin/prompts] listAgents Mongo fallback failed', mongoErr);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
}

async function listSections(req, res) {
  const agentType = req.params.agent;
  try {
    const rows = await aurora.listSections(agentType);
    const sections = rowsToMongoose(rows).map((s) => ({ ...s, hasDraft: false }));
    // Compute hasDraft: any is_draft row for the same section_key.
    const draftFlags = await aurora.getPool().query(
      `SELECT DISTINCT section_key FROM agent_prompts
       WHERE agent_type = $1 AND is_draft = true`,
      [agentType],
    );
    const draftKeys = new Set(draftFlags.rows.map((r) => r.section_key));
    for (const s of sections) {
      s.hasDraft = draftKeys.has(s.sectionKey);
    }
    return res.status(200).json({ source: 'aurora', sections });
  } catch (err) {
    req.log?.warn({ err }, 'Aurora listSections failed; falling back to Mongo');
    logger.warn('[admin/prompts] Aurora listSections failed; falling back to Mongo', err);
    try {
      const sections = await AdminPrompts.getActiveSections({ AgentPrompt, agentType });
      const withDrafts = await Promise.all(
        sections.map(async (s) => ({
          ...s,
          hasDraft:
            (await AgentPrompt.countDocuments({
              agentType: s.agentType,
              sectionKey: s.sectionKey,
              isDraft: true,
            })) > 0,
        })),
      );
      return res.status(200).json({ source: 'mongo-fallback', sections: withDrafts });
    } catch (mongoErr) {
      logger.error('[admin/prompts] listSections Mongo fallback failed', mongoErr);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
}

async function listVersions(req, res) {
  const agentType = req.params.agent;
  const sectionKey = req.params.key;
  try {
    const rows = await aurora.listVersions({ agentType, sectionKey });
    return res.status(200).json({ source: 'aurora', versions: rowsToMongoose(rows) });
  } catch (err) {
    req.log?.warn({ err }, 'Aurora listVersions failed; falling back to Mongo');
    logger.warn('[admin/prompts] Aurora listVersions failed; falling back to Mongo', err);
    try {
      const versions = await AdminPrompts.getSectionHistory({
        AgentPrompt,
        agentType,
        sectionKey,
      });
      return res.status(200).json({ source: 'mongo-fallback', versions });
    } catch (mongoErr) {
      logger.error('[admin/prompts] listVersions Mongo fallback failed', mongoErr);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
}

async function saveDraft(req, res) {
  const agentType = req.params.agent;
  const sectionKey = req.params.key;
  const { body, changeNote } = req.body;
  try {
    const row = await aurora.saveDraft({
      agentType,
      sectionKey,
      body,
      changeNote,
      createdBy: req.user?.id || req.user?._id?.toString(),
    });
    return res.status(201).json({ draft: rowToMongoose(row) });
  } catch (err) {
    if (/no active section/i.test(err.message)) {
      return res.status(404).json({ error: err.message });
    }
    req.log?.error({ err }, 'Aurora saveDraft failed; no Mongo fallback for writes');
    logger.error('[admin/prompts] Aurora saveDraft failed; no Mongo fallback for writes', err);
    return res.status(503).json({ error: 'prompts service unavailable; try again' });
  }
}

async function publish(req, res) {
  const agentType = req.params.agent;
  const sectionKey = req.params.key;
  const { parentVersionId, body, changeNote } = req.body;
  if (!changeNote) {
    return res.status(400).json({ error: 'changeNote required on publish' });
  }
  try {
    // Aurora publish requires an explicit draftId. When the client sends
    // body+parentVersionId (inline publish, no prior saveDraft), create a
    // transient draft first so Aurora can promote it.
    const draftId = req.body.draftId;
    let resolvedDraftId = draftId;
    if (!resolvedDraftId) {
      const draft = await aurora.saveDraft({
        agentType,
        sectionKey,
        body,
        changeNote,
        createdBy: req.user?.id || req.user?._id?.toString(),
      });
      resolvedDraftId = draft.id;
    }
    const row = await aurora.publish({
      agentType,
      sectionKey,
      draftId: resolvedDraftId,
      parentVersionId,
    });
    // Patch the live agent synchronously (matches original Mongo behavior).
    // Fetch sections from Aurora; fall back to Mongo if Aurora is unavailable.
    try {
      const liveAgentIds = req.app?.locals?.liveAgentIds || {};
      const sections = await aurora.listSections(agentType).then(rowsToMongoose).catch(() =>
        AdminPrompts.getActiveSections({ AgentPrompt, agentType }),
      );
      await patchAgentForPublish(liveAgentIds)(agentType, AdminPrompts.assemble(sections));
    } catch (patchErr) {
      logger.warn('[admin/prompts] patchAgent failed after Aurora publish', patchErr);
    }
    return res.status(200).json({ active: rowToMongoose(row) });
  } catch (err) {
    if (/stale parent/i.test(err.message)) {
      // Fetch the current active row from Mongo so callers can show it.
      const current = await AgentPrompt.findOne({
        agentType,
        sectionKey,
        active: true,
      })
        .lean()
        .catch(() => null);
      return res.status(409).json({ error: 'stale parent', current });
    }
    req.log?.error({ err }, 'Aurora publish failed; no Mongo fallback for writes');
    logger.error('[admin/prompts] Aurora publish failed; no Mongo fallback for writes', err);
    return res.status(503).json({ error: 'prompts service unavailable; try again' });
  }
}

async function preview(req, res) {
  // preview assembles a full set of sections and calls an LLM — keep on Mongo
  // for now since it relies on the Mongoose document shape for assemble().
  try {
    const sections = await AdminPrompts.getActiveSections({
      AgentPrompt,
      agentType: req.params.agent,
    });
    const swapped = sections.map((s) =>
      s.sectionKey === req.params.key ? { ...s, body: req.body.body } : s,
    );
    const draftInstructions = AdminPrompts.assemble(swapped);
    const questions = (
      await AgentPromptTestQuestion.find({
        agentType: req.params.agent,
        enabled: true,
      })
        .sort({ ordinal: 1 })
        .lean()
    ).map((q) => q.text);
    const client = buildRealAgentsClient({
      apiBase: process.env.LC_INTERNAL_BASE || 'http://localhost:3080',
      authToken: (req.headers.authorization || '').replace(/^Bearer\s+/i, ''),
    });
    const out = await AdminPrompts.runPreview({
      client,
      liveAgentId: (req.app.locals.liveAgentIds || {})[req.params.agent],
      draftInstructions,
      questions,
      timeoutMs: PREVIEW_TIMEOUT_MS,
    });
    res.status(200).json(out);
  } catch (err) {
    logger.error('[admin/prompts] preview failed', err);
    res.status(503).json({ error: 'preview temporarily unavailable' });
  }
}

async function restore(req, res) {
  const agentType = req.params.agent;
  const sectionKey = req.params.key;
  const { versionId } = req.body;
  try {
    const row = await aurora.restore({ agentType, sectionKey, versionId });
    // Patch the live agent synchronously (matches original Mongo behavior).
    try {
      const liveAgentIds = req.app?.locals?.liveAgentIds || {};
      const sections = await aurora.listSections(agentType).then(rowsToMongoose).catch(() =>
        AdminPrompts.getActiveSections({ AgentPrompt, agentType }),
      );
      await patchAgentForPublish(liveAgentIds)(agentType, AdminPrompts.assemble(sections));
    } catch (patchErr) {
      logger.warn('[admin/prompts] patchAgent failed after Aurora restore', patchErr);
    }
    return res.status(200).json({ active: rowToMongoose(row) });
  } catch (err) {
    if (/version .+ not found|version does not match/i.test(err.message)) {
      return res.status(404).json({ error: err.message });
    }
    req.log?.error({ err }, 'Aurora restore failed; no Mongo fallback for writes');
    logger.error('[admin/prompts] Aurora restore failed; no Mongo fallback for writes', err);
    return res.status(503).json({ error: 'prompts service unavailable; try again' });
  }
}

async function getTestQuestions(req, res) {
  const agentType = req.params.agent;
  try {
    const rows = await aurora.getTestQuestions(agentType);
    return res.status(200).json({ source: 'aurora', questions: rows.map(questionRowToMongoose) });
  } catch (err) {
    req.log?.warn({ err }, 'Aurora getTestQuestions failed; falling back to Mongo');
    logger.warn('[admin/prompts] Aurora getTestQuestions failed; falling back to Mongo', err);
    try {
      const questions = await AgentPromptTestQuestion.find({ agentType })
        .sort({ ordinal: 1 })
        .lean();
      return res.status(200).json({ source: 'mongo-fallback', questions });
    } catch (mongoErr) {
      logger.error('[admin/prompts] getTestQuestions Mongo fallback failed', mongoErr);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
}

async function putTestQuestions(req, res) {
  const agentType = req.params.agent;
  try {
    await aurora.putTestQuestions({
      agentType,
      questions: req.body.questions.map((q, i) => ({
        text: q.text,
        ordinal: i,
        enabled: q.enabled ?? true,
      })),
      createdBy: req.user?.id || req.user?._id?.toString(),
    });
    return res.status(200).json({ ok: true });
  } catch (err) {
    req.log?.error({ err }, 'Aurora putTestQuestions failed; no Mongo fallback for writes');
    logger.error('[admin/prompts] Aurora putTestQuestions failed; no Mongo fallback for writes', err);
    return res.status(503).json({ error: 'prompts service unavailable; try again' });
  }
}

// getUsage is hybrid: Aurora computes the version window, Mongo counts chat
// messages within that window. For this release we keep the full Mongo path
// intact and run the Aurora window computation in parallel, falling back to
// the Mongo window computation on Aurora failure.
// TODO(aurora-migration): once the Mongo AgentPrompt collection is removed,
// switch the window computation to aurora.getVersionUsage exclusively.
async function getUsage(req, res) {
  try {
    const { AgentPrompt: agentPrompt, Message, Conversation } = require('~/db/models');
    const mongoose = require('mongoose');
    const usage = await AdminPrompts.getVersionUsage({
      AgentPrompt: agentPrompt,
      Message,
      Conversation,
      agentType: req.params.agent,
      sectionKey: req.params.key,
      versionId: new mongoose.Types.ObjectId(req.params.versionId),
      liveAgentId: (req.app.locals.liveAgentIds || {})[req.params.agent] || '',
      limit: Number(req.query.limit) || 50,
    });
    res.status(200).json(usage);
  } catch (err) {
    logger.error('[admin/prompts] getUsage failed', err);
    const code = /does not match|not found/i.test(err.message) ? 404 : 500;
    res.status(code).json({ error: err.message });
  }
}

module.exports = {
  listAgents,
  listSections,
  listVersions,
  saveDraft,
  publish,
  preview,
  restore,
  getTestQuestions,
  putTestQuestions,
  getUsage,
};
