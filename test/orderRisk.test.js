const { evaluateOrderRisk, evaluateCODOrderRisk, isDisposableEmail, nameIsJunk, phoneIsInvalid } = require('../src/services/orderRisk.service');

const mk = (rows) => { const m = new Map(); for (const [p, st, places] of rows) m.set(p, { states: new Set([st]), places }); return { size: m.size, get: (p) => m.get(p) }; };
const dir = mk([
    ['110001', 'Delhi', ['central delhi', 'new delhi', 'connaught place s o']],
    ['110075', 'Delhi', ['south west delhi', 'dwarka sector 10 s o']],
    ['462001', 'Madhya Pradesh', ['bhopal', 'bhopal g p o']],
    ['201301', 'Uttar Pradesh', ['gautam buddha nagar', 'noida sector 18 s o']],
    ['122001', 'Haryana', ['gurugram', 'gurgaon h o']],
    ['500001', 'Telangana', ['hyderabad', 'hyderabad g p o']],
    ['160017', 'Chandigarh', ['chandigarh', 'sector 17 s o']],
    ['160055', 'Punjab', ['sas nagar mohali', 'mohali s o']],
]);
const good = { recipientName: 'Rahul Sharma', recipientMobile: '9812345678', addressLine1: 'Flat 12, Green Park Apartments', addressLine2: 'Near City Mall', city: 'New Delhi', state: 'Delhi', pincode: '110001', country: 'India' };
const run = (over = {}, extra = {}) => evaluateOrderRisk({ address: { ...good, ...over }, customerPhone: '9812345678', orderType: 'delivery', zones: [], directory: dir, ...extra });
const codes = (r) => r.flags.map((f) => f.code);

test('clean order passes', () => { const r = run(); expect(r.status).toBe('passed'); expect(r.flags).toEqual([]); });

test('delhi state + UP city + MP pincode is flagged High on state and city', () => {
    const r = run({ state: 'Delhi', city: 'UP', pincode: '462001' });
    expect(r.status).toBe('flagged');
    expect(codes(r)).toEqual(expect.arrayContaining(['state_pincode_mismatch', 'city_state_mismatch']));
    expect(r.flags.filter((f) => f.severity === 'High').length).toBeGreaterThanOrEqual(2);
});

test('Gurgaon in Haryana with 122001 passes (alias)', () => expect(run({ city: 'Gurgaon', state: 'Haryana', pincode: '122001' }).status).toBe('passed'));
test('Hyderabad in Telangana passes', () => expect(run({ city: 'Hyderabad', state: 'Telangana', pincode: '500001' }).status).toBe('passed'));
test('Hyderabad pincode with Andhra Pradesh selected is flagged', () => expect(codes(run({ city: 'Hyderabad', state: 'Andhra Pradesh', pincode: '500001' }))).toContain('state_pincode_mismatch'));
test('Mohali customer who picked Chandigarh is allowed (shared region)', () => expect(codes(run({ city: 'Mohali', state: 'Chandigarh', pincode: '160055' }))).not.toContain('state_pincode_mismatch'));
test('locality in the city box matches via post office names', () => expect(run({ city: 'Dwarka', state: 'Delhi', pincode: '110075' }).status).toBe('passed'));
test('city that fits the state but not the pincode is only Medium', () => {
    const r = run({ city: 'Pune', state: 'Delhi', pincode: '110001' });
    const f = r.flags.find((x) => x.code === 'city_pincode_mismatch');
    expect(f.severity).toBe('Medium');
});
test('Delhi as city under state Delhi is fine', () => expect(codes(run({ city: 'Delhi' }))).not.toContain('city_state_mismatch'));

test.each(['12345', '012345', 'abcdef', '999999x', '', '9999999'])('bad pincode "%s"', (p) => expect(codes(run({ pincode: p }))).toContain('pincode_invalid'));
test('well-formed but non-existent pincode', () => expect(codes(run({ pincode: '999999' }))).toContain('pincode_invalid'));
test('unknown state string', () => expect(codes(run({ state: 'Mars' }))).toContain('state_invalid'));

test.each(['Sai', 'A Kumar', 'Priya', 'Mohd Aslam', 'राहुल शर्मा'])('real name "%s" is not junk', (n) => expect(nameIsJunk(n)).toBe(false));
test.each(['', 'a', 'asdf', 'test', 'aaaa', '12345', 'Rahul123', 'qwerty', 'xyz', 'bcdfghk'])('junk name "%s"', (n) => expect(nameIsJunk(n)).toBe(true));

