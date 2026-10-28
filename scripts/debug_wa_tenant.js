/**
 * Debug WA tenant join — run: node scripts/debug_wa_tenant.js
 */
const pool = require('../src/config/database');

async function debug() {
  const client = await pool.connect();
  try {
    // 1. Raw WA orders — what's in store_id and order_data
    const raw = await client.query(`
      SELECT order_id, store_id,
             order_data->>'tenant_id' as json_tenant_id,
             order_data->>'plan_id' as plan_id,
             amount, status
      FROM cashfree_pending_orders
      WHERE order_id LIKE 'WA_%' AND status = 'paid'
      LIMIT 5
    `);
    console.log('\n=== RAW WA ORDERS ===');
    raw.rows.forEach(r => console.log(JSON.stringify(r)));

    // 2. Check if store_id matches any tenant id
    if (raw.rows.length > 0) {
      const storeId = raw.rows[0].store_id;
      const jsonTenantId = raw.rows[0].json_tenant_id;
      console.log(`\n=== CHECKING JOINS for order: ${raw.rows[0].order_id} ===`);
      console.log(`store_id value: "${storeId}" (type: ${typeof storeId})`);
      console.log(`json tenant_id: "${jsonTenantId}"`);

      // Try join via store_id
      const t1 = await client.query(
        `SELECT id, company_name FROM tenants WHERE id::text = $1`, [storeId]
      );
      console.log(`Join via store_id: ${t1.rows.length ? t1.rows[0].company_name : 'NO MATCH'}`);

      // Try join via json tenant_id
      if (jsonTenantId) {
        const t2 = await client.query(
          `SELECT id, company_name FROM tenants WHERE id::text = $1`, [jsonTenantId]
        );
        console.log(`Join via json tenant_id: ${t2.rows.length ? t2.rows[0].company_name : 'NO MATCH'}`);
      }

      // Try via wa_subscriptions which WORKS
      const ws = await client.query(
        `SELECT ws.tenant_id, t.company_name
         FROM wa_subscriptions ws
         JOIN tenants t ON t.id = ws.tenant_id
         LIMIT 3`
      );
      console.log('\n=== WA_SUBSCRIPTIONS sample (working join) ===');
      ws.rows.forEach(r => console.log(JSON.stringify(r)));

      // Check tenants table — what IDs look like
      const tenants = await client.query(`SELECT id, company_name FROM tenants LIMIT 3`);
      console.log('\n=== TENANTS sample ===');
      tenants.rows.forEach(r => console.log(JSON.stringify(r)));
    }
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    client.release();
    pool.end();
  }
}

debug();
