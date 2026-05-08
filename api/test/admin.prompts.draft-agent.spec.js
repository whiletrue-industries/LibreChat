/**
 * Draft Agent mirror tests.
 *
 * Strategy: stub the aurora adapter so the tests don't need a Postgres
 * instance. Mongo is real (mongodb-memory-server) so the upsert
 * semantics + schema fields exercise the actual Agent model.
 */

'use strict';

const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const passport = require('passport');
const jwt = require('jsonwebtoken');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { Strategy: JwtStrategy, ExtractJwt } = require('passport-jwt');
const { SystemRoles } = require('librechat-data-provider');

process.env.JWT_SECRET = 'admin-prompts-draft-agent-test-secret';
process.env.JWT_REFRESH_SECRET = 'admin-prompts-draft-agent-test-refresh-secret';
process.env.SEED_AGENT_NAME = 'Test Canonical Bot';

jest.mock('~/server/services/prompts/agentPatcher', () => ({
  patchLibreChatAgent: jest.fn().mockResolvedValue(undefined),
}));

const mockAuroraStub = {
  listSections: jest.fn(),
  saveDraft: jest.fn(),
  listLatestDraftOrActiveSections: jest.fn(),
  getPool: jest.fn(),
  _resetPoolForTesting: jest.fn(),
};

jest.mock('~/server/services/AdminPrompts/aurora', () => mockAuroraStub);

let app;
let memServer;
let adminToken;
let Agent;

const CANONICAL_NAME = 'Test Canonical Bot';
const DRAFT_NAME = 'Test Canonical Bot — DRAFT';

