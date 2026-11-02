const pool = require('../config/database');
const bcrypt = require('bcrypt');
const { encrypt, decrypt, generatePassword } = require('../utils/encryption');

const BCRYPT_ROUNDS = 12;

// ✅ Tenant-facing endpoints (mounted under /api/stores, behind the tenant's
// own OTP-based `authenticate` middleware) for viewing and regenerating a
// specific store's Store Admin password. Every call verifies the requesting
// tenant actually owns the store — never trusts req.params.id alone.
//
// SEC-028: passwords are now stored as bcrypt hashes (one-way). We can no
// longer retrieve a plaintext password after it has been set. The getPassword
// endpoint returns the password only once — immediately after it was generated
// — by continuing to accept the legacy AES-encrypted rows. Once a row is
// migrated (password_hash IS NOT NULL), we tell the tenant to regenerate.
const StoreAdminPasswordController = {
    // GET /api/stores/:id/admin-password
    // Returns the current password if it is still stored in the legacy AES
    // format; otherwise prompts the tenant to regenerate so a bcrypt hash
    // replaces it. New rows never expose the hash — the plaintext is shown
    // only once, at generatePassword() time.
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
                'SELECT password_encrypted, password_hash FROM store_admin_credentials WHERE store_id = $1',
                [id]
            );

            // No credentials at all — generate a fresh bcrypt-hashed password
            if (existing.rows.length === 0) {
                const newPassword = generatePassword();
                const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
                await pool.query(
                    'INSERT INTO store_admin_credentials (store_id, password_hash) VALUES ($1, $2)',
                    [id, hash]
                );
                return res.json({
                    success: true,
                    data: {
                        password: newPassword,
                        note: 'Save this password — it cannot be retrieved again. Use "Generate new password" if you lose it.',
                    },
                });
            }

            const row = existing.rows[0];

            // SEC-028: row already migrated to bcrypt — we cannot return the plaintext.
            if (row.password_hash) {
                return res.json({
                    success: true,
                    data: {
                        password: null,
                        requiresReset: true,
                        note: 'For security, the Store Admin password is no longer stored in a retrievable format. Use "Generate new password" to create a new one and share it with your staff.',
                    },
                });
            }

            // Legacy AES row — decrypt and return one last time.
            const password = decrypt(row.password_encrypted);
            res.json({
                success: true,
                data: {
                    password,
                    note: 'For security, we recommend generating a new password which will be stored more securely.',
                },
            });
        } catch (error) {
            console.error('❌ Get admin password error:', error);
            res.status(500).json({ success: false, error: error.message || 'Failed to get password' });
        }
    },

    // POST /api/stores/:id/admin-password/generate
    // Generates a new random password, stores its bcrypt hash, and returns
    // the plaintext exactly once. Invalidates any active Store Admin session.
    generatePassword: async (req, res) => {
        try {
            const { id } = req.params;
            const tenantId = req.tenantId;

            const storeCheck = await pool.query(
                'SELECT id, status, created_at FROM stores WHERE id = $1 AND tenant_id = $2',
                [id, tenantId]
            );
            if (storeCheck.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Store not found' });
            }

            const store = storeCheck.rows[0];
            const isPublished = store.status === 'published';
            const daysSinceCreation = (Date.now() - new Date(store.created_at).getTime()) / (1000 * 60 * 60 * 24);

            if (!isPublished && daysSinceCreation > 7) {
                return res.status(403).json({
                    success: false,
                    error: 'Store Admin access has expired. Publish your store to continue using Store Admin features.',
                    expired: true,
                });
            }

            const newPassword = generatePassword();
            // SEC-028: store as bcrypt hash only — plaintext never persisted
            const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

            await pool.query(
                `INSERT INTO store_admin_credentials
                    (store_id, password_hash, password_encrypted, updated_at)
                 VALUES ($1, $2, NULL, NOW())
                 ON CONFLICT (store_id) DO UPDATE
                 SET password_hash      = $2,
                     password_encrypted = NULL,
                     updated_at         = NOW()`,
                [id, hash]
            );

            res.json({
                success: true,
                data: {
                    password: newPassword,
                    note: 'Save this password — it cannot be retrieved again. Share it with your staff now.',
                },
            });
        } catch (error) {
            console.error('❌ Generate admin password error:', error);
            res.status(500).json({ success: false, error: error.message || 'Failed to generate password' });
        }
    },
};

module.exports = StoreAdminPasswordController;
