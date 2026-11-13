// A 15-minute try-out for real users, run on a throwaway copy of the project, followed by a short feedback form.
// Feedback is saved to the live project (collection "feedback") where the project admins can read and export it.
import { S, can } from './state.js';
import { $, esc, toast, modal, closeModal, uid, isMobile, deliver, safeName, stamp, nzDT } from './util.js';
import { APP, ROLES } from './config.js';

let X = {};
export function init(ctx) { X = ctx; }

const RAISE = [
  ['Find something with Search', 'Tap the magnifying glass at the top and type a unit number, an item number or a word. Spell it badly on purpose. Open one of the results.'],
  ['Move around the plans', 'Open Plans, switch block and level, switch between Floor, Wall and Ceiling if they are loaded, and tap a pin.'],
  ['Raise a new defect', 'Tap the round + button. Step 1 pin it on the plan, step 2 add a photo, step 3 hold the microphone and say what is wrong (or type it). Save.'],
  ['Raise a general defect', 'Start another one, choose "General defect (no single place)", add a title and save.'],
  ['Move a pin', 'On the plan, press and hold a pin, drag it into another room and watch the black tag. Let go.'],
  ['Work on an existing item', 'Open any item. Add a photo, then tap Comment and write one. Press and hold a photo to see it large. Swipe left or right to move to the next item.'],
  ['Review the contractor\'s work', 'Open an item that is Ready for review. Accept and close it, or Reopen it with a comment. Then read the History at the bottom.'],
  ['Filter the list', 'On the list, open Filters, pick a unit or a trade, then remove the yellow chip.'],
  ['Export', 'Tap Export and make a PDF of what is on the list.'],
];
const TASKS = {
  admin: [...RAISE, ['Find a setting', 'Use Search to find "invite" and "summary email". Check each one takes you to the right place.'], ['Set-up checklist', 'Menu > Set-up checklist. Is it clear what a new project still needs?']],
  editor: RAISE,
  contractor: [
    ['Find your items', 'Tap the magnifying glass and type an item number, a unit, or your subcontractor\'s name. Open one of the results.'],
    ['See it on the plan', 'On the list, tap the small plan picture under a photo to see where the item is, or press and hold it for a quick look. Then open Plans, switch block and level, and tap a pin.'],
    ['Look at the photos', 'Tap the camera count on the corner of a photo to open the photos. Press and hold a photo to see it large.'],
    ['Respond to an item', 'Open an open item and read the latest comment at the top. Tap "Ready for inspection", add a photo of the finished work and say or type what was done.'],
    ['Raise your own item', 'Tap the + button. Drop a pin, add a photo and say what is wrong. Save it, then open it again and change the title: items you raised are yours to edit.'],
    ['Close one of your own', 'If an item from your own register shows "Complete and close", use it. If none do, mark this step "Not for me".'],
    ['Set the subcontractor', 'Open an item and choose or type the subcontractor. Save. Then filter the list by that subcontractor.'],
    ['Read the history', 'Open an item that has been reopened or closed and read the History. Is it clear what changed and who did it?'],
  ],
  viewer: [
    ['Find something with Search', 'Tap the magnifying glass and type a unit, an item number or a word. Open one of the results.'],
    ['Move around the plans', 'Open Plans, switch block and level, and tap a pin.'],
    ['Read an item', 'Open an item. Look at the photos (press and hold one), the description and the History.'],
    ['Filter the list', 'Open Filters, pick a unit or a trade, then remove the yellow chip.'],
    ['Export', 'Tap Export and make a PDF of what is on the list.'],
  ],
};
const roleKey = r => TASKS[r] ? r : 'viewer';
const st = () => (S.local.tryit = S.local.tryit || { role: '', r: {}, n: {} });
const save = () => X.saveLocal && X.saveLocal();
const realStore = () => S.realStore || S.store;

