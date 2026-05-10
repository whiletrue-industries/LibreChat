const express = require('express');

const router = express.Router();

router.use('/traces', require('./traces'));

module.exports = router;
