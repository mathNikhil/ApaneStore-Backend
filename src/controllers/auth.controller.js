const { logActivity } = require('../middleware/activityLogger');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');
const logger = require('../config/logger');
const OTPService = require('../services/otp.service');
require('dotenv').config();

const AuthController = {
    // Register new tenant
    register: async (req, res) => {
        try {
            const { company_name, email, phone, password, business_type } = req.body;
            
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
                [`TENANT_${Date.now()}`, company_name, email, phone, password, business_type || 'retail']
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

    // Login with email/phone + password
    login: async (req, res) => {
        try {
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

            // ✅ Block hidden tenants before issuing a token
            if (user.status === 'hidden') {
                return res.status(403).json({
                    success: false,
                    message: 'Your account has been disabled. Please contact support.'
                });
            }

            const JWT_SECRET = process.env.JWT_SECRET;
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

    // Send OTP — ✅ now uses the real, rate-limited OTPService (was
    // previously just generating a code, logging it, and never storing it
    // anywhere — meaning verification could never have actually checked it
    // against anything real).
    sendOTP: async (req, res) => {
        try {
            const { phone } = req.body;
            
            if (!phone || phone.length !== 10) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid phone number'
                });
            }

            // ✅ Block hidden tenants right here, before an OTP is ever sent —
            // otherwise they'd still see the OTP entry screen and only get
            // blocked after typing a code in, which is confusing. A brand-new
            // phone number (no tenant row yet) is fine to proceed as normal.
            const existing = await pool.query(
                'SELECT status FROM tenants WHERE phone = $1',
                [phone]
            );
            if (existing.rows.length > 0 && existing.rows[0].status === 'hidden') {
                return res.status(403).json({
                    success: false,
                    message: 'Your account has been disabled. Please contact support.'
                });
            }

            const ipAddress = req.ip || req.headers['x-forwarded-for'] || null;
            const result = await OTPService.sendOTP(phone, null, 'tenant_login', ipAddress);

            if (!result.success) {
                return res.status(result.rateLimited ? 429 : 500).json({
                    success: false,
                    message: result.error || 'Failed to send OTP'
                });
            }

            res.json({
                success: true,
                message: 'OTP sent successfully',
                data: {
                    test_otp: result.test_otp,
                    expires_in: 300
                }
            });
        } catch (error) {
            console.error('Send OTP error:', error);
            res.status(500).json({
                success: false,
                message: error.message || 'Failed to send OTP'
            });
        }
    },

    // ✅ FIX: previously accepted ANY 6-character input as a valid OTP
    // ("For testing - accept any 6-digit OTP") — a complete authentication
    // bypass, since it never actually checked the submitted code against
    // anything. Now genuinely verifies against the code OTPService stored,
    // with expiry and a failed-attempt limit.
    verifyOTP: async (req, res) => {
        try {
            const { phone, otp } = req.body;
            
            if (!phone || !otp) {
                return res.status(400).json({
                    success: false,
                    message: 'Phone and OTP are required'
                });
            }

            const verifyResult = await OTPService.verifyOTP(phone, otp, 'tenant_login');
            if (!verifyResult.valid) {
                return res.status(400).json({
                    success: false,
                    message: verifyResult.error || 'Invalid OTP'
                });
            }

            const JWT_SECRET = process.env.JWT_SECRET;
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
                    [`TENANT_${Date.now()}`, `User ${phone}`, `${phone}@temp.com`, phone, 'temp_password']
                );
                tenant = insertResult.rows[0];
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

            console.log(`✅ Token generated for ${phone}`);

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