/**
 * Migration: create service.slot_holds
 *
 * A slot hold is a 30-minute soft lock placed when a customer taps a time
 * slot in the storefront before they complete their booking.  Once a real
 * booking exists (or the hold expires) the slot is released automatically.
 *
 * Columns:
 *   id          – UUID primary key returned to the client as holdId
 *   store_id    – FK to stores
 *   staff_id    – FK to service.staff_members (nullable: "any staff" holds)
 *   booking_date – DATE
 *   slot_time    – TIME (HH:MM)
 *   duration_mins – same value used for availability check
 *   expires_at   – TIMESTAMPTZ; auto-set to NOW() + 30 min on insert
 *   created_at
 */
const pool = require('../config/database');

async function up() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS service.slot_holds (
            id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            store_id      TEXT NOT NULL,
            staff_id      INT  REFERENCES service.staff_members(id) ON DELETE CASCADE,
            booking_date  DATE NOT NULL,
            slot_time     TIME NOT NULL,
            duration_mins INT  NOT NULL DEFAULT 60,
            expires_at    TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 minutes'),
            created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_slot_holds_lookup
            ON service.slot_holds (store_id, staff_id, booking_date, slot_time)
            WHERE expires_at > NOW();
    `);
    console.log('✓ service.slot_holds created');
}

async function down() {
    await pool.query(`DROP TABLE IF EXISTS service.slot_holds;`);
    console.log('✓ service.slot_holds dropped');
}

module.exports = { up, down };
