// Resero Defects - main app: sign in, projects, workspace, defect editor.
import { createStore, isDemo } from './store.js';
import { APP, STATUS_COLOURS as SCOL, ROLES } from './config.js';
import { S, can, withDefaults, unitList, saveLocal } from './state.js';
import { $, esc, toast, modal, closeModal, busy, confirmBox, opts, todayISO, nzDate, nzDT, stamp, isMobile, natural, safeName, deliver, loadImage, locate } from './util.js';
import { PlanView } from './planview.js';
import { dictate, stopDictation, holdToTalk, aiCall, aiPrompt } from './ai.js';
import { newPhoto, uploadPhotos, flushOutbox, pendingUrl, markup, initMarkup, outboxCount } from './photos.js';
import { buildPdf, buildXlsx, buildCsv, buildZip, locText, pinLabel } from './exports.js';
import * as Admin from './admin.js';
import * as FM from './fm.js';
import { initDrop } from './dnd.js';
import { helpDialog, siteCheck } from './help.js';
import * as Nav from './nav.js';
import { installDialog, maybeNag, canInstall } from './install.js';

let PV;                // plan viewer
const urlCache = {};   // resolved image URLs
async function imgUrl(u) { if (!u) return ''; if (urlCache[u]) return urlCache[u]; return (urlCache[u] = await S.store.resolveUrl(u)); }
async function photoSrc(p) { if (p.data) return p.data; if (p.pending) return await pendingUrl(p.id); return p.url ? await imgUrl(p.url) : ''; }

/* ================================================================ screens */
function show(id) { document.querySelectorAll('.screen').forEach(s => s.classList.toggle('on', s.id === id)); $('fab').style.display = id === 'scrWork' && can.edit() ? '' : 'none'; }

async function boot() {
  initMarkup();
  try { S.store = await createStore(); }
  catch (e) { console.error(e); document.body.innerHTML = '<p style="padding:20px">The app could not start: ' + esc(e.message) + '</p>'; return; }
  if (isDemo()) document.title = 'Resero Defects (demo)';
  $('sGoogle').onclick = async () => { try { await S.store.signInGoogle(); } catch (e) { $('sMsg').textContent = friendly(e); } };
  $('sLink').onclick = async () => { const e = $('sEmail').value.trim(); if (!/^\S+@\S+\.\S+$/.test(e)) { $('sMsg').textContent = 'Enter your email address first.'; return; } try { await S.store.sendLink(e); $('sMsg').innerHTML = 'Check your inbox for an email from Firebase / ' + esc(APP.name) + ', and open the link <b>on this device</b>.'; } catch (x) { $('sMsg').textContent = friendly(x); } };
  show('scrSign');
  try { await S.store.completeLink(); } catch (e) { $('sMsg').textContent = friendly(e); }
  S.store.onAuth(async u => {
    S.user = u;
    if (!u) { cleanupProject(); show('scrSign'); $('signChecking').style.display = 'none'; $('signForm').style.display = ''; return; }
    S.sup = await S.store.isSuper();
    try { const n = await S.store.claimInvites(); if (n) toast('You have been added to ' + n + ' project' + (n > 1 ? 's' : '')); } catch (e) { console.warn(e); }
    const last = S.local.lastProject;
    if (last && (await openProject(last, true))) return;
    showProjects();
  });
  addEventListener('online', () => { netbar(); flushOutbox(); }); addEventListener('offline', netbar);
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  wire();
}
function friendly(e) { const c = (e && e.code) || ''; if (/popup-closed/.test(c)) return 'Sign-in window was closed.'; if (/unauthorized-domain/.test(c)) return 'This web address is not authorised in Firebase (Authentication > Settings > Authorised domains).'; if (/operation-not-allowed/.test(c)) return 'This sign-in method is not turned on in Firebase yet.'; if (/invalid-action-code|expired/.test(c)) return 'That sign-in link has expired or been used. Ask for a new one.'; return (e && e.message) || String(e); }
async function netbar() { const n = await outboxCount(); const b = $('netbar'); b.textContent = !navigator.onLine ? 'Offline: changes are saved on this device and will sync when you are back online' + (n ? ` (${n} photo${n > 1 ? 's' : ''} waiting)` : '') : (n ? `Uploading ${n} photo${n > 1 ? 's' : ''}…` : ''); b.classList.toggle('show', !navigator.onLine || n > 0); }

/* ================================================================ projects */
export async function showProjects() {
  cleanupProject(); delete S.local.lastProject; saveLocal(); show('scrProjects');
  $('pUser').textContent = S.user.email + (S.sup ? ' · System admin' : '') + (isDemo() ? ' · DEMO' : '');
  $('plist').innerHTML = '<div class="empty">Loading projects…</div>';
  let list = [];
  try { list = await S.store.listProjects(); } catch (e) { $('plist').innerHTML = `<div class="empty">Could not load projects: ${esc(friendly(e))}</div>`; return; }
  list.sort((a, b) => natural(a.name, b.name)); maybeNag();
  const cards = await Promise.all(list.map(async p => `<div class="pcard" data-id="${esc(p.id)}"><div class="cl">${p.clientLogo ? `<img src="${esc(await imgUrl(p.clientLogo))}" alt="">` : ''}<span>${esc(p.client || '')}</span></div><h3>${esc(p.name)}</h3><div class="muted small">${esc(p.address || '')}</div><div><span class="role">${esc(ROLES[(p.members || {})[S.user.uid]] || (S.sup ? 'System admin' : ''))}</span>${p.archived ? ' <span class="tag">Archived</span>' : ''}</div></div>`));
  $('plist').innerHTML = cards.join('') + (S.sup ? '<div class="pcard new" id="pNew">+ New project</div><div class="pcard new" id="pPack" style="border-color:var(--teal)">⬇ Set up from a project pack<small style="font-weight:400;color:var(--muted)">or drag the .json file onto this page</small></div><input type="file" id="fPack" accept=".json" hidden>' : '') + (!list.length && !S.sup ? `<div class="empty">You have not been added to any projects yet.<br>Ask the project administrator to invite <b>${esc(S.user.email)}</b>.<br><br><span class="small">Your user ID: <span class="codebox">${esc(S.user.uid)}</span></span></div>` : '');
  $('plist').querySelectorAll('.pcard[data-id]').forEach(c => c.onclick = () => openProject(c.dataset.id));
  if ($('pNew')) $('pNew').onclick = () => Admin.projectSettings(null);
  if ($('pPack')) { $('pPack').onclick = () => $('fPack').click(); $('fPack').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) Admin.importJson(f); }; }
}

