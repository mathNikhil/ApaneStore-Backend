const express = require('express');
const router = express.Router();
const { authenticateAdmin } = require('../middleware/admin.auth');

// Controllers
const AdminAuthController = require('../controllers/Admin/auth.controller');
const AdminTenantController = require('../controllers/Admin/tenant.controller');
const AdminStoreController = require('../controllers/Admin/store.controller');
const AdminPanelController = require('../controllers/Admin/panel.controller');

// ============================================================
// PUBLIC ROUTES (No Auth Required)
// ============================================================
router.post('/login', AdminAuthController.login);

// ============================================================
// PROTECTED ROUTES (Admin Auth Required)
// ============================================================

// Admin Auth
router.post('/logout', authenticateAdmin, AdminAuthController.logout);

// Tenant Management
router.get('/tenants', authenticateAdmin, AdminTenantController.getAll);
router.get('/tenants/:id', authenticateAdmin, AdminTenantController.getById);
router.put('/tenants/:id/toggle', authenticateAdmin, AdminTenantController.toggleStatus);
router.delete('/tenants/:id', authenticateAdmin, AdminTenantController.delete);

// Store Management
router.get('/stores', authenticateAdmin, AdminStoreController.getAll);
router.get('/stores/:id', authenticateAdmin, AdminStoreController.getById);
router.delete('/stores/:id', authenticateAdmin, AdminStoreController.delete);

// Panel Configuration
router.get('/stores/:storeId/panels', authenticateAdmin, AdminPanelController.getStorePanels);
router.put('/stores/:storeId/panels', authenticateAdmin, AdminPanelController.updateStorePanels);
router.put('/stores/:storeId/panels/:panelType/toggle', authenticateAdmin, AdminPanelController.togglePanel);

module.exports = router;