export function start() {
  const mine = S.testMode ? S.viewAs : S.role, admin = can.realAdmin();
  modal(`<h2>15-minute try-out</h2><p>A short list of things to try, on a <b>practice copy</b> of ${esc(S.project.name)}. Nothing you do in practice mode is saved or seen by anyone, so press every button.</p>
  <p class="note">At the end there are five quick questions. Your answers go to the project team and are the only thing that is kept.</p>
  ${admin ? `<label class="f">Try it as<select id="tyRole">${['admin', 'editor', 'contractor', 'viewer'].map(r => `<option value="${r}" ${r === roleKey(mine) ? 'selected' : ''}>${esc(ROLES[r] || r)} (${TASKS[r].length} steps)</option>`).join('')}</select></label>` : `<p class="note">You are ${esc(ROLES[mine] || mine)} on this project: ${TASKS[roleKey(mine)].length} steps.</p>`}
  <div class="act"><button id="tyX">Not now</button>${st().role ? '<button id="tyRes">Carry on where I left off</button>' : ''}<button class="go" id="tyGo">Start practice mode</button></div>`);
  $('tyX').onclick = closeModal;
  if ($('tyRes')) $('tyRes').onclick = async () => { closeModal(); if (!S.testMode) await X.enterTestMode(st().role); chip(); sheet(); };
  $('tyGo').onclick = async () => { const role = admin ? $('tyRole').value : roleKey(mine); S.local.tryit = { role, r: {}, n: {}, t0: Date.now() }; save(); closeModal(); if (!S.testMode || S.viewAs !== role) await X.enterTestMode(role); chip(); sheet(); };
}

export const active = () => { const s = S.local.tryit; return !!(s && s.role && !s.sent); };
export const count = () => { const s = st(), L = TASKS[roleKey(s.role)]; return L.filter((_, i) => s.r[i]).length + '/' + L.length; };
export const openSteps = () => S.testMode ? sheet() : start();
let barBusy = false;
// floating button that reopens the step list while the person is trying things; the red practice bar carries the same link
export function chip() {
  if (X.bar && S.testMode && !barBusy) { barBusy = true; try { X.bar(); } finally { barBusy = false; } }
  let c = $('tryChip'); const s = S.local.tryit;
  if (!s || !s.role || s.sent) { if (c) c.remove(); return; }
  if (!c) { c = document.createElement('button'); c.id = 'tryChip'; c.className = 'trychip'; document.body.appendChild(c); c.onclick = () => S.testMode ? sheet() : start(); }
  const L = TASKS[roleKey(s.role)], n = L.filter((_, i) => s.r[i]).length; c.innerHTML = `🧪 Try-out steps <b>${n}/${L.length}</b>`;
}
function sheet() {
  const s = st(), L = TASKS[roleKey(s.role)], n = L.filter((_, i) => s.r[i]).length, next = L.findIndex((_, i) => !s.r[i]);
  modal(`<h2>Try-out: ${esc(ROLES[s.role] || s.role)}</h2><p class="note">${n} of ${L.length} done. Close this, try the step, then come back to mark it: tap the purple <b>🧪 Try-out steps</b> button (bottom left) or <b>Steps</b> in the red bar at the top.</p>
  <div class="trylist">${L.map((t, i) => `<div class="try ${s.r[i] || ''} ${i === next ? 'next' : ''}"><div class="trh"><span class="ckn">${s.r[i] === 'ok' ? '✓' : s.r[i] === 'stuck' ? '!' : s.r[i] === 'na' ? '–' : i + 1}</span><b>${esc(t[0])}</b></div><p>${esc(t[1])}</p><div class="trb"><button data-r="ok" data-i="${i}" class="${s.r[i] === 'ok' ? 'on' : ''}">👍 Easy</button><button data-r="stuck" data-i="${i}" class="${s.r[i] === 'stuck' ? 'on' : ''}">😕 Got stuck</button><button data-r="na" data-i="${i}" class="${s.r[i] === 'na' ? 'on' : ''}">Not for me</button></div>${s.r[i] === 'stuck' ? `<textarea data-n="${i}" rows="2" placeholder="What happened? What did you expect?">${esc(s.n[i] || '')}</textarea>` : ''}</div>`).join('')}</div>
  <div class="act"><button id="tsX">Close and keep trying</button><button class="${n === L.length ? 'go' : ''}" id="tsEnd">${n === L.length ? 'Finish: five quick questions' : 'Finish early'}</button></div>`, true);
  const keep = () => $('mbox').querySelectorAll('[data-n]').forEach(t => { s.n[+t.dataset.n] = t.value.trim(); });
  $('mbox').querySelectorAll('[data-r]').forEach(b => b.onclick = () => { keep(); const i = +b.dataset.i; s.r[i] = s.r[i] === b.dataset.r ? '' : b.dataset.r; save(); chip(); sheet(); });
  $('tsX').onclick = () => { keep(); save(); closeModal(); };
  $('tsEnd').onclick = () => { keep(); save(); closeModal(); feedback(true); };
  const nx = $('mbox').querySelector('.try.next'); if (nx) nx.scrollIntoView({ block: 'center' });
}