function cleanupProject() { FM.stop(); if (S.unsub) { S.unsub(); S.unsub = null; } S.project = null; S.defects = []; S.plans = []; S.sel = null; }
export async function openProject(pid, quiet) {
  const b = quiet ? null : busy('Opening project…');
  try {
    const p = await S.store.getProject(pid);
    if (!p) { b && b.done(); if (!quiet) toast('Project not found or no access'); return false; }
    cleanupProject();
    S.project = withDefaults(p); S.role = (p.members || {})[S.user.uid] || (S.sup ? 'admin' : '');
    if (!S.role) { b && b.done(); return false; }
    S.local.lastProject = pid; saveLocal();
    S.plans = await S.store.listPlans(pid);
    S.ai = can.write() ? await S.store.getPrivate(pid) : {};
    S.curPlan = S.plans[0] ? S.plans[0].id : null;
    show('scrWork'); applyProjectChrome(); initFilters(); renderPlanTabs();
    await showPlan(S.curPlan);
    S.unsub = S.store.watchDefects(pid, list => { S.defects = list; filtersDirty = true; render(); flushOutbox().then(netbar); }, e => toast('Sync problem: ' + friendly(e), 5000));
    FM.start(pid); setTab('list'); b && b.done(); return true;
  } catch (e) { b && b.done(); console.error(e); if (!quiet) toast('Could not open the project: ' + friendly(e), 5000); return false; }
}
export async function reloadProject() { const p = await S.store.getProject(S.project.id); S.project = withDefaults(p); S.plans = await S.store.listPlans(p.id); if (!S.plans.find(x => x.id === S.curPlan)) S.curPlan = S.plans[0] ? S.plans[0].id : null; applyProjectChrome(); initFilters(); renderPlanTabs(); await showPlan(S.curPlan); render(); }
function applyProjectChrome() {
  const p = S.project; $('wTitle').firstChild.textContent = p.name; $('wSub').textContent = [p.address, p.client, ROLES[S.role] + (S.sup && S.role !== 'admin' ? ' (system admin)' : '')].filter(Boolean).join(' · ');
  $('bNew').style.display = can.edit() ? '' : 'none'; $('fab').style.display = can.edit() ? '' : 'none';
}

/* ================================================================ filters & list */
function fillSel(id, first, arr, v) { $(id).innerHTML = `<option value="">${first}</option>` + arr.map(a => `<option ${a === v ? 'selected' : ''} value="${esc(a)}">${esc(a)}</option>`).join(''); }
function initFilters() {
  const p = S.project, F = S.F, D = S.defects;
  const blocks = [...new Set([...S.plans.map(x => x.block), ...D.map(d => d.block)].filter(Boolean))].sort(natural);
  const levels = [...new Set([...S.plans.map(x => x.level), ...D.map(d => d.level)].filter(Boolean))];
  const units = [...new Set([...unitList(p), ...D.map(d => d.unit).filter(Boolean).map(String)])].sort(natural);
  fillSel('fBlock', 'All blocks', blocks, F.block); fillSel('fLevel', 'All levels', levels, F.level);
  $('fUnit').innerHTML = '<option value="">All units</option><option value="-">Common / no unit</option>' + units.map(u => `<option ${u === F.unit ? 'selected' : ''}>${esc(u)}</option>`).join('');
  fillSel('fSev', 'All severities', p.severities, F.sev); fillSel('fTrade', 'All trades', p.trades, F.trade);
  fillSel('fResp', 'All responsible', [...new Set([...p.responsible, ...D.map(d => d.responsible).filter(Boolean)])], F.resp);
}
let filtersDirty = true;
export function filtered() {
  const F = S.F, q = F.q.trim().toLowerCase();
  const r = S.defects.filter(d => F.status.has(d.status) && (!F.block || d.block === F.block) && (!F.level || d.level === F.level) && (!F.unit || (F.unit === '-' ? !d.unit : String(d.unit) === F.unit)) && (!F.sev || d.severity === F.sev) && (!F.trade || d.trade === F.trade) && (!F.resp || d.responsible === F.resp) && (!q || [d.id, d.title, d.desc, d.element, d.room, 'unit ' + d.unit, d.trade, d.action, d.extRef, d.responsible].join(' ').toLowerCase().includes(q)));
  const ns = (a, b) => natural(a.id, b.id), pre = S.project.idPrefix + '-';
  if (F.sort === 'upd') r.sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));
  else if (F.sort === 'loc') r.sort((a, b) => natural(a.block || 'z', b.block || 'z') || (a.level || '').localeCompare(b.level || '') || natural(a.unit || 'zzz', b.unit || 'zzz') || ns(a, b));
  else if (F.sort === 'sev') r.sort((a, b) => S.project.severities.indexOf(a.severity) - S.project.severities.indexOf(b.severity) || ns(a, b));
  else r.sort((a, b) => (a.id.startsWith(pre) === b.id.startsWith(pre)) ? ns(a, b) : (a.id.startsWith(pre) ? -1 : 1));
  return r;
}
export async function render() {
  if (!S.project) return;
  if (filtersDirty) { initFilters(); filtersDirty = false; }
  const D = S.defects, c = {}; S.project.statuses.forEach(s => c[s] = 0); D.forEach(d => c[d.status] = (c[d.status] || 0) + 1);
  const maj = D.filter(d => d.status !== 'Closed' && /^Major/.test(d.severity || '')).length, tri = D.filter(d => d.status !== 'Closed' && d.severity === 'To triage').length;
  $('counts').innerHTML = S.project.statuses.map(s => `<button class="cnt ${S.F.status.has(s) ? 'on' : ''}" data-s="${s}"><i style="background:${SCOL[s]}"></i>${s} <b>${c[s]}</b></button>`).join('') + `<span class="cnt">Major <b>${maj}</b>${tri ? ` · To triage <b>${tri}</b>` : ''}</span>`;
  $('counts').querySelectorAll('button').forEach(b => b.onclick = () => { const s = b.dataset.s; S.F.status.has(s) ? S.F.status.delete(s) : S.F.status.add(s); render(); });
  const L = filtered();
  $('lmeta').textContent = L.length + ' of ' + D.length + ' shown';
  $('list').innerHTML = L.length ? L.map(d => { const sev = /^Major/.test(d.severity || '') ? 'sev-maj' : d.severity === 'To triage' ? 'sev-tri' : ''; const ph = (d.photos || [])[0];
    return `<div class="card ${S.sel === d.id ? 'sel' : ''}" style="--c:${SCOL[d.status] || '#999'}" data-id="${esc(d.id)}">${ph ? `<img class="th" data-ph="${esc(d.id)}" alt="">` : ''}<div class="b"><div class="t">${esc(d.id)} · ${esc(d.title || d.element || '(untitled)')}</div><div class="d">${esc(d.desc)}</div><div class="m"><span class="pill" style="background:${SCOL[d.status] || '#999'}">${esc(d.status)}</span>${d.severity ? `<span class="tag ${sev}">${esc(d.severity)}</span>` : ''}${locText(d) ? `<span class="tag">${esc(locText(d))}</span>` : ''}${d.trade ? `<span class="tag">${esc(d.trade)}</span>` : ''}${d.plan ? '<span class="tag" title="Pinned on a plan">📍</span>' : ''}${(d.photos || []).length ? `<span class="tag">📷 ${d.photos.length}</span>` : ''}</div></div></div>`; }).join('') : `<div class="empty">${D.length ? 'No defects match these filters.' : 'No defects yet.' + (can.edit() ? ' Tap the microphone or + New to raise one, or import a register from the ☰ menu.' : '')}</div>`;
  $('list').querySelectorAll('.card').forEach(el => el.onclick = () => { const d = S.defects.find(x => x.id === el.dataset.id); S.sel = d.id; if (d.plan && !isMobile()) showPlan(d.plan, d); render(); openEditor(d); });
  // thumbnails load lazily
  $('list').querySelectorAll('img[data-ph]').forEach(async im => { const d = S.defects.find(x => x.id === im.dataset.ph); if (d && d.photos[0]) im.src = await photoSrc(d.photos[0]); });
  renderPins();
}
function renderPins() {
  if (!PV || !S.project) return; const ids = new Set(filtered().map(d => d.id));
  PV.setPins(S.defects.filter(d => d.plan === S.curPlan && d.x != null && ids.has(d.id)).map(d => ({ id: d.id, x: d.x, y: d.y, colour: SCOL[d.status] || '#999', label: pinLabel(d), sel: S.sel === d.id, title: d.id + ' ' + (d.title || '') })));
}

