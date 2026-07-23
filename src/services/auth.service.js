const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const pool = require('../config/database');
const logger = require('../config/logger');
require('dotenv').config();

class AuthService {
    // Register new tenant
    static async register(companyName, email, phone, password, businessType = null) {
        try {
            console.log('📝 Register service called for:', email);
            
            // Check if tenant already exists
            const existing = await pool.query(
                `SELECT id FROM tenants WHERE email = $1 OR phone = $2`,
                [email, phone]
            );

            if (existing.rows.length > 0) {
                return { 
                    success: false, 
                    error: 'Tenant already exists with this email or phone' 
                };
            }

            // Hash password
            const saltRounds = 12;
            const passwordHash = await bcrypt.hash(password, saltRounds);

            // Generate tenant_id
            const timestamp = Date.now().toString().slice(-6);
            const tenantId = `TEN-${timestamp}-${Math.floor(Math.random() * 10000)}`;

            // Insert tenant
            const result = await pool.query(
                `INSERT INTO tenants 
                 (tenant_id, company_name, email, phone, password_hash, business_type, is_verified, trial_ends_at) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7, NOW() + INTERVAL '30 days') 
                 RETURNING id, tenant_id, company_name, email, phone, business_type, subscription_tier, is_verified`,
                [tenantId, companyName, email, phone, passwordHash, businessType, true]
            );

            const tenant = result.rows[0];
            console.log('✅ Tenant created:', tenant.tenant_id);

            // Generate JWT token
            const token = jwt.sign(
                { tenantId: tenant.id, email: tenant.email, role: 'tenant' },
                process.env.JWT_SECRET,
                { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
            );

            logger.info(`✅ New tenant registered: ${companyName} (${email})`);

            return {
                success: true,
                tenant,
                token
            };
        } catch (error) {
            console.error('❌ Registration service error:', error);
            logger.error('❌ Registration error:', error);
            return { success: false, error: 'Registration failed: ' + error.message };
        }
    }

    // Login tenant
    static async login(identifier, password) {
        try {
            console.log('🔑 Login service called for:', identifier);
            
            // Check if identifier is email or phone
            const isEmail = identifier.includes('@');
            const query = isEmail 
                ? `SELECT * FROM tenants WHERE email = $1`
                : `SELECT * FROM tenants WHERE phone = $1`;

            const result = await pool.query(query, [identifier]);

            if (result.rows.length === 0) {
                return { success: false, error: 'Tenant not found' };
            }

            const tenant = result.rows[0];
            console.log('✅ Tenant found:', tenant.tenant_id);

            // Verify password
            const isValid = await bcrypt.compare(password, tenant.password_hash);
            if (!isValid) {
                return { success: false, error: 'Invalid credentials' };
            }

            // Update last login
            await pool.query(
                `UPDATE tenants SET last_login_at = NOW() WHERE id = $1`,
                [tenant.id]
            );

            // Generate JWT token
            const token = jwt.sign(
                { tenantId: tenant.id, email: tenant.email, role: 'tenant' },
                process.env.JWT_SECRET,
                { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
            );

            logger.info(`✅ Tenant logged in: ${tenant.company_name} (${tenant.email})`);

            return {
                success: true,
                tenant: {
                    id: tenant.id,
                    tenant_id: tenant.tenant_id,
                    company_name: tenant.company_name,
                    email: tenant.email,
                    phone: tenant.phone,
                    subscription_tier: tenant.subscription_tier,
                    is_verified: tenant.is_verified
                },
                token
            };
        } catch (error) {
            console.error('❌ Login service error:', error);
            logger.error('❌ Login error:', error);
            return { success: false, error: 'Login failed: ' + error.message };
        }
    }

    // Verify token
    static verifyToken(token) {
        try {
            return jwt.verify(token, process.env.JWT_SECRET);
        } catch (error) {
            return null;
        }
    }

    // Passwordless login via OTP — used after OTPService.verifyOTP succeeds.
    // If no tenant exists for this phone yet, auto-creates a minimal one
    // (their phone number IS the verification, so it's marked verified
    // immediately). This keeps onboarding to "phone number + OTP", matching
    // the low-friction signup any startup tenant expects.
    static async loginOrRegisterByPhone(phone) {
        try {
            const existing = await pool.query(
                `SELECT id, tenant_id, company_name, email, phone, business_type, subscription_tier, is_verified 
                 FROM tenants WHERE phone = $1`,
                [phone]
            );

            let tenant;
            let isNewTenant = false;

            if (existing.rows.length > 0) {
                tenant = existing.rows[0];
                if (!tenant.is_verified) {
                    await pool.query('UPDATE tenants SET is_verified = true WHERE id = $1', [tenant.id]);
                    tenant.is_verified = true;
                }
            } else {
                const timestamp = Date.now().toString().slice(-6);
                const tenantId = `TEN-${timestamp}-${Math.floor(Math.random() * 10000)}`;
                // email is UNIQUE NOT NULL in schema but not collected during OTP
                // signup — use a synthetic placeholder tied to the phone number;
                // the tenant can set a real one later from their profile.
                const placeholderEmail = `${phone}@placeholder.apnaestore.local`;
                const passwordHash = await bcrypt.hash(crypto.randomUUID(), 12);

                const inserted = await pool.query(
                    `INSERT INTO tenants (tenant_id, company_name, email, phone, password_hash, is_verified)
                     VALUES ($1, $2, $3, $4, $5, true)
                     RETURNING id, tenant_id, company_name, email, phone, business_type, subscription_tier, is_verified`,
                    [tenantId, 'My Store', placeholderEmail, phone, passwordHash]
                );
                tenant = inserted.rows[0];
                isNewTenant = true;
                logger.info(`✅ New tenant auto-registered via OTP: ${phone}`);
            }

            const token = jwt.sign(
                { tenantId: tenant.id, phone: tenant.phone, role: 'tenant' },
                process.env.JWT_SECRET,
                { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
            );

            logger.info(`✅ Tenant OTP login: ${tenant.phone}`);

            return { success: true, tenant, token, isNewTenant };
        } catch (error) {
            console.error('❌ OTP login/register error:', error);
            logger.error('❌ OTP login/register error:', error);
            return { success: false, error: 'Login failed: ' + error.message };
        }
    }
}

module.exports = AuthService;