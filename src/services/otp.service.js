const crypto = require('crypto');
const pool = require('../config/database');
const logger = require('../config/logger');

// ✅ Shared OTP service for BOTH tenant login and customer login — real
// rate limiting lives here in one place, so both flows are protected
// identically rather than needing the same logic duplicated twice.
//
// Three separate limits, each catching a different abuse pattern:
//  - Resend cooldown: stops rapid double-clicks / accidental double-sends
//    to the same phone (each SMS costs money regardless of who pays).
//  - Per-phone window: stops someone hammering ONE phone number with
//    repeated OTP requests.
//  - Per-IP window: stops someone spraying requests across MANY different
//    phone numbers from one source — a phone-level limit alone wouldn't
//    catch this, since each individual number would still look "fine."
//  - Per-phone failed-verify limit: stops brute-forcing a 6-digit OTP
//    (1,000,000 possible codes) within its validity window.
const RESEND_COOLDOWN_SECONDS = 60;
const PHONE_WINDOW_MINUTES = 10;
const PHONE_WINDOW_MAX = 3;
const IP_WINDOW_MINUTES = 60;
const IP_WINDOW_MAX = 10;
const MAX_VERIFY_ATTEMPTS = 5;

class OTPService {
    static generateOTP(length = 6) {
        return crypto.randomInt(100000, 999999).toString();
    }

    // Send OTP — now rate-limited. Returns { success: false, rateLimited: true, error }
    // when blocked, so callers can respond with 429 instead of 200.
    static async sendOTP(phone, email = null, purpose = 'login', ipAddress = null) {
        try {
            // 1. Resend cooldown — most recent OTP to this phone+purpose
            const lastResult = await pool.query(
                `SELECT created_at FROM otp_audit
                 WHERE phone = $1 AND purpose = $2
                 ORDER BY created_at DESC LIMIT 1`,
                [phone, purpose]
            );
            if (lastResult.rows.length > 0) {
                const secondsSinceLast = (Date.now() - new Date(lastResult.rows[0].created_at).getTime()) / 1000;
                if (secondsSinceLast < RESEND_COOLDOWN_SECONDS) {
                    const waitSeconds = Math.ceil(RESEND_COOLDOWN_SECONDS - secondsSinceLast);
                    return {
                        success: false,
                        rateLimited: true,
                        error: `Please wait ${waitSeconds} seconds before requesting another OTP`,
                    };
                }
            }

            // 2. Per-phone window — total sends to this phone recently
            const phoneCountResult = await pool.query(
                `SELECT COUNT(*) FROM otp_audit
                 WHERE phone = $1 AND purpose = $2 AND created_at > NOW() - INTERVAL '${PHONE_WINDOW_MINUTES} minutes'`,
                [phone, purpose]
            );
            if (parseInt(phoneCountResult.rows[0].count, 10) >= PHONE_WINDOW_MAX) {
                return {
                    success: false,
                    rateLimited: true,
                    error: `Too many OTP requests for this number. Please try again in ${PHONE_WINDOW_MINUTES} minutes.`,
                };
            }

            // 3. Per-IP window — catches spraying requests across many phones
            if (ipAddress) {
                const ipCountResult = await pool.query(
                    `SELECT COUNT(*) FROM otp_audit
                     WHERE ip_address = $1 AND created_at > NOW() - INTERVAL '${IP_WINDOW_MINUTES} minutes'`,
                    [ipAddress]
                );
                if (parseInt(ipCountResult.rows[0].count, 10) >= IP_WINDOW_MAX) {
                    return {
                        success: false,
                        rateLimited: true,
                        error: 'Too many requests from this device. Please try again later.',
                    };
                }
            }

            const otp = this.generateOTP();
            const expiresIn = 300; // 5 minutes

            await pool.query(
                `INSERT INTO otp_audit (phone, email, code, purpose, expires_at, ip_address)
                 VALUES ($1, $2, $3, $4, NOW() + INTERVAL '${expiresIn} seconds', $5)`,
                [phone, email, otp, purpose, ipAddress]
            );

            // In production, send via SMS/Email
            console.log(`📱 OTP for ${phone}: ${otp}`);
            console.log(`📧 Email: ${email || 'N/A'}`);

            logger.info(`📱 OTP sent to ${phone} for ${purpose}`);

            return {
                success: true,
                message: 'OTP sent successfully',
                // Remove in production
                test_otp: otp,
            };
        } catch (error) {
            logger.error('❌ Send OTP error:', error);
            return {
                success: false,
                error: 'Failed to send OTP',
            };
        }
    }

    // Verify OTP — now also enforces a failed-attempt limit per phone,
    // so a 6-digit code can't just be brute-forced with automated requests.
    static async verifyOTP(phone, otp, purpose = 'login') {
        try {
            const result = await pool.query(
                `SELECT * FROM otp_audit
                 WHERE phone = $1 AND purpose = $2
                 AND is_used = false AND expires_at > NOW()
                 ORDER BY created_at DESC LIMIT 1`,
                [phone, purpose]
            );

            if (result.rows.length === 0) {
                return {
                    valid: false,
                    error: 'Invalid or expired OTP. Please request a new one.',
                };
            }

            const record = result.rows[0];

            if ((record.attempts || 0) >= MAX_VERIFY_ATTEMPTS) {
                return {
                    valid: false,
                    error: 'Too many failed attempts. Please request a new OTP.',
                };
            }

            if (record.code !== otp) {
                await pool.query(`UPDATE otp_audit SET attempts = attempts + 1 WHERE id = $1`, [record.id]);
                return {
                    valid: false,
                    error: 'Invalid or expired OTP',
                };
            }

            await pool.query(`UPDATE otp_audit SET is_used = true WHERE id = $1`, [record.id]);

            logger.info(`✅ OTP verified for ${phone}`);

            return {
                valid: true,
                message: 'OTP verified successfully',
            };
        } catch (error) {
            logger.error('❌ Verify OTP error:', error);
            return {
                valid: false,
                error: 'OTP verification failed',
            };
        }
    }
}

module.exports = OTPService;
