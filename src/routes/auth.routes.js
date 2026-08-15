const validate = require('../middleware/validate');
const express = require('express');
const router = express.Router();
const AuthController = require('../controllers/auth.controller');

// ✅ Public routes - all with proper callback functions
router.post('/register', AuthController.register);
router.post('/login', AuthController.login);
router.post('/refresh-token', AuthController.refreshToken);

// ✅ OTP routes - passwordless login/signup
router.post('/otp/send', validate('sendOTP'), AuthController.sendOTP);
router.post('/otp/verify', validate('verifyOTP'), AuthController.verifyOTP);

// ✅ Protected routes
router.post('/logout', AuthController.logout);

module.exports = router;