const pool = require('../config/database');

const SlotsController = {
    // GET /api/store/:storeId/slots?date=2026-09-14&serviceDuration=30
    getAvailableSlots: async (req, res) => {
        try {
            const { storeId } = req.params;
            const { date, serviceDuration } = req.query;

            if (!date || !serviceDuration) {
                return res.status(400).json({ success: false, error: 'date and serviceDuration required' });
            }

            // Get store booking config
            const storeResult = await pool.query(
                'SELECT config FROM stores WHERE id = $1',
                [storeId]
            );

            if (storeResult.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Store not found' });
            }

            const config = storeResult.rows[0].config;
            const booking = config?.products?.bookingSettings || config?.booking || {};

            const workStart = booking.workStart || '10:00';
            const workEnd = booking.workEnd || '19:00';
            const breakStart = booking.breakStart || null;
            const breakEnd = booking.breakEnd || null;
            const gapBetween = parseInt(booking.gapBetween) || 15;
            const staffCount = parseInt(booking.staffCount) || 1;
            const duration = parseInt(serviceDuration);

            const slotSize = duration + gapBetween;

            // Parse times to minutes
            const toMins = (t) => {
                const [h, m] = t.split(':').map(Number);
                return h * 60 + m;
            };
            const toTime = (mins) => {
                const h = Math.floor(mins / 60).toString().padStart(2, '0');
                const m = (mins % 60).toString().padStart(2, '0');
                return `${h}:${m}`;
            };

            const startMins = toMins(workStart);
            const endMins = toMins(workEnd);
            const breakStartMins = breakStart ? toMins(breakStart) : null;
            const breakEndMins = breakEnd ? toMins(breakEnd) : null;

            // Get existing bookings for this date
            const bookingsResult = await pool.query(
                `SELECT booking_time, duration_mins FROM service_bookings 
                 WHERE store_id = $1 AND booking_date = $2 AND status != 'cancelled'`,
                [storeId, date]
            );

            // Count bookings per slot start time
            const bookingCounts = {};
            bookingsResult.rows.forEach(b => {
                const key = b.booking_time.substring(0, 5);
                bookingCounts[key] = (bookingCounts[key] || 0) + 1;
            });

            // Current time for past slot blocking
            const now = new Date();
            const isToday = date === now.toISOString().split('T')[0];
            const currentMins = isToday ? now.getHours() * 60 + now.getMinutes() : 0;

            // Generate slots
            const slots = [];
            let current = startMins;

            while (current + duration <= endMins) {
                const slotEnd = current + duration;

                // Check break overlap
                const inBreak = breakStartMins && breakEndMins &&
                    current < breakEndMins && slotEnd > breakStartMins;

                if (inBreak) {
                    current = breakEndMins;
                    continue;
                }

                const startTime = toTime(current);
                const endTime = toTime(slotEnd);
                const bookedCount = bookingCounts[startTime] || 0;
                const isPast = isToday && current <= currentMins;

                slots.push({
                    startTime,
                    endTime,
                    available: !isPast && bookedCount < staffCount,
                    bookedCount,
                    maxCount: staffCount,
                    isPast,
                });

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
