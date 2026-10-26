const express = require('express');
const router = express.Router({ mergeParams: true });
const pool = require('../../config/database');
const { storeAdminAuth } = require('../../middleware/storeAdminAuth');

router.use(storeAdminAuth);

// GET /api/store/:storeId/admin/appointments?date=2026-10-26
// Returns all bookings for the store on the given date, joined with
// staff info so the frontend can build the scheduler grid directly.
router.get('/', async (req, res) => {
    try {
        const { storeId } = req.params;
        const { date } = req.query;

        if (!date) {
            return res.status(400).json({ success: false, error: 'date query param required (YYYY-MM-DD)' });
        }

        // Resolve storeId → store_id UUID (same pattern as slots.controller)
        const storeRow = await pool.query(
            `SELECT id AS store_int_id, store_id AS store_str_id, config FROM stores
             WHERE store_id = $1
                OR (id::text = $1 AND $1 ~ '^[0-9]+$')
             LIMIT 1`,
            [String(storeId)]
        );
        if (!storeRow.rows.length) {
            return res.status(404).json({ success: false, error: 'Store not found' });
        }
        const storeIntId = storeRow.rows[0].store_int_id;   // integer — bookings.store_id
        const storeStrId = storeRow.rows[0].store_str_id;   // 'STORE_...' — staff_members.store_id

        // Pull bookings from service.bookings joined with staff + orders
        const { rows: bookings } = await pool.query(
            `SELECT
                b.id,
                b.order_id,
                b.order_item_id,
                b.staff_id,
                sm.name           AS staff_name,
                b.booking_date,
                b.booking_time,
                b.duration_mins,
                b.status          AS booking_status,
                b.computed_price,
                b.service_type,
                b.customer_address,
                b.notes,
                o.customer_name,
                o.customer_phone,
                o.status          AS order_status,
                o.total_amount,
                o.branch_name,
                o.order_type,
                o.delivery_address,
                oi.name           AS service_name
             FROM service.bookings b
             LEFT JOIN service.staff_members sm ON sm.id = b.staff_id
             LEFT JOIN orders o  ON o.order_id = b.order_id::text
             LEFT JOIN LATERAL (
                 SELECT elem->>'name' AS name
                 FROM jsonb_array_elements(o.items) AS elem
                 LIMIT 1
             ) oi ON true
             WHERE b.store_id    = $1
               AND b.booking_date = $2
             ORDER BY b.booking_time ASC, sm.name ASC`,
            [storeIntId, date]
        );

        // Also fetch active staff so we can show columns for staff with no bookings
        const { rows: staffList } = await pool.query(
            `SELECT id, name, phone, work_start, work_end
             FROM service.staff_members
             WHERE store_id = $1 AND is_active = true
             ORDER BY name`,
            [storeStrId]
        );

        // Pull store booking hours from config
        const cfg = storeRow.rows[0].config || {};
        const booking = cfg.booking || cfg.products?.bookingSettings || {};

        res.json({
            success: true,
            data: {
                date,
                bookings,
                staff: staffList,
                workStart: booking.workStart || '09:00',
                workEnd:   booking.workEnd   || '20:00',
            }
        });
    } catch (err) {
        console.error('Appointments fetch error:', err);
        res.status(500).json({ success: false, error: 'Failed to fetch appointments' });
    }
});

// PATCH /api/store/:storeId/admin/appointments/:bookingId/status
// Lets the store admin confirm / cancel / mark done an appointment.
router.patch('/:bookingId/status', async (req, res) => {
    try {
        const { storeId, bookingId } = req.params;
        const { status } = req.body;

        const allowed = ['confirmed', 'in_session', 'completed', 'cancelled', 'no_show'];
        if (!allowed.includes(status)) {
            return res.status(400).json({ success: false, error: `status must be one of: ${allowed.join(', ')}` });
        }

        const storeRow = await pool.query(
            `SELECT id AS store_int_id FROM stores
             WHERE store_id = $1
                OR (id::text = $1 AND $1 ~ '^[0-9]+$')
             LIMIT 1`,
            [String(storeId)]
        );
        if (!storeRow.rows.length) return res.status(404).json({ success: false, error: 'Store not found' });
        const storeIntId = storeRow.rows[0].store_int_id;

        const { rows } = await pool.query(
            `UPDATE service.bookings
             SET status = $1, updated_at = NOW()
             WHERE id = $2 AND store_id = $3
             RETURNING id, status, order_id::text AS order_id`,
            [status, bookingId, storeIntId]
        );

        if (!rows.length) return res.status(404).json({ success: false, error: 'Booking not found' });

        // Mirror status change to the linked order so customer sees it on storefront
        const ORDER_STATUS_MAP = {
            confirmed:  'confirmed',
            in_session: 'processing',
            completed:  'delivered',
            cancelled:  'cancelled',
            no_show:    'cancelled',
        };
        const orderStatus = ORDER_STATUS_MAP[status];
        if (orderStatus && rows[0].order_id) {
            await pool.query(
                `UPDATE orders SET status = $1, updated_at = NOW()
                 WHERE order_id = $2`,
                [orderStatus, rows[0].order_id]
            ).catch(e => console.warn('⚠️ Order status sync failed:', e.message));
        }

        res.json({ success: true, data: rows[0] });
    } catch (err) {
        console.error('Appointment status update error:', err);
        res.status(500).json({ success: false, error: 'Failed to update appointment status' });
    }
});

module.exports = router;
