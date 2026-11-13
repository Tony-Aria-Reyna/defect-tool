// Resero Defects - main app: sign in, projects, workspace, defect editor.
import { createStore, createSandbox, isDemo } from './store.js';
import * as Faces from './faces.js';
import { APP, STATUS_COLOURS as SCOL, ROLES } from './config.js';
import { S, can, withDefaults, unitList, saveLocal, sevLabel, isMajor, sevDefault, sevMatch, sevCode, selfClose } from './state.js';
import { $, esc, toast, modal, closeModal, busy, confirmBox, opts, uid, todayISO, nzDate, nzDT, stamp, isMobile, natural, safeName, deliver, loadImage, locate, dismissModal } from './util.js';
import { PlanView } from './planview.js';
import { dictate, stopDictation, holdToTalk, aiCall, aiPrompt, tooVerbatim } from './ai.js';
import { newPhoto, uploadPhotos, uploadFiles, flushOutbox, pendingUrl, markup, initMarkup, outboxCount } from './photos.js';
import { buildPdf, buildXlsx, buildCsv, buildZip, locText, pinLabel, setProjectCtx } from './exports.js';
import * as Admin from './admin.js';
import * as FM from './fm.js';
import { initDrop } from './dnd.js';
import { helpDialog, siteCheck } from './help.js';
import * as Nav from './nav.js';
import * as Tick from './ticksheet.js';
import * as Sync from './sheetsync.js';
import * as Placer from './placer.js';
import { installDialog, maybeNag, canInstall } from './install.js';
import { typicalList, templateFrom } from './typicals.js';
import * as Search from './search.js';
import * as Setup from './setup.js';
import * as Try from './tryit.js';
const SURFACES = ['Floor', 'Wall', 'Ceiling', 'Exterior cladding', 'Roof', 'Joinery', 'Services'];

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
  const sEm = () => { const e = $('sEmail').value.trim().toLowerCase(); if (!/^\S+@\S+\.\S+$/.test(e)) { $('sMsg').textContent = 'Enter your email address first.'; $('sEmail').focus(); return ''; } return e; };
  const sPw = () => { const p = $('sPw').value; if (p.length < 8) { $('sMsg').textContent = 'Use a password of at least 8 characters.'; $('sPw').focus(); return ''; } return p; };
  const sBusy = (on, msg) => { ['sPwGo', 'sGoogle'].forEach(id => $(id).disabled = on); $('sMsg').textContent = msg || ''; };
  $('sPwGo').onclick = async () => { const e = sEm(), p = e && sPw(); if (!p) return; sBusy(true, 'Signing in…'); try { await S.store.signInPassword(e, p); } catch (x) { sBusy(false, friendly(x)); } };
  $('sPw').onkeydown = ev => { if (ev.key === 'Enter') $('sPwGo').click(); };
  $('sPwNew').onclick = async ev => { ev.preventDefault(); const e = sEm(), p = e && sPw(); if (!p) return; sBusy(true, 'Creating your password…'); try { await S.store.createPassword(e, p); } catch (x) { sBusy(false, friendly(x)); } };
  $('sPwForgot').onclick = async ev => { ev.preventDefault(); const e = sEm(); if (!e) return; sBusy(true, 'Sending…'); try { await S.store.resetPassword(e); sBusy(false, 'Password reset email sent to ' + e + '. Open the link, set a new password, then sign in here.'); } catch (x) { sBusy(false, friendly(x)); } };
  let linkT = 0;
  $('sLink').onclick = async ev => { ev.preventDefault(); const e = sEm(); if (!e) return; if (Date.now() - linkT < 60000) { $('sMsg').textContent = 'A link was sent less than a minute ago. Check your inbox (and junk folder) before asking for another.'; return; } sBusy(true, 'Sending the link…'); try { await S.store.sendLink(e); linkT = Date.now(); sBusy(false, ''); $('sMsg').innerHTML = '<b>Sent to ' + esc(e) + '.</b> Open the email <b>on this phone</b> and tap the link. It can take a minute to arrive; check junk if not.'; } catch (x) { sBusy(false, friendly(x)); } };
  show('scrSign');
  try { await S.store.completeLink(); } catch (e) { $('sMsg').textContent = friendly(e); }
  S.store.onAuth(async u => {
    S.user = u;
    if (!u) { cleanupProject(); show('scrSign'); $('signChecking').style.display = 'none'; $('signForm').style.display = ''; return; }
    S.sup = await S.store.isSuper(); S.store.getLibrary('typicals').then(L => { S.lib = L; });
    try { const n = await S.store.claimInvites(); if (n) toast('You have been added to ' + n + ' project' + (n > 1 ? 's' : '')); } catch (e) { console.warn(e); }
    const last = S.local.lastProject;
    if (last && (await openProject(last, true))) return;
    showProjects();
  });
  let syncT = 0; addEventListener('rd-sync-error', e => { if (Date.now() - syncT < 10000) return; syncT = Date.now(); const m = (e.detail && e.detail.message) || ''; toast('A change could not sync to the cloud: ' + (/(permission|insufficient)/i.test(m) ? 'you do not have permission for that item' : m.slice(0, 120)), 7000); });
  addEventListener('online', () => { netbar(); flushOutbox().then(processPendingAI); }); addEventListener('offline', netbar); setInterval(() => processPendingAI(), 45000);
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  setTimeout(checkUpdate, 8000); setInterval(checkUpdate, 5 * 60000); addEventListener('online', () => setTimeout(checkUpdate, 3000));
  wire();
}
// Installed apps have no pull-to-refresh: look for a newer version and offer a one-tap reload.
let updateShown = false;
async function checkUpdate() {
  if (!navigator.onLine || updateShown || isDemo()) return;
  try {
    const t = await (await fetch('js/config.js?u=' + Date.now(), { cache: 'no-store' })).text(); const m = /version:\s*'([^']+)'/.exec(t);
    if (m && m[1] !== APP.version) { updateShown = true; const b = $('netbar'); b.innerHTML = `New version ${esc(m[1])} available · <b>tap to update</b>`; b.classList.add('show'); b.style.background = '#1c7c54'; b.onclick = reloadApp; }
  } catch (e) {}
}
export async function reloadApp() {
  try { const r = await navigator.serviceWorker.getRegistration(); if (r) { await r.update(); await new Promise(res => setTimeout(res, 1200)); } } catch (e) {}
  try { const ks = await caches.keys(); await Promise.all(ks.filter(k => k.startsWith('resero-defects') && k !== 'resero-defects-img').map(k => caches.delete(k))); } catch (e) {}
  location.reload();
}
/* ---- bulk actions: pick several items, then accept, reopen, set status or responsible with one comment ---- */
function bulkBar() { const b = $('bulkbar'); if (!S.bulk) { b.classList.remove('show'); return; } b.classList.add('show'); $('bulkN').textContent = S.bulk.size + ' selected'; b.querySelectorAll('[data-b]').forEach(x => x.disabled = !S.bulk.size); }
function bulkToggle() { S.bulk = S.bulk ? null : new Set(); $('bSel').classList.toggle('on', !!S.bulk); filtersDirty = true; render(); bulkBar(); }
async function bulkAction(kind) {
  const ids = [...S.bulk]; if (!ids.length) return;
  const title = { close: 'Accept and close', reopen: 'Reopen and send back', status: 'Set status', resp: 'Set responsible' }[kind];
  modal(`<h2>${title} · ${ids.length} item${ids.length > 1 ? 's' : ''}</h2>
    ${kind === 'status' ? `<label class="f">Status<select id="bkV">${opts(S.project.statuses, '')}</select></label>` : ''}
    ${kind === 'resp' ? `<label class="f">Responsible<select id="bkV">${opts(S.project.responsible || [], '')}</select></label>` : ''}
    <label class="f">Comment${kind === 'reopen' ? ' (required: what still needs doing)' : ''}<textarea id="bkC" style="min-height:60px"></textarea></label>
    ${can.edit() ? `<label class="f small">On behalf of<select id="bkFor"><option value="">Myself</option>${peopleList().map(n => `<option>${esc(n)}</option>`).join('')}</select></label>` : ''}
    <p class="note" id="bkSt"></p><div class="act"><button id="bkX">Cancel</button><button class="go" id="bkGo">${title}</button></div>`);
  $('bkX').onclick = closeModal;
  $('bkGo').onclick = async () => {
    const c = $('bkC').value.trim(), v = $('bkV') ? $('bkV').value : ''; if (kind === 'reopen' && !c) { toast('Add a comment first'); return; } if ((kind === 'status' || kind === 'resp') && !v) { toast('Choose a value'); return; }
    $('bkGo').disabled = true; const who = ($('bkFor') && $('bkFor').value) ? S.user.name + ' on behalf of ' + $('bkFor').value : S.user.name; let n = 0;
    try {
      for (const id of ids) { const d = S.defects.find(x => x.id === id); if (!d) continue; $('bkSt').textContent = `Updating ${++n} of ${ids.length}…`; const t = new Date().toISOString(), patch = { updated: t, updatedBy: S.user.email }; let txt = '';
        if (kind === 'close') { patch.status = 'Closed'; txt = 'Accepted and closed' + (c ? ': ' + c : '.'); }
        if (kind === 'reopen') { patch.status = 'Open'; txt = 'Reopened and sent back: ' + c; }
        if (kind === 'status') { patch.status = v; txt = 'Status set to ' + v + (c ? ': ' + c : '.'); }
        if (kind === 'resp') { patch.responsible = v; txt = 'Responsible set to ' + v + (c ? ': ' + c : '.'); }
        await S.store.updateDefect(S.project.id, id, patch, [{ t, who, txt }]); }
      closeModal(); toast(ids.length + ' items updated'); S.bulk = new Set(); bulkBar();
    } catch (e) { $('bkSt').textContent = ''; toast('Stopped: ' + e.message, 6000); $('bkGo').disabled = false; }
  };
}
/* ---- test mode: sandbox copy of the project in a local store, viewed as a chosen role ---- */
async function enterTestMode(role) {
  const pid = S.project.id, bz = busy('Making a test copy of the project…');
  try {
    if (!S.testMode) S.realStore = S.store;
    const sb = await createSandbox(S.realStore, pid, role, st => bz.set('Copying ' + st + '…'));
    cleanupProject(); S.store = sb; S.testMode = true; S.viewAs = role; S.sup = false;
    const realUser = S.user; S.realUser = S.realUser || realUser; S.user = sb.user;
    await openProject(pid, true); viewAsBar(); bz.done(); toast('Test mode: viewing as ' + (ROLES[role] || role) + '. Nothing here is saved.', 5000);
  } catch (e) { bz.done(); console.error(e); toast('Could not start test mode: ' + e.message, 6000); }
}
async function leaveTestMode() {
  if (!S.testMode) return; const pid = S.project.id, bz = busy('Leaving test mode…');
  try { const sb = S.store; cleanupProject(); S.store = S.realStore; S.user = S.realUser; S.testMode = false; S.viewAs = null; S.sup = await S.store.isSuper(); try { await sb.wipe(); } catch (e) {} await openProject(pid, true); viewAsBar(); bz.done(); toast('Back to the live project. The test copy has been discarded.'); }
  catch (e) { bz.done(); toast('Could not leave test mode cleanly: ' + e.message + '. Reload the app.', 8000); }
}
function viewAsBar() { Try.chip(); let b = $('viewAsBar'); if (!b) { b = document.createElement('div'); b.id = 'viewAsBar'; document.body.appendChild(b); } document.body.classList.toggle('testmode', !!S.testMode); if (S.testMode) { b.innerHTML = `🧪 <b>PRACTICE</b> · <b>${esc(ROLES[S.viewAs] || S.viewAs)}</b> · ${isMobile() ? 'not saved' : 'nothing you do here is saved'} · ${Try.active() ? `<a href="#" id="vaTry">Steps ${Try.count()}</a> · ` : ''}<a href="#" id="vaStop">Leave</a>`; b.classList.add('show'); if ($('vaTry')) $('vaTry').onclick = e => { e.preventDefault(); Try.openSteps(); }; requestAnimationFrame(() => document.body.style.setProperty('--tb', (b.offsetHeight + 4) + 'px')); $('vaStop').onclick = e => { e.preventDefault(); leaveTestMode(); }; } else b.classList.remove('show'); }
function friendly(e) { const c = (e && e.code) || ''; if (/popup-closed/.test(c)) return 'Sign-in window was closed.'; if (/unauthorized-domain/.test(c)) return 'This web address is not authorised in Firebase (Authentication > Settings > Authorised domains).'; if (/operation-not-allowed/.test(c)) return 'This sign-in method is not turned on in Firebase yet.'; if (/invalid-action-code|expired/.test(c)) return 'That sign-in link has expired or been used. Ask for a new one.'; if (/wrong-password|invalid-credential|invalid-login/.test(c)) return 'Wrong email or password. If you have not set a password yet, tap "Create a password".'; if (/user-not-found/.test(c)) return 'No password set for this email yet. Tap "Create a password".'; if (/weak-password/.test(c)) return 'Choose a stronger password (at least 8 characters).'; if (/too-many-requests/.test(c)) return 'Too many attempts. Wait a few minutes or use "Forgot password".'; if (/network-request-failed/.test(c)) return 'No connection. Sign-in needs data the first time; once signed in the app works offline.'; return (e && e.message) || String(e); }
async function netbar() { const n = await outboxCount(); const b = $('netbar'); b.textContent = !navigator.onLine ? 'No coverage: everything you save stays on this phone and syncs when you are back in service' + (S.defects.filter(d => d.aiPending).length ? ` (${S.defects.filter(d => d.aiPending).length} site note${S.defects.filter(d => d.aiPending).length > 1 ? 's' : ''} waiting for Gemini)` : '') + (n ? ` (${n} photo${n > 1 ? 's' : ''} waiting)` : '') : (n ? `Uploading ${n} photo${n > 1 ? 's' : ''}…` : ''); b.classList.toggle('show', !navigator.onLine || n > 0); }

