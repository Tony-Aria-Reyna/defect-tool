// Home User Guide builder: one topic per page, one photo, numbered pointers that never cover the item, a few short lines.
// Pages are drawn on a canvas, so the editor shows exactly what the exported PDF will look like.
import { S, can } from './state.js';
import * as Nav from './nav.js';
import { $, esc, toast, busy, confirmBox, uid, compressImage, dataUrlToBlob, deliver, loadScript, safeName, stamp, natural } from './util.js';

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
  cv.width = W; cv.height = H; const c = cv.getContext('2d'), g = cfg();
  c.fillStyle = '#fff'; c.fillRect(0, 0, W, H);
  // header: client logo on white, then the title bar
  const logo = await loadImg(S.project.clientLogo); if (logo) { const lh = 62, lw = logo.width * lh / logo.height; c.drawImage(logo, W - PX - lw, 20, lw, lh); }
  c.fillStyle = NAVY; c.fillRect(0, 100, W, 110); c.fillStyle = '#fff'; c.font = font(58, 1); c.fillText(fill(pg.title, unit), PX, 176);
  const img = await loadImg(pg.photo), r = photoRect(pg, img); let y = PH0;
  if (img) {
    c.drawImage(img, r.x, r.y, r.w, r.h); c.strokeStyle = NAVY; c.lineWidth = 4; c.strokeRect(r.x, r.y, r.w, r.h);
    const marks = pg.marks || []; marks.forEach((m, i) => { arrow(c, { x: r.x + m.nx * r.w, y: r.y + m.ny * r.h }, { x: r.x + m.tx * r.w, y: r.y + m.ty * r.h }); dot(c, r.x + m.nx * r.w, r.y + m.ny * r.h, i + 1); });
    // the key: beside a narrow photo, under a wide one
    const side = !pg.wide && r.w <= 700, lx = side ? r.x + r.w + 40 : PX, lw = W - lx - PX - 90; let ly = side ? PH0 + 10 : r.y + r.h + 40;
    marks.forEach((m, i) => { dot(c, lx + 34, ly + 34, i + 1); c.fillStyle = NAVY; c.font = font(37, 1); let yy = ly + 36; for (const t of wrap(c, fill(m.label, unit), lw)) { c.fillText(t, lx + 88, yy); yy += 46; } c.fillStyle = '#333'; c.font = font(32); for (const t of wrap(c, fill(m.sub, unit), lw)) { if (t) { c.fillText(t, lx + 88, yy); yy += 42; } } ly = Math.max(yy, ly + 90) + 16; });
    y = Math.max(r.y + r.h + 55, side ? ly + 10 : ly + 20);
  }
  if (pg.codeBox) { c.fillStyle = NAVY; c.beginPath(); c.roundRect(PX, y, W - PX * 2, 250, 24); c.fill(); c.fillStyle = '#fff'; c.textAlign = 'center'; c.font = font(44, 1); c.fillText(unit ? `Your unit is ${unit}. Your visitors press:` : 'Your visitors press:', W / 2, y + 74); c.font = font(120, 1); c.fillText(unit ? unitCode(unit).split('').join('  ') : '_  _  _', W / 2, y + 205); c.textAlign = 'left'; y += 300; }
  for (let t of String(pg.lines || '').split('\n').map(s => s.trim()).filter(Boolean)) {
    const big = t.startsWith('!'); t = fill(t.replace(/^!\s*/, ''), unit); c.font = font(40, big);
    c.beginPath(); c.arc(PX + 14, y + 26, 10, 0, 7); c.fillStyle = big ? RED : NAVY; c.fill(); c.fillStyle = big ? NAVY : INK;
    for (const u of wrap(c, t, W - PX * 2 - 60)) { c.fillText(u, PX + 50, y + 40); y += 56; } y += 18;
  }
  c.fillStyle = TEAL; c.fillRect(0, H - 170, W, 170); c.fillStyle = '#fff'; c.font = font(40, 1); c.fillText(g.footer || 'Something not working?', PX, H - 104); c.font = font(46, 1); c.fillText(`Call ${g.org || 'us'}  ${g.phone || ''}`.trim(), PX, H - 44);
}

