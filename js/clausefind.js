// Smart clause search: forgiving of typos and of the different words people use for the same thing.
// Pure functions (no DOM), so they can be tested on their own.

// Groups of words and phrases that mean the same thing in NZ construction contracts and specifications.
export const SYNONYMS = [
  ['warranty', 'warranties', 'warrant', 'guarantee', 'guarantees', 'guaranty', 'guaranteed', 'defects liability', 'defects notification', 'defects period', 'dlp', 'dnp'],
  ['years', 'year', 'yrs', 'yr', 'months', 'month', 'period', 'duration', 'term'],
  ['maintenance', 'maintain', 'maintained', 'servicing', 'service', 'serviced', 'upkeep', 'care', 'cleaning', 'inspection'],
  ['hot water cylinder', 'hot water', 'hwc', 'water heater', 'cylinder', 'cylinders'],
  ['roof', 'roofing', 'roof cladding', 'longrun', 'long run'],
  ['membrane', 'membranes', 'waterproofing', 'waterproof', 'tanking', 'torch on', 'torch-on'],
  ['gutter', 'gutters', 'spouting', 'downpipe', 'downpipes', 'rainwater goods'],
  ['window', 'windows', 'joinery', 'glazing', 'glass', 'aluminium joinery', 'ranch slider', 'igu', 'double glazing'],
  ['door', 'doors', 'doorset', 'doorsets', 'door hardware', 'hardware', 'ironmongery', 'locks'],
  ['fire door', 'fire doors', 'fire rated door', 'fire doorset'],
  ['carpet', 'carpets', 'floor covering', 'floor coverings', 'flooring', 'vinyl', 'carpet tiles'],
  ['paint', 'painting', 'coating', 'coatings', 'powder coat', 'powdercoat', 'finish'],
  ['lift', 'lifts', 'elevator', 'passenger lift'],
  ['sprinkler', 'sprinklers', 'fire sprinkler', 'fire protection'],
  ['fire alarm', 'alarm', 'smoke detector', 'smoke alarm', 'detection', 'detectors'],
  ['emergency lighting', 'exit lighting', 'exit signs'],
  ['heat pump', 'heat pumps', 'air conditioning', 'air conditioner', 'hvac', 'heating'],
  ['ventilation', 'extract', 'extraction', 'fan', 'fans', 'mechanical'],
  ['plumbing', 'plumber', 'sanitary', 'sanitaryware', 'tapware', 'taps', 'fixtures'],
  ['drainage', 'drain', 'drains', 'stormwater', 'wastewater', 'sewer', 'drainlayer'],
  ['electrical', 'electrician', 'wiring', 'switchboard', 'power', 'lighting'],
  ['cladding', 'facade', 'weatherboard', 'envelope', 'exterior cladding'],
  ['weathertight', 'weathertightness', 'weather tight', 'weather tightness', 'watertight', 'water tight', 'leak', 'leaks', 'water penetration'],
  ['brick', 'bricks', 'masonry', 'veneer', 'blockwork'],
  ['balustrade', 'balustrades', 'handrail', 'handrails', 'barrier', 'barriers'],
  ['insulation', 'glasswool', 'thermal'],
  ['plasterboard', 'gib', 'linings', 'stopping', 'ceiling', 'ceilings'],
  ['kitchen', 'benchtop', 'bench top', 'benchtops', 'cabinetry', 'cabinets'],
  ['appliance', 'appliances', 'oven', 'cooktop', 'hob', 'rangehood', 'whiteware'],
  ['landscaping', 'landscape', 'planting', 'softscape', 'hardscape', 'plants'],
  ['producer statement', 'producer statements', 'ps1', 'ps3', 'ps4'],
  ['as-built', 'as built', 'asbuilt', 'as-builts', 'record drawings'],
  ['o&m', 'o & m', 'operation and maintenance', 'operating and maintenance', 'operating manual', 'manual', 'manuals'],
  ['practical completion', 'completion', 'handover', 'hand over'],
  ['code compliance', 'ccc', 'code compliance certificate'],
  ['contractor', 'subcontractor', 'installer', 'supplier', 'manufacturer'],
  ['principal', 'owner', 'client', 'employer'],
  ['insurance', 'insurances', 'indemnity'],
  ['retention', 'retentions', 'bond'],
  ['structure', 'structural', 'concrete', 'steel', 'precast'],
  ['fence', 'fencing', 'gate', 'gates'],
  ['paving', 'driveway', 'concrete paths', 'paths', 'carpark']
];
const STOP = new Set('a an and are as at be by for from in is it of on or that the this to with what where who which how do does our their any all how long much many need needs needed required require must should shall when there have has can will get find about please show me tell does give'.split(' '));
export const norm = s => String(s || '').toLowerCase().replace(/[‘’]/g, "'").replace(/[^a-z0-9&'\- ]+/g, ' ').replace(/\s+/g, ' ').trim();
// Edit distance with an early exit once it is over the limit
export function editDist(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i), prev2 = null;
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]; let best = i;
    for (let j = 1; j <= b.length; j++) { const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); cur[j] = (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) ? Math.min(v, prev2[j - 2] + 1) : v; if (cur[j] < best) best = cur[j]; }
    if (best > max) return max + 1; prev2 = prev; prev = cur;
  }
  return prev[b.length];
}
const tol = w => w.length >= 9 ? 2 : w.length >= 5 ? 1 : 0;
const close = (a, b) => a === b || (tol(a) > 0 && a[0] === b[0] && editDist(a, b, tol(a)) <= tol(a));
// Turn what the user typed into "concepts": each concept is a list of alternatives (words or phrases); a page must contain one of them.
export function parseQuery(q, extra) {
  let s = ' ' + norm(q) + ' '; const concepts = [];
  // whole phrases the user typed that are known synonyms (longest first)
  const phrases = SYNONYMS.flatMap((g, gi) => g.filter(t => t.includes(' ')).map(t => [t, gi])).sort((a, b) => b[0].length - a[0].length);
  for (const [t, gi] of phrases) if (s.includes(' ' + t + ' ')) { concepts.push({ label: t, alts: SYNONYMS[gi].slice() }); s = s.replace(' ' + t + ' ', ' '); }
  for (const w of s.trim().split(' ').filter(w => w && w.length > 1 && !STOP.has(w))) {
    const groups = SYNONYMS.filter(g => g.some(t => !t.includes(' ') && close(w, t)));
    const alts = new Set([w]); groups.forEach(g => g.forEach(t => alts.add(t)));
    if (concepts.some(c => c.alts.includes(w))) continue;
    concepts.push({ label: w, alts: [...alts] });
  }
  // AI-suggested terms widen the only concept, or count as an optional extra when there are several
  if (extra && extra.length) { if (concepts.length === 1) concepts[0].alts.push(...extra.map(norm).filter(Boolean)); else concepts.push({ label: 'AI terms', alts: extra.map(norm).filter(Boolean), optional: true }); }
  return concepts;
}
// pages: [{p, t}] with t the page text. Returns [{p, score, snippet, words:[matched words to highlight], all:bool}]
export function search(pages, q, extra) {
  const concepts = parseQuery(q, extra); if (!concepts.length) return { hits: [], concepts, partial: false };
  const need = concepts.filter(c => !c.optional);
  const vocabCache = new Map();   // alt word -> Set of page words that match it (fuzzy), filled lazily per distinct page word
  const hits = [];
  for (const pg of pages) {
    const text = norm(pg.t); if (!text) continue; const padded = ' ' + text + ' '; const words = text.split(' ');
    const uniq = pg._u || (pg._u = [...new Set(words)]);
    let score = 0, matched = 0, first = -1; const hl = new Set();
    for (const c of concepts) {
      let n = 0;
      for (const alt of c.alts) {
        if (alt.includes(' ')) { let i = padded.indexOf(' ' + alt + ' '); while (i >= 0) { n++; if (first < 0 || i < first) first = i; alt.split(' ').forEach(x => hl.add(x)); i = padded.indexOf(' ' + alt + ' ', i + 1); } continue; }
        for (const w of uniq) {
          const k = alt + '|' + w; let ok = vocabCache.get(k);
          if (ok === undefined) { ok = w === alt || (alt.length >= 4 && w.startsWith(alt) && w.length - alt.length <= 4) || close(alt, w); vocabCache.set(k, ok); }
          if (ok) { hl.add(w); const cnt = words.reduce((a, x) => a + (x === w ? 1 : 0), 0); n += cnt; const i = padded.indexOf(' ' + w + ' '); if (first < 0 || (i >= 0 && i < first)) first = i; }
        }
      }
      if (n) { if (!c.optional) matched++; score += Math.min(n, 6) * (c.optional ? 0.5 : 1); }
    }
    if (!matched && !score) continue;
    const all = matched === need.length; if (all) score += 10 * need.length;
    const at = Math.max(0, first - 70); const raw = String(pg.t || '').replace(/\s+/g, ' ');
    // the snippet is cut from the original text near the same position (positions differ slightly after normalising, which is fine for a preview)
    const snippet = (at > 0 ? '…' : '') + raw.slice(at, at + 220).trim() + (raw.length > at + 220 ? '…' : '');
    hits.push({ p: pg.p, score, snippet, words: [...hl], all });
  }
  const full = hits.filter(h => h.all);
  const out = (full.length ? full : hits).sort((a, b) => b.score - a.score || a.p - b.p).slice(0, 200);
  return { hits: out, concepts, partial: !full.length && hits.length > 0 };
}
