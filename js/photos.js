// Photos: upload with an offline outbox, and markup (pen / arrow / circle).
import { S } from './state.js';
import { $, uid, compressImage, dataUrlToBlob, loadImage, toast } from './util.js';
import * as Nav from './nav.js';

/* ---- outbox: photos taken with no signal are kept on the device and uploaded later ---- */
let obdb;
function ob() { return obdb || (obdb = new Promise((res, rej) => { const r = indexedDB.open('resero-defects-outbox', 1); r.onupgradeneeded = () => r.result.createObjectStore('q'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); })); }
const rq = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
async function obPut(k, v) { const d = await ob(); return rq(d.transaction('q', 'readwrite').objectStore('q').put(v, k)); }
async function obDel(k) { const d = await ob(); return rq(d.transaction('q', 'readwrite').objectStore('q').delete(k)); }
async function obAll() { const d = await ob(); const os = d.transaction('q').objectStore('q'); const [k, v] = await Promise.all([rq(os.getAllKeys()), rq(os.getAll())]); return k.map((key, i) => ({ key, ...v[i] })); }
const localUrls = {};
export async function pendingUrl(photoId) { if (localUrls[photoId]) return localUrls[photoId]; const all = await obAll(); const it = all.find(x => x.photoId === photoId); return it ? (localUrls[photoId] = it.dataUrl) : ''; }

export async function newPhoto(file) { const c = await compressImage(file, 1280, 0.72); return { id: uid(), data: c.dataUrl, t: new Date().toISOString(), by: S.user.name, isNew: true }; }

// Upload the new photos of a defect being saved. Returns the photo list to store.
export async function uploadPhotos(pid, defectId, photos) {
  const out = [];
  for (const p of photos) {
    if (!p.data) { out.push(p); continue; }
    const path = `projects/${pid}/photos/${defectId}/${p.id}.jpg`;
    const rec = { id: p.id, path, t: p.t, by: p.by };
    try { rec.url = await S.store.putFile(path, dataUrlToBlob(p.data)); }
    catch (e) { if (S.testMode) { rec.url = p.data; out.push(rec); continue; } rec.pending = true; localUrls[p.id] = p.data; await obPut(p.id, { pid, defectId, photoId: p.id, path, dataUrl: p.data }); }
    if (p.replaces) rec.replaces = p.replaces;
    out.push(rec);
  }
  // remove files replaced by a marked-up copy
  for (const p of out) if (p.replaces) { const old = p.replaces; delete p.replaces; S.store.deleteFile(old).catch(() => {}); }
  return out;
}
let flushing = false;
// Attachments (PDFs and other files) use the same outbox.
export async function uploadFiles(pid, defectId, files) {
  const out = [];
  for (const f of files) {
    if (!f.data) { out.push(f); continue; }
    const ext = (f.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, ''), path = `projects/${pid}/photos/${defectId}/${f.id}.${ext}`;
    const rec = { id: f.id, name: f.name, mime: f.mime, path, t: f.t, by: f.by };
    try { rec.url = await S.store.putFile(path, dataUrlToBlob(f.data)); }
    catch (e) { if (S.testMode) { rec.url = f.data; out.push(rec); continue; } rec.pending = true; await obPut(f.id, { kind: 'file', pid, defectId, photoId: f.id, path, dataUrl: f.data }); }
    out.push(rec);
  }
  return out;
}
export async function flushOutbox() {
  if (flushing || !navigator.onLine || S.testMode) return; flushing = true;
  try {
    for (const it of await obAll()) {
      try {
        const url = await S.store.putFile(it.path, dataUrlToBlob(it.dataUrl), true);
        const d = S.project && S.project.id === it.pid ? S.defects.find(x => x.id === it.defectId) : null;
        if (d && it.kind === 'file') { const files = (d.files || []).map(p => p.id === it.photoId ? { ...p, url, pending: false } : p); await S.store.updateDefect(it.pid, it.defectId, { files, updated: new Date().toISOString() }); await obDel(it.key); }
        else if (d) { const photos = (d.photos || []).map(p => p.id === it.photoId ? { id: p.id, path: p.path, t: p.t, by: p.by, url } : p); await S.store.updateDefect(it.pid, it.defectId, { photos, updated: new Date().toISOString() }); await obDel(it.key); }
        else if (!S.project || S.project.id !== it.pid) { /* keep until that project is open */ }
        else await obDel(it.key);   // defect no longer exists
      } catch (e) { console.warn('outbox', e); }
    }
  } finally { flushing = false; }
}
export async function outboxCount() { try { return (await obAll()).length; } catch (e) { return 0; } }

