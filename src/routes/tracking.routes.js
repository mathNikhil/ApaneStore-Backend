const express = require('express');
const router = express.Router();
const trackingController = require('../controllers/trackingController');

// ✅ Only the public courier list lives here now — everything that reads
// or writes actual tracking data has moved to the already-authenticated
// store-admin orders routes (see routes/store-admin/orders.routes.js).
// The old version of this file had those routes with NO auth at all and
// a spoofable req.body.storeId (defaulting to store 1 if omitted) —
// meaning anyone could tamper with any store's tracking data.
router.get('/couriers', trackingController.getCourierList);

module.exports = router;
