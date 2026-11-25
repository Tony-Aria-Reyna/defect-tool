// Contact details found in documents. Every tool that reads a document's words (the viewer's search, the AI read, the document
// check, the Contacts reader) hands them to note(), which keeps the phone numbers, email addresses and named people it finds
// on the document. The Contacts screen adds them up by company and offers them as suggestions to confirm.
import { S, can } from './state.js';

export const VER = 2;
export const RE_EMAIL = /[a-z0-9][a-z0-9._%+-]*@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi;
export const RE_PHONE = /(?:\+?64[\s-]?\(?0?\)?[\s-]?|\(?0)(?:2\d|[34679]|800|508)\)?[\s-]?\d{3,4}[\s-]?\d{3,4}\b/g;
const BAD_E = /aucklandcouncil|example\.|noreply|no-reply|donotreply|sentry\.|\.(png|jpe?g|gif)$/i;
const BAD_P = ['093010101'];   // Auckland Council
const GENERIC = /^(info|admin|sales|contracts?|accounts?|office|service|support|enquir|hello|auckland|reception|orders?|warrant|team|mail|contact|nz|help|quotes?|estimating|technical|customer)/i;

// 021 123 4567 however it was written
export const digits = x => { let d = String(x || '').replace(/\D/g, ''); if (d.startsWith('64')) d = '0' + d.slice(2).replace(/^0/, ''); return d; };
export const isMobile = x => /^02/.test(digits(x));
export function fmtPhone(x) {
  const d = digits(x); if (d.length < 9 || d.length > 11) return String(x || '').replace(/\s+/g, ' ').trim();
  if (/^0(800|508)/.test(d)) return `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}`;
  if (/^02/.test(d)) return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
  return `${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5)}`;
}
const cleanEmail = e => String(e || '').toLowerCase().replace(/[.,;:]+$/, '');
export const nameFromEmail = e => { const l = String(e || '').split('@')[0]; return GENERIC.test(l) ? '' : l.split(/[._-]/).filter(x => /^[a-z]{2,}$/i.test(x)).map(x => x[0].toUpperCase() + x.slice(1).toLowerCase()).join(' '); };

// Words that start with a capital but are not part of a person's name
const NOT_NAME = new Set(('limited ltd road rd street st avenue ave drive place lane way crescent highway terrace quay auckland wellington christchurch hamilton tauranga dunedin napier nelson zealand new north south east west shore city bay green glen mount central penrose albany henderson onehunga manukau papakura takapuna ' +
  'phone mobile mob email fax tel telephone web website free freephone contact contacts address postal box private bag level unit floor suite building house po ' +
  'construction constructions project projects manager director directors engineer engineering services service solutions systems group company co holdings partnership housing property properties ' +
  'warranty warranties guarantee schedule deed agreement contract contractor subcontractor principal client customer supplier manufacturer installer owner ' +
  'date dated page signed signature witness name position title the and for of by to from in on at with this that all our your please thank thanks regards dear attention attn ' +
  'january february march april may june july august september october november december monday tuesday wednesday thursday friday saturday sunday ' +
  'practical completion certificate producer statement code compliance council consent building act standard nzs fire electrical plumbing mechanical roofing flooring painting glazing joinery ' +
  'head office branch national sales accounts admin general managing operations technical commercial residential industrial product products data sheet manual maintenance care guide').split(' '));