/* ---------- list ---------- */
export function view() {
  const P = pages(), g = cfg(), ed = can.edit();
  $('fmView').innerHTML = `<div class="fbar"><h2>Home user guide</h2><span class="sp"></span>${ed ? '<button class="btn2 go" id="gNew">+ Page</button><button class="btn2" id="gSet">Phone and unit codes</button><button class="btn2" id="gImp">⬆ Import pages</button>' : ''}<button class="btn2" id="gJson">⬇ Pages (.json)</button><button class="btn2 go" id="gPdf">⬇ Guide (PDF)</button><input type="file" id="gFile" accept=".json" hidden></div>
  <p class="muted small">${P.length} page${P.length === 1 ? '' : 's'} · one topic per page, one photo, numbered pointers and a few short lines. ${g.phone ? 'Footer: call ' + esc(g.org) + ' ' + esc(g.phone) + '.' : 'Set the phone number for the footer in “Phone and unit codes”.'}</p>
  ${P.length ? `<div class="ggrid">${P.map((p, i) => `<div class="gcard" data-id="${esc(p.id)}"><canvas data-cv="${esc(p.id)}"></canvas><div class="gcap"><b>${i + 1}. ${esc(p.title || 'Untitled')}</b>${ed ? `<span><button class="mini" data-up="${esc(p.id)}" title="Move earlier">↑</button><button class="mini" data-dn="${esc(p.id)}" title="Move later">↓</button></span>` : ''}</div></div>`).join('')}</div>` : '<div class="empty2">No pages yet. Add a page, or import a set of pages.</div>'}`;
  P.forEach(p => { const cv = document.querySelector(`[data-cv="${p.id}"]`); if (cv) draw(cv, p, '').catch(e => console.warn(e)); });
  document.querySelectorAll('.gcard').forEach(c => c.onclick = e => { if (e.target.closest('button')) return; edit(P.find(p => p.id === c.dataset.id)); });
  const move = async (id, d) => { const i = P.findIndex(p => p.id === id), j = i + d; if (j < 0 || j >= P.length) return; const a = P[i], b = P[j]; await S.store.patchItem(S.project.id, 'guide', a.id, { order: j + 1 }); await S.store.patchItem(S.project.id, 'guide', b.id, { order: i + 1 }); };
  document.querySelectorAll('[data-up]').forEach(b => b.onclick = () => move(b.dataset.up, -1)); document.querySelectorAll('[data-dn]').forEach(b => b.onclick = () => move(b.dataset.dn, 1));
  if ($('gNew')) $('gNew').onclick = () => edit(null);
  if ($('gSet')) $('gSet').onclick = settings;
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
  el.innerHTML = `<div class="dvh"><button id="geX">‹ Back</button><b>Guide page</b><span class="sp"></span><button id="geDel" class="ic" title="Delete this page">🗑</button><button id="geSave" class="go">Save</button></div>
    <div class="dvb"><div class="dvpage" id="geScroll"><div id="geWrap"><canvas id="geC"></canvas><div id="geO"></div></div></div><aside class="dvside" id="geSide"></aside></div>`;
  document.body.appendChild(el);
  $('geX').onclick = tryClose; $('geSave').onclick = save; $('geDel').onclick = async () => { if (E.isNew) return close(); if (!(await confirmBox('Delete this page of the guide?', 'Delete'))) return; await S.store.deleteItem(S.project.id, 'guide', E.p.id); toast('Deleted'); close(); };
  const o = $('geO'); let drag = null;
  const frac = e => { const b = o.getBoundingClientRect(), r = E.rect, sx = W / b.width; return { x: Math.max(0, Math.min(1, ((e.clientX - b.left) * sx - r.x) / r.w)), y: Math.max(0, Math.min(1, ((e.clientY - b.top) * sx - r.y) / r.h)) }; };
  o.addEventListener('pointerdown', e => {
    if (!E.rect) return; const h = e.target.closest('[data-h]');
    if (h) { drag = { i: +h.dataset.i, k: h.dataset.h }; o.setPointerCapture(e.pointerId); e.preventDefault(); return; }
    if (!E.adding) return; const p = frac(e); const nx = Math.max(0.08, Math.min(0.92, p.x + (p.x > 0.5 ? -0.22 : 0.22))), ny = Math.max(0.08, Math.min(0.92, p.y + (p.y > 0.3 ? -0.2 : 0.2)));
    E.p.marks.push({ tx: p.x, ty: p.y, nx, ny, label: '', sub: '' }); E.adding = false; side(); redraw(); setTimeout(() => { const L = document.querySelectorAll('#geSide [data-ml]'); if (L.length) L[L.length - 1].focus(); }, 50);
  });
  o.addEventListener('pointermove', e => { if (!drag) return; const p = frac(e), m = E.p.marks[drag.i]; if (drag.k === 't') { m.tx = p.x; m.ty = p.y; } else { m.nx = p.x; m.ny = p.y; } handles(); cancelAnimationFrame(E.raf); E.raf = requestAnimationFrame(redraw); });
  o.addEventListener('pointerup', () => { if (drag) { drag = null; redraw(); } });
}
const snap = () => JSON.stringify(E.p);
async function tryClose() { if (E && E.snap !== snap() && !(await X.askDiscard('Your changes to this page have not been saved.'))) return; close(); }
function close(nav) { if (!E) return; $('ge').classList.remove('show'); E = null; if (nav !== true) Nav.closed('guide-ed'); view(); }
function edit(p) {
  shell(); const isNew = !p; p = p ? JSON.parse(JSON.stringify(p)) : { id: uid(), order: pages().length + 1, title: '', photo: '', marks: [], lines: '', wide: false, codeBox: false };
  p.marks = p.marks || []; E = { p, isNew, adding: false, rect: null }; E.snap = isNew ? '' : snap();
  Nav.open('guide-ed', () => close(true)); $('ge').classList.add('show'); $('geSave').style.display = $('geDel').style.display = can.edit() ? '' : 'none';
  side(); redraw();
}
async function redraw() { if (!E) return; const tok = (E.tok = (E.tok || 0) + 1), cv = document.createElement('canvas'); await draw(cv, E.p, E.unit || ''); if (!E || tok !== E.tok) return; const c = $('geC'); c.width = W; c.height = H; c.getContext('2d').drawImage(cv, 0, 0); const img = await loadImg(E.p.photo); E.rect = photoRect(E.p, img); handles(); }
function handles() {
  const o = $('geO'), r = E.rect; if (!r || !can.edit()) { o.innerHTML = ''; return; }
  const pc = (x, y) => `left:${(r.x + x * r.w) / W * 100}%;top:${(r.y + y * r.h) / H * 100}%`;
  o.innerHTML = `<div class="gphoto${E.adding ? ' adding' : ''}" style="left:${r.x / W * 100}%;top:${r.y / H * 100}%;width:${r.w / W * 100}%;height:${r.h / H * 100}%"></div>` + E.p.marks.map((m, i) => `<div class="gh gt" data-h="t" data-i="${i}" style="${pc(m.tx, m.ty)}" title="Drag the arrow tip onto the item"></div><div class="gh gn" data-h="n" data-i="${i}" style="${pc(m.nx, m.ny)}" title="Drag the number clear of the item"></div>`).join('');
}
function side() {
  const p = E.p, ro = !can.edit();
  $('geSide').innerHTML = `<label class="f">Page title<input id="geT" value="${esc(p.title)}" placeholder="e.g. Oven"></label>
    <h4>Photo</h4><p><button class="mini" id="geP">${p.photo ? 'Replace the photo' : '⬆ Add a photo'}</button> ${p.photo ? '<button class="mini" id="gePx">Remove</button>' : ''}<input type="file" id="gePF" accept="image/*" hidden></p>
    <label class="dvall"><input type="checkbox" id="geW" ${p.wide ? 'checked' : ''}> Full-width photo (for plans and wide pictures)</label>
    <h4>Pointers</h4><p class="muted small">Press “Add a pointer”, then click the item in the photo. Drag the arrow tip onto the item and the number clear of it, so nothing is covered.</p>
    ${p.marks.map((m, i) => `<div class="gmark"><i>${i + 1}</i><div><input data-ml="${i}" value="${esc(m.label)}" placeholder="What it is, e.g. Timer"><input data-ms="${i}" value="${esc(m.sub)}" placeholder="What to do, in a few words"></div><button class="mini" data-mx="${i}" title="Remove">✕</button></div>`).join('')}
    ${p.photo && !ro ? `<p><button class="mini${E.adding ? ' on' : ''}" id="geAdd">${E.adding ? 'Now click the item in the photo…' : '+ Add a pointer'}</button></p>` : ''}
    <h4>Short lines under the photo</h4><textarea id="geL" rows="5" placeholder="One line each. Start a line with ! to make it stand out.">${esc(p.lines)}</textarea>
    <label class="dvall" style="margin-top:8px"><input type="checkbox" id="geCB" ${p.codeBox ? 'checked' : ''}> Show the unit's visitor code in a large box</label>
    <label class="f" style="margin-top:10px">Preview for unit<input id="geU" value="${esc(E.unit || '')}" placeholder="e.g. 15"></label>
    <p class="muted small">Keep it short: residents need to know what it is and what to do. {unit} and {code} are filled in for each unit.</p>`;
  const upd = () => { p.title = $('geT').value; p.lines = $('geL').value; p.wide = $('geW').checked; p.codeBox = $('geCB').checked; E.unit = $('geU').value.trim(); document.querySelectorAll('#geSide [data-ml]').forEach(i => p.marks[+i.dataset.ml].label = i.value); document.querySelectorAll('#geSide [data-ms]').forEach(i => p.marks[+i.dataset.ms].sub = i.value); clearTimeout(E.t); E.t = setTimeout(redraw, 250); };
  $('geSide').querySelectorAll('input,textarea').forEach(i => { if (i.type !== 'file') i.oninput = i.onchange = upd; });
  $('geSide').querySelectorAll('[data-mx]').forEach(b => b.onclick = () => { upd(); p.marks.splice(+b.dataset.mx, 1); side(); redraw(); });
  if ($('geAdd')) $('geAdd').onclick = () => { upd(); E.adding = !E.adding; side(); handles(); };
  $('geP').onclick = () => $('gePF').click(); if ($('gePx')) $('gePx').onclick = () => { upd(); p.photo = ''; p.marks = []; side(); redraw(); };
  $('gePF').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; upd(); const b = busy('Preparing the photo…'); try { p.photo = (await compressImage(f, 1600, 0.82)).dataUrl; b.done(); side(); redraw(); } catch (x) { b.done(); toast('Could not read that photo: ' + x.message, 5000); } };
}
async function save() {
  const p = E.p; if (!p.title.trim()) return toast('Give the page a title');
  const b = busy('Saving…');
  try { if (p.photo && p.photo.startsWith('data:')) { const src = p.photo; p.photo = await S.store.putFile(`projects/${S.project.id}/docs/guide-${p.id}/photo-${Date.now()}.jpg`, dataUrlToBlob(src), true); imgCache[p.photo] = imgCache[src]; }
    await S.store.saveItem(S.project.id, 'guide', { ...p, updated: new Date().toISOString(), updatedBy: S.user.email }); b.done(); toast('Saved'); E.snap = snap(); close(); }
  catch (e) { b.done(); toast('Could not save: ' + e.message, 6000); }
}

