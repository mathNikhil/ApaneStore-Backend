const pool = require('../config/database');
const logger = require('../config/logger');

class PublicStoreController {
    // Only ever returns stores that are actually published — a draft store
    // should not be visible to the public just because someone guesses its
    // subdomain.
    static async getBySubdomain(req, res) {
        try {
            const { subdomain } = req.params;

            const result = await pool.query(
                `SELECT id, store_id, store_name, subdomain, status, config 
                 FROM stores 
                 WHERE subdomain = $1 AND status = 'published'`,
                [subdomain]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Store not found or not published'
                });
            }

            res.status(200).json({
                success: true,
                data: result.rows[0]
            });
        } catch (error) {
            logger.error('❌ Public store fetch error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to load store'
            });
        }
    }
}

module.exports = PublicStoreController;
