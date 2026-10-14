const express = require('express');
const router = express.Router();
const QRController = require('../controllers/qr.controller');
const { authenticate } = require('../middleware/auth');
const { authenticateAdmin } = require('../middleware/admin.auth');
const { storeAdminAuth } = require('../middleware/storeAdminAuth');

// ── Public storefront route ───────────────────────────────────────────────────

// Public status — storefront checks this to show/hide scan button (no tenant auth)
router.get('/status/:storeId', QRController.getQRStatusPublic);

// ── Tenant-authenticated routes ──────────────────────────────────────────────

// Detailed status with subscription info — store admin dashboard
router.get('/status-admin/:storeId', authenticate, QRController.getQRStatus);

// Pricing breakdown before payment — no auth needed, price is public info
router.get('/pricing/:storeId', QRController.getQRPricingForStore);

// Initiate Cashfree payment for QR activation
router.post('/initiate-payment', authenticate, QRController.initiateQRPayment);

// Generate QR tokens for product list (inventory print)
// Uses storeAdminAuth — store admin session token, not tenant JWT
router.post('/generate/:storeId', storeAdminAuth, QRController.generateQRCodes);

// ── Public / Storefront routes ───────────────────────────────────────────────

// Validate scanned QR token (customer scan on storefront)
// No auth needed — customer may not be logged in yet at scan time
// Store_id in body acts as scope guard; token sig prevents forgery
router.post('/validate', QRController.validateQR);

// Cashfree webhook — no auth, signature verified inside controller
router.post('/cashfree-webhook', QRController.handleCashfreeWebhook);

// Payment return status check — tenant auth, called from return page
router.get('/payment-status', authenticate, QRController.getQRPaymentStatus);

// ── Super Admin routes ───────────────────────────────────────────────────────

router.get('/admin/pricing', authenticateAdmin, QRController.getAdminQRPricing);
router.put('/admin/pricing', authenticateAdmin, QRController.updateAdminQRPricing);
router.post('/admin/activate/:storeId', authenticateAdmin, QRController.adminActivateQR);
router.post('/admin/deactivate/:storeId', authenticateAdmin, QRController.adminDeactivateQR);

module.exports = router;
