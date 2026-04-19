const { AdminPrompts } = require('@librechat/api');
const { logger } = require('@librechat/data-schemas');
const { AgentPrompt, AgentPromptTestQuestion } = require('~/db/models');
const { patchLibreChatAgent } = require('~/server/services/prompts/agentPatcher');

const PREVIEW_TIMEOUT_MS = 90_000;

function patchAgentForPublish(agentsClient) {
  return async (agentType, instructions) => {
    await patchLibreChatAgent(agentsClient, agentType, instructions);
  };
}

async function listAgents(req, res) {
  try {
    const agents = ['unified', 'takanon', 'budgetkey'];
    const counts = await Promise.all(
      agents.map((a) =>
        AgentPrompt.countDocuments({ agentType: a, active: true }).then((c) => ({
          agentType: a,
          activeSections: c,
        })),
      ),
    );
    res.status(200).json({ agents: counts });
  } catch (err) {
    logger.error('[admin/prompts] listAgents failed', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function listSections(req, res) {
  try {
    const sections = await AdminPrompts.getActiveSections({
      AgentPrompt,
      agentType: req.params.agent,
    });
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
    res.status(200).json({ sections: withDrafts });
  } catch (err) {
    logger.error('[admin/prompts] listSections failed', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function listVersions(req, res) {
  try {
    const versions = await AdminPrompts.getSectionHistory({
      AgentPrompt,
      agentType: req.params.agent,
      sectionKey: req.params.key,
    });
    res.status(200).json({ versions });
  } catch (err) {
    logger.error('[admin/prompts] listVersions failed', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function saveDraft(req, res) {
  try {
    const { body, changeNote } = req.body;
    const row = await AdminPrompts.saveDraft({
      AgentPrompt,
      agentType: req.params.agent,
      sectionKey: req.params.key,
      body,
      changeNote,
      createdBy: req.user.id,
    });
    res.status(201).json({ draft: row });
  } catch (err) {
    logger.error('[admin/prompts] saveDraft failed', err);
    const code = /no active section/i.test(err.message) ? 404 : 500;
    res.status(code).json({ error: err.message });
  }
}

async function publish(req, res) {
  try {
    const { parentVersionId, body, changeNote } = req.body;
    if (!changeNote) {
      return res.status(400).json({ error: 'changeNote required on publish' });
    }
    const row = await AdminPrompts.publish({
      AgentPrompt,
      patchAgent: patchAgentForPublish(req.app.locals.agentsClient),
      agentType: req.params.agent,
      sectionKey: req.params.key,
      parentVersionId,
      body,
      changeNote,
      createdBy: req.user.id,
    });
    res.status(200).json({ active: row });
  } catch (err) {
    if (err.name === 'ConcurrencyError') {
      const current = await AgentPrompt.findOne({
        agentType: req.params.agent,
        sectionKey: req.params.key,
        active: true,
      }).lean();
      return res.status(409).json({ error: 'stale parent', current });
    }
    logger.error('[admin/prompts] publish failed', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function preview(req, res) {
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
    const out = await AdminPrompts.runPreview({
      client: req.app.locals.agentsClient,
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
  try {
    const row = await AdminPrompts.restore({
      AgentPrompt,
      patchAgent: patchAgentForPublish(req.app.locals.agentsClient),
      agentType: req.params.agent,
      sectionKey: req.params.key,
      versionId: req.body.versionId,
      createdBy: req.user.id,
    });
    res.status(200).json({ active: row });
  } catch (err) {
    logger.error('[admin/prompts] restore failed', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function getTestQuestions(req, res) {
  try {
    const questions = await AgentPromptTestQuestion.find({
      agentType: req.params.agent,
    })
      .sort({ ordinal: 1 })
      .lean();
    res.status(200).json({ questions });
  } catch (err) {
    logger.error('[admin/prompts] getTestQuestions failed', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function putTestQuestions(req, res) {
  try {
    await AgentPromptTestQuestion.deleteMany({ agentType: req.params.agent });
    if (req.body.questions.length > 0) {
      await AgentPromptTestQuestion.insertMany(
        req.body.questions.map((q, i) => ({
          agentType: req.params.agent,
          text: q.text,
          ordinal: i,
          enabled: q.enabled ?? true,
          createdBy: req.user.id,
        })),
      );
    }
    res.status(200).json({ ok: true });
  } catch (err) {
    logger.error('[admin/prompts] putTestQuestions failed', err);
    res.status(500).json({ error: 'Internal server error' });
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
};
