const pool = require('../config/database');

const getPaymentGatewayConfig = async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT key, value FROM platform_settings WHERE key LIKE 'pg_%'"
        );
        const config = {};
        result.rows.forEach(row => {
            if (row.key === 'pg_secret' && row.value) {
                config[row.key] = '••••••••' + row.value.slice(-4);
            } else {
                config[row.key] = row.value;
            }
        });
        res.json({ success: true, data: config });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

const savePaymentGatewayConfig = async (req, res) => {
    try {
        const { pg_provider, pg_key_id, pg_secret, pg_webhook_url, pg_environment, pg_enabled } = req.body;

        const updates = [
            ['pg_provider', pg_provider],
            ['pg_key_id', pg_key_id],
            ['pg_webhook_url', pg_webhook_url],
            ['pg_environment', pg_environment],
            ['pg_enabled', pg_enabled],
        ];

        // Only update secret if new one provided (not masked)
        if (pg_secret && !pg_secret.startsWith('••••')) {
            updates.push(['pg_secret', pg_secret]);
        }

        for (const [key, value] of updates) {
            if (value !== undefined) {
                await pool.query(
                    'UPDATE platform_settings SET value = $1, updated_at = NOW() WHERE key = $2',
                    [value, key]
                );
            }
        }

        res.json({ success: true, message: 'Payment gateway configuration saved' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

module.exports = { getPaymentGatewayConfig, savePaymentGatewayConfig };
