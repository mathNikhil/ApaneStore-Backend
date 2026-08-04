const express = require('express');
const router = express.Router({ mergeParams: true });
const StoreAdminOrdersController = require('../../controllers/store-admin/orders.controller');
const trackingController = require('../../controllers/trackingController');
const { storeAdminAuth } = require('../../middleware/storeAdminAuth');

// All routes require a valid Store Admin password-based session
router.use(storeAdminAuth);

// Get order statistics
router.get('/stats', StoreAdminOrdersController.getStats);

// Courier tracking — was previously a separate, unauthenticated /api/tracking
// path; moved here so it's protected by the same storeAdminAuth as
// everything else, and storeId/orderId come from the authenticated URL
// rather than a spoofable request body.
router.get('/tracking', trackingController.getStoreTracking);
router.post('/:orderId/tracking', trackingController.addTracking);
router.get('/:orderId/tracking', trackingController.getTracking);
router.post('/:orderId/tracking/refresh', trackingController.refreshTracking);

// Get all orders
router.get('/', StoreAdminOrdersController.getAll);

// Get order by ID
router.get('/:orderId', StoreAdminOrdersController.getById);

// Update order status
router.put('/:orderId/status', StoreAdminOrdersController.updateStatus);

module.exports = router;
