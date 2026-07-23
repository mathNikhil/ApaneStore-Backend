const express = require('express');
const router = express.Router({ mergeParams: true });
const StoreAdminOrdersController = require('../../controllers/store-admin/orders.controller');
const { authenticate } = require('../../middleware/auth');

// All routes require authentication
router.use(authenticate);

// Get order statistics
router.get('/stats', StoreAdminOrdersController.getStats);

// Get all orders
router.get('/', StoreAdminOrdersController.getAll);

// Get order by ID
router.get('/:orderId', StoreAdminOrdersController.getById);

// Update order status
router.put('/:orderId/status', StoreAdminOrdersController.updateStatus);

module.exports = router;
