// Home User Guide builder: one topic per page, one photo, numbered pointers that never cover the item, a few short lines.
// Pages are drawn on a canvas, so the editor shows exactly what the exported PDF will look like.
import { S, can } from './state.js';
import * as Nav from './nav.js';
import { warrantyExpiry, freqText } from './fm.js';
import { $, esc, toast, busy, confirmBox, uid, compressImage, dataUrlToBlob, deliver, loadScript, safeName, stamp, natural, urlToDataUrl } from './util.js';
import { dictate, stopDictation, aiCall } from './ai.js';
import { markup } from './photos.js';
import * as FT from './filetext.js';

let X = null, E = null;
const W = 1240, H = 1754, PH0 = 250, PX = 60;           // page size (A4 at 150 dpi), photo top, side margin
const NAVY = '#172B4D', TEAL = '#3DAFBE', RED = '#C8282D', INK = '#1a1a1a';
export function init(ctx) { X = ctx; }
const pages = () => ((S.fm && S.fm.guide) || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0) || natural(a.title || '', b.title || ''));
const cfg = () => ({ phone: '', org: S.project.client || '', codePrefix: '', codeDigits: 2, ...(S.project.guideCfg || {}) });
// {unit} and {code} in any text are filled in for the unit the guide is exported for
const unitCode = u => { const c = cfg(); return u ? String(c.codePrefix || '') + String(u).padStart(+c.codeDigits || 2, '0') : ''; };
const fill = (t, u) => String(t || '').replace(/\{unit\}/g, u || '__').replace(/\{code\}/g, u ? unitCode(u).split('').join(' ') : '_ _ _');

/* ---------- drawing ---------- */
const imgCache = {};
async function loadImg(src) {
  if (!src) return null; if (imgCache[src]) return imgCache[src];
  try { let blob; if (src.startsWith('data:')) blob = dataUrlToBlob(src); else blob = new Blob([await X.getBytes(src)]); return (imgCache[src] = await createImageBitmap(blob)); } catch (e) { console.warn('guide image', e); return null; }
}
function wrap(c, text, width) { const out = []; for (const para of String(text).split('\n')) { let line = ''; for (const w of para.split(/\s+/)) { const t = (line + ' ' + w).trim(); if (c.measureText(t).width <= width) line = t; else { if (line) out.push(line); line = w; } } out.push(line); } return out; }
const font = (px, b) => `${b ? '700' : '400'} ${px}px "Segoe UI", system-ui, -apple-system, Arial, sans-serif`;
// where the photo sits on the page, so the editor can put its drag handles in the same place
export function photoRect(pg, img) { if (!img) return null; const pw = pg.wide ? W - PX * 2 : 660, sc = Math.min(pw / img.width, (pg.codeBox ? 520 : pg.wide ? 760 : 900) / img.height); return { x: PX, y: PH0, w: Math.round(img.width * sc), h: Math.round(img.height * sc) }; }
function dot(c, x, y, n, r = 34) { c.beginPath(); c.arc(x, y, r + 5, 0, 7); c.fillStyle = '#fff'; c.fill(); c.beginPath(); c.arc(x, y, r, 0, 7); c.fillStyle = RED; c.fill(); c.fillStyle = '#fff'; c.font = font(40, 1); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(n), x, y + 2); c.textAlign = 'left'; c.textBaseline = 'alphabetic'; }
function arrow(c, a, b) {
  const ang = Math.atan2(b.y - a.y, b.x - a.x), L = 32;
  for (const [col, wd] of [['#fff', 15], [RED, 7]]) { c.strokeStyle = col; c.lineWidth = wd; c.lineCap = 'round'; c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x - Math.cos(ang) * 14, b.y - Math.sin(ang) * 14); c.stroke(); }
  c.beginPath(); c.moveTo(b.x, b.y); c.lineTo(b.x - L * Math.cos(ang - 0.45), b.y - L * Math.sin(ang - 0.45)); c.lineTo(b.x - L * Math.cos(ang + 0.45), b.y - L * Math.sin(ang + 0.45)); c.closePath(); c.fillStyle = RED; c.fill(); c.strokeStyle = '#fff'; c.lineWidth = 3; c.stroke();
}
export async function draw(cv, pg, unit) {
  const ZR = []; cv.width = W; cv.height = H; const c = cv.getContext('2d'), g = cfg();
  c.fillStyle = '#fff'; c.fillRect(0, 0, W, H);
  // header: client logo on white, then the title bar
  const logo = await loadImg(S.project.clientLogo); if (logo) { const lh = 62, lw = logo.width * lh / logo.height; c.drawImage(logo, W - PX - lw, 20, lw, lh); }
  c.fillStyle = NAVY; c.fillRect(0, 100, W, 110); c.fillStyle = '#fff'; c.font = font(58, 1); c.fillText(fill(pg.title, unit), PX, 176);
  const img = await loadImg(pg.photo), r = photoRect(pg, img); let y = PH0;
  if (img) {
    c.drawImage(img, r.x, r.y, r.w, r.h); c.strokeStyle = NAVY; c.lineWidth = 4; c.strokeRect(r.x, r.y, r.w, r.h);
    const marks = pg.marks || []; marks.forEach((m, i) => { if (m.z != null) return; arrow(c, { x: r.x + m.nx * r.w, y: r.y + m.ny * r.h }, { x: r.x + m.tx * r.w, y: r.y + m.ty * r.h }); dot(c, r.x + m.nx * r.w, r.y + m.ny * r.h, i + 1); });
    // the key: beside a narrow photo, under a wide one
    const side = !pg.wide && r.w <= 700, lx = side ? r.x + r.w + 40 : PX, lw = W - lx - PX - 90; let ly = side ? PH0 + 10 : r.y + r.h + 40;
    marks.forEach((m, i) => { dot(c, lx + 34, ly + 34, i + 1); c.fillStyle = NAVY; c.font = font(37, 1); let yy = ly + 36; for (const t of wrap(c, fill(m.label, unit), lw)) { c.fillText(t, lx + 88, yy); yy += 46; } c.fillStyle = '#333'; c.font = font(32); for (const t of wrap(c, fill(m.sub, unit), lw)) { if (t) { c.fillText(t, lx + 88, yy); yy += 42; } } ly = Math.max(yy, ly + 90) + 16; });
    y = Math.max(r.y + r.h + 55, side ? ly + 10 : ly + 20);
    // close-ups: part of the photo shown larger under it, joined to where it came from
    const Z = (pg.zooms || []).slice(0, 2);
    // with the key beside the photo, the close-ups sit under the photo in the left column, so they do not wait for the key to end
    // a close-up you have placed by hand (px, py, pw as fractions of the page) stays there, even over the photo; the rest are laid out in a row
    const keyEnd = y, n = Z.filter(z => z.px == null).length; if (n && side) y = r.y + r.h + 60;
    if (Z.length) { const gap = 30, colW = side ? r.w : W - PX * 2, maxW = n <= 1 ? Math.min(560, colW) : (colW - gap) / 2, maxH = Math.max(180, Math.min(400, H - 190 - y - 260)); let x = PX, rowH = 0, capB = 0;
      const edge = (R, tx, ty) => { const cx = R.x + R.w / 2, cy = R.y + R.h / 2, dx = tx - cx, dy = ty - cy, k = Math.min(dx ? R.w / 2 / Math.abs(dx) : 1e9, dy ? R.h / 2 / Math.abs(dy) : 1e9); return { x: cx + dx * k, y: cy + dy * k }; };
      Z.forEach((z, bi) => { const sw = z.w * img.width, sh = z.h * img.height, fl = z.px != null, sc = fl ? z.pw * W / sw : Math.min(maxW / sw, maxH / sh), bw = Math.round(sw * sc), bh = Math.round(sh * sc), bx = fl ? z.px * W : x, by = fl ? z.py * H : y;
        ZR[bi] = { x: bx, y: by, w: bw, h: bh }; const SR = { x: r.x + z.x * r.w, y: r.y + z.y * r.h, w: z.w * r.w, h: z.h * r.h }, apart = bx > SR.x + SR.w || bx + bw < SR.x || by > SR.y + SR.h || by + bh < SR.y;
        const a = edge(SR, bx + bw / 2, by + bh / 2), e2 = edge(ZR[bi], SR.x + SR.w / 2, SR.y + SR.h / 2);
        for (const [col, wd] of [['#fff', 12], [RED, 5]]) { c.strokeStyle = col; c.lineWidth = wd; c.lineCap = 'round'; if (apart) { c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(e2.x, e2.y); c.stroke(); } c.beginPath(); c.roundRect(SR.x, SR.y, SR.w, SR.h, 10); c.stroke(); }
        c.drawImage(img, z.x * img.width, z.y * img.height, sw, sh, bx, by, bw, bh); c.strokeStyle = '#fff'; c.lineWidth = 12; c.strokeRect(bx, by, bw, bh); c.strokeStyle = RED; c.lineWidth = 6; c.strokeRect(bx, by, bw, bh);
        const cap = fill(z.label, unit); if (cap) { const beside = !fl && n === 1 && !side, cx = beside ? bx + bw + 34 : bx, cw = beside ? W - PX - cx : fl ? Math.max(bw, 300) : maxW; let cy = beside ? by + 44 : by + bh + 48; c.font = font(36, 1); const L = wrap(c, cap, cw);
          if (fl) { c.fillStyle = 'rgba(255,255,255,.88)'; c.fillRect(cx - 6, by + bh + 8, Math.max(...L.map(t => c.measureText(t).width)) + 12, L.length * 46 + 8); }
          c.fillStyle = NAVY; for (const t of L) { c.fillText(t, cx, cy); cy += 46; } if (!beside && !fl) capB = Math.max(capB, cy - (by + bh)); }
        if (!fl) { rowH = Math.max(rowH, bh); x += maxW + gap; } });
      if (n) y += rowH + capB + 50; if (side) y = Math.max(y, keyEnd); }
    marks.forEach((m, i) => { const q = m.z != null && ZR[m.z]; if (!q) return; arrow(c, { x: q.x + m.nx * q.w, y: q.y + m.ny * q.h }, { x: q.x + m.tx * q.w, y: q.y + m.ty * q.h }); dot(c, q.x + m.nx * q.w, q.y + m.ny * q.h, i + 1); });
  }
  // step by step: numbered photos in two columns, each with what to do
  const ST = (pg.steps || []).filter(t => t.photo || t.text).slice(0, 6);
  if (ST.length) { const gap = 34, cw = (W - PX * 2 - gap) / 2, ph = 380; let col = 0, rowTop = y, rowH = 0;
    for (const [i, t] of ST.entries()) { const im = await loadImg(t.photo), x = PX + col * (cw + gap); let yy = rowTop;
      if (im) { const sc = Math.min(cw / im.width, ph / im.height), w = im.width * sc, h = im.height * sc; c.drawImage(im, x, yy, w, h); c.strokeStyle = NAVY; c.lineWidth = 4; c.strokeRect(x, yy, w, h);
        (t.marks || []).forEach(m => arrow(c, { x: x + m.nx * w, y: yy + m.ny * h }, { x: x + m.tx * w, y: yy + m.ty * h })); yy += h; }
      dot(c, x + 40, rowTop + 40, i + 1, 30); c.font = font(34, 1); c.fillStyle = NAVY; yy += 46; for (const l of wrap(c, fill(t.text, unit), cw)) { c.fillText(l, x, yy); yy += 44; }
      rowH = Math.max(rowH, yy - rowTop); if (++col === 2) { col = 0; rowTop += rowH + 30; rowH = 0; } }
    y = rowTop + rowH + (col ? 30 : 0); }
  if (pg.codeBox) { c.fillStyle = NAVY; c.beginPath(); c.roundRect(PX, y, W - PX * 2, 250, 24); c.fill(); c.fillStyle = '#fff'; c.textAlign = 'center'; c.font = font(44, 1); c.fillText(unit ? `Your unit is ${unit}. Your visitors press:` : 'Your visitors press:', W / 2, y + 74); c.font = font(120, 1); c.fillText(unit ? unitCode(unit).split('').join('  ') : '_  _  _', W / 2, y + 205); c.textAlign = 'left'; y += 300; }
  if (pg.table) { // lines as a table: first line is the heading, cells split with |
    const R = String(pg.lines || '').split('\n').map(s => s.trim()).filter(Boolean).map(l => l.split('|').map(x => fill(x.trim(), unit))), n = Math.max(1, ...R.map(r => r.length)), tw = W - PX * 2;
    const cw = n === 4 ? [0.2, 0.18, 0.2, 0.42] : Array(n).fill(1 / n), fs = 30;
    R.forEach((r, ri) => { c.font = font(fs, ri === 0); const cells = Array.from({ length: n }, (_, i) => wrap(c, r[i] || '', cw[i] * tw - 24)), hh = 22 + Math.max(...cells.map(x => x.length)) * (fs + 8);
      if (y + hh > H - 190) return; if (ri === 0) { c.fillStyle = NAVY; c.fillRect(PX, y, tw, hh); } else if (ri % 2 === 0) { c.fillStyle = '#eef3f7'; c.fillRect(PX, y, tw, hh); }
      let x = PX; cells.forEach((ls, i) => { c.fillStyle = ri === 0 ? '#fff' : INK; ls.forEach((l, k) => c.fillText(l, x + 12, y + 14 + fs + k * (fs + 8))); x += cw[i] * tw; }); y += hh; });
  } else
  for (let t of String(pg.lines || '').split('\n').map(s => s.trim()).filter(Boolean)) {
    const big = t.startsWith('!'); t = fill(t.replace(/^!\s*/, ''), unit); c.font = font(40, big);
    if (y + 40 + (wrap(c, t, W - PX * 2 - 60).length - 1) * 56 > H - 185) { ZR.over = true; break; }   // no room left above the footer
    c.beginPath(); c.arc(PX + 14, y + 26, 10, 0, 7); c.fillStyle = big ? RED : NAVY; c.fill(); c.fillStyle = big ? NAVY : INK;
    for (const u of wrap(c, t, W - PX * 2 - 60)) { c.fillText(u, PX + 50, y + 40); y += 56; } y += 18;
  }
  c.fillStyle = TEAL; c.fillRect(0, H - 170, W, 170); c.fillStyle = '#fff'; c.font = font(40, 1); c.fillText(g.footer || 'Something not working?', PX, H - 104); { const hasQr = pg.qrUrl && pg.qr !== false, call = `Call ${g.org || 'us'}  ${g.phone || ''}`.trim(), room = (hasQr ? W - PX - 190 - 30 : W - PX) - PX; let fs = 46; c.font = font(fs, 1); while (fs > 30 && c.measureText(call).width > room) c.font = font(--fs, 1); c.fillText(call, PX, H - 44); }
  // a QR code to the item's manual: the link opens the document itself, with no sign-in
  if (pg.qrUrl && pg.qr !== false) { try { if (!window.qrcode) await loadScript('lib/qrcode.js'); const q = window.qrcode(0, 'L'); q.addData(pg.qrUrl); q.make(); const n = q.getModuleCount(), box = 190, bx = W - PX - box, by = H - 180, pad = 15, m = (box - pad * 2) / n;
    c.fillStyle = '#fff'; c.beginPath(); c.roundRect(bx, by, box, box, 10); c.fill(); c.fillStyle = '#000'; for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (q.isDark(r, k)) c.fillRect(bx + pad + k * m, by + pad + r * m, m + 0.4, m + 0.4);
    c.fillStyle = '#fff'; c.font = font(28, 1); c.textAlign = 'right'; c.fillText('Scan for the full manual', bx - 18, H - 108); c.textAlign = 'left'; } catch (e) { console.warn('qr', e); } }
  return ZR;
}