/* ================================================================ plans */
let placing = null;
function renderPlanTabs() {
  const pt = $('plantabs');
  pt.innerHTML = S.plans.map(p => `<button data-p="${esc(p.id)}" class="${p.id === S.curPlan ? 'on' : ''}">${esc(p.name)}</button>`).join('') +
    (S.plans.length ? '<span class="sp"></span>' + (can.edit() ? '<button class="act" id="bPin">📍 Add pin</button>' : '') : (can.admin() ? '<span class="muted small">No plans yet.</span><button class="act" id="bUpPlan">Upload plans</button>' : '<span class="muted small">No plans uploaded for this project yet.</span>'));
  pt.querySelectorAll('[data-p]').forEach(b => b.onclick = () => showPlan(b.dataset.p));
  if ($('bPin')) $('bPin').onclick = () => placing ? stopPlacing() : startPlacing({ mode: 'new' });
  if ($('bUpPlan')) $('bUpPlan').onclick = () => Admin.plansDialog();
}
export async function showPlan(id, focus) {
  if (Admin.zoneActive() && id !== S.curPlan) { if (!(await Admin.zoneSwitch(id))) return; }
  S.curPlan = id; const p = S.plans.find(x => x.id === id) || null;
  $('plantabs').querySelectorAll('[data-p]').forEach(b => b.classList.toggle('on', b.dataset.p === id));
  await PV.setPlan(p, p ? await imgUrl(p.img) : ''); PV.setZonesVisible(false);
  if (Admin.zoneActive()) { await Admin.zoneEditor(PV); }
  renderPins(); if (isMobile() && focus) setTab('plan');
  if (focus && focus.x != null) requestAnimationFrame(() => PV.focus(focus.x, focus.y));
}
function startPlacing(pl) {
  placing = pl; PV.setMode('place', (pl.mode === 'new' ? 'Tap the plan where the defect is' : 'Tap the plan to set the location of ' + esc(pl.draft.id)) + '<button id="bnC">Cancel</button>');
  $('bnC').onclick = () => { const p = placing; stopPlacing(); if (p && p.draft) openEditor(p.draft, p.isNew, true); };
  if ($('bPin')) { $('bPin').classList.add('on'); $('bPin').textContent = '✕ Cancel pin'; }
}
function stopPlacing() { placing = null; PV.setMode('view'); if ($('bPin')) { $('bPin').classList.remove('on'); $('bPin').textContent = '📍 Add pin'; } }
function applyZone(d, x, y, planId) {
  const p = S.plans.find(q => q.id === planId); d.plan = planId; d.x = x; d.y = y;
  const hit = locate(p.zones, x, y);
  if (hit) { if (hit.unit) d.unit = hit.unit; if (hit.room) d.room = hit.room; d.block = hit.block || p.block || d.block; d.level = hit.level || p.level || d.level; d.zoneHit = [hit.unit && 'Unit ' + hit.unit, hit.room].filter(Boolean).join(', '); }
  else { d.block = p.block || d.block; d.level = p.level || d.level; d.zoneHit = ''; }
}
async function onPlace(x, y) {
  const pl = placing; stopPlacing();
  if (pl.mode === 'new') { const d = await newDefect(); applyZone(d, x, y, S.curPlan); openEditor(d, true, true); }
  else { applyZone(pl.draft, x, y, S.curPlan); openEditor(pl.draft, pl.isNew, true); }
}
export function setTab(t) { if (t === 'plan' && isMobile() && !Nav.isOpen('plantab')) Nav.open('plantab', () => setTab('list')); if (t === 'list') Nav.closed('plantab'); $('main').className = 'tab-' + t; document.querySelectorAll('#mtabs button').forEach(b => b.classList.toggle('on', b.dataset.t === t)); if (t === 'plan') requestAnimationFrame(() => { if (!PV.pv.user) PV.fit(); }); }
// find a room boundary from a unit + room name (used after dictation, so the pin can be dropped automatically)
function findZone(unit, room) {
  const r = String(room || '').toLowerCase().replace(/\s+\d+$/, '');
  for (const p of S.plans) for (const z of (p.zones || [])) {
    if (!z.poly || z.kind === 'unit') continue; const c = centroid(z.poly); const hit = locate(p.zones, c[0], c[1]) || {};
    if (unit && String(hit.unit) !== String(unit)) continue; if (!unit && hit.unit) continue;
    if (r && String(z.name || '').toLowerCase().startsWith(r)) return { plan: p, zone: z, x: c[0], y: c[1] };
  }
  if (unit) for (const p of S.plans) for (const z of (p.zones || [])) if (z.kind === 'unit' && String(z.unit) === String(unit)) { const c = centroid(z.poly); return { plan: p, zone: z, x: c[0], y: c[1], unitOnly: true }; }
  return null;
}
const centroid = poly => { let x = 0, y = 0; poly.forEach(p => { x += p[0]; y += p[1]; }); return [x / poly.length, y / poly.length]; };
function unitInfo(u) { for (const p of S.plans) for (const z of (p.zones || [])) if (z.kind === 'unit' && String(z.unit) === String(u)) return { block: z.block || p.block, level: z.level || p.level }; return null; }

