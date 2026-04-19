/**
 * Integration test for /api/admin/feedback routes.
 *
 * Auth note: requireJwtAuth delegates to passport-jwt which calls getUserById(payload.id)
 * against MongoDB. Rather than booting the full Express app (which requires dist/index.html,
 * a real DB connection, etc.), this test mounts only the admin/feedback router on a minimal
 * Express app with requireJwtAuth and passport wired up, but seeds a real User doc so the
 * JWT strategy resolves successfully.
 *
 * AdminFeedback calls (aggregateOverview, listMessagesByFilter, approvePendingTopic) are
 * mocked because they call external OpenAI APIs internally.
 */

const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const passport = require('passport');
const jwt = require('jsonwebtoken');
const { MongoMemoryServer } = require('mongodb-memory-server');

// ── Mock @librechat/api before any require that touches it ────────────────────
const mockAggregateOverview = jest.fn();
const mockListMessagesByFilter = jest.fn();
const mockApprovePendingTopic = jest.fn();

jest.mock('@librechat/api', () => ({
  AdminFeedback: {
    aggregateOverview: (...args) => mockAggregateOverview(...args),
    listMessagesByFilter: (...args) => mockListMessagesByFilter(...args),
    approvePendingTopic: (...args) => mockApprovePendingTopic(...args),
  },
  isEnabled: (v) =>
    typeof v === 'boolean' ? v : typeof v === 'string' && v.toLowerCase().trim() === 'true',
}));

// ── Set JWT_SECRET before strategy is registered ─────────────────────────────
process.env.JWT_SECRET = 'admin-feedback-test-secret';
process.env.JWT_REFRESH_SECRET = 'admin-feedback-refresh-secret';

const { SystemRoles } = require('librechat-data-provider');
const { Strategy: JwtStrategy, ExtractJwt } = require('passport-jwt');
const { FeedbackTopicPending } = require('~/db/models');

let app;
let memServer;
let adminToken;
let userToken;
let adminUserId;

beforeAll(async () => {
  memServer = await MongoMemoryServer.create();
  const uri = memServer.getUri();
  await mongoose.connect(uri);

  // Seed an admin user and a regular user directly into the User collection
  const User = mongoose.models.User || mongoose.model('User', new mongoose.Schema({}, { strict: false }));
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

  adminToken = jwt.sign({ id: adminUserId }, process.env.JWT_SECRET, { expiresIn: '5m' });
  userToken = jwt.sign({ id: regularUserId }, process.env.JWT_SECRET, { expiresIn: '5m' });

  // Register passport JWT strategy — mirrors jwtStrategy.js
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

  // Build a minimal Express app with only the feedback router
  app = express();
  app.use(express.json());
  app.use(passport.initialize());
  app.use('/api/admin/feedback', require('~/server/routes/admin/feedback'));
});

afterAll(async () => {
  await mongoose.disconnect();
  await memServer.stop();
});

