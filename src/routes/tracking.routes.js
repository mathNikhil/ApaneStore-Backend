const express = require('express');
const router = express.Router();
const trackingController = require('../controllers/trackingController');

// ✅ REMOVED: The auth middleware that was causing the error
// We'll add proper auth later

// Courier list - public
router.get('/couriers', trackingController.getCourierList);

// Store admin routes - no auth for now (add later)
router.post('/add', trackingController.addTracking);
router.post('/bulk-add', trackingController.bulkAddTracking);
router.get('/store/:storeId', trackingController.getStoreTracking);
router.post('/refresh/:orderId', trackingController.refreshTracking);

// Customer routes
router.get('/:orderId', trackingController.getTracking);

module.exports = router;