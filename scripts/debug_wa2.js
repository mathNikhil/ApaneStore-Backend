const pool = require('../src/config/database');
async function debug() {
  const client = await pool.connect();
  try {
    // What columns does wa_subscriptions have?
    const cols = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'wa_subscriptions' ORDER BY ordinal_position
    `);
    console.log('wa_subscriptions columns:', cols.rows.map(r => r.column_name));

    // Sample rows
    const ws = await client.query(`SELECT * FROM wa_subscriptions LIMIT 3`);
    console.log('\nwa_subscriptions rows:');
    ws.rows.forEach(r => console.log(JSON.stringify(r)));

    // Does store_id in cashfree_pending_orders match wa_subscriptions.id or tenant_id?
    const cpo = await client.query(`
      SELECT cpo.order_id, cpo.store_id, cpo.order_data->>'tenant_id' as json_tid,
             ws.id as ws_id, ws.tenant_id as ws_tenant_id, t.company_name
      FROM cashfree_pending_orders cpo
      LEFT JOIN wa_subscriptions ws ON ws.tenant_id = (cpo.order_data->>'tenant_id')::int
      LEFT JOIN tenants t ON t.id = ws.tenant_id
      WHERE cpo.order_id LIKE 'WA_%' AND cpo.status = 'paid'
      LIMIT 5
    `);
    console.log('\nJoin via wa_subscriptions.tenant_id:');
    cpo.rows.forEach(r => console.log(JSON.stringify(r)));
  } catch(e) { console.error(e.message); }
  finally { client.release(); pool.end(); }
}
debug();
