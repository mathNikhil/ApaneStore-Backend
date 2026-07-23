const express = require('express');
const router = express.Router();
const AuthController = require('../controllers/auth.controller');

// Public routes
router.post('/register', (req, res) => {
    AuthController.register(req, res);
});

router.post('/login', (req, res) => {
    AuthController.login(req, res);
});

router.post('/refresh-token', (req, res) => {
    AuthController.refreshToken(req, res);
});

// OTP routes — passwordless tenant login/signup
router.post('/otp/send', AuthController.sendOTP);
router.post('/otp/verify', AuthController.verifyOTP);

// Protected routes
router.post('/logout', (req, res) => {
    AuthController.logout(req, res);
});

module.exports = router;
