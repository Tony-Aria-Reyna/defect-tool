// Works out where a defect belongs on the plans from its unit and the words in its description, using the room and fixture
// boundaries already drawn (kitchen sink, shower, ranch slider, AC unit…). Used for items that arrive without a pin: new rows
// from the contractor's register, scanned sheets, handwriting, and voice notes. A rule only applies when its room or fixture
// actually exists on the plans for that unit; otherwise the item falls back to the centre of the room, then the unit.
// A project can replace these with its own list in project.placeRules (same shape).
const INT = [
  ['Paint defect (whole unit)', /^paint defects?\.?$/, '', '', 'unit', '', 'Whole unit: paint defects in more than one room'],
  ['Entry door', /entry door|front door|door closer/, 'Kitchen', 'Entry', 'item', '', ''],
  ['Hot water cupboard', /\bhwc\b|hot water/, 'Hot water cupboard', '', 'room', '', ''],
  ['Toilet', /toilet|\bwc\b|cistern/, 'Bathroom', 'Toilet', 'item', '', ''],
  ['Vanity / basin / mirror', /vanity|basin|mirror/, 'Bathroom', 'Vanity', 'item', '', ''],
  ['Shower', /shower/, 'Bathroom', 'Shower', 'item', '', ''],
  ['Bathroom', /bathroom|towel|grab ?rail|extract(or)? fan|bathroom fan/, 'Bathroom', '', 'room', '', ''],
  ['Supertub', /\btub\b|supertub/, 'Laundry', 'Supertub', 'item', '', ''],
  ['Laundry slider', /laundry.*(slider|door)|cavity slider/, 'Laundry', 'Sliding track', 'item', '', ''],
  ['Laundry', /laundry|washing machine/, 'Laundry', '', 'room', '', ''],
  ['Oven / cooktop / rangehood', /oven|cooktop|\bhob\b|range ?hood/, 'Kitchen', 'Cooktop', 'item', '', ''],
  ['Fridge space', /fridge/, 'Kitchen', 'Fridge Space', 'item', '', ''],
  ['Kitchen sink', /sink/, 'Kitchen', 'Sink', 'item', '', ''],
  ['Kitchen joinery', /kitchen|kithcen|splashbac|pantry|cutlery|bench|drawer|cabinet|cupboard/, 'Kitchen', 'Cabinetry', 'item', '', ''],
  ['Wardrobe', /wardrobe|\brobe\b/, 'Wardrobe', '', 'room', '', ''],
  ['Bedroom', /bedroom/, 'Bedroom', '', 'room', '', ''],
  ['Ranch slider / joinery (inside)', /ranch ?slider|slider|joinery|window/, 'Living', 'Ranch slider', 'item', 'Wall', 'General location: at the ranch slider'],
  ['Vinyl (no room named)', /vinyl/, 'Kitchen', '', 'room', '', 'General location: vinyl floor, pinned at the centre of the kitchen'],
  ['Carpet', /carpet/, 'Living', '', 'room', '', 'General location: carpet, pinned at the centre of the living room'],
  ['Heat pump (inside)', /heat ?pump|thermostat|thermstat/, 'Living', 'Heatpump', 'item', 'Wall', ''],
  ['Living', /living|lounge/, 'Living', '', 'room', '', ''],
];
const EXT = [
  ['AC unit / condensate drain', /outdoor unit|a\/?c\b|condensate|heat ?pump/, 'Deck / patio', 'AC Unit', 'item', '', ''],
  ['Wall light', /\blight\b/, 'Deck / patio', 'Wall light', 'item', 'Exterior cladding', ''],
  ['Isolator switch', /isolator/, 'Deck / patio', 'AC Unit', 'item', '', ''],
  ['Bedroom window / sill', /window|windw|sill/, 'Bedroom', 'Bedroom Window', 'item', 'Exterior cladding', ''],
  ['Deck / decking / balustrade', /deck|balustrade|post\b|baseboard|waterfall|soffit|ramp|handrail/, 'Deck / patio', '', 'room', '', ''],
  ['Slider head (outside)', /slider|ranch/, 'Living', 'Ranch slider', 'item', 'Exterior cladding', ''],
];
const OUTSIDE = /brick|mortar|cladding|archimax|archiwave|soffit|deck|balustrade|downpipe|gutter|\bfins?\b|flashing|cowl|outdoor unit|condensate|exterior|external|baseboard|ramp|garden|mulch|planter|fence|gate/;
const AREAS = [[/corridor/, 'Corridor'], [/community (room|space)/, 'Community room'], [/community deck/, 'Community Deck'], [/clothes ?line/, 'Clotheslines'], [/bike/, 'Bike Store'], [/bin store|rubbish/, 'Bin Store'], [/stair/, 'Stairwell'], [/\blift\b/, 'Lift']];
export function classify(text, ie, rules) {
  const t = String(text || '').toLowerCase().trim(), ext = /^ext/i.test(ie || '') || (!ie && OUTSIDE.test(t));
  const list = (rules && rules[ext ? 'ext' : 'int']) || (ext ? EXT : INT);
  for (const [rule, re, room, item, pin, surface, general] of list) { if ((re instanceof RegExp ? re : new RegExp(re)).test(t)) return { rule, room, item, pin, surface, general, ext }; }
  return ext ? { rule: 'Exterior, no feature named', pin: 'elev', room: '', item: '', surface: 'Exterior cladding', general: 'General location only: exterior of the unit', ext } : { rule: 'No room named', pin: 'unit', room: '', item: '', surface: '', general: 'General location only: no room given, pinned at the centre of the unit', ext };
}
// Put d on the plans. X supplies pinPatch and elevSpot from the app. Returns a short note of where it went, or '' if it could not be placed.
export function place(d, X, opt = {}) {
  const text = [d.title, d.desc].filter(Boolean).join(' '), set = (patch, note) => { Object.assign(d, patch); d.needsPin = false; if (note) { d.zoneHit = note; d.ext = { ...(d.ext || {}), 'Location note': note }; } return d.zoneHit || 'pinned'; };
  if (d.unit) {
    const c = classify(text, opt.ie, opt.rules); let p = null;
    if (c.pin === 'item') p = X.pinPatch(d, null, null, null, c.room, c.item, { strict: true }) || X.pinPatch(d, null, null, null, c.room, '', { strict: true });
    else if (c.pin === 'room') p = X.pinPatch(d, null, null, null, c.room, '', { strict: true });
    else if (c.pin === 'elev') { const sp = X.elevSpot ? X.elevSpot(d.unit) : null; if (sp) { p = X.pinPatch(d, sp.plan.id, sp.x, sp.y); if (p) { if (c.surface) p.surface = c.surface; return set(p, 'General location: ' + (sp.face ? sp.face + ' of ' : 'exterior of ') + 'Unit ' + d.unit); } } p = X.pinPatch(d, null, null, null, 'Deck / patio', '', { strict: true }); }
    if (p) { if (c.surface) p.surface = c.surface; return set(p, c.general || ''); }
    p = X.pinPatch(d, null, null, null, '', '');   // centre of the unit
    if (p) { p.room = ''; p.item = ''; return set(p, c.pin === 'unit' && c.general ? c.general : 'General location only: pinned at the centre of Unit ' + d.unit); }
    return '';
  }
  const where = String(d.room || opt.area || '') + ' ' + text, a = AREAS.find(q => q[0].test(where.toLowerCase()));
  if (a) { const blk = (/block\s*([a-z])\b/i.exec(where) || [])[1] || d.block || ''; const p = X.pinPatch(d, null, null, null, a[1], '', { block: blk, level: /first|\bff\b/i.test(where) && !/gf/i.test(where) ? 'First' : (a[1] === 'Corridor' ? 'Ground' : ''), strict: true }) || X.pinPatch(d, null, null, null, a[1], '', { block: blk, strict: true }); if (p) return set(p, ''); }
  return '';
}
