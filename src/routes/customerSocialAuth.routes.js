const express = require('express');
const router = express.Router({ mergeParams: true });
const pool = require('../config/database');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
require('dotenv').config();

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Helper — find or create customer by social login
const loginOrCreateSocialCustomer = async (storeId, { googleId, facebookId, email, name, provider }) => {
    // 1. Try find by google_id or facebook_id
    let customer = null;
    if (googleId) {
        const r = await pool.query('SELECT * FROM customers WHERE store_id=$1 AND google_id=$2 LIMIT 1', [storeId, googleId]);
        if (r.rows.length) customer = r.rows[0];
    }
    if (!customer && facebookId) {
        const r = await pool.query('SELECT * FROM customers WHERE store_id=$1 AND facebook_id=$2 LIMIT 1', [storeId, facebookId]);
        if (r.rows.length) customer = r.rows[0];
    }
    // 2. Try find by email
    if (!customer && email) {
        const r = await pool.query('SELECT * FROM customers WHERE store_id=$1 AND email=$2 LIMIT 1', [storeId, email]);
        if (r.rows.length) {
            customer = r.rows[0];
            // Link social ID to existing customer
            if (googleId && !customer.google_id) await pool.query('UPDATE customers SET google_id=$1, auth_provider=$2 WHERE id=$3', [googleId, provider, customer.id]);
            if (facebookId && !customer.facebook_id) await pool.query('UPDATE customers SET facebook_id=$1, auth_provider=$2 WHERE id=$3', [facebookId, provider, customer.id]);
        }
    }

    if (customer) {
        const token = jwt.sign(
            { customerId: customer.id, storeId, phone: customer.phone, role: 'customer' },
            process.env.JWT_SECRET,
            { expiresIn: '30d' }
        );
        return { success: true, isNewCustomer: false, token, customer };
    }

    // 3. New customer — need phone
    return { success: true, isNewCustomer: true, googleId, facebookId, email, name };
};

// Google login for storefront customer
router.post('/auth/social/google', async (req, res) => {
    try {
        const { storeId } = req.params;
        const { credential } = req.body;
        const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: process.env.GOOGLE_CLIENT_ID });
        const { sub: googleId, email, name } = ticket.getPayload();
        const result = await loginOrCreateSocialCustomer(storeId, { googleId, email, name, provider: 'google' });
        res.json(result);
    } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// Facebook login for storefront customer
router.post('/auth/social/facebook', async (req, res) => {
    try {
        const { storeId } = req.params;
        const { accessToken, userID } = req.body;

        // Verify token
        const verifyRes = await fetch(`https://graph.facebook.com/debug_token?input_token=${accessToken}&access_token=${process.env.FACEBOOK_APP_ID}|${process.env.FACEBOOK_APP_SECRET}`);
        const verifyData = await verifyRes.json();
        if (!verifyData.data?.is_valid || verifyData.data?.user_id !== userID) {
            return res.status(401).json({ success: false, error: 'Invalid Facebook token' });
        }

        const profileRes = await fetch(`https://graph.facebook.com/${userID}?fields=id,name,email&access_token=${accessToken}`);
        const { id: facebookId, name, email } = await profileRes.json();
        const result = await loginOrCreateSocialCustomer(storeId, { facebookId, email, name, provider: 'facebook' });
        res.json(result);
    } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// Complete registration — link phone to social customer
router.post('/auth/social/complete', async (req, res) => {
    try {
        const { storeId } = req.params;
        const { googleId, facebookId, email, name, phone } = req.body;
        if (!phone || phone.length !== 10) return res.status(400).json({ success: false, error: 'Valid phone number required' });

        // Check phone not already used in this store
        const existing = await pool.query('SELECT * FROM customers WHERE store_id=$1 AND phone=$2 LIMIT 1', [storeId, phone]);
        let customer;

        if (existing.rows.length > 0) {
            // Phone exists — link social ID
            customer = existing.rows[0];
            const updates = [];
            const vals = [];
            let idx = 1;
            if (googleId && !customer.google_id) { updates.push(`google_id=$${idx++}`); vals.push(googleId); }
            if (facebookId && !customer.facebook_id) { updates.push(`facebook_id=$${idx++}`); vals.push(facebookId); }
            if (email && !customer.email) { updates.push(`email=$${idx++}`); vals.push(email); }
            if (name && !customer.name) { updates.push(`name=$${idx++}`); vals.push(name); }
            if (updates.length) {
                vals.push(customer.id);
                await pool.query(`UPDATE customers SET ${updates.join(',')} WHERE id=$${idx}`, vals);
            }
        } else {
            // Create new customer
            const custId = 'CUS-' + Date.now().toString().slice(-6) + '-' + Math.floor(Math.random() * 9999);
            const provider = googleId ? 'google' : 'facebook';
            const r = await pool.query(
                `INSERT INTO customers (customer_id, store_id, phone, name, email, google_id, facebook_id, auth_provider, is_verified, consent_given, consent_date)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,true,NOW())
                 RETURNING *`,
                [custId, storeId, phone, name, email, googleId || null, facebookId || null, provider]
            );
            customer = r.rows[0];
        }

        const token = jwt.sign(
            { customerId: customer.id, storeId, phone: customer.phone, role: 'customer' },
            process.env.JWT_SECRET,
            { expiresIn: '30d' }
        );
        res.json({ success: true, token, customer, isNewCustomer: true });
    } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

module.exports = router;
