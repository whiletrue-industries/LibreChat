/**
 * Route-level tests for the joined / snapshot / tool-override endpoints
 * added in UPE Task 6 (spec §5.2 LibreChat side).
 *
 * Strategy: a stub aurora module records the calls made by the controller
 * and returns canned pg-row-shaped objects, so the controller's mapping +
 * route wiring + admin gating is exercised end-to-end through Express.
 *
 * Auth setup mirrors admin.prompts.spec.js — mongo-memory-server,
 * passport-jwt strategy, admin + user user seeds.
 */

'use strict';

const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const passport = require('passport');
const jwt = require('jsonwebtoken');
const { MongoMemoryServer } = require('mongodb-memory-server');

process.env.JWT_SECRET = 'admin-prompts-routes-test-secret';
process.env.JWT_REFRESH_SECRET = 'admin-prompts-routes-refresh-secret';

const mockPatchLibreChatAgent = jest.fn().mockResolvedValue(undefined);
jest.mock('~/server/services/prompts/agentPatcher', () => ({
  patchLibreChatAgent: (...args) => mockPatchLibreChatAgent(...args),
}));

// Stub aurora — every call goes through these jest.fn() spies.
const mockAuroraStub = {
  listSections: jest.fn(),
  listVersions: jest.fn(),
  saveDraft: jest.fn(),
  publish: jest.fn(),
  restore: jest.fn(),
  listSnapshots: jest.fn(),
  listAllDrafts: jest.fn(),
  publishAllDrafts: jest.fn(),
  restoreSnapshotMinute: jest.fn(),
  listToolOverrides: jest.fn(),
  listToolOverrideVersions: jest.fn(),
  saveToolOverrideDraft: jest.fn(),
  publishToolOverride: jest.fn(),
  restoreToolOverride: jest.fn(),
  getTestQuestions: jest.fn(),
  putTestQuestions: jest.fn(),
  getVersionUsage: jest.fn(),
  getPool: jest.fn(),
  _resetPoolForTesting: jest.fn(),
};

jest.mock('~/server/services/AdminPrompts/aurora', () => mockAuroraStub);

// Mock the canonical-tools fetcher so we don't hit BOTNIM_API_BASE.
const mockFetchCanonicalTools = jest.fn();
jest.mock('~/server/services/AdminPrompts/canonicalTools', () => ({
  fetchCanonicalTools: (...args) => mockFetchCanonicalTools(...args),
}));

const { SystemRoles } = require('librechat-data-provider');
const { Strategy: JwtStrategy, ExtractJwt } = require('passport-jwt');

let app;
let memServer;
let adminToken;
let userToken;

