const pool = require('../config/database');
const crypto = require('crypto');

// Test tenant numbers — bypass payment, go live immediately
const TEST_TENANT_NUMBERS = ['5555555555', '6666666666', '7777777777'];

const getSettings = async () => {
    const result = await pool.query('SELECT key, value FROM platform_settings WHERE key LIKE $1', ['pg_%']);
    const settings = {};
    result.rows.forEach(row => { settings[row.key] = row.value; });
    return settings;
};

const isTestTenant = (mobile) => TEST_TENANT_NUMBERS.includes(mobile);

const isEnabled = async () => {
    const settings = await getSettings();
    return settings.pg_enabled === 'true' && settings.pg_key_id && settings.pg_secret;
};

// Gateway-agnostic order creation
const createOrder = async ({ orderId, amount, currency = 'INR', customerName, customerEmail, customerPhone, returnUrl }) => {
    const settings = await getSettings();
    const provider = settings.pg_provider || 'cashfree';
    const env = settings.pg_environment || 'sandbox';
    const keyId = settings.pg_key_id;
    const secret = settings.pg_secret;
    const webhookUrl = settings.pg_webhook_url;

    if (provider === 'cashfree') {
        const baseUrl = env === 'production'
            ? 'https://api.cashfree.com/pg/orders'
            : 'https://sandbox.cashfree.com/pg/orders';
        const response = await fetch(baseUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-client-id': keyId,
                'x-client-secret': secret,
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
                order_meta: { return_url: returnUrl, notify_url: webhookUrl },
            }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Cashfree order creation failed');
        return { provider, orderId, paymentSessionId: data.payment_session_id, ...data };
    }

    if (provider === 'razorpay') {
        const credentials = Buffer.from(`${keyId}:${secret}`).toString('base64');
        const response = await fetch('https://api.razorpay.com/v1/orders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Basic ${credentials}` },
            body: JSON.stringify({
                amount: Math.round(amount * 100), // Razorpay uses paise
                currency,
                receipt: orderId,
                notes: { customer_phone: customerPhone },
            }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.description || 'Razorpay order creation failed');
        return { provider, orderId, razorpayOrderId: data.id, ...data };
    }

    throw new Error(`Unsupported payment provider: ${provider}`);
};

// Gateway-agnostic webhook signature verification
const verifyWebhookSignature = (rawBody, headers, secret, provider) => {
    if (provider === 'cashfree') {
        const signature = headers['x-webhook-signature'];
        const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
        return expected === signature;
    }
    if (provider === 'razorpay') {
        const signature = headers['x-razorpay-signature'];
        const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
        return expected === signature;
    }
    return false;
};

// Parse webhook event from any provider into a standard format
const parseWebhookEvent = (body, provider) => {
    if (provider === 'cashfree') {
        const { type, data } = body;
        if (type === 'PAYMENT_SUCCESS') {
            return { success: true, orderId: data.order.order_id, amount: data.payment.payment_amount };
        }
        return { success: false };
    }
    if (provider === 'razorpay') {
        const { event, payload } = body;
        if (event === 'payment.captured') {
            return { success: true, orderId: payload.payment.entity.receipt, amount: payload.payment.entity.amount / 100 };
        }
        return { success: false };
    }
    return { success: false };
};

module.exports = { isTestTenant, isEnabled, getSettings, createOrder, verifyWebhookSignature, parseWebhookEvent };
