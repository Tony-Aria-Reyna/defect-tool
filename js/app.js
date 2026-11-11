// Resero Defects - main app: sign in, projects, workspace, defect editor.
import { createStore, createSandbox, isDemo } from './store.js';
import { APP, STATUS_COLOURS as SCOL, ROLES } from './config.js';
import { S, can, withDefaults, unitList, saveLocal } from './state.js';
import { $, esc, toast, modal, closeModal, busy, confirmBox, opts, uid, todayISO, nzDate, nzDT, stamp, isMobile, natural, safeName, deliver, loadImage, locate } from './util.js';
import { PlanView } from './planview.js';
import { dictate, stopDictation, holdToTalk, aiCall, aiPrompt } from './ai.js';
import { newPhoto, uploadPhotos, uploadFiles, flushOutbox, pendingUrl, markup, initMarkup, outboxCount } from './photos.js';
import { buildPdf, buildXlsx, buildCsv, buildZip, locText, pinLabel } from './exports.js';
import * as Admin from './admin.js';
import * as FM from './fm.js';
import { initDrop } from './dnd.js';
import { helpDialog, siteCheck } from './help.js';
import * as Nav from './nav.js';
import { installDialog, maybeNag, canInstall } from './install.js';
import { typicalList, templateFrom } from './typicals.js';
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
  try { const r = await navigator.serviceWorker.getRegistration(); if (r) await r.update(); } catch (e) {}
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
function viewAsBar() { let b = $('viewAsBar'); if (!b) { b = document.createElement('div'); b.id = 'viewAsBar'; document.body.appendChild(b); } document.body.classList.toggle('testmode', !!S.testMode); if (S.testMode) { b.innerHTML = `🧪 <b>TEST MODE</b> · viewing as <b>${esc(ROLES[S.viewAs] || S.viewAs)}</b> · nothing you do here is saved · <a href="#" id="vaStop">Leave test mode</a>`; b.classList.add('show'); $('vaStop').onclick = e => { e.preventDefault(); leaveTestMode(); }; } else b.classList.remove('show'); }
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
    S.unsub = S.store.watchDefects(pid, list => { S.defects = list; filtersDirty = true; render(); flushOutbox().then(netbar).then(processPendingAI); }, e => toast('Sync problem: ' + friendly(e), 5000));
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
  const r = S.defects.filter(d => (F.toReview ? (d.status === 'Ready for review' && (d.createdBy === S.user.email || can.admin())) : F.review ? (d.aiReview || d.aiPending) : F.status.has(d.status)) && (!F.block || d.block === F.block) && (!F.level || d.level === F.level) && (!F.unit || (F.unit === '-' ? !d.unit : String(d.unit) === F.unit)) && (!F.sev || d.severity === F.sev) && (!F.trade || d.trade === F.trade) && (!F.resp || d.responsible === F.resp) && (!q || [d.id, d.title, d.desc, d.element, d.room, 'unit ' + d.unit, d.trade, d.action, d.extRef, d.responsible].join(' ').toLowerCase().includes(q)));
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
  const pend = D.filter(d => d.aiPending).length, rev = D.filter(d => d.aiReview).length, toRev = D.filter(d => d.status === 'Ready for review' && !can.contractor() && (d.createdBy === S.user.email || can.admin())).length;
  $('counts').innerHTML = S.project.statuses.map(s => `<button class="cnt ${S.F.status.has(s) ? 'on' : ''}" data-s="${s}"><i style="background:${SCOL[s]}"></i>${s} <b>${c[s]}</b></button>`).join('') + `<span class="cnt">Major <b>${maj}</b>${tri ? ` · To triage <b>${tri}</b>` : ''}</span>` + (rev || pend || S.F.review ? `<button class="cnt chk ${S.F.review ? 'on' : ''}" data-r="1">✨ To check <b>${rev}</b>${pend ? ` · 📵 Waiting for coverage <b>${pend}</b>` : ''}</button>` : '') + (toRev || S.F.toReview ? `<button class="cnt chk ${S.F.toReview ? 'on' : ''}" data-tr="1">🔎 For me to inspect <b>${toRev}</b></button>` : '');
  $('counts').querySelectorAll('button').forEach(b => b.onclick = () => { if (b.dataset.r) { S.F.review = !S.F.review; render(); return; } if (b.dataset.tr) { S.F.toReview = !S.F.toReview; render(); return; } const s = b.dataset.s; S.F.status.has(s) ? S.F.status.delete(s) : S.F.status.add(s); render(); });
  const L = filtered();
  $('lmeta').textContent = L.length + ' of ' + D.length + ' shown';
  $('list').innerHTML = L.length ? L.map(d => { const sev = /^Major/.test(d.severity || '') ? 'sev-maj' : d.severity === 'To triage' ? 'sev-tri' : ''; const ph = (d.photos || [])[0];
    return `<div class="card ${S.sel === d.id ? 'sel' : ''} ${S.bulk && S.bulk.has(d.id) ? 'picked' : ''}" style="--c:${SCOL[d.status] || '#999'}" data-id="${esc(d.id)}">${S.bulk ? `<label class="pick"><input type="checkbox" data-pick="${esc(d.id)}" ${S.bulk.has(d.id) ? 'checked' : ''}></label>` : ''}${ph ? `<img class="th" data-ph="${esc(d.id)}" alt="">` : ''}<div class="b"><div class="t">${esc(d.id)} · ${esc(d.title || d.element || '(untitled)')}</div><div class="d">${esc(d.desc)}</div><div class="m"><span class="pill" style="background:${SCOL[d.status] || '#999'}">${esc(d.status)}</span>${d.severity ? `<span class="tag ${sev}">${esc(d.severity)}</span>` : ''}${locText(d) ? `<span class="tag">${esc(locText(d))}</span>` : ''}${d.trade ? `<span class="tag">${esc(d.trade)}</span>` : ''}${d.aiPending ? '<span class="tag chk">📵 Waiting for coverage</span>' : ''}${d.aiReview ? '<span class="tag chk">✨ To check</span>' : ''}${d.plan ? `<span class="tag loc" data-loc="${esc(d.id)}" title="Show on the plan">📍</span>` : ''}${(d.photos || []).length ? `<span class="tag">📷 ${d.photos.length}</span>` : ''}</div></div></div>`; }).join('') : `<div class="empty">${D.length ? 'No defects match these filters.' : 'No defects yet.' + (can.edit() ? ' Tap the microphone or + New to raise one, or import a register from the ☰ menu.' : '')}</div>`;
  $('list').querySelectorAll('.tag.loc').forEach(t => t.onclick = e => { e.stopPropagation(); const d = S.defects.find(x => x.id === t.dataset.loc); if (d) showLocation(d); });
  $('list').querySelectorAll('[data-pick]').forEach(cb => { cb.onclick = e => e.stopPropagation(); cb.onchange = () => { cb.checked ? S.bulk.add(cb.dataset.pick) : S.bulk.delete(cb.dataset.pick); cb.closest('.card').classList.toggle('picked', cb.checked); bulkBar(); }; });
  $('list').querySelectorAll('.card').forEach(el => el.onclick = () => { if (S.bulk) { const cb = el.querySelector('[data-pick]'); if (cb) { cb.checked = !cb.checked; cb.onchange(); } return; } const d = S.defects.find(x => x.id === el.dataset.id); S.sel = d.id; if (d.plan && !isMobile()) showPlan(d.plan, d); render(); openEditor(d); });
  // thumbnails load lazily
  $('list').querySelectorAll('img[data-ph]').forEach(async im => { const d = S.defects.find(x => x.id === im.dataset.ph); if (d && d.photos[0]) im.src = await photoSrc(d.photos[0]); });
  renderPins();
}
function renderPins() {
  if (!PV || !S.project) return; const ids = new Set(filtered().map(d => d.id));
  PV.setPins(S.defects.filter(d => ((d.plan === S.curPlan && d.x != null) || (d.plan2 === S.curPlan && d.x2 != null)) && ids.has(d.id)).map(d => ({ id: d.id, x: d.plan === S.curPlan ? d.x : d.x2, y: d.plan === S.curPlan ? d.y : d.y2, colour: SCOL[d.status] || '#999', label: pinLabel(d), sel: S.sel === d.id, title: d.id + ' ' + (d.title || '') })));
}

