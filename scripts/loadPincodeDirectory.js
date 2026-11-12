#!/usr/bin/env node
// Loads the All India Pincode Directory (data.gov.in) into pincode_directory.
//   node scripts/loadPincodeDirectory.js --csv /path/to/5c2f62fe-5afa-4119-a499-fec9d604d5bd.csv   (fast, no API key needed)
//   DATA_GOV_API_KEY=xxxx node scripts/loadPincodeDirectory.js                                    (downloads from the API, slow)
// Key comes from the environment only. Never hardcode it, never commit it.
// Replaces all source='datagov' rows in one transaction. source='manual' rows are never touched.
require('dotenv').config();
const fs = require('fs');
const { Pool } = require('pg');
const { canonicalState, normText } = require('../src/utils/indiaGeo');

const RESOURCE = '5c2f62fe-5afa-4119-a499-fec9d604d5bd';
const BASE = `https://api.data.gov.in/resource/${RESOURCE}`;
const PAGE = 1000;
const REQUEST_TIMEOUT_MS = 30000;   // a hung request must fail fast and be retried, not stall for minutes
const MAX_ATTEMPTS = 6;
const CHECKPOINT = process.env.PINCODE_CHECKPOINT || '/tmp/pincode-checkpoint.ndjson'; // resume file; deleted after a successful load
const MIN_EXPECTED_RECORDS = 100000; // directory has ~165k post offices; refuse to wipe the table on a partial download

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(key, offset, limit, fetchImpl = fetch) {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            const res = await fetchImpl(`${BASE}?api-key=${encodeURIComponent(key)}&format=json&limit=${limit}&offset=${offset}`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
            const body = await res.json();
            if (body.error) throw new Error(`API error: ${body.error}`);
            if (!Array.isArray(body.records)) throw new Error('Unexpected response shape');
            return body;
        } catch (e) {
            if (attempt === MAX_ATTEMPTS) throw e;
            console.warn(`\npage at offset ${offset} failed (${e.message}), retry ${attempt}/${MAX_ATTEMPTS - 1}`);
            await sleep(1000 * attempt);
        }
    }
}

// Pages are appended to a checkpoint file as they arrive, so a crash or restart resumes instead of starting over.
const slim = (r) => ({ pincode: r.pincode, statename: r.statename, district: r.district, officename: r.officename });
function readCheckpoint(path) {
    if (!fs.existsSync(path)) return [];
    const out = [];
    for (const line of fs.readFileSync(path, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try { out.push(...JSON.parse(line)); } catch (e) { break; } // torn last line: ignore it and everything after
    }
    return out;
}

async function fetchAll(key, { fetchImpl = fetch, checkpoint = CHECKPOINT, page = PAGE, log = (m) => process.stdout.write(m), delayMs = 120 } = {}) {
    const all = readCheckpoint(checkpoint);
    let offset = all.length, total = Infinity;
    if (offset) log(`resuming from checkpoint: ${offset} records already downloaded\n`);
    while (offset < total) {
        const body = await fetchPage(key, offset, page, fetchImpl);
        total = Number(body.total) || all.length + body.records.length;
        if (!body.records.length) break;
        if (offset === 0 && body.records.length < page && total > body.records.length) {
            if (body.records.length < 100) throw new Error(`This key returns only ${body.records.length} records per call (sample key?). Generate your own key in My Account.`);
            console.warn(`Key caps pages at ${body.records.length} records.`);
        }
        const slimmed = body.records.map(slim);
        fs.appendFileSync(checkpoint, JSON.stringify(slimmed) + '\n');
        all.push(...slimmed);
        offset += body.records.length;
        log(`\rfetched ${all.length}/${total}`);
        if (delayMs) await sleep(delayMs);
    }
    log('\n');
    return all;
}

// ── CSV ─────────────────────────────────────────────────────────────────────
function parseCsv(txt) {
    const rows = []; let f = '', r = [], q = false;
    for (let i = 0; i < txt.length; i++) {
        const c = txt[i];
        if (q) { if (c === '"') { if (txt[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
        else if (c === '"') q = true;
        else if (c === ',') { r.push(f); f = ''; }
        else if (c === '\n' || c === '\r') { if (c === '\r' && txt[i + 1] === '\n') i++; r.push(f); f = ''; if (r.length > 1 || r[0] !== '') rows.push(r); r = []; }
        else f += c;
    }
    if (f !== '' || r.length) { r.push(f); rows.push(r); }
    return rows;
}
function readCsvRecords(path) {
    const rows = parseCsv(fs.readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
    const header = rows.shift().map((h) => h.trim().toLowerCase());
    for (const need of ['pincode', 'statename', 'district', 'officename', 'circlename']) {
        if (!header.includes(need)) throw new Error(`CSV is missing the "${need}" column (found: ${header.join(', ')})`);
    }
    return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] || '').trim()])));
}

