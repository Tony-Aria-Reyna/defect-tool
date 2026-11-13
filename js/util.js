// Small shared helpers.
export const $ = id => document.getElementById(id);
export const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
export const todayISO = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
export const nzDate = s => { if (!s) return ''; const d = new Date(s.length <= 10 ? s + 'T00:00' : s); return isNaN(d) ? s : d.toLocaleDateString('en-NZ', { day: '2-digit', month: 'short', year: 'numeric' }); };
export const nzDT = s => { const d = new Date(s); return isNaN(d) ? s : d.toLocaleString('en-NZ', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); };
export const stamp = () => { const d = new Date(); return String(d.getDate()).padStart(2, '0') + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + d.getFullYear(); };
export const isMobile = () => matchMedia('(max-width:820px)').matches;
export const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });
export const safeName = s => String(s || '').replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();

let toastT;
export function toast(m, ms) { const t = $('toast'); t.textContent = m; t.style.display = 'block'; clearTimeout(toastT); toastT = setTimeout(() => t.style.display = 'none', ms || 2800); }
import * as Nav from './nav.js';
let MODAL = { back: null, snap: null };
const mFields = () => [...$('mbox').querySelectorAll('input,select,textarea')].map(e => (e.type === 'checkbox' || e.type === 'radio') ? (e.checked ? '1' : '0') : e.value).join('\u0001');
// opts.back: a function that reopens the window this one came from, shown as a Back button in the heading
export function modal(html, wide, opts = {}) {
  const b = $('mbox'); b.innerHTML = html; b.classList.toggle('wide', !!wide);
  MODAL.back = opts.back || null; MODAL.snap = null;
  if (MODAL.back) { const bar = document.createElement('div'); bar.className = 'mnav'; bar.innerHTML = '<button class="mback" id="mBack">‹ Back</button>'; b.insertBefore(bar, b.firstChild); bar.querySelector('button').onclick = () => { const f = MODAL.back; closeModal(); f && f(); }; }
  if (!$('modal').classList.contains('show')) Nav.open('modal', () => $('modal').classList.remove('show'));
  $('modal').classList.add('show');
  requestAnimationFrame(() => { MODAL.snap = mFields(); });
  return b;
}
export function closeModal() { $('modal').classList.remove('show'); MODAL = { back: null, snap: null }; Nav.closed('modal'); }
// Closing by tapping outside or pressing Escape: anything typed is checked first, so a stray tap cannot lose it.
export async function dismissModal() {
  if (MODAL.snap != null && mFields() !== MODAL.snap) { if (!(await askDiscard())) return false; }
  closeModal(); return true;
}
function askDiscard() {
  return new Promise(res => {
    const d = document.createElement('div'); d.className = 'askov';
    d.innerHTML = '<div><b>Discard what you have filled in?</b><p>You tapped outside the window. Nothing has been saved yet.</p><div class="act"><button class="go" id="akKeep">Keep editing</button><button class="warn" id="akGo">Discard</button></div></div>';
    document.body.appendChild(d);
    const done = v => { d.remove(); res(v); };
    d.querySelector('#akKeep').onclick = () => done(false); d.querySelector('#akGo').onclick = () => done(true);
    d.addEventListener('click', e => { if (e.target === d) done(false); });
  });
}
export function busy(msg) { const b = $('busy'); b.querySelector('span').textContent = msg; b.classList.add('show'); return { set: m => b.querySelector('span').textContent = m, done: () => b.classList.remove('show') }; }
export function confirmBox(msg, okLabel) {
  return new Promise(res => {
    modal(`<h2>Please confirm</h2><p>${esc(msg)}</p><div class="act"><button id="cfN">Cancel</button><button class="go" id="cfY">${esc(okLabel || 'OK')}</button></div>`);
    $('cfN').onclick = () => { closeModal(); res(false); }; $('cfY').onclick = () => { closeModal(); res(true); };
  });
}
export function opts(arr, v, blank) { return (blank ? '<option value=""></option>' : '') + arr.map(a => `<option ${a === v ? 'selected' : ''}>${esc(a)}</option>`).join('') + (v && !arr.includes(v) ? `<option selected>${esc(v)}</option>` : ''); }