// The feedback form. Also used on its own from the menu, without the try-out.
export function feedback(fromTry) {
  const s = fromTry ? st() : null, L = s ? TASKS[roleKey(s.role)] : [];
  const scale = (id, lo, hi) => `<div class="fbscale" id="${id}">${[1, 2, 3, 4, 5].map(v => `<button data-v="${v}">${v}</button>`).join('')}</div><div class="fbends"><span>${lo}</span><span>${hi}</span></div>`;
  modal(`<h2>${fromTry ? 'Five quick questions' : 'Send feedback'}</h2>
  <label class="f">1. How easy was it to use?</label>${scale('fbEase', 'Hard', 'Easy')}
  <label class="f">2. Would you use it on site?<select id="fbUse"><option value="">Choose…</option><option>Yes</option><option>Yes, with changes</option><option>Not sure</option><option>No</option></select></label>
  <label class="f">3. What worked well?<textarea id="fbGood" rows="2"></textarea></label>
  <label class="f">4. What was confusing, slow or annoying?<textarea id="fbBad" rows="3"></textarea></label>
  <label class="f">5. What is missing for your job?<textarea id="fbMiss" rows="2"></textarea></label>
  <p class="note small">Sent with your name, role, the app version and whether you were on a phone or a computer.</p><p class="note" id="fbSt"></p>
  <div class="act"><button id="fbX">Cancel</button><button class="go" id="fbGo">Send</button></div>`, true);
  let ease = 0; $('fbEase').querySelectorAll('button').forEach(b => b.onclick = () => { ease = +b.dataset.v; $('fbEase').querySelectorAll('button').forEach(x => x.classList.toggle('on', +x.dataset.v <= ease)); });
  $('fbX').onclick = closeModal;
  $('fbGo').onclick = async () => {
    const u = S.realUser || S.user, rec = { id: uid(), t: new Date().toISOString(), by: u.name || '', email: u.email || '', role: s ? s.role : S.role, tried: !!fromTry, mins: s && s.t0 ? Math.round((Date.now() - s.t0) / 60000) : null, device: isMobile() ? 'phone' : 'computer', version: APP.version, ease, use: $('fbUse').value, good: $('fbGood').value.trim(), bad: $('fbBad').value.trim(), missing: $('fbMiss').value.trim(), steps: L.map((t, i) => ({ step: t[0], result: s.r[i] || 'not tried', note: s.n[i] || '' })) };
    if (!ease && !rec.good && !rec.bad && !rec.missing) { toast('Answer at least one question first'); return; }
    $('fbGo').disabled = true; $('fbSt').textContent = 'Sending…';
    try { await realStore().saveItem(S.project.id, 'feedback', rec); if (s) { s.sent = true; save(); chip(); } closeModal(); toast('Thank you. Your feedback has gone to the project team.', 5000); if (fromTry && S.testMode && X.leaveTestMode) X.leaveTestMode(); }
    catch (e) { $('fbGo').disabled = false; $('fbSt').innerHTML = 'Could not send from here (' + esc(e.message) + '). <a href="#" id="fbCopy">Copy my answers</a> and send them to the project team another way.'; $('fbCopy').onclick = async ev => { ev.preventDefault(); try { await navigator.clipboard.writeText(text(rec)); toast('Copied'); } catch (x) { toast('Could not copy'); } }; }
  };
}
const text = r => [`Resero Defects feedback from ${r.by} (${r.role}, ${r.device}, v${r.version})`, `Ease: ${r.ease || '-'}/5 · Would use on site: ${r.use || '-'}`, `Worked well: ${r.good || '-'}`, `Confusing: ${r.bad || '-'}`, `Missing: ${r.missing || '-'}`, ...(r.steps || []).filter(x => x.result !== 'ok').map(x => `${x.step}: ${x.result}${x.note ? ' · ' + x.note : ''}`)].join('\n');