/* ---------- list ---------- */
export function view() {
  const P = pages(), g = cfg(), ed = can.edit();
  $('fmView').innerHTML = `<div class="fbar"><h2>Home user and facilities guides</h2><span class="sp"></span>${ed ? '<button class="btn2 go" id="gNew">+ Page</button><button class="btn2" id="gSet">Phone and unit codes</button><button class="btn2" id="gImp">⬆ Import pages</button><button class="btn2" id="gStd">+ Standard pages</button>' : ''}<button class="btn2" id="gJson">⬇ Pages (.json)</button><button class="btn2 go" id="gPdf">⬇ Guides (PDF)</button><input type="file" id="gFile" accept=".json" hidden></div>
  <p class="muted small">${P.length} page${P.length === 1 ? '' : 's'} · ${P.filter(p => p.aud !== 'fm').length} in the Home User Guide, all ${P.length} plus the registers in the Facilities Guide. One topic per page, one photo, numbered pointers and a few short lines. ${g.phone ? 'Footer: call ' + esc(g.org) + ' ' + esc(g.phone) + '.' : 'Set the phone number for the footer in “Phone and unit codes”.'}</p>
  ${P.length ? `<div class="ggrid">${P.map((p, i) => `<div class="gcard" data-id="${esc(p.id)}"><canvas data-cv="${esc(p.id)}"></canvas><div class="gcap"><b>${i + 1}. ${esc(p.title || 'Untitled')}${p.aud === 'fm' ? ' <span class="badge">Facilities only</span>' : ''}</b>${ed ? `<span><button class="mini" data-up="${esc(p.id)}" title="Move earlier">↑</button><button class="mini" data-dn="${esc(p.id)}" title="Move later">↓</button></span>` : ''}</div></div>`).join('')}</div>` : '<div class="empty2">No pages yet. Add a page, or import a set of pages.</div>'}`;
  P.forEach(p => { const cv = document.querySelector(`[data-cv="${p.id}"]`); if (cv) draw(cv, p, '').catch(e => console.warn(e)); });
  document.querySelectorAll('.gcard').forEach(c => c.onclick = e => { if (e.target.closest('button')) return; edit(P.find(p => p.id === c.dataset.id)); });
  const move = async (id, d) => { const i = P.findIndex(p => p.id === id), j = i + d; if (j < 0 || j >= P.length) return; const a = P[i], b = P[j]; await S.store.patchItem(S.project.id, 'guide', a.id, { order: j + 1 }); await S.store.patchItem(S.project.id, 'guide', b.id, { order: i + 1 }); };
  document.querySelectorAll('[data-up]').forEach(b => b.onclick = () => move(b.dataset.up, -1)); document.querySelectorAll('[data-dn]').forEach(b => b.onclick = () => move(b.dataset.dn, 1));
  if ($('gNew')) $('gNew').onclick = () => edit(null);
  if ($('gSet')) $('gSet').onclick = settings;
  if ($('gStd')) $('gStd').onclick = addStandard;
  if ($('gImp')) { $('gImp').onclick = () => $('gFile').click(); $('gFile').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (f) importJson(f); }; }
  $('gJson').onclick = exportJson; $('gPdf').onclick = exportDialog;
}
function settings() {
  const g = cfg();
  X.modal(`<h2>Phone and unit codes</h2><div class="grid"><label class="f full">Who residents call (shown in the footer)<input id="gO" value="${esc(g.org)}"></label><label class="f full">Phone number<input id="gP" value="${esc(g.phone)}" placeholder="e.g. 0800 430 101"></label>
    <label class="f">Visitor code starts with<input id="gC" value="${esc(g.codePrefix)}" placeholder="e.g. 7"></label><label class="f">Digits for the unit number<input id="gD" type="number" min="1" max="4" value="${esc(g.codeDigits)}"></label></div>
    <p class="note">The visitor code is the starting number followed by the unit number, for example 7 then 15 gives 7 1 5. Use {unit} and {code} in any page text; they are filled in when the guide is exported for a unit.</p><div class="act"><button id="gsX">Cancel</button><button class="go" id="gsOk">Save</button></div>`);
  $('gsX').onclick = X.closeModal;
  $('gsOk').onclick = async () => { const o = { org: $('gO').value.trim(), phone: $('gP').value.trim(), codePrefix: $('gC').value.trim(), codeDigits: +$('gD').value || 2 }; try { await S.store.updateProject(S.project.id, { guideCfg: o }); S.project.guideCfg = o; X.closeModal(); toast('Saved'); view(); } catch (e) { toast(e.message, 6000); } };
}

