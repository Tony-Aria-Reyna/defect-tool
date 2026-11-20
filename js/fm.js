// Facility management modules: dashboard, assets and warranties, maintenance, compliance (BWoF), documents.
import { S, can, isMajor, mayUse, canRestricted } from './state.js';
import { route } from './store.js';
import { STATUS_COLOURS as SCOL } from './config.js';
import * as Pack from './pack.js';
import * as Nav from './nav.js';
import { aiCall } from './ai.js';
import * as DV from './docview.js';
import * as Guide from './guide.js';
import * as AI from './docai.js';
import * as Act from './actions.js';
import * as Sub from './submit.js';
import { $, esc, toast, modal, closeModal, busy, confirmBox, askDiscard, opts, uid, todayISO, nzDate, stamp, natural, safeName, deliver, loadScript } from './util.js';

export const SYSTEMS = ['00 Contract & Consent (whole of works)', '01 Substructure & Foundations', '02 Superstructure', '03 Building Envelope', '04 Internal Finishes & Fit-out', '05 Hydraulic (Plumbing & Drainage)', '06 Electrical & Lighting', '07 Mechanical & Ventilation', '08 Fire Protection & Life Safety', '09 Vertical Transportation (Lift)', '10 Doors & Access Control', '11 External Works & Landscaping', '12 Civil & Infrastructure (3 Waters & Vector)', '13 Sustainability (Homestar & Healthy Homes)', '14 Compliance Schedule & BWoF'];
export const DOC_TYPES = ['Warranty (Schedule 13 deed)', 'Template / blank form', 'Warranty (product)', 'O&M manual', 'Care and maintenance guide', 'Producer statement / certificate', 'Commissioning / test record', 'As-built drawing', 'Product data sheet', 'Design PS1 / report', 'Consent / authority document', 'Inspection / QA record', 'Specification / drawing', 'Contract document', 'Compliance (Form 12A / BWoF)', 'Maintenance record', 'Correspondence (email / letter)', 'Other'];
const ASSET_STATUS = ['Received', 'Partial', 'Revision required', 'Query', 'Confirm', 'Not received', 'Not applicable'];
const TASK_CATS = ['Planned maintenance', 'Compliance (BWoF)', 'Warranty condition', 'Inspection', 'Cleaning', 'Other'];
const UNITS = { weeks: 'week', months: 'month', years: 'year' };

let X = {}, unsubs = [], cur = 'defects';
const F = { q: '', sys: '', st: '', type: '', cat: '', win: '90', resp: '' };
export function init(ctx) { X = ctx; Pack.init({ fm, getBytes: ctx.getBytes, addFreq, warrantyExpiry, freqText, SYSTEMS, registerBlob, icsBlob }); document.querySelectorAll('#modbar button').forEach(b => b.onclick = () => setModule(b.dataset.m)); wireSheet(); wireUploads();
  Guide.init({ getBytes: ctx.getBytes, modal, closeModal, askDiscard });
  Sub.init({ getBytes: ctx.getBytes, SYSTEMS, DOC_TYPES, render: () => { if (cur === 'assets' || cur === 'dash') render(); } });
  DV.init({ subBox: Sub.boxHtml, subWire: Sub.wireBox, getBytes: ctx.getBytes, openAsset: id => { setModule('assets'); const a = fm().assets.find(x => x.id === id); if (a) editAsset(a); }, openTask: id => { setModule('maint'); const t = fm().tasks.find(x => x.id === id); if (t) editTask(t); } }); }
const fm = () => S.fm || (S.fm = { assets: [], docs: [], tasks: [], systems: [], guide: [], actions: [] });
export function start(pid) {
  stop(); S.fm = { assets: [], docs: [], tasks: [], systems: [], guide: [], actions: [] };
  const NEED = { assets: ['assets', 'maint', 'comp', 'dash', 'docs', 'guide'], systems: ['assets', 'maint', 'comp', 'dash', 'docs', 'guide'], tasks: ['maint', 'comp', 'dash', 'assets', 'guide'], docs: ['docs', 'assets', 'maint', 'comp', 'dash', 'guide'], guide: ['guide'], actions: ['comp', 'dash'] };
  document.querySelectorAll('#modbar button').forEach(b => b.hidden = !mayUse(b.dataset.m === 'actions' ? 'comp' : b.dataset.m));
  const parts = { docs: [], rdocs: [] }; RIDS = new Set(); route.fn = (c, id) => c === 'docs' && RIDS.has(id) ? 'rdocs' : c;
  const mergeDocs = () => { fm().docs = [...parts.docs.filter(d => !RIDS.has(d.id)), ...parts.rdocs.map(d => ({ ...d, restricted: true }))]; };
  const watched = ['assets', 'docs', 'tasks', 'systems', 'guide', 'actions'].filter(c => NEED[c].some(mayUse)); loaded = new Set();
  const arrived = c => { if (loaded.has(c)) return; loaded.add(c); if (['assets', 'tasks', 'systems', 'actions'].filter(x => watched.includes(x)).every(x => loaded.has(x))) setTimeout(() => { if (S.project && S.project.id === pid) maybeDuePrompt(); }, 1500); };
  watched.forEach(c => unsubs.push(S.store.watchColl(pid, c, l => { if (c === 'docs') { parts.docs = l; mergeDocs(); } else fm()[c] = l; arrived(c); if (cur !== 'defects') render(); }, e => { console.warn(c, e); arrived(c); })));
  if (canRestricted() && NEED.docs.some(mayUse)) unsubs.push(S.store.watchColl(pid, 'rdocs', l => { parts.rdocs = l; RIDS = new Set(l.map(d => d.id)); mergeDocs(); if (cur !== 'defects') render(); }, e => console.warn('rdocs', e)));
  const first = [...document.querySelectorAll('#modbar button')].find(b => !b.hidden);
  setModule(can.client() && mayUse('dash') ? 'dash' : mayUse('defects') || !first ? 'defects' : first.dataset.m);
}
export function stop() { unsubs.forEach(u => u && u()); unsubs = []; }
export function goTo(m, q) { Object.assign(F, { q: q || '', sys: '', st: '', type: '', cat: '' }); if (m === 'maint') F.win = 'all'; setModule(m); }
export function setModule(m) {
  if (!mayUse(m === 'actions' ? 'comp' : m)) { const f = [...document.querySelectorAll('#modbar button')].find(b => !b.hidden); if (!f || f.dataset.m === m) return; m = f.dataset.m; }
  if (m !== 'defects' && !Nav.isOpen('module')) Nav.open('module', () => setModule('defects')); if (m === 'defects') Nav.closed('module');
  cur = m; document.querySelectorAll('#modbar button').forEach(b => b.classList.toggle('on', b.dataset.m === m));
  $('scrWork').classList.toggle('fm', m !== 'defects'); if (m === 'defects') { X.render && X.render(); return; } render();
}
function render() { ({ dash, assets, maint, comp, docs, contacts: contactsView, guide: Guide.view, actions: Act.view })[cur]?.(); }

/* ---------------------------------------------------------------- dates and helpers */
// a date as YYYY-MM-DD in local time (toISOString would give the UTC date, a day early in New Zealand)
const dISO = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
export function addFreq(iso, n, unit) { const d = new Date((iso || todayISO()) + 'T00:00'); if (unit === 'weeks') d.setDate(d.getDate() + 7 * n); else if (unit === 'years') d.setFullYear(d.getFullYear() + +n); else d.setMonth(d.getMonth() + +n); return dISO(d); }
const days = iso => iso ? Math.round((new Date(iso + 'T00:00') - new Date(todayISO() + 'T00:00')) / 864e5) : null;
export const freqText = t => t.freqN ? (t.freqN == 1 ? 'Every ' + UNITS[t.freqUnit] : `Every ${t.freqN} ${t.freqUnit}`) : 'One-off';
const dueBadge = iso => { const d = days(iso); if (d == null) return '<span class="st st-grey">No date</span>'; if (d < 0) return `<span class="st st-bad">${-d} day${d === -1 ? '' : 's'} overdue</span>`; if (d === 0) return '<span class="st st-warn">Due today</span>'; if (d <= 30) return `<span class="st st-warn">Due in ${d} day${d === 1 ? '' : 's'}</span>`; return `<span class="st st-info">${nzDate(iso)}</span>`; };
const stBadge = s => `<span class="st ${s === 'Received' ? 'st-ok' : s === 'Not received' ? 'st-bad' : s === 'Not applicable' ? 'st-grey' : 'st-warn'}">${esc(s || '')}</span>`;
const pcDate = () => S.project.pcDate || '';
export function warrantyExpiry(w) { const st = w.start || pcDate(); if (!st || !w.months) return ''; return addFreq(st, +w.months, 'months'); }
function assetExpiry(a) { const e = (a.warranties || []).map(warrantyExpiry).filter(Boolean).sort(); return e[0] || ''; }
const sysShort = s => String(s || '').replace(/^(\d\d) .*/, '$1');
const sysOpts = (v, blank) => opts(SYSTEMS, v, blank);
const nextRef = (list, pre) => { let n = 0; list.forEach(x => { const m = new RegExp('^' + pre + '-(\\d+)$').exec(x.ref || ''); if (m) n = Math.max(n, +m[1]); }); return pre + '-' + String(n + 1).padStart(3, '0'); };
const who = () => S.user.name, nowISO = () => new Date().toISOString();

/* ---------------------------------------------------------------- generic side sheet */
let SH = null;
function sheet(title, html, { onSave, onDelete, ro } = {}) {
  SH = { onSave, onDelete }; $('s2Title').textContent = title; $('s2Body').innerHTML = html;
  $('s2Save').style.display = onSave && !ro ? '' : 'none'; $('s2Del').style.display = onDelete && !ro ? '' : 'none'; $('s2Cancel').textContent = onSave && !ro ? 'Cancel' : 'Close';
  if (!$('sheet2').classList.contains('show')) Nav.open('sheet2', () => closeSheet());
  $('sheet2').classList.add('show');
  requestAnimationFrame(() => { if (SH) SH.snap = shFields(); });
}
const shFields = () => [...$('s2Body').querySelectorAll('input,select,textarea')].map(e => (e.type === 'checkbox' || e.type === 'radio') ? (e.checked ? '1' : '0') : e.value).join('\u0001');
// Close, Cancel and Escape check for unsaved typing first. A click outside the sheet does nothing, so a stray click or a text selection that ends outside cannot lose work.
async function tryCloseSheet() { if (SH && SH.onSave && SH.snap != null && shFields() !== SH.snap && !(await askDiscard('Your changes to this item have not been saved.'))) return; closeSheet(); }
function closeSheet() { $('sheet2').classList.remove('show'); SH = null; Nav.closed('sheet2'); }
function sysHelp() {
  modal(`<h2>Building systems</h2><p>Every asset, maintenance task and document is filed under one of these numbered building systems. The numbers match the folders in the handover pack you receive, so a document filed under "08" here is in the "08" folder there.</p><table class="t">${SYSTEMS.map(s => `<tr><td><b>${esc(s.slice(0, 2))}</b></td><td>${esc(s.slice(3))}</td></tr>`).join('')}</table><p class="note">Inside each numbered folder the documents are grouped by type: as-built drawings, O&amp;M manuals, care and maintenance guides, producer statements and certificates, commissioning and test data, product data sheets, and warranties.</p><div class="act"><button class="go" id="shX">Close</button></div>`);
  $('shX').onclick = closeModal;
}
const QM = '<button class="qm" data-syshelp title="What the building system numbers mean">?</button>';
function wireSheet() {
  $('s2Close').onclick = $('s2Cancel').onclick = tryCloseSheet;
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('sheet2').classList.contains('show') && !$('modal').classList.contains('show') && !document.querySelector('.askov')) tryCloseSheet(); });
  document.addEventListener('click', e => { if (e.target.closest && e.target.closest('[data-syshelp]')) { e.preventDefault(); sysHelp(); } });
  $('s2Save').onclick = async () => { if (!SH || !SH.onSave) return; const b = busy('Saving…'); try { const r = await SH.onSave(); b.done(); if (r !== false) { closeSheet(); toast('Saved'); } } catch (e) { b.done(); console.error(e); toast('Could not save: ' + e.message, 6000); } };
  $('s2Del').onclick = async () => { if (!SH || !SH.onDelete) return; if (!(await confirmBox('Delete this item? This cannot be undone.', 'Delete'))) return; try { await SH.onDelete(); closeSheet(); toast('Deleted'); } catch (e) { toast(e.message); } };
}
const val = id => ($(id) ? $(id).value.trim() : '');
const field = (label, id, v, attrs = '', full) => `<label class="f${full ? ' full' : ''}">${label}<input id="${id}" value="${esc(v || '')}" ${attrs}></label>`;
const area = (label, id, v, full = true) => `<label class="f${full ? ' full' : ''}">${label}<textarea id="${id}">${esc(v || '')}</textarea></label>`;
const sel = (label, id, html, full) => `<label class="f${full ? ' full' : ''}">${label}<select id="${id}">${html}</select></label>`;

