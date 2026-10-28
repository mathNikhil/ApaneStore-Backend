const express = require('express');
const router = express.Router({ mergeParams: true });
const pool = require('../../config/database');
const { authenticate } = require('../../middleware/auth');

// Tenant-auth: called from the Store Builder (uses tenant JWT, not store-admin session)
router.use(authenticate);

/**
 * PUT /api/stores/:storeId/staff/sync
 *
 * Called by the Store Builder whenever bookingSettings.staffMembers changes.
 * Keeps service.staff_members in sync with the config blob so:
 *   - Slot availability queries work correctly (filter by staff_id)
 *   - The appointments scheduler has the right staff columns
 *   - Booking inserts can resolve staff names to IDs at order time
 *
 * Body: { staffMembers: [{ name, phone?, premiumPercent? }, ...] }
 *
 * Strategy (audit-safe, never deletes):
 *   - Upsert each member by (store_id, LOWER(TRIM(name))) — add if new, reactivate if was deactivated
 *   - Deactivate (is_active = false) any staff not in the incoming list
 *   - Never DELETE — preserves FK references from service.bookings for audit trail
 */
router.put('/sync', async (req, res) => {
    try {
        const { storeId } = req.params;
        const { staffMembers } = req.body;

        if (!Array.isArray(staffMembers)) {
            return res.status(400).json({ success: false, error: 'staffMembers must be an array' });
        }

        // Resolve store string ID — storeId may be an integer PK or the 'STORE_...' string
        const storeRow = await pool.query(
            `SELECT store_id AS store_str_id FROM stores
             WHERE store_id = $1
                OR (id::text = $1 AND $1 ~ '^[0-9]+$')
             LIMIT 1`,
            [String(storeId)]
        );
        if (!storeRow.rows.length) {
            return res.status(404).json({ success: false, error: 'Store not found' });
        }
        const storeStrId = storeRow.rows[0].store_str_id;

        // Filter out "All Staff" placeholder and blank names
        const validMembers = staffMembers.filter(m => {
            const n = (m.name || '').trim();
            return n && n.toLowerCase() !== 'all staff';
        });

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Upsert each valid staff member
            const upsertedNames = [];
            for (const member of validMembers) {
                const name = member.name.trim();
                const phone = member.phone?.trim() || null;
                const premiumPercent = parseFloat(member.premiumPercent) || 0;

                await client.query(
                    `INSERT INTO service.staff_members
                        (store_id, name, phone, premium_percent, is_active)
                     VALUES ($1, $2, $3, $4, true)
                     ON CONFLICT (store_id, LOWER(TRIM(name)))
                     DO UPDATE SET
                        phone           = EXCLUDED.phone,
                        premium_percent = EXCLUDED.premium_percent,
                        is_active       = true,
                        updated_at      = NOW()`,
                    [storeStrId, name, phone, premiumPercent]
                );
                upsertedNames.push(name.toLowerCase().trim());
            }

            // Deactivate staff no longer in the list (never DELETE — audit safe)
            if (upsertedNames.length > 0) {
                await client.query(
                    `UPDATE service.staff_members
                     SET is_active = false, updated_at = NOW()
                     WHERE store_id = $1
                       AND LOWER(TRIM(name)) != ALL($2::text[])
                       AND is_active = true`,
                    [storeStrId, upsertedNames]
                );
            } else {
                // Empty list — deactivate everyone (store removed all staff)
                await client.query(
                    `UPDATE service.staff_members
                     SET is_active = false, updated_at = NOW()
                     WHERE store_id = $1 AND is_active = true`,
                    [storeStrId]
                );
            }

            await client.query('COMMIT');

            // Return the current active staff list
            const { rows: staff } = await client.query(
                `SELECT id, name, phone, premium_percent, is_active
                 FROM service.staff_members
                 WHERE store_id = $1 AND is_active = true
                 ORDER BY name`,
                [storeStrId]
            );

            console.log(`✅ Staff sync for store ${storeStrId}: ${staff.length} active members`);
            res.json({ success: true, data: staff });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        console.error('Staff sync error:', err.message, err.stack);
        res.status(500).json({ success: false, error: err.message || 'Failed to sync staff' });
    }
});

/**
 * GET /api/stores/:storeId/staff
 * Returns active staff for the store — used by Store Builder to populate its UI
 */
router.get('/', async (req, res) => {
    try {
        const { storeId } = req.params;

        const storeRow = await pool.query(
            `SELECT store_id AS store_str_id FROM stores
             WHERE store_id = $1
                OR (id::text = $1 AND $1 ~ '^[0-9]+$')
             LIMIT 1`,
            [String(storeId)]
        );
        if (!storeRow.rows.length) {
            return res.status(404).json({ success: false, error: 'Store not found' });
        }
        const storeStrId = storeRow.rows[0].store_str_id;

        const { rows } = await pool.query(
            `SELECT id, name, phone, premium_percent, is_active, work_start, work_end
             FROM service.staff_members
             WHERE store_id = $1 AND is_active = true
             ORDER BY name`,
            [storeStrId]
        );

        res.json({ success: true, data: rows });
    } catch (err) {
        console.error('Staff list error:', err.message);
        res.status(500).json({ success: false, error: 'Failed to fetch staff' });
    }
});

module.exports = router;
