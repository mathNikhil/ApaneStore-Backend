const pool = require('../config/database');
const { encrypt, decrypt, generatePassword } = require('../utils/encryption');

// ✅ Tenant-facing endpoints (mounted under /api/stores, behind the tenant's
// own OTP-based `authenticate` middleware) for viewing and regenerating a
// specific store's Store Admin password. Every call verifies the requesting
// tenant actually owns the store — never trusts req.params.id alone.
const StoreAdminPasswordController = {
    // GET /api/stores/:id/admin-password
    // Returns the current password, generating one on first access so a
    // store is never left without one.
    getPassword: async (req, res) => {
        try {
            const { id } = req.params;
            const tenantId = req.tenantId;

            const storeCheck = await pool.query(
                'SELECT id FROM stores WHERE id = $1 AND tenant_id = $2',
                [id, tenantId]
            );
            if (storeCheck.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Store not found' });
            }

            const existing = await pool.query(
                'SELECT password_encrypted FROM store_admin_credentials WHERE store_id = $1',
                [id]
            );

            if (existing.rows.length === 0) {
                const newPassword = generatePassword();
                const encrypted = encrypt(newPassword);
                await pool.query(
                    'INSERT INTO store_admin_credentials (store_id, password_encrypted) VALUES ($1, $2)',
                    [id, encrypted]
                );
                return res.json({ success: true, data: { password: newPassword } });
            }

            const password = decrypt(existing.rows[0].password_encrypted);
            res.json({ success: true, data: { password } });
        } catch (error) {
            console.error('❌ Get admin password error:', error);
            res.status(500).json({ success: false, error: error.message || 'Failed to get password' });
        }
    },

    // POST /api/stores/:id/admin-password/generate
    // Overwrites the password with a new one and immediately invalidates
    // any currently-active Store Admin session for this store.
    generatePassword: async (req, res) => {
        try {
            const { id } = req.params;
            const tenantId = req.tenantId;

            const storeCheck = await pool.query(
                'SELECT id FROM stores WHERE id = $1 AND tenant_id = $2',
                [id, tenantId]
            );
            if (storeCheck.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Store not found' });
            }

            const newPassword = generatePassword();
            const encrypted = encrypt(newPassword);

            await pool.query(
                `INSERT INTO store_admin_credentials (store_id, password_encrypted, active_session_token, session_last_active, updated_at)
                 VALUES ($1, $2, NULL, NULL, NOW())
                 ON CONFLICT (store_id) DO UPDATE
                 SET password_encrypted = $2, active_session_token = NULL, session_last_active = NULL, updated_at = NOW()`,
                [id, encrypted]
            );

            res.json({ success: true, data: { password: newPassword } });
        } catch (error) {
            console.error('❌ Generate admin password error:', error);
            res.status(500).json({ success: false, error: error.message || 'Failed to generate password' });
        }
    },
};

module.exports = StoreAdminPasswordController;
