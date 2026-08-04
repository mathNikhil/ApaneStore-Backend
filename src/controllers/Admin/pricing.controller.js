const pool = require('../../config/database');

// ✅ Super Admin pricing management — lets the platform owner configure
// what each of the 3 valid domain+hosting combinations costs, per billing
// cycle (monthly/quarterly/annual), without a code change. The tenant's
// payment screen reads these same rows.
const AdminPricingController = {
    // GET /api/admin/pricing-plans
    getAll: async (req, res) => {
        try {
            const result = await pool.query(
                `SELECT * FROM pricing_plans
                 ORDER BY plan_key,
                 CASE billing_cycle WHEN 'monthly' THEN 1 WHEN 'quarterly' THEN 2 WHEN 'annual' THEN 3 ELSE 4 END`
            );
            res.json({ success: true, data: result.rows });
        } catch (error) {
            console.error('❌ Get pricing plans error:', error);
            res.status(500).json({ success: false, error: error.message || 'Failed to get pricing plans' });
        }
    },

    // PUT /api/admin/pricing-plans/:id
    // ✅ FIX: was keyed by plan_key alone, which is no longer unique now
    // that each domain+hosting combo has a separate row per billing cycle
    // — updating by plan_key would have silently hit "multiple rows"
    // ambiguity. Each row's own id is unique, so that's the right key now.
    // body: { display_name?, base_amount?, tax_percentage?, validity_days?, is_active? }
    update: async (req, res) => {
        try {
            const { id } = req.params;
            const { display_name, base_amount, tax_percentage, validity_days, is_active } = req.body;

            const existing = await pool.query('SELECT * FROM pricing_plans WHERE id = $1', [id]);
            if (existing.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Pricing plan not found' });
            }
            const current = existing.rows[0];

            const result = await pool.query(
                `UPDATE pricing_plans
                 SET display_name = $1, base_amount = $2, tax_percentage = $3,
                     validity_days = $4, is_active = $5, updated_at = NOW()
                 WHERE id = $6
                 RETURNING *`,
                [
                    display_name !== undefined ? display_name : current.display_name,
                    base_amount !== undefined ? base_amount : current.base_amount,
                    tax_percentage !== undefined ? tax_percentage : current.tax_percentage,
                    validity_days !== undefined ? validity_days : current.validity_days,
                    is_active !== undefined ? is_active : current.is_active,
                    id,
                ]
            );

            res.json({ success: true, data: result.rows[0] });
        } catch (error) {
            console.error('❌ Update pricing plan error:', error);
            res.status(500).json({ success: false, error: error.message || 'Failed to update pricing plan' });
        }
    },
};

module.exports = AdminPricingController;
