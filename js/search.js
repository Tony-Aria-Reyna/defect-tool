// Search everything: tools first, then defects, units and plans, products and documents.
// Typing mistakes are expected: each word may be a prefix, sit inside a longer word, or be one or two letters out.
import { S } from './state.js';
import { $, esc, nzDate } from './util.js';
import { locText } from './exports.js';
import * as Nav from './nav.js';
import { aiCall } from './ai.js';

let X = {};
export function init(ctx) { X = ctx; }

export const norm = s => String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
// Words people swap for each other on site, and trade words: each group is treated as the same word.
const SAME = [['colour', 'color'], ['grey', 'gray'], ['aluminium', 'aluminum'], ['wc', 'toilet', 'loo', 'pan'], ['benchtop', 'bench', 'worktop'], ['basin', 'vanity', 'sink'], ['defect', 'snag', 'issue', 'item'], ['plasterboard', 'gib', 'drywall', 'lining', 'linings'], ['sealant', 'silicone', 'caulk', 'mastic'], ['door', 'doors', 'doorset', 'doorsets'], ['window', 'windows', 'joinery', 'glazing', 'glazier', 'glass'], ['paint', 'painting', 'painter', 'painted'], ['subbie', 'subcontractor', 'sub'], ['builder', 'contractor'], ['spreadsheet', 'excel', 'sheet', 'xlsx'], ['photo', 'picture', 'image', 'pic'], ['drawing', 'plan', 'drawings', 'plans'], ['ensuite', 'bathroom'], ['lounge', 'living'], ['wardrobe', 'robe'], ['skirting', 'skirtings'], ['hvac', 'ac', 'heatpump'],
  ['tile', 'tiles', 'tiling', 'tiler', 'tiled', 'grout', 'ceramic', 'porcelain'], ['carpet', 'carpets', 'carpeting'], ['vinyl', 'lino', 'linoleum'], ['roof', 'roofs', 'roofing', 'roofer'], ['plumbing', 'plumber', 'pipes', 'pipe', 'tap', 'taps', 'tapware'], ['electrical', 'electrician', 'sparky', 'wiring'], ['lift', 'lifts', 'elevator'], ['fan', 'fans', 'ventilation', 'extract', 'extractor'], ['hwc', 'cylinder', 'cylinders'], ['membrane', 'waterproofing', 'tanking'], ['gutter', 'gutters', 'spouting', 'downpipe', 'downpipes'], ['cladding', 'weatherboard', 'weatherboards', 'facade'], ['brick', 'bricks', 'brickwork', 'veneer', 'bricklayer'], ['block', 'blockwork', 'blocklayer'], ['landscaping', 'landscape', 'planting', 'plants', 'garden', 'gardens'], ['cctv', 'camera', 'cameras'], ['intercom', 'intercoms'], ['sprinkler', 'sprinklers'], ['smoke', 'detector', 'detectors'], ['warranty', 'warranties', 'guarantee', 'guarantees', 'deed', 'deeds'], ['manual', 'manuals', 'o&m', 'om'], ['oven', 'ovens', 'cooktop', 'hob', 'appliance', 'appliances'], ['fence', 'fences', 'fencing'], ['balustrade', 'balustrades', 'handrail', 'handrails', 'railing']];
const sameMap = (() => { const m = {}; SAME.forEach(g => g.forEach(w => { m[w] = g; })); return m; })();
const stem = w => w.length > 4 ? w.replace(/(ings|ing|ers|er|es|ed|s)$/, '') : w;

