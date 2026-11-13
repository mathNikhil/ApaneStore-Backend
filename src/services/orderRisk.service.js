// Order risk tagging. TAG ONLY — nothing in here blocks, cancels or delays an order.
// evaluateOrderRisk() is pure (easy to unit test); runRiskCheckAndSave() wraps it with DB access
// and swallows every error so a bug here can never cost a tenant a sale.
const { canonicalState, stateKey, STATE_ABBR, CITY_IS_ALSO_STATE, STATE_EQUIVALENTS, normText, cityVariants } = require('../utils/indiaGeo');

const RULES_VERSION = 1;
const SEV_ORDER = { High: 0, Medium: 1 };

// ── field validators ────────────────────────────────────────────────────────────────────────
const KEYBOARD_MASH = ['asdf', 'qwer', 'zxcv', 'hjkl', 'qwerty', 'asdfgh', 'zxcvbn', 'sdfg', 'dfgh', 'poiu', 'lkjh'];
const JUNK_WORDS = new Set(['test', 'testing', 'fake', 'abc', 'abcd', 'xyz', 'demo', 'dummy', 'sample', 'name', 'none', 'na', 'nil', 'null', 'xxx', 'aaa', 'user', 'customer']);

function isJunkText(text) {
    const t = String(text || '').trim().toLowerCase();
    if (!t) return true;
    if (!/\p{L}/u.test(t)) return true;                     // no letters at all
    if (/(.)\1{3,}/u.test(t)) return true;                  // aaaa, ....
    const words = t.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    if (words.some((w) => JUNK_WORDS.has(w))) return true;
    if (KEYBOARD_MASH.some((k) => t.replace(/[^a-z]/g, '').includes(k))) return true;
    return false;
}

function nameIsJunk(name) {
    const n = String(name || '').trim();
    if (n.length < 2) return true;
    if (/\d/.test(n)) return true;
    if (isJunkText(n)) return true;
    const latin = n.replace(/[^a-z]/gi, '');
    if (latin.length >= 6 && latin.length === n.replace(/\s/g, '').length && !/[aeiouy]/i.test(latin)) return true; // "bcdfgh"
    return false;
}

function normalizePhone(raw) {
    let d = String(raw || '').replace(/\D/g, '');
    if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
    if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
    return d;
}
function phoneIsInvalid(raw) {
    const d = normalizePhone(raw);
    if (!/^[6-9]\d{9}$/.test(d)) return true;
    if (/^(\d)\1+$/.test(d)) return true;                   // 9999999999
    if (/(\d)\1{6,}/.test(d)) return true;                  // 9000000000
    if (/^(\d\d)\1{4}$/.test(d)) return true;               // 9898989898
    if (/^(\d{5})\1$/.test(d)) return true;                 // 9876598765
    if ('01234567890123456789'.includes(d) || '98765432109876543210'.includes(d)) return true; // 1234567890
    return false;
}