afterEach(() => {
  jest.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/admin/feedback/overview', () => {
  it('returns 401 when no token is provided', async () => {
    const res = await request(app).get('/api/admin/feedback/overview');
    expect(res.status).toBe(401);
  });

  it('returns 403 for a non-admin user', async () => {
    const res = await request(app)
      .get('/api/admin/feedback/overview')
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(403);
  });

  it('returns 200 with merged kpis + pendingTopicsCount for admin on empty DB', async () => {
    mockAggregateOverview.mockResolvedValueOnce({
      kpis: { total: 0, rated: 0, thumbsUp: 0, thumbsDown: 0 },
      byTopic: [],
      byRating: [],
      byEndpoint: [],
      recentTrend: [],
    });

    const res = await request(app)
      .get('/api/admin/feedback/overview')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.kpis.total).toBe(0);
    expect(res.body.pendingTopicsCount).toBe(0);
    expect(mockAggregateOverview).toHaveBeenCalledTimes(1);
  });

  it('includes real pendingTopicsCount from DB', async () => {
    await FeedbackTopicPending.create({
      proposedKey: 'k1',
      labelHe: 'label',
      labelEn: 'label',
      rawLabels: [],
      exampleMessageIds: [],
      status: 'pending',
      proposedAt: new Date(),
    });

    mockAggregateOverview.mockResolvedValueOnce({
      kpis: { total: 5, rated: 3, thumbsUp: 2, thumbsDown: 1 },
    });

    const res = await request(app)
      .get('/api/admin/feedback/overview')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.pendingTopicsCount).toBe(1);

    await FeedbackTopicPending.deleteMany({});
  });

  it('returns 500 when AdminFeedback.aggregateOverview throws', async () => {
    mockAggregateOverview.mockRejectedValueOnce(new Error('ES down'));

    const res = await request(app)
      .get('/api/admin/feedback/overview')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Internal server error');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/admin/feedback/messages', () => {
  it('returns 403 for non-admin', async () => {
    const res = await request(app)
      .get('/api/admin/feedback/messages')
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(403);
  });

  it('returns 200 with page data for admin', async () => {
    mockListMessagesByFilter.mockResolvedValueOnce({ messages: [], nextCursor: null });

    const res = await request(app)
      .get('/api/admin/feedback/messages?topic=budget&pageSize=10')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.messages).toEqual([]);
    expect(mockListMessagesByFilter).toHaveBeenCalledWith(
      expect.objectContaining({ topic: 'budget', pageSize: 10 }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/admin/feedback/pending-topics', () => {
  it('returns 403 for non-admin', async () => {
    const res = await request(app)
      .get('/api/admin/feedback/pending-topics')
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(403);
  });

  it('returns 200 with empty array when no pending topics', async () => {
    const res = await request(app)
      .get('/api/admin/feedback/pending-topics')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.pending).toEqual([]);
  });

  it('returns pending topics sorted by proposedAt desc', async () => {
    const older = await FeedbackTopicPending.create({
      proposedKey: 'old',
      labelHe: 'old',
      labelEn: 'old',
      rawLabels: [],
      exampleMessageIds: [],
      status: 'pending',
      proposedAt: new Date('2026-01-01'),
    });
    const newer = await FeedbackTopicPending.create({
      proposedKey: 'new',
      labelHe: 'new',
      labelEn: 'new',
      rawLabels: [],
      exampleMessageIds: [],
      status: 'pending',
      proposedAt: new Date('2026-04-01'),
    });

    const res = await request(app)
      .get('/api/admin/feedback/pending-topics')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.pending).toHaveLength(2);
    expect(res.body.pending[0].proposedKey).toBe('new');
    expect(res.body.pending[1].proposedKey).toBe('old');

    await FeedbackTopicPending.deleteMany({ _id: { $in: [older._id, newer._id] } });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/admin/feedback/pending-topics/:id/reject', () => {
  it('returns 403 for non-admin', async () => {
    const res = await request(app)
      .post('/api/admin/feedback/pending-topics/507f1f77bcf86cd799439011/reject')
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(403);
  });

  it('soft-rejects a pending topic and returns { ok: true }', async () => {
    const doc = await FeedbackTopicPending.create({
      proposedKey: 'reject-me',
      labelHe: 'rej',
      labelEn: 'rej',
      rawLabels: [],
      exampleMessageIds: [],
      status: 'pending',
      proposedAt: new Date(),
    });

    const res = await request(app)
      .post(`/api/admin/feedback/pending-topics/${doc._id}/reject`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const updated = await FeedbackTopicPending.findById(doc._id).lean();
    expect(updated.status).toBe('rejected');
    expect(updated.reviewedBy).toBe(adminUserId);
    expect(updated.reviewedAt).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/admin/feedback/pending-topics/:id/approve', () => {
  it('returns 403 for non-admin', async () => {
    const res = await request(app)
      .post('/api/admin/feedback/pending-topics/507f1f77bcf86cd799439011/approve')
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(403);
  });

  it('calls approvePendingTopic and returns { ok: true }', async () => {
    mockApprovePendingTopic.mockResolvedValueOnce({ key: 'promoted' });

    const res = await request(app)
      .post('/api/admin/feedback/pending-topics/507f1f77bcf86cd799439011/approve')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockApprovePendingTopic).toHaveBeenCalledWith(
      expect.objectContaining({
        pendingId: '507f1f77bcf86cd799439011',
        rewrite: true,
        reviewedBy: adminUserId,
      }),
    );
  });

  it('passes rewrite=false when query param is set', async () => {
    mockApprovePendingTopic.mockResolvedValueOnce({});

    await request(app)
      .post('/api/admin/feedback/pending-topics/507f1f77bcf86cd799439011/approve?rewrite=false')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(mockApprovePendingTopic).toHaveBeenCalledWith(
      expect.objectContaining({ rewrite: false }),
    );
  });
});