const RE_NAME = /\b([A-Z][a-z'’]+(?:-[A-Z][a-z]+)?)(?:\s+(?:[A-Z]\.?|van|de|der|du|te|le|la))?\s+((?:Mc|Mac|O'|O’|Van |De |Te )?[A-Z][a-z'’]+(?:-[A-Z][a-z]+)?)\b/g;
const RE_ROLE = /\b(Managing Director|General Manager|Operations Manager|Project Manager|Contracts? Manager|Construction Manager|Service Manager|Site Manager|Account Manager|Sales Manager|Branch Manager|Technical Manager|Office Manager|Quantity Surveyor|Project Engineer|Site Supervisor|Project Coordinator|Sales Representative|Estimator|Administrator|Foreman|Supervisor|Technician|Director|Owner|Engineer)\b/i;
function namesIn(t, base) {
  const out = []; let m; RE_NAME.lastIndex = 0;
  while ((m = RE_NAME.exec(t))) { const a = m[1], b = m[2].trim(); if (NOT_NAME.has(a.toLowerCase()) || b.split(/\s+/).some(w => NOT_NAME.has(w.toLowerCase())) || a.length < 2 || b.length < 2) { RE_NAME.lastIndex = m.index + a.length; continue; } out.push({ n: m[0].replace(/\s+/g, ' '), at: base + m.index, end: base + m.index + m[0].length }); }
  return out;
}
const nkey = n => String(n || '').toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();

// Read phone numbers, email addresses and the people they belong to out of plain text.
export function harvest(text) {
  const t = String(text || '').replace(/[ \t]+/g, ' '), out = { e: [], p: [], people: [] }, people = new Map();
  if (t.length < 8) return out;
  const person = n => { const k = nkey(n); if (!people.has(k)) people.set(k, { n }); return people.get(k); };
  const names = namesIn(t, 0);
  const near = (at, end, back = 150, fwd = 14) => { let best = null, bd = 1e9; for (const x of names) { const dist = x.end <= at ? at - x.end : x.at >= end ? (x.at - end) * 2.5 : 0; if ((x.end <= at && dist <= back) || (x.at >= end && x.at - end <= fwd)) { if (dist < bd) { bd = dist; best = x; } } } return best; };
  const role = x => { const m = RE_ROLE.exec(t.slice(Math.max(0, x.at - 50), x.end + 60)); return m ? m[1].replace(/\b\w/g, c => c.toUpperCase()) : ''; };
  let m; const reE = new RegExp(RE_EMAIL.source, 'gi'), reP = new RegExp(RE_PHONE.source, 'g');
  while ((m = reE.exec(t))) { const e = cleanEmail(m[0]); if (BAD_E.test(e) || e.length > 80) continue; if (!out.e.includes(e)) out.e.push(e);
    const guess = nameFromEmail(e); if (!guess) continue; const parts = nkey(guess).split(' ');
    const hit = names.find(x => Math.abs(x.at - m.index) < 260 && parts.some(w => w.length > 2 && nkey(x.n).split(' ').includes(w)));
    const who = hit ? hit.n : parts.length >= 2 ? guess : ''; if (!who) continue; const P = person(who); P.e = P.e || e; P.sure = 1; if (hit && !P.r) P.r = role(hit); }
  while ((m = reP.exec(t))) { const raw = m[0], d = digits(raw); if (d.length < 9 || d.length > 11 || BAD_P.includes(d)) continue; const f = fmtPhone(raw); if (!out.p.includes(f)) out.p.push(f);
    const x = near(m.index, m.index + raw.length, isMobile(d) ? 150 : 70); if (!x) continue;
    // a capitalised pair of words beside a number is only taken as a person when something says so: their email, a job title, or a label such as "Contact:"
    const r0 = role(x), known = people.has(nkey(x.n)), lab = /(contact|attention|attn|name|prepared by|signed by|signed|call|ask for|representative|regards|sincerely)\W{0,5}$/i.test(t.slice(Math.max(0, x.at - 24), x.at)); if (!known && !r0 && !lab) continue;
    const P = person(x.n); if (isMobile(d)) P.m = P.m || f; else if (!/^0(800|508)/.test(d)) P.p = P.p || f; if (!P.r) P.r = role(x); }
  out.people = [...people.values()].filter(P => P.e || P.m || P.p).slice(0, 12).map(P => { const o = { n: P.n }; ['r', 'p', 'm', 'e'].forEach(k => { if (P[k]) o[k] = P[k]; }); if (P.sure) o.sure = 1; return o; });
  out.e = out.e.slice(0, 12); out.p = out.p.slice(0, 12);
  return out;
}

// What the AI is asked when the page is a scan or a photo with no words to read
export const aiPrompt = d => `This picture is a page of a handover document on a New Zealand construction project. It is filed under the company "${d.party || ''}" with the title "${d.title || ''}".
List the contact details printed or written on the page: people (name, role, phone, mobile, email) and general company lines (phone, email).
Leave out ${[S.project.client, 'Auckland Council'].filter(Boolean).join(' and ')}. Copy exactly what is on the page. Do not guess or fill gaps. Use empty strings where a detail is not shown.
Return JSON only: {"contacts":[{"name":"person's name, or empty for a general company line","role":"","company":"","phone":"landline or 0800","mobile":"","email":""}]}`;
export function fromAi(j) {
  const out = { e: [], p: [], people: [] }; if (!j || !Array.isArray(j.contacts)) return out;
  for (const c of j.contacts.slice(0, 12)) { const e = RE_EMAIL.test(String(c.email || '')) ? cleanEmail(c.email) : ''; RE_EMAIL.lastIndex = 0; const ph = [c.phone, c.mobile].map(x => digits(x)).filter(x => x.length >= 9 && x.length <= 11 && !BAD_P.includes(x)).map(fmtPhone);
    if (e && !BAD_E.test(e) && !out.e.includes(e)) out.e.push(e); ph.forEach(x => { if (!out.p.includes(x)) out.p.push(x); });
    const n = String(c.name || '').replace(/\s+/g, ' ').trim(); if (!n || n.length > 60 || !(e || ph.length)) continue;
    const o = { n, sure: 1 }; if (c.role) o.r = String(c.role).slice(0, 50); const mob = ph.find(isMobile), land = ph.find(x => !isMobile(x)); if (land) o.p = land; if (mob) o.m = mob; if (e) o.e = e; out.people.push(o); }
  return out;
}

// Add what was just found to what the document already holds. Returns null when there is nothing new.
export function merge(old, nw) {
  const o = old || {}, e = [...(o.e || [])], p = (o.p || []).map(fmtPhone), people = (o.people || []).map(x => ({ ...x })); let ch = !old;
  for (const x of nw.e || []) if (!e.includes(x)) { e.push(x); ch = true; }
  for (const x of nw.p || []) if (!p.some(y => digits(y) === digits(x))) { p.push(x); ch = true; }
  for (const P of nw.people || []) { const had = people.find(x => nkey(x.n) === nkey(P.n)); if (!had) { people.push({ ...P }); ch = true; continue; } for (const k of ['r', 'p', 'm', 'e', 'sure']) if (P[k] && !had[k]) { had[k] = P[k]; ch = true; } }
  return ch ? { e: e.slice(0, 20), p: p.slice(0, 20), people: people.slice(0, 20) } : null;
}

// Called by any tool that has just read a document's words. Saves quietly; never gets in the way of the tool that called it.
export async function note(d, text, opt = {}) {
  try { if (!d || !d.id || d.template || d.restricted || !S.project || !can.edit()) return;
    const had = d.found, m = merge(had, opt.found || harvest(text)), up = (had || {}).v !== VER || (opt.full && !(had || {}).full) || (opt.ai && !(had || {}).ai);
    if (!m && !up) return;
    const found = { ...(had || {}), ...(m || {}), at: new Date().toISOString(), v: VER }; if (opt.full) found.full = 1; if (opt.ai) found.ai = 1; delete found.err;
    ['e', 'p', 'people'].forEach(k => { found[k] = found[k] || []; });
    d.found = found; await S.store.patchItem(S.project.id, 'docs', d.id, { found: JSON.parse(JSON.stringify(found)) });
  } catch (e) { console.warn('contact details not saved', e); }
}
export const needsRead = d => !d.found || (d.found.v || 1) < VER;
