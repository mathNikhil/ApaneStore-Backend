// Shared geography helpers for the pincode loader and the order risk check.

// Must match INDIAN_STATES in the storefront PreviewProfileTab.jsx
const CANONICAL_STATES = ['Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa','Gujarat','Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh','Uttarakhand','West Bengal','Delhi','Jammu and Kashmir','Ladakh','Puducherry','Chandigarh','Andaman and Nicobar Islands','Dadra and Nagar Haveli and Daman and Diu','Lakshadweep'];

// Lowercase, '&' -> 'and', letters/digits only. "Jammu & Kashmir" -> "jammuandkashmir"
const stateKey = (s) => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/\bthe\b/g, ' ').replace(/[^a-z0-9]+/g, '');

const STATE_BY_KEY = new Map(CANONICAL_STATES.map((s) => [stateKey(s), s]));
const STATE_ALIASES = {
    orissa: 'Odisha', pondicherry: 'Puducherry', uttaranchal: 'Uttarakhand', chattisgarh: 'Chhattisgarh',
    nctofdelhi: 'Delhi', newdelhi: 'Delhi', delhincr: 'Delhi',
    dadraandnagarhaveli: 'Dadra and Nagar Haveli and Daman and Diu',
    damananddiu: 'Dadra and Nagar Haveli and Daman and Diu',
    andamannicobarislands: 'Andaman and Nicobar Islands', andamanandnicobar: 'Andaman and Nicobar Islands',
};
for (const [k, v] of Object.entries(STATE_ALIASES)) STATE_BY_KEY.set(k, v);

// Returns the canonical state name, or null when the text is not a recognised Indian state/UT.
const canonicalState = (s) => STATE_BY_KEY.get(stateKey(s)) || null;

// What people type in the CITY box when they are being lazy or fake: "UP", "MP", "Uttar Pradesh" ...
const STATE_ABBR = { up: 'Uttar Pradesh', mp: 'Madhya Pradesh', hp: 'Himachal Pradesh', tn: 'Tamil Nadu', ap: 'Andhra Pradesh', wb: 'West Bengal', uk: 'Uttarakhand', jk: 'Jammu and Kashmir', mh: 'Maharashtra', gj: 'Gujarat', rj: 'Rajasthan', ka: 'Karnataka', kl: 'Kerala', ts: 'Telangana', tg: 'Telangana', hr: 'Haryana', pb: 'Punjab', br: 'Bihar', jh: 'Jharkhand', cg: 'Chhattisgarh', dl: 'Delhi', od: 'Odisha' };
// City names that are also a state/UT name and are perfectly normal in the city box.
const CITY_IS_ALSO_STATE = new Set(['delhi', 'newdelhi', 'chandigarh', 'puducherry', 'goa']);

// If the customer's selected state is X, a pincode listed under one of these states is still acceptable.
const STATE_EQUIVALENTS = {
    'Punjab': ['Haryana', 'Chandigarh'], 'Haryana': ['Punjab', 'Chandigarh'], 'Chandigarh': ['Punjab', 'Haryana'],
    'Jammu and Kashmir': ['Ladakh'], 'Ladakh': ['Jammu and Kashmir'],
    'Gujarat': ['Dadra and Nagar Haveli and Daman and Diu'], 'Dadra and Nagar Haveli and Daman and Diu': ['Gujarat'],
    // Puducherry enclaves (Mahe, Yanam, Karaikal) sit inside other states
    'Kerala': ['Puducherry'], 'Andhra Pradesh': ['Puducherry'], 'Tamil Nadu': ['Puducherry'],
    'Puducherry': ['Kerala', 'Andhra Pradesh', 'Tamil Nadu'],
};

// Lowercase words separated by single spaces. Used for places/city comparisons.
const normText = (s) => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9\u0900-\u097f]+/g, ' ').trim().replace(/\s+/g, ' ');

// Old/new and colloquial city names. Each group is treated as the same city.
const CITY_ALIAS_GROUPS = [
    ['gurgaon', 'gurugram'], ['bombay', 'mumbai'], ['bangalore', 'bengaluru'], ['calcutta', 'kolkata'],
    ['madras', 'chennai'], ['poona', 'pune'], ['baroda', 'vadodara'], ['cochin', 'kochi'],
    ['trivandrum', 'thiruvananthapuram'], ['mysore', 'mysuru'], ['allahabad', 'prayagraj'],
    ['benaras', 'banaras', 'varanasi'], ['new delhi', 'delhi'], ['vizag', 'visakhapatnam'],
    ['pondicherry', 'puducherry'], ['belgaum', 'belagavi'], ['mangalore', 'mangaluru'], ['hubli', 'hubballi'],
    ['noida', 'gautam buddha nagar'], ['ghaziabad', 'ghaziabad'], ['faridabad', 'faridabad'],
];
const cityVariants = (city) => {
    const c = normText(city);
    const out = new Set([c]);
    for (const g of CITY_ALIAS_GROUPS) if (g.includes(c)) g.forEach((x) => out.add(x));
    return [...out].filter(Boolean);
};

module.exports = { CANONICAL_STATES, stateKey, canonicalState, STATE_ABBR, CITY_IS_ALSO_STATE, STATE_EQUIVALENTS, normText, cityVariants };
