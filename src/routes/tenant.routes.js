const express = require('express');
const router = express.Router();
const TenantController = require('../controllers/tenant.controller');
const { authenticate } = require('../middleware/auth');

// A tenant only ever manages their own profile — no arbitrary tenant
// lookup/list/delete here (that's what Admin/tenant.controller.js + the
// authenticateAdmin-gated /api/admin/tenants routes are for).
router.use(authenticate);

router.get('/me', TenantController.getById);
router.put('/me', TenantController.update);

module.exports = router;
