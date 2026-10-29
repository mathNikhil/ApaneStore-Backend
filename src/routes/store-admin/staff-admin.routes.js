/**
 * Store Admin Staff Management Routes
 * Mounted at /api/store/:storeId/admin/staff
 * Auth: storeAdminAuth (session token from store-admin login)
 *
 * Provides CRUD for service.staff_members and photo upload.
 * Distinct from /api/stores/:storeId/staff (tenant-JWT, store-builder sync).
 */
const express = require('express');
const router = express.Router({ mergeParams: true });
const pool = require('../../config/database');
const { storeAdminAuth } = require('../../middleware/storeAdminAuth');
const { uploadSingle, handleMulterError } = require('../../middleware/upload');
const { validateSingleImage } = require('../../middleware/imageValidation');
const ImageService = require('../../services/imageService');

router.use(storeAdminAuth);

// ── helpers ────────────────────────────────────────────────────────────────
async function resolveStoreUuid(storeId) {
    const row = await pool.query(
        `SELECT store_id AS uuid, tenant_id FROM stores
         WHERE store_id = $1
            OR (id::text = $1 AND $1 ~ '^[0-9]+$')
         LIMIT 1`,
        [String(storeId)]
    );
    return row.rows[0] || null;
}

// ── GET /api/store/:storeId/admin/staff ───────────────────────────────────
// Returns all active staff with avatar_url
router.get('/', async (req, res) => {
    try {
        const store = await resolveStoreUuid(req.params.storeId);
        if (!store) return res.status(404).json({ success: false, error: 'Store not found' });

        const { rows } = await pool.query(
            `SELECT id, name, phone, premium_percent, avatar_url, is_active,
                    work_start, work_end, created_at,
                    permissions,
                    google_email
             FROM service.staff_members
             WHERE store_id = $1
             ORDER BY is_active DESC, name`,
            [store.uuid]
        );
        res.json({ success: true, data: rows });
    } catch (err) {
        console.error('Staff admin list error:', err);
        res.status(500).json({ success: false, error: 'Failed to fetch staff' });
    }
});

// ── POST /api/store/:storeId/admin/staff ──────────────────────────────────
// Create a new staff member
router.post('/', async (req, res) => {
    try {
        const store = await resolveStoreUuid(req.params.storeId);
        if (!store) return res.status(404).json({ success: false, error: 'Store not found' });

        const { name, phone, premium_percent } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).json({ success: false, error: 'Name is required' });
        }

        const { rows } = await pool.query(
            `INSERT INTO service.staff_members
                (store_id, name, phone, premium_percent, is_active)
             VALUES ($1, $2, $3, $4, true)
             ON CONFLICT (store_id, LOWER(TRIM(name)))
             DO UPDATE SET
                phone           = EXCLUDED.phone,
                premium_percent = EXCLUDED.premium_percent,
                is_active       = true,
                updated_at      = NOW()
             RETURNING id, name, phone, premium_percent, avatar_url, is_active`,
            [store.uuid, name.trim(), phone?.trim() || null, parseFloat(premium_percent) || 0]
        );
        res.json({ success: true, data: rows[0] });
    } catch (err) {
        console.error('Staff create error:', err);
        res.status(500).json({ success: false, error: 'Failed to create staff member' });
    }
});

// ── PATCH /api/store/:storeId/admin/staff/:staffId ────────────────────────
// Update name, phone, premium_percent, is_active
router.patch('/:staffId', async (req, res) => {
    try {
        const store = await resolveStoreUuid(req.params.storeId);
        if (!store) return res.status(404).json({ success: false, error: 'Store not found' });

        const { staffId } = req.params;
        const { name, phone, premium_percent, is_active } = req.body;

        const setClauses = [];
        const values = [];
        let idx = 1;

        if (name !== undefined) { setClauses.push(`name = $${idx++}`); values.push(name.trim()); }
        if (phone !== undefined) { setClauses.push(`phone = $${idx++}`); values.push(phone?.trim() || null); }
        if (premium_percent !== undefined) { setClauses.push(`premium_percent = $${idx++}`); values.push(parseFloat(premium_percent) || 0); }
        if (is_active !== undefined) { setClauses.push(`is_active = $${idx++}`); values.push(Boolean(is_active)); }

        if (!setClauses.length) {
            return res.status(400).json({ success: false, error: 'No fields to update' });
        }
        setClauses.push(`updated_at = NOW()`);

        values.push(staffId, store.uuid);
        const { rows } = await pool.query(
            `UPDATE service.staff_members
             SET ${setClauses.join(', ')}
             WHERE id = $${idx++} AND store_id = $${idx++}
             RETURNING id, name, phone, premium_percent, avatar_url, is_active`,
            values
        );

        if (!rows.length) return res.status(404).json({ success: false, error: 'Staff not found' });
        res.json({ success: true, data: rows[0] });
    } catch (err) {
        console.error('Staff update error:', err);
        res.status(500).json({ success: false, error: 'Failed to update staff member' });
    }
});

