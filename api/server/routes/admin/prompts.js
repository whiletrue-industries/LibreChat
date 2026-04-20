const express = require('express');
const requireJwtAuth = require('~/server/middleware/requireJwtAuth');
const checkAdmin = require('~/server/middleware/roles/admin');
const controller = require('~/server/controllers/admin/promptsController');

const router = express.Router();
router.use(requireJwtAuth, checkAdmin);

router.get('/agents', controller.listAgents);
router.get('/:agent/sections', controller.listSections);
router.get('/:agent/sections/:key/versions', controller.listVersions);
router.post('/:agent/sections/:key/drafts', controller.saveDraft);
router.post('/:agent/sections/:key/publish', controller.publish);
router.post('/:agent/sections/:key/preview', controller.preview);
router.post('/:agent/sections/:key/restore', controller.restore);
router.get('/:agent/test-questions', controller.getTestQuestions);
router.put('/:agent/test-questions', controller.putTestQuestions);
router.get('/:agent/sections/:key/versions/:versionId/usage', controller.getUsage);

module.exports = router;