/* ---- markup ---- */
let MK = null;
export async function markup(src, onSave) {
  let im; try { im = await loadImage(src); } catch (e) { toast('This photo cannot be marked up until the storage CORS setting is in place (see README).', 5000); return; }
  const c = $('mkc'); c.width = im.width; c.height = im.height;
  try { c.getContext('2d').drawImage(im, 0, 0); c.toDataURL(); } catch (e) { toast('This photo cannot be marked up until the storage CORS setting is in place (see README).', 5000); return; }
  MK = { im, strokes: [], tool: 'pen', cur: null, sel: null, onSave }; document.querySelectorAll('#mk [data-tool]').forEach(x => x.classList.toggle('on', x.dataset.tool === 'pen')); $('mkDel').style.display = 'none'; $('mkc').style.transform = ''; draw(); Nav.open('markup', () => { $('mk').classList.remove('show'); MK = null; }); $('mk').classList.add('show');
}
function draw() {
  const c = $('mkc'), x = c.getContext('2d'); x.drawImage(MK.im, 0, 0); const lw = Math.max(4, c.width / 180), fs = Math.max(18, c.width / 32);
  x.lineCap = x.lineJoin = 'round';
  [...MK.strokes, MK.cur].filter(Boolean).forEach((s, i) => {
    const sel = s === MK.sel; x.lineWidth = lw; x.strokeStyle = sel ? '#ffd400' : (s.col || '#ff2d2d'); x.fillStyle = x.strokeStyle;
    x.beginPath();
    if (s.tool === 'pen') { s.p.forEach((q, j) => j ? x.lineTo(q[0], q[1]) : x.moveTo(q[0], q[1])); x.stroke(); return; }
    const a = s.p[0], b = s.p[s.p.length - 1];
    if (s.tool === 'text') { x.font = `bold ${fs}px sans-serif`; x.textBaseline = 'top'; const w = x.measureText(s.text || '').width; x.save(); x.globalAlpha = 0.85; x.fillStyle = '#fff'; x.fillRect(a[0] - 6, a[1] - 4, w + 12, fs + 8); x.restore(); x.fillText(s.text || '', a[0], a[1]); if (sel) x.strokeRect(a[0] - 6, a[1] - 4, w + 12, fs + 8); return; }
    if (s.tool === 'circle') { x.ellipse((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.abs(b[0] - a[0]) / 2 + 1, Math.abs(b[1] - a[1]) / 2 + 1, 0, 0, 7); x.stroke(); return; }
    if (s.tool === 'dim') {   // dimension line: ticks at both ends, label centred
      x.moveTo(a[0], a[1]); x.lineTo(b[0], b[1]); x.stroke(); const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), t = lw * 3;
      [a, b].forEach(q => { x.beginPath(); x.moveTo(q[0] - t * Math.sin(ang), q[1] + t * Math.cos(ang)); x.lineTo(q[0] + t * Math.sin(ang), q[1] - t * Math.cos(ang)); x.stroke(); });
      const label = s.text || '?'; x.font = `bold ${fs}px sans-serif`; x.textBaseline = 'middle'; x.textAlign = 'center'; const w = x.measureText(label).width, mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      x.save(); x.translate(mx, my); let r = ang; if (r > Math.PI / 2 || r < -Math.PI / 2) r += Math.PI; x.rotate(r); x.globalAlpha = 0.9; x.fillStyle = '#fff'; x.fillRect(-w / 2 - 6, -fs * 0.8 - fs * 0.6, w + 12, fs + 6); x.globalAlpha = 1; x.fillStyle = sel ? '#b08900' : (s.col || '#ff2d2d'); x.fillText(label, 0, -fs * 0.8); x.restore(); x.textAlign = 'start'; return;
    }
    x.moveTo(a[0], a[1]); x.lineTo(b[0], b[1]); x.stroke(); const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), h = lw * 5;
    x.beginPath(); x.moveTo(b[0], b[1]); x.lineTo(b[0] - h * Math.cos(ang - 0.45), b[1] - h * Math.sin(ang - 0.45)); x.moveTo(b[0], b[1]); x.lineTo(b[0] - h * Math.cos(ang + 0.45), b[1] - h * Math.sin(ang + 0.45)); x.stroke();
  });
}
// Hit test for the select tool: returns the mark whose geometry is within tolerance of the point.
function hit(pt) {
  const c = $('mkc'), tol = Math.max(14, c.width / 60), fs = Math.max(18, c.width / 32), x = c.getContext('2d');
  const segD = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1; let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2; t = Math.max(0, Math.min(1, t)); return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); };
  for (let i = MK.strokes.length - 1; i >= 0; i--) {
    const s = MK.strokes[i], a = s.p[0], b = s.p[s.p.length - 1];
    if (s.tool === 'text') { x.font = `bold ${fs}px sans-serif`; const w = x.measureText(s.text || '').width; if (pt[0] >= a[0] - 6 && pt[0] <= a[0] + w + 6 && pt[1] >= a[1] - 4 && pt[1] <= a[1] + fs + 4) return s; continue; }
    if (s.tool === 'pen') { for (let j = 1; j < s.p.length; j++) if (segD(pt, s.p[j - 1], s.p[j]) < tol) return s; continue; }
    if (s.tool === 'circle') { const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2, rx = Math.abs(b[0] - a[0]) / 2 + 1, ry = Math.abs(b[1] - a[1]) / 2 + 1; const d = Math.hypot((pt[0] - cx) / rx, (pt[1] - cy) / ry); if (Math.abs(d - 1) * Math.min(rx, ry) < tol) return s; continue; }
    if (segD(pt, a, b) < tol * 1.5) return s;
  }
  return null;
}
function askText(title, cur) { return new Promise(res => { const d = document.createElement('div'); d.className = 'mkask'; d.innerHTML = `<div><b>${title}</b><input id="mkTxt" value="${(cur || '').replace(/"/g, '&quot;')}" placeholder="e.g. 850 mm, or Gap here"><div class="act"><button id="mkTxtX">Cancel</button><button class="go" id="mkTxtOk">OK</button></div></div>`; $('mk').appendChild(d); const i = d.querySelector('#mkTxt'); setTimeout(() => i.focus(), 30); const done = v => { d.remove(); res(v); }; d.querySelector('#mkTxtOk').onclick = () => done(i.value.trim()); d.querySelector('#mkTxtX').onclick = () => done(null); i.onkeydown = e => { if (e.key === 'Enter') done(i.value.trim()); if (e.key === 'Escape') done(null); }; }); }
export function initMarkup() {
  const c = $('mkc'), pt = e => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) * c.width / r.width, (e.clientY - r.top) * c.height / r.height]; };
  let dragFrom = null, moved = false, dragOrig = null;
  // Pan and zoom of the photo while marking up: Ctrl+drag, middle button or Space on a computer; two fingers on a phone; wheel to zoom.
  const V = { x: 0, y: 0, s: 1 }, cv = c.parentElement, pts = new Map(); let pan = null, pinch = null, space = false;
  const applyV = () => { c.style.transform = `translate(${V.x}px,${V.y}px) scale(${V.s})`; };
  const resetV = () => { V.x = 0; V.y = 0; V.s = 1; applyV(); };
  c.style.transformOrigin = '0 0'; cv.style.overflow = 'hidden';
  addEventListener('keydown', e => { if (!MK) return; if (e.key === ' ' && e.target === document.body) { space = true; e.preventDefault(); } if (e.key === 'Escape') { if (MK.cur) { MK.cur = null; draw(); } else if (dragFrom && MK.sel && dragOrig) { MK.sel.p = dragOrig; dragFrom = null; dragOrig = null; draw(); } else if (MK.sel) { MK.sel = null; draw(); } } });
  addEventListener('keyup', e => { if (e.key === ' ') space = false; });
  cv.addEventListener('wheel', e => { if (!MK) return; e.preventDefault(); const r = cv.getBoundingClientRect(), cx = e.clientX - r.left, cy = e.clientY - r.top, ns = Math.max(1, Math.min(8, V.s * Math.exp(-e.deltaY * 0.0015))); V.x = cx - (cx - V.x) * ns / V.s; V.y = cy - (cy - V.y) * ns / V.s; V.s = ns; if (V.s === 1) { V.x = 0; V.y = 0; } applyV(); }, { passive: false });
  cv.addEventListener('pointerdown', e => { if (!MK) return; pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: V.s, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, x: V.x, y: V.y }; if (MK.cur) { MK.cur = null; draw(); } } });
  cv.addEventListener('pointermove', e => { if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (pts.size === 2 && pinch) { const [a, b] = [...pts.values()], r = cv.getBoundingClientRect(), ns = Math.max(1, Math.min(8, pinch.s * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d)), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, cx = pinch.cx - r.left, cy = pinch.cy - r.top; V.x = cx - (cx - pinch.x) * ns / pinch.s + (mx - pinch.cx); V.y = cy - (cy - pinch.y) * ns / pinch.s + (my - pinch.cy); V.s = ns; applyV(); } });
  const upV = e => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (V.s <= 1.001) resetV(); };
  cv.addEventListener('pointerup', upV); cv.addEventListener('pointercancel', upV);
  c.addEventListener('pointerdown', async e => {
    if (!MK) return; if (pts.size >= 2) return;
    if (e.ctrlKey || e.button === 1 || space) { pan = { x: e.clientX, y: e.clientY, vx: V.x, vy: V.y }; c.setPointerCapture(e.pointerId); c.style.cursor = 'grabbing'; return; }
    c.setPointerCapture(e.pointerId); const p = pt(e); moved = false;
    if (MK.tool === 'select') { const s = hit(p); MK.sel = s; dragFrom = s ? p : null; dragOrig = s ? s.p.map(q => q.slice()) : null; draw(); return; }
    if (MK.tool === 'text') { const t = await askText('Text', ''); if (t) { MK.strokes.push({ tool: 'text', p: [p], text: t }); MK.sel = null; draw(); } return; }
    MK.cur = { tool: MK.tool, p: [p] }; draw();
  });
  c.addEventListener('pointermove', e => {
    if (!MK) return; if (pan) { V.x = pan.vx + (e.clientX - pan.x); V.y = pan.vy + (e.clientY - pan.y); applyV(); return; } if (pts.size >= 2) return; const p = pt(e);
    if (MK.tool === 'select') { if (MK.sel && dragFrom) { const dx = p[0] - dragFrom[0], dy = p[1] - dragFrom[1]; MK.sel.p = MK.sel.p.map(q => [q[0] + dx, q[1] + dy]); dragFrom = p; moved = true; draw(); } return; }
    if (!MK.cur) return; if (MK.cur.tool === 'pen') MK.cur.p.push(p); else MK.cur.p = [MK.cur.p[0], p]; draw();
  });
  c.addEventListener('pointerup', async () => {
    if (!MK) return; if (pan) { pan = null; c.style.cursor = ''; return; }
    if (MK.tool === 'select') { dragOrig = null; if (MK.sel && !moved && (MK.sel.tool === 'text' || MK.sel.tool === 'dim')) { const t = await askText(MK.sel.tool === 'dim' ? 'Dimension' : 'Text', MK.sel.text); if (t !== null) { MK.sel.text = t; draw(); } } dragFrom = null; return; }
    if (MK.cur) { const s = MK.cur; MK.cur = null; if (s.p.length > 1 && (s.tool === 'pen' || Math.hypot(s.p[1][0] - s.p[0][0], s.p[1][1] - s.p[0][1]) > 6)) { if (s.tool === 'dim') { const t = await askText('Dimension (what you measured)', ''); if (t === null) { draw(); return; } s.text = t; } MK.strokes.push(s); } draw(); }
  });
  document.querySelectorAll('#mk [data-tool]').forEach(b => b.onclick = () => { MK.tool = b.dataset.tool; if (MK.tool !== 'select') MK.sel = null; document.querySelectorAll('#mk [data-tool]').forEach(x => x.classList.toggle('on', x === b)); $('mkDel').style.display = MK.tool === 'select' ? '' : 'none'; draw(); });
  $('mkUndo').onclick = () => { MK.strokes.pop(); MK.sel = null; draw(); };
  $('mkDel').onclick = () => { if (MK.sel) { MK.strokes = MK.strokes.filter(s => s !== MK.sel); MK.sel = null; draw(); } };
  $('mkCancel').onclick = () => { $('mk').classList.remove('show'); MK = null; Nav.closed('markup'); };
  $('mkSave').onclick = () => { const m = MK; m.sel = null; draw(); $('mk').classList.remove('show'); MK = null; Nav.closed('markup'); if (m.strokes.length) m.onSave(c.toDataURL('image/jpeg', 0.82)); };
}