/* ================================================================ plans */
let placing = null;
function renderPlanTabs() {
  const pt = $('plantabs');
  pt.innerHTML = S.plans.map(p => `<button data-p="${esc(p.id)}" class="${p.id === S.curPlan ? 'on' : ''}">${esc(p.name)}</button>`).join('') +
    (S.plans.length ? '' : (can.admin() ? '<span class="muted small">No plans yet.</span><button class="act" id="bUpPlan">Upload plans</button>' : '<span class="muted small">No plans uploaded for this project yet.</span>'));
  let pinBtn = $('bPin'); if (!pinBtn) { pinBtn = document.createElement('button'); pinBtn.id = 'bPin'; pinBtn.className = 'pinfab'; $('planPane').appendChild(pinBtn); } pinBtn.textContent = '📍 Add pin'; pinBtn.classList.remove('on'); pinBtn.style.display = S.plans.length && can.edit() ? '' : 'none';
  pt.querySelectorAll('[data-p]').forEach(b => b.onclick = () => showPlan(b.dataset.p));
  if ($('bPin')) $('bPin').onclick = () => placing ? stopPlacing() : startPlacing({ mode: 'new' });
  if ($('bUpPlan')) $('bUpPlan').onclick = () => Admin.plansDialog();
}
export async function showPlan(id, focus) {
  if (Admin.zoneActive() && id !== S.curPlan) { if (!(await Admin.zoneSwitch(id))) return; }
  S.curPlan = id; const p = S.plans.find(x => x.id === id) || null;
  $('plantabs').querySelectorAll('[data-p]').forEach(b => b.classList.toggle('on', b.dataset.p === id));
  // Alternative views of the same sheet (ceiling plan, wall plan, cladding elevations…). Pins dropped on a view take its surface.
  S.view = S.view || {}; const views = planViews(p), vkey = views.some(v => v.key === S.view[p && p.id]) && !can.contractor() ? S.view[p.id] : 'floor', cur = views.find(v => v.key === vkey) || views[0];
  await PV.setPlan(p, p ? await imgUrl(cur.img) : ''); PV.setZonesVisible(false);
  let rb = $('bRcp'); if (!rb) { rb = document.createElement('div'); rb.id = 'bRcp'; rb.className = 'viewbar'; $('planPane').appendChild(rb); }
  rb.style.display = p && views.length > 1 && !can.contractor() ? '' : 'none';
  rb.innerHTML = views.map(v => `<button data-view="${esc(v.key)}" class="${v.key === vkey ? 'on' : ''}">${esc(v.name)}</button>`).join('');
  rb.querySelectorAll('button').forEach(b => b.onclick = () => { S.view[S.curPlan] = b.dataset.view; showPlan(S.curPlan); });
  if (Admin.zoneActive()) { await Admin.zoneEditor(PV); }
  renderPins(); if (isMobile() && focus) setTab('plan');
  if (focus && focus.x != null) requestAnimationFrame(() => PV.focus(focus.x, focus.y));
}
function startPlacing(pl) {
  placing = pl; PV.setMode('place', (pl.mode === 'pick' ? esc(pl.banner || 'Tap the point') : pl.mode === 'new' ? 'Tap the plan where the defect is' : 'Tap the plan to set the location of ' + esc(pl.draft.id)) + '<button id="bnC">Cancel</button>');
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
export const VIEW_TYPES = [['ceiling', 'Ceiling plan (RCP)', 'Ceiling'], ['walls', 'Wall plan / internal elevations', 'Wall'], ['cladding', 'Cladding / external elevations', 'Exterior cladding'], ['roof', 'Roof plan', 'Roof'], ['services', 'Services plan', 'Services'], ['joinery', 'Joinery / fit-out plan', 'Joinery']];
// Elevation -> floor plan mapping. An elevation plan carries link = { planId, a:[x,y], b:[x,y], ea, eb }: points a and b on the floor
// plan are the two ends of the building face, ea/eb the same two points as x fractions on the elevation image.
export function elevToFloor(ep, ex, ey) {
  const links = (ep.links && ep.links.length) ? ep.links : (ep.link ? [ep.link] : []);
  const inside = l => (!l.band || (ey >= l.band[0] && ey <= l.band[1])) && (!l.bandX || (ex >= l.bandX[0] && ex <= l.bandX[1]));
  const L = links.find(inside) || links.find(l => !l.band || (ey >= l.band[0] && ey <= l.band[1])) || links[0]; if (!L || !L.planId) return null; const fp = S.plans.find(q => q.id === L.planId); if (!fp) return null;
  const t = (ex - L.ea) / ((L.eb - L.ea) || 1), x = L.a[0] + t * (L.b[0] - L.a[0]), y = L.a[1] + t * (L.b[1] - L.a[1]);
  // nudge slightly inside the building so the point lands in the unit behind the face
  const dx = L.b[0] - L.a[0], dy = L.b[1] - L.a[1], len = Math.hypot(dx * fp.w, dy * fp.h) || 1; let nx = -dy * fp.h / len * 10 / fp.w, ny = dx * fp.w / len * 10 / fp.h;
  const side = sgn => locate(fp.zones, x + sgn * nx * 3, y + sgn * ny * 3); if (!side(1) && side(-1)) { nx = -nx; ny = -ny; }
  return { planId: fp.id, x: Math.max(0, Math.min(1, x + nx * 3)), y: Math.max(0, Math.min(1, y + ny * 3)), face: [x, y] };
}
function applyZone(d, x, y, planId) {
  const p = S.plans.find(q => q.id === planId); d.plan = planId; d.x = x; d.y = y;
  if (p.kind === 'elevation') {
    const m = elevToFloor(p, x, y); d.surface = d.surface && d.surface !== 'Floor' ? d.surface : 'Exterior cladding';
    if (m) { d.plan2 = m.planId; d.x2 = m.x; d.y2 = m.y; const fp = S.plans.find(q => q.id === m.planId), hit = locate(fp.zones, m.x, m.y); d.block = p.block || fp.block || d.block; d.level = p.level || d.level || fp.level; if (hit) { if (hit.unit) d.unit = hit.unit; if (hit.room) d.room = hit.room; if (!d.level && hit.level) d.level = hit.level; } d.zoneHit = [hit && hit.unit && 'Unit ' + hit.unit, hit && hit.room, d.surface, 'also pinned on ' + fp.name].filter(Boolean).join(', '); }
    else { d.plan2 = null; d.block = p.block || d.block; d.level = p.level || d.level; d.zoneHit = d.surface + ' (elevation not linked to a floor plan yet)'; }
    return;
  }
  d.plan2 = null;
  const hit = locate(p.zones, x, y);
  const cv = planViews(p).find(v => v.key === ((S.view || {})[planId] || 'floor')); if (cv && cv.key !== 'floor') d.surface = cv.surface; else if (!d.surface) d.surface = p.surface || 'Floor';
  if (hit) { if (hit.unit) d.unit = hit.unit; if (hit.room) d.room = hit.room; if (hit.item) d.item = hit.item; else if (hit.room) d.item = d.item || ''; d.block = hit.block || p.block || d.block; d.level = hit.level || p.level || d.level; d.zoneHit = [hit.unit && 'Unit ' + hit.unit, hit.room, hit.item, d.surface].filter(Boolean).join(', '); }
  else { d.block = p.block || d.block; d.level = p.level || d.level; d.zoneHit = ''; }
}
async function onPlace(x, y) {
  const pl = placing; stopPlacing();
  if (pl.mode === 'pick') { toast('✓ Point recorded', 1200); pl.resolve({ x, y }); return; }
  if (pl.mode === 'new') { const d = await newDefect(); applyZone(d, x, y, S.curPlan); openEditor(d, true, true); }
  else { applyZone(pl.draft, x, y, S.curPlan); openEditor(pl.draft, pl.isNew, true); }
}
// Ask the user to tap one point on a plan (used when linking an elevation to a floor plan).
export function pickPoint(planId, banner) { return new Promise(resolve => { setTab('plan'); showPlan(planId).then(() => startPlacing({ mode: 'pick', resolve, banner })); }); }
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
const uniq = a => [...new Set(a.filter(Boolean).map(String))];
function blockList() { return uniq([...(S.project.blocks || []), ...S.plans.map(p => p.block), ...S.plans.flatMap(p => (p.zones || []).map(z => z.block)), ...S.defects.map(d => d.block)]).sort(natural); }
function levelList() { return uniq([...(S.project.levels || []), ...S.plans.map(p => p.level), ...S.plans.flatMap(p => (p.zones || []).map(z => z.level)), ...S.defects.map(d => d.level)]).sort(natural); }
// People on the project: members plus the responsible-party list, for "on behalf of".
function peopleList() { const info = S.project.memberInfo || {}; return uniq([...Object.values(info).map(i => i.name || i.email), ...(S.project.responsible || [])]).sort(natural); }
function unitInfo(u) { for (const p of S.plans) for (const z of (p.zones || [])) if (z.kind === 'unit' && String(z.unit) === String(u)) return { block: z.block || p.block, level: z.level || p.level }; return null; }

/* ================================================================ editor */
let ED = null;
const FIELDS = ['source', 'dateRaised', 'block', 'level', 'unit', 'room', 'surface', 'item', 'element', 'title', 'desc', 'type', 'severity', 'trade', 'responsible', 'action', 'targetDate', 'status'];
async function newDefect() {
  const p = S.project;
  return { id: '', isNew: true, source: S.local.source || p.sources[0], dateRaised: todayISO(), raisedBy: S.user.name, block: '', level: '', unit: '', room: '', element: '', title: '', desc: '', type: p.types[0], severity: p.severities.includes('Minor defect') ? 'Minor defect' : p.severities[0], trade: p.trades[0], responsible: p.responsible[0], action: '', targetDate: '', status: 'Open', plan: '', x: null, y: null, photos: [], history: [], transcript: '' };
}
export function openEditor(d, isNew, isDraft) {
  const w = isDraft ? d : JSON.parse(JSON.stringify(d)); const p = S.project;
  ED = { d: w, isNew: !!isNew, orig: isNew ? null : S.defects.find(x => x.id === d.id), removed: ED && ED.d === d ? ED.removed : [] };
  const ro = !can.write(), con = can.contractor();
  const dis = ro || con ? 'disabled' : '';
  $('edTitle').textContent = isNew ? 'New defect' : w.id;
  const units = [...new Set([...unitList(p), ...(w.unit ? [String(w.unit)] : [])])];
  const stat = con ? p.statuses.filter(s => ['Open', 'In progress', 'Ready for review'].includes(s) || s === w.status) : p.statuses;
  $('edBody').innerHTML = `${w.aiPending ? '<div class="ainote show">📵 Site note recorded out of coverage. Gemini will fill in the form when the phone is back in service. You can still edit and pin it now.</div>' : ''}${w.aiReview ? '<div class="ainote show">✨ Gemini filled this in from your site note while you were out of coverage. Check the fields, then Save to mark it checked.</div>' : ''}
  ${!ro && !con && (isNew || w.createdBy === S.user.email || (!w.createdBy && can.admin())) ? `<div class="dict">
    <div class="row1"><button class="mic" id="mic" title="Hold to talk"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-2.08A7 7 0 0 0 19 12h-2z"/></svg></button>
    <textarea id="dt" placeholder="Hold the mic and say it how you would on site, e.g. &quot;Unit 7 bathroom, silicone to the shower tray is patchy and there's a gap behind the vanity, contractor to redo before handover&quot;">${esc(w.transcript || '')}</textarea></div>
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
  <div class="grid">
    <label class="f">Unit<select name="unit" ${dis}><option value="">Common / none</option>${units.map(u => `<option ${String(w.unit) === u ? 'selected' : ''}>${esc(u)}</option>`).join('')}</select></label>
    <label class="f">Room / area<input name="room" value="${esc(w.room)}" list="rooms" ${dis}></label>
    <label class="f">Surface<select name="surface" ${dis}><option value="">Not set</option>${opts(SURFACES, w.surface)}</select></label>
    <label class="f">Item<input name="item" value="${esc(w.item || '')}" list="items" placeholder="e.g. Kitchen unit, Vanity, Shower" ${dis}></label>
    <label class="f">Block<select name="block" ${dis}><option value="">Not set</option>${opts(blockList(), w.block)}</select></label>
    <label class="f">Level<select name="level" ${dis}><option value="">Not set</option>${opts(levelList(), w.level)}</select></label>
    <label class="f full">Element / product<input name="element" value="${esc(w.element)}" ${dis} placeholder="e.g. Shower tray, cladding, fire door"></label>
  </div>
  <datalist id="items">${uniq([...S.plans.flatMap(p => (p.zones || []).filter(z => z.kind === 'item').map(z => z.name)), ...S.defects.map(d => d.item), ...(S.project.items || [])]).map(v => `<option value="${esc(v)}">`).join('')}</datalist><datalist id="rooms">${[...new Set([...S.plans.flatMap(pl => (pl.zones || []).filter(z => z.kind !== 'unit' && z.name).map(z => z.name)), ...p.rooms])].map(r => `<option>${esc(r)}</option>`).join('')}</datalist>
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
  <h3 class="sec">Attachments</h3>
  <div class="files" id="fls">${(w.files || []).map((f, i) => `<div class="file"><a href="#" data-f="${i}">📎 ${esc(f.name)}</a><span class="muted small"> · ${esc(f.by || '')} ${esc(nzDate((f.t || '').slice(0, 10)))}${f.pending ? ' · waiting to upload' : ''}</span>${!ro && (can.edit() || f.isNew) ? ` <button data-fx="${i}" class="small">✕</button>` : ''}</div>`).join('')}${!ro ? '<button id="addfile" class="small">📎 Attach PDF or file</button>' : ''}</div>
  <h3 class="sec">${con ? 'Response and history' : 'Comments and history'}</h3>
  ${!ro ? `<label class="f"><textarea id="cmt" style="min-height:44px" placeholder="${con ? 'Your response: what was done, when, and anything the reviewer should know' : 'Add a comment (saved with your name and the time)'}"></textarea></label>${!con && can.edit() ? `<label class="f small">On behalf of (when relaying an email or a verbal response)<select id="cmtFor"><option value="">Myself</option>${peopleList().map(n => `<option>${esc(n)}</option>`).join('')}</select></label>` : ''}` : ''}
  <div class="hist">${(w.history || []).slice().sort((a, b) => String(b.t || '').localeCompare(String(a.t || ''))).map(h => `<div><b>${esc(nzDT(h.t))}</b> · ${esc(h.who)}: ${esc(h.txt)}</div>`).join('') || '<div>No history yet.</div>'}</div>
  ${w.ext ? `<details class="ext"><summary>Original record (${esc(w.extRef || w.source)})</summary>${Object.entries(w.ext).filter(e => e[1]).map(([k, v]) => `<p><b>${esc(k)}:</b> ${esc(v)}</p>`).join('')}</details>` : ''}`;
  const body = $('edBody');
  if (!ro && w.unit && (!w.block || !w.level)) { const u = unitInfo(w.unit); if (u) { if (!w.block && u.block) { w.block = u.block; body.querySelector('[name=block]').value = u.block; } if (!w.level && u.level) { w.level = u.level; body.querySelector('[name=level]').value = u.level; } } }
  body.querySelector('[name=unit]').onchange = e => { const u = unitInfo(e.target.value); if (u) { if (u.block) body.querySelector('[name=block]').value = u.block; if (u.level) body.querySelector('[name=level]').value = u.level; } };
  if ($('mic')) { holdToTalk($('mic'), () => dictate($('dt'), $('mic'), aiStatus, () => { if (!navigator.onLine) queueNote($('dt').value.trim()); else if (S.local.autoAI !== false) interpret(); })); $('aiGo').onclick = interpret; }
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
  $('locT').innerHTML = esc(locText(d) || 'No location yet') + (p ? ' · ' + esc(p.name) : '') + (d.zoneHit ? `<br><span class="zonehit">Found: ${esc(d.zoneHit)}</span>` : '');
  if (!p || d.x == null) { c.style.display = 'none'; return; } c.style.display = '';
  try { const im = await loadImage(await imgUrl(p.img)); const W = c.width, H = c.height, s = 3 * W / p.w, cx = d.x * p.w * s, cy = d.y * p.h * s; x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); x.drawImage(im, W / 2 - cx, H / 2 - cy, p.w * s, p.h * s); x.fillStyle = SCOL[d.status] || '#d64545'; x.beginPath(); x.arc(W / 2, H / 2, 9, 0, 7); x.fill(); x.strokeStyle = '#fff'; x.lineWidth = 2; x.stroke(); }
  catch (e) { c.style.display = 'none'; }
}
async function renderPhotos() {
  const w = ED.d, ro = !can.write();
  $('phs').innerHTML = (w.photos || []).map((p, i) => `<div class="ph"><img data-i="${i}" alt="">${!ro && (can.edit() || p.isNew) ? `<button data-x="${i}">✕</button>` : ''}${p.pending ? '<span class="pend">waiting</span>' : ''}</div>`).join('') + (!ro ? '<div class="addph" id="addcam">📷<span>Camera</span></div><div class="addph" id="addph">🖼<span>From gallery</span></div>' : '');
  $('phs').querySelectorAll('img').forEach(async im => { const p = w.photos[+im.dataset.i]; im.src = await photoSrc(p); im.onclick = () => ro ? window.open(im.src, '_blank') : markup(im.src, data => { const old = w.photos[+im.dataset.i]; w.photos[+im.dataset.i] = { id: Math.random().toString(36).slice(2, 10), data, t: new Date().toISOString(), by: S.user.name, isNew: true, replaces: old.path || undefined }; renderPhotos(); }); });
  $('phs').querySelectorAll('button[data-x]').forEach(b => b.onclick = async () => { if (await confirmBox('Remove this photo?', 'Remove')) { const [p] = w.photos.splice(+b.dataset.x, 1); if (p.path) (ED.removed = ED.removed || []).push(p.path); renderPhotos(); } });
  if ($('addph')) $('addph').onclick = () => $('fPhoto').click();
  if ($('addcam')) $('addcam').onclick = () => $('fCam').click();
  if ($('addfile')) $('addfile').onclick = () => $('fAttach').click();
  $('locC').onclick = () => showLocation(ED.d); $('locC').style.cursor = 'zoom-in'; $('locC').title = 'Open the plan at this location';
  $('fls').querySelectorAll('[data-f]').forEach(a => a.onclick = async ev => { ev.preventDefault(); const f = (ED.d.files || [])[+a.dataset.f]; if (!f) return; const u = f.data || (f.url ? await imgUrl(f.url) : ''); if (u) window.open(u, '_blank'); else toast('This file is still waiting to upload'); });
  $('fls').querySelectorAll('[data-fx]').forEach(b => b.onclick = () => { const i = +b.dataset.fx; const f = ED.d.files[i]; if (f.path && !f.isNew) (ED.removed = ED.removed || []).push(f.path); ED.d.files.splice(i, 1); openEditor(ED.d, ED.isNew, true); });
  const wf = (status, label, needComment) => async () => { collect(); const c = $('cmt') ? $('cmt').value.trim() : ''; if (needComment && !c) { toast(label + ': add a short comment first so the other side knows what happened'); $('cmt').focus(); return; } const sel = $('edBody').querySelector('[name=status]'); if (sel) { if (![...sel.options].some(o => o.value === status)) { const o = document.createElement('option'); o.textContent = status; sel.appendChild(o); } sel.value = status; } ED.d.status = status; ED.wfLabel = label; await saveEditor(); };
  if ($('wfReady')) $('wfReady').onclick = wf('Ready for review', 'Ready for inspection', true);
  if ($('wfAccept')) $('wfAccept').onclick = wf('Closed', 'Accepted and closed', false);
  if ($('wfReopen')) $('wfReopen').onclick = wf('Open', 'Reopened and sent back', true);
  if ($('wfProg')) $('wfProg').onclick = wf('In progress', 'In progress', false);
  if ($('edTyp')) $('edTyp').onclick = ev => { ev.preventDefault(); typicalPicker(); };
  requestAnimationFrame(() => Nav.refit($('edBody')));
}
function collect() { const b = $('edBody'); FIELDS.forEach(f => { const el = b.querySelector(`[name=${f}]`); if (el) ED.d[f] = el.value; }); if ($('dt')) ED.d.transcript = $('dt').value; return ED.d; }
function closeEditor(keep) { stopDictation(); $('sheet').classList.remove('show'); if (!keep) ED = null; Nav.closed('editor'); }
// Next reference number from what this device knows (used when the server cannot be reached in time).
function localNextRef() { const pre = (S.project.idPrefix || 'D') + '-'; let m = S.project.seq || 0; S.defects.forEach(d => { if (d.id.startsWith(pre)) { const n = parseInt(d.id.slice(pre.length), 10); if (n > m) m = n; } }); return m + 1; }
async function saveEditor() {
  const d = collect(); const who = ($('cmtFor') && $('cmtFor').value) ? S.user.name + ' on behalf of ' + $('cmtFor').value : S.user.name, t = new Date().toISOString(), pid = S.project.id, newH = [];
  if (!d.title && !d.desc) { toast('Add a title or description first'); return; }
  if (!d.title) d.title = d.desc.split(/[.,;]/)[0].slice(0, 70);
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
      const keys = can.contractor() ? ['status'] : [...FIELDS, 'plan', 'x', 'y', 'plan2', 'x2', 'y2', 'transcript', 'aiPending'];
      if (ED.wfLabel) { ch.push(ED.wfLabel.toLowerCase()); }
      if (o.aiReview && !can.contractor()) { patch.aiReview = false; ch.push('checked'); }
      keys.forEach(k => { if ((o[k] ?? '') !== (d[k] ?? '')) patch[k] = d[k] ?? null; });
      ['status', 'severity', 'responsible', 'targetDate', 'unit', 'room', 'title'].forEach(k => { if (k in patch) ch.push(k === 'targetDate' ? 'target date ' + (nzDate(d[k]) || 'cleared') : k + ' ' + (o[k] || '-') + ' → ' + (d[k] || '-')); });
      if ('plan' in patch || 'x' in patch) ch.push('pin ' + (d.plan ? 'moved' : 'removed'));
      const ph = clean(d).photos; if (JSON.stringify(ph) !== JSON.stringify(o.photos || [])) { patch.photos = ph; ch.push('photos ' + (o.photos || []).length + ' → ' + ph.length); }
      const fl = clean(d).files; if (JSON.stringify(fl) !== JSON.stringify(o.files || [])) { patch.files = fl; ch.push('attachments ' + (o.files || []).length + ' → ' + fl.length); }
      if (ED.wfLabel) { newH.push({ t, who, txt: ED.wfLabel + (cm ? ': ' + cm : '.') }); const rest = ch.filter(x => x !== ED.wfLabel.toLowerCase() && !/^status /.test(x)); if (rest.length) newH.push({ t, who, txt: 'Changed ' + rest.join('; ') + '.' }); }
      else { if (ch.length) newH.push({ t, who, txt: 'Changed ' + ch.join('; ') + '.' }); if (cm) newH.push({ t, who, txt: cm }); }
      if (!Object.keys(patch).length && !newH.length) { b.done(); closeEditor(); return; }
      patch.updated = t; patch.updatedBy = S.user.email;
      await S.store.updateDefect(pid, d.id, patch, newH);
    }
    S.sel = d.id; b.done(); closeEditor(); toast(d.id + (navigator.onLine ? ' saved' : ' saved on this phone, will sync when back in coverage')); netbar();
  } catch (e) { b.done(); console.error(e); toast('Could not save: ' + friendly(e), 6000); }
}
async function deleteDefect() {
  if (!ED || ED.isNew) return; if (!(await confirmBox(`Delete ${ED.d.id}? This cannot be undone.`, 'Delete'))) return;
  try { await S.store.deleteDefect(S.project.id, ED.d.id); (ED.d.photos || []).forEach(p => p.path && S.store.deleteFile(p.path)); closeEditor(); toast('Deleted'); } catch (e) { toast('Could not delete: ' + friendly(e)); }
}
function step(dir) { if (!ED || ED.isNew) return; const L = filtered(); const i = L.findIndex(x => x.id === ED.d.id); const n = L[i + dir]; if (n) { S.sel = n.id; openEditor(n); renderPins(); } }

/* ---- Gemini ---- */
const AIMAP = { title: 'title', description: 'desc', action: 'action', unit: 'unit', room: 'room', surface: 'surface', item: 'item', block: 'block', level: 'level', element: 'element', type: 'type', severity: 'severity', trade: 'trade', responsible: 'responsible', status: 'status', targetDate: 'targetDate' };
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
  } catch (e) {
    if (e.message === 'nokey') { aiStatus(''); Admin.aiSettings('Set up Gemini to use the interpreter.'); }
    else if (!navigator.onLine || /Could not reach|Failed to fetch|NetworkError|network/i.test(e.message)) queueNote(text);
    else aiStatus(e.message, true);
  }
  finally { btn.disabled = false; }
}
// No coverage: keep the note on the record; Gemini fills the form in when the phone is back in service.
function queueNote(text) {
  const d = ED.d; d.aiPending = true; d.transcript = text;
  if (!d.title) { const el = $('edBody').querySelector('[name=title]'); el.value = d.title = 'Site note: ' + text.replace(/\s+/g, ' ').slice(0, 60); }
  if (!d.desc) { const el = $('edBody').querySelector('[name=desc]'); el.value = d.desc = text; }
  const m = /\bunit\s*(?:number\s*)?(\d{1,3})\b/i.exec(text); const b = $('edBody');
  if (m && !d.unit && unitList(S.project).includes(m[1])) { const el = b.querySelector('[name=unit]'); if (el) { el.value = m[1]; el.dispatchEvent(new Event('change')); } d.unit = m[1]; collect(); if (!d.plan) { const z = findZone(d.unit, ''); if (z) { applyZone(d, z.x, z.y, z.plan.id); d.zoneHit = 'Pinned at the centre of Unit ' + d.unit + ' (move it if needed)'; drawLoc(); } } }
  aiStatus('No coverage. Saved as a site note; Gemini will fill in the form when you are back in service, then it will show under "To check".');
}
let aiBusy = false;
export async function processPendingAI() {
  if (aiBusy || !navigator.onLine || !S.project || !can.edit()) return;
  const todo = S.defects.filter(d => d.aiPending && d.transcript); if (!todo.length) return;
  aiBusy = true; const pid = S.project.id;
  try {
    for (const d of todo) {
      if (!S.project || S.project.id !== pid) break;
      let o; try { const raw = await aiCall(aiPrompt(d.transcript, d)); o = JSON.parse(String(raw).replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch (e) { if (!navigator.onLine || /Could not reach|Failed to fetch|network/i.test(e.message)) break; console.warn('pending AI', d.id, e); continue; }
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
  if (!d.plan) { const z = findZone(d.unit, d.room); if (z) { applyZone(d, z.x, z.y, z.plan.id); d.zoneHit = (z.unitOnly ? 'Pinned at the centre of Unit ' + d.unit : 'Pinned in ' + d.zoneHit) + ' (move it if needed)'; } }
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
    ${canInstall() ? `<button id="mInst">📲 Install ${/Android|iPhone|iPad/.test(navigator.userAgent) ? 'on this phone' : 'as a desktop app'}<small>${/Android|iPhone|iPad/.test(navigator.userAgent) ? 'Home screen app, stays signed in' : 'Opens in its own window from the Start menu or Dock'}</small></button>` : ''}
    ${can.realAdmin() ? `<button id="mViewAs">👁 View as…<small>${S.viewAs ? 'Currently viewing as ' + esc(ROLES[S.viewAs] || S.viewAs) + ' (tap to change or stop)' : 'Test the app as an editor, contractor or viewer'}</small></button>` : ''}
    <button id="mReload">🔄 Reload app<small>Get the latest version (v${APP.version} now)</small></button>
    <button id="mCheck">✅ Site check<small>Test everything before you go on site</small></button>
    <button id="mHelp">❓ Help<small>Quick guide, ask a question</small></button>
    <button id="mProj">🗂 All projects<small>Switch project</small></button>
    <button id="mOut">⎋ Sign out<small>${esc(S.user.email)}</small></button>
  </div><p class="note" style="margin-top:12px">${esc(APP.name)} v${APP.version}${isDemo() ? ' · DEMO MODE (data stays in this browser)' : ''}</p><div class="act"><button id="mX">Close</button></div>`);
  const on = (id, fn) => { if ($(id)) $(id).onclick = () => { closeModal(); fn(); }; };
  on('mSet', () => Admin.projectSettings(S.project)); on('mUsers', Admin.usersDialog); on('mPlans', Admin.plansDialog); on('mZones', () => Admin.zoneEditor(PV));
  on('mImp', Admin.importDialog); on('mCheck', siteCheck); on('mInst', () => installDialog(false)); on('mReload', reloadApp);
  on('mViewAs', () => { modal(`<h2>Test mode</h2><p>Try the app as another role on a <b>throwaway copy</b> of this project. Press every button you like: nothing is saved to the cloud, and leaving test mode throws the copy away.</p><div class="btnlist">${['admin', 'editor', 'contractor', 'viewer'].map(r => `<button data-va="${r}" class="${S.viewAs === r ? 'go' : ''}">${esc(ROLES[r] || r)}</button>`).join('')}${S.testMode ? '<button data-va="">Leave test mode</button>' : ''}</div><div class="act"><button id="vaX">Close</button></div>`); $('vaX').onclick = closeModal; $('mbox').querySelectorAll('[data-va]').forEach(b => b.onclick = () => { closeModal(); b.dataset.va ? enterTestMode(b.dataset.va) : leaveTestMode(); }); }); on('mHelp', helpDialog); on('mAI', () => Admin.aiSettings()); on('mProj', showProjects); on('mOut', () => S.store.signOut()); $('mX').onclick = closeModal;
}

