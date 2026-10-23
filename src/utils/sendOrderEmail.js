const { google } = require('googleapis');
const pool = require('../config/database');

// Map controller status keys → template status keys
const STATUS_MAP = {
    confirmed:        'order_confirmed',
    processing:       'order_confirmed',
    accepted:         'order_confirmed',
    ready_to_deliver: 'order_packed',
    out_for_delivery: 'out_for_delivery',
    delivered:        'delivered',
    cancelled:        'cancelled',
};

const DEFAULT_SUBJECTS = {
    order_confirmed:  'Your order has been confirmed! 🎉',
    order_packed:     'Your order is packed and ready 📦',
    out_for_delivery: 'Your order is on its way! 🚚',
    delivered:        'Your order has been delivered ✅',
    cancelled:        'Your order has been cancelled',
    return_requested: 'Return request received ↩️',
};

const DEFAULT_BODIES = {
    order_confirmed:  'Hi {{customer_name}},\n\nThank you for your order! Your order #{{order_id}} has been confirmed.\n\nOrder Total: {{order_total}}\n\nThank you,\n{{store_name}}',
    order_packed:     'Hi {{customer_name}},\n\nYour order #{{order_id}} has been packed and is ready for dispatch.\n\nThank you,\n{{store_name}}',
    out_for_delivery: 'Hi {{customer_name}},\n\nYour order #{{order_id}} is out for delivery today!\n\nThank you,\n{{store_name}}',
    delivered:        'Hi {{customer_name}},\n\nYour order #{{order_id}} has been delivered! We hope you love your purchase.\n\nThank you,\n{{store_name}}',
    cancelled:        'Hi {{customer_name}},\n\nWe\'re sorry, your order #{{order_id}} has been cancelled.\n\nThank you,\n{{store_name}}',
    return_requested: 'Hi {{customer_name}},\n\nWe have received your return request for order #{{order_id}}.\n\nThank you,\n{{store_name}}',
};

async function sendOrderEmail(storeId, orderId, newStatus) {
    try {
        const templateKey = STATUS_MAP[newStatus];
        if (!templateKey) return;

        // Get store Gmail credentials + name
        const storeRes = await pool.query(
            'SELECT notification_gmail_email, notification_gmail_refresh_token, store_name AS name FROM stores WHERE id = $1',
            [storeId]
        );
        if (!storeRes.rows.length) return;
        const { notification_gmail_email: gmailEmail, notification_gmail_refresh_token: refreshToken, name: storeName } = storeRes.rows[0];
        if (!gmailEmail || !refreshToken) return; // Gmail not connected

        // Get order details
        const orderRes = await pool.query(
            'SELECT customer_name, customer_email, order_id, total_amount, items, delivery_address, payment_method, created_at FROM orders WHERE id = $1',
            [orderId]
        );
        if (!orderRes.rows.length) return;
        const order = orderRes.rows[0];
        if (!order.customer_email) return;

        // Build item list string
        let itemListText = '';
        try {
            const items = typeof order.items === 'string' ? JSON.parse(order.items) : order.items;
            if (Array.isArray(items)) {
                itemListText = items.map(i => `${i.name || i.productName || 'Item'} x${i.quantity || 1} - ₹${i.price || 0}`).join('\n');
            }
        } catch(e) { itemListText = ''; }

        // Build delivery address string
        let addressText = '';
        try {
            const addr = typeof order.delivery_address === 'string' ? JSON.parse(order.delivery_address) : order.delivery_address;
            if (addr) {
                addressText = [addr.recipientName, addr.addressLine1, addr.addressLine2, addr.city, addr.state, addr.pincode].filter(Boolean).join(', ');
            }
        } catch(e) { addressText = ''; }

        // Get template (fall back to defaults)
        const tplRes = await pool.query(
            'SELECT subject, body, is_active FROM store_email_templates WHERE store_id = $1 AND status_key = $2',
            [storeId, templateKey]
        );
        const tpl = tplRes.rows[0];
        if (tpl && tpl.is_active === false) return; // disabled

        let subject = (tpl && tpl.subject) || DEFAULT_SUBJECTS[templateKey];
        let body    = (tpl && tpl.body)    || DEFAULT_BODIES[templateKey];

        // Replace variables — covers all common template variable names
        const orderTotal = order.total_amount ? `₹${order.total_amount}` : '';
        const vars = {
            '{{customer_name}}':   order.customer_name || 'Customer',
            '{{order_id}}':        order.order_id || String(orderId),
            '{{order_total}}':     orderTotal,
            '{{total_amount}}':    orderTotal,
            '{{amount}}':          orderTotal,
            '{{store_name}}':      storeName || 'Store',
            '{{item_list}}':       itemListText,
            '{{items}}':           itemListText,
            '{{delivery_address}}': addressText,
            '{{address}}':         addressText,
            '{{payment_method}}':  order.payment_method || '',
            '{{delivery_date}}':   '',
        };
        Object.entries(vars).forEach(([k, v]) => {
            subject = subject.replaceAll(k, v);
            body    = body.replaceAll(k, v);
        });

        // Build Gmail OAuth2 client
        const oauth2Client = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            process.env.GOOGLE_REDIRECT_URI
        );
        oauth2Client.setCredentials({ refresh_token: refreshToken });

        const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

        // Encode email as RFC 2822
        const emailLines = [
            `From: ${storeName} <${gmailEmail}>`,
            `To: ${order.customer_email}`,
            `Subject: ${subject}`,
            'Content-Type: text/plain; charset=utf-8',
            '',
            body,
        ];
        const raw = Buffer.from(emailLines.join('\r\n'))
            .toString('base64')
            .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

        await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
        console.log(`✅ Order email sent to ${order.customer_email} for status ${newStatus}`);
    } catch (err) {
        console.error('sendOrderEmail error:', err.message);
    }
}

module.exports = { sendOrderEmail };