test.each(['9812345678', '+91 98123 45678', '098123 45678', '6000123456'])('valid phone %s', (p) => expect(phoneIsInvalid(p)).toBe(false));
test.each(['9999999999', '1234567890', '5812345678', '98123', '9898989898', '9876543210', '9000000000', '', 'abcdefghij'])('invalid phone %s', (p) => expect(phoneIsInvalid(p)).toBe(true));

test('short address flagged, normal address not', () => {
    expect(codes(run({ addressLine1: 'delhi', addressLine2: '' }))).toContain('address_incomplete');
    expect(codes(run({ addressLine1: 'H-4, Sector 5', addressLine2: '' }))).not.toContain('address_incomplete');
});

test('zones: outside zone flagged, inside zone not, blank zone ignored', () => {
    const zones = [{ storeAddressId: 'main', zones: [{ pincode: '1100', area: '', deliveryCost: 40 }] }];
    expect(codes(run({}, { zones }))).not.toContain('outside_delivery_zone');
    expect(codes(run({ pincode: '462001', state: 'Madhya Pradesh', city: 'Bhopal' }, { zones }))).toContain('outside_delivery_zone');
    expect(codes(run({ pincode: '462001', state: 'Madhya Pradesh', city: 'Bhopal' }, { zones: [{ storeAddressId: 'main', zones: [{ pincode: '', area: '' }] }] }))).not.toContain('outside_delivery_zone');
    const areaZones = [{ zones: [{ pincode: '110001', area: 'connaught' }] }];
    expect(codes(run({}, { zones: areaZones }))).toContain('outside_delivery_zone'); // address text has no "connaught"
});

test('dine-in, international and empty directory are never flagged', () => {
    expect(run({}, { orderType: 'dine_in' }).status).toBe('not_checked');
    expect(run({ country: 'USA', pincode: '10001' }).status).toBe('not_checked');
    expect(run({}, { directory: { size: 0, get: () => undefined } }).status).toBe('not_checked');
});

describe('unknown pincode: which state does its number range belong to?', () => {
    const hints = { 56: ['Karnataka'], 81: ['Bihar', 'Jharkhand'] };
    const dir2 = { ...dir, prefixHint: (p) => (hints[String(p).slice(0, 2)] ? new Set(hints[String(p).slice(0, 2)]) : null) };
    const run2 = (over) => evaluateOrderRisk({ address: { ...good, ...over }, customerPhone: '9812345678', orderType: 'delivery', zones: [], directory: dir2 });
    test('Bihar address with a 56xxxx pincode: invalid AND wrong range, message names Karnataka', () => {
        const r = run2({ city: 'Patna', state: 'Bihar', pincode: '564446' });
        expect(codes(r)).toEqual(expect.arrayContaining(['pincode_invalid', 'pincode_range_mismatch']));
        expect(r.flags.find((f) => f.code === 'pincode_invalid').message).toMatch(/56xxxx pincodes belong to Karnataka/);
    });
    test('unknown pincode in the right range is only invalid', () => {
        const r = run2({ city: 'Bangalore', state: 'Karnataka', pincode: '569999' });
        expect(codes(r)).toContain('pincode_invalid');
        expect(codes(r)).not.toContain('pincode_range_mismatch');
    });
    test('prefix shared by two states accepts either', () => {
        expect(codes(run2({ city: 'Ranchi', state: 'Jharkhand', pincode: '819999' }))).not.toContain('pincode_range_mismatch');
        expect(codes(run2({ city: 'Patna', state: 'Bihar', pincode: '819999' }))).not.toContain('pincode_range_mismatch');
    });
    test('no hint available: still just invalid', () => expect(codes(run2({ pincode: '999999' }))).toEqual(expect.arrayContaining(['pincode_invalid'])));
});

