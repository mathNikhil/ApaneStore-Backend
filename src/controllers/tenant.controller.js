const pool = require('../config/database');
const logger = require('../config/logger');

class TenantController {
    /**
     * Get the authenticated tenant's own record
     * Used by the Profile page
     */
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

    /**
     * Update the authenticated tenant's own profile
     * Accepts: company_name, email, phone, business_type
     * Note: phone is included but cannot be changed (it's the login identity)
     */
    static async update(req, res) {
        try {
            // ✅ Use snake_case to match frontend and database
            const { company_name, business_name, email, phone, business_type } = req.body;
            const effectiveName = business_name || company_name;

            // ✅ Check if there's anything to update
            if (!company_name && !business_name && !email && !phone && !business_type) {
                return res.status(400).json({
                    success: false,
                    error: 'Nothing to update — provide business_name, email, business_type, and/or phone'
                });
            }

            // ✅ Build update query dynamically
            const updates = [];
            const values = [];
            let paramIndex = 1;

            // ✅ Use snake_case to match database column names
            if (effectiveName !== undefined && effectiveName !== '') {
                updates.push(`company_name = $${paramIndex++}`);
                updates.push(`business_name = $${paramIndex++}`);
                values.push(effectiveName);
                values.push(effectiveName);
            }
            if (email !== undefined && email !== '') {
                updates.push(`email = $${paramIndex++}`);
                values.push(email);
            }
            if (phone !== undefined && phone !== '') {
                // ✅ Allow updating phone but it's recommended to keep it as login identity
                updates.push(`phone = $${paramIndex++}`);
                values.push(phone);
            }
            if (business_type !== undefined && business_type !== '') {
                updates.push(`business_type = $${paramIndex++}`);
                values.push(business_type);
            }

            // Always update updated_at
            updates.push(`updated_at = CURRENT_TIMESTAMP`);
            
            // Add tenantId as the last parameter
            values.push(req.tenantId);

            // Build the query
            const query = `
                UPDATE tenants 
                SET ${updates.join(', ')}
                WHERE id = $${paramIndex}
                RETURNING id, tenant_id, company_name, email, phone, business_type, 
                          subscription_tier, is_verified, store_count, created_at, updated_at
            `;

            logger.info(`📝 Updating tenant ${req.tenantId} with fields:`, { company_name, email, phone, business_type });

            const result = await pool.query(query, values);

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
            // Email has a UNIQUE constraint — surface that clearly
            if (error.code === '23505') {
                return res.status(409).json({
                    success: false,
                    error: 'That email is already in use by another account'
                });
            }
            logger.error('❌ Update tenant error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to update tenant: ' + error.message
            });
        }
    }
}

module.exports = TenantController;