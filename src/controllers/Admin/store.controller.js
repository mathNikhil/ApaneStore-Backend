const pool = require('../../config/database');
const logger = require('../../config/logger');

class AdminStoreController {
    // Get all stores with tenant info
    static async getAll(req, res) {
        try {
            const result = await pool.query(
                `SELECT 
                    s.id,
                    s.store_id,
                    s.store_name,
                    s.subdomain,
                    s.custom_domain,
                    s.status,
                    s.created_at,
                    s.last_deployed_at,
                    t.id AS tenant_id,
                    t.company_name AS tenant_name,
                    COALESCE(
                        jsonb_object_agg(sp.panel_type, sp.is_enabled) FILTER (WHERE sp.panel_type IS NOT NULL),
                        '{"admin": true}'
                    ) AS permissions
                 FROM stores s
                 JOIN tenants t ON s.tenant_id = t.id
                 LEFT JOIN store_permissions sp ON s.id = sp.store_id
                 WHERE t.business_type IS NULL OR t.business_type != 'admin'
                 GROUP BY s.id, t.id
                 ORDER BY s.created_at DESC`
            );

            res.status(200).json({
                success: true,
                data: result.rows
            });
        } catch (error) {
            logger.error('❌ Get stores error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to get stores'
            });
        }
    }

    // Get store by ID with full details
    static async getById(req, res) {
        try {
            const { id } = req.params;

            const result = await pool.query(
                `SELECT 
                    s.id,
                    s.store_id,
                    s.store_name,
                    s.subdomain,
                    s.custom_domain,
                    s.status,
                    s.config,
                    s.created_at,
                    s.last_deployed_at,
                    s.hosting_details,
                    s.updated_at,
                    t.id AS tenant_id,
                    t.company_name AS tenant_name,
                    t.email AS tenant_email,
                    t.phone AS tenant_phone,
                    COALESCE(
                        jsonb_object_agg(sp.panel_type, sp.is_enabled) FILTER (WHERE sp.panel_type IS NOT NULL),
                        '{"admin": true}'
                    ) AS permissions
                 FROM stores s
                 JOIN tenants t ON s.tenant_id = t.id
                 LEFT JOIN store_permissions sp ON s.id = sp.store_id
                 WHERE s.id = $1
                 GROUP BY s.id, t.id`,
                [id]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Store not found'
                });
            }

            res.status(200).json({
                success: true,
                data: result.rows[0]
            });
        } catch (error) {
            logger.error('❌ Get store error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to get store'
            });
        }
    }

    // Delete store
    static async delete(req, res) {
        try {
            const { id } = req.params;

            const checkResult = await pool.query(
                'SELECT id FROM stores WHERE id = $1',
                [id]
            );

            if (checkResult.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Store not found'
                });
            }

            // Delete store (cascade will delete products, orders)
            await pool.query('DELETE FROM stores WHERE id = $1', [id]);

            logger.info(`✅ Store ${id} deleted`);

            res.status(200).json({
                success: true,
                message: 'Store deleted successfully'
            });
        } catch (error) {
            logger.error('❌ Delete store error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to delete store'
            });
        }
    }
}

module.exports = AdminStoreController;