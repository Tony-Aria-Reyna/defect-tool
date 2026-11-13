// Search everything: tools first, then defects, units and plans, products and documents.
// Typing mistakes are expected: each word may be a prefix, sit inside a longer word, or be one or two letters out.
import { S } from './state.js';
import { $, esc } from './util.js';
import { locText } from './exports.js';

let X = {};
export function init(ctx) { X = ctx; }

export const norm = s => String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
// Words people swap for each other on site. Each group is treated as the same word.
const SAME = [['colour', 'color'], ['grey', 'gray'], ['aluminium', 'aluminum'], ['wc', 'toilet', 'loo'], ['benchtop', 'bench', 'worktop'], ['basin', 'vanity', 'sink'], ['defect', 'snag', 'issue', 'item'], ['plasterboard', 'gib', 'drywall'], ['sealant', 'silicone', 'caulk', 'mastic'], ['door', 'doors'], ['window', 'windows', 'joinery'], ['paint', 'painting', 'painter'], ['subbie', 'subcontractor', 'sub'], ['builder', 'contractor'], ['spreadsheet', 'excel', 'sheet', 'xlsx'], ['photo', 'picture', 'image', 'pic'], ['drawing', 'plan', 'drawings', 'plans'], ['ensuite', 'bathroom'], ['lounge', 'living'], ['wardrobe', 'robe'], ['skirting', 'skirtings'], ['hvac', 'ac', 'heatpump']];
const sameMap = (() => { const m = {}; SAME.forEach(g => g.forEach(w => { m[w] = g; })); return m; })();

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
function wordScore(tok, text, words) {
  if (!tok) return 0;
  if (words.has(tok)) return 1;
  const alts = sameMap[tok]; if (alts && alts.some(a => words.has(a))) return 0.9;
  let best = 0; for (const w of words) { if (w.startsWith(tok)) { best = 0.85; break; } }
  if (best) return best;
  if (tok.length >= 2 && text.includes(tok)) return 0.7;
  if (/^\d+$/.test(tok) || tok.length < 4) return 0;          // numbers and very short words must be right
  const max = tok.length >= 8 ? 2 : 1;
  for (const w of words) {
    if (w.length < 3 || /^\d+$/.test(w)) continue;
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
  return sc;
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

function build() {
  const E = [], add = (kind, o) => E.push({ kind, ...o, T: prep(o.title + ' ' + (o.kw || '')), B: o.body ? prep(o.body) : null });
  (X.tools ? X.tools() : []).forEach(t => add('tool', t));
  if (!S.project) return E;
  S.defects.forEach(d => add('defect', { icon: '⚑', title: `${d.id} · ${d.title || d.element || '(untitled)'}`, kw: idForms(d.id) + ' ' + (d.element || ''), body: [d.desc, d.action, d.room, d.unit ? 'unit ' + d.unit : '', d.trade, d.subcontractor, d.responsible, d.extRef, d.item, d.status, d.severity].join(' '), sub: [d.status, locText(d), d.subcontractor || d.trade].filter(Boolean).join(' · '), where: ['⚑ Defects', '☰ List'], run: () => X.openDefect(d), status: d.status }));
  (X.units ? X.units() : []).forEach(u => { const n = S.defects.filter(d => String(d.unit) === String(u) && d.status !== 'Closed').length; add('place', { icon: '🏠', title: 'Unit ' + u, kw: 'apartment flat u' + u, sub: n + ' open item' + (n === 1 ? '' : 's'), where: ['⚑ Defects', '▾ Filters', 'Unit'], run: () => X.filterBy({ unit: String(u) }) }); });
  S.plans.forEach(p => add('place', { icon: p.kind === 'elevation' ? '📐' : '▦', title: p.name, kw: [p.block ? 'block ' + p.block : '', p.level, p.code].join(' '), sub: 'Plan sheet', where: ['▦ Plans'], run: () => X.showPlan(p.id) }));
  [...new Set(S.defects.map(d => d.subcontractor).filter(Boolean))].forEach(s => { const n = S.defects.filter(d => d.subcontractor === s && d.status !== 'Closed').length; add('place', { icon: '👷', title: s, kw: 'subcontractor', sub: n + ' open item' + (n === 1 ? '' : 's'), where: ['⚑ Defects', '▾ Filters', 'Subcontractor'], run: () => X.filterBy({ sub: s }) }); });
  const fm = S.fm || {};
  (fm.assets || []).forEach(a => add('product', { icon: '▤', title: a.element || a.product || a.ref, kw: [a.product, a.ref].join(' '), body: [a.installer, a.location, a.system, a.notes].join(' '), sub: [a.product, a.installer, a.status].filter(Boolean).join(' · '), where: ['▤ Assets & warranties'], run: () => X.fmGo('assets', a.element || a.product || '') }));
  (fm.docs || []).forEach(d => add('product', { icon: '🗀', title: d.title || d.fileName, kw: d.type || '', body: [d.system, d.fileName, d.notes].join(' '), sub: [d.type, d.system].filter(Boolean).join(' · '), where: ['🗀 Documents'], run: () => X.fmGo('docs', d.title || d.fileName || '') }));
  (fm.tasks || []).forEach(t => add('product', { icon: '⟳', title: t.title || t.task || 'Maintenance task', body: [t.system, t.cat, t.resp, t.notes].join(' '), sub: [t.cat, t.nextDue ? 'next due ' + t.nextDue : ''].filter(Boolean).join(' · '), where: ['⟳ Maintenance'], run: () => X.fmGo('maint', t.title || t.task || '') }));
  return E;
}
const GROUPS = [['tool', 'Tools and settings', 6], ['defect', 'Defects', 15], ['place', 'Units, plans and subcontractors', 6], ['product', 'Products, warranties and documents', 8]];
export function find(q, E) {
  const qn = norm(q), toks = qn.split(' ').filter(Boolean); if (!toks.length) return [];
  E = E || build(); let R = E.map(e => ({ e, s: score(toks, qn, e) })).filter(r => r.s > 0), loose = false;
  if (!R.length && toks.length > 1) { R = E.map(e => ({ e, s: score(toks, qn, e, true) })).filter(r => r.s > 0); loose = true; }   // nothing has every word: show what has most of them
  R.sort((a, b) => b.s - a.s);
  return GROUPS.map(([k, name, max]) => ({ kind: k, name: name + (loose ? ' (closest, not every word found)' : ''), all: R.filter(r => r.e.kind === k).length, rows: R.filter(r => r.e.kind === k).slice(0, max) })).filter(g => g.rows.length);
}

export function open(q0) {
  if ($('srch')) { $('srchQ').focus(); return; }
  const E = build(), el = document.createElement('div'); el.id = 'srch'; el.className = 'srch';
  el.innerHTML = `<div class="srbox"><div class="srtop"><span>🔍</span><input id="srchQ" type="search" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Search tools, defects, units, products… spelling does not need to be exact"><button id="srchX" title="Close">✕</button></div><div id="srchR" class="srres"></div></div>`;
  document.body.appendChild(el);
  let rows = [], sel = 0;
  const close = () => { el.remove(); document.removeEventListener('keydown', key, true); };
  const go = i => { const r = rows[i]; if (!r) return; close(); try { r.e.run(); } catch (x) { console.warn(x); } };
  const mark = () => el.querySelectorAll('.srrow').forEach((n, i) => { n.classList.toggle('on', i === sel); if (i === sel) n.scrollIntoView({ block: 'nearest' }); });
  const draw = () => {
    const q = $('srchQ').value, G = find(q, E); rows = G.flatMap(g => g.rows); sel = 0; let i = 0;
    const crumbs = w => (w || []).map(c => `<i>${esc(c)}</i>`).join('<em>›</em>');
    $('srchR').innerHTML = !norm(q) ? `<p class="srhint">Try: <a data-q="invite">invite</a>, <a data-q="export pdf">export pdf</a>, <a data-q="unit 12">unit 12</a>, <a data-q="shower silicone">shower silicone</a>, <a data-q="summary email">summary email</a>. Each result shows where it lives in the app and takes you straight there.</p>`
      : G.length ? G.map(g => `<h4>${esc(g.name)}${g.all > g.rows.length ? ` <small>top ${g.rows.length} of ${g.all}</small>` : ''}</h4>` + g.rows.map(r => { const e = r.e, n = i++; return `<div class="srrow" data-i="${n}"><span class="sri">${esc(e.icon || '•')}</span><div class="srm"><b>${esc(e.title)}</b>${e.sub ? `<small>${e.status && X.statusColour ? `<u style="background:${X.statusColour(e.status)}"></u>` : ''}${esc(e.sub)}</small>` : ''}<div class="srw">${crumbs(e.where)}</div></div><a class="srgo">${e.kind === 'tool' ? 'Open' : 'Go'} ›</a></div>`; }).join('')).join('')
      : `<p class="srhint">Nothing matches "${esc(q)}". Try one or two key words, or part of a word.</p>${S.project ? `<div class="srrow" data-list="1"><span class="sri">☰</span><div class="srm"><b>Look for "${esc(q)}" in the defect list</b><div class="srw">${crumbs(['⚑ Defects', '☰ List', 'Search box'])}</div></div><a class="srgo">Go ›</a></div><div class="srrow" data-help="1"><span class="sri">❓</span><div class="srm"><b>Ask the help assistant</b><div class="srw">${crumbs(['? Help'])}</div></div><a class="srgo">Open ›</a></div>` : ''}`;
    $('srchR').querySelectorAll('.srrow[data-i]').forEach(n => n.onclick = () => go(+n.dataset.i));
    $('srchR').querySelectorAll('[data-q]').forEach(a => a.onclick = () => { $('srchQ').value = a.dataset.q; draw(); $('srchQ').focus(); });
    const l = $('srchR').querySelector('[data-list]'); if (l) l.onclick = () => { close(); X.filterBy({ q }); };
    const h = $('srchR').querySelector('[data-help]'); if (h) h.onclick = () => { close(); X.help(q); };
    mark();
  };
  const key = e => { if (e.key === 'Escape') { e.preventDefault(); close(); } else if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(rows.length - 1, sel + 1); mark(); } else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); mark(); } else if (e.key === 'Enter' && rows.length) { e.preventDefault(); go(sel); } };
  document.addEventListener('keydown', key, true);
  el.onclick = e => { if (e.target === el) close(); }; $('srchX').onclick = close;
  let tm = null; $('srchQ').oninput = () => { clearTimeout(tm); tm = setTimeout(draw, 90); };
  if (q0) $('srchQ').value = q0; draw(); $('srchQ').focus();
}