/* ---------- export and import ---------- */
function exportDialog() {
  const P = pages(); if (!P.length) return toast('Add a page first');
  X.modal(`<h2>Export the Home User Guide</h2><p>${P.length} pages, A4.</p><label class="f">For unit (leave blank for a general copy)<input id="geuU" placeholder="e.g. 15, or 1-42 for every unit"></label><p class="note">A range such as 1-42 makes one PDF per unit, each with that unit's visitor code, in a single zip file.</p><div class="act"><button id="geuX">Cancel</button><button class="go" id="geuOk">Export</button></div>`);
  $('geuX').onclick = X.closeModal;
  $('geuOk').onclick = async () => { const v = $('geuU').value.trim(), m = /^(\d+)\s*-\s*(\d+)$/.exec(v); X.closeModal(); const units = m ? Array.from({ length: +m[2] - +m[1] + 1 }, (_, i) => String(+m[1] + i)) : [v];
    const b = busy('Building the guide…');
    try { const files = []; for (const [i, u] of units.entries()) { b.set(units.length > 1 ? `Building unit ${u} (${i + 1} of ${units.length})…` : 'Building the guide…'); files.push({ name: `${safeName(S.project.name)} - Home User Guide${u ? ' - Unit ' + u : ''}.pdf`, blob: await pdf(u) }); }
      b.done(); if (files.length === 1) return deliver(files[0].blob, files[0].name, 'Home User Guide');
      if (!window.JSZip) await loadScript('lib/jszip.min.js'); const z = new window.JSZip(); files.forEach(f => z.file(f.name, f.blob)); deliver(await z.generateAsync({ type: 'blob' }), `${safeName(S.project.name)} - Home User Guides - ${stamp()}.zip`, 'Home User Guides'); }
    catch (e) { b.done(); console.error(e); toast('Could not build the guide: ' + e.message, 7000); } };
}
async function pdf(unit) {
  if (!window.PDFLib) await loadScript('lib/pdf-lib.min.js'); const doc = await window.PDFLib.PDFDocument.create(), cv = document.createElement('canvas');
  for (const p of pages()) { await draw(cv, p, unit); const bytes = await (await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.86))).arrayBuffer(); const im = await doc.embedJpg(bytes), pg = doc.addPage([595.28, 841.89]); pg.drawImage(im, { x: 0, y: 0, width: 595.28, height: 841.89 }); }
  return new Blob([await doc.save()], { type: 'application/pdf' });
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
