const express = require('express');
const router = express.Router();
const TermsController = require('../controllers/terms.controller');
const { authenticate } = require('../middleware/auth');

router.get('/', authenticate, TermsController.getCurrent);

module.exports = router;
