/**
 * Integration test for /api/admin/prompts routes.
 *
 * Auth setup mirrors admin.feedback.spec.js — mongo-memory-server,
 * passport-jwt strategy, admin + user user seeds.
 *
 * Exercises the REAL AdminPrompts service (no mocking of the service),
 * using an in-memory MongoDB. The patchLibreChatAgent side-effect is stubbed
 * with a jest.fn() so the publish path can run without a real
 * shadow-agent backend.
 *
 * Aurora mock strategy
 * --------------------
 * The default mock (applied to the whole file) makes the aurora adapter
 * behave as follows for the existing Mongo-integration tests:
 *
 *   - Read methods (listSections, listVersions, getTestQuestions, getPool)
 *     → throw, so the controller falls back to Mongo.
 *
 *   - Write methods (saveDraft, publish, restore, putTestQuestions)
 *     → delegate to real Mongoose models (the same in-memory MongoDB), so
 *       the existing write-path assertions continue to pass unmodified.
 *
 * New Aurora-primary tests in the describe block at the bottom use
 * jest.doMock + jest.resetModules to swap in a lightweight stub that
 * returns fake PG row objects, exercising the controller's camelCase-mapping
 * and the 503 / 409 error branches without touching any database.
 */

const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const passport = require('passport');
const jwt = require('jsonwebtoken');
const { MongoMemoryServer } = require('mongodb-memory-server');

// Set JWT secrets before strategy is registered
process.env.JWT_SECRET = 'admin-prompts-test-secret';
process.env.JWT_REFRESH_SECRET = 'admin-prompts-refresh-secret';

// The controller now updates the live Agent via ~/models/Agent.updateAgent on
// publish. That module pulls in the full LibreChat agents stack which isn't
// needed (or importable) in this unit. Stub it to a spy so publish succeeds
// and the test can still assert the side effect was triggered.
const mockPatchLibreChatAgent = jest.fn().mockResolvedValue(undefined);
jest.mock('~/server/services/prompts/agentPatcher', () => ({
  patchLibreChatAgent: (...args) => mockPatchLibreChatAgent(...args),
}));

// ── Default aurora mock ───────────────────────────────────────────────────────
// Reads throw so the controller falls back to Mongo.
// Writes delegate to Mongoose so existing write-path tests stay green.