// ── main check ──────────────────────────────────────────────────────────────────────────────
// directory: { size, get(pincode) -> { states:Set<string>, places:string[] } | undefined }
// zones: store config cart.deliveryZones (may be undefined)
function evaluateOrderRisk({ address, customerName, customerPhone, orderType, zones, directory }) {
    const result = (status, flags = [], reason) => ({ status, flags, rulesVersion: RULES_VERSION, ...(reason ? { reason } : {}) });

    if (orderType !== 'delivery') return result('not_checked', [], 'order_type_not_delivery');
    if (!address || typeof address !== 'object') return result('flagged', [{ code: 'address_incomplete', field: 'address', severity: 'High', message: 'No delivery address on the order' }]);
    if (!directory || !directory.size) return result('not_checked', [], 'pincode_directory_empty');

    const country = String(address.country || 'India').trim().toLowerCase();
    if (country && country !== 'india') return result('not_checked', [], 'international_address');

    const flags = [];
    const add = (code, field, severity, message) => flags.push({ code, field, severity, message });

    const pincode = String(address.pincode || '').trim();
    const selectedState = canonicalState(address.state);
    const cityRaw = String(address.city || '').trim();
    const cityNorm = normText(cityRaw);
    const cityKey = cityNorm.replace(/ /g, '');

    // 1. pincode
    let entry = null;
    if (!/^[1-9]\d{5}$/.test(pincode)) {
        add('pincode_invalid', 'pincode', 'High', 'Pincode must be 6 digits and cannot start with 0');
    } else {
        entry = directory.get(pincode) || null;
        if (!entry) add('pincode_invalid', 'pincode', 'High', 'Pincode not found in the India Post directory');
    }

    // 2. state
    if (!selectedState) {
        add('state_invalid', 'state', 'High', `State "${address.state || ''}" is not a recognised Indian state or UT`);
    } else if (entry) {
        const allowed = new Set([selectedState, ...(STATE_EQUIVALENTS[selectedState] || [])]);
        const ok = [...entry.states].some((s) => allowed.has(s));
        if (!ok) add('state_pincode_mismatch', 'state', 'High', `Pincode ${pincode} belongs to ${[...entry.states].join(' / ')}, but the address says ${selectedState}`);
    }

    // 3. city
    const abbrState = STATE_ABBR[cityKey] || canonicalState(cityRaw);
    const cityIsOtherState = abbrState && selectedState && abbrState !== selectedState && !CITY_IS_ALSO_STATE.has(cityKey);
    if (!cityRaw || cityRaw === '__other__') {
        add('city_missing', 'city', 'Medium', 'City is empty');
    } else if (cityIsOtherState) {
        add('city_state_mismatch', 'city', 'High', `City "${cityRaw}" is the name of another state (${abbrState}), selected state is ${selectedState}`);
    } else if (entry) {
        const hay = ` ${entry.places.join(' | ')} `;
        const variants = cityVariants(cityRaw);
        const found = variants.some((v) => hay.includes(` ${v} `) || hay.includes(v));
        const placeInCity = entry.places.some((p) => p.length >= 4 && !p.includes(' b o') && cityNorm.includes(p));
        if (!found && !placeInCity) add('city_pincode_mismatch', 'city', 'Medium', `City "${cityRaw}" does not match any district or post office for pincode ${pincode}`);
    }

    // 4. name
    const name = address.recipientName || customerName;
    if (nameIsJunk(name)) add('name_junk', 'name', 'Medium', `Name "${name || ''}" looks like test or random text`);

    // 5. phone
    const phone = address.recipientMobile || customerPhone;
    if (phoneIsInvalid(phone)) add('phone_invalid', 'phone', 'High', `Phone "${phone || ''}" is not a valid Indian mobile number`);

    // 6. address
    const line = `${address.addressLine1 || ''} ${address.addressLine2 || ''}`.trim();
    const lineNorm = normText(line);
    if (line.length < 10 || line.split(/\s+/).length < 2 || lineNorm === cityNorm || isJunkText(line)) {
        add('address_incomplete', 'address', 'Medium', 'Address is too short or has no usable street/area detail');
    }

    // 7. delivery zone (mirrors the storefront's resolveDeliveryZone so client and server agree)
    const zoneList = Array.isArray(zones) ? zones : [];
    const hasRealZone = zoneList.some((a) => (a.zones || []).some((z) => z && String(z.pincode || '').trim()));
    if (hasRealZone && pincode) {
        const addrLower = [address.addressLine1, address.addressLine2, address.city, address.state].filter(Boolean).join(' ').toLowerCase();
        const inZone = zoneList.some((a) => (a.zones || []).some((z) => {
            const zp = String((z && z.pincode) || '').trim();
            if (!zp || !pincode.startsWith(zp)) return false;
            const area = String(z.area || '').trim().toLowerCase();
            return !(area && addrLower && !addrLower.includes(area));
        }));
        if (!inZone) add('outside_delivery_zone', 'pincode', 'High', 'Address is outside the delivery zones this store configured');
    }

    flags.sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);
    return result(flags.length ? 'flagged' : 'passed', flags);
}

// ── DB wiring ───────────────────────────────────────────────────────────────────────────────
let cache = { dir: null, loadedAt: 0 };
const CACHE_MS = 6 * 60 * 60 * 1000;

async function getDirectory(pool) {
    if (cache.dir && Date.now() - cache.loadedAt < CACHE_MS) return cache.dir;
    const { rows } = await pool.query('SELECT pincode, state, places FROM pincode_directory');
    const map = new Map();
    for (const r of rows) {
        const key = String(r.pincode).trim();
        const e = map.get(key) || { states: new Set(), places: [] };
        e.states.add(r.state);
        if (r.places) e.places.push(...r.places.split('|').filter(Boolean));
        map.set(key, e);
    }
    const dir = { size: map.size, get: (p) => map.get(p) };
    // Never cache an empty directory: right after the first load the next order must see the data.
    if (map.size) cache = { dir, loadedAt: Date.now() };
    return dir;
}
const clearDirectoryCache = () => { cache = { dir: null, loadedAt: 0 }; };

// Never throws. Call right after the order INSERT.
async function runRiskCheckAndSave(pool, order, storeConfig, deliveryAddress) {
    try {
        let address = deliveryAddress;
        if (typeof address === 'string') { try { address = JSON.parse(address); } catch (e) { address = null; } }
        const directory = await getDirectory(pool);
        const res = evaluateOrderRisk({
            address,
            customerName: order.customer_name,
            customerPhone: order.customer_phone,
            orderType: order.order_type,
            zones: storeConfig && storeConfig.cart && storeConfig.cart.deliveryZones,
            directory,
        });
        await pool.query(
            `UPDATE orders SET risk_status = $1, risk_flags = $2::jsonb, risk_rules_version = $3, risk_checked_at = NOW() WHERE id = $4`,
            [res.status, JSON.stringify(res.flags), res.rulesVersion, order.id]
        );
        return res;
    } catch (err) {
        console.warn('⚠️ Risk check skipped:', err.message);
        try { await pool.query(`UPDATE orders SET risk_status = 'not_checked', risk_rules_version = $1 WHERE id = $2`, [RULES_VERSION, order.id]); } catch (e) { /* ignore */ }
        return null;
    }
}

module.exports = { evaluateOrderRisk, runRiskCheckAndSave, getDirectory, clearDirectoryCache, nameIsJunk, phoneIsInvalid, RULES_VERSION };
