const pool = require('../config/database');

// ── helpers ──────────────────────────────────────────────────────────────────
const toMins = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const toTime = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

// Ensure the slot_holds table exists (idempotent — runs once at startup and on
// first hold request so the feature works even if the migration hasn't been run).
let holdsTableReady = false;
async function ensureHoldsTable() {
    if (holdsTableReady) return;
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS service.slot_holds (
                id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                store_id      TEXT NOT NULL,
                staff_id      INT  REFERENCES service.staff_members(id) ON DELETE CASCADE,
                booking_date  DATE NOT NULL,
                slot_time     TIME NOT NULL,
                duration_mins INT  NOT NULL DEFAULT 60,
                expires_at    TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '10 minutes'),
                created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_slot_holds_lookup
                ON service.slot_holds (store_id, staff_id, booking_date, slot_time, expires_at)
        `).catch(() => {}); // index creation failure is non-fatal
        holdsTableReady = true;
    } catch (err) {
        console.error('slot_holds table setup error:', err.message);
        // Don't set holdsTableReady — will retry next request
    }
}

const SlotsController = {
    // GET /api/store/:storeId/staff
    getStaffList: async (req, res) => {
        try {
            const { storeId } = req.params;
            const storeRow = await pool.query(
                `SELECT store_id, config FROM stores
                 WHERE store_id = $1
                    OR (id::text = $1 AND $1 ~ '^[0-9]+$')
                 LIMIT 1`,
                [String(storeId)]
            ).catch(() => ({ rows: [] }));
            const resolvedStoreId = storeRow.rows[0]?.store_id || storeId;

            const staffRows = await pool.query(
                `SELECT id, name, premium_percent, avatar_url FROM service.staff_members
                 WHERE store_id = $1 AND is_active = true
                 ORDER BY name`,
                [resolvedStoreId]
            ).catch(() => ({ rows: [] }));

            if (staffRows.rows.length === 0) {
                const config = storeRow.rows[0]?.config || {};
                const booking = config.booking || config.products?.bookingSettings || {};
                const configStaff = (booking.staffMembers || [])
                    .filter(s => s.name && s.name.toLowerCase() !== 'all staff')
                    .map(s => ({
                        id: null,
                        name: s.name.trim(),
                        premium_percent: parseFloat(s.premiumPercent) || 0,
                        avatar_url: s.photoUrl || s.avatar_url || null,
                    }));
                return res.json({ success: true, data: configStaff });
            }

            res.json({ success: true, data: staffRows.rows });
        } catch (error) {
            console.error('Staff list error:', error);
            res.status(500).json({ success: false, error: 'Failed to get staff list' });
        }
    },

    // GET /api/store/:storeId/slots?date=&serviceDuration=&staffName=
    getAvailableSlots: async (req, res) => {
        try {
            await ensureHoldsTable();
            const { storeId } = req.params;
            const { date, serviceDuration, staffName } = req.query;

            if (!date || !serviceDuration) {
                return res.status(400).json({ success: false, error: 'date and serviceDuration required' });
            }

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

            const workStart  = booking.workStart  || '10:00';
            const workEnd    = booking.workEnd    || '19:00';
            const breakStart = booking.breakStart || null;
            const breakEnd   = booking.breakEnd   || null;
            const gapBetween = parseInt(booking.gapBetween) || 15;
            const duration   = parseInt(serviceDuration);
            const slotSize   = duration + gapBetween;

            const isAllStaff = !staffName || staffName === 'All Staff';

            const startMins      = toMins(workStart);
            const endMins        = toMins(workEnd);
            const breakStartMins = breakStart ? toMins(breakStart) : null;
            const breakEndMins   = breakEnd   ? toMins(breakEnd)   : null;

            const now        = new Date();
            const isToday    = date === now.toISOString().split('T')[0];
            const currentMins = isToday ? now.getHours() * 60 + now.getMinutes() : 0;

            // ── Staff resolution ────────────────────────────────────────────
            let targetStaffId   = null;
            let activeStaffList = [];

            const staffRows = await pool.query(
                `SELECT id, name FROM service.staff_members
                 WHERE store_id = $1 AND is_active = true
                 ORDER BY name`,
                [storeUuid]
            ).catch(() => ({ rows: [] }));

            if (staffRows.rows.length > 0) {
                activeStaffList = staffRows.rows;
            } else {
                const configStaff = (booking.staffMembers || [])
                    .filter(s => s.name && s.name.toLowerCase() !== 'all staff')
                    .map((s, i) => ({ id: `cfg_${i}`, name: s.name.trim() }));
                activeStaffList = configStaff;
            }

            if (!isAllStaff) {
                const found = activeStaffList.find(s => s.name === staffName);
                if (found) targetStaffId = found.id;
            }

            // ── Existing confirmed bookings ─────────────────────────────────
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
                try {
                    const bResult = await pool.query(
                        `SELECT booking_time, duration_mins, NULL::int AS staff_id
                         FROM public.service_bookings
                         WHERE store_id = $1 AND booking_date = $2 AND status != 'cancelled'`,
                        [storeId, date]
                    );
                    bookingRows = bResult.rows;
                } catch (__) {
                    bookingRows = [];
                }
            }

            // ── Active slot holds (30-min temp locks) ───────────────────────
            let holdRows = [];
            try {
                const hResult = await pool.query(
                    `SELECT staff_id, slot_time, duration_mins
                     FROM service.slot_holds
                     WHERE store_id = $1 AND booking_date = $2 AND expires_at > NOW()`,
                    [storeUuid, date]
                );
                holdRows = hResult.rows;
            } catch (_) {
                // slot_holds table may not exist yet — safe to ignore
            }

            // ── Build busy ranges (bookings + holds) per staff ──────────────
            const staffBusyRanges = {};  // staffId → [{start, end}]

            const addBusy = (sid, startT, dur) => {
                if (sid == null) return;
                if (!staffBusyRanges[sid]) staffBusyRanges[sid] = [];
                const s = toMins(String(startT).substring(0, 5));
                staffBusyRanges[sid].push({ start: s, end: s + parseInt(dur) });
            };

            bookingRows.forEach(b => addBusy(b.staff_id, b.booking_time, b.duration_mins || duration));
            holdRows.forEach(h => addBusy(h.staff_id, h.slot_time, h.duration_mins || duration));

            const isStaffBusy = (staffId, slotStartMins) => {
                const slotEnd = slotStartMins + duration;
                return (staffBusyRanges[staffId] || []).some(r => slotStartMins < r.end && slotEnd > r.start);
            };

            // Legacy unassigned bookings (no staff_id)
            const legacyCountAt = {};
            bookingRows.filter(b => b.staff_id == null).forEach(b => {
                const t = b.booking_time.substring(0, 5);
                legacyCountAt[t] = (legacyCountAt[t] || 0) + 1;
            });

            // ── Generate slots ──────────────────────────────────────────────
            const slots = [];
            let current = startMins;

            while (current + duration <= endMins) {
                const slotEnd = current + duration;

                const inBreak = breakStartMins && breakEndMins &&
                    current < breakEndMins && slotEnd > breakStartMins;
                if (inBreak) { current = breakEndMins; continue; }

                const startTime = toTime(current);
                const isPast    = isToday && current <= currentMins;

                if (isAllStaff) {
                    const freeStaff    = activeStaffList.filter(s => !isStaffBusy(s.id, current));
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
    },

    // POST /api/store/:storeId/slots/hold
    // Body: { date, slotTime, staffName, durationMins }
    // Returns: { holdId, expiresAt }
    holdSlot: async (req, res) => {
        try {
            await ensureHoldsTable();
            const { storeId } = req.params;
            const { date, slotTime, staffName, durationMins } = req.body;

            if (!date || !slotTime) {
                return res.status(400).json({ success: false, error: 'date and slotTime required' });
            }

            // Resolve store UUID
            const storeResult = await pool.query(
                `SELECT store_id FROM stores
                 WHERE store_id = $1 OR (id::text = $1 AND $1 ~ '^[0-9]+$')
                 LIMIT 1`,
                [String(storeId)]
            );
            if (storeResult.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Store not found' });
            }
            const storeUuid = storeResult.rows[0].store_id;

            // Resolve staff_id from name (optional)
            let staffId = null;
            if (staffName && staffName !== 'All Staff') {
                const sRow = await pool.query(
                    `SELECT id FROM service.staff_members
                     WHERE store_id = $1 AND name = $2 AND is_active = true LIMIT 1`,
                    [storeUuid, staffName]
                ).catch(() => ({ rows: [] }));
                staffId = sRow.rows[0]?.id || null;
            }

            const dur = parseInt(durationMins) || 60;

            // Check the slot isn't already booked or held by someone else right now
            const conflictBooking = await pool.query(
                `SELECT id FROM service.bookings
                 WHERE store_id = $1 AND booking_date = $2 AND status != 'cancelled'
                   AND staff_id = $3
                   AND booking_time < ($4::time + ($5 || ' minutes')::interval)
                   AND (booking_time + (duration_mins || ' minutes')::interval) > $4::time
                 LIMIT 1`,
                [storeUuid, date, staffId, slotTime, dur]
            ).catch(() => ({ rows: [] }));

            if (conflictBooking.rows.length > 0) {
                return res.status(409).json({ success: false, error: 'Slot already booked' });
            }

            const conflictHold = await pool.query(
                `SELECT id FROM service.slot_holds
                 WHERE store_id = $1 AND booking_date = $2 AND expires_at > NOW()
                   AND staff_id = $3
                   AND slot_time < ($4::time + ($5 || ' minutes')::interval)
                   AND (slot_time + (duration_mins || ' minutes')::interval) > $4::time
                 LIMIT 1`,
                [storeUuid, date, staffId, slotTime, dur]
            ).catch(() => ({ rows: [] }));

            if (conflictHold.rows.length > 0) {
                return res.status(409).json({ success: false, error: 'Slot is temporarily held by another customer. Please try a different slot.' });
            }

            // Create hold
            const result = await pool.query(
                `INSERT INTO service.slot_holds (store_id, staff_id, booking_date, slot_time, duration_mins, expires_at)
                 VALUES ($1, $2, $3, $4::time, $5, NOW() + INTERVAL '10 minutes')
                 RETURNING id, expires_at`,
                [storeUuid, staffId, date, slotTime, dur]
            );

            const { id: holdId, expires_at: expiresAt } = result.rows[0];
            res.json({ success: true, holdId, expiresAt });

        } catch (error) {
            console.error('Hold slot error:', error);
            res.status(500).json({ success: false, error: 'Failed to hold slot' });
        }
    },

    // DELETE /api/store/:storeId/slots/hold/:holdId
    releaseHold: async (req, res) => {
        try {
            const { holdId } = req.params;
            await pool.query(
                `DELETE FROM service.slot_holds WHERE id = $1`,
                [holdId]
            ).catch(() => {});
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ success: false, error: 'Failed to release hold' });
        }
    },
};

module.exports = SlotsController;
