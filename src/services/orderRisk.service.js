// Order risk tagging. TAG ONLY — nothing in here blocks, cancels or delays an order.
// evaluateOrderRisk() is pure (easy to unit test); runRiskCheckAndSave() wraps it with DB access
// and swallows every error so a bug here can never cost a tenant a sale.
const { canonicalState, stateKey, STATE_ABBR, CITY_IS_ALSO_STATE, STATE_EQUIVALENTS, normText, cityVariants } = require('../utils/indiaGeo');

// Minimum lengths. Tune here; each is a Medium flag the operator can wave through.
const ADDRESS_MIN_CHARS = 18; // house/street part (address line 1 + 2) combined
const ADDRESS_MIN_WORDS = 3;
const NAME_MIN_LETTERS = 3;   // letters across the whole name, so "Om Sharma" passes but a lone "Om" does not

const VELOCITY_PRIOR_MAX = 2; // flag the order when the customer already has this many COD orders in the last 24h (so the 3rd is flagged)
const SCORE_HIGH = 40, SCORE_MEDIUM = 20; // riskScore = sum of flag weights, capped at 100

// Starter list of throwaway-mail domains (matched on the domain and any subdomain). Extend as you see new ones.
const DISPOSABLE_EMAIL_DOMAINS = new Set([
    'tempmail.com', 'temp-mail.org', 'temp-mail.io', 'tempmail.net', 'tempmailo.com', 'tempail.com', 'tempinbox.com', 'tmpmail.org', 'tmpmail.net',
    'mailinator.com', '10minutemail.com', '10minutemail.net', 'guerrillamail.com', 'guerrillamail.net', 'guerrillamail.org', 'guerrillamail.biz',
    'guerrillamail.de', 'guerrillamail.info', 'sharklasers.com', 'grr.la', 'yopmail.com', 'yopmail.net', 'throwawaymail.com', 'trashmail.com',
    'getnada.com', 'nada.email', 'maildrop.cc', 'dispostable.com', 'fakeinbox.com', 'fakemail.net', 'mohmal.com', 'emailondeck.com',
    'mintemail.com', 'burnermail.io', 'mailnesia.com', 'spamgourmet.com', 'moakt.com', 'discard.email', 'inboxkitten.com', 'mailcatch.com',
    'mytemp.email', 'mail-temp.com',
]);

const RULES_VERSION = 3;
const SEV_ORDER = { High: 0, Medium: 1 };

// ── field validators ────────────────────────────────────────────────────────────────────────
const KEYBOARD_MASH = ['asdf', 'qwer', 'zxcv', 'hjkl', 'qwerty', 'asdfgh', 'zxcvbn', 'sdfg', 'dfgh', 'poiu', 'lkjh'];
const JUNK_WORDS = new Set(['admin', 'test', 'testing', 'fake', 'abc', 'abcd', 'xyz', 'demo', 'dummy', 'sample', 'name', 'none', 'na', 'nil', 'null', 'xxx', 'aaa', 'user', 'customer']);

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

const isCodMethod = (m) => ['cod', 'cash_on_delivery'].includes(String(m || '').trim().toLowerCase());

function isDisposableEmail(email) {
    const at = String(email || '').trim().toLowerCase().lastIndexOf('@');
    if (at === -1) return null;
    const domain = String(email).trim().toLowerCase().slice(at + 1);
    if (!domain) return null;
    const parts = domain.split('.');
    for (let i = 0; i < parts.length - 1; i++) if (DISPOSABLE_EMAIL_DOMAINS.has(parts.slice(i).join('.'))) return domain;
    return null;
}

// Counts COD orders in the list placed within 24h before `now` (when given), ignoring this order itself.
function countRecentCod(recentOrders, { now, orderId } = {}) {
    if (!Array.isArray(recentOrders)) return 0;
    const t0 = now ? new Date(now).getTime() : null;
    return recentOrders.filter((o) => {
        if (!isCodMethod(o.payment_method || o.paymentMethod)) return false;
        if (orderId && (o.order_id === orderId || o.orderId === orderId)) return false;
        if (t0 !== null && !Number.isNaN(t0)) {
            const t = new Date(o.created_at || o.createdAt).getTime();
            if (Number.isNaN(t) || t > t0 || t0 - t > 24 * 3600 * 1000) return false;
        }
        return true;
    }).length;
}

const scoreOf = (flags) => Math.min(100, flags.reduce((n, f) => n + (f.severity === 'High' ? SCORE_HIGH : SCORE_MEDIUM), 0));

