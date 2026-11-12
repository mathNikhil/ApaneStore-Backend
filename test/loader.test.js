const { buildRows } = require('../scripts/loadPincodeDirectory');
test('builds rows from the real API sample and maps odd state spellings', () => {
    const rec = (pincode, statename, district, officename) => ({ pincode, statename, district, officename });
    const { rows, unmapped } = buildRows([
        rec('504273', 'TELANGANA', 'KUMURAM BHEEM ASIFABAD', 'Kothimir B.O'),
        rec('504299', 'TELANGANA', 'KUMURAM BHEEM ASIFABAD', 'Papanpet B.O'),
        rec('504299', 'TELANGANA', 'KUMURAM BHEEM ASIFABAD', 'Kukuda B.O'),
        rec(110001, 'DELHI', 'Central Delhi', 'Connaught Place S.O'),
        rec('194101', 'JAMMU & KASHMIR', 'Leh', 'Leh H.O'),
        rec('403001', 'ORISSA', 'x', 'y'),
        rec('744101', 'ANDAMAN & NICOBAR ISLANDS', 'South Andaman', 'Port Blair'),
        rec('396210', 'THE DADRA AND NAGAR HAVELI AND DAMAN AND DIU', 'Daman', 'Daman H.O'),
        rec('99', 'DELHI', 'x', 'y'),
        rec('600001', 'MARS', 'x', 'y'),
    ]);
    expect([...rows.keys()].sort()).toEqual(['110001|Delhi', '194101|Jammu and Kashmir', '396210|Dadra and Nagar Haveli and Daman and Diu', '403001|Odisha', '504273|Telangana', '504299|Telangana', '744101|Andaman and Nicobar Islands']);
    expect([...rows.get('504299|Telangana')].sort()).toEqual(['kukuda b o', 'kumuram bheem asifabad', 'papanpet b o']);
    expect([...unmapped.keys()]).toEqual(['MARS']);
});

describe('fetchAll resilience', () => {
    const fs = require('fs'); const os = require('os'); const path = require('path');
    const { fetchAll } = require('../scripts/loadPincodeDirectory');
    const rec = (i) => ({ pincode: String(100000 + i), statename: 'DELHI', district: 'D', officename: `O${i}` });
    const mkFetch = (total, failFirst = 0, hangFirst = 0) => {
        let calls = 0, fails = failFirst, hangs = hangFirst;
        const f = async (url, opts) => {
            calls++;
            if (hangs > 0) { hangs--; return new Promise((_, rej) => opts.signal.addEventListener('abort', () => rej(new Error('timeout')))); }
            if (fails > 0) { fails--; throw new Error('network down'); }
            const q = new URL(url).searchParams; const off = +q.get('offset'), lim = +q.get('limit');
            const records = []; for (let i = off; i < Math.min(off + lim, total); i++) records.push(rec(i));
            return { json: async () => ({ total, records }) };
        };
        f.calls = () => calls; return f;
    };
    const tmp = () => path.join(os.tmpdir(), `pin-ck-${Date.now()}-${Math.random()}.ndjson`);

    test('retries transient failures and collects everything', async () => {
        const ck = tmp(); const f = mkFetch(2500, 2);
        const all = await fetchAll('k', { fetchImpl: f, checkpoint: ck, page: 1000, log: () => {}, delayMs: 0 });
        expect(all).toHaveLength(2500);
    });
    test('resumes from the checkpoint instead of starting over', async () => {
        const ck = tmp();
        await fetchAll('k', { fetchImpl: mkFetch(2500), checkpoint: ck, page: 1000, log: () => {}, delayMs: 0 });
        fs.appendFileSync(ck, '{"torn":'); // simulate a crash mid-write
        const f2 = mkFetch(2500);
        const all = await fetchAll('k', { fetchImpl: f2, checkpoint: ck, page: 1000, log: () => {}, delayMs: 0 });
        expect(all).toHaveLength(2500);
        expect(f2.calls()).toBeLessThanOrEqual(1); // nothing (or at most one empty probe) refetched
    });
});

describe('NA state rows and CSV reading', () => {
    const { buildRows, parseCsv } = require('../scripts/loadPincodeDirectory');
    const rec = (pincode, statename, circlename, officename = 'X B.O', district = 'D') => ({ pincode, statename, circlename, officename, district });

    test('pincode that only exists with state NA gets its state from neighbouring pincodes in the same circle', () => {
        const { rows, inferred } = buildRows([
            rec('523001', 'ANDHRA PRADESH', 'Andhra Pradesh Circle'),
            rec('523002', 'ANDHRA PRADESH', 'Andhra Pradesh Circle'),
            rec('523261', 'NA', 'Andhra Pradesh Circle', 'Kolalapudi B.O', 'NA'),
        ]);
        expect(rows.has('523261|Andhra Pradesh')).toBe(true);
        expect(inferred.has('523261')).toBe(true);
        expect([...rows.get('523261|Andhra Pradesh')]).toEqual(['kolalapudi b o']); // district "NA" is not stored as a place
    });
    test('NA row on a pincode that already has a real state adds nothing', () => {
        const { rows, inferred } = buildRows([rec('560001', 'KARNATAKA', 'Karnataka Circle'), rec('560001', 'NA', 'Karnataka Circle')]);
        expect([...rows.keys()]).toEqual(['560001|Karnataka']);
        expect(inferred.size).toBe(0);
    });
    test('no neighbours: falls back to the circle\'s main states only', () => {
        const many = (st, n) => Array.from({ length: n }, (_, i) => rec(String(400000 + i), st, 'Maharashtra Circle'));
        const { rows } = buildRows([...many('MAHARASHTRA', 30), ...many('GOA', 25), rec('999991', 'NA', 'Maharashtra Circle'), rec('888888', 'DELHI', 'Maharashtra Circle')]);
        const keys = [...rows.keys()].filter((k) => k.startsWith('999991|')).sort();
        expect(keys).toEqual(['999991|Goa', '999991|Maharashtra']); // Delhi (1 office) is noise, not a main state
    });
    test('CSV parser handles quotes, commas inside quotes, CRLF and blank lines', () => {
        const rows = parseCsv('a,b,c\r\n"x, y",2,"he said ""hi"""\r\n\r\n3,4,5\r\n');
        expect(rows).toEqual([['a', 'b', 'c'], ['x, y', '2', 'he said "hi"'], ['3', '4', '5']]);
    });
});
