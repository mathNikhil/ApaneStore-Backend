const pool = require('../config/database');

const SlotsController = {
    // GET /api/store/:storeId/staff
    // Returns active staff members for the store (public, no auth required)
    getStaffList: async (req, res) => {
        try {
            const { storeId } = req.params;
            // storeId may be integer id or string store_id — resolve to store_id UUID + config first
            const storeRow = await pool.query(
                `SELECT store_id, config FROM stores
                 WHERE store_id = $1
                    OR (id::text = $1 AND $1 ~ '^[0-9]+$')
                 LIMIT 1`,
                [String(storeId)]
            ).catch(() => ({ rows: [] }));
            const resolvedStoreId = storeRow.rows[0]?.store_id || storeId;

            const staffRows = await pool.query(
                `SELECT id, name, premium_percent FROM service.staff_members
                 WHERE store_id = $1 AND is_active = true
                 ORDER BY name`,
                [resolvedStoreId]
            ).catch(() => ({ rows: [] }));

            // If DB table is empty, fall back to booking config JSON
            // (store owner hasn't synced staff yet, but they exist in config)
            if (staffRows.rows.length === 0) {
                const config = storeRow.rows[0]?.config || {};
                const booking = config.booking || config.products?.bookingSettings || {};
                const configStaff = (booking.staffMembers || [])
                    .filter(s => s.name && s.name.toLowerCase() !== 'all staff')
                    .map(s => ({
                        id: null,
                        name: s.name.trim(),
                        premium_percent: parseFloat(s.premiumPercent) || 0,
                    }));
                return res.json({ success: true, data: configStaff });
            }

            res.json({ success: true, data: staffRows.rows });
        } catch (error) {
            console.error('Staff list error:', error);
            res.status(500).json({ success: false, error: 'Failed to get staff list' });
        }
    },

    // GET /api/store/:storeId/slots?date=2026-09-14&serviceDuration=30&staffName=Deepika+Mathur
    //
    // staffName behaviour:
    //   - omitted / "All Staff" → show slots where ≥1 active staff member is free
    //                             response includes availableStaff[] on each slot
    //   - specific name         → show only that staff member's slots (capacity = 1)
    getAvailableSlots: async (req, res) => {
        try {
            const { storeId } = req.params;
            const { date, serviceDuration, staffName } = req.query;

            if (!date || !serviceDuration) {
                return res.status(400).json({ success: false, error: 'date and serviceDuration required' });
            }

            // Get store booking config
            // storeId may be either the string store_id ("STORE_...") or the integer id —
// the live storefront passes the integer id; match either column.
            const storeResult = await pool.query(
                `SELECT store_id, config FROM stores
                 WHERE store_id = $1
                    OR (id::text = $1 AND $1 ~ '^[0-9]+$')
                 LIMIT 1`,
                [String(storeId)]
            );

            if (storeResult.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Store not found' });
            }

            const { store_id: storeUuid, config } = storeResult.rows[0];
            const booking = config?.booking || config?.products?.bookingSettings || {};

            const workStart = booking.workStart || '10:00';
            const workEnd   = booking.workEnd   || '19:00';
            const breakStart = booking.breakStart || null;
            const breakEnd   = booking.breakEnd   || null;
            const gapBetween = parseInt(booking.gapBetween) || 15;
            const duration   = parseInt(serviceDuration);
            const slotSize   = duration + gapBetween;

            const isAllStaff = !staffName || staffName === 'All Staff';

            // ── Helpers ──────────────────────────────────────────────────────
            const toMins = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
            const toTime = (m) => `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;

            const startMins      = toMins(workStart);
            const endMins        = toMins(workEnd);
            const breakStartMins = breakStart ? toMins(breakStart) : null;
            const breakEndMins   = breakEnd   ? toMins(breakEnd)   : null;

            // Current time for past-slot blocking
            const now = new Date();
            const isToday = date === now.toISOString().split('T')[0];
            const currentMins = isToday ? now.getHours() * 60 + now.getMinutes() : 0;

            // ── Staff resolution ──────────────────────────────────────────────
            let targetStaffId   = null;   // specific staff only
            let activeStaffList = [];     // [{id, name}] — used for "all staff" mode

            // Fetch all active staff for this store
            const staffRows = await pool.query(
                `SELECT id, name FROM service.staff_members
                 WHERE store_id = $1 AND is_active = true
                 ORDER BY name`,
                [storeUuid]
            ).catch(() => ({ rows: [] }));

            if (staffRows.rows.length > 0) {
                activeStaffList = staffRows.rows;
            } else {
                // Fall back to booking config JSON when DB table is empty
                const configStaff = (booking.staffMembers || [])
                    .filter(s => s.name && s.name.toLowerCase() !== 'all staff')
                    .map((s, i) => ({ id: `cfg_${i}`, name: s.name.trim() }));
                activeStaffList = configStaff;
            }

            if (!isAllStaff) {
                const found = activeStaffList.find(s => s.name === staffName);
                if (found) targetStaffId = found.id;
            }

            // ── Existing bookings for this date ───────────────────────────────
            // Try service.bookings (new schema) first, fall back to public.service_bookings
            let bookingRows = [];
            try {
                const bResult = await pool.query(
                    `SELECT booking_time, duration_mins, staff_id
                     FROM service.bookings
                     WHERE store_id = $1 AND booking_date = $2 AND status != 'cancelled'`,
                    [storeUuid, date]
                );
                bookingRows = bResult.rows;
            } catch (_) {
                // fall back to legacy table (no staff column)
                try {
                    const bResult = await pool.query(
                        `SELECT booking_time, duration_mins, NULL::int AS staff_id
                         FROM public.service_bookings
                         WHERE store_id = $1 AND booking_date = $2 AND status != 'cancelled'`,
                        [storeId, date]   // legacy table uses integer store id
                    );
                    bookingRows = bResult.rows;
                } catch (__) {
                    bookingRows = [];
                }
            }

            // Build busy intervals per staff member.
            // A staff member is busy for the full duration of each booked slot,
            // so we store [busyStart, busyEnd) ranges and check overlap — not
            // just exact start-time matches — to prevent double-booking during
            // an ongoing session.
            const staffBusyRanges = {};  // staffId → [{start: mins, end: mins}]
            bookingRows.forEach(b => {
                const t   = b.booking_time.substring(0, 5);
                const sid = b.staff_id;
                const dur = parseInt(b.duration_mins) || duration;
                if (sid != null) {
                    if (!staffBusyRanges[sid]) staffBusyRanges[sid] = [];
                    staffBusyRanges[sid].push({ start: toMins(t), end: toMins(t) + dur });
                }
            });

            // Helper: is a staff member busy during [slotStart, slotStart+duration)?
            const isStaffBusy = (staffId, slotStartMins) => {
                const slotEnd = slotStartMins + duration;
                return (staffBusyRanges[staffId] || []).some(r => slotStartMins < r.end && slotEnd > r.start);
            };

            // Count legacy/unassigned bookings per slot start-time
            // (these have no staff_id so we can't do overlap check — count them
            //  as capacity consumers against the whole staff pool)
            const legacyCountAt = {};
            bookingRows.filter(b => b.staff_id == null).forEach(b => {
                const t = b.booking_time.substring(0, 5);
                legacyCountAt[t] = (legacyCountAt[t] || 0) + 1;
            });

            // ── Generate slots ────────────────────────────────────────────────
            const slots = [];
            let current = startMins;

            while (current + duration <= endMins) {
                const slotEnd = current + duration;

                // Skip break
                const inBreak = breakStartMins && breakEndMins &&
                    current < breakEndMins && slotEnd > breakStartMins;
                if (inBreak) { current = breakEndMins; continue; }

                const startTime = toTime(current);
                const isPast    = isToday && current <= currentMins;

                if (isAllStaff) {
                    // ── All Staff mode ─────────────────────────────────────────
                    // A slot is available if at least one active staff member is
                    // free for the full slot duration (overlap-aware check).
                    const freeStaff = activeStaffList.filter(s => !isStaffBusy(s.id, current));

                    // Legacy unassigned bookings consume from the total capacity
                    const legacyBooked = legacyCountAt[startTime] || 0;
                    const totalFree    = Math.max(0, freeStaff.length - legacyBooked);

                    slots.push({
                        startTime,
                        endTime: toTime(slotEnd),
                        available: !isPast && totalFree > 0,
                        freeCount: totalFree,
                        totalStaff: activeStaffList.length,
                        availableStaff: freeStaff.map(s => s.name),
                        isPast,
                    });
                } else {
                    // ── Specific staff mode ────────────────────────────────────
                    // Check full overlap: is this staff busy at any point during
                    // [current, current+duration)?
                    const isBooked = targetStaffId ? isStaffBusy(targetStaffId, current) : false;

                    slots.push({
                        startTime,
                        endTime: toTime(slotEnd),
                        available: !isPast && !isBooked,
                        staffName,
                        isPast,
                    });
                }

                current += slotSize;
            }

            res.json({ success: true, data: slots });

        } catch (error) {
            console.error('Slots error:', error);
            res.status(500).json({ success: false, error: 'Failed to get slots' });
        }
    }
};

module.exports = SlotsController;
