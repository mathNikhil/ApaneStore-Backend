const pool = require('../../config/database');
const logger = require('../../config/logger');

class StoreAdminOrdersController {
    // Get all orders for a store
    static async getAll(req, res) {
        try {
            const { storeId } = req.params;
            const { status, search, limit = 50, offset = 0 } = req.query;

            let query = 'SELECT * FROM orders WHERE store_id = $1';
            let params = [storeId];
            let paramIndex = 2;

            if (status && status !== 'all') {
                query += ` AND status = $${paramIndex}`;
                params.push(status);
                paramIndex++;
            }

            if (search) {
                query += ` AND (customer_name ILIKE $${paramIndex} OR customer_email ILIKE $${paramIndex} OR order_id ILIKE $${paramIndex})`;
                params.push(`%${search}%`);
                paramIndex++;
            }

            query += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            params.push(limit, offset);

            const result = await pool.query(query, params);
            
            // Get total count
            const countQuery = 'SELECT COUNT(*) FROM orders WHERE store_id = $1';
            const countResult = await pool.query(countQuery, [storeId]);

            res.status(200).json({
                success: true,
                data: result.rows,
                pagination: {
                    total: parseInt(countResult.rows[0].count),
                    limit: parseInt(limit),
                    offset: parseInt(offset)
                }
            });
        } catch (error) {
            logger.error('❌ Get orders error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to get orders'
            });
        }
    }

    // Get order by ID
    static async getById(req, res) {
        try {
            const { storeId, orderId } = req.params;

            const result = await pool.query(
                `SELECT o.*, 
                        json_agg(oh.* ORDER BY oh.created_at DESC) as status_history
                 FROM orders o
                 LEFT JOIN order_status_history oh ON o.id = oh.order_id
                 WHERE o.id = $1 AND o.store_id = $2
                 GROUP BY o.id`,
                [orderId, storeId]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Order not found'
                });
            }

            res.status(200).json({
                success: true,
                data: result.rows[0]
            });
        } catch (error) {
            logger.error('❌ Get order error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to get order'
            });
        }
    }

    // Update order status
    static async updateStatus(req, res) {
        try {
            const { storeId, orderId } = req.params;
            const { status, note } = req.body;
            const adminId = req.adminId || req.tenantId;

            // Allowed statuses
            const allowedStatuses = ['confirmed', 'processing', 'accepted', 'ready_to_deliver', 'out_for_delivery', 'delivered', 'cancelled'];
            
            if (!allowedStatuses.includes(status)) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid status'
                });
            }

            // Check if order exists and belongs to store
            const checkResult = await pool.query(
                'SELECT id, status FROM orders WHERE id = $1 AND store_id = $2',
                [orderId, storeId]
            );

            if (checkResult.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Order not found'
                });
            }

            const oldStatus = checkResult.rows[0].status;

            // Update order status
            await pool.query(
                'UPDATE orders SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
                [status, orderId]
            );

            // Add to status history
            await pool.query(
                `INSERT INTO order_status_history (order_id, status, changed_by, notes) 
                 VALUES ($1, $2, $3, $4)`,
                [orderId, status, adminId, note || `Status changed from ${oldStatus} to ${status}`]
            );

            logger.info(`✅ Order ${orderId} status updated from ${oldStatus} to ${status}`);

            res.status(200).json({
                success: true,
                message: 'Order status updated successfully',
                data: {
                    order_id: orderId,
                    old_status: oldStatus,
                    new_status: status
                }
            });
        } catch (error) {
            logger.error('❌ Update order status error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to update order status'
            });
        }
    }

    // Get order statistics
    static async getStats(req, res) {
        try {
            const { storeId } = req.params;

            const result = await pool.query(
                `SELECT 
                    COUNT(*) as total_orders,
                    COUNT(CASE WHEN status = 'confirmed' THEN 1 END) as confirmed,
                    COUNT(CASE WHEN status = 'processing' THEN 1 END) as processing,
                    COUNT(CASE WHEN status = 'accepted' THEN 1 END) as accepted,
                    COUNT(CASE WHEN status = 'ready_to_deliver' THEN 1 END) as ready_to_deliver,
                    COUNT(CASE WHEN status = 'out_for_delivery' THEN 1 END) as out_for_delivery,
                    COUNT(CASE WHEN status = 'delivered' THEN 1 END) as delivered,
                    COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled,
                    COALESCE(SUM(total_amount), 0) as total_revenue
                 FROM orders 
                 WHERE store_id = $1`,
                [storeId]
            );

            res.status(200).json({
                success: true,
                data: result.rows[0]
            });
        } catch (error) {
            logger.error('❌ Get stats error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to get stats'
            });
        }
    }
}

module.exports = StoreAdminOrdersController;