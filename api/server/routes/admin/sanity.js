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

module.exports = router;
