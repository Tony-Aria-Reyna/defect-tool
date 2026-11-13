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

/* ---- markup ----
   Marks are objects, not paint: tap one to select it, drag it to move it, drag a handle to resize or reshape it,
   change its colour or size, edit its text, duplicate or delete it. Undo and redo cover every change. */
let MK = null;
const COLS = ['#ff2d2d', '#ffd400', '#1e88e5', '#111111', '#ffffff'];
export async function markup(src, onSave) {
  let im; try { im = await loadImage(src); } catch (e) { toast('This photo cannot be marked up until the storage CORS setting is in place (see README).', 5000); return; }
  const c = $('mkc'); c.width = im.width; c.height = im.height;
  try { c.getContext('2d').drawImage(im, 0, 0); c.toDataURL(); } catch (e) { toast('This photo cannot be marked up until the storage CORS setting is in place (see README).', 5000); return; }
  MK = { im, strokes: [], tool: 'poly', cur: null, sel: null, onSave, col: COLS[0], undo: [], redo: [] };
  $('mkc').style.transform = ''; setTool('poly'); draw(); Nav.open('markup', () => { $('mk').classList.remove('show'); MK = null; }); $('mk').classList.add('show');
}
const base = () => { const c = $('mkc'); return { lw: Math.max(4, c.width / 180), fs: Math.max(18, c.width / 32), tol: Math.max(16, c.width / 45) }; };
const fsOf = s => base().fs * (s.fs || 1), lwOf = s => base().lw * (s.w || 1);
// A text label is a box: the words wrap to its width (s.bw) and sit left, centre or right (s.al).
function wrapText(s) {
  const x = $('mkc').getContext('2d'), fs = fsOf(s); x.font = `bold ${fs}px sans-serif`; const out = [];
  String(s.text || '').split('\n').forEach(par => { if (!s.bw) { out.push(par); return; } let ln = ''; par.split(/\s+/).forEach(w => { const t = ln ? ln + ' ' + w : w; if (ln && x.measureText(t).width > s.bw) { out.push(ln); ln = w; } else ln = t; }); out.push(ln); });
  return out;
}
const lines = s => wrapText(s);
function textBox(s) { const x = $('mkc').getContext('2d'), fs = fsOf(s), L = wrapText(s); x.font = `bold ${fs}px sans-serif`; const nat = Math.max(...L.map(t => x.measureText(t).width), fs), w = s.bw ? Math.max(s.bw, 0) : nat, h = L.length * fs * 1.2; return { x: s.p[0][0], y: s.p[0][1], w, h, fs, L }; }
// A new label starts no wider than the photo allows, so long text wraps instead of running off the edge.
function fitText(s) { const c = $('mkc'), x = c.getContext('2d'), fs = fsOf(s), m = c.width * 0.03; x.font = `bold ${fs}px sans-serif`; const nat = Math.max(...String(s.text || '').split('\n').map(t => x.measureText(t).width), fs); let px = Math.max(m, s.p[0][0]); const room = c.width - m - px, want = Math.min(nat, c.width * 0.7); if (room < Math.min(want, c.width * 0.4)) px = Math.max(m, c.width - m - want); s.bw = Math.ceil(Math.min(nat, c.width - m - px)) + 2; const h = wrapText(s).length * fs * 1.2; s.p = [[px, Math.max(m, Math.min(s.p[0][1], c.height - m - h))]]; }
// The rectangle that contains a mark, in photo pixels.
function bbox(s) {
  if (s.tool === 'text') { const b = textBox(s); return { x0: b.x - 6, y0: b.y - 4, x1: b.x + b.w + 6, y1: b.y + b.h + 4 }; }
  const xs = s.p.map(q => q[0]), ys = s.p.map(q => q[1]); return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}