describe('minimum lengths (rules v2)', () => {
    test('two-word address like "c-34333 pitampura" is too short, not "incomplete"', () => {
        const c = codes(run({ addressLine1: 'c-34333 pitampura', addressLine2: '' }));
        expect(c).toContain('address_too_short'); expect(c).not.toContain('address_incomplete');
    });
    test('address under 15 characters is too short even with 3 words', () => expect(codes(run({ addressLine1: 'H-4, Sector 5', addressLine2: '' }))).toContain('address_too_short'));
    test('normal addresses pass', () => {
        expect(codes(run({ addressLine1: 'Flat 12 Green Park', addressLine2: '' }))).toEqual([]);
        expect(codes(run({ addressLine1: 'H-4, Sector 5', addressLine2: 'Rohini' }))).toEqual([]);
    });
    test('a flag never doubles up: junk address is incomplete only', () => {
        const c = codes(run({ addressLine1: 'home', addressLine2: '' })); expect(c).toContain('address_incomplete'); expect(c).not.toContain('address_too_short');
    });
    test.each([['Om', true], ['Jo', true], ['Ram', false], ['Om Sharma', false], ['Vijendra', false], ['राम', false], ['ओम', true]])('name "%s" too short = %s', (n, short) =>
        expect(codes(run({ recipientName: n }))).toEqual(short ? ['name_too_short'] : []));
    test('junk name is junk, not also too short', () => { const c = codes(run({ recipientName: 'x' })); expect(c).toContain('name_junk'); expect(c).not.toContain('name_too_short'); });
});

describe('COD-only rules (v3): no number, disposable email, order velocity, score', () => {
    const NOW = '2026-11-13T10:00:00Z';
    const hoursAgo = (h, over = {}) => ({ order_id: 'P' + h, payment_method: 'cod', created_at: new Date(Date.parse(NOW) - h * 3600e3).toISOString(), ...over });
    const cod = (over = {}, extra = {}) => evaluateOrderRisk({ address: { ...good, ...over }, customerPhone: '9812345678', paymentMethod: 'cod', orderType: 'delivery', zones: [], directory: dir, now: NOW, ...extra });

    test('address with no digit is flagged on COD only', () => {
        expect(codes(cod({ addressLine1: 'Near Shiv Mandir Gandhi Nagar', addressLine2: '' }))).toContain('address_no_number');
        expect(codes(cod({ addressLine1: 'Near Shiv Mandir Gandhi Nagar', addressLine2: '' }, { paymentMethod: 'upi' }))).not.toContain('address_no_number');
        expect(codes(cod({ addressLine1: 'Flat 12 Shiv Mandir Road', addressLine2: '' }))).not.toContain('address_no_number');
    });
    test('a short digit-less address gets one address flag, not two', () => {
        const c = codes(cod({ addressLine1: 'Green Park', addressLine2: '' }));
        expect(c.filter((x) => x.startsWith('address_'))).toHaveLength(1);
    });
    test('18 characters is the minimum for the house/street part', () => {
        expect(codes(cod({ addressLine1: 'Flat 12 Green Park', addressLine2: '' }))).toEqual([]);          // exactly 18
        expect(codes(cod({ addressLine1: 'Flat 12 Green Prk', addressLine2: '' }))).toContain('address_too_short'); // 17
    });
    test('"admin" and other dummy names are junk', () => expect(nameIsJunk('admin')).toBe(true));

    test.each(['a@tempmail.com', 'a@mailinator.com', 'a@10minutemail.com', 'a@guerrillamail.com', 'a@yopmail.com', 'a@throwawaymail.com', 'A@MAILINATOR.COM', 'a@x.mailinator.com'])('disposable %s', (e) => expect(isDisposableEmail(e)).toBeTruthy());
    test.each(['a@gmail.com', 'a@outlook.com', 'rahul@mycompany.in', 'not-an-email', '', undefined, 'a@notmailinator.com'])('not disposable %s', (e) => expect(isDisposableEmail(e)).toBeFalsy());
    test('disposable email flagged on COD, ignored on prepaid or when missing', () => {
        expect(codes(cod({}, { customerEmail: 'x@mailinator.com' }))).toContain('email_disposable');
        expect(codes(cod({}, { customerEmail: 'x@mailinator.com', paymentMethod: 'upi' }))).not.toContain('email_disposable');
        expect(codes(cod({}, { customerEmail: undefined }))).not.toContain('email_disposable');
    });

    test('3rd COD order in 24h is flagged High with the count in the message', () => {
        const r = cod({}, { recentOrders: [hoursAgo(2), hoursAgo(20)] });
        const f = r.flags.find((x) => x.code === 'order_velocity');
        expect(f.severity).toBe('High'); expect(f.message).toBe('Customer placed 3 COD orders in 24 hours');
    });
    test('one earlier COD order is fine; old, prepaid and same-order entries do not count', () => {
        expect(codes(cod({}, { recentOrders: [hoursAgo(2)] }))).not.toContain('order_velocity');
        expect(codes(cod({}, { recentOrders: [hoursAgo(2), hoursAgo(30)] }))).not.toContain('order_velocity');          // 30h ago is outside the window
        expect(codes(cod({}, { recentOrders: [hoursAgo(2), hoursAgo(3, { payment_method: 'upi' })] }))).not.toContain('order_velocity');
        expect(codes(cod({}, { orderId: 'P2', recentOrders: [hoursAgo(2), hoursAgo(3)] }))).not.toContain('order_velocity'); // P2 is the order itself
    });
    test('velocity is ignored for prepaid orders', () => expect(codes(cod({}, { paymentMethod: 'upi', recentOrders: [hoursAgo(1), hoursAgo(2), hoursAgo(3)] }))).not.toContain('order_velocity'));

    test('riskScore: High 40, Medium 20, capped at 100; action follows the status', () => {
        expect(cod({}).riskScore).toBe(0); expect(cod({}).recommendedAction).toBe('PROCEED');
        const one = cod({ recipientName: 'asdf' }); expect(one.riskScore).toBe(20); expect(one.recommendedAction).toBe('HOLD_FOR_VERIFICATION');
        expect(cod({ pincode: '999999', recipientMobile: '9999999999', recipientName: 'asdf', addressLine1: 'x' }).riskScore).toBe(100);
    });
});

