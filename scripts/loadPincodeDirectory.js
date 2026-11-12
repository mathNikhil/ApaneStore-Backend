#!/usr/bin/env node
// Loads the All India Pincode Directory (data.gov.in) into pincode_directory.
//   DATA_GOV_API_KEY=xxxx node scripts/loadPincodeDirectory.js
// Key comes from the environment only. Never hardcode it, never commit it.
// Replaces all source='datagov' rows in one transaction. source='manual' rows are never touched.
require('dotenv').config();
const { Pool } = require('pg');
const { canonicalState, normText } = require('../src/utils/indiaGeo');

const RESOURCE = '5c2f62fe-5afa-4119-a499-fec9d604d5bd';
const BASE = `https://api.data.gov.in/resource/${RESOURCE}`;
const PAGE = 1000;
const MIN_EXPECTED_RECORDS = 100000; // directory has ~165k post offices; refuse to wipe the table on a partial download

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(key, offset, limit) {
    for (let attempt = 1; attempt <= 4; attempt++) {
        try {
            const res = await fetch(`${BASE}?api-key=${encodeURIComponent(key)}&format=json&limit=${limit}&offset=${offset}`);
            const body = await res.json();
            if (body.error) throw new Error(`API error: ${body.error}`);
            if (!Array.isArray(body.records)) throw new Error('Unexpected response shape');
            return body;
        } catch (e) {
            if (attempt === 4) throw e;
            await sleep(1000 * attempt);
        }
    }
}

// records -> Map("pincode|State" -> Set(places)), plus a list of state names we could not map
function buildRows(records) {
    const rows = new Map();
    const unmapped = new Map();
    for (const r of records) {
        const pincode = String(r.pincode || '').replace(/\D/g, '').padStart(6, '0');
        if (!/^[1-9]\d{5}$/.test(pincode)) continue;
        let state = canonicalState(r.statename);
        if (!state) { unmapped.set(r.statename, (unmapped.get(r.statename) || 0) + 1); continue; }
        const k = `${pincode}|${state}`;
        if (!rows.has(k)) rows.set(k, new Set());
        const set = rows.get(k);
        const d = normText(r.district); if (d) set.add(d);
        const o = normText(r.officename); if (o) set.add(o);
    }
    return { rows, unmapped };
}

async function main() {
    const key = process.env.DATA_GOV_API_KEY;
    if (!key) { console.error('Set DATA_GOV_API_KEY in the environment.'); process.exit(1); }

    const all = [];
    let offset = 0, total = Infinity, step = PAGE;
    while (offset < total) {
        const body = await fetchPage(key, offset, PAGE);
        total = Number(body.total) || all.length + body.records.length;
        if (!body.records.length) break;
        if (offset === 0 && body.records.length < PAGE && total > body.records.length) {
            step = body.records.length;
            if (step < 100) { console.error(`This key returns only ${step} records per call (sample key?). Generate your own key in My Account.`); process.exit(1); }
            console.warn(`Key caps pages at ${step} records; continuing with that page size.`);
        }
        all.push(...body.records);
        offset += body.records.length;
        process.stdout.write(`\rfetched ${all.length}/${total}`);
        await sleep(120);
    }
    console.log();
    if (all.length < MIN_EXPECTED_RECORDS) { console.error(`Only ${all.length} records fetched, expected 100k+. Not touching the table.`); process.exit(1); }

    const { rows, unmapped } = buildRows(all);
    console.log(`${all.length} post offices -> ${rows.size} (pincode, state) rows`);
    if (unmapped.size) {
        console.warn('State names that did NOT map to the storefront dropdown (add them to STATE_ALIASES in src/utils/indiaGeo.js):');
        for (const [s, n] of unmapped) console.warn(`  "${s}"  x${n}`);
    }

    const pool = new Pool({ host: process.env.DB_HOST || 'localhost', port: process.env.DB_PORT || 5432, database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD });
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(`DELETE FROM pincode_directory WHERE source = 'datagov'`);
        const entries = [...rows.entries()];
        for (let i = 0; i < entries.length; i += 2000) {
            const slice = entries.slice(i, i + 2000);
            await client.query(
                `INSERT INTO pincode_directory (pincode, state, places, source)
                 SELECT a, b, c, 'datagov' FROM unnest($1::text[], $2::text[], $3::text[]) AS t(a, b, c)
                 ON CONFLICT (pincode, state) DO NOTHING`,
                [slice.map(([k]) => k.split('|')[0]), slice.map(([k]) => k.split('|')[1]), slice.map(([, set]) => [...set].join('|'))]
            );
        }
        await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }

    const check = await pool.query(`SELECT state FROM pincode_directory WHERE pincode = '500001'`);
    console.log('Sanity check, pincode 500001 (Hyderabad) ->', check.rows.map((r) => r.state).join(', ') || 'NOT FOUND');
    const states = await pool.query(`SELECT state, COUNT(*) n FROM pincode_directory GROUP BY state ORDER BY state`);
    console.log(`${states.rowCount} states/UTs loaded (expected ~36)`);
    await pool.end();
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { buildRows };
