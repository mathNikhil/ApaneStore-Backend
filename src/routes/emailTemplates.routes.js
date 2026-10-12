const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');

const DEFAULT_TEMPLATES = {
    order_confirmed: {
        subject: 'Your order #{{order_id}} is confirmed! 🎉',
        body: `Hi {{customer_name}},

Thank you for your order! We have received it and it is being processed.

Order ID: #{{order_id}}
Items: {{item_list}}
Total: Rs.{{total_amount}}

We will notify you once it is packed and ready to ship.

Regards,
{{store_name}}`
    },
    order_packed: {
        subject: 'Your order #{{order_id}} is packed and ready!',
        body: `Hi {{customer_name}},

Your order #{{order_id}} has been packed and is ready for pickup by our courier.

You will receive another update with tracking details soon.

Regards,
{{store_name}}`
    },
    out_for_delivery: {
        subject: 'Your order #{{order_id}} is out for delivery 🚚',
        body: `Hi {{customer_name}},

Your order #{{order_id}} is on its way to you!

Tracking Number: {{tracking_number}}

Expected delivery: Today

Regards,
{{store_name}}`
    },
    delivered: {
        subject: 'Your order #{{order_id}} has been delivered ✅',
        body: `Hi {{customer_name}},

Your order #{{order_id}} has been delivered. We hope you love it!

If you have any issues, please contact us.

Regards,
{{store_name}}`
    },
    cancelled: {
        subject: 'Your order #{{order_id}} has been cancelled',
        body: `Hi {{customer_name}},

Your order #{{order_id}} has been cancelled as requested.

If you paid online, a refund will be processed within 5-7 business days.

Regards,
{{store_name}}`
    },
    return_requested: {
        subject: 'Return request received for order #{{order_id}}',
        body: `Hi {{customer_name}},

We have received your return request for order #{{order_id}}.

Our team will review it and get back to you within 24 hours with next steps.

Regards,
{{store_name}}`
    }
};

router.get('/:storeId', authenticate, async (req, res) => {
    const { storeId: storeIdParam } = req.params;
    const storeRow = await pool.query('SELECT id FROM stores WHERE store_id = $1', [storeIdParam]);
    if (!storeRow.rows.length) return res.status(404).json({ success: false, error: 'Store not found' });
    const storeId = storeRow.rows[0].id;
    try {
        const result = await pool.query(
            'SELECT status_key, subject, body, is_active FROM store_email_templates WHERE store_id = $1',
            [storeId]
        );
        const saved = {};
        result.rows.forEach(r => { saved[r.status_key] = r; });
        const templates = {};
        Object.keys(DEFAULT_TEMPLATES).forEach(key => {
            templates[key] = saved[key] ? {
                subject: saved[key].subject,
                body: saved[key].body,
                is_active: saved[key].is_active,
                is_custom: true
            } : {
                ...DEFAULT_TEMPLATES[key],
                is_active: true,
                is_custom: false
            };
        });
        res.json({ templates, defaults: DEFAULT_TEMPLATES });
    } catch (err) {
        console.error('Get templates error:', err);
        res.status(500).json({ error: 'Failed to fetch templates' });
    }
});

router.put('/:storeId/:statusKey', authenticate, async (req, res) => {
    const { storeId, statusKey } = req.params;
    const { subject, body, is_active } = req.body;
    if (!DEFAULT_TEMPLATES[statusKey]) return res.status(400).json({ error: 'Invalid status key' });
    try {
        await pool.query(
            `INSERT INTO store_email_templates (store_id, status_key, subject, body, is_active)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (store_id, status_key)
             DO UPDATE SET subject = $3, body = $4, is_active = $5, updated_at = NOW()`,
            [storeId, statusKey, subject, body, is_active !== false]
        );
        res.json({ success: true });
    } catch (err) {
        console.error('Save template error:', err);
        res.status(500).json({ error: 'Failed to save template' });
    }
});

router.delete('/:storeId/:statusKey', authenticate, async (req, res) => {
    const { storeId: storeIdParam, statusKey } = req.params;
    const storeRow = await pool.query('SELECT id FROM stores WHERE store_id = $1', [storeIdParam]);
    if (!storeRow.rows.length) return res.status(404).json({ success: false, error: 'Store not found' });
    const storeId = storeRow.rows[0].id;
    try {
        await pool.query(
            'DELETE FROM store_email_templates WHERE store_id = $1 AND status_key = $2',
            [storeId, statusKey]
        );
        res.json({ success: true, message: 'Reset to default' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to reset template' });
    }
});

module.exports = router;