// ── main check ──────────────────────────────────────────────────────────────────────────────
// directory: { size, get(pincode) -> { states:Set<string>, places:string[] } | undefined }
// zones: store config cart.deliveryZones (may be undefined)
function evaluateOrderRisk({ address, customerName, customerPhone, customerEmail, paymentMethod, orderId, orderType, zones, directory, recentOrders, now, geo = true }) {
    const result = (status, flags = [], reason) => ({
        status, flags, riskScore: scoreOf(flags), recommendedAction: status === 'flagged' ? 'HOLD_FOR_VERIFICATION' : 'PROCEED',
        rulesVersion: RULES_VERSION, ...(reason ? { reason } : {}),
    });
    const isCod = isCodMethod(paymentMethod);

    if (orderType !== 'delivery') return result('not_checked', [], 'order_type_not_delivery');
    if (!address || typeof address !== 'object') return result('flagged', [{ code: 'address_incomplete', field: 'address', severity: 'High', message: 'No delivery address on the order' }]);
    if (geo && (!directory || !directory.size)) return result('not_checked', [], 'pincode_directory_empty');

    const country = String(address.country || 'India').trim().toLowerCase();
    if (country && country !== 'india') return result('not_checked', [], 'international_address');

    const flags = [];
    const add = (code, field, severity, message) => flags.push({ code, field, severity, message });

    const pincode = String(address.pincode || '').trim();
    const selectedState = canonicalState(address.state);
    const cityRaw = String(address.city || '').trim();
    const cityNorm = normText(cityRaw);
    const cityKey = cityNorm.replace(/ /g, '');

    if (geo) {
        // 1. pincode
        let entry = null;
        if (!/^[1-9]\d{5}$/.test(pincode)) {
            add('pincode_invalid', 'pincode', 'High', 'Pincode must be 6 digits and cannot start with 0');
        } else {
            entry = directory.get(pincode) || null;
            if (!entry) {
                // Unknown pincode: the first two digits still tell us which state(s) the number range belongs to.
                const hint = typeof directory.prefixHint === 'function' ? directory.prefixHint(pincode) : null;
                const hintText = hint && hint.size ? ` (${pincode.slice(0, 2)}xxxx pincodes belong to ${[...hint].join(' / ')})` : '';
                add('pincode_invalid', 'pincode', 'High', `Pincode ${pincode} does not exist in the India Post directory${hintText}`);
                const sel = canonicalState(address.state);
                if (hint && hint.size && sel) {
                    const okStates = new Set([sel, ...(STATE_EQUIVALENTS[sel] || [])]);
                    if (![...hint].some((st) => okStates.has(st))) {
                        add('pincode_range_mismatch', 'pincode', 'High', `Pincode starts with ${pincode.slice(0, 2)}, a ${[...hint].join(' / ')} range, but the address says ${sel}`);
                    }
                }
            }
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
    }

    // 4. name
    const name = address.recipientName || customerName;
    const nameLetters = (String(name || '').match(/[\p{L}\p{M}]/gu) || []).length;
    if (nameIsJunk(name)) add('name_junk', 'name', 'Medium', `Name "${name || ''}" looks like test or random text`);
    else if (nameLetters < NAME_MIN_LETTERS) add('name_too_short', 'name', 'Medium', `Name "${name}" is too short (needs at least ${NAME_MIN_LETTERS} letters)`);

    // 5. phone
    const phone = address.recipientMobile || customerPhone;
    if (phoneIsInvalid(phone)) add('phone_invalid', 'phone', 'High', `Phone "${phone || ''}" is not a valid Indian mobile number`);

    // 6. address
    const line = `${address.addressLine1 || ''} ${address.addressLine2 || ''}`.trim();
    const lineNorm = normText(line);
    const words = line.split(/\s+/).filter(Boolean).length;
    let addressFlagged = true;
    if (line.length < 10 || words < 2 || (cityNorm && lineNorm === cityNorm) || isJunkText(line)) {
        add('address_incomplete', 'address', 'Medium', 'Address has no usable street/area detail');
    } else if (line.length < ADDRESS_MIN_CHARS || words < ADDRESS_MIN_WORDS) {
        add('address_too_short', 'address', 'Medium', `Address is very short (${line.length} characters, ${words} words). Real addresses usually have house no., street/block and area`);
    } else addressFlagged = false;
    // COD-only: a delivery address with no digit at all has no house/flat/plot number (also common in villages, hence Medium)
    if (isCod && !addressFlagged && !/\d/.test(line)) add('address_no_number', 'address', 'Medium', 'Address has no house/flat/plot number');

    // COD-only: throwaway email
    const disposable = isCod ? isDisposableEmail(customerEmail) : null;
    if (disposable) add('email_disposable', 'email', 'Medium', `Email uses a disposable domain (${disposable})`);

    // COD-only: repeat COD orders from the same customer within 24h
    if (isCod) {
        const prior = countRecentCod(recentOrders, { now, orderId });
        if (prior >= VELOCITY_PRIOR_MAX) add('order_velocity', 'phone', 'High', `Customer placed ${prior + 1} COD orders in 24 hours`);
    }

    // 7. delivery zone (mirrors the storefront's resolveDeliveryZone so client and server agree)
    const zoneList = Array.isArray(zones) ? zones : [];
    const hasRealZone = zoneList.some((a) => (a.zones || []).some((z) => z && String(z.pincode || '').trim()));
    if (geo && hasRealZone && pincode) {
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

// Seller-facing wrapper with the shape the dashboard wants. COD orders only.
//   orderData: { orderId, paymentMethod, customerName, customerEmail, customerPhone, shippingAddress, createdAt }
//   shippingAddress: a plain string (text checks only) or the storefront address object (adds pincode/state/city checks when options.directory is given)
//   recentCustomerOrders: earlier orders by the same phone/email/IP in the last 24h
function evaluateCODOrderRisk(orderData = {}, recentCustomerOrders = [], options = {}) {
    const clean = { isFlagged: false, riskScore: 0, flagReasons: [], flags: [], recommendedAction: 'PROCEED' };
    if (!isCodMethod(orderData.paymentMethod)) return clean;
    const sa = orderData.shippingAddress;
    const address = typeof sa === 'string' ? { addressLine1: sa } : (sa || {});
    const res = evaluateOrderRisk({
        address, customerName: orderData.customerName, customerPhone: orderData.customerPhone, customerEmail: orderData.customerEmail,
        paymentMethod: orderData.paymentMethod, orderId: orderData.orderId, orderType: options.orderType || 'delivery',
        zones: options.zones, directory: options.directory, recentOrders: recentCustomerOrders, now: orderData.createdAt,
        geo: typeof sa !== 'string' && !!options.directory,
    });
    return {
        isFlagged: res.status === 'flagged', riskScore: res.riskScore, flagReasons: res.flags.map((f) => f.message),
        flags: res.flags, recommendedAction: res.recommendedAction,
    };
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
    // 2-digit prefix -> states that hold at least 5% of that prefix's pincodes (army post offices, 90+, are skipped)
    const prefixCounts = new Map();
    for (const [pin, e] of map) {
        const a = pin.slice(0, 2);
        if (Number(a) >= 90) continue;
        if (!prefixCounts.has(a)) prefixCounts.set(a, new Map());
        for (const st of e.states) prefixCounts.get(a).set(st, (prefixCounts.get(a).get(st) || 0) + 1);
    }
    const prefixStates = new Map();
    for (const [a, m] of prefixCounts) {
        const total = [...m.values()].reduce((x, y) => x + y, 0);
        prefixStates.set(a, new Set([...m.entries()].filter(([, n]) => n / total >= 0.05).map(([st]) => st)));
    }
    const dir = { size: map.size, get: (p) => map.get(p), prefixHint: (pin) => prefixStates.get(String(pin).slice(0, 2)) || null };
    // Never cache an empty directory: right after the first load the next order must see the data.
    if (map.size) cache = { dir, loadedAt: Date.now() };
    return dir;
}
const clearDirectoryCache = () => { cache = { dir: null, loadedAt: 0 }; };

// COD orders in the same store, last 24h, from the same customer account or the same phone (order phone or recipient phone).
async function fetchRecentCodOrders(pool, order, address) {
    const last10 = (v) => { const d = normalizePhone(v); return d.length >= 10 ? d.slice(-10) : ''; };
    const { rows } = await pool.query(
        `SELECT order_id, payment_method, created_at FROM orders
          WHERE store_id = $1 AND id <> $2 AND created_at >= NOW() - INTERVAL '24 hours'
            AND LOWER(COALESCE(payment_method, '')) IN ('cod', 'cash_on_delivery') AND COALESCE(order_type, 'delivery') = 'delivery'
            AND ( ($3::uuid IS NOT NULL AND customer_id = $3::uuid)
               OR ($4::text <> '' AND RIGHT(REGEXP_REPLACE(COALESCE(customer_phone, ''), '[^0-9]', '', 'g'), 10) = $4::text)
               OR ($5::text <> '' AND RIGHT(REGEXP_REPLACE(COALESCE(delivery_address->>'recipientMobile', ''), '[^0-9]', '', 'g'), 10) = $5::text) )`,
        [order.store_id, order.id, order.customer_id || null, last10(order.customer_phone), last10(address && address.recipientMobile)]
    );
    return rows;
}

// Never throws. Call right after the order INSERT.
async function runRiskCheckAndSave(pool, order, storeConfig, deliveryAddress) {
    try {
        let address = deliveryAddress;
        if (typeof address === 'string') { try { address = JSON.parse(address); } catch (e) { address = null; } }
        const directory = await getDirectory(pool);
        let recentOrders = [];
        if (isCodMethod(order.payment_method)) {
            try { recentOrders = await fetchRecentCodOrders(pool, order, address); } catch (e) { console.warn('⚠️ Velocity lookup skipped:', e.message); }
        }
        const res = evaluateOrderRisk({
            address,
            customerName: order.customer_name,
            customerPhone: order.customer_phone,
            customerEmail: order.customer_email,
            paymentMethod: order.payment_method,
            orderId: order.order_id,
            orderType: order.order_type,
            zones: storeConfig && storeConfig.cart && storeConfig.cart.deliveryZones,
            directory,
            recentOrders,
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

module.exports = { evaluateOrderRisk, evaluateCODOrderRisk, isDisposableEmail, countRecentCod, runRiskCheckAndSave, getDirectory, clearDirectoryCache, nameIsJunk, phoneIsInvalid, RULES_VERSION };
