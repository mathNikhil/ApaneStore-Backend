const validate = require('../middleware/validate');
const express = require('express');
const router = express.Router();
const StoreAdminSessionController = require('../controllers/storeAdminSession.controller');

// Public — no tenant auth. This is the store-admin-specific login, not the
// tenant's own OTP login.
router.post('/login', validate('storeAdminLogin'), StoreAdminSessionController.login);

// ✅ Logout accepts BOTH application/json (normal fetch-based logout button)
// AND text/plain (navigator.sendBeacon on tab close). sendBeacon must use a
// CORS-preflight-exempt content type when sending cross-origin — it can't
// perform the preflight handshake application/json would require — so the
// browser-close handler sends text/plain instead. This parses that text
// body as JSON manually since express.json() only auto-parses
// application/json bodies.
router.post('/logout', express.text({ type: 'text/plain' }), StoreAdminSessionController.logout);

module.exports = router;