// Damerau-Levenshtein with a cut-off: returns a number above max as soon as the words are too far apart.
function dist(a, b, max) {
  const n = a.length, m = b.length; if (Math.abs(n - m) > max) return max + 1;
  let p2 = null, p1 = Array.from({ length: m + 1 }, (_, j) => j);
  for (let i = 1; i <= n; i++) {
    const c = [i]; let lo = i;
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1; let v = Math.min(p1[j] + 1, c[j - 1] + 1, p1[j - 1] + cost);
      if (p2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, p2[j - 2] + 1);
      c[j] = v; if (v < lo) lo = v;
    }
    if (lo > max) return max + 1; p2 = p1; p1 = c;
  }
  return p1[m];
}
// How well one typed word matches a piece of text (already normalised, with its word list). 0 = no match.
// Short words must be spelt right (a typo allowance on "tiles" would also find "piles" and "Miles").
function wordScore(tok, text, words) {
  if (!tok) return 0;
  if (words.has(tok)) return 1;
  const alts = sameMap[tok]; if (alts && alts.some(a => words.has(a))) return 0.9;
  const st = stem(tok); if (st.length >= 3) { for (const w of words) if (w.length > 2 && stem(w) === st) return 0.9; }
  let best = 0; for (const w of words) { if (w.startsWith(tok)) { best = 0.85; break; } }
  if (best) return best;
  if (tok.length >= 3 && text.includes(tok)) return 0.7;
  if (/^\d+$/.test(tok) || tok.length < 6) return 0;
  const max = tok.length >= 8 ? 2 : 1;
  for (const w of words) {
    if (w.length < 4 || /^\d+$/.test(w)) continue;
    if (dist(tok, w, max) <= max) return 0.55;
    if (w.length > tok.length && dist(tok, w.slice(0, tok.length), max) <= max) return 0.45;   // a typo in a word still being typed
  }
  return 0;
}
const prep = s => { const t = norm(s); return { t, w: new Set(t.split(' ').filter(Boolean)) }; };
// Score of a whole query against an entry with a title part and a body part. Every word typed must be found somewhere.
function score(toks, qn, e, loose) {
  let sum = 0, miss = 0;
  for (const k of toks) { const a = wordScore(k, e.T.t, e.T.w), b = e.B ? wordScore(k, e.B.t, e.B.w) * 0.6 : 0, s = Math.max(a, b); if (!s) { if (!loose || ++miss > toks.length / 2) return 0; } sum += s; }
  let sc = sum / toks.length; if (qn.length > 2 && e.T.t.includes(qn)) sc += 0.3; if (e.T.t === qn) sc += 0.3;
  return sc * (e.w || 1);
}

// Typo-tolerant test used by the defect list's own search box.
const cache = new WeakMap();
export function hit(q, obj, text) {
  const qn = norm(q); if (!qn) return true;
  let c = cache.get(obj); if (!c || c.src !== text) { c = { src: text, P: prep(text) }; cache.set(obj, c); }
  return qn.split(' ').every(k => wordScore(k, c.P.t, c.P.w) > 0);
}
// "MC-012" should be found by mc12, mc 12, mc-12 or 012
const idForms = id => { const m = /^([A-Za-z]+)[- ]?0*(\d+)$/.exec(String(id || '')); return m ? `${id} ${m[1]}${m[2]} ${m[1]} ${m[2]} ${m[1]}${String(id).replace(/\D/g, '')}` : String(id || ''); };

