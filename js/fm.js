// Facility management modules: dashboard, assets and warranties, maintenance, compliance (BWoF), documents.
import { S, can } from './state.js';
import { STATUS_COLOURS as SCOL } from './config.js';
import * as Pack from './pack.js';
import * as Nav from './nav.js';
import { aiCall } from './ai.js';
import { $, esc, toast, modal, closeModal, busy, confirmBox, opts, uid, todayISO, nzDate, stamp, natural, safeName, deliver, loadScript } from './util.js';

export const SYSTEMS = ['00 Contract & Consent (whole of works)', '01 Substructure & Foundations', '02 Superstructure', '03 Building Envelope', '04 Internal Finishes & Fit-out', '05 Hydraulic (Plumbing & Drainage)', '06 Electrical & Lighting', '07 Mechanical & Ventilation', '08 Fire Protection & Life Safety', '09 Vertical Transportation (Lift)', '10 Doors & Access Control', '11 External Works & Landscaping', '12 Civil & Infrastructure (3 Waters & Vector)', '13 Sustainability (Homestar & Healthy Homes)', '14 Compliance Schedule & BWoF'];
export const DOC_TYPES = ['Warranty (Schedule 13 deed)', 'Warranty (product)', 'O&M manual', 'Care and maintenance guide', 'Producer statement / certificate', 'Commissioning / test record', 'As-built drawing', 'Product data sheet', 'Design PS1 / report', 'Consent / authority document', 'Inspection / QA record', 'Specification / drawing', 'Contract document', 'Compliance (Form 12A / BWoF)', 'Maintenance record', 'Other'];
const ASSET_STATUS = ['Received', 'Partial', 'Revision required', 'Query', 'Confirm', 'Not received', 'Not applicable'];
const TASK_CATS = ['Planned maintenance', 'Compliance (BWoF)', 'Warranty condition', 'Inspection', 'Cleaning', 'Other'];
const UNITS = { weeks: 'week', months: 'month', years: 'year' };

let X = {}, unsubs = [], cur = 'defects';
const F = { q: '', sys: '', st: '', type: '', cat: '', win: '90', resp: '' };
export function init(ctx) { X = ctx; Pack.init({ fm, getBytes: ctx.getBytes, addFreq, warrantyExpiry, freqText, SYSTEMS, registerBlob, icsBlob }); document.querySelectorAll('#modbar button').forEach(b => b.onclick = () => setModule(b.dataset.m)); wireSheet(); wireUploads(); }
const fm = () => S.fm || (S.fm = { assets: [], docs: [], tasks: [], systems: [] });
export function start(pid) {
  stop(); S.fm = { assets: [], docs: [], tasks: [], systems: [] };
  ['assets', 'docs', 'tasks', 'systems'].forEach(c => unsubs.push(S.store.watchColl(pid, c, l => { fm()[c] = l; if (cur !== 'defects') render(); }, e => console.warn(c, e))));
  setModule(S.local.lastModule && S.local.lastModule !== 'defects' ? 'defects' : 'defects');
}
export function stop() { unsubs.forEach(u => u && u()); unsubs = []; }
export function setModule(m) {
  if (m !== 'defects' && !Nav.isOpen('module')) Nav.open('module', () => setModule('defects')); if (m === 'defects') Nav.closed('module');
  cur = m; document.querySelectorAll('#modbar button').forEach(b => b.classList.toggle('on', b.dataset.m === m));
  $('scrWork').classList.toggle('fm', m !== 'defects'); if (m === 'defects') { X.render && X.render(); return; } render();
}
function render() { ({ dash, assets, maint, comp, docs })[cur]?.(); }