beforeAll(async () => {
  memServer = await MongoMemoryServer.create();
  await mongoose.connect(memServer.getUri());

  ({ Agent } = require('~/db/models'));

  const User =
    mongoose.models.User ||
    mongoose.model('User', new mongoose.Schema({}, { strict: false }));
  const adminDoc = await User.create({
    name: 'Admin',
    email: 'admin@test.com',
    password: 'pw-admin-12345',
    role: SystemRoles.ADMIN,
  });
  adminToken = jwt.sign({ id: adminDoc._id.toString() }, process.env.JWT_SECRET, {
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

beforeEach(async () => {
  jest.clearAllMocks();
  await Agent.deleteMany({});
  await Agent.create({
    id: 'agent_canonical_test',
    name: CANONICAL_NAME,
    description: 'Canonical bot for tests',
    instructions: 'old joined text',
    provider: 'openAI',
    model: 'gpt-5.4-mini',
    model_parameters: { temperature: 0 },
    tools: ['canonical_tool_a'],
    actions: ['act_1'],
    author: new mongoose.Types.ObjectId(),
    authorName: 'seed',
    category: 'general',
  });
});

function pgRow(overrides = {}) {
  return {
    id: overrides.id || '11111111-1111-1111-1111-111111111111',
    agent_type: overrides.agent_type || 'unified',
    section_key: overrides.section_key || 'intro',
    ordinal: overrides.ordinal ?? 0,
    header_text: overrides.header_text || 'Intro',
    body: overrides.body || 'hello',
    active: overrides.active ?? true,
    is_draft: overrides.is_draft ?? false,
    parent_version_id: overrides.parent_version_id || null,
    change_note: overrides.change_note || null,
    created_at: overrides.created_at || new Date('2026-01-01'),
    created_by: overrides.created_by || null,
    published_at: overrides.published_at || new Date('2026-01-01'),
  };
}

describe('ensureDraftAgent', () => {
  const draftAgent = require('~/server/services/AdminPrompts/draftAgent');

  it('canonicalAgentNameFor("unified") respects SEED_AGENT_NAME env', () => {
    expect(draftAgent.canonicalAgentNameFor('unified')).toBe(CANONICAL_NAME);
    expect(draftAgent.draftAgentNameFor('unified')).toBe(DRAFT_NAME);
  });

  it('throws on unsupported bot', () => {
    expect(() => draftAgent.canonicalAgentNameFor('budget')).toThrow(/unsupported bot/);
  });

  it('creates the draft Agent doc on first call and clones canonical fields', async () => {
    const doc = await draftAgent.ensureDraftAgent({
      bot: 'unified',
      instructions: 'draft text v1',
    });
    expect(doc).toMatchObject({
      name: DRAFT_NAME,
      instructions: 'draft text v1',
      provider: 'openAI',
      model: 'gpt-5.4-mini',
      tools: ['canonical_tool_a'],
      draft: true,
    });
    expect(doc.actions).toEqual(['act_1']);
    expect(doc.id).toMatch(/^agent_/);
    const drafts = await Agent.find({ draft: true }).lean();
    expect(drafts).toHaveLength(1);
    expect(drafts[0].name).toBe(DRAFT_NAME);
  });

  it('upserts (single doc) on repeated calls — never spawns duplicates', async () => {
    await draftAgent.ensureDraftAgent({ bot: 'unified', instructions: 'v1' });
    await draftAgent.ensureDraftAgent({ bot: 'unified', instructions: 'v2' });
    const drafts = await Agent.find({ name: DRAFT_NAME }).lean();
    expect(drafts).toHaveLength(1);
    expect(drafts[0].instructions).toBe('v2');
  });

  it('throws when the canonical agent is missing', async () => {
    await Agent.deleteMany({});
    await expect(
      draftAgent.ensureDraftAgent({ bot: 'unified', instructions: 'x' }),
    ).rejects.toThrow(/canonical agent not found/);
  });
});

describe('composeDraftPayload', () => {
  const draftAgent = require('~/server/services/AdminPrompts/draftAgent');

  it('assembles instructions from listLatestDraftOrActiveSections', async () => {
    mockAuroraStub.listLatestDraftOrActiveSections.mockResolvedValue([
      pgRow({ section_key: 'intro', ordinal: 0, body: 'intro draft' }),
      pgRow({ section_key: 'rules', ordinal: 1, body: 'rules active', header_text: 'Rules' }),
    ]);

    const payload = await draftAgent.composeDraftPayload('unified');
    expect(payload.instructions).toContain('<!-- SECTION_KEY: intro -->');
    expect(payload.instructions).toContain('intro draft');
    expect(payload.instructions).toContain('<!-- SECTION_KEY: rules -->');
    expect(payload.instructions).toContain('rules active');
  });
});

describe('controller hooks', () => {
  function setupAuroraSaveDraftToReturnRow() {
    mockAuroraStub.saveDraft.mockResolvedValue(
      pgRow({ id: 'draft-1', section_key: 'intro', body: 'new body', is_draft: true, active: false }),
    );
    mockAuroraStub.listLatestDraftOrActiveSections.mockResolvedValue([
      pgRow({ section_key: 'intro', ordinal: 0, body: 'new body' }),
    ]);
  }

  it('POST /:agent/sections/:key/drafts triggers a draft-Agent upsert', async () => {
    setupAuroraSaveDraftToReturnRow();

    const res = await request(app)
      .post('/api/admin/prompts/unified/sections/intro/drafts')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ body: 'new body', changeNote: 'tweak' });

    expect(res.status).toBe(201);
    const drafts = await Agent.find({ draft: true }).lean();
    expect(drafts).toHaveLength(1);
    expect(drafts[0].name).toBe(DRAFT_NAME);
    expect(drafts[0].instructions).toContain('new body');
  });

  it('POST /:agent/joined/draft triggers a draft-Agent upsert', async () => {
    mockAuroraStub.listSections.mockResolvedValue([
      pgRow({ id: 'id-1', section_key: 'intro', ordinal: 0, body: 'old intro' }),
    ]);
    const draftRow = pgRow({
      id: 'draft-1',
      section_key: 'intro',
      body: 'new intro',
      active: false,
      is_draft: true,
      parent_version_id: 'id-1',
    });
    const poolClient = {
      query: jest.fn(async (sql) => {
        if (sql.includes('BEGIN')) return {};
        if (sql.includes('COMMIT')) return {};
        if (sql.includes('SELECT * FROM agent_prompts')) {
          return { rows: [pgRow({ id: 'id-1', section_key: 'intro', ordinal: 0, body: 'old intro' })] };
        }
        if (sql.includes('INSERT INTO agent_prompts')) {
          return { rows: [draftRow] };
        }
        return { rows: [] };
      }),
      release: jest.fn(),
    };
    mockAuroraStub.getPool.mockReturnValue({
      connect: jest.fn().mockResolvedValue(poolClient),
    });
    mockAuroraStub.listLatestDraftOrActiveSections.mockResolvedValue([
      pgRow({ section_key: 'intro', ordinal: 0, body: 'new intro' }),
    ]);

    const joined = '<!-- SECTION_KEY: intro -->\nnew intro';
    const res = await request(app)
      .post('/api/admin/prompts/unified/joined/draft')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ joinedText: joined, changeNote: 'edit' });

    expect(res.status).toBe(201);
    const drafts = await Agent.find({ draft: true }).lean();
    expect(drafts).toHaveLength(1);
    expect(drafts[0].instructions).toContain('new intro');
  });
});
