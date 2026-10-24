const pool = require('../config/database');
const logger = require('../config/logger');

const CustomerCartController = {

    // GET /api/store/:storeId/cart
    getCart: async (req, res) => {
        try {
            const { storeId } = req.params;
            const customerId = req.customer.customerId;

            const result = await pool.query(
                `SELECT items FROM customer_carts
                 WHERE store_id = $1 AND customer_id = $2 AND order_placed = FALSE`,
                [storeId, customerId]
            );

            res.json({
                success: true,
                data: { items: result.rows[0]?.items || [] }
            });
        } catch (error) {
            logger.error('Get cart error:', error);
            res.status(500).json({ success: false, error: 'Failed to get cart' });
        }
    },

    // POST /api/store/:storeId/cart
    saveCart: async (req, res) => {
        try {
            const { storeId } = req.params;
            const customerId = req.customer.customerId;
            // Normalize phone: strip non-digits, prepend 91 if it's a 10-digit Indian number
            const rawPhone = req.customer.phone || null;
            let customerPhone = null;
            if (rawPhone) {
                const digits = rawPhone.replace(/\D/g, '');
                customerPhone = digits.length === 10 ? `91${digits}` : digits;
            }
            const { items } = req.body;

            // Compute cart total from items
            const cartTotal = Array.isArray(items)
                ? items.reduce((sum, i) => sum + (parseFloat(i.price) || 0) * (parseInt(i.quantity) || 1), 0)
                : 0;

            // Look up customer name (best-effort — don't fail if missing)
            let customerName = null;
            try {
                const nameRow = await pool.query(
                    'SELECT name FROM customers WHERE id = $1 LIMIT 1',
                    [customerId]
                );
                customerName = nameRow.rows[0]?.name || null;
            } catch (_) { /* ignore */ }

            // Upsert by customer_id (primary key for System A),
            // also writing phone/name/total so the recovery job can use them.
            // UNIQUE constraint is on (store_id, customer_id) for this table.
            await pool.query(
                `INSERT INTO customer_carts
                    (store_id, customer_id, customer_phone, customer_name, items, cart_total, updated_at, order_placed, reminder_index)
                 VALUES ($1, $2, $3, $4, $5, $6, NOW(), FALSE, -1)
                 ON CONFLICT (store_id, customer_id)
                 DO UPDATE SET
                    customer_phone  = COALESCE($3, customer_carts.customer_phone),
                    customer_name   = COALESCE($4, customer_carts.customer_name),
                    items           = $5,
                    cart_total      = $6,
                    updated_at      = NOW(),
                    order_placed    = FALSE`,
                [storeId, customerId, customerPhone, customerName, JSON.stringify(items), cartTotal]
            );

            res.json({ success: true });
        } catch (error) {
            logger.error('Save cart error:', error);
            res.status(500).json({ success: false, error: 'Failed to save cart' });
        }
    },

    // DELETE /api/store/:storeId/cart
    // Mark order_placed = TRUE so the recovery job ignores this cart.
    // We keep the row so analytics/history still works.
    clearCart: async (req, res) => {
        try {
            const { storeId } = req.params;
            const customerId = req.customer.customerId;

            await pool.query(
                `UPDATE customer_carts
                 SET order_placed = TRUE, updated_at = NOW()
                 WHERE store_id = $1 AND customer_id = $2`,
                [storeId, customerId]
            );

            res.json({ success: true });
        } catch (error) {
            logger.error('Clear cart error:', error);
            res.status(500).json({ success: false, error: 'Failed to clear cart' });
        }
    },
};

module.exports = CustomerCartController;