/* ---------- editor ---------- */
function shell() {
  if ($('ge')) return; const el = document.createElement('div'); el.id = 'ge';
  el.innerHTML = `<div class="dvh"><button id="geX">‹ Back</button><b>Guide page</b><span class="sp"></span><button id="geZo" class="ic" title="Zoom out">−</button><button id="geZi" class="ic" title="Zoom in, to place pointers and close-ups exactly">＋</button><button id="geDel" class="ic" title="Delete this page">🗑</button><button id="geSave" class="go">Save</button></div>
    <div class="dvb"><div class="dvpage" id="geScroll"><div id="geWrap"><canvas id="geC"></canvas><div id="geO"></div></div></div><div id="geTab"><button id="geTU" title="Show more of the page">▼</button><i>page / editing</i><button id="geTD" title="Show more of the editing panel">▲</button></div><aside class="dvside" id="geSide"></aside></div>`;
  document.body.appendChild(el);
  let zm = 1; const zoom = k => { const sc = $('geScroll'), w = $('geWrap'), cx = (sc.scrollLeft + sc.clientWidth / 2) / w.offsetWidth, cy = (sc.scrollTop + sc.clientHeight / 2) / w.offsetHeight;
    zm = Math.max(1, Math.min(5, zm * k)); w.style.maxWidth = (760 * zm) + 'px'; w.style.width = zm > 1 ? (760 * zm) + 'px' : ''; sc.scrollLeft = cx * w.offsetWidth - sc.clientWidth / 2; sc.scrollTop = cy * w.offsetHeight - sc.clientHeight / 2; };
  const SZ = ['12%', '28%', '45%', '70%']; let si = 2; const setSz = d => { si = Math.max(0, Math.min(SZ.length - 1, si + d)); el.style.setProperty('--gs', SZ[si]); };
  $('geTU').onclick = () => setSz(-1); $('geTD').onclick = () => setSz(1);
  $('geZi').onclick = () => zoom(1.5); $('geZo').onclick = () => zoom(1 / 1.5);
  $('geX').onclick = tryClose; $('geSave').onclick = save; $('geDel').onclick = async () => { if (E.isNew) return close(); if (!(await confirmBox('Delete this page of the guide?', 'Delete'))) return; await S.store.deleteItem(S.project.id, 'guide', E.p.id); toast('Deleted'); close(); };
  const o = $('geO'); let drag = null;
  const frac = (e, zi) => { const b = o.getBoundingClientRect(), r = zi != null && E.zr[zi] ? E.zr[zi] : E.rect, sx = W / b.width; return { x: Math.max(0, Math.min(1, ((e.clientX - b.left) * sx - r.x) / r.w)), y: Math.max(0, Math.min(1, ((e.clientY - b.top) * sx - r.y) / r.h)) }; };
  o.addEventListener('pointerdown', e => {
    if (!E.rect) return; const h = e.target.closest('[data-h]');
    const pgXY = ev => { const b = o.getBoundingClientRect(), sx = W / b.width; return { x: (ev.clientX - b.left) * sx, y: (ev.clientY - b.top) * sx }; };
    if (h && (h.dataset.h === 'pm' || h.dataset.h === 'pr') && !E.adding) { const i = +h.dataset.i, z = E.p.zooms[i], q = E.zr[i], at = pgXY(e); if (!q) return;
      if (z.px == null) { z.px = q.x / W; z.py = q.y / H; z.pw = q.w / W; }
      drag = { i, k: h.dataset.h, dx: at.x - z.px * W, dy: at.y - z.py * H, pg: pgXY, ar: q.h / q.w }; o.setPointerCapture(e.pointerId); e.preventDefault(); return; }
    if (h && h.dataset.h !== 'pm' && h.dataset.h !== 'pr') { drag = { i: +h.dataset.i, k: h.dataset.h }; if (drag.k === 'zm') { const q = frac(e), z = E.p.zooms[drag.i]; drag.dx = q.x - z.x; drag.dy = q.y - z.y; } o.setPointerCapture(e.pointerId); e.preventDefault(); return; }
    if (E.addingZoom) { const q = frac(e); E.p.zooms.push({ x: cl(q.x - 0.11, 0, 0.78), y: cl(q.y - 0.11, 0, 0.78), w: 0.22, h: 0.22, label: '' }); E.addingZoom = false; side(); redraw(); return; }
    if (!E.adding) return; const za = e.target.closest('[data-za]'), zi = za ? +za.dataset.za : null, p = frac(e, zi); const nx = Math.max(0.08, Math.min(0.92, p.x + (p.x > 0.5 ? -0.22 : 0.22))), ny = Math.max(0.08, Math.min(0.92, p.y + (p.y > 0.3 ? -0.2 : 0.2)));
    E.p.marks.push({ tx: p.x, ty: p.y, nx, ny, label: '', sub: '', ...(zi != null ? { z: zi } : {}) }); E.adding = false; side(); redraw(); setTimeout(() => { const L = document.querySelectorAll('#geSide [data-ml]'); if (L.length) L[L.length - 1].focus(); }, 50);
  });
  o.addEventListener('pointermove', e => { if (!drag) return; const m = E.p.marks[drag.i], p = frac(e, (drag.k === 't' || drag.k === 'n') && m && m.z != null ? m.z : null);
    if (drag.k === 'pm' || drag.k === 'pr') { const z = E.p.zooms[drag.i], at = drag.pg(e);
      if (drag.k === 'pm') { z.px = cl((at.x - drag.dx) / W, 0, 1 - z.pw); z.py = cl((at.y - drag.dy) / H, 100 / H, (H - 180 - z.pw * W * drag.ar) / H); } else z.pw = cl((at.x - z.px * W) / W, 0.1, Math.min(0.9, 1 - z.px));
      cancelAnimationFrame(E.raf); E.raf = requestAnimationFrame(redraw); return; }
    if (drag.k === 'zm') { const z = E.p.zooms[drag.i]; z.x = cl(p.x - drag.dx, 0, 1 - z.w); z.y = cl(p.y - drag.dy, 0, 1 - z.h); }
    else if (drag.k === 'zr') { const z = E.p.zooms[drag.i]; z.w = cl(p.x - z.x, 0.025, 1 - z.x); z.h = cl(p.y - z.y, 0.025, 1 - z.y); }
    else if (drag.k === 't') { m.tx = p.x; m.ty = p.y; } else { m.nx = p.x; m.ny = p.y; } handles(); cancelAnimationFrame(E.raf); E.raf = requestAnimationFrame(redraw); });
  o.addEventListener('pointerup', () => { if (drag) { drag = null; redraw(); } });
}
const cl = (v, a, b) => Math.max(a, Math.min(b, v));
const snap = () => JSON.stringify(E.p);
async function tryClose() { if (E && E.snap !== snap() && !(await X.askDiscard('Your changes to this page have not been saved.'))) return; close(); }
function close(nav) { if (!E) return; $('ge').classList.remove('show'); E = null; if (nav !== true) Nav.closed('guide-ed'); view(); }
function edit(p) {
  shell(); const isNew = !p; p = p ? JSON.parse(JSON.stringify(p)) : { id: uid(), order: pages().length + 1, title: '', photo: '', marks: [], lines: '', wide: false, codeBox: false };
  p.marks = p.marks || []; p.zooms = p.zooms || []; p.steps = p.steps || []; p.docIds = p.docIds || []; E = { p, isNew, adding: false, addingZoom: false, rect: null }; E.snap = isNew ? '' : snap();
  Nav.open('guide-ed', () => close(true)); $('ge').classList.add('show'); $('geSave').style.display = $('geDel').style.display = can.edit() ? '' : 'none';
  if (p.docIds.length && !ro0()) setQr();
  side(); redraw();
}
const ro0 = () => !can.edit();
async function redraw() { if (!E) return; const tok = (E.tok = (E.tok || 0) + 1), cv = document.createElement('canvas'); const zr = await draw(cv, E.p, E.unit || ''); if (!E || tok !== E.tok) return; const c = $('geC'); c.width = W; c.height = H; c.getContext('2d').drawImage(cv, 0, 0); const img = await loadImg(E.p.photo); E.rect = photoRect(E.p, img); E.zr = zr || []; handles(); if (E.zr.over && !E.over) toast('The page is full: the last lines do not fit above the footer. Shorten the text, or make the photo or close-up smaller.', 8000); E.over = !!E.zr.over; }
function handles() {
  const o = $('geO'), r = E.rect; if (!r || !can.edit()) { o.innerHTML = ''; return; }
  const pc = (x, y, m) => { const q = m && m.z != null && E.zr[m.z] ? E.zr[m.z] : r; return `left:${(q.x + x * q.w) / W * 100}%;top:${(q.y + y * q.h) / H * 100}%`; };
  o.innerHTML = `<div class="gphoto${E.adding || E.addingZoom ? ' adding' : ''}" style="left:${r.x / W * 100}%;top:${r.y / H * 100}%;width:${r.w / W * 100}%;height:${r.h / H * 100}%"></div>`
    + (E.zr || []).map((q, i) => `<div class="gphoto gzi${E.adding ? ' adding' : ''}" data-za="${i}" data-h="pm" data-i="${i}" title="Drag to move the close-up anywhere on the page" style="left:${q.x / W * 100}%;top:${q.y / H * 100}%;width:${q.w / W * 100}%;height:${q.h / H * 100}%"><i class="gzr" data-h="pr" data-i="${i}" title="Drag to make the close-up bigger or smaller"></i></div>`).join('')
    + (E.p.zooms || []).map((z, i) => `<div class="gz" data-h="zm" data-i="${i}" title="Drag to move the close-up area" style="left:${(r.x + z.x * r.w) / W * 100}%;top:${(r.y + z.y * r.h) / H * 100}%;width:${z.w * r.w / W * 100}%;height:${z.h * r.h / H * 100}%"><i class="gzr" data-h="zr" data-i="${i}" title="Drag to resize"></i></div>`).join('')
    + E.p.marks.map((m, i) => `<div class="gh gt" data-h="t" data-i="${i}" style="${pc(m.tx, m.ty, m)}" title="Drag the arrow tip onto the item"></div><div class="gh gn" data-h="n" data-i="${i}" style="${pc(m.nx, m.ny, m)}" title="Drag the number clear of the item"></div>`).join('');
}
function side() {
  const p = E.p, ro = !can.edit();
  $('geSide').innerHTML = `${ro ? '' : `<div class="gtalk"><h4>🎤 Talk it through</h4><p class="muted small">Stand at the item, take the photo, then say what it is and how residents use it. Claude writes the page: title, pointers on the photo and short lines.</p>
    <textarea id="geTk" rows="3" placeholder="e.g. This is the oven. Dial on the left is the function, right is temperature. Timer in the middle. Child lock: hold the key for three seconds.">${esc(E.talk || '')}</textarea>
    <p class="gtbtn"><button class="mini" id="geMic">🎤 Speak</button> <button class="mini go" id="geAi">✨ Write this page</button> <span class="muted small" id="geSt"></span></p></div>`}<label class="f">Page title<input id="geT" value="${esc(p.title)}" placeholder="e.g. Oven"></label>
    <h4>Photo</h4><p><button class="mini" id="geCam">📷 Take a photo</button> <button class="mini" id="geP">${p.photo ? 'Choose another photo' : '⬆ Choose a photo'}</button> ${p.photo && !ro ? '<button class="mini" id="geDraw" title="Circle, arrow, box, text and freehand, the same tools as on defect photos">✏ Draw on the photo</button>' : ''} ${p.photoOrig && !ro ? '<button class="mini" id="geUndraw">↩ Remove the drawing</button>' : ''} ${p.photo ? '<button class="mini" id="gePx">Remove</button>' : ''}<input type="file" id="gePF" accept="image/*" hidden><input type="file" id="gePC" accept="image/*" capture="environment" hidden></p>
    <label class="dvall"><input type="checkbox" id="geW" ${p.wide ? 'checked' : ''}> Full-width photo (for plans and wide pictures)</label>
    <h4>Pointers</h4><p class="muted small">Press “Add a pointer”, then click the item in the photo. Drag the arrow tip onto the item and the number clear of it, so nothing is covered.</p>
    ${p.marks.map((m, i) => `<div class="gmark"><i>${i + 1}</i><div><input data-ml="${i}" value="${esc(m.label)}" placeholder="What it is, e.g. Timer"><input data-ms="${i}" value="${esc(m.sub)}" placeholder="What to do, in a few words"></div>${p.zooms.length && !ro ? `<button class="mini" data-mz="${i}" title="Where this pointer sits. Press to move it to the photo or a close-up">${m.z != null ? '🔍' + (m.z + 1) : '📷'}</button>` : ''}<button class="mini" data-mx="${i}" title="Remove">✕</button></div>`).join('')}
    ${p.zooms.length && p.marks.length && !ro ? '<p class="muted small">📷 means the pointer is on the photo, 🔍1 on the first close-up. Press it to move the pointer across, then drag it into place.</p>' : ''}
    ${p.photo && !ro ? `<p><button class="mini${E.adding ? ' on' : ''}" id="geAdd">${E.adding ? 'Now click the item, in the photo or a close-up…' : '+ Add a pointer'}</button></p>` : ''}
    <h4>Step by step</h4><p class="muted small">For things done in order, like lifting the clothesline and locking the pin. One photo and one short line per step, up to 6. They print as numbered photos in two columns.</p>
    ${p.steps.map((t, i) => `<div class="gmark"><i>${i + 1}</i><div>${t.photo ? `<img src="${esc(t.photo.startsWith('data:') ? t.photo : '')}" data-sti="${i}" class="gstim">` : ''}<input data-st="${i}" value="${esc(t.text)}" placeholder="What to do, e.g. Lift the frame up"><span><button class="mini" data-stc="${i}">📷 Take</button> <button class="mini" data-stp="${i}">Choose</button>${t.photo ? ` <button class="mini" data-std="${i}">✏ Draw</button>` : ''}</span></div><button class="mini" data-stx="${i}" title="Remove">✕</button></div>`).join('')}
    ${ro || p.steps.length >= 6 ? '' : '<p><button class="mini" id="geStA">+ Add a step</button></p>'}<input type="file" id="geStF" accept="image/*" hidden><input type="file" id="geStC" accept="image/*" capture="environment" hidden>
    <h4>Close-ups</h4><p class="muted small">Show a small part of the photo larger, such as a dial or a control panel. Press “Add a close-up”, click the part, then drag the box to fit it.</p>
    ${p.zooms.map((z, i) => `<div class="gmark"><i>🔍</i><div><input data-zl="${i}" value="${esc(z.label)}" placeholder="Caption, e.g. The heat dial: 1 is low, 9 is high"></div>${z.px != null && !ro ? `<button class="mini" data-za0="${i}" title="Put it back under the photo automatically">↺</button>` : ''}<button class="mini" data-zx="${i}" title="Remove">✕</button></div>`).join('')}
    ${p.zooms.length && !ro ? '<p class="muted small">Drag the enlarged close-up on the page to move it anywhere, including over the photo. Drag its corner to resize it. ↺ puts it back under the photo.</p>' : ''}
    ${p.photo && !ro && p.zooms.length < 2 ? `<p><button class="mini${E.addingZoom ? ' on' : ''}" id="geZoom">${E.addingZoom ? 'Now click the part of the photo…' : '+ Add a close-up'}</button></p>` : ''}
    <h4>Source documents</h4><p class="muted small">Link the manual or care guide for this item. The AI then writes the steps from it, and can check the page against it.</p>
    ${linked().map(d => `<div class="aedoc">📄 <a href="#" data-gd="${esc(d.id)}">${esc(d.title || d.fileName)}</a>${ro ? '' : ` <button class="mini" data-gdx="${esc(d.id)}" title="Unlink">✕</button>`}</div>`).join('')}
    ${ro ? '' : `${suggest().map(d => `<div class="aedoc small">Looks related: ${esc(d.title)} <button class="mini" data-gdl="${esc(d.id)}">Link it</button></div>`).join('')}
    ${p.docIds.length ? `<label class="dvall"><input type="checkbox" id="geQr" ${p.qr !== false ? 'checked' : ''}> Print a QR code to ${linked().length > 1 ? 'the first document' : 'this document'} on the page. Anyone who scans it can open the document, with no sign-in.</label>` : ''}
    <input id="geDq" placeholder="Find a document: type part of its name"><div id="geDl"></div>
    ${p.docIds.length ? '<p><button class="mini" id="geChk">✨ Check this page against the document</button> <span class="muted small" id="geChkSt"></span></p><div id="geChkOut"></div>' : ''}`}
    <h4>Short lines under the photo</h4><textarea id="geL" rows="5" placeholder="One line each. Start a line with ! to make it stand out.">${esc(p.lines)}</textarea>
    <label class="dvall"><input type="checkbox" id="geTb" ${p.table ? 'checked' : ''}> Show the lines as a table (first line is the heading, split columns with |)</label>
    <label class="dvall" style="margin-top:8px"><input type="checkbox" id="geCB" ${p.codeBox ? 'checked' : ''}> Show the unit's visitor code in a large box</label>
    <label class="f" style="margin-top:10px">Which guide<select id="geA"><option value="both" ${p.aud !== 'fm' ? 'selected' : ''}>Both guides (residents and facilities)</option><option value="fm" ${p.aud === 'fm' ? 'selected' : ''}>Facilities Guide only</option></select></label>
    <label class="f" style="margin-top:10px">Preview for unit<input id="geU" value="${esc(E.unit || '')}" placeholder="e.g. 15"></label>
    <p class="muted small">Keep it short: residents need to know what it is and what to do. {unit} and {code} are filled in for each unit.</p>`;
  const upd = () => { p.title = $('geT').value; p.lines = $('geL').value; p.wide = $('geW').checked; p.codeBox = $('geCB').checked; p.table = $('geTb').checked; p.aud = $('geA').value; if ($('geQr')) p.qr = $('geQr').checked; E.unit = $('geU').value.trim(); document.querySelectorAll('#geSide [data-ml]').forEach(i => p.marks[+i.dataset.ml].label = i.value); document.querySelectorAll('#geSide [data-ms]').forEach(i => p.marks[+i.dataset.ms].sub = i.value); document.querySelectorAll('#geSide [data-zl]').forEach(i => p.zooms[+i.dataset.zl].label = i.value); document.querySelectorAll('#geSide [data-st]').forEach(i => p.steps[+i.dataset.st].text = i.value); clearTimeout(E.t); E.t = setTimeout(redraw, 250); };
  $('geSide').querySelectorAll('input,textarea').forEach(i => { if (i.type !== 'file' && i.id !== 'geDq') i.oninput = i.onchange = upd; });
  $('geSide').querySelectorAll('[data-zx]').forEach(b => b.onclick = () => { upd(); const k = +b.dataset.zx; p.zooms.splice(k, 1); p.marks = p.marks.filter(m => m.z !== k).map(m => m.z > k ? { ...m, z: m.z - 1 } : m); side(); redraw(); });
  // steps
  let stAt = -1; const stPick = async e => { const f = e.target.files[0]; e.target.value = ''; if (!f || stAt < 0) return; upd(); const b = busy('Preparing the photo…'); try { p.steps[stAt].photo = (await compressImage(f, 1400, 0.82)).dataUrl; b.done(); side(); redraw(); } catch (x) { b.done(); toast('Could not read that photo: ' + x.message, 5000); } };
  $('geStF').onchange = stPick; $('geStC').onchange = stPick;
  if ($('geStA')) $('geStA').onclick = () => { upd(); p.steps.push({ photo: '', text: '' }); side(); };
  $('geSide').querySelectorAll('[data-stc]').forEach(b => b.onclick = () => { stAt = +b.dataset.stc; $('geStC').click(); });
  $('geSide').querySelectorAll('[data-stp]').forEach(b => b.onclick = () => { stAt = +b.dataset.stp; $('geStF').click(); });
  $('geSide').querySelectorAll('[data-stx]').forEach(b => b.onclick = () => { upd(); p.steps.splice(+b.dataset.stx, 1); side(); redraw(); });
  $('geSide').querySelectorAll('[data-std]').forEach(b => b.onclick = async () => { upd(); const t = p.steps[+b.dataset.std]; let src = t.photo; try { if (!src.startsWith('data:')) src = await urlToDataUrl(src); } catch (e) { return toast('Could not open the photo: ' + e.message, 6000); } markup(src, d => { if (!E) return; t.photo = d; side(); redraw(); }, (p.title || 'Guide') + ' step ' + (+b.dataset.std + 1)); });
  $('geSide').querySelectorAll('[data-sti]').forEach(async im => { if (!im.src || im.src === location.href) { try { im.src = await S.store.resolveUrl(p.steps[+im.dataset.sti].photo); } catch (e) {} } });
  $('geSide').querySelectorAll('[data-za0]').forEach(b => b.onclick = () => { upd(); const z = p.zooms[+b.dataset.za0]; delete z.px; delete z.py; delete z.pw; side(); redraw(); });
  if ($('geZoom')) $('geZoom').onclick = () => { upd(); E.addingZoom = !E.addingZoom; E.adding = false; side(); handles(); };
  if ($('geDraw')) $('geDraw').onclick = async () => { upd(); let src = p.photo; try { if (!src.startsWith('data:')) src = await urlToDataUrl(src); } catch (e) { return toast('Could not open the photo for drawing: ' + e.message, 6000); }
    markup(src, data => { if (!E) return; if (!p.photoOrig) p.photoOrig = p.photo; p.photo = data; side(); redraw(); }, p.title || 'Guide photo'); };
  if ($('geUndraw')) $('geUndraw').onclick = () => { upd(); p.photo = p.photoOrig; delete p.photoOrig; side(); redraw(); };
  // source documents
  const linkDoc = id => { upd(); if (!p.docIds.includes(id)) p.docIds.push(id); setQr(); side(); redraw(); };
  $('geSide').querySelectorAll('[data-gdl]').forEach(b => b.onclick = () => linkDoc(b.dataset.gdl));
  $('geSide').querySelectorAll('[data-gdx]').forEach(b => b.onclick = () => { upd(); p.docIds = p.docIds.filter(i => i !== b.dataset.gdx); setQr(); side(); redraw(); });
  $('geSide').querySelectorAll('[data-gd]').forEach(a => a.onclick = async e => { e.preventDefault(); const d = libDocs().find(x => x.id === a.dataset.gd); if (d) try { window.open(await S.store.resolveUrl(d.url), '_blank'); } catch (x) {} });
  if ($('geDq')) $('geDq').oninput = () => { const q = $('geDq').value.trim().toLowerCase(); if (q.length < 2) { $('geDl').innerHTML = ''; return; }
    const hits = libDocs().filter(d => !p.docIds.includes(d.id) && [d.title, d.fileName, d.party].join(' ').toLowerCase().includes(q)).slice(0, 8);
    $('geDl').innerHTML = hits.map(d => `<div class="aehit" data-gdh="${esc(d.id)}">${esc(d.title || d.fileName)} <span class="muted small">${esc(d.type || '')}</span></div>`).join('') || '<p class="muted small">Nothing in the library matches.</p>';
    $('geDl').querySelectorAll('[data-gdh]').forEach(x => x.onclick = () => linkDoc(x.dataset.gdh)); };
  if ($('geChk')) $('geChk').onclick = () => { upd(); checkPage(); };
  $('geSide').querySelectorAll('[data-mx]').forEach(b => b.onclick = () => { upd(); p.marks.splice(+b.dataset.mx, 1); side(); redraw(); });
  $('geSide').querySelectorAll('[data-mz]').forEach(b => b.onclick = () => { upd(); const m = p.marks[+b.dataset.mz], nz = m.z == null ? 0 : m.z + 1 < p.zooms.length ? m.z + 1 : null; if (nz == null) delete m.z; else m.z = nz; m.tx = 0.5; m.ty = 0.55; m.nx = 0.22; m.ny = 0.22; side(); redraw(); });
  if ($('geAdd')) $('geAdd').onclick = () => { upd(); E.adding = !E.adding; side(); handles(); };
  if ($('geTk')) { $('geTk').oninput = () => { E.talk = $('geTk').value; };
    $('geMic').onclick = () => dictate($('geTk'), $('geMic'), (m, bad) => { $('geSt').textContent = m || ''; $('geSt').style.color = bad ? '#c0392b' : ''; }, () => { E.talk = $('geTk').value; });
    $('geAi').onclick = () => { upd(); writePage(); }; }
  $('geP').onclick = () => $('gePF').click(); if ($('gePx')) $('gePx').onclick = () => { upd(); p.photo = ''; p.marks = []; p.zooms = []; delete p.photoOrig; side(); redraw(); };
  $('geCam').onclick = () => $('gePC').click(); $('gePC').onchange = e => $('gePF').onchange(e);
  $('gePF').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; upd(); const b = busy('Preparing the photo…'); try { p.photo = (await compressImage(f, 1600, 0.82)).dataUrl; delete p.photoOrig; b.done(); side(); redraw(); } catch (x) { b.done(); toast('Could not read that photo: ' + x.message, 5000); } };
}
// The documents a page is written from: manuals, care guides, product data and warranties in the library
const libDocs = () => ((S.fm && S.fm.docs) || []).filter(d => d.url && !d.superseded && !d.restricted);
const setQr = () => { const d = linked()[0]; E.p.qrUrl = d && /^https?:/.test(d.url || '') ? d.url : ''; };
const linked = () => (E.p.docIds || []).map(id => libDocs().find(d => d.id === id)).filter(Boolean);
const GWORDS = new Set(['your', 'the', 'and', 'for', 'unit', 'units', 'how', 'use', 'using', 'with', 'page', 'guide', 'home', 'new']);
function suggest() { const p = E.p; if ((p.docIds || []).length) return [];
  const ws = [...new Set((p.title + ' ' + (E.talk || '')).toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 3 && !GWORDS.has(w)))]; if (!ws.length) return [];
  return libDocs().filter(d => /manual|care|maintenance|product data|warrant/i.test(d.type || '')).map(d => { const t = (d.title || '').toLowerCase(); return [d, ws.filter(w => t.includes(w) || t.includes(w.replace(/s$/, ''))).length + (/manual|care/i.test(d.type || '') ? 0.5 : 0)]; }).filter(x => x[1] >= 1).sort((a, b) => b[1] - a[1]).slice(0, 3).map(x => x[0]); }
