const express = require('express');
const router = express.Router({ mergeParams: true });
const CustomerController = require('../controllers/customer.controller');

// Mounted at /api/store/:storeId/auth — public, this is the login itself
router.post('/otp/send', CustomerController.sendOTP);
router.post('/otp/verify', CustomerController.verifyOTP);

module.exports = router;
