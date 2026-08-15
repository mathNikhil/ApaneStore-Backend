const pool = require('../../config/database');
const logger = require('../../config/logger');

class StoreAdminCustomersController {
    static async getAll(req, res) {
        try {
            const { storeId } = req.params;
            const { search, limit = 50, offset = 0 } = req.query;

            let baseQuery = `
                SELECT c.id, c.customer_id, c.store_id, c.phone, c.name, c.email, c.created_at,
                    ca.address_line1, ca.address_line2, ca.city, ca.state,
                    ca.pincode, ca.landmark, ca.recipient_name, ca.recipient_mobile
                FROM customers c
                LEFT JOIN customer_addresses ca ON ca.customer_id = c.id AND ca.is_default = true
                WHERE c.store_id = $1
            `;
            let params = [storeId];
            let paramIndex = 2;

            if (search) {
                baseQuery += ` AND (c.name ILIKE $${paramIndex} OR c.email ILIKE $${paramIndex} OR c.phone ILIKE $${paramIndex})`;
                params.push(`%${search}%`);
                paramIndex++;
            }

            baseQuery += ` ORDER BY c.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            params.push(limit, offset);

            const result = await pool.query(baseQuery, params);

            const countQuery = 'SELECT COUNT(*) FROM customers WHERE store_id = $1';
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
            logger.error('❌ Get customers error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to get customers'
            });
        }
    }
}

module.exports = StoreAdminCustomersController;