jest.mock('~/server/services/AdminPrompts/aurora', () => {
  const { AdminPrompts } = require('@librechat/api');
  const { AgentPrompt, AgentPromptTestQuestion } = require('~/db/models');

  // getPool throws so listAgents and the hasDraft query both fall back to Mongo.
  const getPool = () => {
    throw new Error('Aurora not configured in test');
  };

  // All read functions throw → controller falls back to Mongo.
  const listSections = () => Promise.reject(new Error('Aurora not configured in test'));
  const listVersions = () => Promise.reject(new Error('Aurora not configured in test'));
  const getTestQuestions = () => Promise.reject(new Error('Aurora not configured in test'));
  const getVersionUsage = () => Promise.reject(new Error('Aurora not configured in test'));

  // Write functions proxy to Mongoose so existing write tests pass.
  const saveDraft = async ({ agentType, sectionKey, body, changeNote, createdBy }) => {
    const mongoose_ = require('mongoose');
    const row = await AdminPrompts.saveDraft({
      AgentPrompt,
      agentType,
      sectionKey,
      body,
      changeNote,
      createdBy: createdBy ? new mongoose_.Types.ObjectId(createdBy) : undefined,
    });
    // Return a pg-row-shaped object so rowToMongoose works.
    return {
      id: row._id.toString(),
      agent_type: row.agentType,
      section_key: row.sectionKey,
      ordinal: row.ordinal,
      header_text: row.headerText,
      body: row.body,
      active: row.active,
      is_draft: row.isDraft,
      parent_version_id: row.parentVersionId ? row.parentVersionId.toString() : null,
      change_note: row.changeNote,
      created_at: row.createdAt,
      created_by: row.createdBy ? row.createdBy.toString() : null,
      published_at: row.publishedAt || null,
    };
  };

  const publish = async ({ agentType, sectionKey, draftId, parentVersionId }) => {
    // The controller passes us the draftId it created. We need to simulate
    // Aurora's behaviour: demote old active, promote draft, return new active.
    // Re-use the draft row that saveDraft already wrote, then activate it.
    const mongoose_ = require('mongoose');

    // Locate the current active row.
    const current = await AgentPrompt.findOne({ agentType, sectionKey, active: true }).lean();
    const parentId = parentVersionId
      ? parentVersionId.toString()
      : null;
    if (!current || current._id.toString() !== parentId) {
      throw new Error('stale parent: parentVersionId is no longer the active row');
    }
    // Demote old.
    await AgentPrompt.updateOne({ _id: current._id }, { $set: { active: false } });
    // Promote the draft.
    const draft = await AgentPrompt.findById(new mongoose_.Types.ObjectId(draftId));
    if (!draft) {
      throw new Error(`draft ${draftId} not found`);
    }
    draft.active = true;
    draft.isDraft = false;
    draft.publishedAt = new Date();
    await draft.save();
    const row = draft.toObject();
    return {
      id: row._id.toString(),
      agent_type: row.agentType,
      section_key: row.sectionKey,
      ordinal: row.ordinal,
      header_text: row.headerText,
      body: row.body,
      active: row.active,
      is_draft: row.isDraft,
      parent_version_id: row.parentVersionId ? row.parentVersionId.toString() : null,
      change_note: row.changeNote,
      created_at: row.createdAt,
      created_by: row.createdBy ? row.createdBy.toString() : null,
      published_at: row.publishedAt || null,
    };
  };

  const restore = async ({ agentType, sectionKey, versionId }) => {
    const mongoose_ = require('mongoose');
    const source = await AgentPrompt.findById(new mongoose_.Types.ObjectId(versionId)).lean();
    if (!source) throw new Error(`version ${versionId} not found`);
    if (source.agentType !== agentType || source.sectionKey !== sectionKey) {
      throw new Error(`version ${versionId} does not match ${agentType}/${sectionKey}`);
    }
    const current = await AgentPrompt.findOne({ agentType, sectionKey, active: true }).lean();
    await AgentPrompt.updateOne({ _id: current._id }, { $set: { active: false } });
    const doc = await AgentPrompt.create({
      agentType,
      sectionKey,
      ordinal: source.ordinal,
      headerText: source.headerText,
      body: source.body,
      active: true,
      isDraft: false,
      parentVersionId: current._id,
      publishedAt: new Date(),
    });
    const row = doc.toObject();
    return {
      id: row._id.toString(),
      agent_type: row.agentType,
      section_key: row.sectionKey,
      ordinal: row.ordinal,
      header_text: row.headerText,
      body: row.body,
      active: row.active,
      is_draft: row.isDraft,
      parent_version_id: row.parentVersionId ? row.parentVersionId.toString() : null,
      change_note: row.changeNote || null,
      created_at: row.createdAt,
      created_by: row.createdBy ? row.createdBy.toString() : null,
      published_at: row.publishedAt || null,
    };
  };

  const putTestQuestions = async ({ agentType, questions, createdBy }) => {
    await AgentPromptTestQuestion.deleteMany({ agentType });
    if (questions.length > 0) {
      await AgentPromptTestQuestion.insertMany(
        questions.map((q, i) => ({
          agentType,
          text: q.text,
          ordinal: q.ordinal ?? i,
          enabled: q.enabled ?? true,
          createdBy: createdBy || undefined,
        })),
      );
    }
    return { ok: true };
  };

  return {
    getPool,
    listSections,
    listVersions,
    getTestQuestions,
    getVersionUsage,
    saveDraft,
    publish,
    restore,
    putTestQuestions,
    _resetPoolForTesting: () => {},
  };
});

// ─────────────────────────────────────────────────────────────────────────────

const { SystemRoles } = require('librechat-data-provider');
const { Strategy: JwtStrategy, ExtractJwt } = require('passport-jwt');
const { AgentPrompt, AgentPromptTestQuestion } = require('~/db/models');

let app;
let memServer;
let adminToken;
let userToken;
let adminUserId;

