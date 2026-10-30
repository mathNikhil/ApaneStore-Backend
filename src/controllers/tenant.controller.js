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
                `SELECT id, tenant_id, company_name, business_name, full_name, email, phone, business_type, 
                        gst_number, state, address, city, pincode,
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
     * Accepts: company_name, email, phone, business_type (tenant categories only)
     * Note: phone is included but cannot be changed (it's the login identity)
     * SECURITY: business_type is validated against allowed tenant categories.
     *           'admin' is never a valid value here — admin accounts are created
     *           only through the seeder script by a sysadmin.
     */
    static async update(req, res) {
        // SECURITY: Only these values are valid tenant business types.
        // 'admin' is intentionally excluded — it can never be self-assigned.
        const ALLOWED_BUSINESS_TYPES = new Set([
            'retail', 'fashion', 'electronics', 'grocery', 'food', 'pharmacy',
            'beauty', 'sports', 'books', 'furniture', 'jewelry', 'toys',
            'automotive', 'hardware', 'pet', 'flowers', 'art', 'tenant'
        ]);

        try {
            // ✅ Use snake_case to match frontend and database
            const { company_name, business_name, email, phone, business_type, gst_number, state, address, full_name } = req.body;
            const effectiveName = business_name || company_name;

            // SECURITY: Reject any attempt to set business_type to 'admin' or any unknown value
            if (business_type !== undefined && business_type !== '' && !ALLOWED_BUSINESS_TYPES.has(business_type)) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid business type'
                });
            }

            // ✅ Check if there's anything to update
            if (!company_name && !business_name && !email && !phone && !business_type && gst_number === undefined && !state && !address && !full_name) {
                return res.status(400).json({
                    success: false,
                    error: 'Nothing to update'
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
                // Safe: validated against ALLOWED_BUSINESS_TYPES above
                updates.push(`business_type = $${paramIndex++}`);
                values.push(business_type);
            }
            if (full_name !== undefined && full_name !== '') {
                updates.push(`full_name = $${paramIndex++}`);
                values.push(full_name);
            }
            if (gst_number !== undefined) {
                updates.push(`gst_number = $${paramIndex++}`);
                values.push(gst_number);
            }
            if (state !== undefined && state !== '') {
                updates.push(`state = $${paramIndex++}`);
                values.push(state);
            }
            if (address !== undefined && address !== '') {
                updates.push(`address = $${paramIndex++}`);
                values.push(address);
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

            logger.info(`📝 Updating tenant ${req.tenantId} with fields:`, { company_name, email, phone, business_type: business_type || '[unchanged]' });

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