// Where the grab handles of a mark sit: the two ends of a line, the four corners of a shape, one corner of a text label.
function handles(s) {
  if (s.tool === 'arrow' || s.tool === 'dim' || s.tool === 'line') return [{ k: 'a', p: s.p[0] }, { k: 'b', p: s.p[s.p.length - 1] }];
  if (s.tool === 'poly') return s.p.map((q, i) => ({ k: i, p: q }));
  const b = bbox(s); if (s.tool === 'text') return [{ k: 'w', p: [b.x0, (b.y0 + b.y1) / 2] }, { k: 'e', p: [b.x1, (b.y0 + b.y1) / 2] }, { k: 'se', p: [b.x1, b.y1] }];
  return [{ k: 'nw', p: [b.x0, b.y0] }, { k: 'ne', p: [b.x1, b.y0] }, { k: 'sw', p: [b.x0, b.y1] }, { k: 'se', p: [b.x1, b.y1] }];
}
function draw() {
  const c = $('mkc'), x = c.getContext('2d'); x.setLineDash([]); x.globalAlpha = 1; x.drawImage(MK.im, 0, 0); const B = base();
  x.lineCap = x.lineJoin = 'round';
  [...MK.strokes, MK.cur].filter(Boolean).forEach(s => {
    const col = s.col || COLS[0], lw = lwOf(s); x.lineWidth = lw; x.strokeStyle = col; x.fillStyle = col; x.beginPath();
    if (s.tool === 'pen') { s.p.forEach((q, j) => j ? x.lineTo(q[0], q[1]) : x.moveTo(q[0], q[1])); x.stroke(); return; }
    if (s.tool === 'poly') { // straight-sided shape: closed, or left open for an angle or a run of lines
      s.p.forEach((q, j) => j ? x.lineTo(q[0], q[1]) : x.moveTo(q[0], q[1])); if (s === MK.cur && MK.hover) x.lineTo(MK.hover[0], MK.hover[1]); if (s.closed) x.closePath(); x.stroke();
      if (s === MK.cur) { const r = Math.max(8, c.width / 100); s.p.forEach((q, j) => { x.beginPath(); x.arc(q[0], q[1], j ? r * 0.7 : r * 1.25, 0, 7); x.fillStyle = j ? col : '#fff'; x.fill(); x.lineWidth = Math.max(3, c.width / 350); x.strokeStyle = j ? '#fff' : col; x.stroke(); }); }
      return; }
    const a = s.p[0], b = s.p[s.p.length - 1];
    if (s.tool === 'text') { const t = textBox(s); x.font = `bold ${t.fs}px sans-serif`; x.textBaseline = 'top'; x.textAlign = 'start'; x.save(); x.globalAlpha = 0.85; x.fillStyle = col === '#ffffff' ? '#111' : '#fff'; x.fillRect(t.x - 6, t.y - 4, t.w + 12, t.h + 8); x.restore(); const al = s.al || 'l'; x.textAlign = al === 'c' ? 'center' : al === 'r' ? 'right' : 'left'; const tx = al === 'c' ? t.x + t.w / 2 : al === 'r' ? t.x + t.w : t.x; t.L.forEach((ln, i) => x.fillText(ln, tx, t.y + i * t.fs * 1.2)); x.textAlign = 'start'; return; }
    if (s.tool === 'circle') { x.ellipse((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.abs(b[0] - a[0]) / 2 + 1, Math.abs(b[1] - a[1]) / 2 + 1, 0, 0, 7); x.stroke(); return; }
    if (s.tool === 'rect') { x.strokeRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])); return; }
    if (s.tool === 'dim') {   // dimension line: ticks at both ends, label centred
      x.moveTo(a[0], a[1]); x.lineTo(b[0], b[1]); x.stroke(); const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), t = lw * 3, fs = fsOf(s);
      [a, b].forEach(q => { x.beginPath(); x.moveTo(q[0] - t * Math.sin(ang), q[1] + t * Math.cos(ang)); x.lineTo(q[0] + t * Math.sin(ang), q[1] - t * Math.cos(ang)); x.stroke(); });
      const label = s.text || '?'; x.font = `bold ${fs}px sans-serif`; x.textBaseline = 'middle'; x.textAlign = 'center'; const w = x.measureText(label).width, mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      x.save(); x.translate(mx, my); let r = ang; if (r > Math.PI / 2 || r < -Math.PI / 2) r += Math.PI; x.rotate(r); x.globalAlpha = 0.9; x.fillStyle = '#fff'; x.fillRect(-w / 2 - 6, -fs * 0.8 - fs * 0.6, w + 12, fs + 6); x.globalAlpha = 1; x.fillStyle = col === '#ffffff' ? '#111' : col; x.fillText(label, 0, -fs * 0.8); x.restore(); x.textAlign = 'start'; return;
    }
    x.moveTo(a[0], a[1]); x.lineTo(b[0], b[1]); x.stroke(); if (s.tool === 'line') return; const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), h = lw * 5;
    x.beginPath(); x.moveTo(b[0], b[1]); x.lineTo(b[0] - h * Math.cos(ang - 0.45), b[1] - h * Math.sin(ang - 0.45)); x.moveTo(b[0], b[1]); x.lineTo(b[0] - h * Math.cos(ang + 0.45), b[1] - h * Math.sin(ang + 0.45)); x.stroke();
  });
  // selection: a dashed outline and round handles, drawn over everything and never saved into the photo
  const s = MK.sel; if (s && MK.strokes.includes(s)) { const b = bbox(s), pad = B.lw * 2, r = Math.max(9, c.width / 90);
    x.save(); x.lineWidth = Math.max(2, c.width / 500); x.strokeStyle = '#1e88e5'; x.setLineDash([r, r * 0.8]); x.strokeRect(b.x0 - pad, b.y0 - pad, b.x1 - b.x0 + pad * 2, b.y1 - b.y0 + pad * 2); x.setLineDash([]);
    handles(s).forEach(h => { x.beginPath(); x.arc(h.p[0], h.p[1], r, 0, 7); x.fillStyle = '#fff'; x.fill(); x.lineWidth = Math.max(3, c.width / 350); x.strokeStyle = '#1e88e5'; x.stroke(); }); x.restore(); }
  props();
}
// Which mark is under a point (top-most first).
function hit(pt) {
  const tol = base().tol;
  const segD = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1; let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2; t = Math.max(0, Math.min(1, t)); return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); };
  for (let i = MK.strokes.length - 1; i >= 0; i--) {
    const s = MK.strokes[i], a = s.p[0], b = s.p[s.p.length - 1];
    if (s.tool === 'text') { const q = bbox(s); if (pt[0] >= q.x0 && pt[0] <= q.x1 && pt[1] >= q.y0 && pt[1] <= q.y1) return s; continue; }
    if (s.tool === 'pen' || s.tool === 'poly') { for (let j = 1; j < s.p.length; j++) if (segD(pt, s.p[j - 1], s.p[j]) < tol) return s; if (s.tool === 'poly' && s.closed && segD(pt, s.p[s.p.length - 1], s.p[0]) < tol) return s; continue; }
    if (s.tool === 'circle') { const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2, rx = Math.abs(b[0] - a[0]) / 2 + 1, ry = Math.abs(b[1] - a[1]) / 2 + 1; const d = Math.hypot((pt[0] - cx) / rx, (pt[1] - cy) / ry); if (Math.abs(d - 1) * Math.min(rx, ry) < tol || (s === MK.sel && d < 1)) return s; continue; }
    if (s.tool === 'rect') { const q = bbox(s), inX = pt[0] > q.x0 - tol && pt[0] < q.x1 + tol, inY = pt[1] > q.y0 - tol && pt[1] < q.y1 + tol; if (inX && inY && (Math.min(Math.abs(pt[0] - q.x0), Math.abs(pt[0] - q.x1), Math.abs(pt[1] - q.y0), Math.abs(pt[1] - q.y1)) < tol || s === MK.sel)) return s; continue; }
    if (segD(pt, a, b) < tol * 1.3) return s;
  }
  return null;
}
const hitHandle = pt => { const s = MK.sel; if (!s) return null; const r = base().tol * 1.25; return handles(s).find(h => Math.hypot(pt[0] - h.p[0], pt[1] - h.p[1]) < r) || null; };
const snap = () => { MK.undo.push(JSON.stringify(MK.strokes)); if (MK.undo.length > 60) MK.undo.shift(); MK.redo = []; };
function setTool(t) { MK.tool = t; document.querySelectorAll('#mk [data-tool]').forEach(x => { const on = x.dataset.tool === t; x.classList.toggle('on', on); if (on) try { x.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) {} }); const NAMES = { select: 'Select', poly: 'Shape', arrow: 'Arrow', circle: 'Circle', rect: 'Box', line: 'Line', text: 'Text', dim: 'Dimension', pen: 'Pen' }; const hint = $('mkHint'); if (hint) hint.textContent = NAMES[t] + ': ' + (t === 'select' ? 'Tap a mark to select it. Drag it to move, drag a white dot to resize.' : t === 'poly' ? 'Tap each corner. Tap the first (white) dot to close the shape, or Finish to leave it open.' : t === 'text' ? 'Tap where the text should go. Drag the side dots to change its width.' : t === 'pen' ? 'Draw freehand. Tap Select when you are done.' : 'Drag on the photo to draw. It is then selected so you can adjust it.'); }
// The row of options for the selected mark (or the defaults for the next one).
function props() {
  const el = $('mkProps'); if (!el || !MK) return; const s = MK.sel && MK.strokes.includes(MK.sel) ? MK.sel : null, cur = s ? (s.col || COLS[0]) : MK.col, hasText = s && (s.tool === 'text' || s.tool === 'dim');
  const drawing = MK.cur && MK.cur.tool === 'poly' ? MK.cur.p.length : 0;
  const AL = { l: '<svg viewBox="0 0 20 20"><path d="M3 5h14M3 10h8M3 15h11"/></svg>', c: '<svg viewBox="0 0 20 20"><path d="M3 5h14M6 10h8M4.5 15h11"/></svg>', r: '<svg viewBox="0 0 20 20"><path d="M3 5h14M9 10h8M6 15h11"/></svg>' };
  const key = [s ? MK.strokes.indexOf(s) : -1, cur, hasText, s ? s.al || 'l' : '', MK.undo.length, MK.redo.length, drawing, s && s.tool === 'poly' ? !!s.closed : ''].join('|'); if (el.dataset.k === key) return; el.dataset.k = key; el.scrollLeft = 0;
  if (drawing) { el.innerHTML = `<button data-pg="close" ${drawing < 3 ? 'disabled style="opacity:.4"' : ''} class="pgo">⬠ Close shape</button><button data-pg="open" ${drawing < 2 ? 'disabled style="opacity:.4"' : ''}>✔ Finish (leave open)</button><button data-pg="back">↶ Last point</button><button data-pg="x">Cancel shape</button>`; el.querySelectorAll('[data-pg]').forEach(b => b.onclick = () => polyEnd(b.dataset.pg)); return; }
  const ib = (a, icon, title, cls) => `<button class="ic ${cls || ''}" data-a="${a}" title="${title}" aria-label="${title}">${icon}</button>`;
  el.innerHTML = `<button class="sw on" id="mkCol" style="background:${cur}" title="Colour: tap to change"></button>` + (s ? (hasText ? ib('edit', '✎', 'Edit the text') : '') + (s.tool === 'text' ? ['l', 'c', 'r'].map(a => `<button class="ic ${(s.al || 'l') === a ? 'on' : ''}" data-al="${a}" title="${a === 'l' ? 'Align left' : a === 'c' ? 'Centre' : 'Align right'}">${AL[a]}</button>`).join('') : '') + (s.tool === 'poly' ? `<button data-a="toggle">${s.closed ? 'Open it' : 'Close it'}</button>` : '') + ib('smaller', 'A−', 'Thinner or smaller') + ib('bigger', 'A+', 'Thicker or bigger') + ib('dup', '⧉', 'Copy') + ib('del', '🗑', 'Delete', 'del') : '<span class="muted small" style="color:#aaa;align-self:center;margin-left:6px">Colour for the next mark. Tap it to change.</span>');
  $('mkCol').onclick = () => { MK.col = COLS[(COLS.indexOf(cur) + 1) % COLS.length]; if (s) { snap(); s.col = MK.col; } draw(); };
  el.querySelectorAll('[data-al]').forEach(b => b.onclick = () => { snap(); s.al = b.dataset.al; draw(); });
  el.querySelectorAll('[data-a]').forEach(b => b.onclick = async () => { const a = b.dataset.a;
    if (a === 'del') { snap(); MK.strokes = MK.strokes.filter(q => q !== s); MK.sel = null; }
    else if (a === 'dup') { snap(); const off = base().tol * 1.5, n = JSON.parse(JSON.stringify(s)); n.p = n.p.map(q => [q[0] + off, q[1] + off]); MK.strokes.push(n); MK.sel = n; }
    else if (a === 'toggle') { snap(); s.closed = !s.closed; }
    else if (a === 'edit') { const t = await askText(s.tool === 'dim' ? 'Dimension' : 'Text', s.text, s.tool === 'text'); if (t !== null && t !== '') { snap(); s.text = t; } }
    else { snap(); const k = a === 'bigger' ? 1.25 : 0.8; if (s.tool === 'text') s.fs = Math.max(0.4, Math.min(5, (s.fs || 1) * k)); else { s.w = Math.max(0.4, Math.min(4, (s.w || 1) * k)); if (s.tool === 'dim') s.fs = Math.max(0.4, Math.min(5, (s.fs || 1) * k)); } }
    draw(); });
}
// Finish, close, step back or abandon the straight-sided shape being drawn.
function polyEnd(how) {
  const s = MK.cur; if (!s || s.tool !== 'poly') return; MK.hover = null;
  if (how === 'back') { s.p.pop(); if (!s.p.length) MK.cur = null; draw(); return; }
  MK.cur = null;
  if (how !== 'x' && s.p.length >= 2) { s.closed = how === 'close' && s.p.length >= 3; snap(); MK.strokes.push(s); MK.sel = s; setTool('select'); }
  draw();
}
function askText(title, cur, multi) { return new Promise(res => { const d = document.createElement('div'); d.className = 'mkask'; d.innerHTML = `<div><b>${title}</b>${multi ? '<textarea id="mkTxt" rows="3" placeholder="e.g. Gap here. Press Enter for a new line."></textarea>' : '<input id="mkTxt" placeholder="e.g. 850 mm">'}<div class="act"><button id="mkTxtX">Cancel</button><button class="go" id="mkTxtOk">OK</button></div></div>`; $('mk').appendChild(d); const i = d.querySelector('#mkTxt'); i.value = cur || ''; setTimeout(() => i.focus(), 30); const done = v => { d.remove(); res(v); }; d.querySelector('#mkTxtOk').onclick = () => done(i.value.trim()); d.querySelector('#mkTxtX').onclick = () => done(null); i.onkeydown = e => { if (e.key === 'Enter' && (!multi || e.ctrlKey || e.metaKey)) { e.preventDefault(); done(i.value.trim()); } if (e.key === 'Escape') done(null); }; }); }
export function initMarkup() {
  const c = $('mkc'), pt = e => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) * c.width / r.width, (e.clientY - r.top) * c.height / r.height]; };
  let drag = null, lastTap = { t: 0, s: null };
  // Pan and zoom of the photo while marking up: Ctrl+drag, middle button or Space on a computer; two fingers on a phone; wheel to zoom.
  const V = { x: 0, y: 0, s: 1 }, cv = c.parentElement, pts = new Map(); let pan = null, pinch = null, space = false;
  const applyV = () => { c.style.transform = `translate(${V.x}px,${V.y}px) scale(${V.s})`; };
  const resetV = () => { V.x = 0; V.y = 0; V.s = 1; applyV(); };
  c.style.transformOrigin = '0 0'; cv.style.overflow = 'hidden';
  const undo = () => { if (MK.cur && MK.cur.tool === 'poly') { polyEnd('back'); return; } if (!MK.undo.length) return; MK.redo.push(JSON.stringify(MK.strokes)); MK.strokes = JSON.parse(MK.undo.pop()); MK.sel = null; draw(); };
  const redo = () => { if (!MK.redo.length) return; MK.undo.push(JSON.stringify(MK.strokes)); MK.strokes = JSON.parse(MK.redo.pop()); MK.sel = null; draw(); };
  const del = () => { if (MK.sel) { snap(); MK.strokes = MK.strokes.filter(s => s !== MK.sel); MK.sel = null; draw(); } };
  addEventListener('keydown', e => { if (!MK || document.querySelector('.mkask')) return; const k = e.key.toLowerCase();
    if (e.key === ' ' && e.target === document.body) { space = true; e.preventDefault(); }
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); } else if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redo(); }
    else if ((e.ctrlKey || e.metaKey) && k === 'd' && MK.sel) { e.preventDefault(); const b = document.querySelector('#mkProps [data-a=dup]'); if (b) b.click(); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { if (MK.sel) { e.preventDefault(); del(); } }
    else if (e.key.startsWith('Arrow') && MK.sel) { e.preventDefault(); const st = (e.shiftKey ? 10 : 2) * c.width / 800, dx = e.key === 'ArrowLeft' ? -st : e.key === 'ArrowRight' ? st : 0, dy = e.key === 'ArrowUp' ? -st : e.key === 'ArrowDown' ? st : 0; snap(); MK.sel.p = MK.sel.p.map(q => [q[0] + dx, q[1] + dy]); draw(); }
    if (e.key === 'Enter' && MK.cur && MK.cur.tool === 'poly') { e.preventDefault(); polyEnd('open'); }
    if (e.key === 'Escape') { if (MK.cur) { MK.cur = null; MK.hover = null; draw(); } else if (drag && drag.orig) { MK.sel.p = drag.orig.p; MK.sel.fs = drag.orig.fs; MK.sel.bw = drag.orig.bw; drag = null; draw(); } else if (MK.sel) { MK.sel = null; draw(); } } });
  addEventListener('keyup', e => { if (e.key === ' ') space = false; });
  cv.addEventListener('wheel', e => { if (!MK) return; e.preventDefault(); const r = cv.getBoundingClientRect(), cx = e.clientX - r.left, cy = e.clientY - r.top, ns = Math.max(1, Math.min(8, V.s * Math.exp(-e.deltaY * 0.0015))); V.x = cx - (cx - V.x) * ns / V.s; V.y = cy - (cy - V.y) * ns / V.s; V.s = ns; if (V.s === 1) { V.x = 0; V.y = 0; } applyV(); }, { passive: false });
  cv.addEventListener('pointerdown', e => { if (!MK) return; pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: V.s, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, x: V.x, y: V.y }; if (MK.cur && MK.cur.tool === 'poly') { if (MK.cur.p.length > 1) MK.cur.p.pop(); } else if (MK.cur) { MK.cur = null; } if (drag && drag.orig && MK.sel) { MK.sel.p = drag.orig.p; MK.sel.fs = drag.orig.fs; MK.sel.bw = drag.orig.bw; } drag = null; draw(); } });
  cv.addEventListener('pointermove', e => { if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (pts.size === 2 && pinch) { const [a, b] = [...pts.values()], r = cv.getBoundingClientRect(), ns = Math.max(1, Math.min(8, pinch.s * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d)), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, cx = pinch.cx - r.left, cy = pinch.cy - r.top; V.x = cx - (cx - pinch.x) * ns / pinch.s + (mx - pinch.cx); V.y = cy - (cy - pinch.y) * ns / pinch.s + (my - pinch.cy); V.s = ns; applyV(); } });
  const upV = e => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (V.s <= 1.001) resetV(); };
  cv.addEventListener('pointerup', upV); cv.addEventListener('pointercancel', upV);
  c.addEventListener('pointerdown', async e => {
    if (!MK) return; if (pts.size >= 2) return;
    if (e.ctrlKey || e.button === 1 || space) { pan = { x: e.clientX, y: e.clientY, vx: V.x, vy: V.y }; c.setPointerCapture(e.pointerId); c.style.cursor = 'grabbing'; return; }
    c.setPointerCapture(e.pointerId); const p = pt(e), keep = s => ({ p: s.p.map(q => q.slice()), fs: s.fs, bw: s.bw, box: bbox(s) });
    // a handle of the selected mark always wins, whichever tool is active
    const h = hitHandle(p); if (h) { drag = { kind: 'h', k: h.k, from: p, orig: keep(MK.sel), moved: false }; return; }
    if (MK.tool === 'select') { const s = hit(p); MK.sel = s; drag = s ? { kind: 'm', from: p, orig: keep(s), moved: false } : null; draw(); return; }
    if (MK.tool === 'text') { const t = await askText('Text', '', true); if (t) { snap(); const n = { tool: 'text', p: [p], text: t, col: MK.col }; fitText(n); MK.strokes.push(n); MK.sel = n; setTool('select'); draw(); } return; }
    if (MK.tool === 'poly') { // one tap per corner
      const s = MK.cur, near = (q, k) => Math.hypot(p[0] - q[0], p[1] - q[1]) < base().tol * (k || 1.2);
      if (!s || s.tool !== 'poly') { MK.sel = null; MK.cur = { tool: 'poly', p: [p], col: MK.col }; }
      else if (s.p.length >= 3 && near(s.p[0], 1.5)) { polyEnd('close'); return; }
      else if (s.p.length >= 2 && near(s.p[s.p.length - 1], 0.8)) { polyEnd('open'); return; }
      else s.p.push(p);
      MK.hover = null; draw(); return; }
    MK.sel = null; MK.cur = { tool: MK.tool, p: [p], col: MK.col }; draw();
  });
  c.addEventListener('pointermove', e => {
    if (!MK) return; if (pan) { V.x = pan.vx + (e.clientX - pan.x); V.y = pan.vy + (e.clientY - pan.y); applyV(); return; } if (pts.size >= 2) return; const p = pt(e);
    if (drag && MK.sel) { const s = MK.sel, o = drag.orig, dx = p[0] - drag.from[0], dy = p[1] - drag.from[1];
      if (!drag.moved) { if (Math.hypot(dx, dy) < base().tol * 0.25) return; drag.moved = true; snap(); }
      if (drag.kind === 'm') s.p = o.p.map(q => [q[0] + dx, q[1] + dy]);
      else if (typeof drag.k === 'number') { s.p = o.p.map(q => q.slice()); s.p[drag.k] = p; }
      else if (drag.k === 'a') s.p = [p, o.p[o.p.length - 1]]; else if (drag.k === 'b') s.p = [o.p[0], p];
      else if (s.tool === 'text' && drag.k === 'e') s.bw = Math.max(fsOf(s) * 2, p[0] - 6 - s.p[0][0]);
      else if (s.tool === 'text' && drag.k === 'w') { const right = o.box.x1 - 6, nx = Math.min(p[0] + 6, right - fsOf(s) * 2); s.p = [[nx, o.p[0][1]]]; s.bw = right - nx; }
      else if (s.tool === 'text') { const n = lines(s).length, k = Math.max(0.4, Math.min(6, (p[1] - s.p[0][1] - 4) / (base().fs * 1.2 * n))), was = s.fs || 1; s.fs = k; if (s.bw) s.bw = (o.bw || s.bw) * k / (o.fs || 1); }
      else { // a corner: the opposite corner stays where it is
        const b = o.box, fx = drag.k.includes('w') ? b.x1 : b.x0, fy = drag.k.includes('n') ? b.y1 : b.y0;
        if (s.tool === 'pen') { const sx = (p[0] - fx) / ((drag.k.includes('w') ? b.x0 : b.x1) - fx || 1), sy = (p[1] - fy) / ((drag.k.includes('n') ? b.y0 : b.y1) - fy || 1); s.p = o.p.map(q => [fx + (q[0] - fx) * sx, fy + (q[1] - fy) * sy]); }
        else s.p = [[fx, fy], p];
      }
      draw(); return; }
    if (!MK.cur) return; if (MK.cur.tool === 'poly') { if (e.pointerType === 'mouse') { MK.hover = p; draw(); } return; } if (MK.cur.tool === 'pen') MK.cur.p.push(p); else MK.cur.p = [MK.cur.p[0], p]; draw();
  });
  const up = async () => {
    if (!MK) return; if (pan) { pan = null; c.style.cursor = ''; return; }
    if (drag) { const d = drag, s = MK.sel; drag = null;
      if (!d.moved && s && d.kind === 'm') { const now = Date.now(); if (lastTap.s === s && now - lastTap.t < 450 && (s.tool === 'text' || s.tool === 'dim')) { const t = await askText(s.tool === 'dim' ? 'Dimension' : 'Text', s.text, s.tool === 'text'); if (t !== null && t !== '') { snap(); s.text = t; draw(); } lastTap = { t: 0, s: null }; } else lastTap = { t: now, s }; }
      return; }
    if (MK.cur && MK.cur.tool === 'poly') return;
    if (MK.cur) { const s = MK.cur; MK.cur = null; if (s.p.length > 1 && (s.tool === 'pen' || Math.hypot(s.p[1][0] - s.p[0][0], s.p[1][1] - s.p[0][1]) > 6)) { if (s.tool === 'dim') { const t = await askText('Dimension (what you measured)', ''); if (t === null) { draw(); return; } s.text = t; } snap(); MK.strokes.push(s); if (s.tool !== 'pen') { MK.sel = s; setTool('select'); } } draw(); }
  };
  c.addEventListener('pointerup', up); c.addEventListener('pointercancel', () => { if (MK && MK.cur && MK.cur.tool !== 'poly') { MK.cur = null; draw(); } drag = null; });
  document.querySelectorAll('#mk [data-tool]').forEach(b => b.onclick = () => { if (MK.cur && MK.cur.tool === 'poly') polyEnd('open'); setTool(b.dataset.tool); if (MK.tool !== 'select') MK.sel = null; draw(); });
  $('mkUndo').onclick = undo; $('mkRedo').onclick = redo;
  $('mkCancel').onclick = () => { $('mk').classList.remove('show'); MK = null; Nav.closed('markup'); };
  $('mkSave').onclick = () => { if (MK.cur && MK.cur.tool === 'poly') polyEnd('open'); const m = MK; m.sel = null; draw(); $('mk').classList.remove('show'); MK = null; Nav.closed('markup'); if (m.strokes.length) m.onSave(c.toDataURL('image/jpeg', 0.82)); };
}