beforeAll(async () => {
  memServer = await MongoMemoryServer.create();
  const uri = memServer.getUri();
  await mongoose.connect(uri);

  const User =
    mongoose.models.User ||
    mongoose.model('User', new mongoose.Schema({}, { strict: false }));
  const adminDoc = await User.create({
    name: 'Admin',
    email: 'admin@test.com',
    password: 'hashedpassword1',
    role: SystemRoles.ADMIN,
  });
  const userDoc = await User.create({
    name: 'Regular',
    email: 'user@test.com',
    password: 'hashedpassword2',
    role: SystemRoles.USER,
  });

  adminUserId = adminDoc._id.toString();
  const regularUserId = userDoc._id.toString();

  adminToken = jwt.sign({ id: adminUserId }, process.env.JWT_SECRET, {
    expiresIn: '5m',
  });
  userToken = jwt.sign({ id: regularUserId }, process.env.JWT_SECRET, {
    expiresIn: '5m',
  });

  passport.use(
    new JwtStrategy(
      {
        jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
        secretOrKey: process.env.JWT_SECRET,
      },
      async (payload, done) => {
        try {
          const found = await User.findById(payload?.id).lean();
          if (!found) return done(null, false);
          const user = { ...found, id: found._id.toString() };
          if (!user.role) user.role = SystemRoles.USER;
          done(null, user);
        } catch (err) {
          done(err, false);
        }
      },
    ),
  );

  app = express();
  app.use(express.json());
  app.use(passport.initialize());
  app.locals.liveAgentIds = { unified: 'live' };
  app.use('/api/admin/prompts', require('~/server/routes/admin/prompts'));
});

afterAll(async () => {
  await mongoose.disconnect();
  await memServer.stop();
});

afterEach(async () => {
  await AgentPrompt.deleteMany({});
  await AgentPromptTestQuestion.deleteMany({});
  jest.clearAllMocks();
});

