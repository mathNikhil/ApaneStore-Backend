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