beforeAll(async () => {
  memServer = await MongoMemoryServer.create();
  await mongoose.connect(memServer.getUri());
  const User =
    mongoose.models.User ||
    mongoose.model('User', new mongoose.Schema({}, { strict: false }));
  const adminDoc = await User.create({
    name: 'Admin', email: 'admin@test.com', password: 'pw1', role: SystemRoles.ADMIN,
  });
  const userDoc = await User.create({
    name: 'User', email: 'user@test.com', password: 'pw2', role: SystemRoles.USER,
  });
  adminToken = jwt.sign({ id: adminDoc._id.toString() }, process.env.JWT_SECRET, { expiresIn: '5m' });
  userToken = jwt.sign({ id: userDoc._id.toString() }, process.env.JWT_SECRET, { expiresIn: '5m' });

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

beforeEach(() => {
  jest.clearAllMocks();
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

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/admin/prompts/:agent/joined', () => {
  it('returns 401 with no token', async () => {
    const res = await request(app).get('/api/admin/prompts/unified/joined');
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin', async () => {
    const res = await request(app)
      .get('/api/admin/prompts/unified/joined')
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(403);
  });

  it('returns 200 with joinedText and version IDs for admin', async () => {
    mockAuroraStub.listSections.mockResolvedValue([
      pgRow({ id: 'id-1', section_key: 'intro', ordinal: 0, body: 'intro body' }),
      pgRow({ id: 'id-2', section_key: 'rules', ordinal: 1, body: 'rules body', header_text: 'Rules' }),
    ]);

    const res = await request(app)
      .get('/api/admin/prompts/unified/joined')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.source).toBe('aurora');
    expect(res.body.joinedText).toContain('<!-- SECTION_KEY: intro -->');
    expect(res.body.joinedText).toContain('intro body');
    expect(res.body.joinedText).toContain('<!-- SECTION_KEY: rules -->');
    expect(res.body.versions).toHaveLength(2);
    expect(res.body.versions[0]).toEqual({
      sectionKey: 'intro', ordinal: 0, versionId: 'id-1',
    });
  });

  it('returns 503 when Aurora throws', async () => {
    mockAuroraStub.listSections.mockRejectedValue(new Error('connection refused'));
    const res = await request(app)
      .get('/api/admin/prompts/unified/joined')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(503);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/admin/prompts/:agent/joined/draft', () => {
  it('returns 403 for non-admin', async () => {
    const res = await request(app)
      .post('/api/admin/prompts/unified/joined/draft')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ joinedText: '<!-- SECTION_KEY: intro -->\nhello' });
    expect(res.status).toBe(403);
  });

  it('returns 400 when joinedText is missing', async () => {
    const res = await request(app)
      .post('/api/admin/prompts/unified/joined/draft')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns 400 with parser error when an unknown section_key is present', async () => {
    mockAuroraStub.listSections.mockResolvedValue([
      pgRow({ id: 'id-1', section_key: 'intro', ordinal: 0, body: 'old' }),
    ]);

    const res = await request(app)
      .post('/api/admin/prompts/unified/joined/draft')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ joinedText: '<!-- SECTION_KEY: bogus -->\nbody' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unknown section_key/i);
  });

  it('writes one draft per changed section atomically', async () => {
    const introRow = pgRow({ id: 'id-1', section_key: 'intro', ordinal: 0, body: 'old intro' });
    const rulesRow = pgRow({ id: 'id-2', section_key: 'rules', ordinal: 1, body: 'old rules', header_text: 'Rules' });
    mockAuroraStub.listSections.mockResolvedValue([introRow, rulesRow]);

    const draftRow = pgRow({ id: 'draft-1', section_key: 'intro', body: 'new intro', active: false, is_draft: true, parent_version_id: 'id-1' });

    // Stub the pg pool used inside the transaction.
    const poolClient = {
      query: jest.fn(async (sql, params) => {
        if (sql.includes('BEGIN')) return {};
        if (sql.includes('COMMIT')) return {};
        if (sql.includes('ROLLBACK')) return {};
        if (sql.includes('SELECT * FROM agent_prompts')) {
          return { rows: [introRow] };
        }
        if (sql.includes('INSERT INTO agent_prompts')) {
          return { rows: [draftRow] };
        }
        return { rows: [] };
      }),
      release: jest.fn(),
    };
    mockAuroraStub.getPool.mockReturnValue({ connect: jest.fn().mockResolvedValue(poolClient) });

    const joinedText = [
      '<!-- SECTION_KEY: intro -->',
      'new intro',
      '',
      '<!-- SECTION_KEY: rules -->',
      'old rules',
    ].join('\n');

    const res = await request(app)
      .post('/api/admin/prompts/unified/joined/draft')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ joinedText, changeNote: 'tweak intro' });

    expect(res.status).toBe(201);
    expect(res.body.summary.sectionsTouched).toBe(1);
    expect(res.body.summary.sectionsTotal).toBe(2);
    expect(res.body.drafts).toHaveLength(1);
    expect(res.body.drafts[0].sectionKey).toBe('intro');
    expect(res.body.drafts[0].body).toBe('new intro');

    // Atomicity: BEGIN + COMMIT issued, no ROLLBACK on the success path.
    const sqls = poolClient.query.mock.calls.map((c) => c[0]);
    expect(sqls).toEqual(expect.arrayContaining([
      expect.stringContaining('BEGIN'),
      expect.stringContaining('COMMIT'),
    ]));
    expect(poolClient.release).toHaveBeenCalled();
  });

  it('rolls back when any section save fails', async () => {
    mockAuroraStub.listSections.mockResolvedValue([
      pgRow({ id: 'id-1', section_key: 'intro', ordinal: 0, body: 'old' }),
    ]);
    const poolClient = {
      query: jest.fn(async (sql) => {
        if (sql.includes('BEGIN')) return {};
        if (sql.includes('SELECT * FROM agent_prompts')) {
          throw new Error('boom');
        }
        return { rows: [] };
      }),
      release: jest.fn(),
    };
    mockAuroraStub.getPool.mockReturnValue({ connect: jest.fn().mockResolvedValue(poolClient) });

    const res = await request(app)
      .post('/api/admin/prompts/unified/joined/draft')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ joinedText: '<!-- SECTION_KEY: intro -->\nnew intro' });

    expect(res.status).toBe(503);
    const sqls = poolClient.query.mock.calls.map((c) => c[0]);
    expect(sqls.some((s) => s.includes('ROLLBACK'))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/admin/prompts/:agent/joined/publish', () => {
  it('returns 400 when changeNote is missing', async () => {
    const res = await request(app)
      .post('/api/admin/prompts/unified/joined/publish')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns 400 when there are no drafts to publish', async () => {
    mockAuroraStub.listAllDrafts.mockResolvedValue([]);
    const res = await request(app)
      .post('/api/admin/prompts/unified/joined/publish')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ changeNote: 'real' });
    expect(res.status).toBe(400);
  });

  it('publishes all drafts atomically and patches the live agent', async () => {
    mockAuroraStub.listAllDrafts.mockResolvedValue([
      { draft: pgRow({ id: 'draft-1', section_key: 'intro', is_draft: true, active: false }), parentVersionId: 'active-1' },
      { draft: pgRow({ id: 'draft-2', section_key: 'rules', is_draft: true, active: false }), parentVersionId: 'active-2' },
    ]);
    const publishedRows = [
      pgRow({ id: 'draft-1', section_key: 'intro', is_draft: false, active: true, body: 'intro new' }),
      pgRow({ id: 'draft-2', section_key: 'rules', is_draft: false, active: true, body: 'rules new', header_text: 'Rules', ordinal: 1 }),
    ];
    mockAuroraStub.publishAllDrafts.mockResolvedValue(publishedRows);
    mockAuroraStub.listSections.mockResolvedValue(publishedRows);

    const res = await request(app)
      .post('/api/admin/prompts/unified/joined/publish')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ changeNote: 'big change' });

    expect(res.status).toBe(200);
    expect(res.body.summary.sectionsPublished).toBe(2);
    expect(mockAuroraStub.publishAllDrafts).toHaveBeenCalledWith({
      agentType: 'unified',
      items: [
        { draftId: 'draft-1', sectionKey: 'intro', parentVersionId: 'active-1' },
        { draftId: 'draft-2', sectionKey: 'rules', parentVersionId: 'active-2' },
      ],
    });
    expect(mockPatchLibreChatAgent).toHaveBeenCalledTimes(1);
  });

  it('returns 409 on stale parent', async () => {
    mockAuroraStub.listAllDrafts.mockResolvedValue([
      { draft: pgRow({ id: 'draft-1', section_key: 'intro', is_draft: true, active: false }), parentVersionId: 'active-1' },
    ]);
    mockAuroraStub.publishAllDrafts.mockRejectedValue(
      new Error('stale parent for section intro: active-1'),
    );
    const res = await request(app)
      .post('/api/admin/prompts/unified/joined/publish')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ changeNote: 'x' });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('stale parent');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/admin/prompts/:agent/snapshots', () => {
  it('returns 403 for non-admin', async () => {
    const res = await request(app)
      .get('/api/admin/prompts/unified/snapshots')
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(403);
  });

  it('returns snapshots in camelCase', async () => {
    mockAuroraStub.listSnapshots.mockResolvedValue([
      {
        agent_type: 'unified',
        snapshot_minute: new Date('2026-04-10T12:00:00Z'),
        section_version_ids: ['v1', 'v2'],
        section_keys: ['intro', 'rules'],
        published_by: 'admin@test.com',
      },
    ]);

    const res = await request(app)
      .get('/api/admin/prompts/unified/snapshots')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.snapshots).toHaveLength(1);
    expect(res.body.snapshots[0]).toEqual({
      agentType: 'unified',
      snapshotMinute: '2026-04-10T12:00:00.000Z',
      sectionVersionIds: ['v1', 'v2'],
      sectionKeys: ['intro', 'rules'],
      publishedBy: 'admin@test.com',
    });
    expect(mockAuroraStub.listSnapshots).toHaveBeenCalledWith('unified');
  });

  it('returns 503 when Aurora throws', async () => {
    mockAuroraStub.listSnapshots.mockRejectedValue(new Error('boom'));
    const res = await request(app)
      .get('/api/admin/prompts/unified/snapshots')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(503);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/admin/prompts/:agent/snapshots/:minute/restore', () => {
  it('restores all sections of the matching snapshot atomically', async () => {
    const snapshotMinute = new Date('2026-04-10T12:00:00Z');
    mockAuroraStub.listSnapshots.mockResolvedValue([
      {
        agent_type: 'unified',
        snapshot_minute: snapshotMinute,
        section_version_ids: ['v1', 'v2'],
        section_keys: ['intro', 'rules'],
        published_by: 'admin@test.com',
      },
    ]);
    const restored = [
      pgRow({ id: 'new-1', section_key: 'intro', body: 'restored intro' }),
      pgRow({ id: 'new-2', section_key: 'rules', body: 'restored rules', header_text: 'Rules', ordinal: 1 }),
    ];
    mockAuroraStub.restoreSnapshotMinute.mockResolvedValue(restored);
    mockAuroraStub.listSections.mockResolvedValue(restored);

    const res = await request(app)
      .post(`/api/admin/prompts/unified/snapshots/${encodeURIComponent(snapshotMinute.toISOString())}/restore`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.summary.sectionsRestored).toBe(2);
    expect(mockAuroraStub.restoreSnapshotMinute).toHaveBeenCalledWith({
      agentType: 'unified',
      sectionVersionIds: ['v1', 'v2'],
    });
    expect(mockPatchLibreChatAgent).toHaveBeenCalledTimes(1);
  });

  it('returns 404 when no snapshot matches the minute', async () => {
    mockAuroraStub.listSnapshots.mockResolvedValue([]);
    const res = await request(app)
      .post('/api/admin/prompts/unified/snapshots/2026-01-01T00:00:00.000Z/restore')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/admin/prompts/:agent/tools', () => {
  it('returns 403 for non-admin', async () => {
    const res = await request(app)
      .get('/api/admin/prompts/unified/tools')
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(403);
  });

  it('returns tools merged from canonical + active overrides', async () => {
    mockFetchCanonicalTools.mockResolvedValue({
      search_unified__legal_text: 'default legal_text desc',
      fetchWordDocument: 'default fetchWordDocument desc',
    });
    mockAuroraStub.listToolOverrides.mockResolvedValue([
      {
        toolName: 'search_unified__legal_text',
        defaultDescription: 'default legal_text desc',
        override: { id: 1, description: 'override A', publishedAt: new Date('2026-04-01') },
      },
      {
        toolName: 'fetchWordDocument',
        defaultDescription: 'default fetchWordDocument desc',
        override: null,
      },
    ]);

    const res = await request(app)
      .get('/api/admin/prompts/unified/tools')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.tools).toHaveLength(2);
    expect(mockAuroraStub.listToolOverrides).toHaveBeenCalledWith(
      'unified',
      expect.objectContaining({ search_unified__legal_text: 'default legal_text desc' }),
    );
  });

  it('falls back to empty canonical map when fetcher fails', async () => {
    mockFetchCanonicalTools.mockRejectedValue(new Error('botnim_api unreachable'));
    mockAuroraStub.listToolOverrides.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/admin/prompts/unified/tools')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(mockAuroraStub.listToolOverrides).toHaveBeenCalledWith('unified', {});
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('tool-override CRUD routes', () => {
  it('GET .../tools/:toolName/versions returns version history camelCased', async () => {
    mockAuroraStub.listToolOverrideVersions.mockResolvedValue([
      {
        id: 7, agent_type: 'unified', tool_name: 'fetchWordDocument',
        description: 'newer', active: true, is_draft: false,
        parent_version_id: 6, change_note: null,
        created_at: new Date('2026-04-01'), created_by: null,
        published_at: new Date('2026-04-01'),
      },
    ]);

    const res = await request(app)
      .get('/api/admin/prompts/unified/tools/fetchWordDocument/versions')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.versions[0]).toEqual(expect.objectContaining({
      id: 7, toolName: 'fetchWordDocument', description: 'newer', active: true,
    }));
  });

  it('POST .../tools/:toolName/draft returns 400 when description missing', async () => {
    const res = await request(app)
      .post('/api/admin/prompts/unified/tools/fetchWordDocument/draft')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ changeNote: 'x' });
    expect(res.status).toBe(400);
  });

  it('POST .../tools/:toolName/draft returns 201 with the new draft', async () => {
    mockAuroraStub.saveToolOverrideDraft.mockResolvedValue({
      id: 8, agent_type: 'unified', tool_name: 'fetchWordDocument',
      description: 'draft v1', active: false, is_draft: true,
      parent_version_id: 7, change_note: 'note',
      created_at: new Date('2026-04-02'), created_by: 'admin',
      published_at: null,
    });

    const res = await request(app)
      .post('/api/admin/prompts/unified/tools/fetchWordDocument/draft')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ description: 'draft v1', changeNote: 'note' });

    expect(res.status).toBe(201);
    expect(res.body.draft.toolName).toBe('fetchWordDocument');
    expect(res.body.draft.isDraft).toBe(true);
    expect(mockAuroraStub.saveToolOverrideDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        agentType: 'unified', toolName: 'fetchWordDocument',
        description: 'draft v1', changeNote: 'note',
      }),
    );
  });

  it('POST .../tools/:toolName/publish returns 400 without changeNote, 200 on success', async () => {
    const noNote = await request(app)
      .post('/api/admin/prompts/unified/tools/fetchWordDocument/publish')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ draftId: 8 });
    expect(noNote.status).toBe(400);

    mockAuroraStub.publishToolOverride.mockResolvedValue({
      id: 8, agent_type: 'unified', tool_name: 'fetchWordDocument',
      description: 'draft v1', active: true, is_draft: false,
      parent_version_id: 7, change_note: null,
      created_at: new Date(), created_by: null, published_at: new Date(),
    });

    const ok = await request(app)
      .post('/api/admin/prompts/unified/tools/fetchWordDocument/publish')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ draftId: 8, parentVersionId: 7, changeNote: 'real change' });
    expect(ok.status).toBe(200);
    expect(ok.body.active.toolName).toBe('fetchWordDocument');
    expect(ok.body.active.active).toBe(true);
  });

  it('POST .../tools/:toolName/publish returns 409 on stale parent', async () => {
    mockAuroraStub.publishToolOverride.mockRejectedValue(
      new Error('stale parent: parentVersionId is no longer the active row'),
    );
    const res = await request(app)
      .post('/api/admin/prompts/unified/tools/fetchWordDocument/publish')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ draftId: 8, parentVersionId: 7, changeNote: 'real change' });
    expect(res.status).toBe(409);
  });

  it('POST .../tools/:toolName/restore returns 200 on success', async () => {
    mockAuroraStub.restoreToolOverride.mockResolvedValue({
      id: 9, agent_type: 'unified', tool_name: 'fetchWordDocument',
      description: 'restored', active: true, is_draft: false,
      parent_version_id: 8, change_note: null,
      created_at: new Date(), created_by: null, published_at: new Date(),
    });
    const res = await request(app)
      .post('/api/admin/prompts/unified/tools/fetchWordDocument/restore')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ versionId: 7 });
    expect(res.status).toBe(200);
    expect(res.body.active.description).toBe('restored');
  });

  it('POST .../tools/:toolName/restore returns 404 when version not found', async () => {
    mockAuroraStub.restoreToolOverride.mockRejectedValue(new Error('version not found: 99'));
    const res = await request(app)
      .post('/api/admin/prompts/unified/tools/fetchWordDocument/restore')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ versionId: 99 });
    expect(res.status).toBe(404);
  });
});