async function seedActiveSection(overrides = {}) {
  return AgentPrompt.create({
    agentType: 'unified',
    sectionKey: 'intro',
    ordinal: 0,
    headerText: 'Intro',
    body: 'hello world',
    active: true,
    isDraft: false,
    createdAt: new Date(),
    ...overrides,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/admin/prompts/agents', () => {
  it('returns 401 when no token is provided', async () => {
    const res = await request(app).get('/api/admin/prompts/agents');
    expect(res.status).toBe(401);
  });

  it('returns 403 for a non-admin user', async () => {
    const res = await request(app)
      .get('/api/admin/prompts/agents')
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(403);
  });

  it('returns 200 with zero active sections on empty DB for admin', async () => {
    const res = await request(app)
      .get('/api/admin/prompts/agents')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.agents).toEqual([
      { agentType: 'unified', activeSections: 0 },
    ]);
  });

  it('returns correct counts after seeding active rows', async () => {
    await seedActiveSection({ sectionKey: 'intro' });
    await seedActiveSection({ sectionKey: 'rules', ordinal: 1 });

    const res = await request(app)
      .get('/api/admin/prompts/agents')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const unified = res.body.agents.find((a) => a.agentType === 'unified');
    expect(unified.activeSections).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/admin/prompts/:agent/sections', () => {
  it('returns 403 for non-admin', async () => {
    const res = await request(app)
      .get('/api/admin/prompts/unified/sections')
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(403);
  });

  it('returns sections with hasDraft flag', async () => {
    const active = await seedActiveSection({ sectionKey: 'intro' });
    await AgentPrompt.create({
      agentType: 'unified',
      sectionKey: 'intro',
      ordinal: 0,
      headerText: 'Intro',
      body: 'a draft body',
      active: false,
      isDraft: true,
      parentVersionId: active._id,
      createdAt: new Date(),
    });
    await seedActiveSection({ sectionKey: 'rules', ordinal: 1 });

    const res = await request(app)
      .get('/api/admin/prompts/unified/sections')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.sections).toHaveLength(2);
    const intro = res.body.sections.find((s) => s.sectionKey === 'intro');
    const rules = res.body.sections.find((s) => s.sectionKey === 'rules');
    expect(intro.hasDraft).toBe(true);
    expect(rules.hasDraft).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/admin/prompts/:agent/sections/:key/drafts', () => {
  it('returns 404 when no active section exists', async () => {
    const res = await request(app)
      .post('/api/admin/prompts/unified/sections/intro/drafts')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ body: 'new body', changeNote: 'n' });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/no active section/i);
  });

  it('returns 201 with the new draft when an active section exists', async () => {
    await seedActiveSection({ sectionKey: 'intro' });

    const res = await request(app)
      .post('/api/admin/prompts/unified/sections/intro/drafts')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ body: 'new draft body', changeNote: 'tweak' });

    expect(res.status).toBe(201);
    expect(res.body.draft.body).toBe('new draft body');
    expect(res.body.draft.isDraft).toBe(true);
    expect(res.body.draft.active).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/admin/prompts/:agent/sections/:key/publish', () => {
  it('returns 400 when changeNote is missing', async () => {
    const active = await seedActiveSection({ sectionKey: 'intro' });
    const res = await request(app)
      .post('/api/admin/prompts/unified/sections/intro/publish')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ parentVersionId: active._id.toString(), body: 'updated' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/changeNote/i);
  });

  it('returns 409 with current row when parentVersionId is stale', async () => {
    const active = await seedActiveSection({ sectionKey: 'intro' });
    const stale = new mongoose.Types.ObjectId();

    const res = await request(app)
      .post('/api/admin/prompts/unified/sections/intro/publish')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        parentVersionId: stale.toString(),
        body: 'updated',
        changeNote: 'n',
      });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('stale parent');
    expect(res.body.current._id.toString()).toBe(active._id.toString());
  });

  it('returns 200 and publishes a new active row on success', async () => {
    const active = await seedActiveSection({ sectionKey: 'intro' });

    const res = await request(app)
      .post('/api/admin/prompts/unified/sections/intro/publish')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        parentVersionId: active._id.toString(),
        body: 'published body',
        changeNote: 'real change',
      });

    expect(res.status).toBe(200);
    expect(res.body.active.body).toBe('published body');
    expect(res.body.active.active).toBe(true);
    expect(res.body.active.changeNote).toBe('real change');
    expect(mockPatchLibreChatAgent).toHaveBeenCalledTimes(1);
    expect(mockPatchLibreChatAgent).toHaveBeenCalledWith(
      { unified: 'live' },
      'unified',
      expect.stringContaining('published body'),
    );

    const old = await AgentPrompt.findById(active._id).lean();
    expect(old.active).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/admin/prompts/:agent/sections/:key/versions', () => {
  it('returns 200 with history sorted newest first', async () => {
    const old = await AgentPrompt.create({
      agentType: 'unified',
      sectionKey: 'intro',
      ordinal: 0,
      headerText: 'Intro',
      body: 'old body',
      active: false,
      isDraft: false,
      createdAt: new Date('2026-01-01'),
    });
    const current = await AgentPrompt.create({
      agentType: 'unified',
      sectionKey: 'intro',
      ordinal: 0,
      headerText: 'Intro',
      body: 'current body',
      active: true,
      isDraft: false,
      parentVersionId: old._id,
      createdAt: new Date('2026-04-01'),
    });

    const res = await request(app)
      .get('/api/admin/prompts/unified/sections/intro/versions')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.versions).toHaveLength(2);
    expect(res.body.versions[0]._id.toString()).toBe(current._id.toString());
    expect(res.body.versions[1]._id.toString()).toBe(old._id.toString());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('test-questions routes', () => {
  it('GET returns empty list for admin on empty DB', async () => {
    const res = await request(app)
      .get('/api/admin/prompts/unified/test-questions')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.questions).toEqual([]);
  });

  it('PUT replaces all questions and GET returns them sorted by ordinal', async () => {
    await AgentPromptTestQuestion.create({
      agentType: 'unified',
      text: 'old',
      ordinal: 0,
      enabled: true,
    });

    const putRes = await request(app)
      .put('/api/admin/prompts/unified/test-questions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        questions: [
          { text: 'q1', enabled: true },
          { text: 'q2', enabled: false },
        ],
      });

    expect(putRes.status).toBe(200);
    expect(putRes.body.ok).toBe(true);

    const getRes = await request(app)
      .get('/api/admin/prompts/unified/test-questions')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.questions).toHaveLength(2);
    expect(getRes.body.questions[0].text).toBe('q1');
    expect(getRes.body.questions[0].ordinal).toBe(0);
    expect(getRes.body.questions[1].text).toBe('q2');
    expect(getRes.body.questions[1].enabled).toBe(false);
  });

  it('PUT returns 403 for non-admin', async () => {
    const res = await request(app)
      .put('/api/admin/prompts/unified/test-questions')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ questions: [] });
    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Aurora-primary path tests