describe('evaluateCODOrderRisk (seller-facing wrapper)', () => {
    const order = (over = {}) => ({ orderId: 'O1', paymentMethod: 'COD', customerName: 'Rahul Sharma', customerEmail: 'rahul@gmail.com', customerPhone: '9812345678', shippingAddress: 'Flat 12, Green Park Apartments, near City Mall', createdAt: '2026-11-13T10:00:00Z', ...over });

    test('valid COD order proceeds with the exact output shape', () => {
        expect(evaluateCODOrderRisk(order(), [])).toEqual({ isFlagged: false, riskScore: 0, flagReasons: [], flags: [], recommendedAction: 'PROCEED' });
    });
    test('fake COD order: everything wrong at once, readable reasons for the dashboard', () => {
        const r = evaluateCODOrderRisk(order({ customerName: 'test123', customerEmail: 'x@yopmail.com', customerPhone: '1234567890', shippingAddress: 'home' }),
            [{ orderId: 'A', paymentMethod: 'COD', createdAt: '2026-11-13T08:00:00Z' }, { orderId: 'B', paymentMethod: 'COD', createdAt: '2026-11-12T23:00:00Z' }]);
        expect(r.isFlagged).toBe(true); expect(r.recommendedAction).toBe('HOLD_FOR_VERIFICATION'); expect(r.riskScore).toBeGreaterThan(80);
        expect(r.flagReasons).toEqual(expect.arrayContaining(['Customer placed 3 COD orders in 24 hours']));
        expect(r.flagReasons.some((m) => /disposable/i.test(m))).toBe(true);
        expect(r.flagReasons.some((m) => /looks like test/i.test(m))).toBe(true);
        expect(r.flagReasons.every((m) => typeof m === 'string' && m.length > 10)).toBe(true);
    });
    test('prepaid orders are never evaluated', () => {
        expect(evaluateCODOrderRisk(order({ paymentMethod: 'UPI', customerName: 'test', shippingAddress: 'x' }), [])).toMatchObject({ isFlagged: false, riskScore: 0, recommendedAction: 'PROCEED' });
    });
    test('a string address skips pincode/state/city checks instead of failing them', () => {
        const r = evaluateCODOrderRisk(order({ shippingAddress: 'Flat 12, Green Park Apartments' }), []);
        expect(r.isFlagged).toBe(false);
    });
    test('an address object with a directory also gets the geography checks', () => {
        const r = evaluateCODOrderRisk(order({ shippingAddress: { ...good, city: 'UP', pincode: '462001' } }), [], { directory: dir });
        expect(r.isFlagged).toBe(true); expect(r.flags.map((f) => f.code)).toEqual(expect.arrayContaining(['state_pincode_mismatch', 'city_state_mismatch']));
    });
    test('missing input never throws', () => { expect(() => evaluateCODOrderRisk()).not.toThrow(); expect(() => evaluateCODOrderRisk({ paymentMethod: 'COD' })).not.toThrow(); });
});
