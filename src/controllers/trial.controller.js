const pool = require('../config/database');

const TrialController = {

    checkEligibility: async (req, res) => {
        try {
            const { storeId } = req.query;
            const tenantId = req.tenantId;

            if (!storeId) {
                return res.status(400).json({ success: false, error: 'storeId is required' });
            }

            const storeResult = await pool.query(
                'SELECT id, trial_enabled, trial_used, status, trial_days FROM stores WHERE id = $1 AND tenant_id = $2',
                [storeId, tenantId]
            );
            if (storeResult.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Store not found' });
            }
            const store = storeResult.rows[0];

            const tenantTrialResult = await pool.query(
                'SELECT COUNT(*) as count FROM store_subscriptions ss JOIN stores s ON s.id = ss.store_id WHERE s.tenant_id = $1 AND ss.is_trial = true AND ss.payment_status = $2',
                [tenantId, 'paid']
            );
            const tenantUsedTrial = parseInt(tenantTrialResult.rows[0].count) > 0;

            const planResult = await pool.query(
                "SELECT is_active, validity_days, base_amount, tax_percentage FROM pricing_plans WHERE plan_key = 'trial' AND billing_cycle = 'trial' LIMIT 1"
            );
            const trialPlan = planResult.rows[0] || null;
            const globallyActive = trialPlan && trialPlan.is_active === true;

            if (store.trial_enabled === true && globallyActive) {
                return res.json({
                    success: true,
                    data: {
                        eligible: true,
                        level: 2,
                        trialDays: store.trial_days || 3,
                        trialPlan: {
                            ...trialPlan,
                            validity_days: store.trial_days || 3,
                            display_name: (store.trial_days || 3) + ' Day Special Trial'
                        }
                    }
                });
            }

            if (!tenantUsedTrial && globallyActive) {
                return res.json({
                    success: true,
                    data: {
                        eligible: true,
                        level: 1,
                        trialDays: trialPlan.validity_days || 3,
                        trialPlan: {
                            ...trialPlan,
                            display_name: (trialPlan.validity_days || 3) + ' Day Free Trial'
                        }
                    }
                });
            }

            return res.json({
                success: true,
                data: { eligible: false, level: 0 }
            });

        } catch (error) {
            console.error('Trial eligibility check error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    },

    activateTrial: async (req, res) => {
        try {
            const { id } = req.params;
            const tenantId = req.tenantId;

            const storeCheck = await pool.query(
                'SELECT id, status, tenant_id, trial_enabled, trial_days FROM stores WHERE id = $1 AND tenant_id = $2',
                [id, tenantId]
            );
            if (storeCheck.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Store not found' });
            }
            const store = storeCheck.rows[0];

            const tenantTrialResult = await pool.query(
                'SELECT COUNT(*) as count FROM store_subscriptions ss JOIN stores s ON s.id = ss.store_id WHERE s.tenant_id = $1 AND ss.is_trial = true AND ss.payment_status = $2',
                [tenantId, 'paid']
            );
            const tenantUsedTrial = parseInt(tenantTrialResult.rows[0].count) > 0;

            let trialDays;
            let trialLevel;

            if (store.trial_enabled === true) {
                trialDays = store.trial_days || 3;
                trialLevel = 2;
            } else if (!tenantUsedTrial) {
                const planResult = await pool.query(
                    "SELECT validity_days FROM pricing_plans WHERE plan_key = 'trial' AND billing_cycle = 'trial' AND is_active = true LIMIT 1"
                );
                if (planResult.rows.length === 0) {
                    return res.status(400).json({ success: false, error: 'Trial plan is not available' });
                }
                trialDays = planResult.rows[0].validity_days || 3;
                trialLevel = 1;
            } else {
                return res.status(400).json({ success: false, error: 'No trial available for this store' });
            }

            const expiresAt = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000);
            const planName = trialDays + ' Day Trial (Level ' + trialLevel + ')';

            await pool.query(
                'INSERT INTO store_subscriptions (store_id, plan_key, plan_name, billing_cycle, base_amount, tax_amount, total_amount, payment_status, payment_method, paid_at, valid_until, is_trial, trial_expires_at, updated_at) VALUES ($1, $2, $3, $4, 0, 0, 0, $5, $6, NOW(), $7::timestamptz, true, $7::timestamptz, NOW()) ON CONFLICT (store_id) DO UPDATE SET plan_key = $2, plan_name = $3, billing_cycle = $4, base_amount = 0, tax_amount = 0, total_amount = 0, payment_status = $5, payment_method = $6, paid_at = NOW(), valid_until = $7::timestamptz, is_trial = true, trial_expires_at = $7::timestamptz, updated_at = NOW()',
                [id, 'trial', planName, 'trial', 'paid', 'trial', expiresAt]
            );

            await pool.query(
                "UPDATE stores SET status = 'published', published_at = NOW(), trial_used = true, trial_enabled = false, updated_at = NOW() WHERE id = $1",
                [id]
            );

            try {
                const { TERMS_VERSION } = require('../config/terms');
                await pool.query(
                    'INSERT INTO terms_acceptances (tenant_id, store_id, terms_version, ip_address) VALUES ($1, $2, $3, $4)',
                    [tenantId, id, TERMS_VERSION, req.ip || null]
                );
            } catch (e) {
                console.warn('Terms acceptance failed:', e.message);
            }

            res.json({
                success: true,
                data: { trialDays, trialLevel, expiresAt }
            });
        } catch (error) {
            console.error('Trial activation error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    },

    adminEnableTrial: async (req, res) => {
        try {
            const { id } = req.params;
            const { days } = req.body;

            const storeCheck = await pool.query('SELECT id, status FROM stores WHERE id = $1', [id]);
            if (storeCheck.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Store not found' });
            }
            if (storeCheck.rows[0].status !== 'draft') {
                return res.status(400).json({ success: false, error: 'Trial can only be enabled for draft stores' });
            }

            const trialDays = parseInt(days) || 3;
            await pool.query(
                'UPDATE stores SET trial_enabled = true, trial_days = $2, updated_at = NOW() WHERE id = $1',
                [id, trialDays]
            );

            res.json({ success: true, data: { trialDays } });
        } catch (error) {
            console.error('Admin enable trial error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    },

    getExtensionRequests: async (req, res) => {
        try {
            const result = await pool.query(
                'SELECT ter.*, s.store_name, s.subdomain, s.status as store_status, t.company_name, t.email, t.phone FROM trial_extension_requests ter JOIN stores s ON s.id = ter.store_id JOIN tenants t ON t.id = ter.tenant_id ORDER BY ter.created_at DESC'
            );
            res.json({ success: true, data: result.rows });
        } catch (error) {
            console.error('Get extension requests error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    },

    acceptExtension: async (req, res) => {
        try {
            const { requestId } = req.params;
            const { daysGranted, adminNote } = req.body;

            const reqResult = await pool.query('SELECT * FROM trial_extension_requests WHERE id = $1', [requestId]);
            if (reqResult.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Request not found' });
            }

            const newExpiry = new Date(Date.now() + (daysGranted || 3) * 24 * 60 * 60 * 1000);
            await pool.query('UPDATE store_subscriptions SET valid_until = $1, trial_expires_at = $1, updated_at = NOW() WHERE store_id = $2', [newExpiry, reqResult.rows[0].store_id]);
            await pool.query("UPDATE stores SET status = 'published', updated_at = NOW() WHERE id = $1", [reqResult.rows[0].store_id]);
            await pool.query('UPDATE trial_extension_requests SET status = $1, days_granted = $2, admin_note = $3, updated_at = NOW() WHERE id = $4', ['accepted', daysGranted || 3, adminNote || null, requestId]);

            res.json({ success: true, message: 'Extension granted' });
        } catch (error) {
            console.error('Accept extension error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    },

    rejectExtension: async (req, res) => {
        try {
            const { requestId } = req.params;
            const { adminNote } = req.body;
            await pool.query('UPDATE trial_extension_requests SET status = $1, admin_note = $2, updated_at = NOW() WHERE id = $3', ['rejected', adminNote || null, requestId]);
            res.json({ success: true, message: 'Extension rejected' });
        } catch (error) {
            console.error('Reject extension error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    },
};

module.exports = TrialController;
