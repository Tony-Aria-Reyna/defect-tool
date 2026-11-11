// Install prompt: nudge everyone to put the app on their home screen (keeps sign-in, works offline).
import { $, modal, closeModal, toast } from './util.js';
import { S, saveLocal } from './state.js';
let deferred = null;
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const ios = () => /iPhone|iPad|iPod/.test(navigator.userAgent) && !window.MSStream;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; });
window.addEventListener('appinstalled', () => { deferred = null; S.local.installNag = 'done'; saveLocal(); toast('Installed. Open Resero Defects from your home screen from now on.', 5000); });
export function installDialog(auto) {
  const how = ios()
    ? '<ol><li>Tap the <b>Share</b> button (square with an arrow) at the bottom of Safari.</li><li>Scroll and tap <b>Add to Home Screen</b>.</li><li>Tap <b>Add</b>.</li></ol><p class="note">Dictation works best in Chrome on Android; on iPhone type or take photos.</p>'
    : deferred ? '<p>Tap <b>Install</b> below. It takes a few seconds.</p>'
    : '<ol><li>Open this page in <b>Chrome</b>.</li><li>Tap the three dots (top right).</li><li>Tap <b>Add to Home screen</b> or <b>Install app</b>, then <b>Install</b>.</li></ol>';
  modal(`<h2>Put Resero Defects on your phone</h2>
  <p>Install it once and it stays signed in, opens full screen, keeps plans and defects when there is no signal, and the camera and microphone are remembered.</p>${how}
  <div class="act">${auto ? '<button id="inLater">Remind me later</button><button id="inNever">Don\'t ask again</button>' : '<button id="inX">Close</button>'}${!ios() && deferred ? '<button class="go" id="inGo">Install</button>' : ''}</div>`);
  const done = v => { S.local.installNag = v; saveLocal(); closeModal(); };
  if ($('inLater')) $('inLater').onclick = () => done(Date.now());
  if ($('inNever')) $('inNever').onclick = () => done('done');
  if ($('inX')) $('inX').onclick = closeModal;
  if ($('inGo')) $('inGo').onclick = async () => { const p = deferred; deferred = null; p.prompt(); const r = await p.userChoice; if (r.outcome !== 'accepted') { S.local.installNag = Date.now(); saveLocal(); } closeModal(); };
}
// Called after sign-in. Shows once, then again every 3 days until installed or declined for good.
export function maybeNag() {
  if (standalone()) return; const n = S.local.installNag; if (n === 'done') return;
  if (typeof n === 'number' && Date.now() - n < 3 * 864e5) return;
  const mobile = /Android|iPhone|iPad|iPod/.test(navigator.userAgent); if (!mobile) return;
  setTimeout(() => installDialog(true), 1200);
}
export const canInstall = () => !standalone();
