const pool = require('../config/database');
const logger = require('../config/logger');

// ─── Upsert cart ──────────────────────────────────────────────────────────────
// Called by storefront whenever customer updates their cart.
// POST /api/storefront/:storeId/cart
// Body: { customerPhone, customerName, items, cartTotal }
const upsertCart = async (req, res) => {
    try {
        const { storeId } = req.params;
        const { customerPhone, customerName, items, cartTotal } = req.body;

        if (!customerPhone || !items) {
            return res.status(400).json({ success: false, error: 'customerPhone and items are required' });
        }

        await pool.query(
            `INSERT INTO customer_carts
                (store_id, customer_phone, customer_name, items, cart_total, updated_at)
             VALUES ($1, $2, $3, $4, $5, NOW())
             ON CONFLICT (store_id, customer_phone) DO UPDATE SET
                customer_name   = EXCLUDED.customer_name,
                items           = EXCLUDED.items,
                cart_total      = EXCLUDED.cart_total,
                updated_at      = NOW(),
                order_placed    = FALSE,
                reminder_index  = -1,
                last_reminded_at = NULL`,
            [storeId, customerPhone, customerName || null, JSON.stringify(items), cartTotal || 0]
        );

        res.json({ success: true });
    } catch (err) {
        logger.error('❌ upsertCart error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
};

// ─── Mark ordered ─────────────────────────────────────────────────────────────
// Called when customer places an order — stops further reminders.
// DELETE /api/storefront/:storeId/cart/:customerPhone
const markOrdered = async (req, res) => {
    try {
        const { storeId, customerPhone } = req.params;

        await pool.query(
            `UPDATE customer_carts
             SET order_placed = TRUE, updated_at = NOW()
             WHERE store_id = $1 AND customer_phone = $2`,
            [storeId, customerPhone]
        );

        // Also cancel any pending queue entries for this customer
        await pool.query(
            `UPDATE wa_send_queue
             SET status = 'skipped'
             WHERE store_id = $1 AND customer_phone = $2 AND status = 'pending' AND type = 'cart_recovery'`,
            [storeId, customerPhone]
        );

        res.json({ success: true });
    } catch (err) {
        logger.error('❌ markOrdered error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
};

// ─── Cart stats for dashboard ─────────────────────────────────────────────────
// GET /api/stores/:storeId/cart/stats
const getCartStats = async (req, res) => {
    try {
        const { storeId } = req.params;
        const tenantId = req.tenantId;

        // Verify store belongs to tenant
        const storeCheck = await pool.query(
            'SELECT id FROM stores WHERE id = $1 AND tenant_id = $2',
            [storeId, tenantId]
        );
        if (storeCheck.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Store not found' });
        }

        const { rows } = await pool.query(
            `SELECT
                COUNT(*) FILTER (WHERE NOT order_placed)                          AS active_carts,
                COUNT(*) FILTER (WHERE order_placed)                              AS converted,
                COUNT(*) FILTER (WHERE NOT order_placed AND reminder_index >= 0)  AS reminded,
                COALESCE(SUM(cart_total) FILTER (WHERE NOT order_placed), 0)      AS abandoned_value,
                COALESCE(SUM(cart_total) FILTER (WHERE order_placed), 0)          AS recovered_value
             FROM customer_carts
             WHERE store_id = $1`,
            [storeId]
        );

        // Last 7 batch runs
        const { rows: batches } = await pool.query(
            `SELECT ran_at, carts_sent, carts_queued, carts_skipped, daily_limit_hit
             FROM abandoned_cart_batch_log
             WHERE store_id = $1
             ORDER BY ran_at DESC LIMIT 7`,
            [storeId]
        );

        res.json({ success: true, data: { ...rows[0], recent_batches: batches } });
    } catch (err) {
        logger.error('❌ getCartStats error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
};

// ─── Save cart recovery config ────────────────────────────────────────────────
// PUT /api/stores/:storeId/cart/config
const saveCartConfig = async (req, res) => {
    try {
        const { storeId } = req.params;
        const tenantId = req.tenantId;
        const { enabled, send_time, min_cart_value, reminders } = req.body;

        const storeCheck = await pool.query(
            'SELECT id FROM stores WHERE id = $1 AND tenant_id = $2',
            [storeId, tenantId]
        );
        if (storeCheck.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Store not found' });
        }

        const config = { enabled, send_time, min_cart_value, reminders };

        await pool.query(
            `UPDATE stores SET cart_recovery_config = $1, updated_at = NOW() WHERE id = $2`,
            [JSON.stringify(config), storeId]
        );

        res.json({ success: true, message: 'Cart recovery config saved' });
    } catch (err) {
        logger.error('❌ saveCartConfig error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
};

module.exports = { upsertCart, markOrdered, getCartStats, saveCartConfig };