// Admin view of what has come in.
export async function results() {
  modal(`<h2>Feedback received</h2><div id="frB"><p class="note">Loading…</p></div><div class="act"><button id="frX">Close</button><button id="frCsv">Download as a spreadsheet</button></div>`, true);
  $('frX').onclick = closeModal;
  const L = await new Promise(res => { let off = null, done = false; const fin = x => { if (done) return; done = true; setTimeout(() => off && off(), 0); res(x); }; off = realStore().watchColl(S.project.id, 'feedback', fin, () => fin(null)); setTimeout(() => fin(null), 8000); });
  if (!$('frB')) return;
  if (!L) { $('frB').innerHTML = '<p class="note" style="color:#a32222">Could not read the feedback. Only project admins can.</p>'; return; }
  L.sort((a, b) => String(b.t).localeCompare(String(a.t)));
  const rated = L.filter(r => r.ease), avg = rated.length ? (rated.reduce((a, r) => a + r.ease, 0) / rated.length).toFixed(1) : '-', stuck = {};
  L.forEach(r => (r.steps || []).forEach(x => { if (x.result === 'stuck') stuck[x.step] = (stuck[x.step] || 0) + 1; }));
  const top = Object.entries(stuck).sort((a, b) => b[1] - a[1]);
  $('frB').innerHTML = !L.length ? `<p class="note">Nothing yet. Send people this link and ask them to do the try-out:</p><p class="codebox">${esc(link())}</p><div class="act" style="justify-content:flex-start"><button id="frCopy">Copy the link</button></div>`
    : `<div class="frsum"><div><b>${L.length}</b><span>responses</span></div><div><b>${avg}</b><span>ease out of 5</span></div><div><b>${L.filter(r => /^Yes/.test(r.use || '')).length}</b><span>would use it</span></div></div>
    ${top.length ? `<h3 class="sec">Where people got stuck</h3>${top.map(([k, v]) => `<div class="frrow"><b>${v}</b> ${esc(k)}</div>`).join('')}` : ''}
    <h3 class="sec">Responses</h3>${L.map(r => `<details class="ext"><summary>${esc(r.by || r.email || 'Someone')} · ${esc(ROLES[r.role] || r.role || '')} · ${r.ease ? r.ease + '/5' : 'no score'} · ${esc(r.device || '')} <span class="muted small">${esc(nzDT(r.t))}</span></summary>${[['Would use on site', r.use], ['Worked well', r.good], ['Confusing', r.bad], ['Missing', r.missing]].filter(x => x[1]).map(x => `<p><b>${x[0]}:</b> ${esc(x[1])}</p>`).join('')}${(r.steps || []).filter(x => x.result === 'stuck').map(x => `<p>😕 <b>${esc(x.step)}</b>${x.note ? ': ' + esc(x.note) : ''}</p>`).join('')}<p class="muted small">v${esc(r.version || '')}${r.mins != null ? ' · ' + r.mins + ' min' : ''}${r.tried ? ' · did the try-out' : ''}</p></details>`).join('')}
    <p class="note small">Try-out link to send people: <span class="codebox">${esc(link())}</span> <a href="#" id="frCopy">Copy</a></p>`;
  if ($('frCopy')) $('frCopy').onclick = async e => { e.preventDefault(); try { await navigator.clipboard.writeText(link()); toast('Link copied'); } catch (x) { toast('Could not copy'); } };
  $('frCsv').onclick = () => { const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; const rows = [['When', 'Name', 'Email', 'Role', 'Device', 'Version', 'Ease (1-5)', 'Would use on site', 'Worked well', 'Confusing', 'Missing', 'Stuck on', 'Minutes'], ...L.map(r => [nzDT(r.t), r.by, r.email, r.role, r.device, r.version, r.ease || '', r.use, r.good, r.bad, r.missing, (r.steps || []).filter(x => x.result === 'stuck').map(x => x.step + (x.note ? ' (' + x.note + ')' : '')).join('; '), r.mins == null ? '' : r.mins])]; deliver(new Blob(['﻿' + rows.map(r => r.map(q).join(',')).join('\r\n')], { type: 'text/csv' }), `${safeName(S.project.name)} - app feedback - ${stamp()}.csv`, 'Feedback'); };
}
export const link = () => location.origin + location.pathname + '#tryit';
