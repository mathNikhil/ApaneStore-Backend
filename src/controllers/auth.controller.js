const { logActivity } = require('../middleware/activityLogger');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');
const logger = require('../config/logger');
// OTPService intentionally removed — tenant OTP login is disabled for real users.
// Primary auth is Google. Test-user OTP uses a hardcoded code (no SMS service needed).
require('dotenv').config();

const AuthController = {
    // Register new tenant
    register: async (req, res) => {
        try {
            const { company_name, email, phone, password } = req.body;
            const business_type = 'tenant'; // SECURITY: never trust business_type from caller
            
            // Check if user exists
            const existing = await pool.query(
                'SELECT * FROM tenants WHERE email = $1 OR phone = $1',
                [email, phone]
            );
            
            if (existing.rows.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: 'User already exists'
                });
            }

            const result = await pool.query(
                `INSERT INTO tenants (tenant_id, company_name, email, phone, password_hash, business_type, is_verified, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, true, NOW())
                 RETURNING id, tenant_id, company_name, email, phone, business_type, created_at`,
                [`TENANT_${Date.now()}`, company_name, email, phone, password, business_type]
            );

            res.json({
                success: true,
                message: 'Registration successful',
                data: result.rows[0]
            });
        } catch (error) {
            console.error('Register error:', error);
            res.status(500).json({
                success: false,
                message: error.message || 'Registration failed'
            });
        }
    },

    // Login with email/phone + password — DISABLED (SEC-005)
    // Primary login is Google auth. This endpoint stored passwords in plain
    // text and compared without bcrypt. Disabled rather than deleted so any
    // caller gets a clear error instead of 404.
    login: async (req, res) => {
        return res.status(410).json({
            success: false,
            message: 'Password login is no longer supported. Please sign in with Google.'
        });
        try {  // dead code kept for reference, remove after confirmed stable
            const { identifier, password } = req.body;

            const result = await pool.query(
                'SELECT * FROM tenants WHERE email = $1 OR phone = $1',
                [identifier]
            );
            
            if (result.rows.length === 0) {
                return res.status(401).json({
                    success: false,
                    message: 'Invalid credentials'
                });
            }

            const user = result.rows[0];

            // In production, use bcrypt.compare()
            if (user.password_hash !== password) {
                return res.status(401).json({
                    success: false,
                    message: 'Invalid credentials'
                });
            }

            // Block soft-deleted tenants from logging in
            if (user.deleted_at !== null && user.deleted_at !== undefined) {
                return res.status(403).json({
                    success: false,
                    message: 'This account has been deleted. Please contact support.'
                });
            }

            // Block hidden tenants before issuing a token
            if (user.status === 'hidden') {
                return res.status(403).json({
                    success: false,
                    message: 'Your account has been disabled. Please contact support.'
                });
            }

            const JWT_SECRET = process.env.JWT_SECRET;
const discountService = require('../services/discount.service');
            const token = jwt.sign(
                { 
                    userId: user.id,
                    tenantId: user.id,
                    phone: user.phone,
                    email: user.email
                },
                JWT_SECRET,
                { expiresIn: '7d' }
            );

            res.json({
                success: true,
                message: 'Login successful',
                data: {
                    token,
                    tenant: {
                        id: user.id,
                        tenant_id: user.tenant_id,
                        company_name: user.company_name,
                        email: user.email,
                        phone: user.phone
                    }
                }
            });
        } catch (error) {
            console.error('Login error:', error);
            res.status(500).json({
                success: false,
                message: error.message || 'Login failed'
            });
        }
    },

    // sendOTP — TEST USERS ONLY. No SMS is sent; caller knows the hardcoded
    // OTP (201807). Real tenants must use Google auth.
    sendOTP: async (req, res) => {
        try {
            const { phone } = req.body;

            if (!phone || phone.length !== 10) {
                return res.status(400).json({ success: false, message: 'Invalid phone number' });
            }

            const TEST_MOBILES = (process.env.TEST_MOBILES || '').split(',').map(m => m.trim()).filter(Boolean);
            if (!TEST_MOBILES.includes(phone)) {
                return res.status(403).json({
                    success: false,
                    message: 'Mobile login is not available. Please use Google to sign in.'
                });
            }

            // Test path: no SMS sent, caller uses hardcoded OTP 201807
            return res.json({ success: true, message: 'OTP sent successfully' });
        } catch (error) {
            console.error('Send OTP error:', error);
            return res.status(500).json({ success: false, message: 'Failed to send OTP' });
        }
    },

    // verifyOTP — TEST USERS ONLY. Checks TEST_MOBILES list and hardcoded
    // OTP 201807. No database OTP records, no rate limiting — this path
    // exists purely to let internal test accounts log in during development.
    verifyOTP: async (req, res) => {
        try {
            const { phone, otp } = req.body;

            if (!phone || !otp) {
                return res.status(400).json({ success: false, message: 'Phone and OTP are required' });
            }

            const TEST_MOBILES = (process.env.TEST_MOBILES || '').split(',').map(m => m.trim()).filter(Boolean);
            if (!TEST_MOBILES.includes(phone)) {
                return res.status(403).json({
                    success: false,
                    message: 'Mobile login is not available. Please use Google to sign in.'
                });
            }

            if (otp !== '201807') {
                return res.status(400).json({ success: false, message: 'Invalid OTP' });
            }

            const JWT_SECRET = process.env.JWT_SECRET;
            const discountService = require('../services/discount.service');
            if (!JWT_SECRET) {
                console.error('❌ JWT_SECRET is not defined in .env');
                return res.status(500).json({
                    success: false,
                    message: 'Server configuration error'
                });
            }

            // Check if tenant exists
            let result = await pool.query(
                `SELECT * FROM tenants WHERE phone = $1`,
                [phone]
            );

            let tenant;
            if (result.rows.length === 0) {
                // Create new tenant
                const insertResult = await pool.query(
                    `INSERT INTO tenants (tenant_id, company_name, email, phone, password_hash, is_verified, created_at)
                     VALUES ($1, $2, $3, $4, $5, true, NOW())
                     RETURNING id, tenant_id, company_name, email, phone`,
                    [`TENANT_${Date.now()}`, null, null, phone, 'temp_password']
                );
                tenant = insertResult.rows[0];
                // Generate referral code for new tenant
                await discountService.generateReferralCode(tenant.id, null);
                // Save referral if came via ref link
                const refCode = req.body.referralCode || req.headers['x-referral-code'];
                if (refCode) await discountService.saveReferral(tenant.id, refCode);
            } else {
                tenant = result.rows[0];

                // ✅ Block hidden tenants before issuing a token
                if (tenant.status === 'hidden') {
                    return res.status(403).json({
                        success: false,
                        message: 'Your account has been disabled. Please contact support.'
                    });
                }
            }

            // Generate JWT token with both userId and tenantId
            const token = jwt.sign(
                { 
                    userId: tenant.id,
                    tenantId: tenant.id,
                    phone: tenant.phone,
                    email: tenant.email
                },
                JWT_SECRET,
                { expiresIn: '7d' }
            );


            res.json({
                success: true,
                message: 'OTP verified successfully',
                data: {
                    token: token,
                    tenant: {
                        id: tenant.id,
                        tenant_id: tenant.tenant_id,
                        company_name: tenant.company_name,
                        email: tenant.email,
                        phone: tenant.phone
                    }
                }
            });
        } catch (error) {
            console.error('Verify OTP error:', error);
            res.status(500).json({
                success: false,
                message: error.message || 'OTP verification failed'
            });
        }
    },

    // Refresh token
    refreshToken: async (req, res) => {
        try {
            const { token } = req.body;
            const JWT_SECRET = process.env.JWT_SECRET;
const discountService = require('../services/discount.service');
            
            const decoded = jwt.verify(token, JWT_SECRET);
            
            const newToken = jwt.sign(
                { 
                    userId: decoded.userId,
                    tenantId: decoded.tenantId,
                    phone: decoded.phone,
                    email: decoded.email
                },
                JWT_SECRET,
                { expiresIn: '7d' }
            );

            res.json({
                success: true,
                data: { token: newToken }
            });
        } catch (error) {
            console.error('Refresh token error:', error);
            res.status(401).json({
                success: false,
                message: 'Invalid or expired token'
            });
        }
    },

    // Logout
    logout: async (req, res) => {
        try {
            res.json({
                success: true,
                message: 'Logged out successfully'
            });
        } catch (error) {
            console.error('Logout error:', error);
            res.status(500).json({
                success: false,
                message: error.message || 'Logout failed'
            });
        }
    }
};

module.exports = AuthController;