/* ================================================================ projects */
export async function showProjects() {
  cleanupProject(); delete S.local.lastProject; saveLocal(); show('scrProjects');
  $('pUser').textContent = S.user.email + (S.sup ? ' · System admin' : '') + (isDemo() ? ' · DEMO' : '');
  $('plist').innerHTML = '<div class="empty">Loading projects…</div>';
  let list = [];
  try { list = await S.store.listProjects(); } catch (e) { $('plist').innerHTML = `<div class="empty">Could not load projects: ${esc(friendly(e))}<br><br>${/permission/i.test(e.message) ? `<b>${esc(S.user.email)}</b> is not a member of any project yet. Ask the project admin to invite this exact email address (menu > Users and access), then sign in again. If you have another account that already has access, sign out and use that one.` : ''}</div>`; return; }
  list.sort((a, b) => natural(a.name, b.name)); maybeNag();
  const cards = await Promise.all(list.map(async p => `<div class="pcard" data-id="${esc(p.id)}"><div class="cl">${p.clientLogo ? `<img src="${esc(await imgUrl(p.clientLogo))}" alt="">` : ''}<span>${esc(p.client || '')}</span></div><h3>${esc(p.name)}</h3><div class="muted small">${esc(p.address || '')}</div><div><span class="role">${esc(ROLES[(p.members || {})[S.user.uid]] || (S.sup ? 'System admin' : ''))}</span>${p.archived ? ' <span class="tag">Archived</span>' : ''}</div></div>`));
  $('plist').innerHTML = cards.join('') + (S.sup ? '<div class="pcard new" id="pNew">+ New project</div><div class="pcard new" id="pPack" style="border-color:var(--teal)">⬇ Set up from a project pack<small style="font-weight:400;color:var(--muted)">or drag the .json file onto this page</small></div><input type="file" id="fPack" accept=".json" hidden>' : '') + (!list.length && !S.sup ? `<div class="empty">You have not been added to any projects yet.<br>Ask the project administrator to invite <b>${esc(S.user.email)}</b>.<br><br><span class="small">Your user ID: <span class="codebox">${esc(S.user.uid)}</span></span><br><br><button class="go" id="pRetry">Check for my invitation again</button><p class="note" id="pRetryMsg"></p></div>` : '');
  if ($('pRetry')) $('pRetry').onclick = async () => { $('pRetry').disabled = true; $('pRetryMsg').textContent = 'Checking…'; let r; try { r = await S.store.claimReport(); } catch (e) { r = { msg: friendly(e) }; } if (r.n) { toast('You have been added to ' + r.n + ' project' + (r.n > 1 ? 's' : '')); return showProjects(); } $('pRetryMsg').textContent = r.msg || 'Nothing found.'; $('pRetry').disabled = false; };
  $('plist').querySelectorAll('.pcard[data-id]').forEach(c => c.onclick = () => openProject(c.dataset.id));
  if ($('pNew')) $('pNew').onclick = () => Setup.newProjectWizard();
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
    try { Sync.autoStart(); } catch (e) {}
    applyDeepLink(); Try.chip();
    S.unsub = S.store.watchDefects(pid, list => { S.defects = list; filtersDirty = true; render(); flushOutbox().then(netbar).then(processPendingAI); }, e => toast('Sync problem: ' + friendly(e), 5000));
    FM.start(pid); setTab('list'); b && b.done(); return true;
  } catch (e) { b && b.done(); console.error(e); if (!quiet) toast('Could not open the project: ' + friendly(e), 5000); return false; }
}
// Links from the summary email: #sub=TGW shows that subcontractor's open items, #unit=27 that unit's, #id=MC-012 opens the item.
function applyDeepLink() {
  const h = new URLSearchParams(String(location.hash || '').replace(/^#/, '')); if (![...h.keys()].length) return;
  const sub = h.get('sub'), unit = h.get('unit'), id = h.get('id'); try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
  if (h.has('tryit')) { setTimeout(() => { if (S.project && !S.testMode) Try.start(); }, 1500); return; }
  const go = () => { if (id) { const d = S.defects.find(q => q.id === id); if (d) openEditor(d); return; }
    Object.assign(S.F, { q: '', block: '', level: '', unit: '', sev: '', trade: '', resp: '', sub: '', review: false, toReview: false }); S.F.status = new Set(['Open', 'In progress', 'Ready for review', 'Disputed']);
    if (sub) { const m = [...new Set(S.defects.map(d => d.subcontractor).filter(Boolean))].find(n => n.toLowerCase() === sub.toLowerCase()); if (m) S.F.sub = m; else S.F.q = sub; }
    if (unit) S.F.unit = unit; filtersDirty = true; if (S.F.q) $('q').value = S.F.q; setTab('list'); render(); toast(sub ? 'Showing open items for ' + sub : 'Showing open items for Unit ' + unit, 5000); };
  setTimeout(go, 2500);   // after the defects have loaded
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
  setProjectCtx(p); const sl = sevLabel(p); fillSel('fSev', sl === 'Severity' ? 'All severities' : 'All ' + sl.toLowerCase().replace(/y$/, 'ie') + 's', p.severities, F.sev); const so = document.querySelector('#sort option[value=sev]'); if (so) so.textContent = 'Sort: ' + sl.toLowerCase(); fillSel('fTrade', 'All trades', p.trades, F.trade);
  { const subs = subList(); fillSel('fSub', 'All subcontractors', subs, F.sub); $('fSub').style.display = subs.length ? '' : 'none'; } fillSel('fResp', 'All responsible', [...new Set([...p.responsible, ...D.map(d => d.responsible).filter(Boolean)])], F.resp);
}
let filtersDirty = true;
export function filtered() {
  const F = S.F, q = F.q.trim().toLowerCase();
  const r = S.defects.filter(d => (F.toReview ? (d.status === 'Ready for review' && (d.createdBy === S.user.email || can.admin())) : F.review ? (d.aiReview || d.aiPending) : F.status.has(d.status)) && (!F.block || d.block === F.block) && (!F.level || d.level === F.level) && (!F.unit || (F.unit === '-' ? !d.unit : String(d.unit) === F.unit)) && (!F.sev || d.severity === F.sev) && (!F.trade || d.trade === F.trade) && (!F.resp || d.responsible === F.resp) && (!F.sub || d.subcontractor === F.sub) && (!q || Search.hit(q, d, [d.id, d.title, d.desc, d.element, d.room, 'unit ' + d.unit, d.trade, d.action, d.extRef, d.responsible, d.subcontractor, d.item, d.status].join(' '))));
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
  const maj = D.filter(d => d.status !== 'Closed' && isMajor(d)).length, codes = S.project.severities.map(sevCode), coded = codes.every(Boolean), byCat = coded ? S.project.severities.map((s, i) => [codes[i], D.filter(d => d.status !== 'Closed' && d.severity === s).length, s]) : null, tri = D.filter(d => d.status !== 'Closed' && d.severity === 'To triage').length;
  const pend = D.filter(d => d.aiPending).length, rev = D.filter(d => d.aiReview).length, toRev = D.filter(d => d.status === 'Ready for review' && !can.contractor() && (d.createdBy === S.user.email || can.admin())).length;
  $('counts').innerHTML = S.project.statuses.map(s => `<button class="cnt ${S.F.status.has(s) ? 'on' : ''}" data-s="${s}"><i style="background:${SCOL[s]}"></i>${s} <b>${c[s]}</b></button>`).join('') + `<span class="cnt cats" title="Open items by ${esc(sevLabel(S.project).toLowerCase())}. Tap a letter to show only those."><em>${esc(sevLabel(S.project))}</em>${byCat ? byCat.map(c => `<button class="catb ${S.F.sev === c[2] ? 'on' : ''}" data-sev="${esc(c[2])}" title="${esc(c[2])}">${esc(c[0])} <b>${c[1]}</b></button>`).join('') : `Major <b>${maj}</b>`}${tri ? ` · To triage <b>${tri}</b>` : ''}</span>` + (rev || pend || S.F.review ? `<button class="cnt chk ${S.F.review ? 'on' : ''}" data-r="1">✨ To check <b>${rev}</b>${pend ? ` · 📵 Waiting for coverage <b>${pend}</b>` : ''}</button>` : '') + (toRev || S.F.toReview ? `<button class="cnt chk ${S.F.toReview ? 'on' : ''}" data-tr="1">🔎 For me to inspect <b>${toRev}</b></button>` : '');
  $('counts').querySelectorAll('button').forEach(b => b.onclick = () => { if (b.dataset.sev) { S.F.sev = S.F.sev === b.dataset.sev ? '' : b.dataset.sev; render(); return; } if (b.dataset.r) { S.F.review = !S.F.review; render(); return; } if (b.dataset.tr) { S.F.toReview = !S.F.toReview; render(); return; } const s = b.dataset.s; S.F.status.has(s) ? S.F.status.delete(s) : S.F.status.add(s); render(); });
  const L = filtered();
  $('lmeta').textContent = L.length + ' of ' + D.length + ' shown'; filterChips();
  $('list').innerHTML = L.length ? L.map(d => { const sev = isMajor(d) ? 'sev-maj' : d.severity === 'To triage' ? 'sev-tri' : ''; const ph = (d.photos || [])[0];
    return `<div class="card ${S.sel === d.id ? 'sel' : ''} ${S.bulk && S.bulk.has(d.id) ? 'picked' : ''}" style="--c:${SCOL[d.status] || '#999'}" data-id="${esc(d.id)}">${S.bulk ? `<label class="pick"><input type="checkbox" data-pick="${esc(d.id)}" ${S.bulk.has(d.id) ? 'checked' : ''}></label>` : ''}<div class="thc"${ph || d.plan ? '' : ' hidden'}>${ph ? `<div class="thw"><img class="th" data-ph="${esc(d.id)}" alt="" draggable="false"><button class="phn" data-gal="${esc(d.id)}" title="Open the photos">📷 ${d.photos.length}</button></div>` : ''}${d.plan && d.x != null ? `<img class="snip" data-sn="${esc(d.id)}" alt="Location on the plan" title="Tap to see where it is. Press and hold for a quick look." draggable="false">` : ''}</div><div class="b"><div class="t">${esc(d.id)} · ${esc(d.title || d.element || '(untitled)')}</div><div class="d">${esc(d.desc)}</div><div class="m"><span class="pill" style="background:${SCOL[d.status] || '#999'}">${esc(d.status)}</span>${d.severity ? `<span class="tag ${sev}">${esc(d.severity)}</span>` : ''}${locText(d) ? `<span class="tag">${esc(locText(d))}</span>` : ''}${d.trade ? `<span class="tag">${esc(d.trade)}</span>` : ''}${d.subcontractor ? `<span class="tag">${esc(d.subcontractor)}</span>` : ''}${d.aiPending ? '<span class="tag chk">📵 Waiting for coverage</span>' : ''}${d.aiReview ? '<span class="tag chk">✨ To check</span>' : ''}${d.general && !d.plan ? '<span class="tag">General</span>' : ''}</div></div></div>`; }).join('') : `<div class="empty">${D.length ? 'No defects match these filters.' : 'No defects yet.' + (can.edit() ? ' Tap the microphone or + New to raise one, or import a register from the ☰ menu.' : '')}</div>`;
  $('list').querySelectorAll('[data-gal]').forEach(t => t.onclick = e => { e.stopPropagation(); const d = S.defects.find(x => x.id === t.dataset.gal); if (d) gallery(d.photos, 0, d.id + ' · ' + (d.title || '')); });
  snipWatch($('list'));
  $('list').querySelectorAll('.loc[data-loc]').forEach(t => t.onclick = e => { e.stopPropagation(); const d = S.defects.find(x => x.id === t.dataset.loc); if (d) showLocation(d); });
  $('list').querySelectorAll('[data-pick]').forEach(cb => { cb.onclick = e => e.stopPropagation(); cb.onchange = () => { cb.checked ? S.bulk.add(cb.dataset.pick) : S.bulk.delete(cb.dataset.pick); cb.closest('.card').classList.toggle('picked', cb.checked); bulkBar(); }; });
  $('list').querySelectorAll('.card').forEach(el => el.onclick = () => { if (S.bulk) { const cb = el.querySelector('[data-pick]'); if (cb) { cb.checked = !cb.checked; cb.onchange(); } return; } const d = S.defects.find(x => x.id === el.dataset.id); S.sel = d.id; if (d.plan && !isMobile()) showPlan(d.plan, d); render(); openEditor(d); });
  // thumbnails load lazily
  $('list').querySelectorAll('img[data-ph]').forEach(async im => { const d = S.defects.find(x => x.id === im.dataset.ph); if (d && d.photos[0]) im.src = await photoSrc(d.photos[0]); peekable(im); });
  renderPins();
}
// Filters fold away under the search box; anything that is narrowing the list shows as a chip that can be tapped off.
const F_NAMES = { block: 'Block', level: 'Level', unit: 'Unit', sev: null, trade: 'Trade', resp: 'Responsible', sub: 'Subcontractor' };
function filterChips() {
  const F = S.F, on = Object.keys(F_NAMES).filter(k => F[k]).map(k => [k, (F_NAMES[k] ? F_NAMES[k] + ' ' : '') + (k === 'unit' && F[k] === '-' ? 'common areas' : F[k])]);
  if (F.q) on.unshift(['q', 'Search "' + F.q + '"']); if (F.review) on.push(['review', 'To check']); if (F.toReview) on.push(['toReview', 'For me to inspect']);
  const n = on.filter(o => o[0] !== 'q').length, tg = $('fTog'), open = S.fOpen == null ? !isMobile() : S.fOpen;
  $('fMore').classList.toggle('open', open); tg.classList.toggle('on', open); tg.classList.toggle('has', n > 0); tg.innerHTML = (open ? '▴' : '▾') + ' Filters' + (n ? ` <b>${n}</b>` : '');
  $('fChips').innerHTML = on.length ? `<span class="fcl">Showing only:</span>` + on.map(o => `<button data-fx="${o[0]}">${esc(o[1])} ✕</button>`).join('') + (on.length > 1 ? '<button class="all" data-fx="*">Clear all</button>' : '') : '';
  $('fChips').querySelectorAll('button').forEach(b => b.onclick = () => { const k = b.dataset.fx; if (k === '*') { $('clr').click(); return; } S.F[k] = (k === 'review' || k === 'toReview') ? false : ''; if (k === 'q') $('q').value = ''; filtersDirty = true; render(); });
}
// A square cut-out of the plan centred on an item's pin. Plan images are decoded once and cut-outs are remembered.
const planImgs = new Map(), snips = new Map();
const planImage = p => { if (!planImgs.has(p.img)) planImgs.set(p.img, (async () => loadImage(await imgUrl(p.img)))().catch(e => { planImgs.delete(p.img); throw e; })); return planImgs.get(p.img); };
export async function snip(d, px, span) {
  const p = S.plans.find(q => q.id === d.plan); if (!p || d.x == null) return '';
  const key = [p.img, d.x, d.y, d.status, px, span].join('|'); if (snips.has(key)) return snips.get(key);
  const im = await planImage(p), c = document.createElement('canvas'), x = c.getContext('2d'); c.width = c.height = px;
  const sc = px / (p.w / (span || 3.2)), cx = d.x * p.w * sc, cy = d.y * p.h * sc;
  x.fillStyle = '#fff'; x.fillRect(0, 0, px, px); x.drawImage(im, px / 2 - cx, px / 2 - cy, p.w * sc, p.h * sc);
  const col = SCOL[d.status] || '#d64545', big = px > 300, rr = big ? Math.max(8, px * 0.011) : Math.max(5, px * 0.075);
  if (big) { x.strokeStyle = col; x.globalAlpha = 0.55; x.lineWidth = 3; x.beginPath(); x.arc(px / 2, px / 2, rr * 4.2, 0, 7); x.stroke(); x.globalAlpha = 1; }
  x.fillStyle = col; x.beginPath(); x.arc(px / 2, px / 2, rr, 0, 7); x.fill(); x.strokeStyle = '#fff'; x.lineWidth = big ? 2.5 : Math.max(2, px * 0.02); x.stroke();
  const u = c.toDataURL('image/jpeg', 0.82); if (snips.size > 1500) snips.clear(); snips.set(key, u); return u;
}
// Wire one plan cut-out image: tap opens the location window (not the full plans), press and hold shows it large.
function snipWire(im, d) { im.onclick = e => { e.stopPropagation(); showLocation(d); }; peekable(im, () => snip(d, 900, 2.4)); }
let snipObs = null;
function snipWatch(root) {
  if (snipObs) snipObs.disconnect();
  const fill = async im => { if (im.dataset.done) return; im.dataset.done = 1; const d = S.defects.find(x => x.id === im.dataset.sn); if (!d) return; try { im.src = await snip(d, 120); snipWire(im, d); } catch (e) { im.remove(); } };
  const L = [...root.querySelectorAll('img.snip[data-sn]')]; if (!L.length) return;
  if (!('IntersectionObserver' in window)) { L.slice(0, 60).forEach(fill); return; }
  snipObs = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { snipObs.unobserve(e.target); fill(e.target); } }), { rootMargin: '300px' }); L.forEach(im => snipObs.observe(im));
}
// The words a person wrote on an item (a comment, or the note given with a status change), newest first.
const WF_LABELS = /^(Ready for inspection|Reopened and sent back|Accepted and closed|In progress|Completed and closed by the contractor): ([\s\S]+)$/;
const SYS_TXT = /^(Changed |Raised|Imported|Added from|Pin placed|Unit |Filled in|Site note|Status |Ticked|Marked|Handwritten|Resolution note|Category set|Ready for inspection\.|Reopened and sent back\.|Accepted and closed\.|In progress\.|Completed and closed)/i;
function humanNotes(d) {
  return (d.history || []).slice().sort((a, b) => String(b.t || '').localeCompare(String(a.t || ''))).map(h => { const t = String(h.txt || ''), m = WF_LABELS.exec(t); if (m) return { h, label: m[1], text: m[2] }; if (!t.trim() || SYS_TXT.test(t)) return null; return { h, label: '', text: t }; }).filter(Boolean);
}
// The latest thing someone else said (so a contractor sees the reviewer's words and the reviewer sees the contractor's); failing that, the latest note of all.
function lastNote(d) { const L = humanNotes(d); return L.find(n => n.h.who !== S.user.name) || L[0] || null; }
const lastNoteHtml = (d, title) => { const n = lastNote(d); return n ? `<div class="lastc"><div class="lch">${esc(title || 'Latest comment')} · ${esc(n.h.who || '')} · ${esc(nzDT(n.h.t))}${n.label ? ` <span class="hk">${esc(n.label)}</span>` : ''}</div><div class="lct">${esc(n.text)}</div></div>` : ''; };
// A comment, or the note that goes with a change of status. The words are typed or spoken here, not on the main sheet.
function noteDialog(o) {
  const d = ED.d, con = can.contractor();
  modal(`<h2>${esc(o.title)}</h2><p class="note"><b>${esc(d.id)}</b> · ${esc(d.title || d.element || '')}</p>${lastNoteHtml(d, 'Last comment')}
    <label class="f">${esc(o.ask)}${o.required ? '' : ' <span class="muted small">(optional)</span>'}<div class="ndrow"><textarea id="ndTxt" rows="3" placeholder="${esc(o.ph || '')}"></textarea><button class="mic sm" id="ndMic" title="Hold to talk">🎤</button></div></label><p class="note small" id="ndSt">Type it, or hold the microphone and say it.</p>
    ${!con && can.edit() ? `<label class="f small">On behalf of (when relaying an email or a verbal response)<select id="ndFor"><option value="">Myself</option>${peopleList().map(n => `<option>${esc(n)}</option>`).join('')}</select></label>` : ''}
    <div class="act"><button id="ndX">Cancel</button><button class="${o.warn ? 'warn' : 'go'}" id="ndGo">${esc(o.btn)}</button></div>`);
  const st = (t, bad) => { $('ndSt').textContent = t; $('ndSt').style.color = bad ? '#a32222' : ''; };
  holdToTalk($('ndMic'), () => dictate($('ndTxt'), $('ndMic'), st, () => {}));
  $('ndX').onclick = () => { stopDictation(); closeModal(); };
  $('ndGo').onclick = async () => { stopDictation(); const txt = $('ndTxt').value.trim(); if (o.required && !txt) { st(o.need || 'Add a short note first.', true); $('ndTxt').focus(); return; } if ($('cmt')) $('cmt').value = txt; if ($('cmtFor')) $('cmtFor').value = $('ndFor') ? $('ndFor').value : ''; closeModal(); await o.go(); };
  setTimeout(() => $('ndTxt') && !isMobile() && $('ndTxt').focus(), 60);
}
// One "Add photo" tile: on a phone it offers the camera or the gallery; on a computer it goes straight to the files.
function addPhotoMenu() {
  if (!isMobile()) { $('fPhoto').click(); return; }
  const old = document.querySelector('.phsheet'); if (old) old.remove();
  const m = document.createElement('div'); m.className = 'phsheet'; m.innerHTML = '<div class="phs"><b>Add photo</b><button data-k="cam">📷 Take a photo</button><button data-k="gal">🖼 Choose from gallery</button><button data-k="x" class="x">Cancel</button></div>'; document.body.appendChild(m);
  m.onclick = e => { const b = e.target.closest('button'); if (e.target !== m && !b) return; m.remove(); if (b && b.dataset.k !== 'x') $(b.dataset.k === 'cam' ? 'fCam' : 'fPhoto').click(); };
}
// Press and hold a photo to see it large; let go and it closes. A quick tap still does what it did before.
function peekable(im, big) {
  if (im._peek) return; im._peek = 1; let t = null, ov = null, sx = 0, sy = 0, last = 0;
  const end = () => { clearTimeout(t); t = null; ['pointerup', 'pointercancel', 'touchend', 'touchcancel', 'mouseup', 'blur'].forEach(n => window.removeEventListener(n, end, true)); if (ov) { ov.remove(); ov = null; last = Date.now(); } };
  const show = () => { if (!im.src) return; ov = document.createElement('div'); ov.className = 'peek'; ov.innerHTML = '<img alt=""><span>Let go to close</span>'; ov.firstChild.src = im.src; document.body.appendChild(ov); if (big) Promise.resolve(big()).then(u => { if (u && ov) ov.firstChild.src = u; }).catch(() => {}); try { navigator.vibrate && navigator.vibrate(15); } catch (x) {} };
  im.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse' && e.button !== 0) return; sx = e.clientX; sy = e.clientY; clearTimeout(t); t = setTimeout(show, 300);
    // the lift is watched on the whole window, so the finger can wander anywhere once the photo is up
    ['pointerup', 'touchend', 'touchcancel', 'mouseup', 'blur'].forEach(n => window.addEventListener(n, end, true)); });
  // before the photo is up, a real drag means the person is scrolling the list: cancel. After it is up, movement is ignored.
  im.addEventListener('pointermove', e => { if (!ov && t && Math.hypot(e.clientX - sx, e.clientY - sy) > 14) { clearTimeout(t); t = null; } });
  im.addEventListener('pointercancel', () => { if (!ov) end(); });   // the browser took the touch for scrolling before the photo came up
  // once the photo is up, stop the page scrolling under the finger (that is what used to close it)
  im.addEventListener('touchmove', e => { if (ov && e.cancelable) e.preventDefault(); }, { passive: false });
  im.addEventListener('contextmenu', e => e.preventDefault());
  im.addEventListener('click', e => { if (Date.now() - last < 600) { e.stopImmediatePropagation(); e.stopPropagation(); e.preventDefault(); } }, true);
}
export async function gallery(photos, i, title) {
  photos = (photos || []).slice(); if (!photos.length) return; let n = i || 0, sx = null;
  const g = document.createElement('div'); g.className = 'gal'; g.innerHTML = `<div class="galh"><span id="galT"></span><button id="galX" title="Close">✕</button></div><img id="galI" alt="" draggable="false"><button class="gnav l" id="galP">‹</button><button class="gnav r" id="galN">›</button>`; document.body.appendChild(g);
  const show = async () => { n = (n + photos.length) % photos.length; g.querySelector('#galT').textContent = (title ? title + ' · ' : '') + 'photo ' + (n + 1) + ' of ' + photos.length; g.querySelector('#galI').src = await photoSrc(photos[n]); g.querySelectorAll('.gnav').forEach(b => b.style.display = photos.length > 1 ? '' : 'none'); };
  const close = nav => { if (!g.isConnected) return; g.remove(); document.removeEventListener('keydown', key); if (nav !== true) Nav.closed('gallery'); }, key = e => { if (e.key === 'Escape') close(); if (e.key === 'ArrowRight') { n++; show(); } if (e.key === 'ArrowLeft') { n--; show(); } };
  Nav.open('gallery', () => close(true)); g.querySelector('#galX').onclick = () => close(); g.querySelector('#galP').onclick = e => { e.stopPropagation(); n--; show(); }; g.querySelector('#galN').onclick = e => { e.stopPropagation(); n++; show(); };
  g.onclick = e => { if (e.target === g) close(); }; document.addEventListener('keydown', key);
  g.addEventListener('pointerdown', e => { sx = e.clientX; }); g.addEventListener('pointerup', e => { if (sx != null && Math.abs(e.clientX - sx) > 50 && photos.length > 1) { n += e.clientX < sx ? 1 : -1; show(); } sx = null; });
  show();
}
// History: every entry shows who and when; a change of status shows the old and new status in their own colours.
const WF_TO = [[/^Ready for inspection/i, 'Ready for review'], [/^(Accepted and closed|Completed and closed)/i, 'Closed'], [/^Reopened/i, 'Open'], [/^In progress/i, 'In progress'], [/^Ticked on the site sheet|^Marked "/i, null]];
function histHtml(h) {
  const txt = String(h.txt || ''); let from = h.st && h.st[0], to = h.st && h.st[1];
  if (!to) { const m = txt.match(/status ([^→;.]+?) → ([^;.]+)/i); if (m) { from = m[1].trim(); to = m[2].trim(); } }
  if (!to) { const w = WF_TO.find(x => x[0].test(txt)); if (w && w[1]) to = w[1]; }
  const raised = /^Raised|^Imported|^Added from/i.test(txt); if (!to && raised) { const m = txt.match(/Status ([^.]+)\./); if (m) to = m[1].trim(); }
  const pill = s => `<span class="pill" style="background:${SCOL[s] || '#888'}">${esc(s)}</span>`;
  const sys = /^(Changed |Raised|Imported|Added from|Pin placed|Unit |Filled in|Site note|Status |Ticked|Marked|Handwritten|Resolution note)/i.test(txt) || to;
  let body = esc(txt).replace(/status [^→;.]+? → [^;.]+(; |\.)?/i, '').replace(/(^|; |Changed )([a-z ]+?) ([^;→]+?) → ([^;.]+)/gi, (m0, pre, k, a, b) => `${pre}<b>${k}</b> <s>${a}</s> → <b>${b}</b>`).replace(/^Changed \.?$/, '').trim();
  return `<div class="h ${sys ? 'sys' : 'cm'}" style="--c:${to ? (SCOL[to] || '#888') : sys ? '#c9ced6' : '#2f6fd0'}"><div class="hh"><b>${esc(nzDT(h.t))}</b> · ${esc(h.who || '')}${raised ? ' <span class="hk">raised</span>' : !sys ? ' <span class="hk c">comment</span>' : ''}</div>${to ? `<div class="hs">${from ? pill(from) + ' <span class="ar">→</span> ' : '<span class="ar">now</span> '}${pill(to)}</div>` : ''}${body ? `<div class="ht">${body}</div>` : ''}</div>`;
}
function renderPins() {
  if (!PV || !S.project) return; const ids = new Set(filtered().map(d => d.id));
  PV.setPins(S.defects.filter(d => ((d.plan === S.curPlan && d.x != null) || (d.plan2 === S.curPlan && d.x2 != null)) && ids.has(d.id)).map(d => ({ id: d.id, x: d.plan === S.curPlan ? d.x : d.x2, y: d.plan === S.curPlan ? d.y : d.y2, colour: SCOL[d.status] || '#999', label: pinLabel(d), sel: S.sel === d.id, title: d.id + ' ' + (d.title || '') })));
}

/* ================================================================ plans */
let placing = null;
const lvlRank = l => { const t = String(l).toLowerCase(); if (/base|b\d/.test(t)) return -1; if (/ground|^g$|^gf/.test(t)) return 0; const m = t.match(/\d+/); return m ? +m[0] : /first/.test(t) ? 1 : /second/.test(t) ? 2 : /roof/.test(t) ? 99 : 50; };
const lvlShort = l => { const t = String(l).toLowerCase(); if (/ground|^g$|^gf/.test(t)) return 'G'; if (/base/.test(t)) return 'B'; if (/roof/.test(t)) return 'Roof'; const m = t.match(/\d+/); return m ? m[0] : /first/.test(t) ? '1' : /second/.test(t) ? '2' : String(l); };
function markTabs() {
  const pt = $('plantabs'), p = S.plans.find(x => x.id === S.curPlan); if (!pt) return;
  pt.querySelectorAll('[data-p]').forEach(b => b.classList.toggle('on', b.dataset.p === S.curPlan));
  const isFloor = p && p.block && p.level && p.kind !== 'elevation' && pt.querySelector('[data-blk]'); if (isFloor) S.lastFloor = p.id;
  pt.querySelectorAll('[data-blk]').forEach(b => b.classList.toggle('on', !!isFloor && b.dataset.blk === String(p.block)));
  pt.querySelectorAll('[data-lvl]').forEach(b => b.classList.toggle('on', !!isFloor && b.dataset.lvl === String(p.level)));
  const se = $('ptElev'); if (se) { se.value = ''; }
  // on an elevation the strip turns into one tap per elevation, so an exterior walk-round can flick between them
  const onEl = !!(p && p.kind === 'elevation' && pt.querySelector('.pte')); pt.classList.toggle('elev', onEl);
  pt.querySelectorAll('[data-el]').forEach(b => { const on = b.dataset.el === S.curPlan; b.classList.toggle('on', on); if (on && onEl) requestAnimationFrame(() => b.scrollIntoView({ block: 'nearest', inline: 'nearest' })); });
}
function renderPlanTabs() {
  const pt = $('plantabs');
  const gOf = p => p.kind === 'elevation' ? 'elev' : (p.group || (/site|landscape|locality|survey/i.test(p.name || '') ? 'site' : 'floor')); let lastG = null;
  const gr = { floor: 0, site: 1, elev: 2 };
  const sorted = S.plans.slice().sort((a, b) => gr[gOf(a)] - gr[gOf(b)]);
  const tabBtn = p => { const g = gOf(p); return `<button data-p="${esc(p.id)}" class="pt-${g}${p.id === S.curPlan ? ' on' : ''}">${g === 'elev' ? '📐 ' : g === 'site' ? '🗺 ' : ''}${esc(p.name)}</button>`; };
  // Compact switcher: when every floor plan is one block on one level, two short rows of letters replace a long strip of sheet names.
  const fl = sorted.filter(p => gOf(p) === 'floor'), keyed = fl.length > 1 && fl.every(p => p.block && p.level) && new Set(fl.map(p => p.block + '|' + p.level)).size === fl.length;
  if (keyed) {
    const blocks = uniq(fl.map(p => p.block)).sort(natural), levels = uniq(fl.map(p => p.level)).sort((a, b) => lvlRank(a) - lvlRank(b)), others = sorted.filter(p => gOf(p) === 'site'), el = sorted.filter(p => gOf(p) === 'elev');
    const elShort = n => String(n).replace(/elevations?/gi, '').replace(/\bblocks?\b/gi, '').replace(/[()]/g, ' ').replace(/^[\s\-–:,]+|[\s\-–:,]+$/g, '').replace(/\s*\/\s*/g, '/').replace(/\s+/g, ' ').trim() || n;
    pt.innerHTML = `<span class="pte"><button id="ptBack" title="Back to the floor plans">⬚ Floor plans</button><span class="seg"><em>Elevations</em>${el.map(p => `<button data-el="${esc(p.id)}" title="${esc(p.name)}">${esc(elShort(p.name))}</button>`).join('')}</span></span><span class="ptf"><span class="seg"><em>Block</em>${blocks.map(b => `<button data-blk="${esc(b)}">${esc(String(b).replace(/^block\s*/i, ''))}</button>`).join('')}</span><span class="seg"><em>Level</em>${levels.map(l => `<button data-lvl="${esc(l)}" title="${esc(l)}">${esc(lvlShort(l))}</button>`).join('')}</span>` + (others.length ? '<span class="ptsep"></span>' + others.map(tabBtn).join('') : '') + (el.length ? `<span class="ptsep"></span><select id="ptElev" class="ptsel"><option value="">📐 Elevations (${el.length})</option>${el.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select>` : '') + '</span>';
    pt.querySelectorAll('[data-el]').forEach(b => b.onclick = () => showPlan(b.dataset.el));
    $('ptBack').onclick = () => showPlan((fl.find(p => p.id === S.lastFloor) || fl[0]).id);
    const go = (b, l) => { const t = fl.find(p => p.block === b && p.level === l) || fl.find(p => p.block === b) || fl.find(p => p.level === l); if (t) showPlan(t.id); };
    const cur = () => fl.find(p => p.id === S.curPlan) || fl.find(p => p.id === S.lastFloor) || fl[0];
    pt.querySelectorAll('[data-blk]').forEach(b => b.onclick = () => go(b.dataset.blk, cur().level));
    pt.querySelectorAll('[data-lvl]').forEach(b => b.onclick = () => go(cur().block, b.dataset.lvl));
    if ($('ptElev')) $('ptElev').onchange = e => { if (e.target.value) showPlan(e.target.value); };
    markTabs();
  } else pt.innerHTML = (lastG = null, sorted.map(p => { const g = gOf(p), sep = lastG && g !== lastG ? '<span class="ptsep"></span>' : ''; lastG = g; return sep + tabBtn(p); }).join('')) +
    (S.plans.length ? '' : (can.admin() ? '<span class="muted small">No plans yet.</span><button class="act" id="bUpPlan">Upload plans</button>' : '<span class="muted small">No plans uploaded for this project yet.</span>'));
  let pinBtn = $('bPin'); if (!pinBtn) { pinBtn = document.createElement('button'); pinBtn.id = 'bPin'; pinBtn.className = 'pinfab'; $('planPane').appendChild(pinBtn); } pinBtn.textContent = '📍 Add pin'; pinBtn.classList.remove('on'); pinBtn.style.display = S.plans.length && can.edit() ? '' : 'none';
  pt.querySelectorAll('[data-p]').forEach(b => b.onclick = () => showPlan(b.dataset.p));
  if ($('bPin')) $('bPin').onclick = () => placing ? stopPlacing() : startPlacing({ mode: 'new' });
  if ($('bUpPlan')) $('bUpPlan').onclick = () => Admin.plansDialog();
}
export async function showPlan(id, focus) {
  if (Admin.zoneActive() && id !== S.curPlan) { if (!(await Admin.zoneSwitch(id))) return; }
  S.curPlan = id; const p = S.plans.find(x => x.id === id) || null;
  markTabs();
  // Alternative views of the same sheet (ceiling plan, wall plan, cladding elevations…). Pins dropped on a view take its surface.
  S.view = S.view || {}; const views = planViews(p), vkey = views.some(v => v.key === S.view[p && p.id]) && !can.contractor() ? S.view[p.id] : 'floor', cur = views.find(v => v.key === vkey) || views[0];
  await PV.setPlan(p, p ? await imgUrl(cur.img) : ''); PV.setZonesVisible(false); PV.setImageFit(cur.key === 'floor' ? null : ((cur.grids && cur.grids.length && p.grids && p.grids.length) ? Faces.gridFit(p.grids, cur.grids) : Faces.saneFit(cur.fit)));
  let rb = $('bRcp'); if (!rb) { rb = document.createElement('div'); rb.id = 'bRcp'; rb.className = 'viewbar'; $('planPane').appendChild(rb); }
  rb.style.display = p && views.length > 1 && !can.contractor() ? '' : 'none'; rb.classList.toggle('hidden', rb.style.display === 'none');
  rb.innerHTML = views.map(v => `<button data-view="${esc(v.key)}" class="${v.key === vkey ? 'on' : ''}">${esc(v.name)}</button>`).join('');
  rb.querySelectorAll('button').forEach(b => b.onclick = () => { S.view[S.curPlan] = b.dataset.view; showPlan(S.curPlan); });
  // elevations that look at this floor plan: one button each, opening the sheet zoomed to that face
  let eb = $('bElev'); if (!eb) { eb = document.createElement('div'); eb.id = 'bElev'; eb.className = 'viewbar elevbar'; $('planPane').appendChild(eb); }
  const elevs = p ? S.plans.flatMap(ep => (ep.kind === 'elevation' ? ((ep.links && ep.links.length) ? ep.links : (ep.link ? [ep.link] : [])) : []).filter(l => l.planId === p.id).map(l => ({ ep, l }))) : [];
  const backTo = p && p.kind === 'elevation' ? [...new Set(((p.links && p.links.length) ? p.links : (p.link ? [p.link] : [])).map(l => l.planId))].map(id => S.plans.find(q => q.id === id)).filter(Boolean) : [];
  eb.style.display = (elevs.length || backTo.length) ? '' : 'none'; eb.classList.toggle('hidden', eb.style.display === 'none');
  eb.innerHTML = elevs.map((x, i) => `<button data-el="${i}" title="${esc(x.ep.name)}">📐 ${esc(x.l.face || x.ep.face || 'Elevation')}</button>`).join('') + backTo.map(fp => `<button data-fp="${esc(fp.id)}">⬚ ${esc(fp.name)}</button>`).join('');
  eb.querySelectorAll('[data-el]').forEach(b => b.onclick = async () => { const x = elevs[+b.dataset.el]; await showPlan(x.ep.id); if (x.l.band) { const bx = x.l.bandX || [0, 1]; PV.zoomTo(bx[0], x.l.band[0], bx[1], x.l.band[1]); } });
  eb.querySelectorAll('[data-fp]').forEach(b => b.onclick = () => showPlan(b.dataset.fp));
  // on a phone the sheet buttons fold away behind one chip so they do not cover the drawing
  let vt = $('vbToggle'); if (!vt) { vt = document.createElement('button'); vt.id = 'vbToggle'; vt.className = 'vbtoggle'; $('planPane').appendChild(vt); vt.onclick = () => { const on = $('planPane').classList.toggle('vbopen'); vt.classList.toggle('on', on); }; }
  const nb = elevs.length + backTo.length; vt.style.display = nb ? '' : 'none'; vt.textContent = p && p.kind === 'elevation' ? '⬚ Floor plans' : '📐 Elevations (' + (elevs.length + backTo.length) + ')'; $('planPane').classList.remove('vbopen'); vt.classList.remove('on');
  if (Admin.zoneActive()) { await Admin.zoneEditor(PV); }
  renderPins(); if (isMobile() && focus) setTab('plan');
  if (focus && focus.x != null) requestAnimationFrame(() => PV.focus(focus.x, focus.y));
}
function startPlacing(pl) {
  placing = pl;
  if (pl.mode === 'queue') { PV.setMode('place', pl.html + '<button id="bnSkip">Skip</button><button id="bnStop">Stop</button>'); $('bnSkip').onclick = () => { stopPlacing(); pl.resolve('skip'); }; $('bnStop').onclick = () => { stopPlacing(); pl.resolve('stop'); }; return; } PV.setMode('place', (pl.mode === 'pick' ? esc(pl.banner || 'Tap the point') : pl.mode === 'new' ? 'Tap the plan where the defect is' : 'Tap the plan to set the location of ' + esc(pl.draft.id)) + '<button id="bnC">Cancel</button>');
  $('bnC').onclick = () => { const p = placing; stopPlacing(); if (p && p.mode === 'pick') p.resolve(null); else if (p && p.draft) openEditor(p.draft, p.isNew, true); };
  if ($('bPin')) { $('bPin').classList.add('on'); $('bPin').textContent = '✕ Cancel pin'; }
}
function stopPlacing() { placing = null; PV.setMode('view'); if ($('bPin')) { $('bPin').classList.remove('on'); $('bPin').textContent = '📍 Add pin'; } }
// Views of a plan: the floor plan itself plus any attached sheets (ceiling, walls, cladding). rcpImg is the older single-view field.
export function planViews(p) {
  if (!p) return [{ key: 'floor', name: 'Floor', surface: 'Floor', img: '' }];
  const v = [{ key: 'floor', name: 'Floor', surface: p.surface || 'Floor', img: p.img }];
  if (p.rcpImg && !(p.views || []).some(x => x.key === 'ceiling')) v.push({ key: 'ceiling', name: 'Ceiling', surface: 'Ceiling', img: p.rcpImg, path: p.rcpPath });
  (p.views || []).forEach(x => v.push(x));
  return v;
}
export const VIEW_TYPES = [['ceiling', 'Ceiling plan (RCP)', 'Ceiling'], ['walls', 'Wall plan / internal elevations', 'Wall'], ['cladding', 'Cladding / external elevations', 'Exterior cladding'], ['framing', 'Framing plan', 'Wall'], ['roof', 'Roof plan', 'Roof'], ['services', 'Services plan', 'Services'], ['joinery', 'Joinery / fit-out plan', 'Joinery']];
// Elevation -> floor plan mapping. An elevation plan carries link = { planId, a:[x,y], b:[x,y], ea, eb }: points a and b on the floor
// plan are the two ends of the building face, ea/eb the same two points as x fractions on the elevation image.
export function elevToFloor(ep, ex, ey) {
  const links = (ep.links && ep.links.length) ? ep.links : (ep.link ? [ep.link] : []);
  const inside = l => (!l.band || (ey >= l.band[0] && ey <= l.band[1])) && (!l.bandX || (ex >= l.bandX[0] && ex <= l.bandX[1]));
  const L = links.find(inside) || links.find(l => !l.band || (ey >= l.band[0] && ey <= l.band[1])) || links[0]; if (!L || !L.planId) return null; const fp = S.plans.find(q => q.id === L.planId); if (!fp) return null;
  let x, y, nx, ny;
  if (L.side && L.gmap && L.gmap.length >= 2) {
    // grid-mapped position along the face, dropped onto the stepped face path (or the straight a-b line when there is no path)
    const u = Faces.gridMap(L.gmap, ex); const pt = Faces.pathAt(L.path, L.side, u) || Faces.fromUV(L.side, u, Faces.toUV(L.side, L.a)[1]);
    x = pt[0]; y = pt[1]; const inw = Faces.inward(L.side); const nv = 1.5 / (Faces.isAlong(L.side) ? fp.h : fp.w); /* the pin sits on the line itself; only the unit lookup walks inwards */ nx = Faces.isAlong(L.side) ? 0 : inw * nv; ny = Faces.isAlong(L.side) ? inw * nv : 0;
  } else {
    const t = (ex - L.ea) / ((L.eb - L.ea) || 1); x = L.a[0] + t * (L.b[0] - L.a[0]); y = L.a[1] + t * (L.b[1] - L.a[1]);
    // nudge slightly inside the building so the point lands in the unit behind the face
    const dx = L.b[0] - L.a[0], dy = L.b[1] - L.a[1], len = Math.hypot(dx * fp.w, dy * fp.h) || 1; nx = -dy * fp.h / len * 10 / fp.w; ny = dx * fp.w / len * 10 / fp.h;
    // pick the side of the face that is inside the building: a unit boundary there, else towards the centre of the units
    const hitUnit = sgn => { const h = locate(fp.zones, x + sgn * nx * 3, y + sgn * ny * 3); return h && (h.unit || h.zone.kind === 'unit' || h.zone.kind === 'room'); };
    const units = (fp.zones || []).filter(z => z.kind === 'unit' && z.poly && z.poly.length > 2), ctr = units.length ? units.flatMap(z => z.poly).reduce((a, p) => [a[0] + p[0] / (units.length * 4), a[1] + p[1] / (units.length * 4)], [0, 0]) : [0.5, 0.5];
    const towards = ((ctr[0] - x) * nx + (ctr[1] - y) * ny) >= 0 ? 1 : -1;
    const sgn = hitUnit(1) && !hitUnit(-1) ? 1 : hitUnit(-1) && !hitUnit(1) ? -1 : towards; nx *= sgn; ny *= sgn;
  }
  const px = Math.max(0, Math.min(1, x + nx * 3)), py = Math.max(0, Math.min(1, y + ny * 3));
  // the unit behind the face: the first unit or room met walking inwards (a deck or porch in front of a unit still belongs to it)
  let hit = locate(fp.zones, px, py), k = 4; while (!(hit && (hit.unit || hit.room)) && k < 160) { hit = locate(fp.zones, x + nx * k, y + ny * k); k += 4; }
  // a few steps further usually reaches the room behind the wall (the unit outline sits on the wall, the room inside it)
  if (hit && hit.unit && !hit.room) { for (let j = k; j < k + 24; j += 4) { const h2 = locate(fp.zones, x + nx * j, y + ny * j); if (h2 && h2.room && String(h2.unit || hit.unit) === String(hit.unit)) { hit = h2; break; } } }
  return { planId: fp.id, x: px, y: py, face: [x, y], hit: hit || null };
}
// After a face line changes, every pin on that elevation is dropped onto the floor plan again from its elevation position.
// Unit and room are replaced only where they still hold what the pin filled in originally (hand edits are kept).
export async function remapElevationPins(epId) {
  const ep = S.plans.find(q => q.id === epId); if (!ep) return 0; let n = 0;
  for (const d of S.defects.filter(q => q.plan === epId && q.x != null)) {
    const m = elevToFloor(ep, d.x, d.y); if (!m) continue;
    const patch = { plan2: m.planId, x2: m.x, y2: m.y }; const fp = S.plans.find(q => q.id === m.planId), hit = m.hit || locate(fp.zones, m.x, m.y);
    const auto = d.autoLoc || {}; const nu = hit && hit.unit ? String(hit.unit) : '', nr = hit && hit.room ? hit.room : '';
    if (!d.unit || String(d.unit) === String(auto.unit || '')) patch.unit = nu || d.unit || '';
    if (!d.room || d.room === (auto.room || '')) patch.room = nr || d.room || '';
    if (fp.block && !d.block) patch.block = fp.block; if (fp.level && (!d.level || d.level === ep.level)) patch.level = fp.level;
    patch.autoLoc = { unit: patch.unit != null ? patch.unit : d.unit || '', room: patch.room != null ? patch.room : d.room || '' };
    const changed = Object.keys(patch).some(k => k !== 'autoLoc' && JSON.stringify(patch[k] ?? '') !== JSON.stringify(d[k] ?? ''));
    if (!changed) continue;
    try { await S.store.updateDefect(S.project.id, d.id, patch); Object.assign(d, patch); n++; } catch (e) { console.warn('remap', d.id, e); }
  }
  if (n) render();
  return n;
}
// A pin dragged to a new spot on the plan it sits on: location fields that the pin filled in follow it; hand-typed ones stay.
async function movePin(id, x, y) {
  const d = S.defects.find(q => q.id === id); if (!d) return; const planId = d.plan === S.curPlan ? d.plan : (d.plan2 === S.curPlan ? d.plan2 : null); if (!planId) return;
  const w = JSON.parse(JSON.stringify(d)), auto = d.autoLoc || {};
  if (planId === d.plan) { applyZone(w, x, y, planId); }
  else { w.x2 = x; w.y2 = y; const fp = S.plans.find(q => q.id === planId), hit = locate(fp.zones, x, y) || {}; w.unit = hit.unit || ''; w.room = hit.room || ''; w.autoLoc = { unit: w.unit, room: w.room }; }
  const patch = { x: w.x, y: w.y, plan2: w.plan2 || null, x2: w.x2 ?? null, y2: w.y2 ?? null, autoLoc: w.autoLoc || null };
  if (!d.unit || String(d.unit) === String(auto.unit || '')) patch.unit = w.unit || ''; if (!d.room || d.room === (auto.room || '')) patch.room = w.room || '';
  if (w.item && (!d.item || d.item === auto.item)) patch.item = w.item;
  try { await S.store.updateDefect(S.project.id, id, patch); Object.assign(d, patch); render(); toast(`${id} moved${patch.unit ? ' · Unit ' + patch.unit : ''}${patch.room ? ' · ' + patch.room : ''}`, 2500); } catch (e) { toast('Could not move the pin: ' + friendly(e)); }
}
function applyZone(d, x, y, planId) {
  const p = S.plans.find(q => q.id === planId); d.plan = planId; d.x = x; d.y = y;
  if (p.kind === 'elevation') {
    const m = elevToFloor(p, x, y); d.surface = d.surface && d.surface !== 'Floor' ? d.surface : 'Exterior cladding';
    if (m) { d.plan2 = m.planId; d.x2 = m.x; d.y2 = m.y; const fp = S.plans.find(q => q.id === m.planId), hit = m.hit || locate(fp.zones, m.x, m.y); d.block = fp.block || p.block || d.block; d.level = fp.level || p.level || d.level; if (hit) { if (hit.unit) d.unit = hit.unit; if (hit.room) d.room = hit.room; if (!d.level && hit.level) d.level = hit.level; } d.autoLoc = { unit: d.unit || '', room: d.room || '' }; d.zoneHit = [hit && hit.unit && 'Unit ' + hit.unit, hit && hit.room, d.surface, 'also pinned on ' + fp.name].filter(Boolean).join(', '); }
    else { d.plan2 = null; d.block = p.block || d.block; d.level = p.level || d.level; d.zoneHit = d.surface + ' (elevation not linked to a floor plan yet)'; }
    return;
  }
  d.plan2 = null;
  const hit = locate(p.zones, x, y);
  const cv = planViews(p).find(v => v.key === ((S.view || {})[planId] || 'floor')); if (cv && cv.key !== 'floor') d.surface = cv.surface; else if (!d.surface) d.surface = p.surface || 'Floor';
  if (hit) { if (hit.unit) d.unit = hit.unit; if (hit.room) d.room = hit.room; if (hit.item) d.item = hit.item; else if (hit.room) d.item = d.item || ''; d.block = hit.block || p.block || d.block; d.level = hit.level || p.level || d.level; d.autoLoc = { unit: d.unit || '', room: d.room || '', item: hit.item || '' }; d.zoneHit = [hit.unit && 'Unit ' + hit.unit, hit.room, hit.item, d.surface].filter(Boolean).join(', '); }
  else { d.block = p.block || d.block; d.level = p.level || d.level; d.zoneHit = ''; }
}
// Pins handed in from a file (for example a consultant's plan markups located on the drawings). Uses the same rules as dropping a pin by hand:
// an elevation pin also lands on the floor plan, unit and room are filled where empty, and hand-typed location text is kept.
export function pinPatch(d, planId, x, y, room, item, where) {
  let spot = null; if (x == null) { const z = findZone(d.unit, room == null ? d.room : room, item, where); if (!z) return null; spot = z; planId = z.plan.id; x = z.x; y = z.y; }
  const w = JSON.parse(JSON.stringify(d)), auto = d.autoLoc || {}; w.item = ''; applyZone(w, x, y, planId);
  const patch = { plan: planId, x, y, plan2: w.plan2 || null, x2: w.x2 ?? null, y2: w.y2 ?? null, autoLoc: w.autoLoc || null, surface: w.surface || d.surface || '', zoneHit: w.zoneHit || '' };
  if (!d.unit || String(d.unit) === String(auto.unit || '')) patch.unit = w.unit || ''; if (!d.room || d.room === (auto.room || '')) patch.room = w.room || '';
  if (!d.block && w.block) patch.block = w.block; if (!d.level && w.level) patch.level = w.level; if (w.item && !d.item) patch.item = w.item;
  return patch;
}
async function onPlace(x, y) {
  const pl = placing; stopPlacing();
  if (pl.mode === 'pick') { toast('✓ Point recorded', 1200); pl.resolve({ x, y }); return; }
  if (pl.mode === 'queue') { pl.resolve({ x, y, plan: S.curPlan }); return; }
  if (pl.mode === 'new') { const d = await newDefect(); applyZone(d, x, y, S.curPlan); openEditor(d, true, true); nextStep(); }
  else { applyZone(pl.draft, x, y, S.curPlan); openEditor(pl.draft, pl.isNew, true); if (pl.isNew) nextStep(); }
}
// Where a unit shows on the elevations: the middle of the stretch of elevation that lands in that unit, preferring its deck or patio face.
export function elevSpot(unit) {
  let best = null;
  for (const ep of S.plans) { if (ep.kind !== 'elevation') continue; const links = (ep.links && ep.links.length) ? ep.links : (ep.link ? [ep.link] : []);
    for (const L of links) { if (!L.band) continue; const bx = L.bandX || [0, 1], ey = (L.band[0] + L.band[1]) / 2, N = 160, all = [], deck = [];
      for (let i = 0; i <= N; i++) { const ex = bx[0] + (bx[1] - bx[0]) * i / N; let m = null; try { m = elevToFloor(ep, ex, ey); } catch (e) {} if (!m || m.planId !== L.planId || !m.hit || String(m.hit.unit) !== String(unit)) continue; all.push(ex); if (/deck|patio/i.test(m.hit.room || '')) deck.push(ex); }
      const use = deck.length >= 3 ? deck : all; if (use.length < 3) continue; const score = deck.length * 1000 + all.length;
      if (!best || score > best.score) best = { score, plan: ep, x: (use[0] + use[use.length - 1]) / 2, y: ey, face: L.face || ep.name };
    } }
  return best;
}
// Items waiting for a pin: walk through them one at a time. Each opens the plan for its unit (zoomed to the unit when it has an outline);
// tap where it is, or switch to another plan or elevation first. Skip leaves it for later, Stop ends the run.
export const unpinned = () => S.defects.filter(d => d.status !== 'Closed' && !d.general && (!d.plan || d.x == null)).sort((a, b) => natural(String(a.unit || 'zz'), String(b.unit || 'zz')) || natural(a.id, b.id));
export async function pinQueue() {
  const L = unpinned(); if (!L.length) return toast('Every open item has a pin'); if (!can.edit()) return toast('Your role cannot place pins');
  closeModal(); let done = 0, skipped = 0;
  for (let i = 0; i < L.length; i++) {
    const d = L[i]; setTab('plan');
    const z = d.unit ? findZone(d.unit, '') : null, bp = !z && d.block ? S.plans.find(p => p.kind !== 'elevation' && String(p.block || '').toUpperCase() === String(d.block).toUpperCase()) : null;
    const pid = z ? z.plan.id : bp ? bp.id : (S.curPlan || (S.plans[0] || {}).id); if (!pid) break; await showPlan(pid);
    if (z && z.zone && z.zone.poly) { const xs = z.zone.poly.map(q => q[0]), ys = z.zone.poly.map(q => q[1]); requestAnimationFrame(() => PV.zoomTo(Math.min(...xs) - 0.02, Math.min(...ys) - 0.02, Math.max(...xs) + 0.02, Math.max(...ys) + 0.02)); }
    const where = [d.unit && 'Unit ' + d.unit, d.room, d.ext && d.ext['Interior / exterior']].filter(Boolean).join(' · ');
    const ans = await new Promise(resolve => startPlacing({ mode: 'queue', resolve, html: `<span class="pq"><b>${i + 1} of ${L.length} · ${esc(d.id)}</b>${where ? ' · ' + esc(where) : ''}<br>${esc(String(d.desc || d.title || '').slice(0, 110))}<br><small>Tap where it is. You can change plan first.</small></span>` }));
    if (ans === 'stop') break; if (ans === 'skip') { skipped++; continue; }
    const patch = pinPatch(d, ans.plan, ans.x, ans.y); try { await S.store.updateDefect(S.project.id, d.id, { ...patch, needsPin: false }); Object.assign(d, patch, { needsPin: false }); done++; renderPins(); } catch (e) { toast('Could not save the pin: ' + friendly(e)); break; }
  }
  render(); const left = unpinned().length; modal(`<h2>Pinning</h2><p><b>${done}</b> pinned this run${skipped ? `, ${skipped} skipped` : ''}. <b>${left}</b> open item${left === 1 ? '' : 's'} still without a pin.</p><div class="act">${left ? '<button id="pqMore">Carry on</button>' : ''}<button class="go" id="pqOk">Done</button></div>`); $('pqOk').onclick = closeModal; if ($('pqMore')) $('pqMore').onclick = pinQueue;
}
// Ask the user to tap one point on a plan (used when linking an elevation to a floor plan).
export function pickPoint(planId, banner) { return new Promise(resolve => { setTab('plan'); showPlan(planId).then(() => startPlacing({ mode: 'pick', resolve, banner })); }); }
export function setTab(t) { if (t === 'plan' && isMobile() && !Nav.isOpen('plantab')) Nav.open('plantab', () => setTab('list')); if (t === 'list') Nav.closed('plantab'); $('main').className = 'tab-' + t; document.querySelectorAll('#mtabs button').forEach(b => b.classList.toggle('on', b.dataset.t === t)); if (t === 'plan') requestAnimationFrame(() => { if (!PV.pv.user) PV.fit(); }); }
// find a room boundary from a unit + room name (used after dictation, so the pin can be dropped automatically)
function findZone(unit, room, item, where) {
  const r = String(room || '').toLowerCase().replace(/\s+\d+$/, ''), it = String(item || '').toLowerCase(), W = where || {};
  const plans = S.plans.filter(p => p.kind !== 'elevation' && (!W.block || String(p.block || '').toUpperCase() === String(W.block).toUpperCase()) && (!W.level || String(p.level || '').toLowerCase().startsWith(String(W.level).toLowerCase())));
  if (it && unit) for (const p of plans) for (const z of (p.zones || [])) { if (z.kind !== 'item' || !z.poly || !String(z.name || '').toLowerCase().startsWith(it)) continue; const c = centroid(z.poly), hit = locate(p.zones.filter(q => q.kind !== 'item'), c[0], c[1]) || {}; if (String(hit.unit) === String(unit) || String(z.unit) === String(unit)) return { plan: p, zone: z, x: c[0], y: c[1] }; }
  for (const p of plans) for (const z of (p.zones || [])) {
    if (!z.poly || z.kind === 'unit') continue; const c = centroid(z.poly); const hit = locate(p.zones, c[0], c[1]) || {};
    if (unit && String(hit.unit) !== String(unit)) continue; if (!unit && hit.unit) continue;
    if (r && String(z.name || '').toLowerCase().startsWith(r)) return { plan: p, zone: z, x: c[0], y: c[1] };
  }
  if (unit && W.strict) return null;
  if (unit) for (const p of S.plans) for (const z of (p.zones || [])) if (z.kind === 'unit' && String(z.unit) === String(unit)) { const c = centroid(z.poly); return { plan: p, zone: z, x: c[0], y: c[1], unitOnly: true }; }
  return null;
}
const centroid = poly => { let x = 0, y = 0; poly.forEach(p => { x += p[0]; y += p[1]; }); return [x / poly.length, y / poly.length]; };
const uniq = a => [...new Set(a.filter(Boolean).map(String))];
function blockList() { return uniq([...(S.project.blocks || []), ...S.plans.map(p => p.block), ...S.plans.flatMap(p => (p.zones || []).map(z => z.block)), ...S.defects.map(d => d.block)]).sort(natural); }
function levelList() { return uniq([...(S.project.levels || []), ...S.plans.map(p => p.level), ...S.plans.flatMap(p => (p.zones || []).map(z => z.level)), ...S.defects.map(d => d.level)]).sort(natural); }
// People on the project: members plus the responsible-party list, for "on behalf of".
function peopleList() { const info = S.project.memberInfo || {}; return uniq([...Object.values(info).map(i => i.name || i.email), ...(S.project.responsible || [])]).sort(natural); }
function unitInfo(u) { for (const p of S.plans) for (const z of (p.zones || [])) if (z.kind === 'unit' && String(z.unit) === String(u)) return { block: z.block || p.block, level: z.level || p.level }; return null; }

/* ================================================================ editor */
let ED = null;
const FIELDS = ['subcontractor', 'source', 'dateRaised', 'block', 'level', 'unit', 'room', 'surface', 'item', 'element', 'title', 'desc', 'type', 'severity', 'trade', 'responsible', 'action', 'targetDate', 'status'];
async function newDefect() {
  const p = S.project;
  return { id: '', isNew: true, source: S.local.source || p.sources[0], dateRaised: todayISO(), raisedBy: S.user.name, block: '', level: '', unit: '', room: '', element: '', title: '', desc: '', type: p.types[0], severity: sevDefault(p), trade: p.trades[0], responsible: p.responsible[0], action: '', targetDate: '', status: 'Open', plan: '', x: null, y: null, photos: [], history: [], transcript: '' };
}
export function openEditor(d, isNew, isDraft) {
  const w = isDraft ? d : JSON.parse(JSON.stringify(d)); const p = S.project;
  ED = { d: w, isNew: !!isNew, orig: isNew ? null : S.defects.find(x => x.id === d.id), removed: ED && ED.d === d ? ED.removed : [] };
  const ro = !can.write(), con = can.contractor();
  const dis = ro || con ? 'disabled' : '';
  $('edTitle').textContent = isNew ? 'New defect' : w.id;
  const units = [...new Set([...unitList(p), ...(w.unit ? [String(w.unit)] : [])])];
  const stat = con ? p.statuses.filter(s => ['Open', 'In progress', 'Ready for review'].includes(s) || s === w.status || (s === 'Closed' && selfClose(w))) : p.statuses;
  $('edBody').innerHTML = `${w.aiPending ? '<div class="ainote show" id="aiWait">📵 Site note recorded out of coverage. Gemini will fill in the form when the phone is back in service. You can still edit and pin it now.' + (w.transcript ? '<br><span class="muted">Spoken note: “' + esc(w.transcript) + '”</span>' : '') + ' <a href="#" id="aiWaitX">Already filled in? Clear this notice</a></div>' : ''}${w.aiReview ? '<div class="ainote show">✨ Gemini filled this in from your site note while you were out of coverage. Check the fields, then Save to mark it checked.</div>' : ''}
  ${!ro && !con && (isNew || w.createdBy === S.user.email || (!w.createdBy && can.admin())) ? `<div class="dict">
    <div class="row1"><button class="mic" id="mic" title="Hold to talk"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-2.08A7 7 0 0 0 19 12h-2z"/></svg></button>
    <textarea id="dt" placeholder="Hold the mic and say what is wrong, e.g. &quot;silicone to the shower tray is patchy and there is a gap behind the vanity, contractor to redo before handover&quot;. The pin gives the unit and room.">${esc(w.transcript || '')}</textarea></div>
    <div class="row2"><button class="ai" id="aiGo">✨ Interpret with Gemini</button><label><input type="checkbox" id="aiPh" checked> include first photo</label><span id="aiSt" class="muted"></span></div>
    <div class="ainote" id="aiNote"></div></div>` : ''}
  ${con ? '<p class="note muted small">You can add photos, attach files, add a response and mark the item ready for inspection. Other changes are made by the project team.</p>' : ''}
  ${!isNew && !ro ? workflowBar(w, con) : ''}
  <div class="grid">
    <label class="f full">Title ${!dis ? '<a href="#" id="edTyp" class="small" style="float:right">⚡ Typical defects</a>' : ''}<input name="title" value="${esc(w.title)}" ${dis} placeholder="Short name, e.g. Shower tray silicone incomplete"></label>
    <label class="f full">Description<textarea name="desc" ${dis}>${esc(w.desc)}</textarea></label>
    <label class="f full">Action required<textarea name="action" style="min-height:44px" ${dis}>${esc(w.action)}</textarea></label>
  </div>
  <h3 class="sec">Location</h3>
  <div class="locbox" id="locBox"><canvas id="locC" width="300" height="200"></canvas><div><div id="locT" style="margin-bottom:6px"></div>${!ro && !con && S.plans.length ? `<button class="${w.plan || w.general ? 'mini' : 'pinbig'}" id="setPin">📍 ${w.plan ? 'Move pin' : 'Pin it on the plan'}</button> ${w.plan ? '<button class="mini" id="clrPin">Remove pin</button>' : `<button class="mini ${w.general ? 'on' : ''}" id="genBtn" title="For something that applies across a building or the whole site, with no single place">${w.general ? '✓ General defect' : 'General defect (no single place)'}</button>`}` : ''}${w.plan && !ED.isNew ? ' <button class="mini" id="goPin">Show on plan</button>' : ''}<div class="note small" id="locNeed" style="display:none;color:#a32222;margin-top:6px">Pin it on the plan, or mark it as a general defect, before saving.</div></div></div>
  <details class="ext" id="locMore" ${!w.plan && (w.unit || w.room || w.block) ? 'open' : ''}><summary>Location details${w.plan ? ' (filled in by the pin)' : ''}</summary>
  <div class="grid">
    <label class="f">Unit<select name="unit" ${dis}><option value="">Common / none</option>${units.map(u => `<option ${String(w.unit) === u ? 'selected' : ''}>${esc(u)}</option>`).join('')}</select></label>
    <label class="f">Room / area<input name="room" value="${esc(w.room)}" list="rooms" ${dis}></label>
    <label class="f">Surface<select name="surface" ${dis}><option value="">Not set</option>${opts(SURFACES, w.surface)}</select></label>
    <label class="f">Item<input name="item" value="${esc(w.item || '')}" list="items" placeholder="e.g. Kitchen unit, Vanity, Shower" ${dis}></label>
    <label class="f">Block<select name="block" ${dis}><option value="">Not set</option>${opts(blockList(), w.block)}</select></label>
    <label class="f">Level<select name="level" ${dis}><option value="">Not set</option>${opts(levelList(), w.level)}</select></label>
  </div></details>
  <div class="grid"><label class="f full">Element / product<input name="element" value="${esc(w.element)}" ${dis} placeholder="e.g. Shower tray, cladding, fire door"></label></div>
  <datalist id="items">${uniq([...S.plans.flatMap(p => (p.zones || []).filter(z => z.kind === 'item').map(z => z.name)), ...S.defects.map(d => d.item), ...(S.project.items || [])]).map(v => `<option value="${esc(v)}">`).join('')}</datalist><datalist id="rooms">${[...new Set([...S.plans.flatMap(pl => (pl.zones || []).filter(z => z.kind !== 'unit' && z.name).map(z => z.name)), ...p.rooms])].map(r => `<option>${esc(r)}</option>`).join('')}</datalist>
  <datalist id="blocks">${[...new Set(S.plans.map(x => x.block).filter(Boolean))].map(r => `<option>${esc(r)}</option>`).join('')}</datalist>
  <datalist id="levels">${[...new Set(S.plans.map(x => x.level).filter(Boolean))].map(r => `<option>${esc(r)}</option>`).join('')}</datalist>
  <h3 class="sec">Classification</h3>
  <div class="grid">
    <label class="f">Status<select name="status" ${ro ? 'disabled' : ''}>${opts(stat, w.status)}</select></label>
    <label class="f">${esc(sevLabel(p))}<select name="severity" ${dis}>${opts(p.severities, w.severity)}</select></label>
    <label class="f">Type<select name="type" ${dis}>${opts(p.types, w.type)}</select></label>
    <label class="f">Trade<select name="trade" ${dis}>${opts(p.trades, w.trade)}</select></label>
    <label class="f">Responsible<select name="responsible" ${dis}>${opts(p.responsible, w.responsible)}</select></label>
    <label class="f">Subcontractor<input name="subcontractor" list="subL" value="${esc(w.subcontractor || '')}" ${ro ? 'disabled' : ''} placeholder="pick from the list, or type a new name to add it"><datalist id="subL">${subList().map(x => `<option>${esc(x)}</option>`).join('')}</datalist></label>
    <label class="f">Target date<input type="date" name="targetDate" value="${esc(w.targetDate)}" ${dis}></label>
    <label class="f">Source<select name="source" ${dis}>${opts(p.sources, w.source)}</select></label>
    <label class="f">Date raised<input type="date" name="dateRaised" value="${esc(w.dateRaised)}" ${dis}></label>
  </div>
  <h3 class="sec">Photos <span class="sp"></span>${!ro ? '<span class="muted small" style="text-transform:none;letter-spacing:0;font-weight:400">Tap a photo to mark it up</span>' : ''}</h3>
  <div class="photos" id="phs"></div>
  <h3 class="sec">Attachments</h3>
  <div class="files" id="fls">${(w.files || []).map((f, i) => `<div class="file"><a href="#" data-f="${i}">📎 ${esc(f.name)}</a><span class="muted small"> · ${esc(f.by || '')} ${esc(nzDate((f.t || '').slice(0, 10)))}${f.pending ? ' · waiting to upload' : ''}</span>${!ro && (can.edit() || f.isNew) ? ` <button data-fx="${i}" class="small">✕</button>` : ''}</div>`).join('')}${!ro ? `<div class="flbtns"><button id="addfile" class="small">📎 Attach PDF or file</button>${((S.fm || {}).docs || []).length ? '<button id="findDoc" class="small">🔎 Find a project document</button>' : ''}</div>` : ''}</div>
  ${!ro ? `<div id="cmtBox"><h3 class="sec">${con ? 'Your response' : 'Add a comment'}</h3><label class="f"><textarea id="cmt" style="min-height:44px" placeholder="${con ? 'Your response: what was done, when, and anything the reviewer should know' : 'Add a comment (saved with your name and the time)'}"></textarea></label>${!con && can.edit() ? `<label class="f small">On behalf of (when relaying an email or a verbal response)<select id="cmtFor"><option value="">Myself</option>${peopleList().map(n => `<option>${esc(n)}</option>`).join('')}</select></label>` : ''}</div>` : ''}
  <h3 class="sec" id="hHist">History <span class="muted small" style="text-transform:none;letter-spacing:0;font-weight:400">newest first</span></h3>
  <div class="hist">${(w.history || []).slice().sort((a, b) => String(b.t || '').localeCompare(String(a.t || ''))).map(histHtml).join('') || '<div>No history yet.</div>'}</div>
  ${w.ext ? `<details class="ext"><summary>Original record (${esc(w.extRef || w.source)})</summary>${Object.entries(w.ext).filter(e => e[1]).map(([k, v]) => `<p><b>${esc(k)}:</b> ${esc(v)}</p>`).join('')}</details>` : ''}`;
  const body = $('edBody');
  if (!ro && w.unit && (!w.block || !w.level)) { const u = unitInfo(w.unit); if (u) { if (!w.block && u.block) { w.block = u.block; body.querySelector('[name=block]').value = u.block; } if (!w.level && u.level) { w.level = u.level; body.querySelector('[name=level]').value = u.level; } } }
  body.querySelector('[name=unit]').onchange = e => { const u = unitInfo(e.target.value); if (u) { if (u.block) body.querySelector('[name=block]').value = u.block; if (u.level) body.querySelector('[name=level]').value = u.level; } };
  if ($('mic')) { holdToTalk($('mic'), () => dictate($('dt'), $('mic'), aiStatus, () => { if (!navigator.onLine) queueNote($('dt').value.trim()); else if (S.local.autoAI !== false) interpret(); })); $('aiGo').onclick = interpret; }
  if ($('setPin')) $('setPin').onclick = () => { collect(); const pl = { mode: 'edit', draft: ED.d, isNew: ED.isNew }; const tgt = ED.d.plan || (S.plans.find(x => x.block === ED.d.block && x.level === ED.d.level) || {}).id || S.curPlan; closeEditor(true); showPlan(tgt); setTab('plan'); startPlacing(pl); };
  if ($('clrPin')) $('clrPin').onclick = () => { collect(); ED.d.plan = ''; ED.d.x = ED.d.y = null; ED.d.zoneHit = ''; openEditor(ED.d, ED.isNew, true); };
  if ($('genBtn')) $('genBtn').onclick = () => { collect(); ED.d.general = !ED.d.general; openEditor(ED.d, ED.isNew, true); };
  if ($('aiWaitX')) $('aiWaitX').onclick = e => { e.preventDefault(); ED.d.aiPending = false; $('aiWait').remove(); if (!ED.isNew && ED.d.id) S.store.updateDefect(S.project.id, ED.d.id, { aiPending: false }).catch(() => {}); };
  if ($('goPin')) $('goPin').onclick = () => { const d = ED.d; closeEditor(); showPlan(d.plan, d); setTab('plan'); };
  // New items are staged: 1 pin, 2 photo, 3 Gemini. The place and the picture go in first so Gemini is not guessing.
  const dict = $('edBody').querySelector('.dict');
  if (isNew && dict && S.plans.length) {
    const hs = [...$('edBody').querySelectorAll('h3.sec')], hLoc = hs.find(h => /^Location/.test(h.textContent)), hPh = hs.find(h => /^Photos/.test(h.textContent));
    const hG = document.createElement('h3'); hG.className = 'sec stg'; hG.id = 'stg3'; hG.innerHTML = '<i>3</i> Describe it <span class="muted small" style="text-transform:none;letter-spacing:0;font-weight:400">Gemini fills in the form</span>';
    const lk = document.createElement('div'); lk.className = 'note small stglock'; lk.id = 'stgLock';
    const B = $('edBody'), tag = (t, k) => `<span class="rq ${k}">${t}</span>`, sub = 'style="text-transform:none;letter-spacing:0;font-weight:400"';
    const hAtt = hs.find(h => /^Attachments/.test(h.textContent)), hCls = hs.find(h => /^Classification/.test(h.textContent)), hHist = $('hHist'), tg = B.querySelector('[name=title]').closest('.grid'), elg = B.querySelector('[name=element]').closest('.grid');
    hLoc.classList.add('stg'); hLoc.id = 'stg1'; hLoc.innerHTML = '<i>1</i> Where is it ' + tag('Required', 'must');
    hPh.classList.add('stg'); hPh.id = 'stg2'; hPh.innerHTML = '<i>2</i> Photo ' + tag('Needed for Gemini', 'must') + ` <span class="muted small" ${sub}>Tap a photo to mark it up</span>`;
    hG.innerHTML = '<i>3</i> Describe it ' + tag('Required', 'must') + ` <span class="muted small" ${sub}>Say it and Gemini fills in the form, or type a title</span>`;
    const hRef = document.createElement('div'); hRef.className = 'subh'; hRef.innerHTML = 'Reference documents ' + tag('Optional', 'opt') + ` <span class="muted small">A drawing, specification or data sheet for quick reference</span>`;
    const hDet = document.createElement('h3'); hDet.className = 'sec stg'; hDet.innerHTML = '<i>4</i> Details ' + tag('Optional', 'opt') + ` <span class="muted small" ${sub}>Already set to the usual answers</span>`;
    const card = nodes => { const c = document.createElement('div'); c.className = 'stgcard'; nodes.forEach(n => n && c.appendChild(n)); return c; };
    const clsGrid = hCls && hCls.nextElementSibling, cards = [card([hLoc, $('locBox'), $('locMore')]), card([hPh, $('phs'), hRef, $('fls')]), card([hG, lk, dict, tg]), card([hDet, elg, clsGrid])];
    if (hCls) hCls.remove(); if (hAtt) hAtt.remove();
    if ($('cmtBox')) { const h = $('cmtBox').querySelector('h3'); if (h) h.innerHTML = 'Add a comment ' + tag('Optional', 'opt'); cards.push(card([$('cmtBox')])); }
    const first = B.firstElementChild; cards.forEach(c => B.insertBefore(c, first));
    tg.addEventListener('input', () => stageGate());
    if (hHist) { const hi = hHist.nextElementSibling; hHist.remove(); if (hi) hi.remove(); }
    ED.staged = true;
  }
  // An existing item opens as a working record: status and place, the action buttons, photos and the response box first; the form details fold away underneath.
  if (!isNew) {
    const B = $('edBody'), hs = [...B.querySelectorAll('h3.sec')], hPh = hs.find(h => /^Photos/.test(h.textContent)), hCls = hs.find(h => /^Classification/.test(h.textContent)), tg = B.querySelector('[name=title]').closest('.grid');
    const L0 = filtered(), ix = L0.findIndex(x => x.id === w.id), pinned = w.plan && w.x != null;
    const sum = document.createElement('div'); sum.className = 'sumline'; sum.innerHTML = `<div class="sumt"><div><span class="pill" style="background:${SCOL[w.status] || '#999'}">${esc(w.status)}</span> <b>${esc(w.id || '')}</b>${ix >= 0 && L0.length > 1 ? ` <span class="muted small">${ix + 1} of ${L0.length}</span>` : ''}</div><div class="suml">${esc(locText(w) || (w.general ? 'General defect' : 'No location yet'))}</div></div>${pinned ? '<img class="snip big" id="sumSnip" alt="Location on the plan" draggable="false">' : (!ro && !con && S.plans.length && !w.general ? '<button class="mini" id="sumSet">📍 Pin it</button>' : '')}`;
    B.insertBefore(sum, B.firstElementChild);
    const lc = document.createElement('div'); lc.innerHTML = lastNoteHtml(w); if (lc.firstChild) sum.after(lc.firstChild);
    const cn = B.querySelector(':scope > p.note.muted.small'); if (cn && /You can add photos/.test(cn.textContent)) cn.remove();
    const hAtt = hs.find(h => /^Attachments/.test(h.textContent)); if (hAtt) hAtt.textContent = 'Documents';
    [hPh, $('phs'), hAtt, $('fls')].forEach(n => n && B.insertBefore(n, tg));
    if ($('cmtBox')) $('cmtBox').hidden = true;   // comments and responses are written in the pop-up that goes with the button pressed
    // the plan cut-out now sits in the top strip; the pin buttons move into Location details
    const hLoc = hs.find(h => /^Location/.test(h.textContent)), lb = $('locBox'), lm = $('locMore'); if (hLoc) hLoc.remove();
    if (lb && lm) { const row = document.createElement('div'); row.className = 'pinrow'; ['setPin', 'clrPin', 'genBtn', 'goPin'].forEach(id => { const b = $(id); if (b && id !== 'goPin') row.appendChild(b); else if (b) b.remove(); }); lm.appendChild(row); lb.style.display = 'none'; lm.querySelector('summary').textContent = 'Location details' + (pinned ? '' : ' (not pinned)'); }
    if (pinned) snip(w, 200).then(u => { const im = $('sumSnip'); if (im && u) { im.src = u; snipWire(im, ED.d); } }).catch(() => {});
    if ($('sumSet')) $('sumSet').onclick = () => $('setPin') && $('setPin').click();
    const dc = B.querySelector('.dict'); if (dc) { const dd = document.createElement('details'); dd.className = 'ext'; dd.innerHTML = '<summary>✨ Dictate a change with Gemini</summary>'; B.insertBefore(dd, tg); dd.appendChild(dc); if (w.aiPending || w.transcript && !w.title) dd.open = true; }
    const hT = document.createElement('h3'); hT.className = 'sec'; hT.textContent = 'The defect'; B.insertBefore(hT, tg);
    if (hCls) { const gr = hCls.nextElementSibling, dd = document.createElement('details'); dd.className = 'ext clsd'; dd.innerHTML = `<summary>Details <span class="muted small">${esc([w.severity, w.trade, w.subcontractor || w.responsible, w.targetDate ? 'due ' + nzDate(w.targetDate) : ''].filter(Boolean).join(' · '))}</span></summary>`; B.insertBefore(dd, hCls); dd.appendChild(gr); hCls.remove(); if (!isMobile()) dd.open = true; }
  }
  drawLoc(); renderPhotos();
  $('edDel').style.display = isNew || !can.admin() ? 'none' : ''; $('edSave').style.display = ro ? 'none' : '';
  $('edCancel').textContent = ro ? 'Close' : 'Cancel';
  if (!$('sheet').classList.contains('show')) Nav.open('editor', () => closeEditor());
  $('sheet').classList.add('show');
  // straight after a pin is dropped the cursor goes into the title, so typing or dictating can start at once
  if (ED.focusDesc) { ED.focusDesc = false; nextStep(); }
}
function aiStatus(m, err) { const s = $('aiSt'); if (s) { s.textContent = m || ''; s.style.color = err ? '#b00000' : ''; } if (err && m) toast(m, 5000); }
// Full-size plan window showing where a defect is, with a plain X to close.
export async function showLocation(d) {
  const p = S.plans.find(q => q.id === d.plan); if (!p || d.x == null) return toast('No pin on a plan yet');
  modal(`<div class="locwin"><div class="lochead"><b>${esc(d.id || 'New')} · ${esc(d.title || '')}</b><span class="muted small"> ${esc(locText(d))} · ${esc(p.name)}</span><button id="locX" class="x" title="Close">✕</button></div><div class="locbody"><canvas id="locBig"></canvas></div><div class="act"><button id="locZoomOut">Whole plan</button><button id="locZoomIn">Close up</button></div></div>`, true);
  let zoom = 2; const draw = async () => { const c = $('locBig'), x = c.getContext('2d'); const box = c.parentElement.getBoundingClientRect(); c.width = Math.floor(box.width); c.height = Math.floor(Math.max(300, innerHeight * 0.6));
    try { const im = await loadImage(await imgUrl(p.img)); const fit = Math.min(c.width / p.w, c.height / p.h), s = fit * zoom, cx = d.x * p.w * s, cy = d.y * p.h * s; let ox = c.width / 2 - cx, oy = c.height / 2 - cy; if (zoom === 1) { ox = (c.width - p.w * s) / 2; oy = (c.height - p.h * s) / 2; } x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, ox, oy, p.w * s, p.h * s); const px = ox + d.x * p.w * s, py = oy + d.y * p.h * s; x.strokeStyle = SCOL[d.status] || '#d64545'; x.lineWidth = 3; x.beginPath(); x.arc(px, py, 18, 0, 7); x.stroke(); x.fillStyle = SCOL[d.status] || '#d64545'; x.beginPath(); x.arc(px, py, 7, 0, 7); x.fill(); } catch (e) {} };
  $('locX').onclick = closeModal; $('locZoomOut').onclick = () => { zoom = 1; draw(); }; $('locZoomIn').onclick = () => { zoom = 3; draw(); }; await draw();
}
async function drawLoc() {
  const d = ED.d, c = $('locC'), x = c.getContext('2d'); const p = S.plans.find(q => q.id === d.plan);
  $('locT').innerHTML = (d.general && !d.plan ? '<b>General defect</b>' + (locText(d) ? ' · ' : '') : '') + esc(locText(d) || (d.general ? '' : 'No location yet')) + (p ? ' · ' + esc(p.name) : '') + (d.zoneHit ? `<br><span class="zonehit">Found: ${esc(d.zoneHit)}</span>` : '');
  if (!p || d.x == null) { c.style.display = 'none'; return; } c.style.display = '';
  try { const im = await loadImage(await imgUrl(p.img)); const W = c.width, H = c.height, s = 3 * W / p.w, cx = d.x * p.w * s, cy = d.y * p.h * s; x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); x.drawImage(im, W / 2 - cx, H / 2 - cy, p.w * s, p.h * s); x.fillStyle = SCOL[d.status] || '#d64545'; x.beginPath(); x.arc(W / 2, H / 2, 9, 0, 7); x.fill(); x.strokeStyle = '#fff'; x.lineWidth = 2; x.stroke(); }
  catch (e) { c.style.display = 'none'; }
}
// After a step of a new defect is done, take the person to the next one: pin, then photo, then describe.
function nextStep() {
  if (!ED || !ED.isNew) return; const d = ED.d, show = id => { const n = $(id); if (n) setTimeout(() => { try { (n.closest('.stgcard') || n).scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (e) {} }, 80); };
  if (!(d.photos || []).length) { show('stg2'); if (isMobile() && !can.contractor()) setTimeout(() => { if (ED && ED.isNew && !(ED.d.photos || []).length && !document.querySelector('.phsheet')) addPhotoMenu(); }, 350); }
  else show('stg3');
}
function stageGate() {
  if (!ED || !ED.staged) return true; const d = ED.d, pin = !!((d.plan && d.x != null) || d.general), ph = (d.photos || []).length > 0, dict = $('edBody').querySelector('.dict');
  const mark = (id, ok) => { const h = $(id); if (h) h.classList.toggle('done', ok); }; mark('stg1', pin); mark('stg2', ph); mark('stg3', ['title', 'desc'].some(n => { const el = $('edBody').querySelector(`[name=${n}]`); return el && el.value.trim(); }));
  if (dict) dict.classList.toggle('locked', !(pin && ph));
  const lk = $('stgLock'); if (lk) { lk.style.display = pin && ph ? 'none' : ''; lk.textContent = !pin && !ph ? '🔒 Pin it and add a photo first. Gemini then knows where it is and can see it.' : !pin ? '🔒 Pin it on the plan first (or mark it as a general defect).' : '🔒 Add a photo first so Gemini can see it.'; }
  return pin && ph;
}
async function renderPhotos() {
  const w = ED.d, ro = !can.write(); stageGate();
  $('phs').innerHTML = (w.photos || []).map((p, i) => `<div class="ph"><img data-i="${i}" alt="">${!ro && (can.edit() || p.isNew) ? `<button data-x="${i}">✕</button>` : ''}${p.pending ? '<span class="pend">waiting</span>' : ''}</div>`).join('') + (!ro ? '<div class="addph" id="addph">📷🖼<span>Add photo</span></div>' : '');
  $('phs').querySelectorAll('img').forEach(async im => { const p = w.photos[+im.dataset.i]; peekable(im); im.src = await photoSrc(p); im.onclick = () => ro ? window.open(im.src, '_blank') : markup(im.src, data => { const old = w.photos[+im.dataset.i]; w.photos[+im.dataset.i] = { id: Math.random().toString(36).slice(2, 10), data, t: new Date().toISOString(), by: S.user.name, isNew: true, replaces: old.path || undefined }; renderPhotos(); }); });
  $('phs').querySelectorAll('button[data-x]').forEach(b => b.onclick = async () => { if (await confirmBox('Remove this photo?', 'Remove')) { const [p] = w.photos.splice(+b.dataset.x, 1); if (p.path) (ED.removed = ED.removed || []).push(p.path); renderPhotos(); } });
  if ($('addph')) $('addph').onclick = () => addPhotoMenu($('addph'));
  if ($('addfile')) $('addfile').onclick = () => $('fAttach').click();
  $('locC').onclick = () => showLocation(ED.d); $('locC').style.cursor = 'zoom-in'; $('locC').title = 'Open the plan at this location';
  $('fls').querySelectorAll('[data-f]').forEach(a => a.onclick = async ev => { ev.preventDefault(); const f = (ED.d.files || [])[+a.dataset.f]; if (!f) return; const u = f.data || (f.url ? await imgUrl(f.url) : '') || f.link || ''; if (u) window.open(u, '_blank'); else toast('This file is still waiting to upload'); });
  if ($('findDoc')) $('findDoc').onclick = findDocDialog;
  $('fls').querySelectorAll('[data-fx]').forEach(b => b.onclick = () => { const i = +b.dataset.fx; const f = ED.d.files[i]; if (f.path && !f.isNew) (ED.removed = ED.removed || []).push(f.path); ED.d.files.splice(i, 1); openEditor(ED.d, ED.isNew, true); });
  const wf = (status, label, needComment) => async () => { collect(); const c = $('cmt') ? $('cmt').value.trim() : ''; if (needComment && !c) { toast(label + ': add a short comment first so the other side knows what happened'); $('cmt').focus(); return; } const sel = $('edBody').querySelector('[name=status]'); if (sel) { if (![...sel.options].some(o => o.value === status)) { const o = document.createElement('option'); o.textContent = status; sel.appendChild(o); } sel.value = status; } ED.d.status = status; ED.wfLabel = label; await saveEditor(); };
  if ($('wfReady')) $('wfReady').onclick = () => readyDialog(wf('Ready for review', 'Ready for inspection', true));
  if ($('wfAccept')) $('wfAccept').onclick = () => noteDialog({ title: 'Accept and close', ask: 'Closing note', ph: 'e.g. Inspected on site, work accepted', btn: 'Accept and close', go: wf('Closed', 'Accepted and closed', false) });
  if ($('wfSelf')) $('wfSelf').onclick = () => readyDialog(wf('Closed', 'Completed and closed by the contractor', true), true);
  if ($('wfReopen')) $('wfReopen').onclick = () => noteDialog({ title: 'Reopen and send back', ask: 'What still needs doing', ph: 'Say exactly what is still wrong so it is fixed first time', btn: 'Reopen and send back', warn: true, required: true, need: 'Say what still needs doing so the contractor knows.', go: wf('Open', 'Reopened and sent back', true) });
  if ($('wfProg')) $('wfProg').onclick = () => noteDialog({ title: 'Mark in progress', ask: 'Note', ph: 'e.g. Painter booked for Tuesday', btn: 'Mark in progress', go: wf('In progress', 'In progress', false) });
  if ($('wfCmt')) $('wfCmt').onclick = () => noteDialog({ title: can.contractor() ? 'Add a response' : 'Add a comment', ask: can.contractor() ? 'Your response' : 'Comment', ph: 'Saved with your name and the time', btn: 'Save comment', required: true, go: saveEditor });
  if ($('edTyp')) $('edTyp').onclick = ev => { ev.preventDefault(); typicalPicker(); };
  requestAnimationFrame(() => { Nav.refit($('edBody')); if (ED && !ED.isNew) ED.snap = edSnap(); });
}
// Marking an item ready for inspection: prompt for a photo of the fix (optional) and a short note that can be spoken and tidied by Gemini.
// Reference a document that is already in the project's Documents (drawings, specifications, manuals) without uploading it again.
function findDocDialog() {
  const docs = ((S.fm || {}).docs || []).filter(x => x.url || x.link);
  modal(`<h2>Find a project document</h2><p class="note">Search the project's Documents and attach one as a reference. It is linked, not copied.</p><input type="search" id="fdQ" placeholder="Type a few words, e.g. window flashing detail" autocomplete="off"><div id="fdR" class="fdres"></div><div class="act"><button id="fdX">Close</button></div>`, true);
  const draw = () => { const q = $('fdQ').value.trim(), L = docs.filter(x => !q || Search.hit(q, x, [x.title, x.fileName, x.type, x.system, x.party, x.notes].join(' '))).slice(0, 40);
    $('fdR').innerHTML = L.length ? L.map(x => `<button data-d="${esc(x.id)}"><b>${esc(x.title || x.fileName || 'Document')}</b><small>${esc([x.type, x.system].filter(Boolean).join(' · '))}</small></button>`).join('') : '<p class="note">Nothing matches. Try fewer words, or attach the file from your phone instead.</p>';
    $('fdR').querySelectorAll('[data-d]').forEach(b => b.onclick = () => { const x = docs.find(y => y.id === b.dataset.d); if (!x) return; collect(); (ED.d.files = ED.d.files || []).push({ id: uid(), name: 'Ref: ' + (x.title || x.fileName), mime: x.mime || '', url: x.url || '', link: x.link || '', docId: x.id, t: new Date().toISOString(), by: S.user.name, isNew: true }); closeModal(); openEditor(ED.d, ED.isNew, true); toast('Reference attached'); }); };
  $('fdQ').oninput = draw; $('fdX').onclick = closeModal; draw(); setTimeout(() => $('fdQ') && $('fdQ').focus(), 60);
}
function readyDialog(go, close) {
  collect(); const d = ED.d, pre = '', shots = [], docs = [];
  modal(`<h2>${close ? 'Complete and close' : 'Ready for inspection'}</h2>${close ? '<p class="note">This item is on your own register, so you can close it yourself. A photo and a short note are the record that it was done.</p>' : ''}<p class="note"><b>${esc(d.id)}</b> · ${esc(d.title || d.element || '')}</p>${lastNoteHtml(d, 'Last comment')}
    <div class="rdsec">Proof of the fix</div>
    <div class="rd3"><button id="rdCam">📷<span>Take a photo</span></button><button id="rdGal">🖼<span>From gallery</span></button><button id="rdDoc">📎<span>File or PDF</span></button></div><div id="rdPh" class="rdph"></div><div id="rdFl" class="rdfl"></div>
    <input type="file" id="rdFile" accept="image/*" capture="environment" hidden><input type="file" id="rdFile2" accept="image/*" multiple hidden><input type="file" id="rdFile3" multiple hidden>
    <div class="rdsec">What was done</div>
    <div class="rdgem"><button class="mic" id="rdMic" title="Hold to talk to Gemini">🎤</button><div><b>✨ Tell Gemini</b><span class="note" id="rdSt">Hold the microphone and say what was fixed. Let go and Gemini writes it up for you.</span></div></div>
    <label class="f"><span class="rdor">or write it yourself</span><textarea id="rdTxt" rows="3" placeholder="Type what was done. It is saved exactly as you write it.">${esc(pre)}</textarea></label>
    <div class="rdtidy"><button id="rdTidy">✨ Tidy my writing with Gemini (optional)</button></div>
    <div class="act"><button id="rdX">Cancel</button><button class="go" id="rdGo">${close ? 'Close this item' : 'Mark ready for inspection'}</button></div>`);
  const st = (t, bad) => { $('rdSt').textContent = t; $('rdSt').style.color = bad ? '#a32222' : ''; };
  const draw = () => { $('rdPh').innerHTML = shots.map((p, i) => `<div class="ph"><img src="${p.data}" alt=""><button data-x="${i}">✕</button></div>`).join(''); $('rdPh').querySelectorAll('[data-x]').forEach(b => b.onclick = () => { shots.splice(+b.dataset.x, 1); draw(); }); $('rdFl').innerHTML = docs.map((f, i) => `<div class="file">📎 ${esc(f.name)} <button data-fxx="${i}" class="small">✕</button></div>`).join(''); $('rdFl').querySelectorAll('[data-fxx]').forEach(b => b.onclick = () => { docs.splice(+b.dataset.fxx, 1); draw(); }); };
  const add = async e => { const fs = [...e.target.files]; e.target.value = ''; for (const f of fs) { try { shots.push(await newPhoto(f)); } catch (x) { toast('Could not read that photo'); } } draw(); };
  $('rdCam').onclick = () => $('rdFile').click(); $('rdGal').onclick = () => $('rdFile2').click(); $('rdDoc').onclick = () => $('rdFile3').click(); $('rdFile').onchange = add; $('rdFile2').onchange = add;
  $('rdFile3').onchange = async e => { const fs = [...e.target.files]; e.target.value = ''; for (const f of fs) { if (f.type.startsWith('image/')) { try { shots.push(await newPhoto(f)); } catch (x) { toast('Could not read that photo'); } continue; } if (f.size > 19 * 1024 * 1024) { toast(f.name + ' is over 19 MB'); continue; } const data = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); }); docs.push({ id: uid(), name: f.name, mime: f.type || 'application/octet-stream', data, t: new Date().toISOString(), by: S.user.name, isNew: true }); } draw(); };
  const tidy = async () => { const raw = $('rdTxt').value.trim(); if (!raw) return st('Say or write what was done first.', true); if (!navigator.onLine) return st('No signal: your words are kept as they are.'); st('Tidying up…');
    try { const out = await aiCall(`A contractor on a building site is reporting that a defect has been fixed and is ready for inspection. Rewrite their spoken note as one to three short, clear, professional sentences in New Zealand English, past tense, no em dashes. Keep every fact they gave (what was done, where, when, by whom, product names). Do not add anything they did not say and do not claim the work complies.\nDEFECT: ${d.title || ''}. ${d.desc || ''}\nSPOKEN NOTE: ${raw}\nReturn JSON only: {"text":"..."}`); let t = ''; try { t = JSON.parse(out).text || ''; } catch (e) { t = String(out || '').trim(); } if (t && $('rdTxt')) { $('rdTxt').value = t.replace(/\s*—\s*/g, ', '); st('Gemini has written it up below. Check it reads right, then mark ready.'); } else st('Kept as you said it.'); }
    catch (e) { st(e.message === 'nokey' ? 'Gemini is not set up on this device, so your words are kept as they are.' : 'Could not tidy it (' + friendly(e) + '). Your words are kept.', true); } };
  holdToTalk($('rdMic'), () => dictate($('rdTxt'), $('rdMic'), st, () => { if ($('rdTxt') && $('rdTxt').value.trim()) tidy(); }));
  $('rdTidy').onclick = tidy;
  $('rdX').onclick = () => { stopDictation(); closeModal(); };
  $('rdGo').onclick = async () => { stopDictation(); const txt = $('rdTxt').value.trim(); if (!txt && !shots.length && !docs.length) return st('Add a photo, a file or a short note so the inspector knows what was done.', true);
    d.photos = (d.photos || []).concat(shots); d.files = (d.files || []).concat(docs); if ($('cmt')) $('cmt').value = txt || [shots.length ? `Photo${shots.length === 1 ? '' : 's'}` : '', docs.length ? `file${docs.length === 1 ? '' : 's'}` : ''].filter(Boolean).join(' and ').replace(/^f/, 'F') + ' of the completed work attached.'; closeModal(); await go(); };
}
function collect() { const b = $('edBody'); FIELDS.forEach(f => { const el = b.querySelector(`[name=${f}]`); if (el) ED.d[f] = el.value; }); if ($('dt')) ED.d.transcript = $('dt').value; return ED.d; }
function closeEditor(keep) { stopDictation(); $('sheet').classList.remove('show'); if (!keep) ED = null; Nav.closed('editor'); }
// Next reference number from what this device knows (used when the server cannot be reached in time).
function localNextRef() { const pre = (S.project.idPrefix || 'D') + '-'; let m = S.project.seq || 0; S.defects.forEach(d => { if (d.id.startsWith(pre)) { const n = parseInt(d.id.slice(pre.length), 10); if (n > m) m = n; } }); return m + 1; }
// The project's subcontractor list (from the contractor's register, plus any added since) and any names already used on items.
export const subList = () => [...new Set([...(S.project.subcontractors || []), ...S.defects.map(x => x.subcontractor).filter(Boolean)])].sort((a, b) => a.localeCompare(b));
export async function addSubs(names) { const cur = S.project.subcontractors || [], low = new Set(cur.map(x => x.toLowerCase())), add = [...new Set(names.flatMap(n => String(n || '').split('/')).map(n => n.trim()).filter(n => n && !/^contractor$/i.test(n)))].filter(n => !low.has(n.toLowerCase())); if (!add.length) return 0; const list = [...cur, ...add].sort((a, b) => a.localeCompare(b)); await S.store.updateProject(S.project.id, { subcontractors: list }); S.project.subcontractors = list; return add.length; }
async function saveEditor() {
  const d = collect(); const who = ($('cmtFor') && $('cmtFor').value) ? S.user.name + ' on behalf of ' + $('cmtFor').value : S.user.name, t = new Date().toISOString(), pid = S.project.id, newH = [];
  if (!d.title && !d.desc) { toast('Add a title or description first'); return; }
  if (ED.isNew && !can.contractor() && S.plans.length && !d.plan && !d.general) { const n = $('locNeed'); if (n) n.style.display = ''; const bx = $('locBox'); if (bx) { bx.classList.add('need'); bx.scrollIntoView({ block: 'center', behavior: 'smooth' }); } toast('Pin it on the plan first, or mark it as a general defect', 5000); return; }
  if (!d.title) d.title = d.desc.split(/[.,;]/)[0].slice(0, 70);
  if (d.subcontractor) { d.subcontractor = d.subcontractor.trim(); addSubs([d.subcontractor]).catch(e => console.warn('subcontractor list', e)); }
  const b = busy(navigator.onLine ? 'Saving…' : 'Saving on this phone…');
  try {
    if (ED.isNew) { d.id = await S.store.nextRef(pid, S.project.idPrefix, localNextRef); for (let k = 0; k < 50 && S.defects.some(x => x.id === d.id); k++) d.id = await S.store.nextRef(pid, S.project.idPrefix, localNextRef); }
    d.photos = await uploadPhotos(pid, d.id, d.photos || []);
    d.files = await uploadFiles(pid, d.id, d.files || []);
    (ED.removed || []).forEach(p => S.store.deleteFile(p));
    const cm = $('cmt') ? $('cmt').value.trim() : '';
    const clean = o => { const c = { ...o }; delete c.isNew; delete c.zoneHit; c.photos = (c.photos || []).map(p => { const q = { ...p }; delete q.data; delete q.isNew; return q; }); c.files = (c.files || []).map(p => { const q = { ...p }; delete q.data; delete q.isNew; return q; }); return c; };
    if (ED.isNew) {
      newH.push({ t, who, txt: 'Raised (' + d.source + '). Status ' + d.status + '.' }); if (cm) newH.push({ t, who, txt: cm });
      if (d.aiPending) newH.push({ t, who, txt: 'Site note recorded out of coverage; waiting for Gemini.' });
      const rec = clean({ ...d, created: t, createdBy: S.user.email, updated: t, updatedBy: S.user.email, history: newH });
      await S.store.createDefect(pid, rec);
    } else {
      const o = ED.orig || {}, patch = {}, ch = [];
      const keys = can.contractor() ? ['status', 'subcontractor'] : [...FIELDS, 'plan', 'x', 'y', 'plan2', 'x2', 'y2', 'transcript', 'aiPending', 'autoLoc', 'general'];
      if (ED.wfLabel) { ch.push(ED.wfLabel.toLowerCase()); }
      if (o.aiReview && !can.contractor()) { patch.aiReview = false; ch.push('checked'); }
      keys.forEach(k => { if ((o[k] ?? '') !== (d[k] ?? '')) patch[k] = d[k] ?? null; });
      ['status', 'severity', 'responsible', 'subcontractor', 'targetDate', 'unit', 'room', 'title'].forEach(k => { if (k in patch) ch.push(k === 'targetDate' ? 'target date ' + (nzDate(d[k]) || 'cleared') : k + ' ' + (o[k] || '-') + ' → ' + (d[k] || '-')); });
      if ('plan' in patch || 'x' in patch) ch.push('pin ' + (d.plan ? 'moved' : 'removed'));
      const ph = clean(d).photos; if (JSON.stringify(ph) !== JSON.stringify(o.photos || [])) { patch.photos = ph; ch.push('photos ' + (o.photos || []).length + ' → ' + ph.length); }
      const fl = clean(d).files; if (JSON.stringify(fl) !== JSON.stringify(o.files || [])) { patch.files = fl; ch.push('attachments ' + (o.files || []).length + ' → ' + fl.length); }
      if (ED.wfLabel) { newH.push({ t, who, txt: ED.wfLabel + (cm ? ': ' + cm : '.') }); const rest = ch.filter(x => x !== ED.wfLabel.toLowerCase() && !/^status /.test(x)); if (rest.length) newH.push({ t, who, txt: 'Changed ' + rest.join('; ') + '.' }); }
      else { if (ch.length) newH.push({ t, who, txt: 'Changed ' + ch.join('; ') + '.' }); if (cm) newH.push({ t, who, txt: cm }); }
      if ('status' in patch && newH.length && o.status) newH[0].st = [o.status, d.status];
      if (!Object.keys(patch).length && !newH.length) { b.done(); closeEditor(); return; }
      patch.updated = t; patch.updatedBy = S.user.email;
      await S.store.updateDefect(pid, d.id, patch, newH);
    }
    S.sel = d.id; b.done(); closeEditor(); toast(d.id + (navigator.onLine ? ' saved' : ' saved on this phone, will sync when back in coverage')); netbar();
  } catch (e) { b.done(); console.error(e); toast('Could not save: ' + friendly(e), 6000); }
}
async function deleteDefect() {
  if (!ED || ED.isNew) return; if (!(await confirmBox(`Delete ${ED.d.id}? This cannot be undone.`, 'Delete'))) return;
  try { const id = ED.d.id; await S.store.deleteDefect(S.project.id, id); (ED.d.photos || []).forEach(p => p.path && S.store.deleteFile(p.path)); closeEditor();
    // if it was the latest number, hand the number back so the next defect takes it (builders see no gap)
    const pre = (S.project.idPrefix || 'D') + '-', n = id.startsWith(pre) ? parseInt(id.slice(pre.length), 10) : NaN; let msg = 'Deleted';
    if (!isNaN(n)) { let hi = 0; S.defects.forEach(d => { if (d.id !== id && d.id.startsWith(pre)) { const k = parseInt(d.id.slice(pre.length), 10); if (!isNaN(k) && k > hi) hi = k; } }); if (n > hi) { if (S.store.releaseRef) await S.store.releaseRef(S.project.id, n, hi); S.project.seq = Math.min(S.project.seq || 0, hi); msg = `Deleted. The next defect will be ${pre}${String(hi + 1).padStart(3, '0')}.`; } }
    toast(msg, 4000); } catch (e) { toast('Could not delete: ' + friendly(e)); }
}
const edSnap = () => JSON.stringify([FIELDS.map(f => { const el = $('edBody').querySelector(`[name=${f}]`); return el ? el.value : ''; }), (ED.d.photos || []).map(p => p.id || p.path), ED.d.plan, ED.d.x, ED.d.y]);
async function step(dir) {
  if (!ED || ED.isNew) return; const L = filtered(); const i = L.findIndex(x => x.id === ED.d.id); const n = L[i + dir];
  if (!n) { toast(dir > 0 ? 'That is the last item in this list' : 'That is the first item in this list'); return; }
  if (ED.snap && ED.snap !== edSnap() && !(await confirmBox('Leave this item without saving your changes?', 'Leave'))) return;
  const b = $('edBody'); b.classList.add(dir > 0 ? 'outl' : 'outr'); setTimeout(() => { b.classList.remove('outl', 'outr'); S.sel = n.id; openEditor(n); renderPins(); b.classList.add(dir > 0 ? 'inr' : 'inl'); setTimeout(() => b.classList.remove('inr', 'inl'), 220); }, 110);
}
// Swipe left or right on a record to move through the items in the current list.
function swipeWire(el) {
  let sx = 0, sy = 0, ok = false;
  el.addEventListener('touchstart', e => { const t = e.target; ok = e.touches.length === 1 && !t.closest('canvas, .mic, select') && t !== document.activeElement && !(document.querySelector('.peek')); sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  el.addEventListener('touchend', e => { if (!ok || !ED || ED.isNew || document.querySelector('.peek')) return; const t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy; if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 2.2) step(dx < 0 ? 1 : -1); }, { passive: true });
}

/* ---- Gemini ---- */
const AIMAP = { title: 'title', description: 'desc', action: 'action', unit: 'unit', room: 'room', surface: 'surface', item: 'item', block: 'block', level: 'level', element: 'element', type: 'type', severity: 'severity', trade: 'trade', responsible: 'responsible', status: 'status', targetDate: 'targetDate' };
// Ask Gemini to turn a spoken note into defect records. If a description comes back as the speaker's own words, ask once more for a proper rewrite.
async function aiDefects(text, cur, photo) {
  const ask = async strict => { const raw = await aiCall(aiPrompt(text, cur, strict), photo); let o; try { o = JSON.parse(String(raw).replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch (e) { throw new Error('Gemini sent back something I could not read. Try again.'); } return { o, list: Array.isArray(o) ? o : (o.defects || [o]) }; };
  let r = await ask(false);
  if (r.list.some(x => tooVerbatim(text, x.description))) { try { const r2 = await ask(true); if (r2.list.length) r = r2; } catch (e) { console.warn('rewrite', e); } }
  return r;
}
async function interpret() {
  if (!stageGate()) { toast('Pin it and add a photo first, then Gemini can fill in the form', 4500); return; }
  const text = $('dt').value.trim(); if (!text) { toast('Say or type the defect first'); return; }
  const cur = collect(); const btn = $('aiGo'); btn.disabled = true; aiStatus('Asking Gemini…'); $('aiNote').classList.remove('show');
  try {
    const ph = $('aiPh').checked && cur.photos[0] ? await photoSrc(cur.photos[0]) : null;
    const { o, list } = await aiDefects(text, cur, ph && ph.startsWith('data:') ? ph : null);
    if (!list.length) throw new Error('Gemini did not find a defect in that note.');
    applyAI(list[0]); if (ED.d.aiPending) { ED.d.aiPending = false; const n = $('aiWait'); if (n) n.remove(); }
    const extra = list.slice(1), qs = (o.questions || []).filter(Boolean); let h = '';
    if (qs.length) h += '<b>Check:</b> ' + qs.map(esc).join(' · ');
    if (extra.length) h += (h ? '<br>' : '') + `<b>${extra.length} more defect${extra.length > 1 ? 's' : ''} heard:</b> ` + extra.map(x => esc(x.title)).join(' · ') + `<br><button id="aiMore">Add ${extra.length > 1 ? 'them' : 'it'} as separate defect${extra.length > 1 ? 's' : ''}</button>`;
    if (h) { $('aiNote').innerHTML = h; $('aiNote').classList.add('show'); if ($('aiMore')) $('aiMore').onclick = () => addExtra(extra); }
    $('dt').value = ''; $('dt').dispatchEvent(new Event('input')); aiStatus('Filled in. Check and save.' + (aiCall.note ? ' ' + aiCall.note : ''));
  } catch (e) {
    if (e.message === 'nokey') { aiStatus(''); Admin.aiSettings('Set up Gemini to use the interpreter.'); }
    else if (!navigator.onLine || e.message === 'offline') queueNote(text);
    else { aiStatus(e.message + ' Your words are still in the box: tap "Interpret with Gemini" to try again.', true); $('aiNote').innerHTML = 'Gemini did not answer, so nothing has been filled in. <button id="aiLater">Keep it as a spoken note for Gemini to write up later</button>'; $('aiNote').classList.add('show'); $('aiLater').onclick = () => { $('aiNote').classList.remove('show'); queueNote(text); }; }
  }
  finally { btn.disabled = false; }
}
// No coverage: keep the note on the record; Gemini fills the form in when the phone is back in service.
function queueNote(text) {
  const d = ED.d; d.aiPending = true; d.transcript = text;
  if (!d.title) { const el = $('edBody').querySelector('[name=title]'); el.value = d.title = 'Site note: ' + text.replace(/\s+/g, ' ').slice(0, 60); }
  const m = /\bunit\s*(?:number\s*)?(\d{1,3})\b/i.exec(text); const b = $('edBody');
  if (m && !d.unit && unitList(S.project).includes(m[1])) { const el = b.querySelector('[name=unit]'); if (el) { el.value = m[1]; el.dispatchEvent(new Event('change')); } d.unit = m[1]; collect(); if (!d.plan) { const z = findZone(d.unit, ''); if (z) { applyZone(d, z.x, z.y, z.plan.id); d.zoneHit = 'Pinned at the centre of Unit ' + d.unit + ' (move it if needed)'; drawLoc(); } } }
  aiStatus('No coverage. Your words are kept with the item as a spoken note; Gemini will write the description when you are back in service, then it will show under "To check".');
}
let aiBusy = false;
export async function processPendingAI() {
  if (aiBusy || !navigator.onLine || !S.project || !can.edit()) return;
  const todo = S.defects.filter(d => d.aiPending && d.transcript); if (!todo.length) return;
  aiBusy = true; const pid = S.project.id;
  try {
    for (const d of todo) {
      if (!S.project || S.project.id !== pid) break;
      let o; try { o = (await aiDefects(d.transcript, d)).o; } catch (e) { if (!navigator.onLine || /offline|Could not reach|Failed to fetch|network|helper/i.test(e.message)) break; console.warn('pending AI', d.id, e); continue; }
      const list = Array.isArray(o) ? o : (o.defects || [o]); if (!list.length) continue;
      const t = new Date().toISOString(), x = list[0], patch = { aiPending: false, aiReview: true, updated: t, updatedBy: S.user.email };
      Object.entries(AIMAP).forEach(([k, f]) => { if (x[k] != null && x[k] !== '') patch[f] = String(x[k]).replace(/—/g, ', '); });
      if (/^Site note: /.test(d.title) && !patch.title) patch.title = d.title.replace(/^Site note: /, '');
      const nd = { ...d, ...patch };
      if (nd.unit) { const u = unitInfo(nd.unit); if (u) { if (!x.block && u.block) patch.block = u.block; if (!x.level && u.level) patch.level = u.level; } }
      if (!d.plan) { const z = findZone(nd.unit, nd.room); if (z) { const tmp = {}; applyZone(tmp, z.x, z.y, z.plan.id); patch.plan = tmp.plan; patch.x = tmp.x; patch.y = tmp.y; patch.block = tmp.block || patch.block || d.block; patch.level = tmp.level || patch.level || d.level; patch.unit = tmp.unit || patch.unit || d.unit; patch.room = tmp.room || patch.room || d.room; } }
      const qs = (o.questions || []).filter(Boolean);
      await S.store.updateDefect(pid, d.id, patch, [{ t, who: 'Gemini', txt: 'Filled in from the site note recorded out of coverage. Please check.' + (qs.length ? ' Check: ' + qs.join(' · ') : '') }]);
      if (list.length > 1) await createFromAI(list.slice(1), nd, 'Raised from the same site note as ' + d.id + ' (recorded out of coverage). Please check.', true);
    }
  } finally { aiBusy = false; }
}
function applyAI(x) {
  const b = $('edBody');
  Object.entries(AIMAP).forEach(([k, f]) => { let v = x[k]; if (v == null || v === '') return; v = String(v).replace(/—/g, ', '); const el = b.querySelector(`[name=${f}]`); if (!el) return;
    if (el.tagName === 'SELECT' && ![...el.options].some(o => o.value === v)) { const o = document.createElement('option'); o.textContent = v; el.appendChild(o); }
    el.value = v; el.classList.remove('aifill'); void el.offsetWidth; el.classList.add('aifill'); });
  Nav.refit($('edBody'));
  collect(); const d = ED.d;
  if (d.unit) { const u = unitInfo(d.unit); if (u) { if (!x.block && u.block) d.block = b.querySelector('[name=block]').value = u.block; if (!x.level && u.level) d.level = b.querySelector('[name=level]').value = u.level; } }
  if (!d.plan) { const z = (d.item && findZone(d.unit, d.room, d.item, { strict: true })) || (d.room && findZone(d.unit, d.room, '', { strict: true })); if (z) { applyZone(d, z.x, z.y, z.plan.id); d.zoneHit = 'Pinned in ' + d.zoneHit + ' (move it if needed)'; } else { const keep = { unit: d.unit, room: d.room, item: d.item }; const note = Placer.place(d, { pinPatch, elevSpot }, { rules: S.project.placeRules }); if (note) { d.unit = keep.unit || d.unit; if (keep.room) d.room = keep.room; if (keep.item) d.item = keep.item; d.zoneHit = (d.zoneHit || note) + ' (move it if needed)'; } } }
  drawLoc();
}
async function addExtra(extra) { const made = await createFromAI(extra, collect(), 'Raised from the same dictation as the item being edited.'); $('aiNote').innerHTML = 'Added ' + made.join(', ') + '.'; }
async function createFromAI(extra, base, why, review) {
  const t = new Date().toISOString(), made = [];
  for (const x of extra) {
    const d = await newDefect(); Object.entries(AIMAP).forEach(([k, f]) => { if (x[k]) d[f] = String(x[k]).replace(/—/g, ', '); });
    ['unit', 'room', 'block', 'level'].forEach(k => { if (!x[k]) d[k] = base[k]; }); d.source = base.source; d.dateRaised = base.dateRaised;
    const z = findZone(d.unit, d.room); if (z) applyZone(d, z.x, z.y, z.plan.id); else if (base.plan) { d.plan = base.plan; d.x = base.x; d.y = base.y; }
    d.id = await S.store.nextRef(S.project.id, S.project.idPrefix, localNextRef); for (let k = 0; k < 50 && S.defects.some(x => x.id === d.id); k++) d.id = await S.store.nextRef(S.project.id, S.project.idPrefix, localNextRef); d.transcript = base.transcript; delete d.isNew; delete d.zoneHit;
    d.created = d.updated = t; d.createdBy = d.updatedBy = S.user.email; if (review) d.aiReview = true; d.history = [{ t, who: S.user.name, txt: 'Raised (' + d.source + '). ' + why }];
    await S.store.createDefect(S.project.id, d); made.push(d.id);
  }
  return made;
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
  const o = () => ({ title: $('xTitle').value, sub: $('xSub').value, photos: $('xPh').checked, plans: $('xPl').checked, sig: $('xSig').checked, intro: p.pdfIntro || 'Each item has a reference (ID). Click a blue ID to go to its detail page with photos, and click a pin on a plan to go to that item. Items with ' + ((p.sevMajor || []).length ? 'a ' + sevLabel(p).toLowerCase() + ' of "' + p.sevMajor.join('" or "') + '"' : 'a "Major" severity') + ' must be closed before practical completion can be certified; all other open items are to be completed within the agreed timeframes and in any case within the Defects Notification Period.' });
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
    <button id="mFind">🔍 Search everything<small>Tools, defects, units, products. Spelling does not need to be exact</small></button>
    ${a ? `<button id="mCk">🚀 Set-up checklist (${Setup.progress().join(' of ')})<small>What this project still needs, with a button to each step</small></button>` : ''}
    ${a ? '<button id="mSet">⚙ Project settings<small>Details, logos, lists, units</small></button><button id="mUsers">👥 Users and access<small>Invite people, set roles</small></button><button id="mPlans">▦ Plans<small>Upload and order floor plans</small></button><button id="mZones">⬠ Room boundaries<small>Draw rooms so pins find their room</small></button>' : ''}
    ${can.edit() && unpinned().length ? `<button id="mPinQ">📍 Items to pin (${unpinned().length})<small>Go through open items that have no pin, one at a time</small></button>` : ''}
    ${can.write() ? '<button id="mTick">📄 Scan a site tick sheet<small>Photograph a printed sheet: ticks and handwriting are read by Gemini</small></button>' : ''}
    ${can.write() && Sync.available() ? '<button id="mSync">🔄 Update the contractor\'s spreadsheet<small>Two-way: completed rows close items here, closed items are ticked off in the Excel register</small></button>' : ''}
    ${can.edit() ? '<button id="mImp">⬆ Import register<small>Excel, CSV or a v1 backup file</small></button>' : ''}
    ${can.edit() ? '<button id="mAI">✨ Gemini<small>Interpreter settings</small></button>' : ''}
    ${canInstall() ? `<button id="mInst">📲 Install ${/Android|iPhone|iPad/.test(navigator.userAgent) ? 'on this phone' : 'as a desktop app'}<small>${/Android|iPhone|iPad/.test(navigator.userAgent) ? 'Home screen app, stays signed in' : 'Opens in its own window from the Start menu or Dock'}</small></button>` : ''}
    ${can.realAdmin() ? `<button id="mViewAs">👁 View as…<small>${S.viewAs ? 'Currently viewing as ' + esc(ROLES[S.viewAs] || S.viewAs) + ' (tap to change or stop)' : 'Test the app as an editor, contractor or viewer'}</small></button>` : ''}
    ${a ? '<button id="mTpl">📦 Save set-up as a template<small>Start the next project with the same categories, lists and rules</small></button>' : ''}
    <button id="mReload">🔄 Reload app<small>Get the latest version (v${APP.version} now)</small></button>
    <button id="mTry">🧪 15-minute try-out<small>Practise on a throwaway copy, then tell us what you think</small></button>
    <button id="mFb">💬 Send feedback<small>What works, what is confusing, what is missing</small></button>
    ${a ? '<button id="mFbR">📊 Feedback received<small>What the team has said, and the try-out link to send people</small></button>' : ''}
    <button id="mCheck">✅ Site check<small>Test everything before you go on site</small></button>
    <button id="mHelp">❓ Help<small>Quick guide, ask a question</small></button>
    <button id="mProj">🗂 All projects<small>Switch project</small></button>
    <button id="mOut">⎋ Sign out<small>${esc(S.user.email)}</small></button>
  </div><p class="note" style="margin-top:12px">${esc(APP.name)} v${APP.version}${isDemo() ? ' · DEMO MODE (data stays in this browser)' : ''}</p><div class="act"><button id="mX">Close</button></div>`);
  const on = (id, fn) => { if ($(id)) $(id).onclick = () => { closeModal(); fn(); }; };
  on('mTry', Try.start); on('mFb', () => Try.feedback(false)); on('mFbR', Try.results);
  on('mFind', () => Search.open()); on('mCk', () => Setup.checklist()); on('mTpl', Setup.saveTemplate);
  on('mPinQ', pinQueue); on('mTick', Tick.start); on('mSync', Sync.start); on('mSet', () => Admin.projectSettings(S.project)); on('mUsers', Admin.usersDialog); on('mPlans', Admin.plansDialog); on('mZones', () => Admin.zoneEditor(PV));
  on('mImp', Admin.importDialog); on('mCheck', siteCheck); on('mInst', () => installDialog(false)); on('mReload', reloadApp);
  on('mViewAs', () => { modal(`<h2>Test mode</h2><p>Try the app as another role on a <b>throwaway copy</b> of this project. Press every button you like: nothing is saved to the cloud, and leaving test mode throws the copy away.</p><div class="btnlist">${['admin', 'editor', 'contractor', 'viewer'].map(r => `<button data-va="${r}" class="${S.viewAs === r ? 'go' : ''}">${esc(ROLES[r] || r)}</button>`).join('')}${S.testMode ? '<button data-va="">Leave test mode</button>' : ''}</div><div class="act"><button id="vaX">Close</button></div>`); $('vaX').onclick = closeModal; $('mbox').querySelectorAll('[data-va]').forEach(b => b.onclick = () => { closeModal(); b.dataset.va ? enterTestMode(b.dataset.va) : leaveTestMode(); }); }); on('mHelp', helpDialog); on('mAI', () => Admin.aiSettings()); on('mProj', showProjects); on('mOut', () => S.store.signOut()); $('mX').onclick = closeModal;
}

// Every tool in the app, for Search: what it is called, the words people might type for it, where it lives, and how to open it.
function toolList() {
  if (!S.project) return [];
  const a = can.admin(), e = can.edit(), w = can.write(), M = '☰ Menu', T = [];
  const t = (ok, icon, title, kw, where, run, sub) => { if (ok) T.push({ icon, title, kw, where, run, sub }); };
  t(e, '＋', 'New defect', 'add raise create log record snag item pin photo dictate', ['＋ round button, bottom right'], newDefectChooser, 'Pin it, photograph it, describe it');
  t(true, '⬇', 'Export: PDF schedule, Excel, photos', 'pdf excel xlsx csv zip print schedule report download send share list', ['Export button, top right'], openExport);
  t(a, '🚀', 'Set-up checklist', 'setup set up getting started new project steps wizard onboarding', [M, '🚀 Set-up checklist'], () => Setup.checklist());
  t(a, '⚙', 'Project settings', 'details name address client logo units lists trades rooms sources categories severity prefix pdf title consent', [M, '⚙ Project settings'], () => Admin.projectSettings(S.project));
  t(a, '👥', 'Users and access', 'invite add remove person people team member role permission admin editor contractor viewer share email password login', [M, '👥 Users and access'], Admin.usersDialog);
  t(a, '▦', 'Upload and order plans', 'drawings floor plan sheets pdf elevation wall ceiling upload add layers', [M, '▦ Plans'], Admin.plansDialog);
  t(a, '⬠', 'Room boundaries', 'zones rooms units outline draw boundary markers areas', [M, '⬠ Room boundaries'], () => Admin.zoneEditor(PV));
  t(a, '📦', 'Save set-up as a template', 'template copy next project reuse clone', [M, '📦 Save set-up as a template'], Setup.saveTemplate);
  t(e && unpinned().length, '📍', 'Items to pin (' + unpinned().length + ')', 'unpinned no pin missing location queue place', [M, '📍 Items to pin'], pinQueue);
  t(w, '📄', 'Scan a site tick sheet', 'paper printed handwriting tick ticked photograph sheet checklist scan', [M, '📄 Scan a site tick sheet'], Tick.start);
  t(w && Sync.available(), '🔄', "Update the contractor's spreadsheet", 'sync google sheet excel register two way link miles master list', [M, "🔄 Update the contractor's spreadsheet"], Sync.start);
  t(a && Sync.available(), '✉', 'Daily summary email', 'email summary daily notification recipients days weekend on off send test report', [M, "🔄 Update the contractor's spreadsheet", 'Daily summary email'], Sync.start);
  t(e, '⬆', 'Import a register', 'import excel csv json backup drop file maynard marks observation load', [M, '⬆ Import register'], Admin.importDialog);
  t(e, '✨', 'Gemini settings', 'ai key helper voice dictation interpreter model google', [M, '✨ Gemini'], () => Admin.aiSettings());
  t(canInstall(), '📲', 'Install the app', 'install phone home screen desktop app download', [M, '📲 Install'], () => installDialog(false));
  t(true, '🔄', 'Reload app', 'update latest version refresh not updating old', [M, '🔄 Reload app'], reloadApp, 'Now on v' + APP.version);
  t(true, '✅', 'Site check', 'test camera microphone storage offline coverage before site', [M, '✅ Site check'], siteCheck);
  t(true, '❓', 'Help and quick guide', 'how do i guide question instructions manual', ['? button, top right'], helpDialog);
  t(true, '▾', 'Filters', 'filter narrow unit block level trade category subcontractor responsible', ['⚑ Defects', '☰ List', '▾ Filters button'], () => { setTab('list'); S.fOpen = true; filterChips(); });
  t(w, '☑', 'Select several items', 'bulk multiple many close assign change status all at once tick', ['⚑ Defects', '☰ List', '☑ Select'], () => { setTab('list'); if (!S.bulk) bulkToggle(); });
  t(true, '▦', 'Plans view', 'plan drawing map pins floor', ['▦ Plans tab'], () => setTab('plan'));
  t(true, '◫', 'Dashboard', 'overview summary numbers progress chart key dates handover pack contacts', ['◫ Dashboard'], () => FM.setModule('dash'));
  t(true, '▤', 'Assets and warranties', 'asset warranty warranties product guarantee register installer', ['▤ Assets & warranties'], () => FM.setModule('assets'));
  t(true, '⟳', 'Maintenance', 'maintenance planned task schedule service due', ['⟳ Maintenance'], () => FM.setModule('maint'));
  t(true, '✓', 'Compliance', 'compliance bwof code compliance certificate ccc consent', ['✓ Compliance'], () => FM.setModule('comp'));
  t(true, '🗀', 'Documents', 'documents files o&m manual producer statement ps3 ps4 certificate handover', ['🗀 Documents'], () => FM.setModule('docs'));
  t(true, '🧪', '15-minute try-out', 'practice practise test mode training learn demo sandbox try', [M, '🧪 15-minute try-out'], Try.start);
  t(true, '💬', 'Send feedback', 'feedback suggestion complaint idea problem bug report comment', [M, '💬 Send feedback'], () => Try.feedback(false));
  t(a, '📊', 'Feedback received', 'feedback results responses survey testers', [M, '📊 Feedback received'], Try.results);
  t(true, '🗂', 'All projects', 'switch change project other job list', ['‹ back arrow, top left'], showProjects);
  t(true, '⎋', 'Sign out', 'log out logout sign off account', [M, '⎋ Sign out'], () => S.store.signOut());
  return T;
}
function filterBy(o) { FM.setModule('defects'); Object.assign(S.F, { q: '', block: '', level: '', unit: '', sev: '', trade: '', resp: '', sub: '', review: false, toReview: false }, o); $('q').value = S.F.q || ''; filtersDirty = true; setTab('list'); render(); }

/* ================================================================ wiring */
function wire() {
  PV = new PlanView($('vp'), { onPlace, onPinTap: id => { const d = S.defects.find(x => x.id === id); if (d) { S.sel = id; render(); openEditor(d); } }, canDragPins: () => can.write() && !can.contractor() && !ED, pinDragLabel: (id, x, y) => { const fp = S.plans.find(q => q.id === S.curPlan); if (!fp) return ''; const hit = locate(fp.zones, x, y) || {}; return [id, hit.unit ? 'Unit ' + hit.unit : '', hit.room || '', !hit.unit && !hit.room ? [fp.block ? 'Block ' + fp.block : '', fp.level || ''].filter(Boolean).join(' ') || fp.name || '' : ''].filter(Boolean).join(' · '); }, onPinMoved: movePin });
  Admin.init({ PV, render, reloadProject, showProjects, openProject, showPlan, setTab, filtered, planViews, VIEW_TYPES, pickPoint, stopPlacing, remapElevationPins, pinPatch, pinQueue, unpinned, elevSpot, Sync });
  FM.init({ render, getBytes }); const placeIt = (d, opt) => Placer.place(d, { pinPatch, elevSpot }, { rules: S.project.placeRules, ...(opt || {}) }); Tick.init({ render, reloadProject, pinPatch, placeIt }); Sync.init({ render, reloadProject, pinPatch, addSubs, placeIt });
  [['q', 'q', 'input'], ['fBlock', 'block', 'change'], ['fLevel', 'level', 'change'], ['fUnit', 'unit', 'change'], ['fSev', 'sev', 'change'], ['fTrade', 'trade', 'change'], ['fResp', 'resp', 'change'], ['fSub', 'sub', 'change'], ['sort', 'sort', 'change']].forEach(([id, k, ev]) => $(id).addEventListener(ev, e => { S.F[k] = e.target.value; render(); }));
  $('bSel').onclick = bulkToggle; $('bulkX').onclick = bulkToggle; $('bulkbar').querySelectorAll('[data-b]').forEach(x => x.onclick = () => bulkAction(x.dataset.b));
  $('clr').onclick = () => { Object.assign(S.F, { q: '', block: '', level: '', unit: '', sev: '', trade: '', resp: '', sub: '', review: false, toReview: false }); S.F.status = new Set(['Open', 'In progress', 'Ready for review', 'Disputed']); $('q').value = ''; filtersDirty = true; render(); };
  $('wBack').onclick = showProjects; $('pOut').onclick = () => S.store.signOut();
  Search.init({ tools: toolList, units: () => unitList(S.project), openDefect: d => { FM.setModule('defects'); S.sel = d.id; render(); openEditor(d); }, filterBy, showPlan: id => { FM.setModule('defects'); setTab('plan'); showPlan(id); }, fmGo: (m, q) => FM.goTo(m, q), help: q => { helpDialog(); if (q && $('hq')) $('hq').value = q; }, statusColour: s => SCOL[s] || '#999' });
  Try.init({ enterTestMode, leaveTestMode, saveLocal, bar: viewAsBar });
  Setup.init({ openProject, zones: () => Admin.zoneEditor(PV), sync: Sync.start, siteCheck, saveLocal });
  $('bFind').onclick = () => Search.open();
  document.addEventListener('keydown', e => { if (!S.project || !$('scrWork').classList.contains('on')) return; const typing = /INPUT|TEXTAREA|SELECT/.test((e.target.tagName || '')) || e.target.isContentEditable; if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !typing)) { e.preventDefault(); Search.open(); } });
  $('fTog').onclick = () => { S.fOpen = !$('fMore').classList.contains('open'); filterChips(); };
  $('bNew').onclick = async () => openEditor(await newDefect(), true, true);
  $('fab').onclick = newDefectChooser;
  $('fAttach').onchange = async e => { const fs = [...e.target.files]; e.target.value = ''; await addFiles(fs); };
  async function addFilesImpl(fs) { if (!ED) return; for (const f of fs) { if (f.size > 19 * 1024 * 1024) { toast(f.name + ' is over 19 MB'); continue; } const data = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); }); (ED.d.files = ED.d.files || []).push({ id: uid(), name: f.name, mime: f.type || 'application/octet-stream', data, t: new Date().toISOString(), by: S.user.name, isNew: true }); } collect(); openEditor(ED.d, ED.isNew, true); toast(fs.length + ' file' + (fs.length > 1 ? 's' : '') + ' attached; Save to keep'); }
  addFilesRef = addFilesImpl;
  $('fCam').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (f) await addPhotos([f]); };
  $('bExport').onclick = openExport; $('bMenu').onclick = openMenu; $('bHelp').onclick = helpDialog;
  $('listToggle').onclick = () => { const h = $('main').classList.toggle('nolist'); S.local.noList = h; saveLocal(); $('listToggle').title = h ? 'Show the defects list' : 'Hide the defects list'; requestAnimationFrame(() => PV.fit()); };
  if (S.local.noList) $('main').classList.add('nolist');
  $('zfull').onclick = () => { const on = !$('planPane').classList.contains('full'); if (on) Nav.open('fullplan', () => { $('planPane').classList.remove('full'); document.body.classList.remove('fullplan'); $('zfull').textContent = '⛶'; requestAnimationFrame(() => PV.fit()); }); else Nav.closed('fullplan'); $('planPane').classList.toggle('full', on); document.body.classList.toggle('fullplan', on); $('zfull').textContent = on ? '✕' : '⛶'; $('zfull').title = on ? 'Exit full screen' : 'Full screen'; requestAnimationFrame(() => PV.fit()); };
  Nav.init(() => { modal(`<h2>Leave ${esc(APP.name)}?</h2><p>You are on the main screen. Going back again will leave the app.</p><div class="act"><button class="go" id="lvStay">Stay</button><button id="lvGo">Leave</button></div>`); $('lvStay').onclick = closeModal; $('lvGo').onclick = () => { $('modal').classList.remove('show'); Nav.leave(); }; });
  $('edClose').onclick = $('edCancel').onclick = () => closeEditor(); $('edSave').onclick = saveEditor; $('edDel').onclick = deleteDefect; $('edBody').addEventListener('input', e => { const t = e.target; if (t && t.tagName === 'TEXTAREA') { t.style.height = 'auto'; t.style.height = Math.min(600, t.scrollHeight + 2) + 'px'; } });
  $('edPrev').onclick = () => step(-1); $('edNext').onclick = () => step(1); swipeWire($('edBody'));
  $('sheet').addEventListener('click', e => { if (e.target.id === 'sheet') closeEditor(); });
  $('modal').addEventListener('click', e => { if (e.target.id === 'modal') dismissModal(); });
  document.querySelectorAll('#mtabs button').forEach(b => b.onclick = () => setTab(b.dataset.t));
  $('fPhoto').onchange = async e => { const fs = [...e.target.files]; e.target.value = ''; await addPhotos(fs); };
  document.addEventListener('keydown', e => { if (e.key !== 'Escape' || $('mk').classList.contains('show')) return; if ($('modal').classList.contains('show')) dismissModal(); else if ($('sheet').classList.contains('show')) closeEditor(); else if (placing) stopPlacing(); });
  document.addEventListener('pointerdown', e => { const b = e.target.closest && e.target.closest('button,.btn,.chip,label.opt,[data-p],[data-view],[data-el]'); if (!b || b.disabled) return; b.classList.add('tapped'); setTimeout(() => b.classList.remove('tapped'), 220); }, true);
  initDrop({ Admin, FM, addPhotos, addFiles, editorOpen: () => !!ED && $('sheet').classList.contains('show') });
}
// Quick-pick a typical defect: fills title, description, action, trade, type, severity and element; keeps location and photos.
// One-tap workflow: the responsible party marks it ready; the raiser (or an admin/editor) accepts or sends it back.
function workflowBar(w, con) {
  const mine = w.createdBy === S.user.email, reviewer = !con && (mine || can.edit());
  const b = [], cm = `<button id="wfCmt" class="cmt">💬 ${con ? 'Respond' : 'Comment'}</button>`, wrap = x => '<div class="wf">' + x.join('') + cm + '</div>';
  if (con && selfClose(w)) { if (w.status !== 'Closed') b.push('<button class="go" id="wfSelf">✔ Complete and close</button>'); if (w.status === 'Open') b.push('<button id="wfProg">🔧 In progress</button>'); return wrap(b); }
  if (w.status !== 'Closed' && w.status !== 'Ready for review') b.push('<button class="go" id="wfReady">✅ Ready for inspection</button>');
  if (w.status === 'Open') b.push('<button id="wfProg">🔧 In progress</button>');
  if (w.status === 'Ready for review' && reviewer) b.push('<button class="go" id="wfAccept">✔ Accept and close</button><button class="warn" id="wfReopen">↩ Reopen and send back</button>');
  if (w.status === 'Ready for review' && !reviewer) return '<p class="note">Marked ready for inspection; waiting for ' + esc(w.createdBy || 'the project team') + ' to review.</p>' + wrap([]);
  return wrap(b);
}
function typicalPicker() {
  const list = typicalList(S.project); const cur = collect(); const room = (cur.room || '').toLowerCase();
  const draw = q => { q = (q || '').toLowerCase(); const L = list.filter(x => !q || (x.t + ' ' + x.d + ' ' + x.tr + ' ' + (x.el || '')).toLowerCase().includes(q)); const rank = x => (room && x.r && room.includes(x.r.toLowerCase())) ? 0 : 1; L.sort((a, b) => rank(a) - rank(b) || a.tr.localeCompare(b.tr));
    const tag = x => x.used ? `used ${x.used}× on this project` : x.src === 'library' ? 'Resero library' : x.src === 'project' ? 'this project' : '';
    $('tpList').innerHTML = L.length ? L.map((x, i) => `<button class="tp" data-i="${list.indexOf(x)}"><b>${esc(x.t)}</b><small>${esc(x.tr)} · ${esc(x.s)}${tag(x) ? ' · ' + esc(tag(x)) : ''}</small></button>`).join('') : '<p class="muted">Nothing matches. Type it in the title instead.</p>';
    $('tpList').querySelectorAll('.tp').forEach(b => b.onclick = () => { const x = list[+b.dataset.i]; const body = $('edBody'), set = (n, v) => { const el = body.querySelector(`[name=${n}]`); if (!el || v == null) return; if (el.tagName === 'SELECT' && ![...el.options].some(o => o.value === v)) { const o = document.createElement('option'); o.textContent = v; el.appendChild(o); } el.value = v; el.classList.add('aifill'); };
      set('title', x.t); set('desc', x.d); set('action', x.a); set('trade', x.tr); set('type', x.ty); set('severity', sevMatch(S.project, x.s) || (S.project.severities.includes(x.s) ? x.s : null)); set('element', x.el); if (x.r && !cur.room) set('room', x.r); collect(); Nav.refit(body); closeModal(); toast('Filled from typical defect; adjust as needed'); }); };
  modal(`<h2>Typical defects</h2><input id="tpQ" placeholder="Search, e.g. paint, door, sealant" style="width:100%;margin-bottom:8px"><div class="btnlist" id="tpList" style="max-height:55vh;overflow:auto"></div><p class="note">Titles used two or more times on this project appear here automatically. ${cur.title ? '<a href="#" id="tpAdd">Save the current defect as a typical for all Resero projects</a>' : ''}</p><div class="act"><button id="tpX">Close</button></div>`);
  $('tpX').onclick = closeModal;
  if ($('tpAdd')) $('tpAdd').onclick = async ev => { ev.preventDefault(); const t = templateFrom(cur); try { await S.store.addToLibrary('typicals', t); (S.lib = S.lib || []).push(t); toast('Added "' + t.t + '" to the Resero typical defects library'); draw($('tpQ').value); } catch (e) { toast('Could not save to the library: ' + e.message, 5000); } }; $('tpQ').oninput = e => draw(e.target.value); draw(''); setTimeout(() => $('tpQ').focus(), 50);
}
let addFilesRef = null;
export async function addFiles(fs) { if (addFilesRef) return addFilesRef(fs); }
function newDefectChooser() {
  modal(`<h2>New defect</h2><div class="btnlist">
    ${S.plans.length ? '<button id="ndPin">📍 Pin on the plan<small>Start here: tap where it is, then photo, then say what is wrong</small></button>' : ''}
    <button id="ndCam">📷 Take a photo first<small>Opens the camera, then the form</small></button>
    <button id="ndType">✎ General defect or type it<small>Form without a pin</small></button>
  </div><div class="act"><button id="ndX">Cancel</button></div>`);
  $('ndX').onclick = closeModal;
  const go = async after => { closeModal(); openEditor(await newDefect(), true, true); after && after(); };
  $('ndCam').onclick = () => go(() => $('fCam').click());
  $('ndType').onclick = () => go();
  if ($('ndPin')) $('ndPin').onclick = () => { closeModal(); if (!S.plans.length) { toast('No plans in this project'); return; } setTab('plan'); startPlacing({ mode: 'new' }); };
}
async function addPhotos(fs) {
  if (!ED) return;
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (x) {} for (const f of fs) { try { ED.d.photos.push(await newPhoto(f)); } catch (x) { toast('Could not read that photo'); } } renderPhotos(); if (ED && ED.isNew) nextStep(); }
window.addEventListener('rd-defects-changed', () => { filtersDirty = true; render(); });
boot();