async function docsText(max = 7000) { let out = ''; const scans = [];
  for (const d of linked().slice(0, 3)) { let t = ''; try { t = await FT.textOf(await X.getBytes(d.url), d.fileName || 'x.pdf', max); } catch (e) {} if (t.trim().length > 80) out += `\n--- ${d.title} (${d.type || ''})\n${t}\n`; else scans.push(d.title); }
  return { text: out, scans }; }
// The AI compares the page with the linked documents and lists anything that does not match or is missing
async function checkPage() {
  const st = $('geChkSt'), outEl = $('geChkOut'), p = E.p; st.textContent = 'Reading the document…'; $('geChk').disabled = true; outEl.innerHTML = '';
  try { const { text, scans } = await docsText(9000); if (!text) throw new Error(scans.length ? 'the linked document is a scan with no readable text' : 'no document could be read');
    st.textContent = 'Checking…';
    const ans = await aiCall(`You check one page of a Home User Guide for residents (older New Zealanders) against the manufacturer's documents. The page must be right, short and safe.
THE PAGE: title "${p.title}"; pointers ${JSON.stringify(p.marks.map(m => ({ label: m.label, sub: m.sub })))}; close-up captions ${JSON.stringify(p.zooms.map(z => z.label))}; lines ${JSON.stringify(p.lines)}.
THE DOCUMENTS:${text.slice(0, 26000)}
List only real problems: a step, button name, time, setting or number on the page that differs from the documents; an important safety point or everyday step from the documents that is missing; anything on the page the documents do not support. Do not ask for more detail than a resident needs. New Zealand English, no em dashes.
Return JSON only: {"ok": true or false, "issues": [{"what": "the problem in one short sentence", "fix": "the corrected wording to use"}]}`);
    const j = JSON.parse(String(ans).replace(/^[^{]*/, '').replace(/[^}]*$/, '')), I = (j.issues || []).slice(0, 8);
    st.textContent = ''; outEl.innerHTML = I.length ? `<div class="gchk">${I.map(x => `<div><b>${esc(x.what || '')}</b>${x.fix ? `<br><span class="small">Use: ${esc(x.fix)}</span>` : ''}</div>`).join('')}</div>` : '<p class="ok small">✔ The page matches the document.</p>';
    if (scans.length) outEl.insertAdjacentHTML('beforeend', `<p class="muted small">Not read (scanned, no text): ${esc(scans.join('; '))}</p>`);
  } catch (e) { st.textContent = ''; toast('Could not check the page: ' + (e.message === 'nokey' ? 'set up the AI helper first' : e.message), 7000); } finally { if ($('geChk')) $('geChk').disabled = false; }
}
// Claude turns what was said at the item (and the photo) into a guide page: title, pointers placed on the photo, short lines.
async function writePage() {
  stopDictation(); const p = E.p, talk = ($('geTk').value || '').trim(); E.talk = talk;
  if (!talk && !p.photo && !p.docIds.length) return toast('Take the photo and say a few words about the item first');
  const st = $('geSt'); st.style.color = ''; st.textContent = 'Claude is writing the page…'; $('geAi').disabled = true;
  try {
    let img = ''; if (p.photo) { try { img = p.photo.startsWith('data:') ? p.photo : await urlToDataUrl(p.photo); } catch (e) { img = ''; } }
    const pj = S.project || {}, g = cfg(); let src = { text: '', scans: [] }; if (p.docIds.length) { st.textContent = 'Reading the linked document…'; src = await docsText(); st.textContent = 'Claude is writing the page…'; }
    const prompt = `You write one page of a Home User Guide for residents of a new apartment for older people. ${pj.aiContext ? 'PROJECT KNOWLEDGE: ' + String(pj.aiContext).slice(0, 12000) + '\n' : ''}
Residents are older New Zealanders. Write plainly and warmly, New Zealand English, no em dashes, no jargon. One topic per page. Say what it is and what to do, never how it is built.
They call ${g.org || 'Haumaru Housing'}${g.phone ? ' on ' + g.phone : ''} if something is not working; never tell them to fix, open or adjust anything themselves beyond normal use. Use {unit} or {code} only if the unit number or visitor code is needed.
CURRENT PAGE: title "${p.title || ''}"; pointers: ${JSON.stringify((p.marks || []).map(m => ({ label: m.label, sub: m.sub })))}; lines: ${JSON.stringify(p.lines || '')}.
WHAT TONY SAID (a description of the item, or an instruction about what to change on this page; follow it exactly and change nothing else he did not ask for): ${talk || '(nothing; work from the photo)'}
${src.text ? "THE MANUFACTURER'S DOCUMENTS FOR THIS ITEM (take the exact steps, button names, hold times and safety points from these; do not invent any):" + src.text.slice(0, 20000) : ''}
${img ? 'The photo of the item is attached.' : 'There is no photo yet, so return no pointers.'}
Return JSON only: {"title":"2 to 4 words","marks":[{"label":"what it is, 1 to 3 words","sub":"what to do, up to 7 words","x":0.0,"y":0.0}],"lines":["short line","..."],"closeup":{"x":0.0,"y":0.0,"w":0.0,"h":0.0,"label":"short caption"}}
"closeup" is optional: include it only when the controls or markings are too small to read in the photo. x,y is its top left corner and w,h its size, all as fractions of the photo; the caption says what the close-up shows and how to read it, in up to 12 words.
${p.marks.length ? `The page already has ${p.marks.length} pointers placed by hand. Return exactly ${p.marks.length} marks, in the same order and about the same things (rewrite their words only; their x,y are ignored).` : ''} Rules: up to 6 pointers, each placed with x,y as fractions 0 to 1 of the photo width and height on the exact item, measured from the top left. Up to 5 lines, each under 14 words. Start a line with ! if it is about safety or something that must not be done. Keep anything in the current page that is still right, and use what Tony said where it differs.`;
    const out = String(await aiCall(prompt, img || undefined) || '').replace(/^```(?:json)?\s*|\s*```$/g, '');
    let j = null; try { j = JSON.parse(out); } catch (e) { const m = /\{[\s\S]*\}/.exec(out); if (m) j = JSON.parse(m[0]); }
    if (!j) throw new Error('the answer could not be read');
    if (j.title) p.title = String(j.title).slice(0, 60);
    if (Array.isArray(j.lines)) p.lines = j.lines.map(String).join('\n');
    // pointers you have already placed keep their positions (on the photo or a close-up): only their words are rewritten
    if (p.marks.length && Array.isArray(j.marks)) p.marks.forEach((m, i) => { const n = j.marks[i]; if (n) { if (n.label) m.label = String(n.label); if (n.sub) m.sub = String(n.sub); } });
    else if (p.photo && Array.isArray(j.marks) && j.marks.length) p.marks = j.marks.slice(0, 6).map(m => { const x = Math.max(0.02, Math.min(0.98, +m.x || 0.5)), y = Math.max(0.02, Math.min(0.98, +m.y || 0.5)); return { tx: x, ty: y, nx: Math.max(0.08, Math.min(0.92, x + (x > 0.5 ? -0.22 : 0.22))), ny: Math.max(0.08, Math.min(0.92, y + (y > 0.3 ? -0.2 : 0.2))), label: String(m.label || ''), sub: String(m.sub || '') }; });
    const cu = j.closeup; if (p.photo && !p.zooms.length && cu && +cu.w > 0.04 && +cu.h > 0.04) { const w = cl(+cu.w, 0.06, 0.9), h = cl(+cu.h, 0.06, 0.9); p.zooms = [{ x: cl(+cu.x || 0, 0, 1 - w), y: cl(+cu.y || 0, 0, 1 - h), w, h, label: String(cu.label || '').slice(0, 120) }]; }
    side(); redraw(); const s2 = $('geSt'); if (s2) s2.textContent = 'Done' + (src.text ? ', written from the linked document' : src.scans.length ? ' (the linked document is a scan and could not be read)' : '') + '. Check the pointers sit on the right things (drag them if not), then Save.';
  } catch (e) { const s2 = $('geSt'); if (s2) { s2.style.color = '#c0392b'; s2.textContent = e.message === 'nokey' ? 'Set up the AI helper first (Menu).' : e.message === 'offline' ? 'No connection. Your words are kept; try again when you have reception.' : 'Could not write the page: ' + e.message; } }
  finally { const b = $('geAi'); if (b) b.disabled = false; }
}
async function save() {
  const p = E.p; if (!p.title.trim()) return toast('Give the page a title');
  const b = busy('Saving…');
  try { if (p.photo && p.photo.startsWith('data:')) { const src = p.photo; p.photo = await S.store.putFile(`projects/${S.project.id}/docs/guide-${p.id}/photo-${Date.now()}.jpg`, dataUrlToBlob(src), true); imgCache[p.photo] = imgCache[src]; }
    for (const [i, t] of (p.steps || []).entries()) if (t.photo && t.photo.startsWith('data:')) { const src = t.photo; t.photo = await S.store.putFile(`projects/${S.project.id}/docs/guide-${p.id}/step${i + 1}-${Date.now()}.jpg`, dataUrlToBlob(src), true); imgCache[t.photo] = imgCache[src]; }
    if (p.photoOrig && p.photoOrig.startsWith('data:')) p.photoOrig = await S.store.putFile(`projects/${S.project.id}/docs/guide-${p.id}/photo-orig-${Date.now()}.jpg`, dataUrlToBlob(p.photoOrig), true);
    await S.store.saveItem(S.project.id, 'guide', { ...p, updated: new Date().toISOString(), updatedBy: S.user.email }); b.done(); toast('Saved'); E.snap = snap(); close(); }
  catch (e) { b.done(); toast('Could not save: ' + e.message, 6000); }
}

