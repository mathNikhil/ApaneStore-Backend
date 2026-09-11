const pool = require('../config/database');
const logger = require('../config/logger');

const CustomerCartController = {

    // GET /api/store/:storeId/cart
    getCart: async (req, res) => {
        try {
            const { storeId } = req.params;
            const customerId = req.customer.customerId;

            // Delete expired carts first
            await pool.query(
                `DELETE FROM customer_carts 
                 WHERE store_id = $1 AND customer_id = $2 AND expires_at < NOW()`,
                [storeId, customerId]
            );

            const result = await pool.query(
                `SELECT items FROM customer_carts 
                 WHERE store_id = $1 AND customer_id = $2`,
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
            const { items } = req.body;

            await pool.query(
                `INSERT INTO customer_carts (store_id, customer_id, items, updated_at, expires_at)
                 VALUES ($1, $2, $3, NOW(), NOW() + INTERVAL '12 hours')
                 ON CONFLICT (store_id, customer_id)
                 DO UPDATE SET 
                    items = $3,
                    updated_at = NOW(),
                    expires_at = NOW() + INTERVAL '12 hours'`,
                [storeId, customerId, JSON.stringify(items)]
            );

            res.json({ success: true });
        } catch (error) {
            logger.error('Save cart error:', error);
            res.status(500).json({ success: false, error: 'Failed to save cart' });
        }
    },

    // DELETE /api/store/:storeId/cart
    clearCart: async (req, res) => {
        try {
            const { storeId } = req.params;
            const customerId = req.customer.customerId;

            await pool.query(
                `DELETE FROM customer_carts 
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