/* ---------------------------------------------------------------- dates and helpers */
const dISO = d => d.toISOString().slice(0, 10);
export function addFreq(iso, n, unit) { const d = new Date((iso || todayISO()) + 'T00:00'); if (unit === 'weeks') d.setDate(d.getDate() + 7 * n); else if (unit === 'years') d.setFullYear(d.getFullYear() + +n); else d.setMonth(d.getMonth() + +n); return dISO(d); }
const days = iso => iso ? Math.round((new Date(iso + 'T00:00') - new Date(todayISO() + 'T00:00')) / 864e5) : null;
const freqText = t => t.freqN ? (t.freqN == 1 ? 'Every ' + UNITS[t.freqUnit] : `Every ${t.freqN} ${t.freqUnit}`) : 'One-off';
const dueBadge = iso => { const d = days(iso); if (d == null) return '<span class="st st-grey">No date</span>'; if (d < 0) return `<span class="st st-bad">${-d} days overdue</span>`; if (d <= 30) return `<span class="st st-warn">Due in ${d} days</span>`; return `<span class="st st-info">${nzDate(iso)}</span>`; };
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
}
function closeSheet() { $('sheet2').classList.remove('show'); SH = null; Nav.closed('sheet2'); }
function wireSheet() {
  $('s2Close').onclick = $('s2Cancel').onclick = closeSheet;
  $('sheet2').addEventListener('click', e => { if (e.target.id === 'sheet2') closeSheet(); });
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
  const open = D.filter(d => d.status !== 'Closed'), maj = open.filter(d => /^Major/.test(d.severity || ''));
  const overdue = T.filter(t => days(t.nextDue) < 0), due30 = T.filter(t => { const d = days(t.nextDue); return d != null && d >= 0 && d <= 30; });
  const exp = A.flatMap(a => (a.warranties || []).map(w => ({ a, w, e: warrantyExpiry(w) }))).filter(x => x.e);
  const exp90 = exp.filter(x => { const d = days(x.e); return d != null && d >= 0 && d <= 90; }), expired = exp.filter(x => days(x.e) < 0);
  const missing = A.filter(a => !['Received', 'Not applicable'].includes(a.status));
  const bw = p.bwofDue ? days(p.bwofDue) : null, yr = bwofYear(), cert = SY.filter(s => (s.cert12A || {})[yr]);
  const dnpEnd = p.pcDate ? addFreq(p.pcDate, +(p.dnpMonths || 12), 'months') : '';
  const k = (c, n, l, m) => `<div class="kpi" style="--c:${c}" data-go="${m}"><b>${n}</b><span>${l}</span></div>`;
  $('fmView').innerHTML = `<div class="fbar"><h2>${esc(p.name)}: facility dashboard</h2><span class="sp"></span>${can.admin() ? '<button class="btn2" id="dSet">Key dates</button><button class="btn2" id="dCon">Contacts</button>' : ''}<button class="btn2" id="dIcs">📅 Calendar (.ics)</button><button class="btn2" id="dPack">⬇ FM register (Excel)</button><button class="btn2 go" id="dHand">📦 Handover pack</button></div>
  <div class="kpis">
    ${k('#d64545', open.length, `Open defects${maj.length ? ` (${maj.length} major)` : ''}`, 'defects')}
    ${k(overdue.length ? '#d64545' : '#2e9b5f', overdue.length, 'Maintenance tasks overdue', 'maint')}
    ${k('#e39b1b', due30.length, 'Maintenance due in 30 days', 'maint')}
    ${k(expired.length ? '#d64545' : '#e39b1b', exp90.length + (expired.length ? ` / ${expired.length}` : ''), `Warranties expiring in 90 days${expired.length ? ' / expired' : ''}`, 'assets')}
    ${k(bw != null && bw < 60 ? '#d64545' : '#2f78c4', bw == null ? '-' : bw < 0 ? 'Overdue' : bw + ' d', p.bwofDue ? 'BWoF due ' + nzDate(p.bwofDue) : 'BWoF date not set', 'comp')}
    ${k(cert.length < SY.length ? '#e39b1b' : '#2e9b5f', `${cert.length}/${SY.length}`, `Form 12A certificates for ${yr}`, 'comp')}
    ${k(missing.length ? '#e39b1b' : '#2e9b5f', missing.length, 'Assets with handover documents outstanding', 'assets')}
    ${k('#3bafbe', Dd.length, 'Documents in the library', 'docs')}
  </div>
  <div class="dgrid">
    <div class="panel"><h3>Maintenance: overdue and next 30 days</h3>${[...overdue, ...due30].sort((a, b) => (a.nextDue || '').localeCompare(b.nextDue || '')).slice(0, 12).map(t => `<div class="prow"><div class="g">${esc(t.title)}<small>${esc(sysShort(t.system))} · ${esc(freqText(t))} · ${esc(t.responsible || '')}</small></div>${dueBadge(t.nextDue)}${can.write() ? `<button class="btn2 sm" data-done="${esc(t.id)}">Done</button>` : ''}</div>`).join('') || '<p class="muted">Nothing due.</p>'}</div>
    <div class="panel"><h3>Key dates</h3>
      ${[['Practical completion', p.pcDate], ['Defects notification period ends', dnpEnd], ['Code Compliance Certificate', p.cccDate], ['Building warrant of fitness due', p.bwofDue], ['Weathertightness guarantee ends (10 years)', p.pcDate ? addFreq(p.pcDate, 10, 'years') : '']].map(([l, d]) => `<div class="prow"><div class="g">${l}</div>${d ? dueBadge(d) : '<span class="st st-grey">Not set</span>'}</div>`).join('')}
    </div>
    <div class="panel"><h3>Warranties expiring or expired</h3>${[...expired, ...exp90].sort((a, b) => a.e.localeCompare(b.e)).slice(0, 12).map(x => `<div class="prow"><div class="g">${esc(x.a.element)}<small>${esc(x.w.label || '')} · ${esc(x.w.party || '')}</small></div>${dueBadge(x.e)}</div>`).join('') || `<p class="muted">${p.pcDate ? 'None in the next 90 days.' : 'Set the practical completion date (Key dates) so warranty expiry dates can be calculated.'}</p>`}</div>
    <div class="panel"><h3>Handover documents outstanding</h3>${missing.slice(0, 12).map(a => `<div class="prow" data-asset="${esc(a.id)}" style="cursor:pointer"><div class="g">${esc(a.element)}<small>${esc(sysShort(a.system))} · ${esc(a.installer || a.product || '')}</small></div>${stBadge(a.status)}</div>`).join('') || '<p class="muted">All received.</p>'}${missing.length > 12 ? `<p class="muted small">and ${missing.length - 12} more in Assets &amp; warranties.</p>` : ''}</div>
  </div>`;
  document.querySelectorAll('[data-go]').forEach(b => b.onclick = () => setModule(b.dataset.go));
  document.querySelectorAll('[data-done]').forEach(b => b.onclick = () => completeTask(T.find(t => t.id === b.dataset.done)));
  document.querySelectorAll('[data-asset]').forEach(b => b.onclick = () => editAsset(A.find(a => a.id === b.dataset.asset)));
  if ($('dSet')) $('dSet').onclick = keyDates; if ($('dCon')) $('dCon').onclick = contactsDialog; $('dHand').onclick = Pack.packDialog;
  $('dIcs').onclick = exportIcs; $('dPack').onclick = exportFmRegister;
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
function assets() {
  const A = fm().assets.slice().sort((a, b) => natural(a.system, b.system) || natural(a.ref, b.ref)), q = F.q.toLowerCase();
  const L = A.filter(a => (!F.sys || a.system === F.sys) && (!F.st || a.status === F.st) && (!q || [a.ref, a.element, a.product, a.location, a.installer, a.notes].join(' ').toLowerCase().includes(q)));
  let last = '';
  $('fmView').innerHTML = `<div class="fbar"><h2>Assets &amp; warranties</h2><input type="search" id="aQ" placeholder="Search element, product, installer…" value="${esc(F.q)}"><select id="aSys">${sysOpts(F.sys, 1).replace('<option value=""></option>', '<option value="">All systems</option>')}</select><select id="aSt"><option value="">All statuses</option>${ASSET_STATUS.map(s => `<option ${s === F.st ? 'selected' : ''}>${s}</option>`).join('')}</select>${can.edit() ? '<button class="btn2 go" id="aNew">+ Asset</button>' : ''}<button class="btn2" id="aX">⬇ Excel</button></div>
  <p class="muted small">${L.length} of ${A.length} assets · ${A.filter(a => a.status === 'Received').length} with documents received · warranty expiry runs from ${pcDate() ? 'practical completion (' + nzDate(pcDate()) + ')' : 'practical completion (date not set yet: Dashboard > Key dates)'}</p>
  ${L.length ? `<table class="ftable"><tr><th>Ref</th><th>Element</th><th class="hm">Product / installer</th><th class="hm">Location</th><th>Warranty to</th><th>Documents</th><th>Status</th></tr>
  ${L.map(a => { const g = a.system !== last ? `<tr class="grp"><td colspan="7">${esc(a.system)}</td></tr>` : ''; last = a.system; const e = assetExpiry(a), nd = fm().docs.filter(d => (d.assetIds || []).includes(a.id)).length;
    return g + `<tr class="click" data-id="${esc(a.id)}"><td>${esc(a.ref || '')}</td><td><b>${esc(a.element)}</b>${a.maint ? ' <span class="st st-info" title="Warranty depends on maintenance">maint.</span>' : ''}</td><td class="hm">${esc(a.product || '')}<br><span class="muted small">${esc(a.installer || '')}</span></td><td class="hm">${esc(a.location || '')}</td><td>${e ? dueBadge(e) : '<span class="muted small">' + esc((a.warranties || [])[0]?.label || '-') + '</span>'}</td><td>${nd || '-'}</td><td>${stBadge(a.status)}</td></tr>`; }).join('')}</table>` : `<div class="empty2">${A.length ? 'No assets match.' : 'No assets yet. Add them one at a time, or import the warranty register from ☰ > Import register.'}</div>`}`;
  $('aQ').oninput = e => { F.q = e.target.value; assets(); $('aQ').focus(); $('aQ').setSelectionRange(F.q.length, F.q.length); };
  $('aSys').onchange = e => { F.sys = e.target.value; assets(); }; $('aSt').onchange = e => { F.st = e.target.value; assets(); };
  if ($('aNew')) $('aNew').onclick = () => editAsset(null);
  $('aX').onclick = exportFmRegister;
  document.querySelectorAll('tr[data-id]').forEach(r => r.onclick = () => editAsset(fm().assets.find(a => a.id === r.dataset.id)));
}
function editAsset(a) {
  const isNew = !a; a = a ? JSON.parse(JSON.stringify(a)) : { id: uid(), ref: nextRef(fm().assets, 'A'), system: F.sys || SYSTEMS[1], status: 'Not received', warranties: [], om: true, maint: false, audience: 'FM' };
  const ro = !can.edit(); const docsL = fm().docs.filter(d => (d.assetIds || []).includes(a.id)); const tasksL = fm().tasks.filter(t => t.assetId === a.id);
  const wr = (w, i) => `<div class="wrow" data-w="${i}"><label class="f">Warranty<input data-k="label" value="${esc(w.label || '')}" placeholder="e.g. Materials"></label><label class="f">Given by<input data-k="party" value="${esc(w.party || '')}"></label><label class="f">Months<input data-k="months" type="number" value="${esc(w.months || '')}"></label><label class="f">Start (blank = PC)<input data-k="start" type="date" value="${esc(w.start || '')}"></label><label class="f">Expires<input disabled value="${esc(nzDate(warrantyExpiry(w)) || '-')}"></label>${ro ? '' : `<button class="btn2 sm" data-wx="${i}">✕</button>`}</div>`;
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
    <div class="full" id="aCareW" style="${a.audience === 'FM' ? 'display:none' : ''}"><label class="f">Care note for residents (Home User Guide, plain English)<textarea id="aCare">${esc(a.careNote || '')}</textarea></label>${ro ? '' : '<button class="mini" id="aCareAi" style="margin-top:4px">✨ Draft with Gemini</button>'}</div>
    ${area('Received / variance / action', 'aN', a.notes)}${field('Source (spec / consent reference)', 'aSrc', a.source, '', true)}
  </div>
  <h3 class="sec">Warranties <span class="sp"></span>${ro ? '' : '<button class="mini" id="aWadd">+ Add</button>'}</h3><div id="aW">${(a.warranties || []).map(wr).join('') || '<p class="muted small">No warranty periods recorded.</p>'}</div>
  <h3 class="sec">Documents <span class="sp"></span>${can.write() ? '<button class="mini" id="aDup">⬆ Upload for this asset</button>' : ''}</h3>
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
  if ($('aCareAi')) $('aCareAi').onclick = async () => { const btn = $('aCareAi'); btn.disabled = true; btn.textContent = 'Asking Gemini…';
    try { const t = await aiCall(`Write a short care note (2 to 4 sentences, plain New Zealand English, no em dashes, warm and respectful) for an older resident living in a new social housing unit, about this item in their home: ${val('aE')} (${val('aP')}). Explain simply how to use and look after it, and to report faults to their landlord rather than fixing it themselves. Return JSON {"note":"..."}.`); let n = ''; try { n = JSON.parse(String(t).replace(/^```(?:json)?\s*|\s*```$/g, '')).note; } catch (e) { n = String(t); } $('aCare').value = String(n || '').replace(/\u2014/g, ', '); }
    catch (e) { toast(e.message === 'nokey' ? 'Set up Gemini first (☰ > Gemini)' : e.message, 5000); } finally { btn.disabled = false; btn.textContent = '✨ Draft with Gemini'; } };
  if ($('aWadd')) $('aWadd').onclick = () => { collectW(); a.warranties.push({ label: '', party: val('aI') || val('aP'), months: '', start: '' }); redrawW(); };
  if ($('aDup')) $('aDup').onclick = () => pickDocs({ assetIds: [a.id], system: val('aS') || a.system });
  if ($('aTadd')) $('aTadd').onclick = () => { closeSheet(); editTask(null, { assetId: a.id, system: a.system, title: 'Maintain ' + a.element }); };
  document.querySelectorAll('[data-open]').forEach(l => l.onclick = e => { e.preventDefault(); openDoc(fm().docs.find(d => d.id === l.dataset.open)); });
}

/* ================================================================ MAINTENANCE */
function maint() {
  const T = fm().tasks, q = F.q.toLowerCase(), win = F.win === 'all' ? 1e9 : +F.win;
  const L = T.filter(t => (!F.sys || t.system === F.sys) && (!F.cat || t.category === F.cat) && (!F.resp || t.responsible === F.resp) && (!q || [t.title, t.instructions, t.ss, t.responsible].join(' ').toLowerCase().includes(q)) && (days(t.nextDue) == null || days(t.nextDue) <= win)).sort((a, b) => (a.nextDue || '9999').localeCompare(b.nextDue || '9999'));
  const groups = [['Overdue', t => days(t.nextDue) < 0], ['Next 30 days', t => days(t.nextDue) >= 0 && days(t.nextDue) <= 30], ['31 to 90 days', t => days(t.nextDue) > 30 && days(t.nextDue) <= 90], ['Later', t => days(t.nextDue) > 90], ['No date set', t => days(t.nextDue) == null]];
  const resp = [...new Set(T.map(t => t.responsible).filter(Boolean))].sort();
  $('fmView').innerHTML = `<div class="fbar"><h2>Maintenance</h2><input type="search" id="mQ" placeholder="Search tasks…" value="${esc(F.q)}"><select id="mW">${[['30', 'Due in 30 days'], ['90', 'Due in 90 days'], ['365', 'Due in 12 months'], ['all', 'All tasks']].map(([v, l]) => `<option value="${v}" ${F.win === v ? 'selected' : ''}>${l}</option>`).join('')}</select><select id="mC"><option value="">All categories</option>${TASK_CATS.map(c => `<option ${c === F.cat ? 'selected' : ''}>${c}</option>`).join('')}</select><select id="mS">${sysOpts(F.sys, 1).replace('<option value=""></option>', '<option value="">All systems</option>')}</select><select id="mR"><option value="">Anyone responsible</option>${resp.map(r => `<option ${r === F.resp ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select>${can.edit() ? '<button class="btn2 go" id="mNew">+ Task</button>' : ''}${can.edit() && T.some(t => !t.nextDue) ? `<button class="btn2" id="mSch">Schedule ${T.filter(t => !t.nextDue).length} undated</button>` : ''}<button class="btn2" id="mIcs">📅 .ics</button><button class="btn2" id="mX">⬇ Excel</button></div>
  ${T.length ? `<table class="ftable"><tr><th>Task</th><th class="hm">System</th><th>Frequency</th><th class="hm">Responsible</th><th class="hm">Last done</th><th>Next due</th><th></th></tr>
  ${groups.map(([g, fn]) => { const r = L.filter(fn); return r.length ? `<tr class="grp"><td colspan="7">${g} (${r.length})</td></tr>` + r.map(t => `<tr class="click" data-id="${esc(t.id)}"><td><b>${esc(t.title)}</b>${t.ss ? ` <span class="st st-info">${esc(t.ss)}</span>` : ''}<br><span class="muted small">${esc(t.category || '')}</span></td><td class="hm">${esc(sysShort(t.system))}</td><td>${esc(freqText(t))}</td><td class="hm">${esc(t.responsible || '')}</td><td class="hm">${t.lastDone ? nzDate(t.lastDone) : '-'}</td><td>${dueBadge(t.nextDue)}</td><td>${can.write() ? `<button class="btn2 sm teal" data-done="${esc(t.id)}">Done</button>` : ''}</td></tr>`).join('') : ''; }).join('')}</table>
  ${!L.length ? '<div class="empty2">Nothing due in this window. Choose "All tasks" to see everything.</div>' : ''}` : '<div class="empty2">No maintenance tasks yet. Add them here, or import the starter maintenance plan from ☰ > Import register.</div>'}`;
  $('mQ').oninput = e => { F.q = e.target.value; maint(); $('mQ').focus(); $('mQ').setSelectionRange(F.q.length, F.q.length); };
  $('mW').onchange = e => { F.win = e.target.value; maint(); }; $('mC').onchange = e => { F.cat = e.target.value; maint(); }; $('mS').onchange = e => { F.sys = e.target.value; maint(); }; $('mR').onchange = e => { F.resp = e.target.value; maint(); };
  if ($('mNew')) $('mNew').onclick = () => editTask(null);
  if ($('mSch')) $('mSch').onclick = () => {
    modal(`<h2>Schedule undated tasks</h2><p>Each task without a due date will be first due one interval after this start date (for example, a 6-monthly task starting 1 December is first due 1 June).</p><label class="f">Start date<input type="date" id="usD" value="${esc(S.project.pcDate || todayISO())}"></label><div class="opt"><input type="checkbox" id="usNow"><label for="usNow">Make every task first due on the start date instead</label></div><div class="act"><button id="usX">Cancel</button><button class="go" id="usOk">Schedule</button></div>`);
    $('usX').onclick = closeModal;
    $('usOk').onclick = async () => { const st = $('usD').value, now = $('usNow').checked, b = busy('Scheduling…'); try { for (const t of fm().tasks.filter(t => !t.nextDue)) await S.store.patchItem(S.project.id, 'tasks', t.id, { nextDue: now || !t.freqN ? st : addFreq(st, t.freqN, t.freqUnit) }); b.done(); closeModal(); toast('Scheduled'); } catch (e) { b.done(); toast(e.message, 6000); } };
  };
  $('mIcs').onclick = exportIcs; $('mX').onclick = exportFmRegister;
  document.querySelectorAll('tr[data-id]').forEach(r => r.onclick = e => { if (e.target.closest('[data-done]')) return; editTask(fm().tasks.find(t => t.id === r.dataset.id)); });
  document.querySelectorAll('[data-done]').forEach(b => b.onclick = () => completeTask(fm().tasks.find(t => t.id === b.dataset.done)));
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
  ${(t.history || []).length ? `<h3 class="sec">History</h3><div class="hist">${t.history.slice().reverse().map(h => `<div><b>${esc(nzDate(h.date || h.t))}</b> · ${esc(h.who)}: ${esc(h.notes || 'Done')}</div>`).join('')}</div>` : ''}`,
  { ro, onSave: async () => { const o = { ...t, title: val('tT'), category: val('tC'), ss: val('tSs'), system: val('tS'), assetId: val('tA'), freqN: +val('tN') || 0, freqUnit: val('tU'), nextDue: val('tD'), responsible: val('tR'), standard: val('tStd'), instructions: val('tI'), updated: nowISO(), updatedBy: S.user.email }; if (!o.title) { toast('Enter the task'); return false; } await S.store.saveItem(S.project.id, 'tasks', o); },
    onDelete: isNew ? null : () => S.store.deleteItem(S.project.id, 'tasks', t.id) });
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
    return `<tr class="click" data-id="${esc(s.id)}"><td><b>${esc(s.ss)}</b></td><td>${esc(s.name)}<br><span class="muted small">${esc(s.location || '')}</span></td><td class="hm small">${esc(s.standard || '')}<br><span class="muted">${esc(s.inspections || '')}</span></td><td>${ts[0] ? dueBadge(ts[0].nextDue) + `<br><span class="muted small">${esc(ts[0].title)}</span>` : '<span class="muted small">No task</span>'}</td><td>${c ? `<span class="st st-ok">Received ${esc(nzDate(c.date))}</span>` : `<span class="st st-warn">Outstanding</span>`}${can.write() ? ` <button class="btn2 sm" data-12a="${esc(s.id)}">${c ? 'Update' : 'Record'}</button>` : ''}</td></tr>`; }).join('')}</table>` : '<div class="empty2">No specified systems yet. Add them from the compliance schedule (or the consent\'s AC1129 list), or import the starter list.</div>'}`;
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
function docs() {
  const Dd = fm().docs.slice().sort((a, b) => natural(a.system || 'zz', b.system || 'zz') || natural(a.title, b.title)), q = F.q.toLowerCase();
  const L = Dd.filter(d => (!F.sys || d.system === F.sys) && (!F.type || d.type === F.type) && (!q || [d.title, d.party, d.type, d.srcPath].join(' ').toLowerCase().includes(q)));
  let last = '';
  $('fmView').innerHTML = `<div class="fbar"><h2>Documents</h2><input type="search" id="dQ" placeholder="Search documents…" value="${esc(F.q)}"><select id="dS">${sysOpts(F.sys, 1).replace('<option value=""></option>', '<option value="">All systems</option>')}</select><select id="dT"><option value="">All types</option>${DOC_TYPES.map(t => `<option ${t === F.type ? 'selected' : ''}>${t}</option>`).join('')}</select>${can.write() ? '<button class="btn2 go" id="dUp">⬆ Upload files</button>' : ''}${can.edit() ? '<button class="btn2" id="dFold">🗂 Upload handover folder</button><button class="btn2" id="dLink">🔗 Add link</button>' : ''}<button class="btn2" id="dX">⬇ Index (Excel)</button></div>
  <p class="muted small">${L.length} of ${Dd.length} documents</p>
  ${L.length ? `<table class="ftable"><tr><th>Document</th><th>Type</th><th class="hm">From</th><th class="hm">Expiry</th><th class="hm">Linked to</th><th></th></tr>
  ${L.map(d => { const g = (d.system || '') !== last ? `<tr class="grp"><td colspan="6">${esc(d.system || 'Unsorted')}</td></tr>` : ''; last = d.system || ''; const al = (d.assetIds || []).map(id => fm().assets.find(a => a.id === id)).filter(Boolean);
    return g + `<tr class="click" data-id="${esc(d.id)}"><td><b>${esc(d.title)}</b>${d.link ? ' <span class="st st-info">link</span>' : ''}${d.size ? ` <span class="muted small">${(d.size / 1e6).toFixed(1)} MB</span>` : ''}</td><td class="small">${esc(d.type || '')}</td><td class="hm">${esc(d.party || '')}</td><td class="hm">${d.expiry ? dueBadge(d.expiry) : ''}</td><td class="hm small">${al.map(a => esc(a.element)).join(', ')}</td><td><button class="btn2 sm" data-open="${esc(d.id)}">Open</button></td></tr>`; }).join('')}</table>` : `<div class="empty2">${Dd.length ? 'No documents match.' : 'No documents yet. Upload the handover pack folder to bring everything in at once, filed by system and type.'}</div>`}`;
  $('dQ').oninput = e => { F.q = e.target.value; docs(); $('dQ').focus(); $('dQ').setSelectionRange(F.q.length, F.q.length); };
  $('dS').onchange = e => { F.sys = e.target.value; docs(); }; $('dT').onchange = e => { F.type = e.target.value; docs(); };
  if ($('dUp')) $('dUp').onclick = () => pickDocs({ system: F.sys });
  if ($('dFold')) $('dFold').onclick = () => $('fFolder').click();
  if ($('dLink')) $('dLink').onclick = () => editDoc(null);
  $('dX').onclick = exportFmRegister;
  document.querySelectorAll('tr[data-id]').forEach(r => r.onclick = e => { if (e.target.closest('[data-open]')) return; editDoc(fm().docs.find(d => d.id === r.dataset.id)); });
  document.querySelectorAll('[data-open]').forEach(b => b.onclick = () => openDoc(fm().docs.find(d => d.id === b.dataset.open)));
}
async function openDoc(d) { if (!d) return; const u = d.link || (d.url ? await S.store.resolveUrl(d.url) : ''); if (u) window.open(u, '_blank', 'noopener'); else toast('No file for this document'); }
function editDoc(d) {
  const isNew = !d; d = d ? JSON.parse(JSON.stringify(d)) : { id: uid(), type: 'Other', system: F.sys || '', assetIds: [], link: '' };
  const A = fm().assets.slice().sort((a, b) => natural(a.system, b.system)); const ro = !can.edit();
  const chips = () => (d.assetIds || []).map(id => { const a = A.find(x => x.id === id); return a ? `<span class="chip">${esc(a.element)}${ro ? '' : `<button data-rm="${esc(id)}">✕</button>`}</span>` : ''; }).join('') || '<span class="muted small">Not linked</span>';
  sheet(isNew ? 'Add a link' : d.title, `<div class="grid">
    ${field('Title', 'oT', d.title, '', true)}
    ${sel('Type', 'oY', opts(DOC_TYPES, d.type))}${sel('Building system', 'oS', sysOpts(d.system, 1))}
    ${field('From (company)', 'oP', d.party)}${field('Issued', 'oI', d.issued, 'type="date"')}
    ${field('Expiry (if any)', 'oE', d.expiry, 'type="date"')}${sel('Audience', 'oA', opts(['FM', 'Home user', 'Both'], d.audience || 'FM'))}
    ${d.url ? `<p class="full small muted">File: ${esc(d.fileName || '')} ${d.size ? '(' + (d.size / 1e6).toFixed(1) + ' MB)' : ''}${d.srcPath ? '<br>From: ' + esc(d.srcPath) : ''}</p>` : field('Link (SharePoint, Procore or any web address)', 'oL', d.link, 'placeholder="https://…"', true)}
  </div><h3 class="sec">Linked assets</h3><div class="chips" id="oC">${chips()}</div>
  ${ro ? '' : `<label class="f" style="margin-top:8px">Link to an asset<select id="oAdd"><option value="">Choose…</option>${A.map(a => `<option value="${esc(a.id)}">${esc(sysShort(a.system) + ' · ' + a.element)}</option>`).join('')}</select></label>`}`,
  { ro, onSave: async () => { const o = { ...d, title: val('oT'), type: val('oY'), system: val('oS'), party: val('oP'), issued: val('oI'), expiry: val('oE'), audience: val('oA'), updated: nowISO() }; if ($('oL')) o.link = val('oL'); if (!o.title) { toast('Enter a title'); return false; } if (isNew) { o.created = nowISO(); o.createdBy = S.user.email; } await S.store.saveItem(S.project.id, 'docs', o);
      if (o.assetIds && o.assetIds.length) for (const id of o.assetIds) { const a = fm().assets.find(x => x.id === id); if (a && a.status === 'Not received') await S.store.patchItem(S.project.id, 'assets', id, { status: 'Partial' }); } },
    onDelete: isNew ? null : async () => { await S.store.deleteItem(S.project.id, 'docs', d.id); if (d.path) S.store.deleteFile(d.path); } });
  const wireChips = () => document.querySelectorAll('#oC [data-rm]').forEach(b => b.onclick = () => { d.assetIds = d.assetIds.filter(x => x !== b.dataset.rm); $('oC').innerHTML = chips(); wireChips(); });
  wireChips(); if ($('oAdd')) $('oAdd').onchange = e => { if (e.target.value && !d.assetIds.includes(e.target.value)) d.assetIds.push(e.target.value); e.target.value = ''; $('oC').innerHTML = chips(); wireChips(); };
}

