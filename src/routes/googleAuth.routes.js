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

        const isNewTenant = !tenant;

        if (tenant) {
            // Existing tenant — issue JWT
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
            // New tenant — return Google profile, frontend will show completion form
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
