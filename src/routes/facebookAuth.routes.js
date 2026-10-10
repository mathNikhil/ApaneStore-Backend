const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const jwt = require('jsonwebtoken');
require('dotenv').config();

// Verify Facebook access token and login/register tenant
router.post('/facebook', async (req, res) => {
    try {
        const { accessToken, userID } = req.body;
        if (!accessToken || !userID) return res.status(400).json({ success: false, error: 'Missing credentials' });

        // Verify token with Facebook
        const appId = process.env.FACEBOOK_APP_ID;
        const appSecret = process.env.FACEBOOK_APP_SECRET;
        const verifyUrl = `https://graph.facebook.com/debug_token?input_token=${accessToken}&access_token=${appId}|${appSecret}`;
        const verifyRes = await fetch(verifyUrl);
        const verifyData = await verifyRes.json();

        if (!verifyData.data?.is_valid || verifyData.data?.user_id !== userID) {
            return res.status(401).json({ success: false, error: 'Invalid Facebook token' });
        }

        // Get user profile from Facebook
        const profileRes = await fetch(`https://graph.facebook.com/${userID}?fields=id,name,email&access_token=${accessToken}`);
        const profile = await profileRes.json();
        const { id: facebookId, name, email } = profile;

        // Check existing tenant by facebook_id or email
        let tenant = null;
        const byFb = await pool.query('SELECT * FROM tenants WHERE facebook_id=$1 LIMIT 1', [facebookId]);
        if (byFb.rows.length > 0) {
            tenant = byFb.rows[0];
        } else if (email) {
            const byEmail = await pool.query('SELECT * FROM tenants WHERE email=$1 LIMIT 1', [email]);
            if (byEmail.rows.length > 0) {
                tenant = byEmail.rows[0];
                await pool.query('UPDATE tenants SET facebook_id=$1 WHERE id=$2', [facebookId, tenant.id]);
            }
        }

        if (tenant) {
            if (!tenant.facebook_id) {
                await pool.query('UPDATE tenants SET facebook_id=$1 WHERE id=$2', [facebookId, tenant.id]);
            }
            const token = jwt.sign(
                { tenantId: tenant.id, email: tenant.email, role: 'tenant' },
                process.env.JWT_SECRET,
                { expiresIn: '30d' }
            );
            return res.json({
                success: true, isNewTenant: false, token,
                tenant: { id: tenant.id, email: tenant.email, company_name: tenant.company_name, business_type: tenant.business_type, is_verified: tenant.is_verified }
            });
        } else {
            return res.json({ success: true, isNewTenant: true, facebookId, email, name });
        }
    } catch(e) {
        console.error('Facebook auth error:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Link existing phone tenant to Facebook
router.post('/facebook/link-phone', async (req, res) => {
    try {
        const { facebookId, email, name, phone } = req.body;
        if (!facebookId || !phone) return res.status(400).json({ success: false, error: 'Missing fields' });
        const phoneClean = phone.replace(/\D/g, '');
        const existing = await pool.query('SELECT * FROM tenants WHERE phone=$1 LIMIT 1', [phoneClean]);
        if (existing.rows.length > 0) {
            const tenant = existing.rows[0];
            await pool.query('UPDATE tenants SET facebook_id=$1 WHERE id=$2', [facebookId, tenant.id]);
            const token = jwt.sign(
                { tenantId: tenant.id, email: tenant.email, role: 'tenant' },
                process.env.JWT_SECRET,
                { expiresIn: '30d' }
            );
            return res.json({
                success: true, linked: true, token,
                tenant: { id: tenant.id, email: tenant.email, company_name: tenant.company_name, business_type: tenant.business_type, is_verified: tenant.is_verified }
            });
        } else {
            return res.json({ success: true, linked: false });
        }
    } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

module.exports = router;