/* ================================================================ wiring */
function wire() {
  PV = new PlanView($('vp'), { onPlace, onPinTap: id => { const d = S.defects.find(x => x.id === id); if (d) { S.sel = id; render(); openEditor(d); } } });
  Admin.init({ PV, render, reloadProject, showProjects, openProject, showPlan, setTab, filtered, planViews, VIEW_TYPES, pickPoint, stopPlacing });
  FM.init({ render, getBytes });
  [['q', 'q', 'input'], ['fBlock', 'block', 'change'], ['fLevel', 'level', 'change'], ['fUnit', 'unit', 'change'], ['fSev', 'sev', 'change'], ['fTrade', 'trade', 'change'], ['fResp', 'resp', 'change'], ['sort', 'sort', 'change']].forEach(([id, k, ev]) => $(id).addEventListener(ev, e => { S.F[k] = e.target.value; render(); }));
  $('bSel').onclick = bulkToggle; $('bulkX').onclick = bulkToggle; $('bulkbar').querySelectorAll('[data-b]').forEach(x => x.onclick = () => bulkAction(x.dataset.b));
  $('clr').onclick = () => { Object.assign(S.F, { q: '', block: '', level: '', unit: '', sev: '', trade: '', resp: '', review: false, toReview: false }); S.F.status = new Set(['Open', 'In progress', 'Ready for review', 'Disputed']); $('q').value = ''; filtersDirty = true; render(); };
  $('wBack').onclick = showProjects; $('pOut').onclick = () => S.store.signOut();
  $('bNew').onclick = async () => openEditor(await newDefect(), true, true);
  $('fab').onclick = newDefectChooser;
  $('fAttach').onchange = async e => { const fs = [...e.target.files]; e.target.value = ''; await addFiles(fs); };
  async function addFilesImpl(fs) { if (!ED) return; for (const f of fs) { if (f.size > 19 * 1024 * 1024) { toast(f.name + ' is over 19 MB'); continue; } const data = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); }); (ED.d.files = ED.d.files || []).push({ id: uid(), name: f.name, mime: f.type || 'application/octet-stream', data, t: new Date().toISOString(), by: S.user.name, isNew: true }); } collect(); openEditor(ED.d, ED.isNew, true); toast(fs.length + ' file' + (fs.length > 1 ? 's' : '') + ' attached; Save to keep'); }
  addFilesRef = addFilesImpl;
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
  initDrop({ Admin, FM, addPhotos, addFiles, editorOpen: () => !!ED && $('sheet').classList.contains('show') });
}
// Quick-pick a typical defect: fills title, description, action, trade, type, severity and element; keeps location and photos.
// One-tap workflow: the responsible party marks it ready; the raiser (or an admin/editor) accepts or sends it back.
function workflowBar(w, con) {
  const mine = w.createdBy === S.user.email, reviewer = !con && (mine || can.edit());
  const b = [];
  if (w.status !== 'Closed' && w.status !== 'Ready for review') b.push('<button class="go" id="wfReady">✅ Ready for inspection</button>');
  if (w.status === 'Open') b.push('<button id="wfProg">🔧 In progress</button>');
  if (w.status === 'Ready for review' && reviewer) b.push('<button class="go" id="wfAccept">✔ Accept and close</button><button class="warn" id="wfReopen">↩ Reopen and send back</button>');
  if (w.status === 'Ready for review' && !reviewer) return '<p class="note">Marked ready for inspection; waiting for ' + esc(w.createdBy || 'the project team') + ' to review.</p>';
  return b.length ? '<div class="wf">' + b.join('') + '</div>' : '';
}
function typicalPicker() {
  const list = typicalList(S.project); const cur = collect(); const room = (cur.room || '').toLowerCase();
  const draw = q => { q = (q || '').toLowerCase(); const L = list.filter(x => !q || (x.t + ' ' + x.d + ' ' + x.tr + ' ' + (x.el || '')).toLowerCase().includes(q)); const rank = x => (room && x.r && room.includes(x.r.toLowerCase())) ? 0 : 1; L.sort((a, b) => rank(a) - rank(b) || a.tr.localeCompare(b.tr));
    const tag = x => x.used ? `used ${x.used}× on this project` : x.src === 'library' ? 'Resero library' : x.src === 'project' ? 'this project' : '';
    $('tpList').innerHTML = L.length ? L.map((x, i) => `<button class="tp" data-i="${list.indexOf(x)}"><b>${esc(x.t)}</b><small>${esc(x.tr)} · ${esc(x.s)}${tag(x) ? ' · ' + esc(tag(x)) : ''}</small></button>`).join('') : '<p class="muted">Nothing matches. Type it in the title instead.</p>';
    $('tpList').querySelectorAll('.tp').forEach(b => b.onclick = () => { const x = list[+b.dataset.i]; const body = $('edBody'), set = (n, v) => { const el = body.querySelector(`[name=${n}]`); if (!el || v == null) return; if (el.tagName === 'SELECT' && ![...el.options].some(o => o.value === v)) { const o = document.createElement('option'); o.textContent = v; el.appendChild(o); } el.value = v; el.classList.add('aifill'); };
      set('title', x.t); set('desc', x.d); set('action', x.a); set('trade', x.tr); set('type', x.ty); set('severity', x.s); set('element', x.el); if (x.r && !cur.room) set('room', x.r); collect(); Nav.refit(body); closeModal(); toast('Filled from typical defect; adjust as needed'); }); };
  modal(`<h2>Typical defects</h2><input id="tpQ" placeholder="Search, e.g. paint, door, sealant" style="width:100%;margin-bottom:8px"><div class="btnlist" id="tpList" style="max-height:55vh;overflow:auto"></div><p class="note">Titles used two or more times on this project appear here automatically. ${cur.title ? '<a href="#" id="tpAdd">Save the current defect as a typical for all Resero projects</a>' : ''}</p><div class="act"><button id="tpX">Close</button></div>`);
  $('tpX').onclick = closeModal;
  if ($('tpAdd')) $('tpAdd').onclick = async ev => { ev.preventDefault(); const t = templateFrom(cur); try { await S.store.addToLibrary('typicals', t); (S.lib = S.lib || []).push(t); toast('Added "' + t.t + '" to the Resero typical defects library'); draw($('tpQ').value); } catch (e) { toast('Could not save to the library: ' + e.message, 5000); } }; $('tpQ').oninput = e => draw(e.target.value); draw(''); setTimeout(() => $('tpQ').focus(), 50);
}
let addFilesRef = null;
export async function addFiles(fs) { if (addFilesRef) return addFilesRef(fs); }
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
