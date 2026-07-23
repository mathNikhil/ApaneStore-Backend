const express = require('express');
const router = express.Router();
const PublicStoreController = require('../controllers/public.controller');

router.get('/store/:subdomain', PublicStoreController.getBySubdomain);

module.exports = router;
