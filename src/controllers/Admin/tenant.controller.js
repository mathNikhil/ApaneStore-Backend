const pool = require('../../config/database');
const logger = require('../../config/logger');

class AdminTenantController {
    // Get all tenants (excluding admin)
    static async getAll(req, res) {
        try {
            const result = await pool.query(
                `SELECT 
                    id, 
                    tenant_id, 
                    company_name, 
                    email, 
                    phone, 
                    business_type,
                    subscription_tier, 
                    status,
                    store_count,
                    is_verified,
                    created_at
                 FROM tenants 
                 WHERE business_type IS NULL OR business_type != 'admin'
                 ORDER BY created_at DESC`
            );

            res.status(200).json({
                success: true,
                data: result.rows
            });
        } catch (error) {
            logger.error('❌ Get tenants error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to get tenants'
            });
        }
    }

    // Get tenant by ID with stores
    static async getById(req, res) {
        try {
            const { id } = req.params;

            // Get tenant details
            const tenantResult = await pool.query(
                `SELECT 
                    id, 
                    tenant_id, 
                    company_name, 
                    email, 
                    phone, 
                    business_type,
                    subscription_tier, 
                    status,
                    store_count,
                    is_verified,
                    created_at
                 FROM tenants 
                 WHERE id = $1 AND (business_type IS NULL OR business_type != 'admin')`,
                [id]
            );

            if (tenantResult.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Tenant not found'
                });
            }

            const tenant = tenantResult.rows[0];

            // Get stores for this tenant with permissions
            const storesResult = await pool.query(
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
                    COALESCE(
                        jsonb_object_agg(sp.panel_type, sp.is_enabled) FILTER (WHERE sp.panel_type IS NOT NULL),
                        '{}'
                    ) AS permissions,
                    s.hosting_details
                 FROM stores s
                 LEFT JOIN store_permissions sp ON s.id = sp.store_id
                 WHERE s.tenant_id = $1
                 GROUP BY s.id
                 ORDER BY s.created_at DESC`,
                [id]
            );

            tenant.stores = storesResult.rows;

            res.status(200).json({
                success: true,
                data: tenant
            });
        } catch (error) {
            logger.error('❌ Get tenant error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to get tenant'
            });
        }
    }

    // Toggle tenant status (Hide/Unhide)
    static async toggleStatus(req, res) {
        try {
            const { id } = req.params;
            const { action } = req.body; // 'hide' or 'unhide'

            const result = await pool.query(
                'SELECT status FROM tenants WHERE id = $1 AND (business_type IS NULL OR business_type != \'admin\')',
                [id]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Tenant not found'
                });
            }

            let newStatus;
            let message;

            if (action === 'hide') {
                newStatus = 'hidden';
                message = 'Tenant hidden successfully';
            } else if (action === 'unhide') {
                newStatus = 'active';
                message = 'Tenant unhidden successfully';
            } else {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid action. Use "hide" or "unhide"'
                });
            }

            await pool.query(
                'UPDATE tenants SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
                [newStatus, id]
            );

            logger.info(`✅ Tenant ${id} status changed to ${newStatus}`);

            res.status(200).json({
                success: true,
                message,
                data: { status: newStatus }
            });
        } catch (error) {
            logger.error('❌ Toggle tenant status error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to toggle tenant status'
            });
        }
    }

    // Delete tenant (Hard delete - removes all data)
    static async delete(req, res) {
        try {
            const { id } = req.params;

            // Check if tenant exists
            const checkResult = await pool.query(
                'SELECT id FROM tenants WHERE id = $1 AND (business_type IS NULL OR business_type != \'admin\')',
                [id]
            );

            if (checkResult.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Tenant not found'
                });
            }

            // Delete tenant (cascade will delete stores, products, orders)
            await pool.query('DELETE FROM tenants WHERE id = $1', [id]);

            logger.info(`✅ Tenant ${id} deleted permanently`);

            res.status(200).json({
                success: true,
                message: 'Tenant deleted successfully'
            });
        } catch (error) {
            logger.error('❌ Delete tenant error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to delete tenant'
            });
        }
    }
}

module.exports = AdminTenantController;