/* ================================================================ editor */
let ED = null;
const FIELDS = ['source', 'dateRaised', 'block', 'level', 'unit', 'room', 'element', 'title', 'desc', 'type', 'severity', 'trade', 'responsible', 'action', 'targetDate', 'status'];
async function newDefect() {
  const p = S.project;
  return { id: '', isNew: true, source: S.local.source || p.sources[0], dateRaised: todayISO(), raisedBy: S.user.name, block: '', level: '', unit: '', room: '', element: '', title: '', desc: '', type: p.types[0], severity: p.severities.includes('Minor defect') ? 'Minor defect' : p.severities[0], trade: p.trades[0], responsible: p.responsible[0], action: '', targetDate: '', status: 'Open', plan: '', x: null, y: null, photos: [], history: [], transcript: '' };
}
export function openEditor(d, isNew, isDraft) {
  const w = isDraft ? d : JSON.parse(JSON.stringify(d)); const p = S.project;
  ED = { d: w, isNew: !!isNew, orig: isNew ? null : S.defects.find(x => x.id === d.id) };
  const ro = !can.edit(), con = can.contractor();
  const dis = ro || con ? 'disabled' : '';
  $('edTitle').textContent = isNew ? 'New defect' : w.id;
  const units = [...new Set([...unitList(p), ...(w.unit ? [String(w.unit)] : [])])];
  const stat = con ? p.statuses.filter(s => ['Open', 'In progress', 'Ready for review'].includes(s) || s === w.status) : p.statuses;
  $('edBody').innerHTML = `
  ${!ro && !con ? `<div class="dict">
    <div class="row1"><button class="mic" id="mic" title="Hold to talk"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-2.08A7 7 0 0 0 19 12h-2z"/></svg></button>
    <textarea id="dt" placeholder="Hold the mic and say it how you would on site, e.g. &quot;Unit 7 bathroom, silicone to the shower tray is patchy and there's a gap behind the vanity, contractor to redo before handover&quot;">${esc(w.transcript || '')}</textarea></div>
    <div class="row2"><button class="ai" id="aiGo">✨ Interpret with Gemini</button><label><input type="checkbox" id="aiPh" checked> include first photo</label><span id="aiSt" class="muted"></span></div>
    <div class="ainote" id="aiNote"></div></div>` : ''}
  ${con ? '<p class="note muted small">As the contractor you can update the status, add photos and add comments. Other changes are made by the project team.</p>' : ''}
  <div class="grid">
    <label class="f full">Title<input name="title" value="${esc(w.title)}" ${dis} placeholder="Short name, e.g. Shower tray silicone incomplete"></label>
    <label class="f full">Description<textarea name="desc" ${dis}>${esc(w.desc)}</textarea></label>
    <label class="f full">Action required<textarea name="action" style="min-height:44px" ${dis}>${esc(w.action)}</textarea></label>
  </div>
  <h3 class="sec">Location</h3>
  <div class="grid">
    <label class="f">Unit<select name="unit" ${dis}><option value="">Common / none</option>${units.map(u => `<option ${String(w.unit) === u ? 'selected' : ''}>${esc(u)}</option>`).join('')}</select></label>
    <label class="f">Room / area<input name="room" value="${esc(w.room)}" list="rooms" ${dis}></label>
    <label class="f">Block<input name="block" value="${esc(w.block)}" list="blocks" ${dis}></label>
    <label class="f">Level<input name="level" value="${esc(w.level)}" list="levels" ${dis}></label>
    <label class="f full">Element / product<input name="element" value="${esc(w.element)}" ${dis} placeholder="e.g. Shower tray, cladding, fire door"></label>
  </div>
  <datalist id="rooms">${[...new Set([...S.plans.flatMap(pl => (pl.zones || []).filter(z => z.kind !== 'unit' && z.name).map(z => z.name)), ...p.rooms])].map(r => `<option>${esc(r)}</option>`).join('')}</datalist>
  <datalist id="blocks">${[...new Set(S.plans.map(x => x.block).filter(Boolean))].map(r => `<option>${esc(r)}</option>`).join('')}</datalist>
  <datalist id="levels">${[...new Set(S.plans.map(x => x.level).filter(Boolean))].map(r => `<option>${esc(r)}</option>`).join('')}</datalist>
  <div class="locbox" style="margin-top:8px"><canvas id="locC" width="300" height="200"></canvas><div><div id="locT" style="margin-bottom:6px"></div>${!ro && !con && S.plans.length ? `<button class="mini" id="setPin">📍 ${w.plan ? 'Move pin' : 'Pin on plan'}</button> ${w.plan ? '<button class="mini" id="clrPin">Remove pin</button>' : ''}` : ''}${w.plan && !ED.isNew ? ' <button class="mini" id="goPin">Show on plan</button>' : ''}</div></div>
  <h3 class="sec">Classification</h3>
  <div class="grid">
    <label class="f">Status<select name="status" ${ro ? 'disabled' : ''}>${opts(stat, w.status)}</select></label>
    <label class="f">Severity<select name="severity" ${dis}>${opts(p.severities, w.severity)}</select></label>
    <label class="f">Type<select name="type" ${dis}>${opts(p.types, w.type)}</select></label>
    <label class="f">Trade<select name="trade" ${dis}>${opts(p.trades, w.trade)}</select></label>
    <label class="f">Responsible<select name="responsible" ${dis}>${opts(p.responsible, w.responsible)}</select></label>
    <label class="f">Target date<input type="date" name="targetDate" value="${esc(w.targetDate)}" ${dis}></label>
    <label class="f">Source<select name="source" ${dis}>${opts(p.sources, w.source)}</select></label>
    <label class="f">Date raised<input type="date" name="dateRaised" value="${esc(w.dateRaised)}" ${dis}></label>
  </div>
  <h3 class="sec">Photos <span class="sp"></span>${!ro ? '<span class="muted small" style="text-transform:none;letter-spacing:0;font-weight:400">Tap a photo to mark it up</span>' : ''}</h3>
  <div class="photos" id="phs"></div>
  <h3 class="sec">Comments and history</h3>
  ${!ro ? '<label class="f"><textarea id="cmt" style="min-height:44px" placeholder="Add a comment (saved with your name and the time)"></textarea></label>' : ''}
  <div class="hist">${(w.history || []).slice().reverse().map(h => `<div><b>${esc(nzDT(h.t))}</b> · ${esc(h.who)}: ${esc(h.txt)}</div>`).join('') || '<div>No history yet.</div>'}</div>
  ${w.ext ? `<details class="ext"><summary>Original record (${esc(w.extRef || w.source)})</summary>${Object.entries(w.ext).filter(e => e[1]).map(([k, v]) => `<p><b>${esc(k)}:</b> ${esc(v)}</p>`).join('')}</details>` : ''}`;
  const body = $('edBody');
  body.querySelector('[name=unit]').onchange = e => { const u = unitInfo(e.target.value); if (u) { if (u.block) body.querySelector('[name=block]').value = u.block; if (u.level) body.querySelector('[name=level]').value = u.level; } };
  if ($('mic')) { holdToTalk($('mic'), () => dictate($('dt'), $('mic'), aiStatus, () => { if (S.local.autoAI !== false) interpret(); })); $('aiGo').onclick = interpret; }
  if ($('setPin')) $('setPin').onclick = () => { collect(); const pl = { mode: 'edit', draft: ED.d, isNew: ED.isNew }; const tgt = ED.d.plan || (S.plans.find(x => x.block === ED.d.block && x.level === ED.d.level) || {}).id || S.curPlan; closeEditor(true); showPlan(tgt); setTab('plan'); startPlacing(pl); };
  if ($('clrPin')) $('clrPin').onclick = () => { collect(); ED.d.plan = ''; ED.d.x = ED.d.y = null; ED.d.zoneHit = ''; openEditor(ED.d, ED.isNew, true); };
  if ($('goPin')) $('goPin').onclick = () => { const d = ED.d; closeEditor(); showPlan(d.plan, d); setTab('plan'); };
  drawLoc(); renderPhotos();
  $('edDel').style.display = isNew || !can.admin() ? 'none' : ''; $('edSave').style.display = ro ? 'none' : '';
  $('edCancel').textContent = ro ? 'Close' : 'Cancel';
  if (!$('sheet').classList.contains('show')) Nav.open('editor', () => closeEditor());
  $('sheet').classList.add('show');
}
function aiStatus(m, err) { const s = $('aiSt'); if (s) { s.textContent = m || ''; s.style.color = err ? '#b00000' : ''; } if (err && m) toast(m, 5000); }
async function drawLoc() {
  const d = ED.d, c = $('locC'), x = c.getContext('2d'); const p = S.plans.find(q => q.id === d.plan);
  $('locT').innerHTML = esc(locText(d) || 'No location yet') + (p ? ' · ' + esc(p.name) : '') + (d.zoneHit ? `<br><span class="zonehit">Found: ${esc(d.zoneHit)}</span>` : '');
  if (!p || d.x == null) { c.style.display = 'none'; return; } c.style.display = '';
  try { const im = await loadImage(await imgUrl(p.img)); const W = c.width, H = c.height, s = 3 * W / p.w, cx = d.x * p.w * s, cy = d.y * p.h * s; x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); x.drawImage(im, W / 2 - cx, H / 2 - cy, p.w * s, p.h * s); x.fillStyle = SCOL[d.status] || '#d64545'; x.beginPath(); x.arc(W / 2, H / 2, 9, 0, 7); x.fill(); x.strokeStyle = '#fff'; x.lineWidth = 2; x.stroke(); }
  catch (e) { c.style.display = 'none'; }
}
async function renderPhotos() {
  const w = ED.d, ro = !can.write();
  $('phs').innerHTML = (w.photos || []).map((p, i) => `<div class="ph"><img data-i="${i}" alt="">${!ro && (can.edit() || p.isNew) ? `<button data-x="${i}">✕</button>` : ''}${p.pending ? '<span class="pend">waiting</span>' : ''}</div>`).join('') + (!ro ? '<div class="addph" id="addph">📷<span>Add photo</span></div>' : '');
  $('phs').querySelectorAll('img').forEach(async im => { const p = w.photos[+im.dataset.i]; im.src = await photoSrc(p); im.onclick = () => ro ? window.open(im.src, '_blank') : markup(im.src, data => { const old = w.photos[+im.dataset.i]; w.photos[+im.dataset.i] = { id: Math.random().toString(36).slice(2, 10), data, t: new Date().toISOString(), by: S.user.name, isNew: true, replaces: old.path || undefined }; renderPhotos(); }); });
  $('phs').querySelectorAll('button[data-x]').forEach(b => b.onclick = async () => { if (await confirmBox('Remove this photo?', 'Remove')) { const [p] = w.photos.splice(+b.dataset.x, 1); if (p.path) (ED.removed = ED.removed || []).push(p.path); renderPhotos(); } });
  if ($('addph')) $('addph').onclick = () => $('fPhoto').click();
}
function collect() { const b = $('edBody'); FIELDS.forEach(f => { const el = b.querySelector(`[name=${f}]`); if (el) ED.d[f] = el.value; }); if ($('dt')) ED.d.transcript = $('dt').value; return ED.d; }
function closeEditor(keep) { stopDictation(); $('sheet').classList.remove('show'); if (!keep) ED = null; Nav.closed('editor'); }
async function saveEditor() {
  const d = collect(); const who = S.user.name, t = new Date().toISOString(), pid = S.project.id, newH = [];
  if (!d.title && !d.desc) { toast('Add a title or description first'); return; }
  if (!d.title) d.title = d.desc.split(/[.,;]/)[0].slice(0, 70);
  const b = busy('Saving…');
  try {
    if (ED.isNew) { d.id = await S.store.nextRef(pid, S.project.idPrefix); for (let k = 0; k < 50 && S.defects.some(x => x.id === d.id); k++) d.id = await S.store.nextRef(pid, S.project.idPrefix); }
    d.photos = await uploadPhotos(pid, d.id, d.photos || []);
    (ED.removed || []).forEach(p => S.store.deleteFile(p));
    const cm = $('cmt') ? $('cmt').value.trim() : '';
    const clean = o => { const c = { ...o }; delete c.isNew; delete c.zoneHit; c.photos = (c.photos || []).map(p => { const q = { ...p }; delete q.data; delete q.isNew; return q; }); return c; };
    if (ED.isNew) {
      newH.push({ t, who, txt: 'Raised (' + d.source + '). Status ' + d.status + '.' }); if (cm) newH.push({ t, who, txt: cm });
      const rec = clean({ ...d, created: t, createdBy: S.user.email, updated: t, updatedBy: S.user.email, history: newH });
      await S.store.createDefect(pid, rec);
    } else {
      const o = ED.orig || {}, patch = {}, ch = [];
      const keys = can.contractor() ? ['status'] : [...FIELDS, 'plan', 'x', 'y', 'transcript'];
      keys.forEach(k => { if ((o[k] ?? '') !== (d[k] ?? '')) patch[k] = d[k] ?? null; });
      ['status', 'severity', 'responsible', 'targetDate', 'unit', 'room', 'title'].forEach(k => { if (k in patch) ch.push(k === 'targetDate' ? 'target date ' + (nzDate(d[k]) || 'cleared') : k + ' ' + (o[k] || '-') + ' → ' + (d[k] || '-')); });
      if ('plan' in patch || 'x' in patch) ch.push('pin ' + (d.plan ? 'moved' : 'removed'));
      const ph = clean(d).photos; if (JSON.stringify(ph) !== JSON.stringify(o.photos || [])) { patch.photos = ph; ch.push('photos ' + (o.photos || []).length + ' → ' + ph.length); }
      if (ch.length) newH.push({ t, who, txt: 'Changed ' + ch.join('; ') + '.' }); if (cm) newH.push({ t, who, txt: cm });
      if (!Object.keys(patch).length && !newH.length) { b.done(); closeEditor(); return; }
      patch.updated = t; patch.updatedBy = S.user.email;
      await S.store.updateDefect(pid, d.id, patch, newH);
    }
    S.sel = d.id; b.done(); closeEditor(); toast(d.id + ' saved'); netbar();
  } catch (e) { b.done(); console.error(e); toast('Could not save: ' + friendly(e), 6000); }
}
async function deleteDefect() {
  if (!ED || ED.isNew) return; if (!(await confirmBox(`Delete ${ED.d.id}? This cannot be undone.`, 'Delete'))) return;
  try { await S.store.deleteDefect(S.project.id, ED.d.id); (ED.d.photos || []).forEach(p => p.path && S.store.deleteFile(p.path)); closeEditor(); toast('Deleted'); } catch (e) { toast('Could not delete: ' + friendly(e)); }
}
function step(dir) { if (!ED || ED.isNew) return; const L = filtered(); const i = L.findIndex(x => x.id === ED.d.id); const n = L[i + dir]; if (n) { S.sel = n.id; openEditor(n); renderPins(); } }

