const express = require('express');
const requireJwtAuth = require('~/server/middleware/requireJwtAuth');
const checkAdmin = require('~/server/middleware/roles/admin');
const { listRuns, getRunHtml } = require('~/server/services/AdminSanity');

const router = express.Router();
router.use(requireJwtAuth, checkAdmin);

router.get('/', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const runs = await listRuns({ limit });
    res.json({ runs });
  } catch (err) {
    req.log?.error?.({ err }, 'admin/sanity listRuns failed');
    res.status(500).json({ error: 'listRuns_failed', detail: err.message });
  }
});

router.get('/:runId/html', async (req, res) => {
  try {
    const { html, started_at } = await getRunHtml(req.params.runId);
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('Cache-Control', 'private, max-age=3600');
    res.set('X-Sanity-Run-Started-At', new Date(started_at).toISOString());
    res.send(html);
  } catch (err) {
    if (err.code === 'not_found') return res.status(404).json({ error: 'not_found' });
    req.log?.error?.({ err }, 'admin/sanity getRunHtml failed');
    res.status(500).json({ error: 'getRunHtml_failed', detail: err.message });
  }
});

// POST /api/admin/sanity/launch
//
// Proxies to rebuilding-bots `POST /admin/sanity`, which kicks off a sanity
// run in a background thread and returns 202. The actual capture+judge+render
// runs in the botnim-api container (the Python sanity package). LibreChat's
// dashboard polls `GET /api/admin/sanity` to see the new run appear.
//
// Env:
//   BOTNIM_API_BASE_URL          e.g. http://botnim-api:8000 (service-connect)
//                                or https://botnim.staging.build-up.team/botnim
//   BOTNIM_SANITY_ADMIN_API_KEY  shared secret with the rebuilding-bots side
//                                (sourced from the same Secrets Manager entry)
router.post('/launch', async (req, res) => {
  const baseUrl = process.env.BOTNIM_API_BASE_URL;
  const apiKey = process.env.BOTNIM_SANITY_ADMIN_API_KEY;
  if (!baseUrl || !apiKey) {
    return res.status(503).json({
      error: 'not_configured',
      detail: 'BOTNIM_API_BASE_URL or BOTNIM_SANITY_ADMIN_API_KEY missing',
    });
  }
  const url = `${baseUrl.replace(/\/$/, '')}/admin/sanity`;
  try {
    const upstream = await fetch(url, {
      method: 'POST',
      headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
    });
    const body = await upstream.text();
    let parsed = null;
    try { parsed = JSON.parse(body); } catch { parsed = { raw: body }; }
    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: 'launch_failed',
        upstream_status: upstream.status,
        detail: parsed,
      });
    }
    res.status(202).json({ ok: true, upstream: parsed });
  } catch (err) {
    req.log?.error?.({ err }, 'admin/sanity launch failed');
    res.status(502).json({ error: 'launch_failed', detail: err.message });
  }
});

module.exports = router;
