/**
 * Backfill tenant_name/email/phone into cashfree_pending_orders.order_data
 * for existing WA orders where tenant still exists in DB.
 * Run once: node scripts/backfill_wa_tenant_names.js
 */
const pool = require('../src/config/database');

async function backfill() {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(`
      SELECT cpo.id, cpo.order_data,
             t.company_name, t.email, t.mobile as phone
      FROM cashfree_pending_orders cpo
      LEFT JOIN tenants t ON t.id = (cpo.order_data->>'tenant_id')::int
      WHERE cpo.order_id LIKE 'WA_%'
        AND cpo.status = 'paid'
        AND t.id IS NOT NULL
        AND (cpo.order_data->>'tenant_name' IS NULL OR cpo.order_data->>'tenant_name' = '')
    `);

    console.log(`Found ${rows.length} orders to backfill`);

    for (const row of rows) {
      const updated = {
        ...row.order_data,
        tenant_name: row.company_name || '',
        tenant_email: row.email || '',
        tenant_phone: row.phone || '',
      };
      await client.query(
        `UPDATE cashfree_pending_orders SET order_data = $1 WHERE id = $2`,
        [JSON.stringify(updated), row.id]
      );
      console.log(`✅ Backfilled order id=${row.id} tenant="${row.company_name}"`);
    }

    console.log('Backfill complete!');
  } catch (e) {
    console.error('Backfill failed:', e.message);
  } finally {
    client.release();
    pool.end();
  }
}

backfill();
