const express = require('express');
const requireJwtAuth = require('~/server/middleware/requireJwtAuth');
const checkAdmin = require('~/server/middleware/roles/admin');
const controller = require('~/server/controllers/admin/feedbackController');

const router = express.Router();
router.use(requireJwtAuth, checkAdmin);

router.get('/overview', controller.getOverview);
router.get('/messages', controller.getMessages);
router.get('/pending-topics', controller.getPending);
router.post('/pending-topics/:id/approve', controller.approvePending);
router.post('/pending-topics/:id/reject', controller.rejectPending);

module.exports = router;
