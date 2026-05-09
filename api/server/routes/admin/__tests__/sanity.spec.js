'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('~/server/middleware/requireJwtAuth', () => (req, res, next) => {
  req.user = req.headers['x-test-user']
    ? { id: req.headers['x-test-user'], role: req.headers['x-test-role'] || 'USER' }
    : null;
  if (!req.user) return res.status(401).json({ error: 'unauth' });
  return next();
});
jest.mock('~/server/middleware/roles/admin', () => (req, res, next) => {
  if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'forbidden' });
  return next();
});
jest.mock('~/server/services/AdminSanity', () => ({
  listRuns: jest.fn(),
  getRunHtml: jest.fn(),
}));

const sanityRoute = require('../sanity');
const { listRuns, getRunHtml } = require('~/server/services/AdminSanity');

function makeApp() {
  const app = express();
  app.use('/api/admin/sanity', sanityRoute);
  return app;
}

describe('GET /api/admin/sanity', () => {
  beforeEach(() => { listRuns.mockReset(); getRunHtml.mockReset(); });

  it('rejects unauthenticated', async () => {
    await request(makeApp()).get('/api/admin/sanity').expect(401);
  });

  it('rejects non-admin', async () => {
    await request(makeApp())
      .get('/api/admin/sanity')
      .set('x-test-user', 'u1').set('x-test-role', 'USER')
      .expect(403);
  });

  it('returns runs for admin', async () => {
    listRuns.mockResolvedValue([{ id: 'a' }]);
    const r = await request(makeApp())
      .get('/api/admin/sanity')
      .set('x-test-user', 'u1').set('x-test-role', 'ADMIN')
      .expect(200);
    expect(r.body).toEqual({ runs: [{ id: 'a' }] });
  });
});

describe('GET /api/admin/sanity/:runId/html', () => {
  beforeEach(() => { getRunHtml.mockReset(); });

  it('returns text/html for admin', async () => {
    getRunHtml.mockResolvedValue({ html: '<p>hi</p>', started_at: new Date('2026-05-09T00:00:00Z') });
    const r = await request(makeApp())
      .get('/api/admin/sanity/abc/html')
      .set('x-test-user', 'u1').set('x-test-role', 'ADMIN')
      .expect(200)
      .expect('Content-Type', /text\/html/);
    expect(r.text).toBe('<p>hi</p>');
    expect(r.headers['x-sanity-run-started-at']).toBe('2026-05-09T00:00:00.000Z');
  });

  it('404 on missing', async () => {
    getRunHtml.mockRejectedValue(Object.assign(new Error('not_found'), { code: 'not_found' }));
    await request(makeApp())
      .get('/api/admin/sanity/abc/html')
      .set('x-test-user', 'u1').set('x-test-role', 'ADMIN')
      .expect(404);
  });
});
