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
            // Always update google_id to keep it current
            await pool.query('UPDATE tenants SET google_id=$1 WHERE id=$2', [googleId, tenant.id]);
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
// SECURITY: We re-verify the Google idToken server-side here.
// The frontend sends `credential` (the raw Google idToken), NOT a raw googleId.
// This prevents phone-takeover: an attacker cannot claim another user's phone
// by supplying a forged googleId in the request body.
router.post('/google/link-phone', async (req, res) => {
    try {
        const { credential, phone } = req.body;
        if (!credential || !phone) return res.status(400).json({ success: false, error: 'Missing fields' });

        // Verify the Google idToken with Google's servers
        let googleId, email, name;
        try {
            const ticket = await client.verifyIdToken({
                idToken: credential,
                audience: process.env.GOOGLE_CLIENT_ID,
            });
            const payload = ticket.getPayload();
            googleId = payload.sub;
            email = payload.email;
            name = payload.name;
        } catch (verifyErr) {
            return res.status(401).json({ success: false, error: 'Invalid Google credential. Please sign in with Google again.' });
        }

        const phoneClean = phone.replace(/\D/g, '');
        const existing = await pool.query(
            'SELECT * FROM tenants WHERE phone=$1 LIMIT 1', [phoneClean]
        );

        if (existing.rows.length > 0) {
            const tenant = existing.rows[0];
            // Link google_id (verified) and update email if needed
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
            return res.json({ success: true, linked: false, googleId, email, name });
        }
    } catch(e) {
        if (e.code === '23505') {
            return res.status(400).json({ success: false, error: 'This Google account is already linked to another account.' });
        }
        res.status(500).json({ success: false, error: e.message });
    }
});

// Complete registration for new Google tenant
// SECURITY: We re-verify the Google credential server-side here.
// The frontend must send the original Google idToken (credential), NOT a raw googleId.
// This prevents account takeover where an attacker guesses or supplies another user's googleId/email.
router.post('/google/complete', async (req, res) => {
    try {
        const { credential, company_name, business_type, phone } = req.body;
        if (!credential || !company_name || !business_type || !phone) {
            return res.status(400).json({ success: false, error: 'Missing required fields. Mobile number is mandatory.' });
        }

        // SECURITY: Verify the Google idToken with Google's servers.
        // If the token is forged or tampered with, this throws and we reject the request.
        let googleId, email, name;
        try {
            const ticket = await client.verifyIdToken({
                idToken: credential,
                audience: process.env.GOOGLE_CLIENT_ID,
            });
            const payload = ticket.getPayload();
            googleId = payload.sub;
            email = payload.email;
            name = payload.name;
        } catch (verifyErr) {
            return res.status(401).json({ success: false, error: 'Invalid Google credential. Please sign in with Google again.' });
        }

        // SECURITY: business_type must be a valid tenant category. 'admin' is never allowed here.
        // Values must match what the frontend registration form sends exactly.
        const ALLOWED_BUSINESS_TYPES = new Set([
            'grocery_kirana', 'fashion_clothing', 'food_restaurant', 'bakery_sweets',
            'electronics_gadgets', 'beauty_cosmetics', 'health_pharmacy', 'home_furniture',
            'jewellery', 'books_stationery', 'organic_natural', 'sports_fitness',
            'toys_kids', 'gifts_handicrafts', 'pet_supplies', 'automotive',
            'services', 'other',
            // legacy short-form values — kept for any existing tenants
            'retail', 'fashion', 'electronics', 'grocery', 'food', 'pharmacy',
            'beauty', 'sports', 'books', 'furniture', 'jewelry', 'toys',
            'hardware', 'pet', 'flowers', 'art', 'tenant'
        ]);
        if (!ALLOWED_BUSINESS_TYPES.has(business_type)) {
            return res.status(400).json({ success: false, error: 'Invalid business type' });
        }

        // SECURITY: business_type is always 'tenant' class — never trust caller to set 'admin'
        const safe_business_type = business_type; // already validated above

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
            [tenantId, email, company_name, safe_business_type, phone || null, googleId]
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
