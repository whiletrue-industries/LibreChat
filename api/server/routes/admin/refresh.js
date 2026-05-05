const express = require('express');
const requireJwtAuth = require('~/server/middleware/requireJwtAuth');
const checkAdmin = require('~/server/middleware/roles/admin');

const router = express.Router();
router.use(requireJwtAuth, checkAdmin);

const BOTNIM_API_URL = process.env.BOTNIM_API || 'http://botnim-api:8000';
const REFRESH_KEY = process.env.BOTNIM_REFRESH_API_KEY || '';

const buildHeaders = () => {
  if (!REFRESH_KEY) {
    return null;
  }
  return { 'X-API-Key': REFRESH_KEY, 'Content-Type': 'application/json' };
};

router.post('/', async (req, res) => {
  const headers = buildHeaders();
  if (!headers) {
    return res.status(503).json({ error: 'refresh_unavailable',
      detail: 'BOTNIM_REFRESH_API_KEY not configured on this LibreChat task' });
  }
  try {
    const r = await fetch(`${BOTNIM_API_URL}/botnim/admin/refresh`, {
      method: 'POST', headers, body: JSON.stringify({}),
    });
    const text = await r.text();
    let body;
    try { body = JSON.parse(text); } catch { body = { _raw: text }; }
    res.status(r.status).json(body);
  } catch (err) {
    req.log?.error?.({ err }, 'admin/refresh proxy failed');
    res.status(502).json({ error: 'upstream_unreachable', detail: err.message });
  }
});

router.get('/status', async (req, res) => {
  const headers = buildHeaders();
  if (!headers) {
    return res.status(503).json({ error: 'refresh_unavailable',
      detail: 'BOTNIM_REFRESH_API_KEY not configured on this LibreChat task' });
  }
  try {
    const r = await fetch(`${BOTNIM_API_URL}/botnim/admin/refresh/status`, {
      method: 'GET', headers,
    });
    const text = await r.text();
    let body;
    try { body = JSON.parse(text); } catch { body = { _raw: text }; }
    res.status(r.status).json(body);
  } catch (err) {
    req.log?.error?.({ err }, 'admin/refresh/status proxy failed');
    res.status(502).json({ error: 'upstream_unreachable', detail: err.message });
  }
});

module.exports = router;
