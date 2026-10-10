const express = require('express');
const router = express.Router();
const { OAuth2Client } = require('google-auth-library');
const pool = require('../config/database');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Verify Google ID token and login/register tenant
router.post('/google', async (req, res) => {
    try {
        const { credential } = req.body;
        if (!credential) return res.status(400).json({ success: false, error: 'No credential provided' });

        // Verify the Google token
        const ticket = await client.verifyIdToken({
            idToken: credential,
            audience: process.env.GOOGLE_CLIENT_ID,
        });
        const payload = ticket.getPayload();
        const { sub: googleId, email, name, picture } = payload;

        // Check if tenant exists by google_id or email
        let tenant = null;
        const byGoogle = await pool.query(
            'SELECT * FROM tenants WHERE google_id=$1 LIMIT 1', [googleId]
        );
        if (byGoogle.rows.length > 0) {
            tenant = byGoogle.rows[0];
        } else {
            const byEmail = await pool.query(
                'SELECT * FROM tenants WHERE email=$1 LIMIT 1', [email]
            );
            if (byEmail.rows.length > 0) {
                tenant = byEmail.rows[0];
                // Link google_id to existing tenant
                await pool.query('UPDATE tenants SET google_id=$1 WHERE id=$2', [googleId, tenant.id]);
            }
        }

        if (tenant) {
            // Update google_id if not set
            if (!tenant.google_id) {
                await pool.query('UPDATE tenants SET google_id=$1 WHERE id=$2', [googleId, tenant.id]);
            }
            const token = jwt.sign(
                { tenantId: tenant.id, email: tenant.email, role: 'tenant' },
                process.env.JWT_SECRET,
                { expiresIn: '30d' }
            );
            return res.json({
                success: true,
                isNewTenant: false,
                token,
                tenant: {
                    id: tenant.id,
                    email: tenant.email,
                    company_name: tenant.company_name,
                    business_type: tenant.business_type,
                    is_verified: tenant.is_verified,
                }
            });
        } else {
            // Not found by google_id or email — could be existing phone tenant
            // Return google profile, frontend will ask for phone to link or complete new registration
            return res.json({
                success: true,
                isNewTenant: true,
                googleId,
                email,
                name,
                picture,
            });
        }
    } catch (e) {
        console.error('Google auth error:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Link existing phone tenant to Google account
router.post('/google/link-phone', async (req, res) => {
    try {
        const { googleId, email, name, phone } = req.body;
        if (!googleId || !phone) return res.status(400).json({ success: false, error: 'Missing fields' });

        const phoneClean = phone.replace(/\D/g, '');
        const existing = await pool.query(
            'SELECT * FROM tenants WHERE phone=$1 LIMIT 1', [phoneClean]
        );

        if (existing.rows.length > 0) {
            const tenant = existing.rows[0];
            // Link google_id and update email if needed
            await pool.query(
                'UPDATE tenants SET google_id=$1, email=COALESCE(NULLIF(email,\'\'), $2) WHERE id=$3',
                [googleId, email, tenant.id]
            );
            const token = jwt.sign(
                { tenantId: tenant.id, email: tenant.email || email, role: 'tenant' },
                process.env.JWT_SECRET,
                { expiresIn: '30d' }
            );
            return res.json({
                success: true,
                linked: true,
                token,
                tenant: {
                    id: tenant.id,
                    email: tenant.email || email,
                    company_name: tenant.company_name,
                    business_type: tenant.business_type,
                    is_verified: tenant.is_verified,
                }
            });
        } else {
            // Phone not found — new tenant
            return res.json({ success: true, linked: false });
        }
    } catch(e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Complete registration for new Google tenant
router.post('/google/complete', async (req, res) => {
    try {
        const { googleId, email, name, company_name, business_type, phone } = req.body;
        if (!googleId || !email || !company_name || !business_type || !phone) {
            return res.status(400).json({ success: false, error: 'Missing required fields. Mobile number is mandatory.' });
        }

        // Check email not already taken
        const existing = await pool.query('SELECT id FROM tenants WHERE email=$1 LIMIT 1', [email]);
        if (existing.rows.length > 0) {
            return res.status(400).json({ success: false, error: 'Email already registered' });
        }

        // Create new tenant
        const tenantId = 'TNT-' + Date.now();
        const result = await pool.query(
            `INSERT INTO tenants (tenant_id, email, company_name, business_type, phone, google_id, is_verified, status, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, true, 'active', NOW())
             RETURNING *`,
            [tenantId, email, company_name, business_type, phone || null, googleId]
        );
        const tenant = result.rows[0];

        const token = jwt.sign(
            { tenantId: tenant.id, email: tenant.email, role: 'tenant' },
            process.env.JWT_SECRET,
            { expiresIn: '30d' }
        );

        res.json({
            success: true,
            isNewTenant: false,
            token,
            tenant: {
                id: tenant.id,
                email: tenant.email,
                company_name: tenant.company_name,
                business_type: tenant.business_type,
                is_verified: true,
            }
        });
    } catch (e) {
        console.error('Google complete error:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

module.exports = router;
