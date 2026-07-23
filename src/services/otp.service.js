const crypto = require('crypto');
const pool = require('../config/database');
const logger = require('../config/logger');

class OTPService {
    // Generate random OTP
    static generateOTP(length = 6) {
        return crypto.randomInt(100000, 999999).toString();
    }

    // Send OTP
    static async sendOTP(phone, email = null, purpose = 'login') {
        try {
            const otp = this.generateOTP();
            const expiresIn = 300; // 5 minutes

            // Store OTP in database
            await pool.query(
                `INSERT INTO otp_audit (phone, email, code, purpose, expires_at) 
                 VALUES ($1, $2, $3, $4, NOW() + INTERVAL '${expiresIn} seconds')`,
                [phone, email, otp, purpose]
            );

            // In production, send via SMS/Email
            console.log(`📱 OTP for ${phone}: ${otp}`);
            console.log(`📧 Email: ${email || 'N/A'}`);

            logger.info(`📱 OTP sent to ${phone} for ${purpose}`);

            return {
                success: true,
                message: 'OTP sent successfully',
                // Remove in production
                test_otp: otp
            };
        } catch (error) {
            logger.error('❌ Send OTP error:', error);
            return {
                success: false,
                error: 'Failed to send OTP'
            };
        }
    }

    // Verify OTP
    static async verifyOTP(phone, otp, purpose = 'login') {
        try {
            const result = await pool.query(
                `SELECT * FROM otp_audit 
                 WHERE phone = $1 AND code = $2 AND purpose = $3 
                 AND is_used = false AND expires_at > NOW()
                 ORDER BY created_at DESC LIMIT 1`,
                [phone, otp, purpose]
            );

            if (result.rows.length === 0) {
                return {
                    valid: false,
                    error: 'Invalid or expired OTP'
                };
            }

            // Mark OTP as used
            await pool.query(
                `UPDATE otp_audit SET is_used = true WHERE id = $1`,
                [result.rows[0].id]
            );

            logger.info(`✅ OTP verified for ${phone}`);

            return {
                valid: true,
                message: 'OTP verified successfully'
            };
        } catch (error) {
            logger.error('❌ Verify OTP error:', error);
            return {
                valid: false,
                error: 'OTP verification failed'
            };
        }
    }
}

module.exports = OTPService;