const express = require('express');
const router = express.Router();
const PricingController = require('../controllers/pricing.controller');
const { authenticate } = require('../middleware/auth');

// Tenant must be logged in (they're mid-way through the publish flow), but
// no ownership check needed — pricing plans aren't store-specific data.
router.get('/', authenticate, PricingController.getAll);

module.exports = router;
