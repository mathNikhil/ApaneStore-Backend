const { Pool } = require('pg');
const pool = require('../config/database');

// Test tenant numbers — these bypass payment and go live immediately
const TEST_TENANT_NUMBERS = ['5555555555', '6666666666', '7777777777'];

const getSettings = async () => {
    const result = await pool.query('SELECT key, value FROM platform_settings WHERE key LIKE $1', ['cashfree_%']);
    const settings = {};
    result.rows.forEach(row => { settings[row.key] = row.value; });
    return settings;
};

const isTestTenant = (mobile) => TEST_TENANT_NUMBERS.includes(mobile);

const isEnabled = async () => {
    const settings = await getSettings();
    return settings.cashfree_enabled === 'true' && settings.cashfree_key_id && settings.cashfree_secret_key;
};

const createOrder = async ({ orderId, amount, currency = 'INR', customerName, customerEmail, customerPhone, returnUrl }) => {
    const settings = await getSettings();
    const env = settings.cashfree_environment || 'sandbox';
    const baseUrl = env === 'production'
        ? 'https://api.cashfree.com/pg/orders'
        : 'https://sandbox.cashfree.com/pg/orders';

    const response = await fetch(baseUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-client-id': settings.cashfree_key_id,
            'x-client-secret': settings.cashfree_secret_key,
            'x-api-version': '2023-08-01',
        },
        body: JSON.stringify({
            order_id: orderId,
            order_amount: amount,
            order_currency: currency,
            customer_details: {
                customer_id: customerPhone,
                customer_name: customerName || 'Tenant',
                customer_email: customerEmail || 'tenant@aapnaestore.com',
                customer_phone: customerPhone,
            },
            order_meta: {
                return_url: returnUrl,
                notify_url: settings.cashfree_webhook_url,
            },
        }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Failed to create Cashfree order');
    return data;
};

const verifyWebhookSignature = (rawBody, signature, secret) => {
    const crypto = require('crypto');
    const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(rawBody)
        .digest('base64');
    return expectedSignature === signature;
};

module.exports = { isTestTenant, isEnabled, getSettings, createOrder, verifyWebhookSignature };
