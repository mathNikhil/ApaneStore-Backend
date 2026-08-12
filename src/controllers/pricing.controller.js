const pool = require('../config/database');

// ✅ Tenant-facing (read-only) pricing lookup — the payment screen in the
// publish flow uses this to show the real, Super-Admin-configured price
// for whatever domain+hosting combination the tenant picked, instead of a
// hardcoded number in the frontend.
const PricingController = {
    // GET /api/pricing-plans
    getAll: async (req, res) => {
        try {
            // 🐛 FIX: billing_cycle and is_active were missing from SELECT.
            // The frontend filters on both (`p.is_active`, `p.billing_cycle`
            // for sorting/cycle selection) — without them every row came
            // back as is_active: undefined, so the "&& p.is_active" check
            // in PublishPayment.jsx always failed and no plan ever matched,
            // regardless of plan_key.
            const result = await pool.query(
                'SELECT plan_key, display_name, billing_cycle, base_amount, tax_percentage, validity_days, is_active FROM pricing_plans WHERE is_active = true'
            );
            res.json({ success: true, data: result.rows });
        } catch (error) {
            console.error('❌ Get pricing plans error:', error);
            res.status(500).json({ success: false, error: error.message || 'Failed to get pricing plans' });
        }
    },
};

module.exports = PricingController;