// ── records -> rows ──────────────────────────────────────────────────────────
// Returns Map("pincode|State" -> Set(places)). About 0.4% of post offices have statename "NA".
// 100 real pincodes exist ONLY in those rows, so skipping them would flag real customers as having a
// non-existent pincode. For those we infer the state: the most common state among known pincodes with the
// same circle and same first 3 digits, else every main state of the circle. Inferred pincodes are reported.
const isNA = (v) => { const t = String(v || '').trim().toUpperCase(); return t === '' || t === 'NA' || t === 'N/A'; };
const MAIN_STATE_MIN = 20; // a state must have at least this many post offices in a circle to count as one of its states

function buildRows(records) {
    const rows = new Map();
    const unmapped = new Map();
    const known = new Set();
    const circleStates = new Map(), prefixStates = new Map();
    const bump = (m, k, st) => { if (!m.has(k)) m.set(k, new Map()); const x = m.get(k); x.set(st, (x.get(st) || 0) + 1); };
    const naRecords = [];
    const pinOf = (r) => String(r.pincode || '').replace(/\D/g, '').padStart(6, '0');
    const addRow = (pincode, state, r) => {
        const k = `${pincode}|${state}`;
        if (!rows.has(k)) rows.set(k, new Set());
        const set = rows.get(k);
        const d = normText(r.district); if (d && d !== 'na') set.add(d);
        const o = normText(r.officename); if (o) set.add(o);
    };

    for (const r of records) {
        const pincode = pinOf(r);
        if (!/^[1-9]\d{5}$/.test(pincode)) continue;
        if (isNA(r.statename)) { naRecords.push({ r, pincode }); continue; }
        const state = canonicalState(r.statename);
        if (!state) { unmapped.set(r.statename, (unmapped.get(r.statename) || 0) + 1); continue; }
        addRow(pincode, state, r);
        known.add(pincode);
        bump(circleStates, r.circlename, state);
        bump(prefixStates, `${r.circlename}|${pincode.slice(0, 3)}`, state);
    }

    const inferred = new Set();
    for (const { r, pincode } of naRecords) {
        if (known.has(pincode)) continue; // another post office on this pincode already has a state
        let candidates = [];
        const pm = prefixStates.get(`${r.circlename}|${pincode.slice(0, 3)}`);
        if (pm) candidates = [[...pm.entries()].sort((a, b) => b[1] - a[1])[0][0]];
        else {
            const cm = circleStates.get(r.circlename);
            if (cm) candidates = [...cm.entries()].filter(([, n]) => n >= MAIN_STATE_MIN).map(([st]) => st);
        }
        for (const st of candidates) addRow(pincode, st, r);
        if (candidates.length) inferred.add(pincode);
    }
    return { rows, unmapped, inferred };
}

async function main() {
    const csvIdx = process.argv.indexOf('--csv');
    let all;
    if (csvIdx !== -1) {
        const file = process.argv[csvIdx + 1];
        if (!file || !fs.existsSync(file)) { console.error(`CSV file not found: ${file}`); process.exit(1); }
        all = readCsvRecords(file);
        console.log(`read ${all.length} records from ${file}`);
    } else {
        const key = process.env.DATA_GOV_API_KEY;
        if (!key) { console.error('Set DATA_GOV_API_KEY in the environment, or pass --csv <file>.'); process.exit(1); }
        all = await fetchAll(key);
    }
    if (all.length < MIN_EXPECTED_RECORDS) { console.error(`Only ${all.length} records fetched, expected 100k+. Not touching the table.`); process.exit(1); }

    const { rows, unmapped, inferred } = buildRows(all);
    console.log(`${all.length} post offices -> ${rows.size} (pincode, state) rows`);
    if (inferred.size) console.log(`${inferred.size} pincodes had no state in the source data; state inferred from circle/neighbouring pincodes`);
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
        try { fs.unlinkSync(CHECKPOINT); } catch (e) { /* nothing to remove */ }
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }

    const check = await pool.query(`SELECT state FROM pincode_directory WHERE pincode = '500001'`);
    console.log('Sanity check, pincode 500001 (Hyderabad) ->', check.rows.map((r) => r.state).join(', ') || 'NOT FOUND');
    const states = await pool.query(`SELECT state, COUNT(*) n FROM pincode_directory GROUP BY state ORDER BY state`);
    console.log(`${states.rowCount} states/UTs loaded (expected ~36)`);
    await pool.end();
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { buildRows, parseCsv, readCsvRecords, fetchAll, fetchPage, readCheckpoint };
