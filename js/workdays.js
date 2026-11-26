// Working Days as NZS 3910 defines them: a calendar day other than a Saturday, a Sunday, a public holiday,
// or any day from 24 December to 5 January (both inclusive). Used for the contract clocks in contract.js.
// No imports, so it can be tested with plain node (test/workdays.test.mjs).
const pad = n => String(n).padStart(2, '0');
export const isoOf = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const dOf = iso => new Date(iso + 'T00:00');
const shift = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

// Matariki is set by the Te Kāhui o Matariki Public Holiday Act 2022 (dates to 2052; the next ten years are held here).
const MATARIKI = { 2022: '06-24', 2023: '07-14', 2024: '06-28', 2025: '06-20', 2026: '07-10', 2027: '06-25', 2028: '07-14', 2029: '07-06', 2030: '06-21', 2031: '07-11', 2032: '07-02', 2033: '06-24', 2034: '07-07', 2035: '06-29' };
// Regional anniversary days: the Monday nearest to the date. Northland observes the same day as Auckland.
export const REGIONS = { 'Auckland / Northland': '01-29', 'Wellington': '01-22', 'Nelson': '02-01', 'Otago': '03-23', 'Taranaki (second Monday in March)': 'tar', 'None / add the day below': '' };

function easter(y) {   // Gregorian Easter Sunday (anonymous algorithm)
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1; return new Date(y, mo - 1, da);
}
const nthDow = (y, m, dow, n) => { const d = new Date(y, m, 1); let k = 0; for (;;) { if (d.getDay() === dow && ++k === n) return new Date(d); d.setDate(d.getDate() + 1); } };
const mondayise = d => d.getDay() === 6 ? shift(d, 2) : d.getDay() === 0 ? shift(d, 1) : d;
const nearestMonday = d => { const w = d.getDay(); return shift(d, w === 0 ? 1 : w <= 4 ? 1 - w : 8 - w); };

const cache = {};
// Public holidays in one year for a region, as a Set of YYYY-MM-DD (the 24 Dec to 5 Jan shutdown is handled separately).
export function holidays(y, region) {
  const key = y + '|' + (region || ''); if (cache[key]) return cache[key];
  const s = new Set(), add = d => s.add(isoOf(d)), e = easter(y);
  add(mondayise(new Date(y, 1, 6)));          // Waitangi Day
  add(shift(e, -2)); add(shift(e, 1));        // Good Friday, Easter Monday
  add(mondayise(new Date(y, 3, 25)));         // Anzac Day
  add(nthDow(y, 5, 1, 1));                    // King's Birthday: first Monday in June
  if (MATARIKI[y]) s.add(y + '-' + MATARIKI[y]);
  add(nthDow(y, 9, 1, 4));                    // Labour Day: fourth Monday in October
  const r = REGIONS[region || ''];
  if (r === 'tar') add(nthDow(y, 2, 1, 2)); else if (r) add(nearestMonday(dOf(y + '-' + r)));
  return (cache[key] = s);
}
// cfg: { region, extra: ['YYYY-MM-DD', ...] } (extra = any other day the contract treats as a non-working day)
export function isWD(iso, cfg = {}) {
  const d = dOf(iso), w = d.getDay(); if (w === 0 || w === 6) return false;
  const md = iso.slice(5); if (md >= '12-24' || md <= '01-05') return false;
  if (holidays(d.getFullYear(), cfg.region).has(iso)) return false;
  return !(cfg.extra || []).includes(iso);
}
// The date n Working Days after a date (the day itself is not counted). n may be negative.
export function addWD(iso, n, cfg) {
  if (!iso) return ''; let d = dOf(iso), k = 0; const step = n < 0 ? -1 : 1; n = Math.abs(+n || 0);
  while (k < n) { d = shift(d, step); if (isWD(isoOf(d), cfg)) k++; }
  return isoOf(d);
}
// Working Days from a to b: days after a, up to and including b. Negative when b is before a.
export function wdBetween(a, b, cfg) {
  if (!a || !b) return null; if (a === b) return 0; if (b < a) return -wdBetween(b, a, cfg);
  let d = dOf(a), k = 0; const end = dOf(b);
  while (d < end) { d = shift(d, 1); if (isWD(isoOf(d), cfg)) k++; }
  return k;
}