/* ---- uploads ---- */
let pickCtx = {}, openAssetId = null, openAssetSys = '';
export const currentModule = () => cur;
// files dropped onto an open asset sheet are uploaded as documents linked to that asset
export function assetDropTarget() { return $('sheet2').classList.contains('show') && openAssetId ? { assetIds: [openAssetId], system: openAssetSys } : null; }
export async function dropDocs(files, ctx) { const b = busy('Uploading…'); try { const ids = await uploadFiles(files, { ...ctx, onProgress: b.set }); b.done(); toast(`${ids.length} document${ids.length === 1 ? '' : 's'} uploaded`); closeSheet(); } catch (e) { b.done(); toast('Upload failed: ' + e.message, 6000); } }
function pickDocs(ctx) { pickCtx = ctx || {}; $('fDocs').click(); }
function wireUploads() {
  $('fDocs').onchange = async e => { const fs = [...e.target.files]; e.target.value = ''; if (!fs.length) return; const b = busy('Uploading…'); try { const ids = await uploadFiles(fs, { ...pickCtx, onProgress: b.set }); b.done(); toast(`${ids.length} document${ids.length > 1 ? 's' : ''} uploaded`); if (ids.length === 1 && !pickCtx.assetIds) editDoc(fm().docs.find(d => d.id === ids[0]) || null); } catch (x) { b.done(); toast('Upload failed: ' + x.message, 6000); } };
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
    const id = uid(), path = `projects/${pid}/docs/${id}/${safeName(f.name)}`;
    const url = await S.store.putFile(path, f);
    const meta = ctx.classified || {};
    const o = { id, title: typeof ctx.title === 'function' ? ctx.title(f) : (meta.title || f.name.replace(/\.[^.]+$/, '')), type: meta.type || ctx.type || guessType(f.name), system: meta.system || ctx.system || '', party: meta.party || (f.name.includes(' - ') ? f.name.split(' - ')[0] : ''), assetIds: ctx.assetIds || [], url, path, fileName: f.name, size: f.size, mime: f.type, srcPath: meta.srcPath || '', taskId: ctx.taskId || '', audience: 'FM', created: nowISO(), createdBy: S.user.email };
    const w = /\((\d+)\s*(?:yr|year)/i.exec(f.name); if (w && /warrant|deed/i.test(o.type)) o.warrantyYears = +w[1];
    await S.store.saveItem(pid, 'docs', o); ids.push(id);
    for (const aid of o.assetIds) { const a = fm().assets.find(x => x.id === aid); if (a && a.status === 'Not received') await S.store.patchItem(pid, 'assets', aid, { status: 'Partial' }); }
  }
  return ids;
}
const guessType = n => { const m = TYPE_BY_FOLDER.find(([re]) => re.test(n)); return m ? m[1] : 'Other'; };
export async function uploadFolder(files) {
  const skip = /(^|\/)(_|~\$|\.|desktop\.ini|thumbs\.db)|Defect Manager\//i;
  const list = files.filter(f => !skip.test(f.relPath || f.webkitRelativePath || f.name)).map(f => ({ f, path: f.relPath || f.webkitRelativePath || f.name }));
  const have = new Set(fm().docs.map(d => d.srcPath + '|' + d.size));
  const todo = list.filter(x => !have.has(x.path + '|' + x.f.size));
  const big = todo.filter(x => x.f.size > 150e6), mb = todo.reduce((a, x) => a + x.f.size, 0) / 1e6;
  if (!(await confirmBox(`Upload ${todo.length} documents (${mb.toFixed(0)} MB)? ${list.length - todo.length ? (list.length - todo.length) + ' already in the library will be skipped. ' : ''}${big.length ? big.length + ' over 150 MB will be skipped. ' : ''}They will be filed by building system and type from the folder names. Keep this page open until it finishes.`, 'Upload'))) return;
  const b = busy('Uploading…'); let n = 0;
  try {
    for (const x of todo) { if (x.f.size > 150e6) continue; const c = classify(x.path); c.srcPath = x.path; await uploadFiles([x.f], { classified: c, onProgress: () => b.set(`Uploading ${++n} of ${todo.length}: ${x.f.name}`) }); }
    b.done(); toast(`Uploaded ${n} documents`, 4000); setTimeout(autoLink, 1500);
  } catch (e) { b.done(); toast(`Stopped after ${n} documents: ${e.message}. Run it again to carry on; finished files are skipped.`, 8000); }
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
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Resero Property//Resero Defects//EN', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${esc2(p.name)} maintenance`, ...ev, 'END:VCALENDAR'].join('\r\n');
  return new Blob([ics], { type: 'text/calendar' });
}
