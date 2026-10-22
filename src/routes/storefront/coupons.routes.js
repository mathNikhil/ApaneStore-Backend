const express = require('express');
const router = express.Router({ mergeParams: true });
const pool = require('../../config/database');

// Public coupon validation — no admin auth required
// POST /api/store/:storeId/coupons/validate
// storeId is the store subdomain (e.g. "fashionhouse")
router.post('/validate', async (req, res) => {
    try {
        const { storeId } = req.params;
        const { code, order_value = 0 } = req.body;

        if (!code) return res.status(400).json({ success: false, error: 'code is required' });

        // Resolve subdomain → numeric store id
        const storeResult = await pool.query('SELECT id FROM stores WHERE subdomain = $1', [storeId]);
        if (!storeResult.rows.length) return res.status(404).json({ success: false, error: 'Store not found' });
        const numericStoreId = storeResult.rows[0].id;

        const result = await pool.query(
            'SELECT * FROM discount_codes WHERE store_id = $1 AND code = $2',
            [numericStoreId, code.trim().toUpperCase()]
        );
        if (!result.rows.length) return res.status(404).json({ success: false, error: 'Invalid coupon code' });

        const coupon = result.rows[0];
        const now = new Date();

        // Only block explicitly disabled coupons; rely on date range for active/scheduled
        if (coupon.status === 'disabled') return res.status(400).json({ success: false, error: 'This offer is no longer active' });
        if (coupon.start_at && now < new Date(coupon.start_at)) return res.status(400).json({ success: false, error: 'This offer has not started yet' });
        if (coupon.end_at && now > new Date(coupon.end_at)) return res.status(400).json({ success: false, error: 'This offer has expired' });
        if (coupon.max_uses !== null && coupon.current_uses >= coupon.max_uses) return res.status(400).json({ success: false, error: 'This coupon has reached its usage limit' });

        if (parseFloat(order_value) < parseFloat(coupon.min_order_value || 0)) {
            return res.status(400).json({ success: false, error: `Minimum order value ₹${coupon.min_order_value} required` });
        }

        return res.json({
            success: true,
            data: {
                id: coupon.id,
                code: coupon.code,
                name: coupon.name,
                unit: coupon.unit,
                value: coupon.value,
                scope: coupon.scope
            }
        });
    } catch (err) {
        console.error('[Storefront Coupons] validate error:', err);
        return res.status(500).json({ success: false, error: 'Validation failed' });
    }
});

module.exports = router;
