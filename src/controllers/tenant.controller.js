const pool = require('../config/database');
const logger = require('../config/logger');

class TenantController {
    // Returns the authenticated tenant's own record — used by the Profile
    // page. Ignores the :id in the URL and always uses the token's own
    // tenantId, so a tenant can never look up someone else's record by
    // guessing an id.
    static async getById(req, res) {
        try {
            const result = await pool.query(
                `SELECT id, tenant_id, company_name, email, phone, business_type, 
                        subscription_tier, is_verified, store_count, created_at 
                 FROM tenants WHERE id = $1`,
                [req.tenantId]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Tenant not found'
                });
            }

            res.status(200).json({
                success: true,
                data: result.rows[0]
            });
        } catch (error) {
            logger.error('❌ Get tenant error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to get tenant'
            });
        }
    }

    // Updates the authenticated tenant's own profile — company name and
    // email only. Phone is deliberately never accepted here: it's the
    // tenant's login identity (verified via OTP), so changing it here would
    // let someone silently swap their own login credential without
    // re-verification.
    static async update(req, res) {
        try {
            const { companyName, email } = req.body;

            if (!companyName && !email) {
                return res.status(400).json({
                    success: false,
                    error: 'Nothing to update — provide companyName and/or email'
                });
            }

            const result = await pool.query(
                `UPDATE tenants 
                 SET company_name = COALESCE($1, company_name),
                     email = COALESCE($2, email),
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = $3
                 RETURNING id, tenant_id, company_name, email, phone, business_type, 
                           subscription_tier, is_verified, store_count, created_at`,
                [companyName || null, email || null, req.tenantId]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Tenant not found'
                });
            }

            logger.info(`✅ Tenant profile updated: ${req.tenantId}`);

            res.status(200).json({
                success: true,
                message: 'Profile updated successfully',
                data: result.rows[0]
            });
        } catch (error) {
            // Email has a UNIQUE constraint — surface that clearly instead
            // of a generic 500.
            if (error.code === '23505') {
                return res.status(409).json({
                    success: false,
                    error: 'That email is already in use by another account'
                });
            }
            logger.error('❌ Update tenant error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to update tenant'
            });
        }
    }
}

module.exports = TenantController;
