const validate = require('../middleware/validate');
const express = require('express');
const router = express.Router({ mergeParams: true });
const CustomerController = require('../controllers/customer.controller');

// Mounted at /api/store/:storeId/auth — public, this is the login itself
router.post('/otp/send', validate('customerSendOTP'), CustomerController.sendOTP);
router.post('/otp/verify', validate('customerVerifyOTP'), CustomerController.verifyOTP);

module.exports = router;
