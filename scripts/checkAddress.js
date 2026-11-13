#!/usr/bin/env node
// Dry-run the order risk check against the live pincode table. Writes NOTHING to the database.
//   node scripts/checkAddress.js --state Delhi --pincode 462001 --city UP --name asdf --phone 9999999999 --address "home"
// Omitted fields default to a clean Delhi address, so you can change one thing at a time.
require('dotenv').config();
const { Pool } = require('pg');
const { evaluateOrderRisk, getDirectory } = require('../src/services/orderRisk.service');

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i !== -1 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : dflt; };

(async () => {
    const pool = new Pool({ host: process.env.DB_HOST || 'localhost', port: process.env.DB_PORT || 5432, database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD });
    try {
        const directory = await getDirectory(pool);
        const address = {
            recipientName: arg('name', 'Rahul Sharma'),
            recipientMobile: arg('phone', '9812345678'),
            addressLine1: arg('address', 'Flat 12, Green Park Apartments'),
            addressLine2: arg('address2', 'Near City Mall'),
            city: arg('city', 'New Delhi'),
            state: arg('state', 'Delhi'),
            pincode: arg('pincode', '110001'),
            country: arg('country', 'India'),
        };
        console.log(`pincode directory: ${directory.size} pincodes loaded`);
        console.log('checking:', JSON.stringify(address));
        const res = evaluateOrderRisk({ address, orderType: arg('type', 'delivery'), directory, zones: [] });
        console.log(`\nresult: ${res.status}${res.reason ? ` (${res.reason})` : ''}`);
        for (const f of res.flags) console.log(`  ${f.severity.padEnd(6)} ${f.code.padEnd(24)} ${f.message}`);
        if (!res.flags.length && res.status === 'passed') console.log('  no issues found');
    } finally { await pool.end(); }
})().catch((e) => { console.error('failed:', e.message); process.exit(1); });
