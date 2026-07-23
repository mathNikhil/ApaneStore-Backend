const pool = require('../../config/database');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const logger = require('../../config/logger');
require('dotenv').config();

class AdminAuthController {
    // Super Admin Login
    static async login(req, res) {
        try {
            const { email, password } = req.body;

            if (!email || !password) {
                return res.status(400).json({
                    success: false,
                    error: 'Email and password are required'
                });
            }

            // Check if admin exists
            const result = await pool.query(
                'SELECT * FROM tenants WHERE email = $1 AND business_type = $2',
                [email, 'admin']
            );

            if (result.rows.length === 0) {
                return res.status(401).json({
                    success: false,
                    error: 'Invalid admin credentials'
                });
            }

            const admin = result.rows[0];

            // Verify password
            const isValid = await bcrypt.compare(password, admin.password_hash);
            if (!isValid) {
                return res.status(401).json({
                    success: false,
                    error: 'Invalid admin credentials'
                });
            }

            // Generate token
            const token = jwt.sign(
                { 
                    adminId: admin.id, 
                    email: admin.email, 
                    role: 'super_admin',
                    business_type: admin.business_type
                },
                process.env.JWT_SECRET,
                { expiresIn: '24h' }
            );

            logger.info(`✅ Super Admin logged in: ${email}`);

            res.status(200).json({
                success: true,
                message: 'Admin login successful',
                data: {
                    admin: {
                        id: admin.id,
                        tenant_id: admin.tenant_id,
                        company_name: admin.company_name,
                        email: admin.email,
                        phone: admin.phone,
                        role: 'super_admin'
                    },
                    token
                }
            });
        } catch (error) {
            logger.error('❌ Admin login error:', error);
            res.status(500).json({
                success: false,
                error: 'Admin login failed: ' + error.message
            });
        }
    }

    // Admin Logout
    static async logout(req, res) {
        try {
            // Client side will remove token
            res.status(200).json({
                success: true,
                message: 'Logged out successfully'
            });
        } catch (error) {
            logger.error('❌ Admin logout error:', error);
            res.status(500).json({
                success: false,
                error: 'Logout failed'
            });
        }
    }
}

module.exports = AdminAuthController;