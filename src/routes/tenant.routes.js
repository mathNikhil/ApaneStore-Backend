const express = require('express');
const router = express.Router();
const TenantController = require('../controllers/tenant.controller');
const { authenticate } = require('../middleware/auth');

// All tenant routes require authentication
router.use(authenticate);

router.get('/', TenantController.getAll);
router.get('/:id', TenantController.getById);
router.post('/', TenantController.create);
router.put('/:id', TenantController.update);
router.delete('/:id', TenantController.delete);

module.exports = router;