/* ---- Gemini ---- */
const AIMAP = { title: 'title', description: 'desc', action: 'action', unit: 'unit', room: 'room', block: 'block', level: 'level', element: 'element', type: 'type', severity: 'severity', trade: 'trade', responsible: 'responsible', status: 'status', targetDate: 'targetDate' };
async function interpret() {
  const text = $('dt').value.trim(); if (!text) { toast('Say or type the defect first'); return; }
  const cur = collect(); const btn = $('aiGo'); btn.disabled = true; aiStatus('Asking Gemini…'); $('aiNote').classList.remove('show');
  try {
    const ph = $('aiPh').checked && cur.photos[0] ? await photoSrc(cur.photos[0]) : null;
    const raw = await aiCall(aiPrompt(text, cur), ph && ph.startsWith('data:') ? ph : null);
    let o; try { o = JSON.parse(String(raw).replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch (e) { throw new Error('Gemini sent back something I could not read. Try again.'); }
    const list = Array.isArray(o) ? o : (o.defects || [o]); if (!list.length) throw new Error('Gemini did not find a defect in that note.');
    applyAI(list[0]);
    const extra = list.slice(1), qs = (o.questions || []).filter(Boolean); let h = '';
    if (qs.length) h += '<b>Check:</b> ' + qs.map(esc).join(' · ');
    if (extra.length) h += (h ? '<br>' : '') + `<b>${extra.length} more defect${extra.length > 1 ? 's' : ''} heard:</b> ` + extra.map(x => esc(x.title)).join(' · ') + `<br><button id="aiMore">Add ${extra.length > 1 ? 'them' : 'it'} as separate defect${extra.length > 1 ? 's' : ''}</button>`;
    if (h) { $('aiNote').innerHTML = h; $('aiNote').classList.add('show'); if ($('aiMore')) $('aiMore').onclick = () => addExtra(extra); }
    $('dt').value = ''; $('dt').dispatchEvent(new Event('input')); aiStatus('Filled in. Check and save.');
  } catch (e) { if (e.message === 'nokey') { aiStatus(''); Admin.aiSettings('Set up Gemini to use the interpreter.'); } else aiStatus(e.message, true); }
  finally { btn.disabled = false; }
}
function applyAI(x) {
  const b = $('edBody');
  Object.entries(AIMAP).forEach(([k, f]) => { let v = x[k]; if (v == null || v === '') return; v = String(v).replace(/—/g, ', '); const el = b.querySelector(`[name=${f}]`); if (!el) return;
    if (el.tagName === 'SELECT' && ![...el.options].some(o => o.value === v)) { const o = document.createElement('option'); o.textContent = v; el.appendChild(o); }
    el.value = v; el.classList.remove('aifill'); void el.offsetWidth; el.classList.add('aifill'); });
  collect(); const d = ED.d;
  if (d.unit) { const u = unitInfo(d.unit); if (u) { if (!x.block && u.block) d.block = b.querySelector('[name=block]').value = u.block; if (!x.level && u.level) d.level = b.querySelector('[name=level]').value = u.level; } }
  if (!d.plan) { const z = findZone(d.unit, d.room); if (z) { applyZone(d, z.x, z.y, z.plan.id); d.zoneHit = (z.unitOnly ? 'Pinned at the centre of Unit ' + d.unit : 'Pinned in ' + d.zoneHit) + ' (move it if needed)'; } }
  drawLoc();
}
async function addExtra(extra) {
  const base = collect(); const t = new Date().toISOString(), made = [];
  for (const x of extra) {
    const d = await newDefect(); Object.entries(AIMAP).forEach(([k, f]) => { if (x[k]) d[f] = String(x[k]).replace(/—/g, ', '); });
    ['unit', 'room', 'block', 'level'].forEach(k => { if (!x[k]) d[k] = base[k]; }); d.source = base.source; d.dateRaised = base.dateRaised;
    const z = findZone(d.unit, d.room); if (z) applyZone(d, z.x, z.y, z.plan.id); else if (base.plan) { d.plan = base.plan; d.x = base.x; d.y = base.y; }
    d.id = await S.store.nextRef(S.project.id, S.project.idPrefix); for (let k = 0; k < 50 && S.defects.some(x => x.id === d.id); k++) d.id = await S.store.nextRef(S.project.id, S.project.idPrefix); d.transcript = base.transcript; delete d.isNew; delete d.zoneHit;
    d.created = d.updated = t; d.createdBy = d.updatedBy = S.user.email; d.history = [{ t, who: S.user.name, txt: 'Raised (' + d.source + ') from the same dictation as the item being edited.' }];
    await S.store.createDefect(S.project.id, d); made.push(d.id);
  }
  $('aiNote').innerHTML = 'Added ' + made.join(', ') + '.';
}

/* ================================================================ export */
export function getBytes(u) { return (async () => { const src = u.startsWith('data:') ? u : await imgUrl(u); const r = await fetch(src); if (!r.ok) throw new Error('fetch ' + r.status); return await r.arrayBuffer(); })(); }
function openExport() {
  const L = filtered(), p = S.project;
  modal(`<h2>Export</h2>
  <label class="f">Which defects<select id="xScope"><option value="f">Current filtered list (${L.length})</option><option value="o">Everything not closed (${S.defects.filter(d => d.status !== 'Closed').length})</option><option value="a">All defects (${S.defects.length})</option></select></label>
  <label class="f" style="margin-top:8px">Report title<input id="xTitle" value="${esc(p.pdfTitle || 'Schedule of Defects and Omissions')}"></label>
  <label class="f" style="margin-top:8px">Subtitle<input id="xSub" value="${esc(p.pdfSub || 'Appendix to the Certificate of Practical Completion')}"></label>
  <div class="opt"><input type="checkbox" id="xPh" checked><label for="xPh">Detail pages with photos (items with a photo or pin)</label></div>
  <div class="opt"><input type="checkbox" id="xPl" checked><label for="xPl">Floor plans with the pins</label></div>
  <div class="opt"><input type="checkbox" id="xSig" ${p.pdfSig === false ? '' : 'checked'}><label for="xSig">Sign-off block (Engineer and Contractor)</label></div>
  <div class="btnlist" style="margin-top:10px">
    <button id="xPdf">📄 PDF schedule<small>Resero and client branding, linked</small></button>
    <button id="xXls">📊 Excel register<small>One row per defect, plus summary</small></button>
    <button id="xCsv">🧾 CSV (Procore)<small>Import into Procore Punch List</small></button>
    <button id="xZip">🗂 Every file (zip)<small>PDF, Excel, CSV and photos</small></button>
  </div><p class="note" id="xSt"></p><div class="act"><button id="xX">Close</button></div>`);
  const sel = () => { const v = $('xScope').value; const r = v === 'f' ? filtered() : v === 'o' ? S.defects.filter(d => d.status !== 'Closed') : S.defects.slice(); return r.sort((a, b) => natural(a.id, b.id)); };
  const o = () => ({ title: $('xTitle').value, sub: $('xSub').value, photos: $('xPh').checked, plans: $('xPl').checked, sig: $('xSig').checked, intro: p.pdfIntro || 'Each item has a reference (ID). Click a blue ID to go to its detail page with photos, and click a pin on a plan to go to that item. Items with a "Major" severity must be closed before practical completion can be certified; all other open items are to be completed within the agreed timeframes and in any case within the Defects Notification Period.' });
  const ctx = () => ({ project: p, plans: S.plans, getBytes, logoResero: 'img/resero-navy.png', me: S.user.name });
  const st = t => $('xSt').textContent = t, nm = safeName(p.name);
  const run = async fn => { document.querySelectorAll('#mbox .btnlist button').forEach(b => b.disabled = true); try { await fn(); } catch (e) { console.error(e); st(''); toast(/fetch|Failed to fetch|CORS/i.test(e.message) ? 'Photos or plans could not be read for the export. Check the storage CORS setting (README step 6).' : e.message, 6000); } finally { document.querySelectorAll('#mbox .btnlist button').forEach(b => b.disabled = false); } };
  $('xX').onclick = closeModal;
  $('xPdf').onclick = () => run(async () => { const L = sel(); if (!L.length) return toast('Nothing to export'); st('Building the PDF…'); const b = await buildPdf(L, o(), ctx(), st); st(''); deliver(b, `${nm} - ${safeName(o().title)} - ${stamp()}.pdf`, 'PDF schedule'); });
  $('xXls').onclick = () => run(async () => { st('Building the Excel file…'); const b = await buildXlsx(sel(), ctx()); st(''); deliver(b, `${nm} - Defects Register - ${stamp()}.xlsx`, 'Excel register'); });
  $('xCsv').onclick = () => run(async () => deliver(buildCsv(sel()), `${nm} - Procore punch list - ${stamp()}.csv`, 'CSV'));
  $('xZip').onclick = () => run(async () => { const b = await buildZip(sel(), o(), ctx(), st); st(''); deliver(b, `${nm} - Defects export - ${stamp()}.zip`, 'Zip'); });
}

/* ================================================================ menu */
function openMenu() {
  const a = can.admin();
  modal(`<h2>${esc(S.project.name)}</h2><p class="note">You are ${esc(ROLES[S.role] || '')}${S.sup ? ' and a system administrator' : ''} on this project.</p>
  <div class="btnlist">
    ${a ? '<button id="mSet">⚙ Project settings<small>Details, logos, lists, units</small></button><button id="mUsers">👥 Users and access<small>Invite people, set roles</small></button><button id="mPlans">▦ Plans<small>Upload and order floor plans</small></button><button id="mZones">⬠ Room boundaries<small>Draw rooms so pins find their room</small></button>' : ''}
    ${can.edit() ? '<button id="mImp">⬆ Import register<small>Excel, CSV or a v1 backup file</small></button>' : ''}
    ${can.edit() ? '<button id="mAI">✨ Gemini<small>Interpreter settings</small></button>' : ''}
    ${canInstall() ? '<button id="mInst">📲 Install on this phone<small>Home screen app, stays signed in</small></button>' : ''}
    <button id="mCheck">✅ Site check<small>Test everything before you go on site</small></button>
    <button id="mHelp">❓ Help<small>Quick guide, ask a question</small></button>
    <button id="mProj">🗂 All projects<small>Switch project</small></button>
    <button id="mOut">⎋ Sign out<small>${esc(S.user.email)}</small></button>
  </div><p class="note" style="margin-top:12px">${esc(APP.name)} v${APP.version}${isDemo() ? ' · DEMO MODE (data stays in this browser)' : ''}</p><div class="act"><button id="mX">Close</button></div>`);
  const on = (id, fn) => { if ($(id)) $(id).onclick = () => { closeModal(); fn(); }; };
  on('mSet', () => Admin.projectSettings(S.project)); on('mUsers', Admin.usersDialog); on('mPlans', Admin.plansDialog); on('mZones', () => Admin.zoneEditor(PV));
  on('mImp', Admin.importDialog); on('mCheck', siteCheck); on('mInst', () => installDialog(false)); on('mHelp', helpDialog); on('mAI', () => Admin.aiSettings()); on('mProj', showProjects); on('mOut', () => S.store.signOut()); $('mX').onclick = closeModal;
}

/* ================================================================ wiring */
function wire() {
  PV = new PlanView($('vp'), { onPlace, onPinTap: id => { const d = S.defects.find(x => x.id === id); if (d) { S.sel = id; render(); openEditor(d); } } });
  Admin.init({ PV, render, reloadProject, showProjects, openProject, showPlan, setTab, filtered });
  FM.init({ render, getBytes });
  [['q', 'q', 'input'], ['fBlock', 'block', 'change'], ['fLevel', 'level', 'change'], ['fUnit', 'unit', 'change'], ['fSev', 'sev', 'change'], ['fTrade', 'trade', 'change'], ['fResp', 'resp', 'change'], ['sort', 'sort', 'change']].forEach(([id, k, ev]) => $(id).addEventListener(ev, e => { S.F[k] = e.target.value; render(); }));
  $('clr').onclick = () => { Object.assign(S.F, { q: '', block: '', level: '', unit: '', sev: '', trade: '', resp: '' }); S.F.status = new Set(['Open', 'In progress', 'Ready for review', 'Disputed']); $('q').value = ''; filtersDirty = true; render(); };
  $('wBack').onclick = showProjects; $('pOut').onclick = () => S.store.signOut();
  $('bNew').onclick = async () => openEditor(await newDefect(), true, true);
  $('fab').onclick = newDefectChooser;
  $('fCam').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (f) await addPhotos([f]); };
  $('bExport').onclick = openExport; $('bMenu').onclick = openMenu; $('bHelp').onclick = helpDialog;
  $('listToggle').onclick = () => { const h = $('main').classList.toggle('nolist'); S.local.noList = h; saveLocal(); $('listToggle').title = h ? 'Show the defects list' : 'Hide the defects list'; requestAnimationFrame(() => PV.fit()); };
  if (S.local.noList) $('main').classList.add('nolist');
  $('zfull').onclick = () => { const on = !$('planPane').classList.contains('full'); if (on) Nav.open('fullplan', () => { $('planPane').classList.remove('full'); requestAnimationFrame(() => PV.fit()); }); else Nav.closed('fullplan'); $('planPane').classList.toggle('full', on); requestAnimationFrame(() => PV.fit()); };
  Nav.init(() => { modal(`<h2>Leave ${esc(APP.name)}?</h2><p>You are on the main screen. Going back again will leave the app.</p><div class="act"><button class="go" id="lvStay">Stay</button><button id="lvGo">Leave</button></div>`); $('lvStay').onclick = closeModal; $('lvGo').onclick = () => { $('modal').classList.remove('show'); Nav.leave(); }; });
  $('edClose').onclick = $('edCancel').onclick = () => closeEditor(); $('edSave').onclick = saveEditor; $('edDel').onclick = deleteDefect; $('edPrev').onclick = () => step(-1); $('edNext').onclick = () => step(1);
  $('sheet').addEventListener('click', e => { if (e.target.id === 'sheet') closeEditor(); });
  $('modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
  document.querySelectorAll('#mtabs button').forEach(b => b.onclick = () => setTab(b.dataset.t));
  $('fPhoto').onchange = async e => { const fs = [...e.target.files]; e.target.value = ''; await addPhotos(fs); };
  document.addEventListener('keydown', e => { if (e.key !== 'Escape' || $('mk').classList.contains('show')) return; if ($('modal').classList.contains('show')) closeModal(); else if ($('sheet').classList.contains('show')) closeEditor(); else if (placing) stopPlacing(); });
  initDrop({ Admin, FM, addPhotos, editorOpen: () => !!ED && $('sheet').classList.contains('show') });
}
function newDefectChooser() {
  modal(`<h2>New defect</h2><div class="btnlist">
    <button id="ndMic">🎤 Dictate<small>Say it, Gemini fills the form</small></button>
    <button id="ndCam">📷 Take a photo<small>Opens the camera, then the form</small></button>
    <button id="ndPin">📍 Pin on the plan<small>Tap where it is, the room fills in</small></button>
    <button id="ndType">✎ Type it<small>Blank form</small></button>
  </div><div class="act"><button id="ndX">Cancel</button></div>`);
  $('ndX').onclick = closeModal;
  const go = async after => { closeModal(); openEditor(await newDefect(), true, true); after && after(); };
  $('ndMic').onclick = () => go(() => $('mic') && $('mic').click());
  $('ndCam').onclick = () => go(() => $('fCam').click());
  $('ndType').onclick = () => go();
  $('ndPin').onclick = () => { closeModal(); if (!S.plans.length) { toast('No plans in this project'); return; } setTab('plan'); startPlacing({ mode: 'new' }); };
}
async function addPhotos(fs) {
  if (!ED) return;
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (x) {} for (const f of fs) { try { ED.d.photos.push(await newPhoto(f)); } catch (x) { toast('Could not read that photo'); } } renderPhotos(); }
window.addEventListener('rd-defects-changed', () => { filtersDirty = true; render(); });
boot();
