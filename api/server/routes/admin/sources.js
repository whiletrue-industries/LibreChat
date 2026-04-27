const express = require('express');
const requireJwtAuth = require('~/server/middleware/requireJwtAuth');
const checkAdmin = require('~/server/middleware/roles/admin');
const { getContextStats, getSourceStats } = require('~/server/services/AdminSources/aurora');

const router = express.Router();
router.use(requireJwtAuth, checkAdmin);

const BOT = 'unified';

router.get('/', async (req, res) => {
  try {
    const stats = await getContextStats(BOT);
    res.json({ contexts: stats });
  } catch (err) {
    req.log?.error?.({ err }, 'admin/sources getContextStats failed');
    res.status(500).json({ error: 'getContextStats_failed', detail: err.message });
  }
});

router.get('/:context', async (req, res) => {
  try {
    const out = await getSourceStats(BOT, req.params.context);
    if (!out.context_summary) return res.status(404).json({ error: 'no_snapshots' });
    res.json(out);
  } catch (err) {
    req.log?.error?.({ err }, 'admin/sources getSourceStats failed');
    res.status(500).json({ error: 'getSourceStats_failed', detail: err.message });
  }
});

module.exports = router;