/* ---------- export and import ---------- */
function exportDialog() {
  const P = pages(); if (!P.length) return toast('Add a page first');
  const nh = P.filter(p => p.aud !== 'fm').length;
  X.modal(`<h2>Export a guide</h2>
    <label class="f">Which guide<select id="geuK"><option value="home">Home User Guide, for residents (${nh} pages)</option><option value="fm">Facilities Guide, for the building team (${P.length} pages plus the registers)</option></select></label>
    <label class="f" style="margin-top:8px">For unit (leave blank for a general copy)<input id="geuU" placeholder="e.g. 15, or 1-42 for every unit"></label>
    <p class="note">A range such as 1-42 makes one PDF per unit, each with that unit's visitor code, in a single zip file. The Facilities Guide adds the contacts, asset and warranty register, maintenance schedule and compliance schedule from this app.</p><div class="act"><button id="geuX">Cancel</button><button class="go" id="geuOk">Export</button></div>`);
  $('geuX').onclick = X.closeModal;
  $('geuOk').onclick = async () => { const v = $('geuU').value.trim(), kind = $('geuK').value, m = /^(\d+)\s*-\s*(\d+)$/.exec(v); X.closeModal(); const units = m ? Array.from({ length: +m[2] - +m[1] + 1 }, (_, i) => String(+m[1] + i)) : [v];
    const nm = kind === 'fm' ? 'Facilities Guide' : 'Home User Guide', b = busy('Building the guide…');
    try { const files = []; for (const [i, u] of units.entries()) { b.set(units.length > 1 ? `Building unit ${u} (${i + 1} of ${units.length})…` : 'Building the guide…'); files.push({ name: `${safeName(S.project.name)} - ${nm}${u ? ' - Unit ' + u : ''}.pdf`, blob: await pdf(u, kind) }); }
      b.done(); if (files.length === 1) return deliver(files[0].blob, files[0].name, nm);
      if (!window.JSZip) await loadScript('lib/jszip.min.js'); const z = new window.JSZip(); files.forEach(f => z.file(f.name, f.blob)); deliver(await z.generateAsync({ type: 'blob' }), `${safeName(S.project.name)} - ${nm}s - ${stamp()}.zip`, nm + 's'); }
    catch (e) { b.done(); console.error(e); toast('Could not build the guide: ' + e.message, 7000); } };
}
async function pdf(unit, kind = 'home') {
  if (!window.PDFLib) await loadScript('lib/pdf-lib.min.js'); const doc = await window.PDFLib.PDFDocument.create(), cv = document.createElement('canvas');
  for (const p of pages().filter(p => kind === 'fm' || p.aud !== 'fm')) { await draw(cv, p, unit); const bytes = await (await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.86))).arrayBuffer(); const im = await doc.embedJpg(bytes), pg = doc.addPage([595.28, 841.89]); pg.drawImage(im, { x: 0, y: 0, width: 595.28, height: 841.89 }); }
  if (kind === 'fm') await registers(doc);
  return new Blob([await doc.save()], { type: 'application/pdf' });
}
// Facilities Guide registers, straight from the app's data so they never drift from the warranty register
async function registers(doc) {
  const P = window.PDFLib, f = await doc.embedFont(P.StandardFonts.Helvetica), fb = await doc.embedFont(P.StandardFonts.HelveticaBold), pr = S.project, F = S.fm || {};
  const Wp = 841.89, Hp = 595.28, M = 32, hx = h => { const n = parseInt(h.slice(1), 16); return P.rgb((n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255); }, NV = hx(NAVY), GR = hx('#6a7886'), LN = hx('#d5dae1');
  const cl = t => String(t == null ? '' : t).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[^\n\x20-\x7e]/g, '');
  const wr = (t, font, sz, mw) => { const out = []; cl(t).split('\n').forEach(par => { let ln = ''; par.split(/\s+/).forEach(w => { const tr = ln ? ln + ' ' + w : w; if (font.widthOfTextAtSize(tr, sz) <= mw) ln = tr; else { if (ln) out.push(ln); ln = w; } }); if (ln) out.push(ln); }); return out.length ? out : ['']; };
  const nz = s => { if (!s) return ''; const d = new Date(String(s).slice(0, 10) + 'T00:00'); return isNaN(d) ? s : d.toLocaleDateString('en-NZ', { day: '2-digit', month: 'short', year: 'numeric' }); };
  let pg, y, title;
  const page = () => { pg = doc.addPage([Wp, Hp]); pg.drawRectangle({ x: 0, y: Hp - 46, width: Wp, height: 46, color: NV }); pg.drawText(cl(title), { x: M, y: Hp - 30, size: 15, font: fb, color: P.rgb(1, 1, 1) }); pg.drawText(cl((pr.name || '') + '  |  Facilities Guide'), { x: M, y: 16, size: 7.5, font: f, color: GR }); y = Hp - 70; };
  const table = (t, note, cols, rows) => { title = t; page(); if (note) { wr(note, f, 8.5, Wp - 2 * M).forEach(l => { pg.drawText(l, { x: M, y, size: 8.5, font: f, color: GR }); y -= 12; }); y -= 4; }
    const tw = cols.reduce((a, c) => a + c[1], 0), C = cols.map(c => [c[0], c[1] * (Wp - 2 * M) / tw]);
    const head = () => { pg.drawRectangle({ x: M, y: y - 5, width: Wp - 2 * M, height: 15, color: NV }); let x = M; C.forEach(([h, w]) => { pg.drawText(cl(h), { x: x + 4, y, size: 7.5, font: fb, color: P.rgb(1, 1, 1) }); x += w; }); y -= 9; };
    head(); if (!rows.length) { pg.drawText('Nothing recorded in the app yet.', { x: M + 4, y: y - 12, size: 8.5, font: f, color: GR }); return; }
    rows.forEach(r => { const cells = r.map((v, i) => wr(v, f, 7.5, C[i][1] - 8)), hh = 5 + 9.5 * Math.max(...cells.map(c => c.length)); if (y - hh < 30) { page(); head(); }
      let x = M; cells.forEach((ls, i) => { ls.forEach((l, k) => pg.drawText(l, { x: x + 4, y: y - 9 - k * 9.5, size: 7.5, font: f })); x += C[i][1]; }); y -= hh; pg.drawLine({ start: { x: M, y }, end: { x: Wp - M, y }, thickness: 0.5, color: LN }); }); };
  const A = (F.assets || []).filter(a => !/^(Not applicable|NA|N\/A)$/i.test(a.status || '')).slice().sort((a, b) => natural(a.ref || '', b.ref || ''));
  const dir = (pr.directory || []).filter(c => c.audience !== 'Not shown').slice().sort((a, b) => natural(a.company || '', b.company || ''));
  table('Contacts', 'Who to call for each part of the building. Warranty claims go to the company that installed the item; the asset register shows who that is.', [['Company', 150], ['Trade / what they did', 190], ['Contact', 110], ['Phone', 90], ['After hours', 80], ['Email', 160]], dir.map(c => [c.company, c.trade, c.name, c.phone, c.afterHours, c.email]));
  table('Asset and warranty register', 'Every building element, the product used, who installed it and how long it is covered. Expiry dates run from practical completion unless stated.', [['Ref', 36], ['Element', 130], ['Product', 150], ['Location', 90], ['Installer', 100], ['Warranty', 170], ['Expires', 64]],
    A.map(a => { const W2 = a.warranties || [], ex = W2.map(warrantyExpiry).filter(Boolean).sort(); return [a.ref, a.element, a.product, a.location, a.installer, W2.length ? W2.map(w => [w.label, w.party && '(' + w.party + ')', w.months && w.months + ' months'].filter(Boolean).join(' ')).join('; ') : [a.instWarranty, a.mfrWarranty].filter(x => x && x !== '-').join('; '), ex.length ? nz(ex[0]) : '']; }));
  const T = (F.tasks || []).slice().sort((a, b) => natural(a.system || '', b.system || '') || natural(a.title || '', b.title || ''));
  table('Maintenance schedule', 'Routine tasks to keep warranties valid and the building working. Tasks marked with a specified system (SS) are part of the Building Warrant of Fitness.', [['Task', 190], ['SS', 36], ['Asset', 120], ['How often', 80], ['Who does it', 110], ['Next due', 64], ['Instructions', 200]],
    T.map(t => [t.title, t.ss, ((F.assets || []).find(a => a.id === t.assetId) || {}).element || '', freqText(t), t.responsible, nz(t.nextDue), t.instructions]));
  table('Compliance schedule (specified systems)', [pr.csNumber && 'Compliance schedule ' + pr.csNumber, pr.bwofDue && 'BWoF due ' + nz(pr.bwofDue), pr.iqp && 'IQP ' + pr.iqp].filter(Boolean).join('  |  '), [['SS', 40], ['System', 170], ['Location', 120], ['Performance standard', 150], ['Inspection and maintenance', 300]],
    (F.systems || []).slice().sort((a, b) => natural(a.ss || '', b.ss || '')).map(s => [s.ss, s.name, s.location, s.standard, s.inspections]));
}
// A starting set of pages for a seniors apartment building. Text is short and plain; anything not yet confirmed is marked [CONFIRM].
const STANDARD = [
  { key: 'welcome', title: 'Welcome to your home', lines: '! Your home is unit {unit}\nYour home is Homestar 6 rated. It is warm, dry and costs less to heat.\n! Something not working? Call Haumaru on 0800 430 101\nPlease do not call builders or tradespeople yourself. We will arrange it.' },
  { key: 'plan', title: 'Your home at a glance', wide: true, lines: 'Add a marked-up plan of the unit: front door, water shut-off, hot water cylinder, ventilation dial, switchboard.' },
  { key: 'warm', title: 'Staying warm and dry', lines: 'Use the heat pump to heat your home. [CONFIRM make and model]\nOpen a window for a short time each day to let fresh air in.\nTurn the rangehood on when you cook.\nWipe water off the windows on cold mornings.\n! Tell us if you see mould.' },
  { key: 'vent', title: 'The ventilation dial', lines: 'The dial on the wall controls the ventilation fan. It is not an on/off switch.\nThe fan always runs. It speeds up and slows down with the temperature.\n! Do not cover the vents.' },
  { key: 'water', title: 'Water and hot water', lines: '! Know where your water shut-off is. [CONFIRM location, add a marked-up photo]\nIf a pipe leaks, turn the water off, then call us.\nHot water comes from an electric cylinder (Rheem). No hot water? Call us.' },
  { key: 'oven', title: 'Your kitchen', lines: 'Oven and cooktop: [CONFIRM from the product manual for this unit: Haier or Midea oven, Haier or Whirlpool cooktop]\nTurn the rangehood on when you cook. It takes steam and smells outside.\nThe rangehood filter needs cleaning. [CONFIRM how often from the manual]' },
  { key: 'fire', title: 'Smoke alarms and sprinklers', lines: 'The round fitting on the ceiling is a smoke detector.\nThe sprinklers turn on with heat, not smoke.\n! Never hang anything from a sprinkler or paint over it.\n! If there is a fire, get out, close the door behind you and call 111.' },
  { key: 'visitors', title: 'Visitors and the intercom', codeBox: true, lines: 'Your visitors press 7, then your unit number.\nDoor 1 (left) is the main entrance. Door 2 (right) is the second door.\nYou can only open the door your visitor is speaking from.' },
  { key: 'rubbish', title: 'Rubbish and recycling', lines: 'Green Gorilla collects rubbish from the building.\nGeneral rubbish, recycling and food scraps go in separate bins.\nRinse cans, bottles and containers before recycling.\nNo plastic bags in the recycling. [CONFIRM bin room location]' },
  { key: 'washing', title: 'Washing lines and gardens', lines: 'Use the covered washing line outside your unit, or the longer lines by the community gardens.\n! Please do not dry washing inside. It makes the home damp.\nThe orchard, herb garden and vegetable gardens are for everyone. Fruit trees: [CONFIRM]' },
  { key: 'appliances', title: 'Your appliances', table: true, lines: 'Item | Make | Model | Good to know\nOven | [CONFIRM] | [CONFIRM] | Manual at the back of this guide\nCooktop | [CONFIRM] | [CONFIRM] | Ceramic top: wipe when cool\nRangehood | Haier | HC60BLX1 | Use when cooking\nHot water | Rheem | [CONFIRM] | Electric cylinder\nHeat pump | [CONFIRM] | [CONFIRM] | Remote on the wall\nVentilation | Fantech | TD Silent | Runs all the time' },
  { key: 'fm-isolation', aud: 'fm', title: 'Building isolation points', wide: true, lines: 'Mark up: main water, gas (if any), main switchboard, unit isolations, rainwater tank supply.' },
  { key: 'fm-hatches', aud: 'fm', title: 'Service hatches', lines: 'Ceiling service hatch, wall hatch to water isolations, and what is behind each. [Add photos]' },
  { key: 'fm-comms', aud: 'fm', title: 'Comms, CCTV and fibre', lines: 'CCTV recorder and data server location. Chorus main fibre entry. Access control controller. [Add photos]' },
  { key: 'fm-tank', aud: 'fm', title: 'Rainwater tank and pump', lines: 'Grundfos SCALA1 pump supplies WCs, laundry and hose taps.\nBackflow preventer (WATTS LF007M1) at the water meter: annual IQP test for the BWoF.' },
  { key: 'fm-fixings', aud: 'fm', title: 'Fixings and future-proofing', lines: 'Nogging for wall-hung TVs, grab rail backing and other hidden fixings. [Add marked-up photos]' },
];
async function addStandard() {
  const have = new Set(pages().map(p => p.std).filter(Boolean)), add = STANDARD.filter(s => !have.has(s.key));
  if (!add.length) return toast('All the standard pages are already here');
  if (!(await confirmBox(`Add ${add.length} standard page${add.length === 1 ? '' : 's'} (${add.filter(s => s.aud !== 'fm').length} for residents, ${add.filter(s => s.aud === 'fm').length} for facilities only)? Text marked [CONFIRM] needs checking, and each page needs its photo.`, 'Add pages'))) return;
  const b = busy('Adding pages…'); let o = pages().length;
  try { for (const s of add) await S.store.saveItem(S.project.id, 'guide', { id: uid(), std: s.key, order: ++o, title: s.title, photo: '', marks: [], lines: s.lines, wide: !!s.wide, codeBox: !!s.codeBox, table: !!s.table, aud: s.aud || 'both', updated: new Date().toISOString(), updatedBy: S.user.email });
    b.done(); toast(`Added ${add.length} pages`); setTimeout(view, 300); } catch (e) { b.done(); toast(e.message, 6000); }
}
async function exportJson() {
  const b = busy('Collecting the pages…'); try { const out = []; for (const p of pages()) { const q = { ...p }; if (q.photo && !q.photo.startsWith('data:')) { const img = await loadImg(q.photo); if (img) { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; c.getContext('2d').drawImage(img, 0, 0); q.photo = c.toDataURL('image/jpeg', 0.85); } } out.push(q); }
    b.done(); deliver(new Blob([JSON.stringify({ app: 'resero-defects-guide', version: 1, project: S.project.name, exported: new Date().toISOString(), cfg: cfg(), pages: out })], { type: 'application/json' }), `${safeName(S.project.name)} - home user guide pages - ${stamp()}.json`, 'Guide pages'); } catch (e) { b.done(); toast(e.message, 6000); }
}
export async function importJson(file) {
  let j; try { j = JSON.parse(await file.text()); } catch (e) { return toast('That file could not be read'); }
  if (j.app !== 'resero-defects-guide' || !Array.isArray(j.pages)) return toast('That is not a set of guide pages');
  const have = pages(), same = j.pages.filter(p => have.some(h => h.id === p.id)).length;
  if (!(await confirmBox(`Import ${j.pages.length} guide page${j.pages.length === 1 ? '' : 's'}?${same ? ' ' + same + ' already here will be replaced by the imported version.' : ''}${j.cfg && j.cfg.phone && !cfg().phone ? ' The phone number and unit code settings come with them.' : ''}`, 'Import'))) return;
  const b = busy('Importing…');
  try { for (const [i, p] of j.pages.entries()) { b.set(`Importing page ${i + 1} of ${j.pages.length}…`); const q = { ...p, id: p.id || uid(), marks: p.marks || [] };
      if (q.photo && q.photo.startsWith('data:')) q.photo = await S.store.putFile(`projects/${S.project.id}/docs/guide-${q.id}/photo-${Date.now()}.jpg`, dataUrlToBlob(q.photo), true);
      await S.store.saveItem(S.project.id, 'guide', q); }
    if (j.cfg && !cfg().phone) { await S.store.updateProject(S.project.id, { guideCfg: j.cfg }); S.project.guideCfg = j.cfg; }
    b.done(); toast(`Imported ${j.pages.length} pages`, 4000); setTimeout(view, 300); }
  catch (e) { b.done(); toast('Import stopped: ' + e.message, 7000); }
}
