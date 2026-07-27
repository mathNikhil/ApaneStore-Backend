const express = require('express');
const router = express.Router();
const TenantController = require('../controllers/tenant.controller');
const { authenticate } = require('../middleware/auth');  // ✅ Use 'authenticate'

// All routes require authentication
router.use(authenticate);  // ✅ Use 'authenticate'

// Get current tenant profile
router.get('/me', TenantController.getById);

// Update current tenant profile
router.put('/me', TenantController.update);

module.exports = router;