/* ================================================================ DASHBOARD */
function dash() {
  const A = fm().assets, T = fm().tasks, Dd = fm().docs, SY = fm().systems, D = S.defects, p = S.project;
  const open = D.filter(d => d.status !== 'Closed'), maj = open.filter(d => isMajor(d));
  const overdue = T.filter(t => days(t.nextDue) < 0), due30 = T.filter(t => { const d = days(t.nextDue); return d != null && d >= 0 && d <= 30; });
  const exp = A.flatMap(a => (a.warranties || []).map(w => ({ a, w, e: warrantyExpiry(w) }))).filter(x => x.e);
  const exp90 = exp.filter(x => { const d = days(x.e); return d != null && d >= 0 && d <= 90; }), expired = exp.filter(x => days(x.e) < 0);
  const missing = A.filter(a => !['Received', 'Not applicable'].includes(a.status));
  const bw = p.bwofDue ? days(p.bwofDue) : null, yr = bwofYear(), cert = SY.filter(s => (s.cert12A || {})[yr]);
  const dnpEnd = p.pcDate ? addFreq(p.pcDate, +(p.dnpMonths || 12), 'months') : '', DL = dueList();
  const k = (c, n, l, m) => `<div class="kpi" style="--c:${c}" data-go="${m}"><b>${n}</b><span>${l}</span></div>`;
  $('fmView').innerHTML = `<div class="fbar"><h2>${esc(p.name)}: facility dashboard</h2><span class="sp"></span>${can.admin() ? '<button class="btn2" id="dSet">Key dates</button><button class="btn2" id="dCon">Contacts</button>' : ''}<button class="btn2" id="dIcs">📅 Calendar (.ics)</button><button class="btn2" id="dPack">⬇ FM register (Excel)</button><button class="btn2 go" id="dHand">📦 Handover pack</button></div>
  ${can.admin() && !p.pcDate ? '<div class="fmwarn"><b>Practical completion date not set.</b> Warranty expiry dates and the end of the defects notification period cannot be worked out until it is. <button class="btn2 go sm" id="dPcSet">Set it</button></div>' : ''}
  ${can.edit() && T.some(t => !t.nextDue) ? `<div class="fmwarn"><b>${T.filter(t => !t.nextDue).length} maintenance tasks have no due date</b>, so nothing will come up as due or overdue. <button class="btn2 go sm" id="dSch">Start the schedule</button></div>` : ''}
  <div id="dueBox">${dueHtml(DL, false)}</div>
  <div class="kpis">
    ${k('#d64545', open.length, `Open defects${maj.length ? ` (${maj.length} major)` : ''}`, 'defects')}
    ${k(overdue.length ? '#d64545' : '#2e9b5f', overdue.length, 'Maintenance tasks overdue', 'maint')}
    ${k('#e39b1b', due30.length, 'Maintenance due in 30 days', 'maint')}
    ${k(expired.length ? '#d64545' : '#e39b1b', exp90.length + (expired.length ? ` / ${expired.length}` : ''), `Warranties expiring in 90 days${expired.length ? ' / expired' : ''}`, 'assets')}
    ${k(bw != null && bw < 60 ? '#d64545' : '#2f78c4', bw == null ? '-' : bw < 0 ? 'Overdue' : bw + ' d', p.bwofDue ? 'BWoF due ' + nzDate(p.bwofDue) : 'BWoF date not set', 'comp')}
    ${k(cert.length < SY.length ? '#e39b1b' : '#2e9b5f', `${cert.length}/${SY.length}`, `Form 12A certificates for ${yr}`, 'comp')}
    ${k(missing.length ? '#e39b1b' : '#2e9b5f', missing.length, 'Assets with handover documents outstanding', 'assets')}
    ${(() => { const c = Sub.counts(); return can.edit() ? k(c.review ? '#2f78c4' : '#2e9b5f', c.review, 'Warranty submissions awaiting your review', 'subs') : k(c.fix ? '#d64545' : '#2e9b5f', c.fix, 'Warranty submissions to fix', 'subs'); })()}
    ${k('#3bafbe', Dd.length, 'Documents in the library', 'docs')}
  </div>
  <div class="dgrid">
    <div class="panel"><h3>Key dates</h3>
      ${[['Practical completion', p.pcDate], ['Defects notification period ends', dnpEnd], ['Code Compliance Certificate', p.cccDate], ['Building warrant of fitness due', p.bwofDue], ['Weathertightness guarantee ends (10 years)', p.pcDate ? addFreq(p.pcDate, 10, 'years') : '']].map(([l, d]) => `<div class="prow"><div class="g">${l}</div>${d ? dueBadge(d) : '<span class="st st-grey">Not set</span>'}</div>`).join('')}
    </div>
    <div class="panel"><h3>Warranties expiring or expired</h3>${[...expired, ...exp90].sort((a, b) => a.e.localeCompare(b.e)).slice(0, 12).map(x => `<div class="prow"><div class="g">${esc(x.a.element)}<small>${esc(x.w.label || '')} · ${esc(x.w.party || '')}</small></div>${dueBadge(x.e)}</div>`).join('') || `<p class="muted">${p.pcDate ? 'None in the next 90 days.' : 'Set the practical completion date (Key dates) so warranty expiry dates can be calculated.'}</p>`}</div>
    <div class="panel"><h3>Handover documents outstanding</h3>${missing.slice(0, 12).map(a => `<div class="prow" data-asset="${esc(a.id)}" style="cursor:pointer"><div class="g">${esc(a.element)}<small>${esc(sysShort(a.system))} · ${esc(a.installer || a.product || '')}</small></div>${stBadge(a.status)}</div>`).join('') || '<p class="muted">All received.</p>'}${missing.length > 12 ? `<p class="muted small">and ${missing.length - 12} more in Assets &amp; warranties.</p>` : ''}</div>
  </div>`;
  document.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { if (b.dataset.go === 'subs') { F.atab = 'subs'; return setModule('assets'); } setModule(b.dataset.go); });
  document.querySelectorAll('[data-done]').forEach(b => b.onclick = () => completeTask(T.find(t => t.id === b.dataset.done)));
  document.querySelectorAll('[data-asset]').forEach(b => b.onclick = () => editAsset(A.find(a => a.id === b.dataset.asset)));
  const redrawDue = open => { $('dueBox').innerHTML = dueHtml(DL, open); wireDue($('dueBox'), DL, redrawDue); }; wireDue($('dueBox'), DL, redrawDue);
  if ($('dSet')) $('dSet').onclick = keyDates; if ($('dPcSet')) $('dPcSet').onclick = keyDates; if ($('dSch')) $('dSch').onclick = startSchedule; if ($('dCon')) $('dCon').onclick = contactsDialog; $('dHand').onclick = Pack.packDialog;
  $('dIcs').onclick = exportIcs; $('dPack').onclick = exportFmRegister;
}
/* ---------------------------------------------------------------- what is due: one list for everyone who looks after the building */
// Everything with a date that someone has to act on: maintenance, the BWoF and its Form 12As, warranties running out, the final
// walk-through and the end of the defects period, close-out actions, and defects past their target date.
export function dueList() {
  const p = S.project, out = [], add = (date, kind, title, sub, go, extra) => { if (date) out.push({ date, kind, title, sub: sub || '', go, ...(extra || {}) }); };
  const T = fm().tasks, SY = fm().systems, A = fm().assets, AC = fm().actions || [], seeFm = m => mayUse(m) || mayUse('dash');
  if (seeFm('maint')) T.forEach(t => add(t.nextDue, t.ss ? 'Compliance' : 'Maintenance', t.title, [sysShort(t.system), freqText(t), t.responsible].filter(Boolean).join(' · '), { task: t.id }, { task: t.id }));
  if (seeFm('comp') && p.bwofDue) {
    add(p.bwofDue, 'Compliance', 'Building warrant of fitness due', 'Sign it and display it in a public place' + (p.csNumber ? ' · compliance schedule ' + p.csNumber : ''), { mod: 'comp' });
    const yr = bwofYear(), miss = SY.filter(s => !(s.cert12A || {})[yr]);
    if (miss.length) add(addFreq(p.bwofDue, -1, 'months'), 'Compliance', `Form 12A certificates for ${yr}: ${miss.length} of ${SY.length} still to come`, 'Ask the IQP' + (p.iqp ? ' (' + p.iqp + ')' : '') + ' for them a month before the BWoF is due', { mod: 'comp' });
  }
  const ahead = iso => iso && days(iso) >= 0 ? iso : '';   // a warranty that has already ended is history, not overdue
  if (seeFm('assets')) A.forEach(a => (a.warranties || []).forEach(w => add(ahead(warrantyExpiry(w)), 'Warranty ends', `${a.element}: ${w.label || 'warranty'}`, [w.party || a.installer, a.ref].filter(Boolean).join(' · '), { asset: a.id })));
  if (p.pcDate && ahead(addFreq(p.pcDate, +(p.dnpMonths || 12), 'months'))) { const end = addFreq(p.pcDate, +(p.dnpMonths || 12), 'months');
    add(addFreq(end, -1, 'months'), 'Defects period', 'Final walk-through before the defects period ends', 'List anything still wrong so it is fixed under the contract', { mod: 'defects' });
    add(end, 'Defects period', 'Defects notification period ends', 'After this, warranties and guarantees still apply, but new defects are no longer covered by the defects period', { mod: 'defects' }); }
  if (seeFm('comp')) AC.filter(x => x.due && x.status !== 'Closed').forEach(x => add(x.due, 'Action', [x.ref, x.action].filter(Boolean).join(' '), [x.responsible, x.status].filter(Boolean).join(' · '), { mod: 'actions' }));
  if (mayUse('defects')) { const today = todayISO(), live = (S.defects || []).filter(d => d.targetDate && !['Closed', 'Ready for review'].includes(d.status));
    const od = live.filter(d => d.targetDate < today).sort((a, b) => a.targetDate.localeCompare(b.targetDate)), soon = live.filter(d => d.targetDate >= today && days(d.targetDate) <= 30).sort((a, b) => a.targetDate.localeCompare(b.targetDate));
    if (od.length) add(od[0].targetDate, 'Defects', `${od.length} defect${od.length === 1 ? ' is' : 's are'} past the target date`, 'With the contractor to fix. Open the list to see each one', { filter: { overdue: true } });
    if (soon.length) add(soon[0].targetDate, 'Defects', `${soon.length} defect${soon.length === 1 ? ' is' : 's are'} due in the next 30 days`, 'Target dates for the contractor', { filter: {} }); }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
const DUE_GROUPS = [['Overdue', x => days(x.date) < 0, 'bad'], ['In the next 30 days', x => days(x.date) >= 0 && days(x.date) <= 30, 'warn'], ['In 1 to 3 months', x => days(x.date) > 30 && days(x.date) <= 92, 'info']];
const dueRow = (x, i) => `<div class="prow duer" data-due="${i}"><div class="g"><span class="dk">${esc(x.kind)}</span> ${esc(x.title)}<small>${esc(x.sub)}</small></div>${dueBadge(x.date)}${x.task && can.fmDone() ? `<button class="btn2 sm" data-ddone="${esc(x.task)}">Done</button>` : ''}</div>`;
function dueHtml(L, open) {
  const G = DUE_GROUPS.map(([g, fn, c]) => [g, L.filter(fn), c]), n = G.reduce((a, g) => a + g[1].length, 0);
  if (!n) return `<div class="panel duep"><h3>What's due</h3><p class="muted">Nothing is overdue or due in the next three months.${!S.project.pcDate ? ' Set the practical completion date (Key dates) so the warranty and defects period dates can be worked out.' : ''}</p></div>`;
  return `<div class="panel duep"><h3>What's due <span class="muted small" style="font-weight:400">${G.map(g => g[1].length ? `${g[1].length} ${g[0].toLowerCase()}` : '').filter(Boolean).join(' · ')}</span></h3>
    ${G.filter(g => g[1].length).map(([g, l, c]) => `<div class="dueg"><div class="dueh st-${c}">${g} (${l.length})</div>${l.slice(0, open ? 1e9 : 8).map(x => dueRow(x, L.indexOf(x))).join('')}${l.length > 8 && !open ? `<a href="#" class="small" data-dmore="1">Show all ${l.length}</a>` : ''}</div>`).join('')}</div>`;
}
function wireDue(root, L, redraw) {
  root.querySelectorAll('[data-dmore]').forEach(a => a.onclick = e => { e.preventDefault(); redraw(true); });
  root.querySelectorAll('[data-ddone]').forEach(b => b.onclick = e => { e.stopPropagation(); closeModal(); completeTask(fm().tasks.find(t => t.id === b.dataset.ddone)); });
  root.querySelectorAll('[data-due]').forEach(r => r.onclick = e => { if (e.target.closest('[data-ddone]')) return; const g = L[+r.dataset.due].go || {}; closeModal();
    if (g.task) return editTask(fm().tasks.find(t => t.id === g.task)); if (g.asset) { setModule('assets'); return editAsset(fm().assets.find(a => a.id === g.asset)); }
    if (g.filter) return X.filterBy ? X.filterBy(g.filter) : setModule('defects'); if (g.mod) setModule(g.mod); });
}
// When the owner's team opens the project, anything overdue or due within a week comes up first (once a day)
let duePrompted = '', loaded = new Set();
function maybeDuePrompt(tries = 0) {
  if (!S.project || !can.client() || duePrompted === S.project.id) return;
  if ($('modal').classList.contains('show')) { if (tries < 6) setTimeout(() => maybeDuePrompt(tries + 1), 5000); return; }
  duePrompted = S.project.id; const key = 'rd-due-' + S.project.id, today = todayISO();
  try { if (localStorage.getItem(key) === today) return; } catch (e) {}
  const L = dueList(), hot = L.filter(x => days(x.date) <= 7); if (!hot.length) return;
  try { localStorage.setItem(key, today); } catch (e) {}
  const od = hot.filter(x => days(x.date) < 0).length;
  modal(`<h2>What needs attention</h2><p class="note">${od ? `<b>${od} overdue</b>` : ''}${od && hot.length > od ? ' and ' : ''}${hot.length > od ? `<b>${hot.length - od} due this week</b>` : ''}. Tap one to open it.</p><div id="dpL">${hot.slice(0, 10).map(x => dueRow(x, L.indexOf(x))).join('')}</div>${hot.length > 10 ? `<p class="muted small">and ${hot.length - 10} more on the dashboard.</p>` : ''}
    <div class="act"><button id="dpX">Later</button><button class="go" id="dpGo">See everything that is due</button></div>`);
  wireDue($('dpL'), L, () => {}); $('dpX').onclick = closeModal; $('dpGo').onclick = () => { closeModal(); setModule('dash'); };
}
function keyDates() {
  const p = S.project;
  modal(`<h2>Key dates</h2><div class="grid">
    <label class="f">Practical completion<input type="date" id="kPc" value="${esc(p.pcDate || '')}"></label>
    <label class="f">Defects notification period (months)<input type="number" id="kDnp" value="${esc(p.dnpMonths || 12)}"></label>
    <label class="f">Code Compliance Certificate issued<input type="date" id="kCcc" value="${esc(p.cccDate || '')}"></label>
    <label class="f">Next BWoF due<input type="date" id="kBw" value="${esc(p.bwofDue || '')}"></label>
    <label class="f">Compliance schedule number<input id="kCs" value="${esc(p.csNumber || '')}"></label>
    <label class="f">IQP company<input id="kIqp" value="${esc(p.iqp || '')}"></label>
  </div><p class="note">Warranty expiry dates run from practical completion unless a warranty has its own start date. The BWoF is due each year on the anniversary of the compliance schedule.</p>
  <div class="act"><button id="kX">Cancel</button><button class="go" id="kOk">Save</button></div>`);
  $('kX').onclick = closeModal;
  $('kOk').onclick = async () => { const patch = { pcDate: $('kPc').value, dnpMonths: +$('kDnp').value || 12, cccDate: $('kCcc').value, bwofDue: $('kBw').value, csNumber: $('kCs').value.trim(), iqp: $('kIqp').value.trim() }; await S.store.updateProject(S.project.id, patch); Object.assign(S.project, patch); closeModal(); render(); toast('Saved'); };
}

function contactsDialog() {
  const p = S.project, C = (p.contacts || []).slice(); if (!C.length) C.push({ role: 'Property manager', name: p.client || '', phone: '', email: '', audience: 'Both' }, { role: 'After-hours maintenance', name: '', phone: '', email: '', audience: 'Both' }, { role: 'Main contractor (defects period)', name: p.contractor || '', phone: '', email: '', audience: 'FM' }, { role: 'IQP (compliance schedule)', name: p.iqp || '', phone: '', email: '', audience: 'FM' });
  const row = (c, i) => `<tr data-c="${i}"><td><input data-k="role" value="${esc(c.role || '')}"></td><td><input data-k="name" value="${esc(c.name || '')}"></td><td><input data-k="phone" value="${esc(c.phone || '')}"></td><td><input data-k="email" value="${esc(c.email || '')}"></td><td><select data-k="audience">${['Both', 'FM', 'Resident'].map(a => `<option ${a === (c.audience || 'Both') ? 'selected' : ''}>${a}</option>`).join('')}</select></td><td><button class="btn2 sm" data-cx="${i}">✕</button></td></tr>`;
  const draw = () => { $('cT').innerHTML = '<tr><th>Role</th><th>Company / name</th><th>Phone</th><th>Email</th><th>Shown to</th><th></th></tr>' + C.map(row).join(''); document.querySelectorAll('[data-cx]').forEach(b => b.onclick = () => { grab(); C.splice(+b.dataset.cx, 1); draw(); }); };
  const grab = () => document.querySelectorAll('#cT tr[data-c]').forEach(r => { const c = C[+r.dataset.c]; r.querySelectorAll('[data-k]').forEach(i => c[i.dataset.k] = i.value.trim()); });
  modal(`<h2>Contacts for the handover pack</h2><p class="note">"FM" contacts appear in the Facility Management Manual, "Resident" ones in the Home User Guide, "Both" in each.</p><table class="t" id="cT"></table><p><button class="btn" id="cAdd">+ Add contact</button></p>
  <label class="f">Welcome note for residents (optional, appears at the start of the Home User Guide)<textarea id="cHi">${esc(p.homeIntro || '')}</textarea></label>
  <div class="act"><button id="cX">Cancel</button><button class="go" id="cOk">Save</button></div>`, true);
  draw(); $('cAdd').onclick = () => { grab(); C.push({ audience: 'Both' }); draw(); }; $('cX').onclick = closeModal;
  $('cOk').onclick = async () => { grab(); const patch = { contacts: C.filter(c => c.role || c.name), homeIntro: $('cHi').value.trim() }; await S.store.updateProject(S.project.id, patch); Object.assign(S.project, patch); closeModal(); toast('Contacts saved'); };
}

/* ================================================================ ASSETS AND WARRANTIES */
const subTabs = on => { const c = Sub.counts(), n = can.edit() ? c.review : c.fix; return `<div class="atab"><button id="aT0" class="${on ? '' : 'on'}">Register</button><button id="aT1" class="${on ? 'on' : ''}">⬆ Warranty submissions${n ? ` <b class="sbn">${n}</b>` : ''}</button></div>`; };
const wireSubTabs = () => { $('aT0').onclick = () => { F.atab = 'reg'; assets(); }; $('aT1').onclick = () => { F.atab = 'subs'; assets(); }; };
// Elements still waiting on the contractor: anything not Received or Not applicable
const waiting = a => !['Received', 'Not applicable'].includes(a.status || '');
const CHASE_ST = ['Not received', 'Revision required', 'Query', 'Confirm', 'Partial'];
export async function chaseDialog() {
  const p = S.project, A = fm().assets.filter(waiting).sort((a, b) => natural(a.installer || 'zz', b.installer || 'zz') || natural(a.ref, b.ref));
  const info = p.memberInfo || {}, cons = Object.entries(p.members || {}).filter(([u, r]) => r === 'contractor').map(([u]) => (info[u] || {}).email).filter(Boolean);
  const nd = a => fm().docs.filter(d => (d.assetIds || []).includes(a.id)).length;
  modal(`<h2>📨 Chase missing documents</h2><p class="note">Elements still waiting on ${esc(p.contractor || 'the contractor')}, grouped by installer. Untick a status to leave it out.</p>
  <div class="tgl" style="margin-bottom:8px">${CHASE_ST.map(st => `<label class="opt" style="display:inline-flex;margin-right:12px"><input type="checkbox" data-cst="${esc(st)}" checked> ${esc(st)} (${A.filter(a => (a.status || 'Not received') === st).length})</label>`).join('')}</div>
  <label class="f">To<input id="chTo" value="${esc(cons.join(', '))}" placeholder="name@company.co.nz, …"></label>
  <label class="f">Message<textarea id="chMsg" style="min-height:70px">Hi team,

Below are the elements on ${esc(p.name)} that are still missing handover documents or need a corrected copy. Please upload them through Resero Site (Assets & warranties > Warranty submissions), or reply with a date for each.</textarea></label>
  <div id="chList" class="small" style="max-height:260px;overflow:auto;border:1px solid var(--line);border-radius:8px;padding:8px 12px;margin-top:8px"></div>
  <div class="act"><button id="chX">Close</button><button id="chCopy">Copy</button><button id="chMail">Open in Outlook</button>${(S.aiAdmin || {}).adminKey || can.admin() ? '<button class="go" id="chSend">Send from Resero Site</button>' : ''}</div>`, true);
  const pick = () => { const on = [...document.querySelectorAll('[data-cst]')].filter(c => c.checked).map(c => c.dataset.cst); return A.filter(a => on.includes(a.status || 'Not received')); };
  const groups = L => { const g = {}; L.forEach(a => (g[a.installer || 'Installer not named'] = g[a.installer || 'Installer not named'] || []).push(a)); return g; };
  const line = a => `${a.ref || ''} ${a.element}: ${a.status || 'Not received'}${nd(a) ? ' (' + nd(a) + ' document' + (nd(a) === 1 ? '' : 's') + ' on file)' : ''}${a.notes ? '. ' + String(a.notes).replace(/\s+/g, ' ').slice(0, 140) : ''}`;
  const text = () => { const g = groups(pick()); return $('chMsg').value.trim() + '\n\n' + Object.keys(g).map(k => k + '\n' + g[k].map(a => '  - ' + line(a)).join('\n')).join('\n\n') + `\n\n${pick().length} elements in total.\n\nRegards,\n${S.user.name}`; };
  const html = () => { const g = groups(pick()); return '<div style="font:14px Arial;color:#1d2733">' + esc($('chMsg').value.trim()).replace(/\n/g, '<br>') + Object.keys(g).map(k => `<h3 style="font:600 15px Arial;margin:16px 0 4px;color:#011c35">${esc(k)} (${g[k].length})</h3><ul style="margin:0;padding-left:18px">${g[k].map(a => '<li>' + esc(line(a)) + '</li>').join('')}</ul>`).join('') + `<p>${pick().length} elements in total.</p><p>Regards,<br>${esc(S.user.name)}</p></div>`; };
  const draw = () => { const g = groups(pick()); $('chList').innerHTML = Object.keys(g).map(k => `<b>${esc(k)}</b> (${g[k].length})<ul style="margin:2px 0 8px;padding-left:18px">${g[k].map(a => '<li>' + esc(line(a)) + '</li>').join('')}</ul>`).join('') || '<p class="muted">Nothing to chase.</p>'; };
  draw(); document.querySelectorAll('[data-cst]').forEach(c => c.onchange = draw);
  const to = () => $('chTo').value.split(/[,;\s]+/).map(x => x.trim()).filter(x => /^\S+@\S+\.\S+$/.test(x));
  $('chX').onclick = closeModal;
  $('chCopy').onclick = () => navigator.clipboard.writeText(text()).then(() => toast('Copied. Paste it into an email.'));
  $('chMail').onclick = () => { const t = text(); const body = t.length > 1800 ? t.slice(0, 1700) + '\n\n(The list is longer: paste the full copy from Resero Site.)' : t; if (t.length > 1800) navigator.clipboard.writeText(t).catch(() => {}); location.href = `mailto:${encodeURIComponent(to().join(','))}?subject=${encodeURIComponent(p.name + ': handover documents still missing')}&body=${encodeURIComponent(body)}`; };
  if ($('chSend')) $('chSend').onclick = async () => { if (!to().length) return toast('Add who it goes to'); const b = busy('Sending…');
    try { const { gsCall, helperVersion } = await import('./sheetsync.js'); if ((await helperVersion()) < 3) throw new Error('needs updating'); await gsCall('mail', { to: to(), subject: p.name + ': handover documents still missing', html: html(), replyTo: S.user.email }); b.done(); toast('Sent to ' + to().join(', '), 5000);
      try { await S.store.saveItem(p.id, 'sent', { id: uid(), what: 'Missing documents list (' + pick().length + ' elements)', to: to(), at: nowISO(), by: S.user.email }); } catch (e) {} closeModal(); }
    catch (e) { b.done(); toast(/needs updating|unexpected/i.test(e.message) ? 'The helper needs its update before it can send email. Use Open in Outlook for now.' : e.message, 8000); } };
}
function assets() {
  if ((F.atab || (can.contractor() ? 'subs' : 'reg')) === 'subs') { Sub.view(subTabs(true)); wireSubTabs(); return; }
  const A = fm().assets.slice().sort((a, b) => natural(a.system, b.system) || natural(a.ref, b.ref)), q = F.q.toLowerCase();
  const L = A.filter(a => (!F.sys || a.system === F.sys) && (!F.st || a.status === F.st) && (!q || [a.ref, a.element, a.product, a.location, a.installer, a.notes].join(' ').toLowerCase().includes(q)));
  let last = '';
  $('fmView').innerHTML = `<div class="fbar"><h2>Assets &amp; warranties</h2><input type="search" id="aQ" placeholder="Search element, product, installer…" value="${esc(F.q)}"><select id="aSys">${sysOpts(F.sys, 1).replace('<option value=""></option>', '<option value="">All systems</option>')}</select>${QM}<select id="aSt"><option value="">All statuses</option>${ASSET_STATUS.map(s => `<option ${s === F.st ? 'selected' : ''}>${s}</option>`).join('')}</select>${can.edit() ? '<button class="btn2 go" id="aNew">+ Asset</button>' : ''}${can.edit() ? `<button class="btn2" id="aCk" title="Elements whose warranty is in the library but whose status was never updated">✔ Check statuses</button><button class="btn2" id="aChase" title="Email the contractor the list of elements still missing documents">📨 Chase missing (${A.filter(waiting).length})</button>` : ''}<button class="btn2" id="aX">⬇ Excel</button></div>
  ${subTabs(false)}
  <p class="muted small">${L.length} of ${A.length} assets · ${A.filter(a => a.status === 'Received').length} with documents received · warranty expiry runs from ${pcDate() ? 'practical completion (' + nzDate(pcDate()) + ')' : 'practical completion (date not set yet: Dashboard > Key dates)'}</p>
  ${L.length ? `<table class="ftable"><tr><th>Ref</th><th>Element</th><th class="hm">Product / installer</th><th class="hm">Location</th><th>Warranty to</th><th>Documents</th><th>Status</th></tr>
  ${L.map(a => { const g = a.system !== last ? `<tr class="grp"><td colspan="7">${esc(a.system)}</td></tr>` : ''; last = a.system; const e = assetExpiry(a), nd = fm().docs.filter(d => (d.assetIds || []).includes(a.id)).length;
    return g + `<tr class="click" data-id="${esc(a.id)}"><td>${esc(a.ref || '')}</td><td><b>${esc(a.element)}</b>${a.maint ? ' <span class="st st-info" title="Warranty depends on maintenance">maint.</span>' : ''}</td><td class="hm">${esc(a.product || '')}<br><span class="muted small">${esc(a.installer || '')}</span></td><td class="hm">${esc(a.location || '')}</td><td>${e ? dueBadge(e) : '<span class="muted small">' + esc((a.warranties || [])[0]?.label || '-') + '</span>'}</td><td>${nd || '-'}</td><td>${stBadge(a.status)}</td></tr>`; }).join('')}</table>` : `<div class="empty2">${A.length ? 'No assets match.' : 'No assets yet. Add them one at a time, or import the warranty register from ☰ > Import register.'}</div>`}`;
  $('aQ').oninput = e => { F.q = e.target.value; assets(); $('aQ').focus(); $('aQ').setSelectionRange(F.q.length, F.q.length); };
  wireSubTabs();
  $('aSys').onchange = e => { F.sys = e.target.value; assets(); }; $('aSt').onchange = e => { F.st = e.target.value; assets(); };
  if ($('aCk')) $('aCk').onclick = checkStatuses;
  if ($('aNew')) $('aNew').onclick = () => editAsset(null); if ($('aChase')) $('aChase').onclick = chaseDialog;
  $('aX').onclick = exportFmRegister;
  document.querySelectorAll('tr[data-id]').forEach(r => r.onclick = () => editAsset(fm().assets.find(a => a.id === r.dataset.id)));
}
// "Where this is required": the clauses marked in the contract or specification that apply to an asset or a task
function reqHtml(kind, id, hint) {
  const L = DV.marksFor(kind, id);
  return L.map(({ d, m }) => `<div class="reqsnip" data-rd="${esc(d.id)}" data-rm="${esc(m.id)}" title="Open this clause in the document">${m.snip ? `<img data-snip="${esc(m.snip)}" alt="">` : ''}<div><b>${esc(m.period || m.kind || 'Requirement')}</b><small>${esc(DV.markLine({ d, m }))}</small>${m.text && !m.snip ? `<small>${esc(m.text.slice(0, 200))}</small>` : ''}</div></div>`).join('') || `<p class="muted small">${hint}</p>`;
}
function wireReq(reopen) {
  document.querySelectorAll('#s2Body img[data-snip]').forEach(async i => { try { i.src = await S.store.resolveUrl(i.dataset.snip); } catch (e) { i.remove(); } });
  document.querySelectorAll('#s2Body .reqsnip').forEach(r => r.onclick = async () => { const d = fm().docs.find(x => x.id === r.dataset.rd); if (!d) return; await tryCloseSheet(); if ($('sheet2').classList.contains('show')) return; DV.open(d, { markId: r.dataset.rm, ret: reopen }); });
}
function editAsset(a) {
  const isNew = !a; a = a ? JSON.parse(JSON.stringify(a)) : { id: uid(), ref: nextRef(fm().assets, 'A'), system: F.sys || SYSTEMS[1], status: 'Not received', warranties: [], om: true, maint: false, audience: 'FM' };
  const ro = !can.edit(); const docsL = fm().docs.filter(d => (d.assetIds || []).includes(a.id)); const tasksL = fm().tasks.filter(t => t.assetId === a.id);
  const wr = (w, i) => `<div class="wrow" data-w="${i}"><label class="f">Warranty<input data-k="label" value="${esc(w.label || '')}" placeholder="e.g. Materials"></label><label class="f">Given by<input data-k="party" value="${esc(w.party || '')}"></label><label class="f">Months<input data-k="months" type="number" value="${esc(w.months || '')}"></label><label class="f">Start (blank = PC)<input data-k="start" type="date" value="${esc(w.start || '')}"></label><label class="f">Expires<input disabled value="${esc(nzDate(warrantyExpiry(w)) || (w.months && !w.start ? 'Fills in after PC' : '-'))}"></label>${ro ? '' : `<button class="btn2 sm" data-wx="${i}">✕</button>`}</div>`;
  openAssetId = isNew ? null : a.id; openAssetSys = a.system;
  sheet((isNew ? 'New asset ' : '') + (a.ref || ''), `<div class="grid">
    ${sel('Building system', 'aS', sysOpts(a.system), true)}
    ${field('Element', 'aE', a.element, 'placeholder="e.g. Roof cladding"', true)}
    ${field('Product / manufacturer', 'aP', a.product)}${field('Installer / trade', 'aI', a.installer)}
    ${field('Location', 'aL', a.location)}${field('Installed / commissioned', 'aD', a.installDate, 'type="date"')}
    ${field('Required: installer warranty', 'aRi', a.instWarranty)}${field('Required: manufacturer warranty', 'aRm', a.mfrWarranty)}
    ${sel('Document status', 'aSt2', opts(ASSET_STATUS, a.status))}${sel('Audience', 'aAu', opts(['FM', 'Home user', 'Both'], a.audience))}
    <div class="opt"><input type="checkbox" id="aOm" ${a.om ? 'checked' : ''}><label for="aOm">O&amp;M manual required</label></div>
    <div class="opt"><input type="checkbox" id="aMt" ${a.maint ? 'checked' : ''}><label for="aMt">Warranty depends on maintenance</label></div>
    <div class="full" id="aCareW" style="${a.audience === 'FM' ? 'display:none' : ''}"><label class="f">Care note for residents (Home User Guide, plain English)<textarea id="aCare">${esc(a.careNote || '')}</textarea></label>${ro ? '' : '<button class="mini" id="aCareAi" style="margin-top:4px">✨ Draft with AI</button>'}</div>
    ${area('Received / variance / action', 'aN', a.notes)}${field('Source (spec / consent reference)', 'aSrc', a.source, '', true)}
  </div>
  <h3 class="sec">Where this is required <span class="sp"></span>${can.edit() && !isNew ? '<button class="mini" id="aReq">▭ Mark in the contract or specification</button>' : ''}</h3>
  ${reqHtml('asset', a.id, 'No clause marked yet. Marking the clause shows everyone exactly where the contract or specification asks for this.')}
  <h3 class="sec">Warranties <span class="sp"></span>${ro ? '' : '<button class="mini" id="aWadd">+ Add</button>'}</h3>${pcDate() ? '' : '<p class="note">Enter each warranty as a number of months. The expiry dates fill in automatically once the practical completion date is set (Dashboard > Key dates), unless a warranty has its own start date.</p>'}<div id="aW">${(a.warranties || []).map(wr).join('') || '<p class="muted small">No warranty periods recorded.</p>'}</div>
  <h3 class="sec">Documents <span class="sp"></span>${can.write() && !isNew ? '<button class="mini" id="aSubm">⬆ Submit a warranty (checked automatically)</button>' : ''}${can.edit() ? '<button class="mini" id="aDup">⬆ Upload for this asset</button>' : ''}</h3>
  ${docsL.map(d => `<div class="prow"><div class="g"><a href="#" data-open="${esc(d.id)}">${esc(d.title)}</a><small>${esc(d.type)}${d.expiry ? ' · expires ' + nzDate(d.expiry) : ''}</small></div></div>`).join('') || '<p class="muted small">None linked yet. Link documents from the Documents tab, or upload here.</p>'}
  <h3 class="sec">Maintenance <span class="sp"></span>${can.edit() && !isNew ? '<button class="mini" id="aTadd">+ Task</button>' : ''}</h3>
  ${tasksL.map(t => `<div class="prow"><div class="g">${esc(t.title)}<small>${esc(freqText(t))}</small></div>${dueBadge(t.nextDue)}</div>`).join('') || '<p class="muted small">No maintenance tasks for this asset.</p>'}`,
  { ro, onSave: async () => {
      collectW(); const o = { ...a, system: val('aS'), element: val('aE'), product: val('aP'), installer: val('aI'), location: val('aL'), installDate: val('aD'), instWarranty: val('aRi'), mfrWarranty: val('aRm'), status: val('aSt2'), audience: val('aAu'), careNote: val('aCare'), om: $('aOm').checked, maint: $('aMt').checked, notes: val('aN'), source: val('aSrc'), updated: nowISO(), updatedBy: S.user.email };
      if (!o.element) { toast('Enter the element'); return false; } await S.store.saveItem(S.project.id, 'assets', o);
    }, onDelete: isNew ? null : () => S.store.deleteItem(S.project.id, 'assets', a.id) });
  function collectW() { a.warranties = [...document.querySelectorAll('#aW .wrow')].map(r => { const w = {}; r.querySelectorAll('[data-k]').forEach(i => w[i.dataset.k] = i.value.trim()); if (w.months) w.months = +w.months; return w; }).filter(w => w.label || w.party || w.months); }
  const redrawW = () => { $('aW').innerHTML = a.warranties.map(wr).join('') || '<p class="muted small">No warranty periods recorded.</p>'; document.querySelectorAll('[data-wx]').forEach(b => b.onclick = () => { collectW(); a.warranties.splice(+b.dataset.wx, 1); redrawW(); }); };
  redrawW();
  $('aAu').onchange = e => $('aCareW').style.display = e.target.value === 'FM' ? 'none' : '';
  if ($('aCareAi')) $('aCareAi').onclick = async () => { const btn = $('aCareAi'); btn.disabled = true; btn.textContent = 'Asking the AI…';
    try { const t = await aiCall(`Write a short care note (2 to 4 sentences, plain New Zealand English, no em dashes, warm and respectful) for an older resident living in a new social housing unit, about this item in their home: ${val('aE')} (${val('aP')}). Explain simply how to use and look after it, and to report faults to their landlord rather than fixing it themselves. Return JSON {"note":"..."}.`); let n = ''; try { n = JSON.parse(String(t).replace(/^```(?:json)?\s*|\s*```$/g, '')).note; } catch (e) { n = String(t); } $('aCare').value = String(n || '').replace(/\u2014/g, ', '); }
    catch (e) { toast(e.message === 'nokey' ? 'Set up the AI first (☰ > AI)' : e.message, 5000); } finally { btn.disabled = false; btn.textContent = '✨ Draft with AI'; } };
  if ($('aWadd')) $('aWadd').onclick = () => { collectW(); a.warranties.push({ label: '', party: val('aI') || val('aP'), months: '', start: '' }); redrawW(); };
  const reA = () => { const x = fm().assets.find(q => q.id === a.id); if (x) editAsset(x); };
  wireReq(reA);
  if ($('aReq')) $('aReq').onclick = async () => { await tryCloseSheet(); if ($('sheet2').classList.contains('show')) return; DV.findClause({ asset: { id: a.id, element: a.element }, query: a.element + ' warranty', ret: reA }); };
  if ($('aSubm')) $('aSubm').onclick = () => Sub.submitDialog(a);
  if ($('aDup')) $('aDup').onclick = () => pickDocs({ assetIds: [a.id], system: val('aS') || a.system });
  if ($('aTadd')) $('aTadd').onclick = () => { closeSheet(); editTask(null, { assetId: a.id, system: a.system, title: 'Maintain ' + a.element }); };
  document.querySelectorAll('[data-open]').forEach(l => l.onclick = e => { e.preventDefault(); openDoc(fm().docs.find(d => d.id === l.dataset.open)); });
}

/* ================================================================ MAINTENANCE */
// Start the maintenance schedule: every task without a due date is first due one interval after the start date
// (normally practical completion), and the date can be saved as the project's practical completion at the same time.
export function startSchedule() {
  const T = fm().tasks.filter(t => !t.nextDue), p = S.project; if (!T.length) return toast('Every task already has a due date');
  const g = {}; T.forEach(t => { const k = t.freqN ? t.freqN + '|' + t.freqUnit : '0|'; g[k] = (g[k] || 0) + 1; });
  const rows = st => Object.entries(g).map(([k, n]) => { const [fn, fu] = k.split('|'); return `<tr><td>${n}</td><td>${fn === '0' ? 'One-off' : freqText({ freqN: +fn, freqUnit: fu })}</td><td>${st ? nzDate(fn === '0' ? st : addFreq(st, +fn, fu)) : ''}</td></tr>`; }).join('');
  modal(`<h2>Start the maintenance schedule</h2><p>${T.length} task${T.length === 1 ? ' has' : 's have'} no due date. Each will be first due one interval after the start date. You can change any task afterwards.</p>
  <label class="f">Start date (normally practical completion)<input type="date" id="usD" value="${esc(p.pcDate || '')}"></label>
  ${can.admin() ? `<div class="opt"><input type="checkbox" id="usPc" ${p.pcDate ? '' : 'checked'}><label for="usPc">Save this as the practical completion date. Warranty expiry dates and the end of the defects notification period run from it.</label></div>` : ''}
  <div class="opt"><input type="checkbox" id="usNow"><label for="usNow">Make every task first due on the start date instead</label></div>
  <table class="t small"><tr><th>Tasks</th><th>Frequency</th><th>First due</th></tr><tbody id="usRows">${rows(p.pcDate)}</tbody></table>
  <div class="act"><button id="usX">Cancel</button><button class="go" id="usOk">Start the schedule</button></div>`);
  const upd = () => { const st = $('usD').value; $('usRows').innerHTML = $('usNow').checked && st ? Object.values(g).reduce((a, n) => a + n, 0) + ' tasks due ' + nzDate(st) : rows(st); };
  $('usD').oninput = upd; $('usNow').onchange = upd; $('usX').onclick = closeModal;
  $('usOk').onclick = async () => { const st = $('usD').value; if (!st) return toast('Choose the start date first'); const now = $('usNow').checked, b = busy('Scheduling…'); let n = 0;
    try { if ($('usPc') && $('usPc').checked && st !== p.pcDate) { await S.store.updateProject(p.id, { pcDate: st }); p.pcDate = st; }
      for (const t of fm().tasks.filter(t => !t.nextDue)) { b.set(`Scheduling ${++n} of ${T.length}…`); await S.store.patchItem(p.id, 'tasks', t.id, { nextDue: now || !t.freqN ? st : addFreq(st, t.freqN, t.freqUnit) }); }
      b.done(); closeModal(); toast(`${n} tasks scheduled`, 4000); render(); } catch (e) { b.done(); toast('Stopped after ' + n + ': ' + e.message, 7000); } };
}
function maint() {
  if (F.reg) return maintRegister();
  const T = fm().tasks, q = F.q.toLowerCase(), win = F.win === 'all' ? 1e9 : +F.win;
  const L = T.filter(t => (!F.sys || t.system === F.sys) && (!F.cat || t.category === F.cat) && (!F.resp || t.responsible === F.resp) && (!q || [t.title, t.instructions, t.ss, t.responsible].join(' ').toLowerCase().includes(q)) && (days(t.nextDue) == null || days(t.nextDue) <= win)).sort((a, b) => (a.nextDue || '9999').localeCompare(b.nextDue || '9999'));
  const groups = [['Overdue', t => days(t.nextDue) < 0], ['Next 30 days', t => days(t.nextDue) >= 0 && days(t.nextDue) <= 30], ['31 to 90 days', t => days(t.nextDue) > 30 && days(t.nextDue) <= 90], ['Later', t => days(t.nextDue) > 90], ['No date set', t => days(t.nextDue) == null]];
  const resp = [...new Set(T.map(t => t.responsible).filter(Boolean))].sort();
  $('fmView').innerHTML = `<div class="fbar"><h2>Maintenance</h2><input type="search" id="mQ" placeholder="Search tasks…" value="${esc(F.q)}"><select id="mW">${[['30', 'Due in 30 days'], ['90', 'Due in 90 days'], ['365', 'Due in 12 months'], ['all', 'All tasks']].map(([v, l]) => `<option value="${v}" ${F.win === v ? 'selected' : ''}>${l}</option>`).join('')}</select><select id="mC"><option value="">All categories</option>${TASK_CATS.map(c => `<option ${c === F.cat ? 'selected' : ''}>${c}</option>`).join('')}</select><select id="mS">${sysOpts(F.sys, 1).replace('<option value=""></option>', '<option value="">All systems</option>')}</select>${QM}<select id="mR"><option value="">Anyone responsible</option>${resp.map(r => `<option ${r === F.resp ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select>${can.edit() ? '<button class="btn2 go" id="mNew">+ Task</button>' : ''}${can.edit() && T.some(t => !t.nextDue) ? `<button class="btn2" id="mSch">Schedule ${T.filter(t => !t.nextDue).length} undated</button>` : ''}<button class="btn2" id="mReg" title="Every task by building system, to read or print">▤ Register</button><button class="btn2" id="mIcs">📅 .ics</button><button class="btn2" id="mX">⬇ Excel</button></div>
  ${can.edit() && T.some(t => !t.nextDue) ? `<div class="fmwarn"><b>${T.filter(t => !t.nextDue).length} of ${T.length} tasks have no due date</b>, so nothing will come up as due or overdue. <button class="btn2 go sm" id="mSch2">Start the schedule</button></div>` : ''}
  ${T.length ? `<table class="ftable"><tr><th>Task</th><th class="hm">Building system</th><th>Frequency</th><th class="hm">Responsible</th><th class="hm">Last done</th><th>Next due</th><th></th></tr>
  ${groups.map(([g, fn]) => { const r = L.filter(fn); return r.length ? `<tr class="grp"><td colspan="7">${g} (${r.length})</td></tr>` + r.map(t => `<tr class="click" data-id="${esc(t.id)}"><td><b>${esc(t.title)}</b>${t.ss ? ` <span class="st st-info">${esc(t.ss)}</span>` : ''}<br><span class="muted small">${esc(t.category || '')}</span></td><td class="hm">${esc(sysShort(t.system))}</td><td>${esc(freqText(t))}</td><td class="hm">${esc(t.responsible || '')}</td><td class="hm">${t.lastDone ? nzDate(t.lastDone) : '-'}</td><td>${dueBadge(t.nextDue)}</td><td>${can.fmDone() ? `<button class="btn2 sm teal" data-done="${esc(t.id)}">Done</button>` : ''}</td></tr>`).join('') : ''; }).join('')}</table>
  ${!L.length ? '<div class="empty2">Nothing due in this window. Choose "All tasks" to see everything.</div>' : ''}` : '<div class="empty2">No maintenance tasks yet. Add them here, or import the starter maintenance plan from ☰ > Import register.</div>'}`;
  $('mQ').oninput = e => { F.q = e.target.value; maint(); $('mQ').focus(); $('mQ').setSelectionRange(F.q.length, F.q.length); };
  $('mW').onchange = e => { F.win = e.target.value; maint(); }; $('mC').onchange = e => { F.cat = e.target.value; maint(); }; $('mS').onchange = e => { F.sys = e.target.value; maint(); }; $('mR').onchange = e => { F.resp = e.target.value; maint(); };
  if ($('mNew')) $('mNew').onclick = () => editTask(null);
  if ($('mSch')) $('mSch').onclick = startSchedule; if ($('mSch2')) $('mSch2').onclick = startSchedule;
  $('mIcs').onclick = exportIcs; $('mX').onclick = exportFmRegister; $('mReg').onclick = () => { F.reg = true; maint(); };
  document.querySelectorAll('tr[data-id]').forEach(r => r.onclick = e => { if (e.target.closest('[data-done]')) return; editTask(fm().tasks.find(t => t.id === r.dataset.id)); });
  document.querySelectorAll('[data-done]').forEach(b => b.onclick = () => completeTask(fm().tasks.find(t => t.id === b.dataset.done)));
}
// The maintenance register: every task, grouped by building system, with what it protects and where it is required.
function regRows() {
  const q = F.q.toLowerCase();
  return fm().tasks.filter(t => (!F.sys || t.system === F.sys) && (!F.cat || t.category === F.cat) && (!q || [t.title, t.instructions, t.ss, t.responsible, t.standard].join(' ').toLowerCase().includes(q)))
    .sort((a, b) => natural(a.system || 'zz', b.system || 'zz') || natural(a.title, b.title))
    .map(t => { const a = fm().assets.find(x => x.id === t.assetId), req = DV.marksFor('task', t.id).map(DV.markLine);
      return { t, sys: t.system || 'No building system', cells: [t.title + (t.ss ? ' [' + t.ss + ']' : ''), freqText(t), t.responsible || '', t.standard || '', a ? a.element + (a.maint ? ' (warranty depends on this maintenance)' : '') : '', req.join('; '), t.nextDue ? nzDate(t.nextDue) : 'Not scheduled'] }; });
}
const REG_HEAD = ['Task', 'How often', 'Who does it', 'Standard / reference', 'Asset it protects', 'Where it is required', 'Next due'];
function maintRegister() {
  const R = regRows(); let last = '';
  $('fmView').innerHTML = `<div class="fbar"><h2>Maintenance register</h2><input type="search" id="mQ" placeholder="Search tasks…" value="${esc(F.q)}"><select id="mC"><option value="">All categories</option>${TASK_CATS.map(c => `<option ${c === F.cat ? 'selected' : ''}>${c}</option>`).join('')}</select><select id="mS">${sysOpts(F.sys, 1).replace('<option value=""></option>', '<option value="">All systems</option>')}</select>${QM}<button class="btn2" id="mBack">‹ Due dates</button><button class="btn2 go" id="mPrint">🖨 Print</button><button class="btn2" id="mX">⬇ Excel</button></div>
  <p class="muted small">${R.length} task${R.length === 1 ? '' : 's'}, grouped by building system. Following this schedule is what keeps the maintenance-dependent warranties valid.</p>
  ${R.length ? `<table class="ftable reg"><tr>${REG_HEAD.map(h => `<th>${h}</th>`).join('')}</tr>${R.map(r => { const g = r.sys !== last ? `<tr class="grp"><td colspan="7">${esc(r.sys)}</td></tr>` : ''; last = r.sys; return g + `<tr class="click" data-id="${esc(r.t.id)}">${r.cells.map((c, i) => `<td>${i === 0 ? '<b>' + esc(c) + '</b>' : esc(c)}</td>`).join('')}</tr>`; }).join('')}</table>` : '<div class="empty2">No maintenance tasks match.</div>'}`;
  $('mQ').oninput = e => { F.q = e.target.value; maint(); $('mQ').focus(); $('mQ').setSelectionRange(F.q.length, F.q.length); };
  $('mC').onchange = e => { F.cat = e.target.value; maint(); }; $('mS').onchange = e => { F.sys = e.target.value; maint(); };
  $('mBack').onclick = () => { F.reg = false; maint(); }; $('mX').onclick = exportFmRegister;
  $('mPrint').onclick = () => printRegister(R);
  document.querySelectorAll('tr[data-id]').forEach(r => r.onclick = () => editTask(fm().tasks.find(t => t.id === r.dataset.id)));
}
function printRegister(R) {
  const w = window.open('', '_blank'); if (!w) return toast('Allow pop-ups for this site to print the register', 6000);
  let last = '';
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(S.project.name)} - Maintenance register</title><style>body{font:11px/1.35 Calibri,Arial,sans-serif;color:#111;margin:14mm}h1{font-size:18px;color:#011C35;margin:0}p{color:#555;margin:2px 0 10px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:4px 6px;text-align:left;vertical-align:top}th{background:#011C35;color:#fff}tr.g td{background:#e8eef3;font-weight:700;color:#011C35}thead{display:table-header-group}tr{page-break-inside:avoid}@page{size:A4 landscape;margin:10mm}</style></head><body><h1>Maintenance register</h1><p>${esc(S.project.name)}${S.project.client ? ' · ' + esc(S.project.client) : ''} · printed ${nzDate(todayISO())} · ${R.length} tasks</p><table><thead><tr>${REG_HEAD.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${R.map(r => { const g = r.sys !== last ? `<tr class="g"><td colspan="7">${esc(r.sys)}</td></tr>` : ''; last = r.sys; return g + `<tr>${r.cells.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`; }).join('')}</tbody></table></body></html>`);
  w.document.close(); w.focus(); setTimeout(() => { try { w.print(); } catch (e) {} }, 400);
}
function editTask(t, preset) {
  const isNew = !t; t = t ? JSON.parse(JSON.stringify(t)) : { id: uid(), category: 'Planned maintenance', freqN: 12, freqUnit: 'months', system: F.sys || SYSTEMS[3], nextDue: '', responsible: '', ...(preset || {}) };
  const ro = !can.edit(), A = fm().assets.slice().sort((a, b) => natural(a.system, b.system));
  sheet(isNew ? 'New maintenance task' : t.title, `<div class="grid">
    ${field('Task', 'tT', t.title, 'placeholder="e.g. Clear gutters and downpipes"', true)}
    ${sel('Category', 'tC', opts(TASK_CATS, t.category))}${field('Specified system (if BWoF)', 'tSs', t.ss, 'placeholder="e.g. SS1/1" list="ssl"')}
    ${sel('Building system', 'tS', sysOpts(t.system), true)}
    ${sel('Asset (optional)', 'tA', '<option value="">(none)</option>' + A.map(a => `<option value="${esc(a.id)}" ${a.id === t.assetId ? 'selected' : ''}>${esc(sysShort(a.system) + ' · ' + a.element)}</option>`).join(''), true)}
    <label class="f">Every<input id="tN" type="number" min="0" value="${esc(t.freqN ?? '')}"></label>${sel('Unit', 'tU', Object.keys(UNITS).map(u => `<option value="${u}" ${u === t.freqUnit ? 'selected' : ''}>${u}</option>`).join(''))}
    ${field('Next due', 'tD', t.nextDue, 'type="date"')}${field('Responsible', 'tR', t.responsible, 'placeholder="e.g. Sprinkler contractor, IQP, Haumaru FM" list="respl"')}
    ${field('Standard / reference', 'tStd', t.standard, 'placeholder="e.g. NZS 4541:2020, O&M manual s4"', true)}
    ${area('Instructions', 'tI', t.instructions)}
  </div><datalist id="ssl">${fm().systems.map(s => `<option>${esc(s.ss)}</option>`).join('')}</datalist><datalist id="respl">${[...new Set(fm().tasks.map(x => x.responsible).filter(Boolean))].map(r => `<option>${esc(r)}</option>`).join('')}</datalist>
  <p class="note">Set "Every" to 0 for a one-off task. When a task is marked done, the next due date moves on by the frequency.</p>
  <h3 class="sec">Where this is required</h3>${reqHtml('task', t.id, 'No clause marked yet. In a contract, specification or manual, mark the clause that asks for this task and link it here.')}
  ${(t.history || []).length ? `<h3 class="sec">History</h3><div class="hist">${t.history.slice().reverse().map(h => `<div><b>${esc(nzDate(h.date || h.t))}</b> · ${esc(h.who)}: ${esc(h.notes || 'Done')}</div>`).join('')}</div>` : ''}`,
  { ro, onSave: async () => { const o = { ...t, title: val('tT'), category: val('tC'), ss: val('tSs'), system: val('tS'), assetId: val('tA'), freqN: +val('tN') || 0, freqUnit: val('tU'), nextDue: val('tD'), responsible: val('tR'), standard: val('tStd'), instructions: val('tI'), updated: nowISO(), updatedBy: S.user.email }; if (!o.title) { toast('Enter the task'); return false; } await S.store.saveItem(S.project.id, 'tasks', o); },
    onDelete: isNew ? null : () => S.store.deleteItem(S.project.id, 'tasks', t.id) });
  wireReq(() => { const x = fm().tasks.find(q => q.id === t.id); if (x) editTask(x); });
}
function completeTask(t) {
  if (!t) return;
  modal(`<h2>Mark done: ${esc(t.title)}</h2>
  <div class="grid"><label class="f">Date done<input type="date" id="cD" value="${todayISO()}"></label><label class="f">Next due<input type="date" id="cN" value="${t.freqN ? addFreq(todayISO(), t.freqN, t.freqUnit) : ''}"></label>
  <label class="f full">Notes<textarea id="cT" placeholder="What was done, by whom, anything found"></textarea></label>
  <label class="f full">Attach report / certificate (optional)<input type="file" id="cF" multiple></label></div>
  <div class="act"><button id="cX">Cancel</button><button class="go" id="cOk">Mark done</button></div>`);
  $('cD').onchange = () => { if (t.freqN) $('cN').value = addFreq($('cD').value, t.freqN, t.freqUnit); };
  $('cX').onclick = closeModal;
  $('cOk').onclick = async () => {
    const b = busy('Saving…');
    try {
      const files = [...$('cF').files]; const ids = files.length ? await uploadFiles(files, { system: t.system, type: t.ss ? 'Compliance (Form 12A / BWoF)' : 'Maintenance record', assetIds: t.assetId ? [t.assetId] : [], taskId: t.id, title: f => `${t.title} - ${$('cD').value} - ${f.name}` }) : [];
      await S.store.patchItem(S.project.id, 'tasks', t.id, { lastDone: $('cD').value, nextDue: $('cN').value, updated: nowISO(), updatedBy: S.user.email }, [{ t: nowISO(), date: $('cD').value, who: who(), notes: $('cT').value.trim(), docIds: ids }]);
      b.done(); closeModal(); toast('Recorded');
    } catch (e) { b.done(); toast('Could not save: ' + e.message, 6000); }
  };
}

/* ================================================================ COMPLIANCE (BWoF) */
function bwofYear() { const d = S.project.bwofDue; if (!d) return String(new Date().getFullYear()); return d.slice(0, 4); }
function comp() {
  const SY = fm().systems.slice().sort((a, b) => natural(a.ss, b.ss)), p = S.project, yr = bwofYear(), T = fm().tasks;
  const bw = p.bwofDue ? days(p.bwofDue) : null;
  $('fmView').innerHTML = `<div class="fbar"><h2>Compliance schedule and BWoF</h2><span class="sp"></span>${can.admin() ? '<button class="btn2" id="cKey">Key dates</button>' : ''}${can.edit() ? '<button class="btn2 go" id="cNew">+ Specified system</button>' : ''}<button class="btn2" id="cX">⬇ Excel</button></div>
  <div class="kpis">
    <div class="kpi" style="--c:${bw != null && bw < 60 ? '#d64545' : '#2f78c4'}"><b>${p.bwofDue ? nzDate(p.bwofDue) : 'Not set'}</b><span>Building warrant of fitness due${bw != null ? (bw < 0 ? ' (overdue)' : ` (in ${bw} days)`) : ''}</span></div>
    <div class="kpi"><b>${SY.filter(s => (s.cert12A || {})[yr]).length} / ${SY.length}</b><span>Form 12A certificates received for ${yr}</span></div>
    <div class="kpi"><b>${T.filter(t => t.ss && days(t.nextDue) < 0).length}</b><span>Compliance inspections overdue</span></div>
    <div class="kpi"><b>${esc(p.csNumber || '-')}</b><span>Compliance schedule${p.iqp ? ' · IQP ' + esc(p.iqp) : ''}</span></div>
  </div>
  <p class="note">Each year the owner signs the BWoF, supported by a Form 12A from the IQP for every specified system, and displays it in a public place. Record each 12A here when received.</p>
  ${SY.length ? `<table class="ftable"><tr><th>System</th><th>Description</th><th class="hm">Performance standard / inspections</th><th>Next inspection</th><th>Form 12A ${yr}</th></tr>
  ${SY.map(s => { const ts = T.filter(t => t.ss === s.ss).sort((a, b) => (a.nextDue || '9').localeCompare(b.nextDue || '9')); const c = (s.cert12A || {})[yr];
    return `<tr class="click" data-id="${esc(s.id)}"><td><b>${esc(s.ss)}</b></td><td>${esc(s.name)}<br><span class="muted small">${esc(s.location || '')}</span></td><td class="hm small">${esc(s.standard || '')}<br><span class="muted">${esc(s.inspections || '')}</span></td><td>${ts[0] ? dueBadge(ts[0].nextDue) + `<br><span class="muted small">${esc(ts[0].title)}</span>` : '<span class="muted small">No task</span>'}</td><td>${c ? `<span class="st st-ok">Received ${esc(nzDate(c.date))}</span>` : `<span class="st st-warn">Outstanding</span>`}${can.edit() || can.client() ? ` <button class="btn2 sm" data-12a="${esc(s.id)}">${c ? 'Update' : 'Record'}</button>` : ''}</td></tr>`; }).join('')}</table>` : '<div class="empty2">No specified systems yet. Add them from the compliance schedule (or the consent\'s AC1129 list), or import the starter list.</div>'}`;
  if ($('cKey')) $('cKey').onclick = keyDates; if ($('cNew')) $('cNew').onclick = () => editSystem(null);
  $('cX').onclick = exportFmRegister;
  document.querySelectorAll('tr[data-id]').forEach(r => r.onclick = e => { if (e.target.closest('[data-12a]')) return; editSystem(fm().systems.find(s => s.id === r.dataset.id)); });
  document.querySelectorAll('[data-12a]').forEach(b => b.onclick = () => record12A(fm().systems.find(s => s.id === b.dataset['12a']), yr));
}
function editSystem(s) {
  const isNew = !s; s = s ? JSON.parse(JSON.stringify(s)) : { id: uid(), ss: '', name: '', cert12A: {} };
  sheet(isNew ? 'New specified system' : s.ss + ' ' + s.name, `<div class="grid">
    ${field('Specified system no.', 'yS', s.ss, 'placeholder="e.g. SS1/1"')}${field('Description', 'yN', s.name, 'placeholder="e.g. Automatic sprinkler system"')}
    ${field('Location', 'yL', s.location, '', true)}${field('Performance standard', 'yP', s.standard, 'placeholder="e.g. NZS 4541:2020"', true)}
    ${area('Inspection, maintenance and reporting procedures', 'yI', s.inspections)}
  </div><h3 class="sec">Form 12A history</h3><div class="hist">${Object.entries(s.cert12A || {}).sort().reverse().map(([y, c]) => `<div><b>${esc(y)}</b> · received ${esc(nzDate(c.date))}${c.by ? ' from ' + esc(c.by) : ''}</div>`).join('') || '<div>None recorded.</div>'}</div>
  ${!isNew && can.edit() ? '<p><button class="mini" id="yT">+ Inspection task for this system</button></p>' : ''}`,
  { ro: !can.edit(), onSave: async () => { const o = { ...s, ss: val('yS'), name: val('yN'), location: val('yL'), standard: val('yP'), inspections: val('yI'), updated: nowISO() }; if (!o.ss) { toast('Enter the system number'); return false; } await S.store.saveItem(S.project.id, 'systems', o); },
    onDelete: isNew ? null : () => S.store.deleteItem(S.project.id, 'systems', s.id) });
  if ($('yT')) $('yT').onclick = () => { closeSheet(); editTask(null, { ss: s.ss, category: 'Compliance (BWoF)', system: '14 Compliance Schedule & BWoF', title: s.ss + ' ' + s.name + ' - inspection', standard: s.standard, responsible: S.project.iqp || 'IQP', freqN: 1, freqUnit: 'months' }); };
}
function record12A(s, yr) {
  modal(`<h2>Form 12A: ${esc(s.ss)} ${esc(s.name)}</h2><div class="grid"><label class="f">BWoF year<input id="qY" value="${esc(yr)}"></label><label class="f">Date of 12A<input type="date" id="qD" value="${todayISO()}"></label><label class="f full">Issued by (IQP)<input id="qB" value="${esc(S.project.iqp || '')}"></label><label class="f full">Attach the Form 12A (optional)<input type="file" id="qF"></label></div><div class="act"><button id="qX">Cancel</button><button class="go" id="qOk">Save</button></div>`);
  $('qX').onclick = closeModal;
  $('qOk').onclick = async () => { const b = busy('Saving…'); try { const f = $('qF').files[0]; const ids = f ? await uploadFiles([f], { system: '14 Compliance Schedule & BWoF', type: 'Compliance (Form 12A / BWoF)', title: () => `Form 12A - ${s.ss} ${s.name} - ${$('qY').value}` }) : []; const c = { ...(s.cert12A || {}) }; c[$('qY').value] = { date: $('qD').value, by: $('qB').value.trim(), docId: ids[0] || '' }; await S.store.patchItem(S.project.id, 'systems', s.id, { cert12A: c }); b.done(); closeModal(); toast('12A recorded'); } catch (e) { b.done(); toast(e.message, 6000); } };
}

/* ================================================================ DOCUMENTS */
// Read documents with AI, one after another. Warranties and deeds first: they are what practical completion waits on.
let aiStop = false;
window.addEventListener('rd-marked-pdf', e => { const d = fm().docs.find(x => x.id === e.detail); if (d) Sub.markedPdf(d); });
window.addEventListener('rd-ai-read', async e => { const d = fm().docs.find(x => x.id === e.detail); if (!d) return; const b = busy('Reading with AI…');
  try { const r = await AI.readDoc(d, t => b.set('Reading with AI: ' + t)); b.done(); toast(`${r.marks.length} boxes drawn${r.problems.length ? ', ' + r.problems.length + ' problem' + (r.problems.length > 1 ? 's' : '') + ' found' : ''}. Check them.`, 6000); const nd = fm().docs.find(x => x.id === d.id) || d; DV.open({ ...nd }, {}); }
  catch (x) { b.done(); toast(x.message === 'nokey' ? 'Set up the AI helper first (Menu > AI).' : 'Could not read it: ' + x.message, 7000); } });
function aiReadDialog() {
  const P = fm().docs.filter(d => DV.isPdf(d) && d.size), unread = P.filter(d => !d.aiRead), w = unread.filter(AI.isWarranty), shown = F.q || F.sys || F.type ? P.filter(d => (!F.sys || d.system === F.sys) && (!F.type || d.type === F.type) && (!F.q || [d.title, d.party, d.type].join(' ').toLowerCase().includes(F.q.toLowerCase()))) : [];
  modal(`<h2>✨ Read documents with AI</h2><p class="note">The AI reads each document, draws a box around the parties, period, dates, signatures and conditions, links them to the asset register, and flags anything that needs correcting. Every box is marked "to check" until you accept it. Boxes you drew or accepted yourself are never changed.</p>
    <div class="btnlist"><button id="arW">Warranties, deeds and guarantees not yet read<small>${w.length} document${w.length === 1 ? '' : 's'}. Start here.</small></button>
    <button id="arA">Every PDF not yet read<small>${unread.length} documents. Takes longer and uses more AI credit.</small></button>
    ${shown.length ? `<button id="arS">The ${shown.length} PDF${shown.length === 1 ? '' : 's'} in the current search or filter<small>Reads them again even if already read</small></button>` : ''}</div>
    <p class="note" id="arSt"></p><div class="act"><button id="arX">Close</button><button id="arStop" class="warn" style="display:none">Stop</button></div>`);
  const run = async list => { if (!list.length) return toast('Nothing to read'); aiStop = false; document.querySelectorAll('#mbox .btnlist button').forEach(b => b.disabled = true); $('arStop').style.display = '';
    let ok = 0, prob = 0; const bad = [];
    for (const [i, d] of list.entries()) { if (aiStop) break; const st = t => { if ($('arSt')) $('arSt').textContent = `${i + 1} of ${list.length}: ${d.title} (${t})`; };
      try { st('opening'); const r = await AI.readDoc(d, st); ok++; if (r.problems.length) prob++; }
      catch (e) { console.warn('ai read', d.title, e); bad.push(d.title + ': ' + (e.message === 'nokey' ? 'the AI helper is not set up' : e.message)); if (e.message === 'nokey' || e.message === 'offline' || bad.length >= 5 && !ok) break; } }
    if ($('arSt')) $('arSt').innerHTML = `<b>Finished.</b> ${ok} read, ${prob} with problems${bad.length ? ', ' + bad.length + ' could not be read:<br>' + bad.slice(0, 6).map(esc).join('<br>') : ''}. Open "To check" to review them.`; if ($('arStop')) $('arStop').style.display = 'none'; F.chk = true; };
  $('arW').onclick = () => run(w); $('arA').onclick = () => run(unread); if ($('arS')) $('arS').onclick = () => run(shown);
  $('arStop').onclick = () => { aiStop = true; $('arStop').textContent = 'Stopping after this one…'; }; $('arX').onclick = () => { aiStop = true; closeModal(); };
}
// Only these types belong to one element (and need linking to it); everything else is filed by building system
const needsEl = d => /warrant|o&m|care and maintenance|product data|as-built|bond/i.test(d.type || '');
const needLink = d => needsEl(d) && !(d.assetIds || []).length && !d.template && !d.superseded && !d.link;
function docs() {
  const Dd = fm().docs.slice().sort((a, b) => natural(a.system || 'zz', b.system || 'zz') || natural(a.title, b.title)), q = F.q.toLowerCase();
  // a search also looks inside the boxes marked in each document; results are ranked by how much the document matters
  const words = q.split(/\s+/).filter(Boolean), hay = d => [d.title, d.party, d.type, d.srcPath, d.aiSummary, ...(d.aiProblems || [])].join(' ').toLowerCase(), mhay = m => [m.kind, m.period, m.clause, m.text, m.note, m.flag].join(' ').toLowerCase();
  const hitMarks = d => words.length ? (d.marks || []).filter(m => words.every(w => mhay(m).includes(w))) : [];
  const RANK = [/contract|consent/i, /warrant/i, /producer|certificate|commission|inspection/i, /o&m|care/i];
  const rank = d => { const i = RANK.findIndex(r => r.test(d.type || '')); return i < 0 ? RANK.length : i; };
  let L = Dd.filter(d => (!F.sys || d.system === F.sys) && (!F.type || d.type === F.type) && (F.tpl ? d.template : !d.template) && (!F.chk || AI.needsCheck(d)) && (!F.nl || needLink(d)) && (!q || words.every(w => hay(d).includes(w)) || hitMarks(d).length));
  if (q) L = L.map(d => ({ d, k: rank(d) - (hitMarks(d).length ? 0.5 : 0) })).sort((a, b) => a.k - b.k || natural(a.d.title, b.d.title)).map(x => x.d);
  const nChk = Dd.filter(AI.needsCheck).length, nProb = Dd.filter(d => (d.aiProblems || []).length).length, nWait = Dd.filter(d => d.restoreSrc).length;
  let last = '';
  $('fmView').innerHTML = `${nWait && can.admin() ? `<div class="fmwarn"><b>${nWait} document${nWait === 1 ? ' is' : 's are'} waiting for ${nWait === 1 ? 'its file' : 'their files'}</b> (this project was restored from a handover pack). Pick the pack's main folder, the one with "Open me first.html" in it, and each file is matched to its record. <button class="btn2 go sm" id="dRe">Re-attach files from the pack</button><input type="file" id="fRe" webkitdirectory multiple hidden></div>` : ''}<div class="fbar"><h2>Documents</h2><input type="search" id="dQ" placeholder="Search documents…" value="${esc(F.q)}"><select id="dS">${sysOpts(F.sys, 1).replace('<option value=""></option>', '<option value="">All systems</option>')}</select>${QM}<select id="dT"><option value="">All types</option>${DOC_TYPES.map(t => `<option ${t === F.type ? 'selected' : ''}>${t}</option>`).join('')}</select>${can.write() || can.client() ? '<button class="btn2 go" id="dUp">⬆ Upload files</button>' : ''}${can.edit() ? '<button class="btn2" id="dFold">🗂 Upload handover folder</button><button class="btn2" id="dDup" title="Find documents that are in the library more than once and remove the extra copies">🧹 Remove duplicates</button><button class="btn2" id="dLink">🔗 Add link</button>' : ''}${can.admin() ? `<button class="btn2" id="dRs" title="Credentials, bonds, guarantees and insurances: only admins and the people you list can open them">🔒 Restricted (${fm().docs.filter(d => d.restricted).length})</button>` : ''}<button class="btn2" id="dFind" title="Search the contract and specification in plain words">🔎 Find a clause</button><button class="btn2" id="dX">⬇ Index (Excel)</button>${can.edit() ? '<button class="btn2" id="dAi">✨ Read with AI</button>' : ''}</div>
  <div class="atab"><button id="dChk0" class="${F.chk || F.tpl || F.nl ? '' : 'on'}">All documents</button><button id="dNl" class="${F.nl ? 'on' : ''}" title="Warranties, O&M manuals, care guides, product data and as-builts not yet linked to an element. Everything else is filed by building system.">Needs linking (${Dd.filter(needLink).length})</button><button id="dChk1" class="${F.chk ? 'on' : ''}">To check (${nChk})${nProb ? ' · ' + nProb + ' with problems' : ''}</button><button id="dTpl" class="${F.tpl ? 'on' : ''}" title="Blank forms for the project team. Never included in the handover export.">📋 Templates and blank forms (${fm().docs.filter(d => d.template).length})</button></div>${F.tpl ? '<p class="note">Blank forms for the project team to send out. Open one and press <b>Mark</b> to box what has to be filled in, then <b>⬇ With markup</b> gives a copy with those boxes and instructions. Templates are never included in the handover export.</p>' : ''}
  <p class="muted small">${L.length} of ${Dd.length} documents${q ? ' · most important first; matching boxes are listed under each document' : ''}</p>
  ${L.length ? `<table class="ftable"><tr><th>Document</th><th>Type</th><th class="hm">From</th><th class="hm">Expiry</th><th class="hm">Linked to</th><th></th></tr>
  ${L.map(d => { const g = !q && (d.system || '') !== last ? `<tr class="grp"><td colspan="6">${esc(d.system || 'Unsorted')}</td></tr>` : ''; last = d.system || ''; const hm = hitMarks(d).slice(0, 4), pc = AI.pendingCount(d), np = (d.aiProblems || []).length; const al = (d.assetIds || []).map(id => fm().assets.find(a => a.id === id)).filter(Boolean);
    return g + `<tr class="click" data-id="${esc(d.id)}"><td><b>${esc(d.title)}</b>${d.restricted ? ' <span class="st st-bad" title="Only admins and the people listed under Restricted can open it">🔒 Restricted</span>' : ''}${d.url && !d.link && !d.size ? ' <span class="st" style="background:#fde2e2;color:#a32222">empty file: upload again</span>' : ''}${d.link ? ' <span class="st st-info">link</span>' : ''}${(d.marks || []).length ? ` <span class="st st-info" title="Clauses marked in this document">▭ ${d.marks.length}</span>` : ''}${np ? ` <span class="st st-bad" title="${esc(d.aiProblems.join(' | '))}">⚠ ${np} problem${np > 1 ? 's' : ''}</span>` : ''}${pc ? ` <span class="st st-warn">✨ ${pc} to check</span>` : d.aiRead ? ' <span class="st st-ok" title="Read by AI and checked">✨ read</span>' : ''}${d.size ? ` <span class="muted small">${(d.size / 1e6).toFixed(1)} MB</span>` : ''}${F.chk && np ? '<br><span class="small" style="color:#a32222">' + d.aiProblems.map(esc).join('<br>') + '</span>' : ''}${hm.map(m => `<br><a href="#" class="small" data-mk="${esc(d.id)}|${esc(m.id)}">▭ p. ${m.page}: ${esc((m.period || m.text || m.kind || '').slice(0, 110))}</a>`).join('')}</td><td class="small">${esc(d.type || '')}</td><td class="hm">${esc(d.party || '')}</td><td class="hm">${d.expiry ? dueBadge(d.expiry) : ''}</td><td class="hm small">${al.length ? al.map(a => esc(a.element)).join(', ') : needsEl(d) ? '<span class="st st-warn">Needs linking</span>' : `<span class="muted">Filed under ${esc(String(d.system || 'no system').slice(0, 32))}</span>`}</td><td><button class="btn2 sm" data-open="${esc(d.id)}">${DV.isPdf(d) ? 'View' : 'Open'}</button></td></tr>`; }).join('')}</table>` : `<div class="empty2">${Dd.length ? 'No documents match.' : 'No documents yet. Upload the handover pack folder to bring everything in at once, filed by system and type.'}</div>`}`;
  $('dQ').oninput = e => { F.q = e.target.value; docs(); $('dQ').focus(); $('dQ').setSelectionRange(F.q.length, F.q.length); };
  $('dS').onchange = e => { F.sys = e.target.value; docs(); }; $('dT').onchange = e => { F.type = e.target.value; docs(); };
  if ($('dUp')) $('dUp').onclick = () => pickDocs({ system: F.sys });
  if ($('dRe')) { $('dRe').onclick = () => $('fRe').click(); $('fRe').onchange = async e => { const fs = [...e.target.files]; e.target.value = ''; if (!fs.length) return; const R = await import('./restore.js'); await R.reattach(fs, { docs: () => fm().docs, confirm: confirmBox, busy }); }; }
  if ($('dFold')) $('dFold').onclick = () => $('fFolder').click();
  if ($('dDup')) $('dDup').onclick = removeDuplicates;
  if ($('dLink')) $('dLink').onclick = () => editDoc(null);
  $('dFind').onclick = () => DV.findClause({}); if ($('dRs')) $('dRs').onclick = restrictDialog;
  $('dChk0').onclick = () => { F.chk = false; F.tpl = false; F.nl = false; docs(); }; $('dChk1').onclick = () => { F.chk = true; F.tpl = false; F.nl = false; docs(); }; $('dTpl').onclick = () => { F.tpl = true; F.chk = false; F.nl = false; docs(); }; $('dNl').onclick = () => { F.nl = true; F.chk = false; F.tpl = false; docs(); };
  if ($('dAi')) $('dAi').onclick = aiReadDialog;
  document.querySelectorAll('[data-mk]').forEach(a => a.onclick = e => { e.preventDefault(); e.stopPropagation(); const [id, mk] = a.dataset.mk.split('|'), d = fm().docs.find(x => x.id === id); if (d) DV.open(d, { markId: mk }); });
  $('dX').onclick = exportFmRegister;
  document.querySelectorAll('tr[data-id]').forEach(r => r.onclick = e => { if (e.target.closest('[data-open]')) return; editDoc(fm().docs.find(d => d.id === r.dataset.id)); });
  document.querySelectorAll('[data-open]').forEach(b => b.onclick = () => openDoc(fm().docs.find(d => d.id === b.dataset.open)));
}
async function openDoc(d, opts) { if (!d) return; if (DV.isPdf(d)) return DV.open(d, opts || {}); const u = d.link || (d.url ? await S.store.resolveUrl(d.url) : ''); if (u) window.open(u, '_blank', 'noopener'); else toast('No file for this document'); }
function editDoc(d) {
  const isNew = !d; d = d ? JSON.parse(JSON.stringify(d)) : { id: uid(), type: 'Other', system: F.sys || '', assetIds: [], link: '' };
  const A = fm().assets.slice().sort((a, b) => natural(a.system, b.system)); const ro = !can.edit();
  const chips = () => (d.assetIds || []).map(id => { const a = A.find(x => x.id === id); return a ? `<span class="chip">${esc(a.element)}${ro ? '' : `<button data-rm="${esc(id)}">✕</button>`}</span>` : ''; }).join('') || '<span class="muted small">Not linked</span>';
  sheet(isNew ? 'Add a link' : d.title, `<div class="grid">
    ${field('Title', 'oT', d.title, '', true)}
    ${sel('Type', 'oY', opts(DOC_TYPES, d.type))}${sel('Building system', 'oS', sysOpts(d.system, 1))}
    ${field('From (company)', 'oP', d.party)}${field('Issued', 'oI', d.issued, 'type="date"')}
    <div class="opt full"><input type="checkbox" id="oTpl" ${d.template ? 'checked' : ''}><label for="oTpl">Template or blank form (for the project team; never in the handover export)</label></div>
    ${can.admin() && !isNew && d.url ? `<div class="opt full"><input type="checkbox" id="oRs" ${d.restricted ? 'checked' : ''}><label for="oRs">🔒 Restricted: only admins${(S.project.restrictedTo || []).length ? ' and ' + esc(S.project.restrictedTo.join(', ')) : ''} can open it. Contractors and consultants never see it.</label></div>` : ''}
    ${field('Expiry (if any)', 'oE', d.expiry, 'type="date"')}${sel('Audience', 'oA', opts(['FM', 'Home user', 'Both'], d.audience || 'FM'))}
    ${/warrant|deed/i.test(d.type || '') ? `<p class="note full">Leave Expiry blank for a warranty that runs from practical completion. Its expiry is worked out on the linked asset from the PC date and the warranty period, and fills in automatically once PC is ${pcDate() ? 'set (currently ' + esc(nzDate(pcDate())) + ')' : 'certified and the date is entered under Dashboard > Key dates'}. Only enter a date here if one is printed on the document.</p>` : ''}
    ${d.url ? `<p class="full"><button class="btn2 go" id="oView">${DV.isPdf(d) ? '👁 View the document' : '↗ Open the file'}</button></p><p class="full small muted">File: ${esc(d.fileName || '')} ${d.size ? '(' + (d.size / 1e6).toFixed(1) + ' MB)' : ''}${d.srcPath ? '<br>From: ' + esc(d.srcPath) : ''}</p>` : field('Link (SharePoint, Procore or any web address)', 'oL', d.link, 'placeholder="https://…"', true)}
    ${(d.prevFiles || []).length && !ro ? `<p class="full small muted">Earlier file kept: ${esc(d.prevFiles[d.prevFiles.length - 1].why || 'before a change')} (${esc(nzDate(String(d.prevFiles[d.prevFiles.length - 1].at || '').slice(0, 10)))}). <button class="mini" id="oPrev">↩ Put it back</button></p>` : ''}
  </div><h3 class="sec">Linked assets</h3><div class="chips" id="oC">${chips()}</div>
  ${ro ? '' : `<label class="f" style="margin-top:8px">Link to an asset<select id="oAdd"><option value="">Choose…</option>${A.map(a => `<option value="${esc(a.id)}">${esc(sysShort(a.system) + ' · ' + a.element)}</option>`).join('')}</select></label>`}`,
  { ro, onSave: async () => { const o = { ...d, title: val('oT'), type: val('oY'), system: val('oS'), party: val('oP'), issued: val('oI'), expiry: val('oE'), audience: val('oA'), template: !!($('oTpl') && $('oTpl').checked), updated: nowISO() }; if ($('oL')) o.link = val('oL'); if (!o.title) { toast('Enter a title'); return false; } if (isNew) { o.created = nowISO(); o.createdBy = S.user.email; } const rsOn = $('oRs') ? $('oRs').checked : !!d.restricted; delete o.restricted; await S.store.saveItem(S.project.id, 'docs', o);
      if (rsOn !== !!d.restricted) { const b = busy(rsOn ? 'Moving it to the restricted folder…' : 'Opening it up…'); try { await setRestricted({ ...o, restricted: !!d.restricted }, rsOn); b.done(); toast(rsOn ? 'Restricted' : 'No longer restricted'); } catch (e) { b.done(); toast('Could not change: ' + e.message, 7000); } }
      if (o.assetIds && o.assetIds.length) for (const id of o.assetIds) { const a = fm().assets.find(x => x.id === id); if (a && a.status === 'Not received') await S.store.patchItem(S.project.id, 'assets', id, { status: 'Partial' }); } },
    onDelete: isNew ? null : async () => { await S.store.deleteItem(S.project.id, 'docs', d.id); if (d.path) S.store.deleteFile(d.path); } });
  if ($('oView')) $('oView').onclick = async () => { const cur = fm().docs.find(x => x.id === d.id) || d; if (!DV.isPdf(cur)) return openDoc(cur); await tryCloseSheet(); if ($('sheet2').classList.contains('show')) return; DV.open(cur, { ret: () => { const x = fm().docs.find(q => q.id === d.id); if (x) editDoc(x); } }); };
  if ($('oPrev')) $('oPrev').onclick = async () => { const P = d.prevFiles.slice(), last = P.pop(); if (!(await confirmBox('Put back the earlier file? The current file stays in storage but is no longer shown.', 'Put it back'))) return;
    const patch = { url: last.url, path: last.path, size: last.size, prevFiles: P, ...(last.marks ? { marks: last.marks } : {}), textIdx: null }; await S.store.patchItem(S.project.id, 'docs', d.id, patch); closeSheet(); toast('The earlier file is back'); };
  const wireChips = () => document.querySelectorAll('#oC [data-rm]').forEach(b => b.onclick = () => { d.assetIds = d.assetIds.filter(x => x !== b.dataset.rm); $('oC').innerHTML = chips(); wireChips(); });
  wireChips(); if ($('oAdd')) $('oAdd').onchange = e => { if (e.target.value && !d.assetIds.includes(e.target.value)) d.assetIds.push(e.target.value); e.target.value = ''; $('oC').innerHTML = chips(); wireChips(); };
}

/* ================================================================ RESTRICTED DOCUMENTS */
// Credentials, bonds, guarantees and insurances live in their own collection (rdocs) and storage folder (restricted/), which only
// admins and the addresses or email domains in the project's restrictedTo can read. Moving a document uploads its file to the
// restricted folder and deletes the old copy, so any link to the old copy stops working.
let RIDS = new Set();
const RESTRICT_RX = /cctv access|password|passcode|credential|log ?in details|access codes?\b|alarm codes?\b|\bbonds?\b|bank guarantee|parent company guarantee|performance guarantee|insurances?\b|indemnity|surety/i;
export async function setRestricted(d, on) {
  const pid = S.project.id, rec = { ...d }; delete rec.restricted;
  if (d.path && d.url && !d.link) { const bytes = await X.getBytes(d.url); const np = `projects/${pid}/${on ? 'restricted' : 'docs'}/${d.id}/${safeName(d.fileName || 'file')}`;
    rec.url = await S.store.putFile(np, new Blob([bytes], { type: d.mime || 'application/octet-stream' }), true); rec.path = np; }
  if (on) { rec.restrictedAt = nowISO(); rec.restrictedBy = S.user.email; await S.store.saveItem(pid, 'rdocs', rec); await S.store.deleteItem(pid, 'docs', d.id); RIDS.add(d.id); }
  else { RIDS.delete(d.id); delete rec.restrictedAt; delete rec.restrictedBy; await S.store.saveItem(pid, 'docs', rec); await S.store.deleteItem(pid, 'rdocs', d.id); }
  if (d.path && d.path !== rec.path) { try { await S.store.deleteFile(d.path); } catch (e) {} }
}
export function restrictDialog() {
  if (!can.admin()) return;
  const D = fm().docs.filter(d => !d.template), cur = D.filter(d => d.restricted), cand = D.filter(d => !d.restricted && RESTRICT_RX.test([d.title, d.fileName, d.type].join(' ')));
  const row = (d, on, note) => `<label class="opt"><input type="checkbox" data-rs="${esc(d.id)}" ${on ? 'checked' : ''}> <span><b>${esc(d.title)}</b> <span class="muted small">${esc(d.type || '')}${note ? ' · ' + note : ''}</span></span></label>`;
  modal(`<h2>🔒 Restricted documents</h2><p>Only project admins and the people or email domains listed below can open restricted documents. Contractors and consultants never see them. In the handover pack they go into a separate Restricted folder.</p>
  <label class="f">Also allowed to open them (email domains or addresses, separated by commas)<input id="rsTo" value="${esc((S.project.restrictedTo || []).join(', '))}" placeholder="e.g. clientcompany.co.nz"></label>
  ${cur.length ? `<h3 class="sec">Restricted now (${cur.length})</h3><p class="note">Untick one to open it up again.</p>${cur.map(d => row(d, true)).join('')}` : ''}
  <h3 class="sec">Suggested from their names (${cand.length})</h3>${cand.length ? '<p class="note">Credentials, bonds, guarantees and insurances. Untick anything that should stay open to the project team.</p>' + cand.map(d => row(d, true, d.submitted ? 'submitted by the contractor, who will no longer see it' : '')).join('') : '<p class="muted">Nothing else found. Open any document and tick Restricted to add it.</p>'}
  <p class="note">Moving a document uploads its file to a locked folder and deletes the old copy, so any old link to it stops working.</p>
  <div class="act"><button id="rsX">Cancel</button><button class="go" id="rsGo">Apply</button></div>`, true);
  $('rsX').onclick = closeModal;
  $('rsGo').onclick = async () => {
    const to = [...new Set($('rsTo').value.split(/[,;\s]+/).map(x => x.trim().toLowerCase().replace(/^@/, '')).filter(x => /^[^@\s]+@[^@\s]+\.[^@\s]+$|^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(x)))];
    const want = {}; document.querySelectorAll('[data-rs]').forEach(c => want[c.dataset.rs] = c.checked);
    const jobs = D.filter(d => d.id in want && want[d.id] !== !!d.restricted); closeModal(); const b = busy('Saving…'), fail = []; let n = 0;
    try { if (to.join(',') !== (S.project.restrictedTo || []).join(',')) { await S.store.updateProject(S.project.id, { restrictedTo: to }); S.project.restrictedTo = to; }
      for (const d of jobs) { b.set(`${want[d.id] ? 'Restricting' : 'Opening up'} ${++n} of ${jobs.length}: ${d.title}`); try { await setRestricted(d, want[d.id]); } catch (e) { fail.push(d.title + ': ' + e.message); } }
      b.done(); toast(fail.length ? `${jobs.length - fail.length} changed. Could not change: ${fail.join('; ')}` : `${jobs.length} document${jobs.length === 1 ? '' : 's'} changed`, fail.length ? 12000 : 4000); render();
    } catch (e) { b.done(); toast('Could not save: ' + e.message, 8000); }
  };
}

/* ================================================================ CONTACTS DIRECTORY */
// One line per company, built from the documents received (the name before the first " - " in each file name) and the assets they relate to.
// Phone numbers and email addresses are read from the documents themselves and offered as suggestions to confirm.
const CO_SKIP = ['ltd', 'limited', 'nz', 'new', 'zealand', 'auckland', 'group', 'the', 'co', 'company', 'for', 'and'];
const coKey = n => String(n || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9+& ]/g, ' ').split(/\s+/).filter(x => x && !CO_SKIP.includes(x)).slice(0, 2).join(' ');
function directory() {
  const saved = S.project.directory || [], map = new Map();
  const get = name => { const k = coKey(name); if (!k) return null; if (!map.has(k)) map.set(k, { key: k, company: String(name).replace(/\s*\(.*?\)\s*/g, ' ').trim(), systems: new Set(), docs: [], emails: {}, phones: {}, assets: [], saved: null }); return map.get(k); };
  for (const d of fm().docs) { if (!d.party) continue; const c = get(d.party); if (!c) continue; if (d.system) c.systems.add(d.system); c.docs.push(d); ((d.found || {}).e || []).forEach(e => c.emails[e] = (c.emails[e] || 0) + 1); ((d.found || {}).p || []).forEach(x => c.phones[x] = (c.phones[x] || 0) + 1); }
  for (const sv of saved) { const c = get(sv.company); if (c) { c.saved = sv; c.company = sv.company; } }
  for (const c of map.values()) { const w = c.key.split(' ')[0]; if (w.length >= 3) c.assets = fm().assets.filter(a => [a.installer, a.product].join(' ').toLowerCase().includes(w));
    const words = c.key.split(' ').filter(x => x.length >= 4), own = e => words.some(x => e.split('@')[1].replace(/[^a-z]/g, '').includes(x.replace(/[^a-z]/g, '')));
    c.emailList = Object.keys(c.emails).sort((a, b) => (own(b) - own(a)) || c.emails[b] - c.emails[a]); c.emailOwn = c.emailList.length && own(c.emailList[0]);
    c.phoneList = Object.keys(c.phones).sort((a, b) => c.phones[b] - c.phones[a]);
    c.work = c.assets.length ? [...new Set(c.assets.map(a => a.element))].slice(0, 3).join('; ') : [...c.systems].map(x => x.slice(3)).slice(0, 2).join('; '); }
  return [...map.values()].sort((a, b) => natural(a.company, b.company));
}
const nameFromEmail = e => { const l = String(e || '').split('@')[0]; return /^(info|admin|sales|contracts|accounts|office|service|support|enquiries|hello|auckland)/i.test(l) ? '' : l.split(/[._-]/).filter(x => /^[a-z]+$/i.test(x)).map(x => x[0].toUpperCase() + x.slice(1)).join(' '); };
function contactsView() {
  const D = directory(), q = F.q.toLowerCase(), L = D.filter(c => !q || [c.company, c.work, (c.saved || {}).name, (c.saved || {}).trade].join(' ').toLowerCase().includes(q));
  const unread = fm().docs.filter(d => DV.isPdf(d) && d.party && !d.found).length;
  $('fmView').innerHTML = `<div class="fbar"><h2>Contacts</h2><input type="search" id="cQ" placeholder="Search company, trade, name…" value="${esc(F.q)}">${can.edit() ? `<button class="btn2 go" id="cNew">+ Contact</button>${unread ? `<button class="btn2" id="cRead" title="Reads the first pages of each document for phone numbers and email addresses">🔍 Read contact details from ${unread} document${unread === 1 ? '' : 's'}</button>` : ''}` : ''}</div>
  <p class="muted small">${D.length} compan${D.length === 1 ? 'y' : 'ies'} found from the documents received · ${D.filter(c => c.saved).length} confirmed. Suggested details come from the documents and need a quick check before they are relied on.</p>
  ${L.length ? `<table class="ftable"><tr><th>Company</th><th class="hm">What they did</th><th>Contact</th><th>Phone</th><th class="hm">Email</th><th class="hm">Docs</th><th></th></tr>${L.map(c => { const sv = c.saved || {}, sug = !c.saved;
    return `<tr class="click" data-k="${esc(c.key)}"><td><b>${esc(c.company)}</b></td><td class="hm small">${esc(sv.trade || c.work || '')}</td><td>${esc(sv.name || '')}${sug && c.emailOwn && nameFromEmail(c.emailList[0]) ? `<span class="muted">${esc(nameFromEmail(c.emailList[0]))}</span>` : ''}</td><td>${esc(sv.phone || '')}${sug && c.phoneList[0] ? `<span class="muted">${esc(c.phoneList[0])}</span>` : ''}</td><td class="hm small">${esc(sv.email || '')}${sug && c.emailList[0] ? `<span class="muted">${esc(c.emailList[0])}</span>` : ''}</td><td class="hm">${c.docs.length || '-'}</td><td>${c.saved ? '<span class="st st-ok">Confirmed</span>' : '<span class="st st-grey">Suggested</span>'}</td></tr>`; }).join('')}</table>` : `<div class="empty2">${D.length ? 'No contacts match.' : 'No companies yet. They appear here as documents are uploaded: the company is the name before the first " - " in each file name.'}</div>`}`;
  $('cQ').oninput = e => { F.q = e.target.value; contactsView(); $('cQ').focus(); $('cQ').setSelectionRange(F.q.length, F.q.length); };
  if ($('cNew')) $('cNew').onclick = () => editContact(null);
  if ($('cRead')) $('cRead').onclick = readContacts;
  document.querySelectorAll('tr[data-k]').forEach(r => r.onclick = () => editContact(D.find(c => c.key === r.dataset.k)));
}
function editContact(c) {
  const isNew = !c; c = c || { key: '', company: '', docs: [], assets: [], emailList: [], phoneList: [], work: '', saved: null };
  const sv = c.saved || {}, ro = !can.edit();
  sheet(isNew ? 'New contact' : c.company, `<div class="grid">
    ${field('Company (as you know it)', 'kC', sv.company || c.company)}${sel('Role', 'kR', opts(['Subcontractor', 'Supplier', 'Consultant', 'Contractor', 'Client', 'Other'], sv.role || 'Subcontractor'))}
    ${field('Full registered name (used on deeds)', 'kL', sv.legal || '', 'placeholder="e.g. Triden Construction Limited"', true)}
    ${field('Company number or NZBN', 'kZ', sv.nzbn || '')}${field('Address', 'kAd', sv.address || '')}
    ${field('Trade or what they did', 'kT', sv.trade || c.work, 'placeholder="e.g. Plumbing; hot water cylinders"', true)}
    ${field('Contact person', 'kN', sv.name || (c.emailOwn ? nameFromEmail(c.emailList[0]) : ''))}${field('Phone', 'kP', sv.phone || c.phoneList[0] || '', 'list="kPl"')}
    ${field('Email', 'kE', sv.email || c.emailList[0] || '', 'list="kEl"', true)}
    ${sel('Shown in', 'kA', opts(['FM', 'Both', 'Not shown'], sv.audience || 'FM'))}${field('After-hours phone', 'kH', sv.afterHours)}
    ${area('Notes', 'kO', sv.notes)}
  </div><datalist id="kPl">${c.phoneList.map(x => `<option>${esc(x)}</option>`).join('')}</datalist><datalist id="kEl">${c.emailList.map(x => `<option>${esc(x)}</option>`).join('')}</datalist>
  ${!c.saved && (c.emailList.length || c.phoneList.length) ? '<p class="note">The phone and email were read from this company\'s documents. Other numbers and addresses found are offered when you click in the box. Check them, then Save to confirm.</p>' : ''}
  <h3 class="sec">Elements this company did <span class="muted small">(warranties from them are matched to these first)</span></h3>
  <input type="search" id="kAq" placeholder="Filter elements…" style="width:100%;margin-bottom:4px"><div class="kal">${(() => { const mine = new Set(sv.assetIds || (c.assets || []).map(a => a.id)); return fm().assets.slice().sort((a, b) => (mine.has(b.id) - mine.has(a.id)) || natural(a.ref || '', b.ref || '')).map(a => `<label data-s="${esc([a.ref, a.element, a.installer, a.system].join(' ').toLowerCase())}"><input type="checkbox" value="${esc(a.id)}" ${mine.has(a.id) ? 'checked' : ''} ${ro ? 'disabled' : ''}> <b>${esc(a.ref || '')}</b> ${esc(a.element)} <span class="muted small">${esc(a.installer || '')}</span></label>`).join(''); })()}</div>
  ${c.docs.length ? `<h3 class="sec">Documents (${c.docs.length})</h3>${c.docs.slice(0, 40).map(d => `<div class="prow"><div class="g"><a href="#" data-open="${esc(d.id)}">${esc(d.title)}</a><small>${esc(d.type || '')}</small></div></div>`).join('')}` : ''}`,
  { ro, onSave: async () => { const o = { ...sv, assetIds: [...document.querySelectorAll('.kal input:checked')].map(x => x.value), id: sv.id || uid(), company: val('kC'), role: val('kR'), legal: val('kL'), nzbn: val('kZ'), address: val('kAd'), trade: val('kT'), name: val('kN'), phone: val('kP'), email: val('kE'), audience: val('kA'), afterHours: val('kH'), notes: val('kO'), updated: nowISO() }; if (!o.company) { toast('Enter the company'); return false; }
      const dir = (S.project.directory || []).filter(x => x.id !== o.id && coKey(x.company) !== coKey(o.company)).concat(o); await S.store.updateProject(S.project.id, { directory: dir }); S.project.directory = dir; setTimeout(render, 50); },
    onDelete: c.saved ? async () => { const dir = (S.project.directory || []).filter(x => x.id !== sv.id); await S.store.updateProject(S.project.id, { directory: dir }); S.project.directory = dir; setTimeout(render, 50); } : null });
  document.querySelectorAll('#s2Body [data-open]').forEach(l => l.onclick = e => { e.preventDefault(); openDoc(fm().docs.find(d => d.id === l.dataset.open)); });
  if ($('kAq')) $('kAq').oninput = e => { const q = e.target.value.toLowerCase().trim(); document.querySelectorAll('.kal label').forEach(l => l.style.display = !q || q.split(' ').every(w => l.dataset.s.includes(w)) ? '' : 'none'); };
}
const RE_EMAIL = /[a-z0-9][a-z0-9._%+-]*@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi, RE_PHONE = /(?:\+?64[\s-]?\(?0?\)?|\(?0)(?:2\d|[34679]|800|508)\)?[\s-]?\d{3,4}[\s-]?\d{3,4}\b/g;
async function readContacts() {
  const pri = d => /warrant|deed|o&m|care|product data|producer|commission/i.test(d.type || '') ? 0 : 1;
  const L = fm().docs.filter(d => DV.isPdf(d) && d.party && !d.found && !d.restricted).sort((a, b) => pri(a) - pri(b)); if (!L.length) return toast('Every document has been read for contact details already');
  const b = busy('Reading documents…'); let n = 0, hit = 0, next = 0;
  const one = async d => { b.set(`Reading ${++n} of ${L.length}: ${d.title}`);
      let found = { e: [], p: [], at: nowISO() };
      try { const t = await DV.frontText(d, 3); found.e = [...new Set((t.match(RE_EMAIL) || []).map(x => x.toLowerCase().replace(/\.$/, '')))].filter(x => !/aucklandcouncil|example\./.test(x)).slice(0, 6); found.p = [...new Set((t.match(RE_PHONE) || []).map(x => x.replace(/\s+/g, ' ').trim()))].filter(x => x.replace(/\D/g, '').length >= 9 && !/^0?9\s?301\s?0101$/.test(x)).slice(0, 6); if (found.e.length || found.p.length) hit++; }
      catch (e) { console.warn('contacts', d.title, e); found.err = 1; }
      await S.store.patchItem(S.project.id, 'docs', d.id, { found }); };
  try { const worker = async () => { while (next < L.length) await one(L[next++]); }; await Promise.all([worker(), worker(), worker()]);
    b.done(); toast(`Read ${n} documents; contact details found in ${hit}`, 6000); setTimeout(render, 300);
  } catch (e) { b.done(); toast(`Stopped after ${n}: ${e.message}. Press the button again to carry on.`, 8000); }
}

/* ---- uploads ---- */
let pickCtx = {}, openAssetId = null, openAssetSys = '';
export const currentModule = () => cur;
export const assetsTab = () => F.atab || (can.contractor() ? 'subs' : 'reg');
export function showSubs() { F.atab = 'subs'; setModule('assets'); }
Sub.setShowSubs(showSubs);
// files dropped onto an open asset sheet are uploaded as documents linked to that asset
export function assetDropTarget() { return $('sheet2').classList.contains('show') && openAssetId ? { assetIds: [openAssetId], system: openAssetSys } : null; }
export async function dropDocs(files, ctx) { const b = busy('Uploading…'); try { const ids = await uploadFiles(files, { ...ctx, onProgress: b.set }); b.done(); toast(`${ids.length} document${ids.length === 1 ? '' : 's'} uploaded`); closeSheet(); } catch (e) { b.done(); toast('Upload failed: ' + e.message, 6000); } }
function pickDocs(ctx) { pickCtx = ctx || {}; $('fDocs').click(); }
function wireUploads() {
  $('fDocs').onchange = async e => { const fs = [...e.target.files]; e.target.value = ''; if (!fs.length) return; const b = busy('Uploading…'); try { const ids = await uploadFiles(fs, { ...pickCtx, onProgress: b.set }); b.done(); toast(`${ids.length} document${ids.length > 1 ? 's' : ''} uploaded`); if (ids.length === 1 && !pickCtx.assetIds) { let d = null; for (let i = 0; i < 20 && !(d = fm().docs.find(x => x.id === ids[0])); i++) await new Promise(r => setTimeout(r, 150)); if (d) editDoc(d); } } catch (x) { b.done(); toast('Upload failed: ' + x.message, 6000); } };
  $('fFolder').onchange = async e => { const fs = [...e.target.files]; e.target.value = ''; if (fs.length) await uploadFolder(fs); };
}
const TYPE_BY_FOLDER = [[/schedule 13 deed/i, 'Warranty (Schedule 13 deed)'], [/product warrant/i, 'Warranty (product)'], [/warrant/i, 'Warranty (product)'], [/o&m|operation/i, 'O&M manual'], [/care & maint|care and maint/i, 'Care and maintenance guide'], [/producer statement|certificate/i, 'Producer statement / certificate'], [/commission|test data/i, 'Commissioning / test record'], [/as-built|as built/i, 'As-built drawing'], [/data sheet/i, 'Product data sheet'], [/design ps1|ps1s & reports/i, 'Design PS1 / report'], [/building consent|resource consent|ccc|epa/i, 'Consent / authority document'], [/inspection|qa record/i, 'Inspection / QA record'], [/spec & drawing|drawings|specification/i, 'Specification / drawing'], [/contract|insurance/i, 'Contract document'], [/practical completion|funder|healthy homes/i, 'Producer statement / certificate'], [/bwof|compliance schedule/i, 'Compliance (Form 12A / BWoF)']];
function classify(path) {
  const parts = path.split('/'); const sys = SYSTEMS.find(s => parts.some(p => p.slice(0, 3) === s.slice(0, 3) && /^\d\d /.test(p))) || '';
  let type = 'Other'; for (const seg of parts.slice(1, -1).reverse()) { const m = TYPE_BY_FOLDER.find(([re]) => re.test(seg)); if (m) { type = m[1]; break; } }
  const name = parts[parts.length - 1].replace(/\.[^.]+$/, ''); const party = name.includes(' - ') ? name.split(' - ')[0].trim() : '';
  if (type === 'Other') type = guessType(name);
  return { system: sys, type, title: name, party };
}
async function uploadFiles(files, ctx) {
  const ids = [], pid = S.project.id;
  for (const [i, f] of files.entries()) {
    if (f.size > 150e6) { toast(f.name + ' is over 150 MB and was skipped', 5000); continue; }
    ctx.onProgress && ctx.onProgress(`Uploading ${i + 1} of ${files.length}: ${f.name}`);
    if (!f.size) { ctx.empty && ctx.empty.push(f.name); continue; }   // an online-only cloud file reads as empty: never store it
    const id = ctx.replaceId || uid(), path = `projects/${pid}/docs/${id}/${safeName(f.name)}`;
    const url = await S.store.putFile(path, f);
    const meta = ctx.classified || {};
    const o = { id, title: typeof ctx.title === 'function' ? ctx.title(f) : (meta.title || f.name.replace(/\.[^.]+$/, '')), type: meta.type || ctx.type || guessType(f.name), system: meta.system || ctx.system || '', party: meta.party || (f.name.includes(' - ') ? f.name.split(' - ')[0] : ''), assetIds: ctx.assetIds || (ctx.keep && ctx.keep.assetIds) || [], url, path, fileName: f.name, size: f.size, mime: f.type, srcPath: meta.srcPath || '', taskId: ctx.taskId || '', audience: 'FM', created: nowISO(), createdBy: S.user.email };
    const w = /\((\d+)\s*(?:yr|year)/i.exec(f.name); if (w && /warrant|deed/i.test(o.type)) o.warrantyYears = +w[1];
    await S.store.saveItem(pid, 'docs', o); ids.push(id);
    for (const aid of o.assetIds) { const a = fm().assets.find(x => x.id === aid); if (a && a.status === 'Not received' && can.edit()) await S.store.patchItem(pid, 'assets', aid, { status: 'Partial' }); }
  }
  return ids;
}
// For other parts of the app (Actions): file one document in the library with the details the user confirmed
// Status catch-up: for each element still short of documents, show the warranties already linked to it and ones in the
// library that look like they belong (same company), so it can be linked and marked received in one go.
const WARR = /warrant|deed|guarantee/i, isW = d => WARR.test((d.type || '') + ' ' + (d.title || ''));
const GENERIC = new Set(['construction', 'services', 'service', 'limited', 'group', 'auckland', 'install', 'supply', 'roofing', 'contractor', 'electrical', 'plumbing', 'subs', 'trade', 'interiors', 'systems', 'solutions', 'product', 'warranty', 'schedule', 'deed', 'confirm', 'units', 'common', 'areas', 'tester', 'supplier', 'installer', 'bricklayer', 'carpentry', 'waterproofing']);
const names = s => String(s || '').toLowerCase().replace(/\(.*?\)|\[.*?\]/g, ' ').split(/[^a-z0-9]+/).filter(w => w.length > 3 && !GENERIC.has(w));
function checkStatuses() {
  const OUT = ['Not received', 'Partial', 'Query', 'Confirm', 'Revision required'], docs = fm().docs.filter(d => !d.superseded && !d.template && isW(d));
  const rows = fm().assets.filter(a => OUT.includes(a.status)).map(a => { const lk = docs.filter(d => (d.assetIds || []).includes(a.id)), ks = names(a.installer);
    const maybe = ks.length ? docs.filter(d => !(d.assetIds || []).includes(a.id) && ks.some(k => ((d.party || '') + ' ' + (d.title || '').split(' - ')[0]).toLowerCase().includes(k))).slice(0, 4) : [];
    return { a, lk, maybe }; }).filter(r => r.lk.length || r.maybe.length).sort((x, y) => natural(x.a.ref || '', y.a.ref || ''));
  const row = r => `<div class="ckrow" data-a="${esc(r.a.id)}"><div><b>${esc(r.a.ref || '')} ${esc(r.a.element)}</b> <span class="muted small">${esc(r.a.installer || '')}</span> <span class="st ${r.a.status === 'Revision required' ? 'st-bad' : 'st-warn'}">${esc(r.a.status)}</span></div>
    ${r.lk.map(d => `<div class="small">✔ Linked: <a href="#" data-od="${esc(d.id)}">${esc(d.title)}</a></div>`).join('')}
    ${r.maybe.map(d => `<div class="small">? In the library: <a href="#" data-od="${esc(d.id)}">${esc(d.title)}</a> <button class="mini" data-lk="${esc(d.id)}">Link it</button></div>`).join('')}
    <div class="ckact"><button class="mini go" data-rc="Received">Mark received</button> <button class="mini" data-rc="Partial">Partial</button> <button class="mini" data-rc="Revision required">Revision required</button></div></div>`;
  modal(`<h2>Check statuses</h2><p class="note">${rows.length} elements still short of documents already have a warranty linked, or one in the library from the same company. Open it, then link it and set the status. Everything else is left as it is.</p>
    <div id="ckL" style="max-height:62vh;overflow:auto">${rows.map(row).join('') || '<p class="muted">Nothing to catch up.</p>'}</div><div class="act"><button id="ckX">Done</button></div>`, true);
  $('ckX').onclick = () => { closeModal(); render(); };
  $('ckL').onclick = async e => { const t = e.target, box = t.closest('[data-a]'); if (!box) return; const a = fm().assets.find(x => x.id === box.dataset.a);
    if (t.dataset.od) { e.preventDefault(); const d = fm().docs.find(x => x.id === t.dataset.od); if (d) { try { window.open(await S.store.resolveUrl(d.url), '_blank'); } catch (x) {} } return; }
    try { if (t.dataset.lk) { const d = fm().docs.find(x => x.id === t.dataset.lk); await S.store.patchItem(S.project.id, 'docs', d.id, { assetIds: [...new Set([...(d.assetIds || []), a.id])] }); d.assetIds = [...new Set([...(d.assetIds || []), a.id])]; t.replaceWith(Object.assign(document.createElement('b'), { textContent: ' linked', className: 'ok small' })); }
      if (t.dataset.rc) { const dd = todayISO().split('-').reverse().join('-'); await S.store.patchItem(S.project.id, 'assets', a.id, { status: t.dataset.rc, notes: (a.notes ? a.notes + ' | ' : '') + `${dd}: status set to ${t.dataset.rc} after checking the documents.`, updated: new Date().toISOString(), updatedBy: S.user.email });
        a.status = t.dataset.rc; box.style.opacity = .5; box.querySelector('.st').textContent = t.dataset.rc; } } catch (x) { toast('Could not save: ' + x.message, 6000); } };
}
export function classifyName(name) { const c = classify('x/' + name); if (/\.(msg|eml)$/i.test(name)) c.type = 'Correspondence (email / letter)'; return c; }
export async function uploadAs(file, meta) { const ids = await uploadFiles([file], { classified: meta, assetIds: meta.assetIds || [] }); return ids[0]; }
export const docBytes = d => X.getBytes(d.url);
const guessType = n => { const m = TYPE_BY_FOLDER.find(([re]) => re.test(n)); return m ? m[1] : 'Other'; };
export async function uploadFolder(files) {
  // skipped: working folders (_...), superseded versions, Office lock files, and the pack's own registers and guide
  const skip = /(^|\/)(_|~\$|\.|desktop\.ini|thumbs\.db)|Defect Manager\/|(^|\/)Superseded\/|^([^\/]*\/)?[^\/]*(Register\.xlsx|START HERE[^\/]*\.md)$/i;
  const list = files.filter(f => !skip.test(f.relPath || f.webkitRelativePath || f.name)).map(f => ({ f, path: f.relPath || f.webkitRelativePath || f.name }));
  // check what is actually stored: a document whose stored file is empty or missing is uploaded again, in place
  const chk = busy('Checking the documents already stored…'), withPath = fm().docs.filter(d => d.srcPath && d.path), bad = new Set();
  for (let i = 0; i < withPath.length; i += 20) { chk.set(`Checking stored documents ${Math.min(i + 20, withPath.length)} of ${withPath.length}…`); await Promise.all(withPath.slice(i, i + 20).map(async d => { const z = S.store.fileSize ? await S.store.fileSize(d.path) : 1; if (z === 0) bad.add(d.id); })); }
  chk.done();
  const have = new Set(fm().docs.filter(d => !bad.has(d.id)).map(d => d.srcPath + '|' + d.size));
  // OneDrive online-only files show as 0 bytes when picked. Reading one asks Windows to download it, so try that before giving up.
  const zero = list.filter(x => !x.f.size);
  if (zero.length) { const rb = busy('Fetching files from OneDrive…'); let k = 0;
    for (const x of zero) { rb.set(`Fetching from OneDrive ${++k} of ${zero.length}: ${x.f.name}`); try { const buf = await x.f.arrayBuffer(); if (buf.byteLength) x.f = new File([buf], x.f.name, { type: x.f.type || (/\.pdf$/i.test(x.f.name) ? 'application/pdf' : '') }); } catch (e) {} }
    rb.done(); }
  const todo = list.filter(x => x.f.size && !have.has(x.path + '|' + x.f.size)), emptyNow = list.filter(x => !x.f.size).length;
  const broken = {}; fm().docs.forEach(d => { if ((!d.size || bad.has(d.id)) && d.srcPath) broken[d.srcPath] = d; });   // stored earlier as empty files: replaced in place this time
  const big = todo.filter(x => x.f.size > 150e6), mb = todo.reduce((a, x) => a + x.f.size, 0) / 1e6;
  if (!todo.length && emptyNow) return toast(`${emptyNow} files could not be read from this computer: they show as 0 bytes. In File Explorer right-click the folder, choose "Always keep on this device", wait for green ticks, then try again.`, 15000);
  const nRep = todo.filter(x => broken[x.path]).length;
  if (!(await confirmBox(`Upload ${todo.length} documents (${mb.toFixed(0)} MB)?${nRep ? ' ' + (todo.length - nRep) + ' are new and ' + nRep + ' replace copies in the library whose stored file is empty (these are replaced in place, not added twice).' : ''} ${list.length - todo.length ? (list.length - todo.length) + ' already in the library will be skipped. ' : ''}${big.length ? big.length + ' over 150 MB will be skipped. ' : ''}They will be filed by building system and type from the folder names. Keep this page open until it finishes.`, 'Upload'))) return;
  const b = busy('Uploading…'); let n = 0;
  try {
    let next = 0; const worker = async () => { while (next < todo.length) { const x = todo[next++]; if (x.f.size > 150e6) continue; const c = classify(x.path); c.srcPath = x.path; await uploadFiles([x.f], { classified: c, replaceId: broken[x.path] && broken[x.path].id, keep: broken[x.path], onProgress: () => b.set(`Uploading ${++n} of ${todo.length}: ${x.f.name}`) }); } };
    await Promise.all([worker(), worker(), worker()]);   // three at a time
    b.done(); toast(`Uploaded ${n} documents` + (emptyNow ? `. ${emptyNow} were skipped because they are not downloaded to this computer (OneDrive online-only): right-click the folder, choose "Always keep on this device", wait for the green ticks, then upload again.` : ''), emptyNow ? 15000 : 4000); setTimeout(autoLink, 1500);
  } catch (e) { b.done(); toast(`Stopped after ${n} documents: ${e.message}. Run it again to carry on; finished files are skipped.`, 8000); }
}
// The same file in the library more than once (same name and size, usually after folders were renamed and uploaded again).
// The copy that has had work done on it is kept: boxes, AI reading, links to assets. Links are carried over to the kept copy.
async function removeDuplicates() {
  const g = {}; fm().docs.filter(d => d.size && d.fileName && !d.link && !d.submitted).forEach(d => (g[d.fileName.toLowerCase() + '|' + d.size] = g[d.fileName.toLowerCase() + '|' + d.size] || []).push(d));
  const score = d => (d.marks || []).length * 100 + (d.aiRead ? 50 : 0) + (d.assetIds || []).length * 10 + (d.taskId ? 5 : 0), sets = Object.values(g).filter(L => L.length > 1).map(L => L.slice().sort((a, b) => score(b) - score(a) || String(b.created || '').localeCompare(String(a.created || ''))));
  const empt = fm().docs.filter(d => d.url && !d.size && !d.link && !d.submitted);
  if (!sets.length && !empt.length) return toast('No duplicates or empty entries found.');
  const n = sets.reduce((a, L) => a + L.length - 1, 0), mb = sets.reduce((a, L) => a + L.slice(1).reduce((x, d) => x + d.size, 0), 0) / 1e6;
  modal(`<h2>🧹 Remove duplicates</h2><p>${!sets.length ? 'No document is in the library more than once.' : ''}${sets.length} document${sets.length === 1 ? ' is' : 's are'} in the library more than once. Removing the ${n} extra cop${n === 1 ? 'y' : 'ies'} frees ${mb.toFixed(0)} MB.</p>
  <p class="note">A duplicate is the same file name and the same size. The copy with boxes, AI reading or asset links is kept (otherwise the newest), and any asset links on the removed copies are moved to it. Warranty submissions are never touched.</p>
  <div style="max-height:260px;overflow:auto;border:1px solid var(--line);border-radius:8px;padding:6px 10px">${sets.map(L => `<div class="small" style="padding:3px 0"><b>${esc(L[0].fileName)}</b> <span class="muted">× ${L.length} · keeping the copy in ${esc((L[0].srcPath || L[0].system || 'the library').split('/').slice(-3, -1).join(' / ') || L[0].system || 'the library')}</span></div>`).join('')}</div>
  ${empt.length ? `<label class="dvall" style="margin-top:10px"><input type="checkbox" id="ddE" checked> Also delete ${empt.length} empty entr${empt.length === 1 ? 'y' : 'ies'}: documents whose file never uploaded (OneDrive online-only at the time), so nothing is lost</label><div class="small muted" style="max-height:120px;overflow:auto">${empt.map(d => esc(d.title)).join('<br>')}</div>` : ''}
  <div class="act"><button id="ddX">Cancel</button><button class="go" id="ddGo">Clean up</button></div>`, true);
  $('ddX').onclick = closeModal;
  $('ddGo').onclick = async () => { const delE = $('ddE') && $('ddE').checked; closeModal(); const b = busy('Removing duplicates…'), pid = S.project.id; let k = 0;
    if (delE) { try { for (const d of empt) { b.set('Removing empty entries…'); await S.store.deleteItem(pid, 'docs', d.id); } } catch (e) { b.done(); return toast('Could not remove the empty entries: ' + e.message, 7000); } }
    try { for (const L of sets) { const keep = L[0], ids = [...new Set(L.flatMap(d => d.assetIds || []))];
        if (ids.length > (keep.assetIds || []).length) await S.store.patchItem(pid, 'docs', keep.id, { assetIds: ids });
        for (const d of L.slice(1)) { b.set(`Removing ${++k} of ${n}…`); await S.store.deleteItem(pid, 'docs', d.id); if (d.path && d.path !== keep.path) { try { await S.store.deleteFile(d.path); } catch (e) { console.warn('file', e); } } } }
      b.done(); toast(`${k} duplicate${k === 1 ? '' : 's'} removed${delE ? ', ' + empt.length + ' empty entries removed' : ''}`, 6000); }
    catch (e) { b.done(); toast(`Stopped after ${k}: ${e.message}. Run it again to carry on.`, 8000); } };
}
// Link warranty and O&M documents to assets when the company and system match (best guess; check in Documents).
async function autoLink() {
  let n = 0;
  for (const d of fm().docs) {
    if ((d.assetIds || []).length || !d.party || !d.system) continue;
    const p = d.party.toLowerCase().split(/[ (]/)[0]; if (p.length < 3) continue;
    const hits = fm().assets.filter(a => a.system === d.system && [a.installer, a.product].join(' ').toLowerCase().includes(p));
    if (hits.length >= 1 && hits.length <= 3) { await S.store.patchItem(S.project.id, 'docs', d.id, { assetIds: hits.map(a => a.id) }); n++; }
  }
  if (n) toast(`${n} documents linked to assets automatically. Check them in Documents.`, 5000);
}

/* ================================================================ exports */
export async function exportFmRegister() {
  const b = busy('Building the FM register…');
  try { const blob = await registerBlob(); b.done(); deliver(blob, `${safeName(S.project.name)} - FM Register - ${stamp()}.xlsx`, 'FM register'); }
  catch (e) { b.done(); toast(e.message, 6000); }
}
async function registerBlob() {
  {
    if (!window.XLSX) await loadScript('lib/xlsx.bundle.js');
    const p = S.project, A = fm().assets, Dd = fm().docs, T = fm().tasks, SY = fm().systems, yr = bwofYear();
    const hs = { font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '011C35' } }, alignment: { wrapText: true, vertical: 'center' } };
    const sheetOf = (title, head, rows, widths) => { const ws = XLSX.utils.aoa_to_sheet([[`${p.name} - ${title}`], [`Prepared by Resero Property${p.client ? ' for ' + p.client : ''}. Exported ${nzDate(todayISO())}.`], [], head, ...rows]); ws['!cols'] = widths.map(w => ({ wch: w })); head.forEach((_, i) => { const a = XLSX.utils.encode_cell({ r: 3, c: i }); if (ws[a]) ws[a].s = hs; }); if (ws.A1) ws.A1.s = { font: { bold: true, sz: 14, color: { rgb: '011C35' } } }; ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 3, c: 0 }, e: { r: 3 + rows.length, c: head.length - 1 } }) }; return ws; };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheetOf('Key dates', ['Item', 'Date'], [['Practical completion', nzDate(p.pcDate)], ['Defects notification period ends', p.pcDate ? nzDate(addFreq(p.pcDate, +(p.dnpMonths || 12), 'months')) : ''], ['Code Compliance Certificate', nzDate(p.cccDate)], ['BWoF due', nzDate(p.bwofDue)], ['Compliance schedule', p.csNumber || ''], ['IQP', p.iqp || '']], [40, 20]), 'Key dates');
    XLSX.utils.book_append_sheet(wb, sheetOf('Asset and warranty register', ['Ref', 'System', 'Element', 'Product / manufacturer', 'Location', 'Installer', 'Warranties', 'Earliest expiry', 'Document status', 'Documents held', 'O&M needed', 'Maintenance-dependent', 'Notes'], A.slice().sort((a, b) => natural(a.system, b.system) || natural(a.ref, b.ref)).map(a => [a.ref, a.system, a.element, a.product, a.location, a.installer, (a.warranties || []).map(w => `${w.label || ''} ${w.party ? '(' + w.party + ')' : ''} ${w.months ? w.months + ' months' : ''}${warrantyExpiry(w) ? ' to ' + nzDate(warrantyExpiry(w)) : ''}`.trim()).join('; '), nzDate(assetExpiry(a)), a.status, Dd.filter(d => (d.assetIds || []).includes(a.id)).map(d => d.title).join('; '), a.om ? 'Yes' : 'No', a.maint ? 'Yes' : 'No', a.notes]), [8, 26, 30, 26, 18, 20, 40, 14, 14, 40, 8, 10, 40]), 'Assets & warranties');
    XLSX.utils.book_append_sheet(wb, sheetOf('Maintenance schedule', ['Task', 'Category', 'Specified system', 'System', 'Asset', 'Frequency', 'Responsible', 'Standard / reference', 'Last done', 'Next due', 'Instructions'], T.slice().sort((a, b) => (a.nextDue || '9').localeCompare(b.nextDue || '9')).map(t => [t.title, t.category, t.ss, t.system, (A.find(a => a.id === t.assetId) || {}).element || '', freqText(t), t.responsible, t.standard, nzDate(t.lastDone), nzDate(t.nextDue), t.instructions]), [40, 18, 10, 26, 26, 16, 20, 24, 12, 12, 50]), 'Maintenance');
    XLSX.utils.book_append_sheet(wb, sheetOf('Compliance schedule', ['Specified system', 'Description', 'Location', 'Performance standard', 'Inspection procedures', `Form 12A ${yr}`], SY.slice().sort((a, b) => natural(a.ss, b.ss)).map(s => [s.ss, s.name, s.location, s.standard, s.inspections, (s.cert12A || {})[yr] ? nzDate(s.cert12A[yr].date) : 'Outstanding']), [10, 34, 20, 24, 50, 14]), 'Compliance');
    XLSX.utils.book_append_sheet(wb, sheetOf('Document index', ['Title', 'Type', 'System', 'From', 'Issued', 'Expiry', 'Linked assets', 'File / link'], Dd.slice().sort((a, b) => natural(a.system || 'z', b.system || 'z') || natural(a.title, b.title)).map(d => [d.title, d.type, d.system, d.party, nzDate(d.issued), nzDate(d.expiry), (d.assetIds || []).map(id => (A.find(a => a.id === id) || {}).element).filter(Boolean).join('; '), d.link || d.fileName || '']), [50, 24, 26, 20, 12, 12, 30, 40]), 'Documents');
    const defs = S.defects.filter(d => d.status !== 'Closed');
    XLSX.utils.book_append_sheet(wb, sheetOf('Open defects', ['ID', 'Title', 'Location', 'Status', 'Severity', 'Responsible', 'Target'], defs.map(d => [d.id, d.title, [d.block && 'Block ' + d.block, d.level, d.unit && 'Unit ' + d.unit, d.room].filter(Boolean).join(', '), d.status, d.severity, d.responsible, nzDate(d.targetDate)]), [10, 40, 30, 14, 18, 20, 12]), 'Open defects');
    return new Blob([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
}
export function exportIcs() { deliver(icsBlob(), `${safeName(S.project.name)} - Maintenance calendar - ${stamp()}.ics`, 'Calendar file'); }
function icsBlob() {
  const T = fm().tasks.filter(t => t.nextDue), p = S.project, ev = [], end = addFreq(todayISO(), 18, 'months');
  const fmt = iso => iso.replace(/-/g, ''), esc2 = s => String(s || '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
  T.forEach(t => { let d = t.nextDue, k = 0; while (d && d <= end && k < 60) { ev.push(['BEGIN:VEVENT', `UID:${t.id}-${d}@resero-defects`, `DTSTAMP:${fmt(todayISO())}T000000Z`, `DTSTART;VALUE=DATE:${fmt(d)}`, `SUMMARY:${esc2((t.ss ? t.ss + ' ' : '') + t.title)} (${esc2(p.name)})`, `DESCRIPTION:${esc2([t.category, freqText(t), t.responsible && 'Responsible: ' + t.responsible, t.standard, t.instructions].filter(Boolean).join('\n'))}`, 'END:VEVENT'].join('\r\n')); if (!t.freqN) break; d = addFreq(d, t.freqN, t.freqUnit); k++; } });
  if (p.bwofDue) ev.push(['BEGIN:VEVENT', `UID:bwof-${p.bwofDue}@resero-defects`, `DTSTAMP:${fmt(todayISO())}T000000Z`, `DTSTART;VALUE=DATE:${fmt(p.bwofDue)}`, `SUMMARY:BWoF due (${esc2(p.name)})`, 'BEGIN:VALARM', 'TRIGGER:-P30D', 'ACTION:DISPLAY', 'DESCRIPTION:BWoF due in 30 days', 'END:VALARM', 'END:VEVENT'].join('\r\n'));
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Resero Property//Resero Site//EN', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${esc2(p.name)} maintenance`, ...ev, 'END:VCALENDAR'].join('\r\n');
  return new Blob([ics], { type: 'text/calendar' });
}