// Image helpers
export function loadImage(src) { return new Promise((res, rej) => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => res(im); im.onerror = rej; im.src = src; }); }
export async function fileToDataUrl(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); }); }
export async function compressImage(src, max = 1600, q = 0.8) {
  const im = await loadImage(typeof src === 'string' ? src : await fileToDataUrl(src));
  const s = Math.min(1, max / Math.max(im.width, im.height));
  const c = document.createElement('canvas'); c.width = Math.round(im.width * s); c.height = Math.round(im.height * s);
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0, c.width, c.height);
  return { dataUrl: c.toDataURL('image/jpeg', q), w: c.width, h: c.height };
}
export function dataUrlToBlob(u) { const [h, b] = u.split(','); const m = /data:([^;]+)/.exec(h)[1]; const s = atob(b); const a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return new Blob([a], { type: m }); }
export async function urlToDataUrl(u) { if (u.startsWith('data:')) return u; const r = await fetch(u); const b = await r.blob(); return fileToDataUrl(b); }

// Library loader (vendored copies in /lib, so it works offline once installed)
export function loadScript(u) { return new Promise((res, rej) => { if (document.querySelector(`script[data-src="${u}"]`)) return res(); const s = document.createElement('script'); s.src = u; s.dataset.src = u; s.onload = res; s.onerror = () => rej(new Error('Could not load ' + u)); document.head.appendChild(s); }); }

// Delivery: download on desktop, Share / Save on phones (as in the Site Plan Builder)
export function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000); }
// Save a photo to the phone or computer. Photos held in storage are fetched as a file first; if that is blocked, the photo opens in a new tab to save from there.
export async function saveImage(src, name) {
  if (!src) return; let blob = null;
  try { blob = src.startsWith('data:') ? await (await fetch(src)).blob() : await (await fetch(src, { mode: 'cors' })).blob(); } catch (e) {}
  if (!blob) { window.open(src, '_blank'); toast('Opened the photo in a new tab. Press and hold it (or right-click) to save it.', 5000); return; }
  const ext = /png/.test(blob.type) ? 'png' : 'jpg'; deliver(blob, safeFile(name) + '.' + ext, 'Photo');
}
const safeFile = n => String(n || 'photo').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'photo';
export function deliver(blob, name, what) {
  if (!isMobile()) { download(blob, name); toast(what + ' saved to Downloads'); return; }
  let file = null, can = false; try { file = new File([blob], name, { type: blob.type }); can = !!(navigator.canShare && navigator.canShare({ files: [file] })); } catch (e) {}
  const box = $('done'); box.innerHTML = `<div class="m"><b>${esc(what)} ready.</b></div>`;
  const btn = (l, c, fn) => { const b = document.createElement('button'); b.textContent = l; if (c) b.className = c; b.onclick = fn; box.appendChild(b); };
  if (can) btn('Share / send', 'go', () => navigator.share({ files: [file], title: name }).then(() => box.classList.remove('show'), e => { if (!e || e.name !== 'AbortError') { download(blob, name); box.classList.remove('show'); } }));
  btn('Save to phone', can ? '' : 'go', () => { download(blob, name); box.classList.remove('show'); }); btn('Close', '', () => box.classList.remove('show')); box.classList.add('show');
}

// Geometry for room boundaries (points are 0..1 of the plan width / height)
export function pointInPoly(x, y, poly, aspect) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
export function polyArea(poly) { let a = 0; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j][0] + poly[i][0]) * (poly[j][1] - poly[i][1]); return Math.abs(a / 2); }
export function centroid(poly) { let x = 0, y = 0; poly.forEach(p => { x += p[0]; y += p[1]; }); return [x / poly.length, y / poly.length]; }
// Zones: {id, kind:'unit'|'room'|'area', name, unit, block, level, poly}. The room is the smallest room or
// common-area boundary containing the point; the unit comes from the smallest boundary that carries a unit number.
export function locate(zones, x, y) {
  const hits = (zones || []).filter(z => z.poly && z.poly.length > 2 && pointInPoly(x, y, z.poly)).sort((a, b) => polyArea(a.poly) - polyArea(b.poly));
  if (!hits.length) return null;
  const item = hits.find(z => z.kind === 'item' && z.name), room = hits.find(z => (z.kind === 'room' || z.kind === 'area') && z.name), withUnit = hits.find(z => z.unit);
  return { zone: hits[0], item: item ? item.name : '', room: room ? room.name : '', unit: withUnit ? String(withUnit.unit) : '', block: (hits.find(z => z.block) || {}).block || '', level: (hits.find(z => z.level) || {}).level || '' };
}
