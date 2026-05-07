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

router.get('/:agent/joined', controller.getJoined);
router.post('/:agent/joined/draft', controller.saveJoinedDraft);
router.post('/:agent/joined/publish', controller.publishJoinedAll);

router.get('/:agent/snapshots', controller.listSnapshots);
router.post('/:agent/snapshots/:minute/restore', controller.restoreSnapshot);

router.get('/:agent/tools', controller.listToolOverrides);
router.get('/:agent/tools/:toolName/versions', controller.listToolOverrideVersions);
router.post('/:agent/tools/:toolName/draft', controller.saveToolOverrideDraft);
router.post('/:agent/tools/:toolName/publish', controller.publishToolOverride);
router.post('/:agent/tools/:toolName/restore', controller.restoreToolOverride);

module.exports = router;
