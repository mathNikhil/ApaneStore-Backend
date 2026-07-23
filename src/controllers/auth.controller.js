const AuthService = require('../services/auth.service');
const OTPService = require('../services/otp.service');
const logger = require('../config/logger');

class AuthController {
    // Register new tenant
    static async register(req, res) {
        console.log('📝 Register function called');
        try {
            const { companyName, email, phone, password, businessType } = req.body;

            console.log('📊 Register data:', { companyName, email, phone, businessType });

            // Validate required fields
            if (!companyName || !email || !phone || !password) {
                return res.status(400).json({
                    success: false,
                    error: 'All fields are required: companyName, email, phone, password'
                });
            }

            const result = await AuthService.register(
                companyName,
                email,
                phone,
                password,
                businessType
            );

            if (!result.success) {
                return res.status(400).json(result);
            }

            return res.status(201).json({
                success: true,
                message: 'Registration successful! Please verify your email.',
                data: {
                    tenant: result.tenant,
                    token: result.token
                }
            });
        } catch (error) {
            console.error('❌ Registration controller error:', error);
            logger.error('❌ Registration controller error:', error);
            return res.status(500).json({
                success: false,
                error: 'Registration failed: ' + error.message
            });
        }
    }

    // Login tenant
    static async login(req, res) {
        console.log('🔑 Login function called');
        try {
            const { identifier, password } = req.body;

            console.log('📊 Login data:', { identifier });

            if (!identifier || !password) {
                return res.status(400).json({
                    success: false,
                    error: 'Identifier and password are required'
                });
            }

            const result = await AuthService.login(identifier, password);

            if (!result.success) {
                return res.status(401).json(result);
            }

            return res.status(200).json({
                success: true,
                message: 'Login successful!',
                data: {
                    tenant: result.tenant,
                    token: result.token
                }
            });
        } catch (error) {
            console.error('❌ Login controller error:', error);
            logger.error('❌ Login controller error:', error);
            return res.status(500).json({
                success: false,
                error: 'Login failed: ' + error.message
            });
        }
    }

    // Refresh token
    static async refreshToken(req, res) {
        console.log('🔄 Refresh token function called');
        try {
            res.status(200).json({
                success: true,
                message: 'Token refreshed',
                data: {
                    token: 'new_sample_token'
                }
            });
        } catch (error) {
            console.error('❌ Refresh token error:', error);
            logger.error('❌ Refresh token error:', error);
            res.status(500).json({
                success: false,
                error: 'Token refresh failed'
            });
        }
    }

    // Logout
    static async logout(req, res) {
        console.log('🚪 Logout function called');
        try {
            res.status(200).json({
                success: true,
                message: 'Logged out successfully'
            });
        } catch (error) {
            console.error('❌ Logout error:', error);
            logger.error('❌ Logout error:', error);
            res.status(500).json({
                success: false,
                error: 'Logout failed'
            });
        }
    }

    // Get current tenant profile
    static async getProfile(req, res) {
        console.log('👤 Profile function called');
        try {
            res.status(200).json({
                success: true,
                message: 'Profile endpoint - implement auth middleware first'
            });
        } catch (error) {
            console.error('❌ Profile error:', error);
            logger.error('❌ Profile error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to get profile'
            });
        }
    }

    // Send OTP
    static async sendOTP(req, res) {
        console.log('📱 Send OTP function called');
        try {
            const { phone, email, purpose = 'login' } = req.body;

            if (!phone) {
                return res.status(400).json({
                    success: false,
                    error: 'Phone number is required'
                });
            }

            const result = await OTPService.sendOTP(phone, email, purpose);

            if (!result.success) {
                return res.status(400).json(result);
            }

            res.status(200).json({
                success: true,
                message: 'OTP sent successfully',
                data: {
                    phone,
                    purpose,
                    test_otp: result.test_otp
                }
            });
        } catch (error) {
            console.error('❌ Send OTP error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to send OTP'
            });
        }
    }

    // Verify OTP
    static async verifyOTP(req, res) {
        console.log('✅ Verify OTP function called');
        try {
            const { phone, otp, purpose = 'login' } = req.body;

            if (!phone || !otp) {
                return res.status(400).json({
                    success: false,
                    error: 'Phone and OTP are required'
                });
            }

            const result = await OTPService.verifyOTP(phone, otp, purpose);

            if (!result.valid) {
                return res.status(400).json(result);
            }

            // For login/signup, OTP verification IS the auth step — find or
            // create the tenant and issue a real session token here, rather
            // than making the frontend make a second call.
            if (purpose === 'login' || purpose === 'signup') {
                const loginResult = await AuthService.loginOrRegisterByPhone(phone);
                if (!loginResult.success) {
                    return res.status(500).json(loginResult);
                }
                return res.status(200).json({
                    success: true,
                    message: 'OTP verified successfully',
                    data: {
                        tenant: loginResult.tenant,
                        token: loginResult.token,
                        isNewTenant: loginResult.isNewTenant
                    }
                });
            }

            res.status(200).json({
                success: true,
                message: 'OTP verified successfully'
            });
        } catch (error) {
            console.error('❌ Verify OTP error:', error);
            res.status(500).json({
                success: false,
                error: 'OTP verification failed'
            });
        }
    }
}

module.exports = AuthController;