// src/middleware/optimisticLock.js
//
// Optimistic concurrency control for store-admin write operations.
//
// HOW IT WORKS:
//   1. When the frontend fetches a record (order, return, coupon) it receives
//      an `updated_at` timestamp.
//   2. When the frontend submits a change it sends that same timestamp as
//      `X-Resource-Version` header (or body field `resourceVersion`).
//   3. This helper re-reads the row's current `updated_at` from the DB.
//      If it has moved past what the client sent, someone else already saved
//      a change — we return 409 with who made the change and when, so the
//      frontend can warn the user before any data is overwritten.
//
// USAGE (in a controller, before the UPDATE):
//   const conflict = await checkVersion(pool, 'orders', orderId, req);
//   if (conflict) return res.status(409).json(conflict);
//
// The frontend should show something like:
//   "This order was updated by [Owner / Staff: Priya] 2 minutes ago.
//    Refresh to see the latest version before making changes."

const pool = require('../config/database');

/**
 * Check whether a record has been modified since the client last loaded it.
 *
 * @param {object} db        - pg pool (imported so callers don't need to pass it)
 * @param {string} table     - table name: 'orders' | 'order_returns' | 'discount_codes'
 * @param {string|number} id - record primary key value
 * @param {object} req       - Express request (reads version from header or body)
 * @param {string} [idCol]   - primary key column name (default: 'id')
 * @returns {object|null}    - conflict payload to send as 409, or null if safe to proceed
 */
async function checkVersion(db, table, id, req, idCol = 'id') {
    // Client sends the updated_at it last saw — either as a header or body field.
    const clientVersion =
        req.headers['x-resource-version'] ||
        req.body?.resourceVersion ||
        null;

    // If the client didn't send a version at all, allow the write.
    // This keeps backwards compatibility with any frontend not yet sending versions.
    if (!clientVersion) return null;

    const { rows } = await db.query(
        `SELECT updated_at FROM ${table} WHERE ${idCol} = $1`,
        [id]
    );
    if (!rows.length) return null; // record not found — let the controller handle 404

    const dbVersion = rows[0].updated_at;
    if (!dbVersion) return null; // no updated_at column — skip check

    const clientTime = new Date(clientVersion).getTime();
    const dbTime     = new Date(dbVersion).getTime();

    if (dbTime > clientTime) {
        // Someone else saved after the client loaded this record.
        // Try to find who did it (best-effort, not required).
        const actor = await resolveLastActor(db, table, id, idCol);
        return {
            success: false,
            conflict: true,
            error: 'This record was updated by someone else after you opened it. Refresh to see the latest version before saving your changes.',
            updatedAt: dbVersion,
            updatedBy: actor,   // { role: 'owner'|'staff', name: string } or null
        };
    }

    return null; // versions match — safe to proceed
}

/**
 * Best-effort: find who last touched this record by looking at order_status_history
 * or activity_logs. Returns null if we can't determine it.
 */
async function resolveLastActor(db, table, id, idCol) {
    try {
        if (table === 'orders') {
            const { rows } = await db.query(
                `SELECT changed_by FROM order_status_history
                 WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1`,
                [id]
            );
            if (rows.length && rows[0].changed_by) {
                const who = rows[0].changed_by; // e.g. 'store-admin:42' or 'staff:7'
                return parseActor(who);
            }
        }
        return null;
    } catch (_) {
        return null; // never let this crash the conflict response
    }
}

function parseActor(adminId) {
    if (!adminId) return null;
    if (adminId.startsWith('store-admin:')) return { role: 'owner', name: 'Store Owner' };
    if (adminId.startsWith('staff:'))       return { role: 'staff',  name: 'A staff member' };
    return null;
}

module.exports = { checkVersion };
