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
