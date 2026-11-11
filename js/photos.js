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
    catch (e) { rec.pending = true; localUrls[p.id] = p.data; await obPut(p.id, { pid, defectId, photoId: p.id, path, dataUrl: p.data }); }
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
    catch (e) { rec.pending = true; await obPut(f.id, { kind: 'file', pid, defectId, photoId: f.id, path, dataUrl: f.data }); }
    out.push(rec);
  }
  return out;
}
export async function flushOutbox() {
  if (flushing || !navigator.onLine) return; flushing = true;
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
  MK = { im, strokes: [], tool: 'pen', cur: null, onSave }; draw(); Nav.open('markup', () => { $('mk').classList.remove('show'); MK = null; }); $('mk').classList.add('show');
}
function draw() {
  const c = $('mkc'), x = c.getContext('2d'); x.drawImage(MK.im, 0, 0); const lw = Math.max(4, c.width / 180);
  x.lineWidth = lw; x.strokeStyle = '#ff2d2d'; x.lineCap = x.lineJoin = 'round';
  [...MK.strokes, MK.cur].filter(Boolean).forEach(s => {
    x.beginPath();
    if (s.tool === 'pen') { s.p.forEach((q, j) => j ? x.lineTo(q[0], q[1]) : x.moveTo(q[0], q[1])); x.stroke(); return; }
    const a = s.p[0], b = s.p[s.p.length - 1];
    if (s.tool === 'circle') { x.ellipse((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.abs(b[0] - a[0]) / 2 + 1, Math.abs(b[1] - a[1]) / 2 + 1, 0, 0, 7); x.stroke(); return; }
    x.moveTo(a[0], a[1]); x.lineTo(b[0], b[1]); x.stroke(); const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), h = lw * 5;
    x.beginPath(); x.moveTo(b[0], b[1]); x.lineTo(b[0] - h * Math.cos(ang - 0.45), b[1] - h * Math.sin(ang - 0.45)); x.moveTo(b[0], b[1]); x.lineTo(b[0] - h * Math.cos(ang + 0.45), b[1] - h * Math.sin(ang + 0.45)); x.stroke();
  });
}
export function initMarkup() {
  const c = $('mkc'), pt = e => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) * c.width / r.width, (e.clientY - r.top) * c.height / r.height]; };
  c.addEventListener('pointerdown', e => { if (!MK) return; c.setPointerCapture(e.pointerId); MK.cur = { tool: MK.tool, p: [pt(e)] }; draw(); });
  c.addEventListener('pointermove', e => { if (!MK || !MK.cur) return; MK.cur.p.push(pt(e)); draw(); });
  c.addEventListener('pointerup', () => { if (MK && MK.cur) { if (MK.cur.p.length > 1) MK.strokes.push(MK.cur); MK.cur = null; draw(); } });
  document.querySelectorAll('#mk [data-tool]').forEach(b => b.onclick = () => { MK.tool = b.dataset.tool; document.querySelectorAll('#mk [data-tool]').forEach(x => x.classList.toggle('on', x === b)); });
  $('mkUndo').onclick = () => { MK.strokes.pop(); draw(); };
  $('mkCancel').onclick = () => { $('mk').classList.remove('show'); MK = null; Nav.closed('markup'); };
  $('mkSave').onclick = () => { const m = MK; $('mk').classList.remove('show'); MK = null; Nav.closed('markup'); if (m.strokes.length) m.onSave(c.toDataURL('image/jpeg', 0.82)); };
}
