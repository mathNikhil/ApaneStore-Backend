const express = require('express');
const router = express.Router({ mergeParams: true });
const pool = require('../../config/database');

// Public coupon validation — no admin auth required
// POST /api/store/:storeId/coupons/validate
// storeId is the store subdomain (e.g. "fashionhouse")
router.post('/validate', async (req, res) => {
    try {
        const { storeId } = req.params;
        const { code, order_value = 0, product_ids = [], category_ids = [] } = req.body;

        if (!code) return res.status(400).json({ success: false, error: 'code is required' });

        // Resolve subdomain → numeric store id (handle both numeric id and subdomain)
        let numericStoreId = storeId;
        if (isNaN(storeId)) {
            const storeResult = await pool.query('SELECT id FROM stores WHERE subdomain = $1', [storeId]);
            if (!storeResult.rows.length) return res.status(404).json({ success: false, error: 'Store not found' });
            numericStoreId = storeResult.rows[0].id;
        }

        const result = await pool.query(
            'SELECT * FROM discount_codes WHERE store_id = $1 AND code = $2',
            [parseInt(numericStoreId), code.trim().toUpperCase()]
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

        // Scope check — coupon valid if ANY cart item matches
        const pids = (Array.isArray(product_ids) ? product_ids : String(product_ids).split(',')).map(String).filter(Boolean);
        const cids = (Array.isArray(category_ids) ? category_ids : String(category_ids).split(',')).map(String).filter(Boolean);
        if (coupon.scope === 'product' && coupon.scope_items?.length && pids.length > 0) {
            const scopePids = coupon.scope_items.map(k => String(k).split(':')[0]);
            if (!pids.some(p => scopePids.includes(p))) {
                return res.status(400).json({ success: false, error: 'This offer is not applicable to your cart items' });
            }
        }
        if (coupon.scope === 'category' && coupon.scope_items?.length) {
            if (!cids.some(c => coupon.scope_items.map(String).includes(c))) {
                return res.status(400).json({ success: false, error: 'This offer is not applicable to your cart items' });
            }
        }

        // Calculate discount
        let discount = 0;
        const val = parseFloat(coupon.value) || 0;
        const ov = parseFloat(order_value) || 0;
        if (coupon.unit === 'percent') discount = Math.round(ov * val / 100 * 100) / 100;
        else discount = Math.min(val, ov);

        return res.json({
            valid: true,
            success: true,
            discount,
            message: `₹${discount.toFixed(2)} discount applied`,
            coupon: {
                id: coupon.id, code: coupon.code, name: coupon.name,
                unit: coupon.unit, value: coupon.value, scope: coupon.scope
            }
        });
    } catch (err) {
        console.error('[Storefront Coupons] validate error:', err);
        return res.status(500).json({ valid: false, success: false, error: 'Validation failed' });
    }
});

// GET /api/store/:storeId/coupons/available
// Public — lists all active coupons for the store matching the cart
router.get('/available', async (req, res) => {
    try {
        const { storeId } = req.params;
        const { order_value = 0, product_ids = '', category_ids = '' } = req.query;
        const pids = product_ids ? product_ids.split(',').filter(Boolean) : [];
        const cids = category_ids ? category_ids.split(',').filter(Boolean) : [];

        // Resolve subdomain → numeric store id if needed
        let numericStoreId = storeId;
        if (isNaN(storeId)) {
            const sr = await pool.query('SELECT id FROM stores WHERE subdomain = $1', [storeId]);
            if (!sr.rows.length) return res.json({ success: true, coupons: [] });
            numericStoreId = sr.rows[0].id;
        }

        const result = await pool.query(
            `SELECT id, name, type, code, unit, value, min_order_value, scope, scope_items,
                    applicable_to
             FROM discount_codes
             WHERE store_id = $1 AND status != 'disabled'
               AND start_at <= NOW() AND end_at >= NOW()
               AND (max_uses IS NULL OR current_uses < max_uses)
             ORDER BY value DESC`,
            [parseInt(numericStoreId)]
        );

        const eligible = result.rows.filter(c => {
            // Issue 2 fix: coupon is valid if ANY cart product matches scope (not ALL)
            if (c.scope === 'product' && c.scope_items?.length) {
                const scopePids = c.scope_items.map(k => String(k).split(':')[0]);
                if (!pids.some(p => scopePids.includes(String(p)))) return false;
            }
            if (c.scope === 'category' && c.scope_items?.length) {
                if (!cids.some(cat => c.scope_items.includes(String(cat)))) return false;
            }
            return true;
        });

        return res.json({
            success: true,
            coupons: eligible.map(c => ({
                id: c.id, code: c.code, name: c.name, type: c.type,
                unit: c.unit, value: parseFloat(c.value),
                min_order_value: parseFloat(c.min_order_value) || 0,
                scope: c.scope,
                applicable_to: c.applicable_to || 'both', // 'dine_in', 'delivery', 'both'
            }))
        });
    } catch (err) {
        console.error('[Storefront Coupons] available error:', err);
        return res.status(500).json({ success: false, coupons: [] });
    }
});

module.exports = router;
