const { evaluateOrderRisk, nameIsJunk, phoneIsInvalid } = require('../src/services/orderRisk.service');

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
