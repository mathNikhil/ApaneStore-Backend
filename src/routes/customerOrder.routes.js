const express = require('express');
const router = express.Router({ mergeParams: true });
const CustomerOrderController = require('../controllers/customerOrder.controller');
const trackingController = require('../controllers/trackingController');
const { customerAuth } = require('../middleware/customerAuth');

router.post('/', customerAuth, CustomerOrderController.create);
router.get('/mine', customerAuth, CustomerOrderController.getMine);
router.get('/:orderId/tracking', customerAuth, trackingController.getCustomerTracking);

module.exports = router;
