const pool = require('../../config/database');
const logger = require('../../config/logger');

class StoreAdminCustomersController {
    static async getAll(req, res) {
        try {
            const { storeId } = req.params;
            const { search, limit = 50, offset = 0 } = req.query;

            let query = 'SELECT * FROM customers WHERE store_id = $1';
            let params = [storeId];
            let paramIndex = 2;

            if (search) {
                query += ` AND (name ILIKE $${paramIndex} OR email ILIKE $${paramIndex} OR phone ILIKE $${paramIndex})`;
                params.push(`%${search}%`);
                paramIndex++;
            }

            query += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            params.push(limit, offset);

            const result = await pool.query(query, params);

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