// These tests directly invoke the controller functions (bypassing Express
// routing) with fine-grained mocks, exercising:
//   • the rowToMongoose camelCase mapping
//   • the Mongo fallback path on Aurora read failure
//   • the 503 path on Aurora write failure (no Mongo fallback)
//   • the 409 stale-parent path on Aurora publish
// ─────────────────────────────────────────────────────────────────────────────

describe('promptsController — Aurora-primary paths (unit)', () => {
  // Pull in the real aurora mock from above (the module-level mock is already
  // active). We re-require the controller at unit level to exercise it with
  // swapped mock implementations.

  const aurora = require('~/server/services/AdminPrompts/aurora');

  // Build a minimal req/res pair for unit invocations.
  function makeReq(overrides = {}) {
    return {
      params: { agent: 'unified', key: 'intro', ...overrides.params },
      body: {},
      user: { id: adminUserId },
      log: { warn: jest.fn(), error: jest.fn() },
      headers: {},
      app: { locals: { liveAgentIds: { unified: 'live' } } },
      query: {},
      ...overrides,
    };
  }

  function makeRes() {
    const res = { status: jest.fn(), json: jest.fn() };
    res.status.mockReturnValue(res);
    return res;
  }

  // ── listSections → Aurora success path ──────────────────────────────────

  it('listSections returns camelCase sections with source=aurora when Aurora succeeds', async () => {
    const auroraRow = {
      id: 'uuid-1',
      agent_type: 'unified',
      section_key: 'intro',
      ordinal: 0,
      header_text: 'Intro',
      body: 'hello',
      active: true,
      is_draft: false,
      parent_version_id: null,
      change_note: null,
      created_at: new Date('2026-01-01'),
      created_by: null,
      published_at: new Date('2026-01-01'),
    };
    // Temporarily override listSections and getPool.
    const originalListSections = aurora.listSections;
    const originalGetPool = aurora.getPool;
    aurora.listSections = jest.fn().mockResolvedValue([auroraRow]);
    aurora.getPool = jest.fn().mockReturnValue({
      query: jest.fn().mockResolvedValue({ rows: [] }),
    });

    const { listSections } = require('~/server/controllers/admin/promptsController');
    const req = makeReq();
    const res = makeRes();
    await listSections(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'aurora',
        sections: expect.arrayContaining([
          expect.objectContaining({
            sectionKey: 'intro',
            body: 'hello',
            active: true,
            isDraft: false,
          }),
        ]),
      }),
    );

    aurora.listSections = originalListSections;
    aurora.getPool = originalGetPool;
  });

  // ── listSections → Mongo fallback path ───────────────────────────────────

  it('listSections falls back to Mongo and returns sections when Aurora throws', async () => {
    // Aurora mock already throws for listSections — seed a Mongo row.
    await seedActiveSection({ sectionKey: 'intro' });

    const { listSections } = require('~/server/controllers/admin/promptsController');
    const req = makeReq();
    const res = makeRes();
    await listSections(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'mongo-fallback',
        sections: expect.arrayContaining([
          expect.objectContaining({ sectionKey: 'intro' }),
        ]),
      }),
    );
    await AgentPrompt.deleteMany({});
  });

  // ── listVersions → Mongo fallback path ───────────────────────────────────

  it('listVersions falls back to Mongo when Aurora throws', async () => {
    await AgentPrompt.create({
      agentType: 'unified',
      sectionKey: 'intro',
      ordinal: 0,
      headerText: 'Intro',
      body: 'v1',
      active: true,
      isDraft: false,
      createdAt: new Date('2026-01-01'),
    });

    const { listVersions } = require('~/server/controllers/admin/promptsController');
    const req = makeReq();
    const res = makeRes();
    await listVersions(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'mongo-fallback',
        versions: expect.arrayContaining([expect.objectContaining({ body: 'v1' })]),
      }),
    );
    await AgentPrompt.deleteMany({});
  });

  // ── saveDraft → 503 on Aurora failure ────────────────────────────────────

  it('saveDraft returns 503 when Aurora throws a non-404 error', async () => {
    const originalSaveDraft = aurora.saveDraft;
    aurora.saveDraft = jest.fn().mockRejectedValue(new Error('connection refused'));

    const { saveDraft } = require('~/server/controllers/admin/promptsController');
    const req = makeReq({ body: { body: 'new draft', changeNote: 'c' } });
    const res = makeRes();
    await saveDraft(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringMatching(/unavailable/i) }),
    );

    aurora.saveDraft = originalSaveDraft;
  });

  // ── saveDraft → 404 when no active section ────────────────────────────────

  it('saveDraft returns 404 when Aurora throws "no active section"', async () => {
    const originalSaveDraft = aurora.saveDraft;
    aurora.saveDraft = jest
      .fn()
      .mockRejectedValue(new Error('no active section: unified/intro'));

    const { saveDraft } = require('~/server/controllers/admin/promptsController');
    const req = makeReq({ body: { body: 'irrelevant', changeNote: 'n' } });
    const res = makeRes();
    await saveDraft(req, res);

    expect(res.status).toHaveBeenCalledWith(404);

    aurora.saveDraft = originalSaveDraft;
  });

  // ── publish → 409 on stale parent ────────────────────────────────────────

  it('publish returns 409 when Aurora throws stale parent', async () => {
    // Seed a real active Mongo row so the controller can populate current.
    const active = await seedActiveSection({ sectionKey: 'intro' });

    const originalSaveDraft = aurora.saveDraft;
    const originalPublish = aurora.publish;
    const originalListSections = aurora.listSections;

    // saveDraft stub returns a fake row so publish can proceed.
    aurora.saveDraft = jest.fn().mockResolvedValue({ id: 'draft-uuid' });
    aurora.publish = jest
      .fn()
      .mockRejectedValue(new Error('stale parent: parentVersionId is no longer the active row'));
    aurora.listSections = jest.fn().mockRejectedValue(new Error('Aurora down'));

    const { publish } = require('~/server/controllers/admin/promptsController');
    const req = makeReq({
      params: { agent: 'unified', key: 'intro' },
      body: {
        parentVersionId: new mongoose.Types.ObjectId().toString(),
        body: 'update',
        changeNote: 'c',
      },
    });
    const res = makeRes();
    await publish(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'stale parent' }),
    );

    aurora.saveDraft = originalSaveDraft;
    aurora.publish = originalPublish;
    aurora.listSections = originalListSections;
    await AgentPrompt.deleteMany({});
  });

  // ── publish → 503 on generic Aurora failure ───────────────────────────────

  it('publish returns 503 on non-stale-parent Aurora failure', async () => {
    const originalSaveDraft = aurora.saveDraft;
    const originalPublish = aurora.publish;

    aurora.saveDraft = jest.fn().mockResolvedValue({ id: 'draft-uuid' });
    aurora.publish = jest.fn().mockRejectedValue(new Error('DB connection lost'));

    const { publish } = require('~/server/controllers/admin/promptsController');
    const req = makeReq({
      params: { agent: 'unified', key: 'intro' },
      body: {
        parentVersionId: new mongoose.Types.ObjectId().toString(),
        body: 'update',
        changeNote: 'c',
      },
    });
    const res = makeRes();
    await publish(req, res);

    expect(res.status).toHaveBeenCalledWith(503);

    aurora.saveDraft = originalSaveDraft;
    aurora.publish = originalPublish;
  });
});
