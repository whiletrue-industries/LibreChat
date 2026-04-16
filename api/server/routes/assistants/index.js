const express = require('express');
const router = express.Router();
const { uaParser, checkBan, requireJwtAuth } = require('~/server/middleware');

const v1 = require('./v1');
const v2 = require('./v2');
const chatV2 = require('./chatV2');

router.use(requireJwtAuth);
router.use(checkBan);
router.use(uaParser);
router.use('/v1/', v1);
// The legacy `/v1/chat` route used the Assistants API threads/runs path.
// It was removed when the Responses API migration made the Assistants chat
// path obsolete. The Assistants *management* endpoints under `/v1/` still
// function (via `./v1`) until the Prompts-API migration lands.
router.use('/v2/', v2);
router.use('/v2/chat', chatV2);

module.exports = router;
