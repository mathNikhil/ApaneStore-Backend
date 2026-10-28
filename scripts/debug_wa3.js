const pool = require('../src/config/database');
async function debug() {
  const client = await pool.connect();
  try {
    // Does tenant id=3 exist?
    const t3 = await client.query(`SELECT id, company_name, email FROM tenants WHERE id = 3`);
    console.log('tenant id=3:', t3.rows);

    const t38 = await client.query(`SELECT id, company_name, email FROM tenants WHERE id = 38`);
    console.log('tenant id=38:', t38.rows);

    // What does tenants.id column type look like?
    const colType = await client.query(`
      SELECT column_name, data_type, udt_name
      FROM information_schema.columns
      WHERE table_name='tenants' AND column_name='id'
    `);
    console.log('tenants.id type:', colType.rows);

    // All tenants
    const all = await client.query(`SELECT id, company_name FROM tenants ORDER BY id`);
    console.log('All tenants:', all.rows);

    // What does store_id=3 point to in stores?
    const s3 = await client.query(`SELECT id, store_name, tenant_id FROM stores WHERE id = 3`);
    console.log('store id=3:', s3.rows);

    const s38 = await client.query(`SELECT id, store_name, tenant_id FROM stores WHERE id = 38`);
    console.log('store id=38:', s38.rows);

  } catch(e) { console.error(e.message); }
  finally { client.release(); pool.end(); }
}
debug();