const WARR = /warrant|deed|guarantee|bond/i, MANUAL = /o&m|care and maintenance|product data|as-built/i;
function build() {
  const E = [], add = (kind, o) => E.push({ kind, ...o, T: prep(o.title + ' ' + (o.kw || '')), B: o.body ? prep(o.body) : null });
  (X.tools ? X.tools() : []).forEach(t => add('tool', { ...t, w: 0.7 }));
  if (!S.project) return E;
  const fm = S.fm || {}, A = fm.assets || [], docs = fm.docs || [], el = id => A.find(a => a.id === id);
  const exp = a => { const L = (a.warranties || []).map(w => X.expiry ? X.expiry(w) : '').filter(Boolean).sort(); return L[0] || ''; };
  A.forEach(a => { const dl = docs.filter(d => (d.assetIds || []).includes(a.id)); add('element', { icon: '▤', title: a.element || a.product || a.ref, kw: [a.product, a.ref, a.installer, ...(a.warranties || []).map(w => w.label || ''), ...dl.map(d => d.party || '')].join(' '), body: [a.location, a.system, a.notes].join(' '), sub: [a.ref, a.installer || a.product, exp(a) ? 'warranty to ' + exp(a) : '', a.status].filter(Boolean).join(' · '), where: ['▤ Assets & warranties'], a, dl, w: 1.15, run: () => X.fmGo('assets', a.element || a.product || '') }); });
  docs.forEach(d => { const els = (d.assetIds || []).map(el).filter(Boolean), k = WARR.test(d.type || '') ? 'warranty' : MANUAL.test(d.type || '') ? 'manual' : 'doc';
    add(k, { icon: d.restricted ? '🔒' : k === 'warranty' ? '🛡' : '🗀', title: d.title || d.fileName, kw: [d.type, d.party, ...els.map(a => a.element)].join(' '), body: [d.system, d.fileName, d.notes, d.aiSummary].join(' '), sub: [d.type, els.length ? els.map(a => a.element).join(', ') : (d.system || '')].filter(Boolean).join(' · '), where: ['🗀 Documents'], d, w: k === 'doc' ? 0.85 : 1.05, run: () => X.fmGo('docs', d.title || d.fileName || '') }); });
  (fm.tasks || []).forEach(t => add('task', { icon: '⟳', title: t.title || t.task || 'Maintenance task', kw: [t.system, t.responsible].join(' '), body: [t.instructions, t.ss, t.category].join(' '), sub: [t.responsible, t.nextDue ? 'next due ' + t.nextDue : ''].filter(Boolean).join(' · '), where: ['⟳ Maintenance'], run: () => X.fmGo('maint', t.title || t.task || '') }));
  // who to call: the project's key contacts and the companies saved in the directory, with the elements they did
  (S.project.contacts || []).forEach(c => add('contact', { icon: '☎', title: [c.name, c.role].filter(Boolean).join(' · ') || 'Contact', kw: [c.role, c.company].join(' '), sub: [c.phone, c.email].filter(Boolean).join(' · '), where: ['☎ Contacts'], w: 0.95, run: () => X.fmGo('contacts', c.name || '') }));
  (S.project.directory || []).forEach(c => { const els = (c.assetIds || []).map(el).filter(Boolean); add('contact', { icon: '☎', title: c.company || c.legal || 'Company', kw: [c.legal, c.role, ...els.map(a => a.element)].join(' '), body: c.notes || '', sub: [c.phone, c.email, els.length ? els.map(a => a.element).slice(0, 3).join(', ') : ''].filter(Boolean).join(' · '), where: ['☎ Contacts'], run: () => X.fmGo('contacts', c.company || '') }); });
  (fm.guide || []).forEach(g => add('guidepage', { icon: '📖', title: g.title || 'Home User Guide page', body: [g.body, g.text].join(' '), sub: 'Home User Guide', where: ['📖 Home guide'], w: 0.8, run: () => X.fmGo('guide', '') }));
  S.defects.forEach(d => add('defect', { icon: '⚑', title: `${d.id} · ${d.title || d.element || '(untitled)'}`, kw: idForms(d.id) + ' ' + (d.element || ''), body: [d.desc, d.action, d.room, d.unit ? 'unit ' + d.unit : '', d.trade, d.subcontractor, d.responsible, d.extRef, d.item, d.status, d.severity].join(' '), sub: [d.status, locText(d), d.subcontractor || d.trade].filter(Boolean).join(' · '), where: ['⚑ Defects', '☰ List'], run: () => X.openDefect(d), status: d.status, w: d.status === 'Closed' ? 0.75 : 1 }));
  (X.units ? X.units() : []).forEach(u => { const n = S.defects.filter(d => String(d.unit) === String(u) && d.status !== 'Closed').length; add('place', { icon: '🏠', title: 'Unit ' + u, kw: 'apartment flat u' + u, sub: n + ' open item' + (n === 1 ? '' : 's'), where: ['⚑ Defects', '▾ Filters', 'Unit'], run: () => X.filterBy({ unit: String(u) }) }); });
  S.plans.forEach(p => add('place', { icon: p.kind === 'elevation' ? '📐' : '▦', title: p.name, kw: [p.block ? 'block ' + p.block : '', p.level, p.code].join(' '), sub: 'Plan sheet', where: ['▦ Plans'], run: () => X.showPlan(p.id) }));
  [...new Set(S.defects.map(d => d.subcontractor).filter(Boolean))].forEach(s => { const n = S.defects.filter(d => d.subcontractor === s && d.status !== 'Closed').length; add('place', { icon: '👷', title: s, kw: 'subcontractor', sub: n + ' open item' + (n === 1 ? '' : 's'), where: ['⚑ Defects', '▾ Filters', 'Subcontractor'], run: () => X.filterBy({ sub: s }) }); });
  return E;
}
// Most important first: the element itself, its warranty, how to look after it, who to call, maintenance, then defects and the rest
const GROUPS = [['element', 'Elements', 4], ['warranty', 'Warranties and guarantees', 6], ['manual', 'Care guides, O&M manuals and product data', 5], ['contact', 'Who to call', 4], ['task', 'Maintenance', 5], ['defect', 'Defects', 10], ['guidepage', 'Home User Guide', 3], ['doc', 'Other documents', 6], ['place', 'Units, plans and subcontractors', 5], ['tool', 'Tools and settings', 4]];
export function find(q, E) {
  const qn = norm(q), toks = qn.split(' ').filter(Boolean); if (!toks.length) return [];
  E = E || build(); let R = E.map(e => ({ e, s: score(toks, qn, e) })).filter(r => r.s > 0), loose = false;
  if (!R.length && toks.length > 1) { R = E.map(e => ({ e, s: score(toks, qn, e, true) })).filter(r => r.s > 0); loose = true; }   // nothing has every word: show what has most of them
  R.sort((a, b) => b.s - a.s || (a.e.status === 'Closed') - (b.e.status === 'Closed'));
  const G = GROUPS.map(([k, name, max]) => ({ kind: k, name: name + (loose ? ' (closest, not every word found)' : ''), all: R.filter(r => r.e.kind === k).length, rows: R.filter(r => r.e.kind === k).slice(0, max) })).filter(g => g.rows.length);
  // a tool goes first only when its name is what was typed
  const t = G.findIndex(g => g.kind === 'tool'); if (t > -1 && G[t].rows[0].s >= 1.2) G.unshift(G.splice(t, 1)[0]);
  return G;
}
const QUESTION = /^(who|what|when|where|how|which|why|is|are|does|do|can|should|has|have)\b/i;
function answerCard(G, q) {
  const g = G.find(x => x.kind === 'element'); if (!g || g.rows[0].s < 0.8) return '';
  const a = g.rows[0].e.a, dl = g.rows[0].e.dl || [], w = (a.warranties || [])[0], ex = w && X.expiry ? X.expiry(w) : '', open = S.defects.filter(d => d.status !== 'Closed' && Search_hitAny(q, d)).length;
  const bits = [a.installer || a.product, w ? (w.label || 'Warranty') + (w.months ? ' ' + (w.months % 12 ? w.months + ' months' : w.months / 12 + ' years') : '') + (ex ? ', to ' + nzDate(ex) : '') : '', dl.length ? dl.length + ' document' + (dl.length === 1 ? '' : 's') : 'no documents yet', open ? open + ' open defect' + (open === 1 ? '' : 's') : ''].filter(Boolean);
  return `<div class="srcard" data-card="1"><b>${esc(a.element)}</b>${a.ref ? ` <span class="muted">${esc(a.ref)}</span>` : ''}<div>${bits.map(esc).join(' · ')}</div></div>`;
}
const Search_hitAny = (q, d) => hit(q, d, [d.title, d.desc, d.element, d.trade].join(' '));
async function ask(q, E, el) {
  const G = find(q.replace(/\?$/, ''), E), ctx = G.flatMap(g => g.rows.slice(0, 6).map(r => `[${g.name}] ${r.e.title}${r.e.sub ? ' (' + r.e.sub + ')' : ''}`)).slice(0, 30);
  el.innerHTML = '<p class="muted small">Asking the AI…</p>';
  try { const t = await aiCall(`You answer questions about one construction project for the project team and the building's owner. Use ONLY the project records listed below. Plain New Zealand English, no em dashes, at most 5 short sentences. Name the records you used. If the records do not answer it, say so and suggest where to look in the app. Return JSON {"answer":"...","used":["exact record titles"]}.\n\nPROJECT: ${S.project.name}\nRECORDS:\n${ctx.join('\n') || '(nothing matched)'}\n\nQUESTION: ${q}`);
    let j; try { j = JSON.parse(String(t).replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch (e) { j = { answer: String(t), used: [] }; }
    const used = (j.used || []).map(u => E.find(e => e.title === u)).filter(Boolean);
    el.innerHTML = `<div class="srans"><b>✨ ${esc(String(j.answer || '').replace(/—/g, ', '))}</b>${used.length ? '<div class="small">' + used.map((e, i) => `<a href="#" data-used="${i}">${esc(e.title)}</a>`).join(' · ') + '</div>' : ''}<div class="muted small">AI answer from this project's records. Check the record before relying on it.</div></div>`;
    el.querySelectorAll('[data-used]').forEach(a => a.onclick = ev => { ev.preventDefault(); const e = used[+a.dataset.used]; document.getElementById('srchX').click(); setTimeout(() => e.run(), 90); });
  } catch (e) { el.innerHTML = `<p class="small" style="color:#a32222">${esc(e.message === 'nokey' ? 'The AI helper is not set up for this project yet.' : e.message)}</p>`; }
}

export function open(q0) {
  if ($('srch')) { $('srchQ').focus(); return; }
  const E = build(), el = document.createElement('div'); el.id = 'srch'; el.className = 'srch';
  el.innerHTML = `<div class="srbox"><div class="srtop"><span>🔍</span><input id="srchQ" type="search" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Search or ask: tiles, unit 12, who installed the lift?"><button id="srchX" title="Close">✕</button></div><div id="srAsk"></div><div id="srchR" class="srres"></div></div>`;
  document.body.appendChild(el);
  let rows = [], sel = 0;
  const close = nav => { if (!el.isConnected) return; el.remove(); document.removeEventListener('keydown', key, true); if (nav !== true) Nav.closed('search'); };
  const later = fn => setTimeout(() => { try { fn(); } catch (x) { console.warn(x); } }, 90);   // let the back-step settle before the next screen opens
  const go = i => { const r = rows[i]; if (!r) return; close(); later(r.e.run); };
  const mark = () => el.querySelectorAll('.srrow').forEach((n, i) => { n.classList.toggle('on', i === sel); if (i === sel) n.scrollIntoView({ block: 'nearest' }); });
  const draw = () => {
    const q = $('srchQ').value, G = find(q, E); rows = G.flatMap(g => g.rows); sel = 0; let i = 0; $('srAsk').innerHTML = '';
    const crumbs = w => (w || []).map(c => `<i>${esc(c)}</i>`).join('<em>›</em>');
    const isQ = QUESTION.test(q.trim()) && q.trim().split(/\s+/).length >= 3 || /\?\s*$/.test(q);
    $('srchR').innerHTML = !norm(q) ? `<p class="srhint">Try: <a data-q="tiles">tiles</a>, <a data-q="unit 12">unit 12</a>, <a data-q="roof warranty">roof warranty</a>, <a data-q="who installed the lift?">who installed the lift?</a>, <a data-q="export pdf">export pdf</a>. The most important things come first: the element, its warranty, how to look after it and who to call.</p>`
      : (isQ ? `<div class="srrow ask" data-ask="1"><span class="sri">✨</span><div class="srm"><b>Ask: ${esc(q)}</b><div class="srw"><i>Answered from this project's records</i></div></div><a class="srgo">Ask ›</a></div>` : '') + answerCard(G, q)
      + (G.length ? G.map(g => `<h4>${esc(g.name)}${g.all > g.rows.length ? ` <small>top ${g.rows.length} of ${g.all}</small>` : ''}</h4>` + g.rows.map(r => { const e = r.e, n = i++; return `<div class="srrow" data-i="${n}"><span class="sri">${esc(e.icon || '•')}</span><div class="srm"><b>${esc(e.title)}</b>${e.sub ? `<small>${e.status && X.statusColour ? `<u style="background:${X.statusColour(e.status)}"></u>` : ''}${esc(e.sub)}</small>` : ''}<div class="srw">${crumbs(e.where)}</div></div><a class="srgo">${e.kind === 'tool' ? 'Open' : 'Go'} ›</a></div>`; }).join('')).join('')
      : `<p class="srhint">Nothing matches "${esc(q)}". Try one or two key words, or part of a word.</p>${S.project ? `<div class="srrow" data-list="1"><span class="sri">☰</span><div class="srm"><b>Look for "${esc(q)}" in the defect list</b><div class="srw">${crumbs(['⚑ Defects', '☰ List', 'Search box'])}</div></div><a class="srgo">Go ›</a></div><div class="srrow" data-help="1"><span class="sri">❓</span><div class="srm"><b>Ask the help assistant how to use the app</b><div class="srw">${crumbs(['? Help'])}</div></div><a class="srgo">Open ›</a></div>` : ''}`);
    $('srchR').querySelectorAll('.srrow[data-i]').forEach(n => n.onclick = () => go(+n.dataset.i));
    $('srchR').querySelectorAll('[data-q]').forEach(a => a.onclick = () => { $('srchQ').value = a.dataset.q; draw(); $('srchQ').focus(); });
    const l = $('srchR').querySelector('[data-list]'); if (l) l.onclick = () => { close(); later(() => X.filterBy({ q })); };
    const h = $('srchR').querySelector('[data-help]'); if (h) h.onclick = () => { close(); later(() => X.help(q)); };
    const ak = $('srchR').querySelector('[data-ask]'); if (ak) ak.onclick = () => ask(q, E, $('srAsk'));
    const cd = $('srchR').querySelector('[data-card]'); if (cd) cd.onclick = () => { const g = G.find(x => x.kind === 'element'); if (g) { close(); later(g.rows[0].e.run); } };
    mark();
  };
  const key = e => { if (e.key === 'Escape') { e.preventDefault(); close(); } else if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(rows.length - 1, sel + 1); mark(); } else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); mark(); } else if (e.key === 'Enter' && rows.length) { e.preventDefault(); go(sel); } };
  document.addEventListener('keydown', key, true); Nav.open('search', () => close(true));
  el.onclick = e => { if (e.target === el) close(); }; $('srchX').onclick = () => close();
  let tm = null; $('srchQ').oninput = () => { clearTimeout(tm); tm = setTimeout(draw, 90); };
  if (q0) $('srchQ').value = q0; draw(); $('srchQ').focus();
}