// ── POST /api/store/:storeId/admin/staff/:staffId/photo ───────────────────
// Upload/replace staff photo — saves to disk, stores URL in avatar_url
router.post(
    '/:staffId/photo',
    uploadSingle('photo'),
    handleMulterError,
    (req, res, next) => { req.imageType = 'STAFF_PHOTO'; next(); },
    validateSingleImage,
    async (req, res) => {
        try {
            const store = await resolveStoreUuid(req.params.storeId);
            if (!store) return res.status(404).json({ success: false, error: 'Store not found' });

            const { staffId } = req.params;

            // Confirm staff belongs to this store
            const staffRow = await pool.query(
                `SELECT id FROM service.staff_members WHERE id = $1 AND store_id = $2`,
                [staffId, store.uuid]
            );
            if (!staffRow.rows.length) {
                return res.status(404).json({ success: false, error: 'Staff not found' });
            }

            // Save image to disk via ImageService (creates uploads/.../staff/:staffId/...)
            const saved = await ImageService.processAndSaveImage(
                req.file,
                'STAFF_PHOTO',
                store.uuid,   // tenantId placeholder — use store uuid as tenant key
                store.uuid,   // storeId
                staffId       // referenceId → subfolder
            );

            // Persist URL in staff_members
            const { rows } = await pool.query(
                `UPDATE service.staff_members
                 SET avatar_url = $1, updated_at = NOW()
                 WHERE id = $2 AND store_id = $3
                 RETURNING id, name, phone, premium_percent, avatar_url, is_active`,
                [saved.url, staffId, store.uuid]
            );

            res.json({ success: true, data: rows[0], url: saved.url });
        } catch (err) {
            console.error('Staff photo upload error:', err);
            res.status(500).json({ success: false, error: err.message || 'Failed to upload photo' });
        }
    }
);

// ── PATCH /api/store/:storeId/admin/staff/:staffId/permissions ───────────
// Set which store-admin pages this staff member can access, and their Gmail.
// permissions: string[] of page keys (e.g. ['orders','customers'])
//              null = portal access disabled
// google_email: the Gmail address the staff will use to log in
router.patch('/:staffId/permissions', async (req, res) => {
    try {
        const store = await resolveStoreUuid(req.params.storeId);
        if (!store) return res.status(404).json({ success: false, error: 'Store not found' });

        const { staffId } = req.params;
        let { permissions, google_email } = req.body;

        // permissions: null = revoke access, or [{page, access}] array
        // access values: 'view' | 'edit'
        if (permissions !== null && permissions !== undefined) {
            if (!Array.isArray(permissions)) {
                return res.status(400).json({ success: false, error: 'permissions must be an array or null' });
            }
            const VALID_PAGES = ['dashboard','orders','customers','inventory','couriers','reports','staff','returns','coupons','appointments'];
            const VALID_ACCESS = ['view', 'edit'];
            for (const p of permissions) {
                if (!p.page || !VALID_PAGES.includes(p.page)) {
                    return res.status(400).json({ success: false, error: `Unknown page: "${p.page}"` });
                }
                if (!p.access || !VALID_ACCESS.includes(p.access)) {
                    return res.status(400).json({ success: false, error: `Invalid access level "${p.access}" — must be "view" or "edit"` });
                }
            }
            // Gmail required when granting any access
            if (permissions.length > 0) {
                if (!google_email || !google_email.includes('@')) {
                    return res.status(400).json({ success: false, error: 'A Gmail address is required to enable portal access' });
                }
            }
        }

        const { rows } = await pool.query(
            `UPDATE service.staff_members
             SET permissions = $1::jsonb,
                 google_email = $2,
                 updated_at = NOW()
             WHERE id = $3 AND store_id = $4
             RETURNING id, name, permissions, google_email`,
            [
                permissions === null ? null : JSON.stringify(permissions),
                (permissions && permissions.length > 0 && google_email) ? google_email.trim().toLowerCase() : null,
                staffId,
                store.uuid
            ]
        );

        if (!rows.length) return res.status(404).json({ success: false, error: 'Staff not found' });
        res.json({ success: true, data: rows[0] });
    } catch (err) {
        console.error('Staff permissions update error:', err);
        res.status(500).json({ success: false, error: 'Failed to update permissions' });
    }
});

// ── DELETE /api/store/:storeId/admin/staff/:staffId ───────────────────────
// Soft-delete (is_active = false)
router.delete('/:staffId', async (req, res) => {
    try {
        const store = await resolveStoreUuid(req.params.storeId);
        if (!store) return res.status(404).json({ success: false, error: 'Store not found' });

        await pool.query(
            `UPDATE service.staff_members SET is_active = false, updated_at = NOW()
             WHERE id = $1 AND store_id = $2`,
            [req.params.staffId, store.uuid]
        );
        res.json({ success: true });
    } catch (err) {
        console.error('Staff delete error:', err);
        res.status(500).json({ success: false, error: 'Failed to deactivate staff member' });
    }
});

module.exports = router;
