const express = require('express');
const router = express.Router();
const { google } = require('googleapis');
const pool = require('../config/database');
require('dotenv').config();

const getOAuthClient = () => new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GMAIL_OAUTH_CALLBACK_URL
);

router.get('/connect', (req, res) => {
    const { storeId, token } = req.query;
    if (!storeId || !token) return res.status(400).send('Missing storeId or token');
    const oauth2Client = getOAuthClient();
    const url = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: ['https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/userinfo.email'],
        state: JSON.stringify({ storeId, token }),
    });
    res.redirect(url);
});

router.get('/callback', async (req, res) => {
    const { code, state, error } = req.query;
    const FRONTEND = 'https://aapnaestore.com';
    if (error || !code) return res.redirect(FRONTEND + '/dashboard?gmail=error');
    let storeId, token;
    try { ({ storeId, token } = JSON.parse(state)); } catch(e) { return res.redirect(FRONTEND + '/dashboard?gmail=error'); }
    try {
        const jwt = require('jsonwebtoken');
        jwt.verify(token, process.env.JWT_SECRET);
        const oauth2Client = getOAuthClient();
        const { tokens } = await oauth2Client.getToken(code);
        oauth2Client.setCredentials(tokens);
        const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
        const { data } = await oauth2.userinfo.get();
        const gmailEmail = data.email;
        await pool.query(
            'UPDATE stores SET notification_gmail_email = $1, notification_gmail_refresh_token = $2, notification_gmail_connected_at = NOW() WHERE store_id = $3',
            [gmailEmail, tokens.refresh_token, storeId]
        );
        res.redirect(FRONTEND + '/dashboard?gmail=connected&email=' + encodeURIComponent(gmailEmail) + '&storeId=' + encodeURIComponent(storeId));
    } catch (err) {
        console.error('Gmail OAuth callback error:', err);
        res.redirect(FRONTEND + '/dashboard?gmail=error');
    }
});

router.post('/disconnect', async (req, res) => {
    const { storeId } = req.query;
    if (!storeId) return res.status(400).json({ success: false, error: 'Missing storeId' });
    try {
        await pool.query(
            `UPDATE stores
             SET notification_gmail_email = NULL,
                 notification_gmail_refresh_token = NULL,
                 notification_gmail_connected_at = NULL
             WHERE store_id = $1`,
            [storeId]
        );
        res.json({ success: true, message: 'Gmail disconnected' });
    } catch (err) {
        console.error('Gmail disconnect error:', err);
        res.status(500).json({ success: false, error: 'Failed to disconnect Gmail' });
    }
});

module.exports = router;
