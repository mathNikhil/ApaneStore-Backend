const express = require('express');
const router = express.Router();
const { upsertCart, markOrdered, getCartStats, saveCartConfig } = require('../controllers/cart.controller');
const { authenticate } = require('../middleware/auth');

// ── Storefront (no auth — called by customer's browser) ──────────────────────
// POST   /api/storefront/:storeId/cart        — upsert cart on item add/change
// DELETE /api/storefront/:storeId/cart/:phone — clear cart when order placed
router.post('/storefront/:storeId/cart', upsertCart);
router.delete('/storefront/:storeId/cart/:customerPhone', markOrdered);

// ── Dashboard (tenant auth required) ─────────────────────────────────────────
// GET /api/stores/:storeId/cart/stats         — abandoned cart analytics
// PUT /api/stores/:storeId/cart/config        — save cart recovery settings
router.get('/stores/:storeId/cart/stats', authenticate, getCartStats);
router.put('/stores/:storeId/cart/config', authenticate, saveCartConfig);

module.exports = router;
