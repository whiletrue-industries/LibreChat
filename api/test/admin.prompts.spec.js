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
