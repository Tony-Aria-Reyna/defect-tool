// Home User Guide builder: one topic per page, one photo, numbered pointers that never cover the item, a few short lines.
// Pages are drawn on a canvas, so the editor shows exactly what the exported PDF will look like.
import { S, can } from './state.js';
import * as Nav from './nav.js';
import { warrantyExpiry, freqText } from './fm.js';
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
  if (pg.table) { // lines as a table: first line is the heading, cells split with |
    const R = String(pg.lines || '').split('\n').map(s => s.trim()).filter(Boolean).map(l => l.split('|').map(x => fill(x.trim(), unit))), n = Math.max(1, ...R.map(r => r.length)), tw = W - PX * 2;
    const cw = n === 4 ? [0.2, 0.18, 0.2, 0.42] : Array(n).fill(1 / n), fs = 30;
    R.forEach((r, ri) => { c.font = font(fs, ri === 0); const cells = Array.from({ length: n }, (_, i) => wrap(c, r[i] || '', cw[i] * tw - 24)), hh = 22 + Math.max(...cells.map(x => x.length)) * (fs + 8);
      if (y + hh > H - 190) return; if (ri === 0) { c.fillStyle = NAVY; c.fillRect(PX, y, tw, hh); } else if (ri % 2 === 0) { c.fillStyle = '#eef3f7'; c.fillRect(PX, y, tw, hh); }
      let x = PX; cells.forEach((ls, i) => { c.fillStyle = ri === 0 ? '#fff' : INK; ls.forEach((l, k) => c.fillText(l, x + 12, y + 14 + fs + k * (fs + 8))); x += cw[i] * tw; }); y += hh; });
  } else
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
    <label class="dvall"><input type="checkbox" id="geTb" ${p.table ? 'checked' : ''}> Show the lines as a table (first line is the heading, split columns with |)</label>
    <label class="dvall" style="margin-top:8px"><input type="checkbox" id="geCB" ${p.codeBox ? 'checked' : ''}> Show the unit's visitor code in a large box</label>
    <label class="f" style="margin-top:10px">Which guide<select id="geA"><option value="both" ${p.aud !== 'fm' ? 'selected' : ''}>Both guides (residents and facilities)</option><option value="fm" ${p.aud === 'fm' ? 'selected' : ''}>Facilities Guide only</option></select></label>
    <label class="f" style="margin-top:10px">Preview for unit<input id="geU" value="${esc(E.unit || '')}" placeholder="e.g. 15"></label>
    <p class="muted small">Keep it short: residents need to know what it is and what to do. {unit} and {code} are filled in for each unit.</p>`;
  const upd = () => { p.title = $('geT').value; p.lines = $('geL').value; p.wide = $('geW').checked; p.codeBox = $('geCB').checked; p.table = $('geTb').checked; p.aud = $('geA').value; E.unit = $('geU').value.trim(); document.querySelectorAll('#geSide [data-ml]').forEach(i => p.marks[+i.dataset.ml].label = i.value); document.querySelectorAll('#geSide [data-ms]').forEach(i => p.marks[+i.dataset.ms].sub = i.value); clearTimeout(E.t); E.t = setTimeout(redraw, 250); };
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
  { key: 'water', title: 'Turning off your water', lines: '! Know where your water shut-off is.\nIf a pipe leaks, turn the water off, then call us.\n[CONFIRM location and add a marked-up photo]' },
  { key: 'hotwater', title: 'Hot water', lines: 'Your hot water comes from an electric cylinder (Rheem). [CONFIRM size for this unit]\nNo hot water? Call us. Do not open the cylinder cupboard panels.' },
  { key: 'oven', title: 'Oven and cooktop', lines: '[CONFIRM from the product manual for this unit: Haier or Midea oven, Haier or Whirlpool cooktop]\nTurn the cooktop off at the wall switch when you go away.' },
  { key: 'rangehood', title: 'Rangehood', lines: 'Turn the rangehood on when you cook. It takes steam and smells outside.\nThe filter needs cleaning. [CONFIRM how often from the manual]' },
  { key: 'fire', title: 'Smoke alarms and sprinklers', lines: 'The round fitting on the ceiling is a smoke detector.\nThe sprinklers turn on with heat, not smoke.\n! Never hang anything from a sprinkler or paint over it.\n! If there is a fire, get out, close the door behind you and call 111.' },
  { key: 'visitors', title: 'Visitors and the intercom', codeBox: true, lines: 'Your visitors press 7, then your unit number.\nDoor 1 (left) is the main entrance. Door 2 (right) is the second door.\nYou can only open the door your visitor is speaking from.' },
  { key: 'rubbish', title: 'Rubbish and recycling', lines: 'Green Gorilla collects rubbish from the building.\nGeneral rubbish, recycling and food scraps go in separate bins.\nRinse cans, bottles and containers before recycling.\nNo plastic bags in the recycling. [CONFIRM bin room location]' },
  { key: 'washing', title: 'Drying your washing', lines: 'Use the covered washing line outside your unit.\nThere are longer washing lines by the community gardens downstairs.\n! Please do not dry washing inside. It makes the home damp.' },
  { key: 'gardens', title: 'Gardens to enjoy', lines: 'The orchard, herb garden and vegetable gardens are for everyone.\nFruit trees: [CONFIRM names from the landscape plan]\nPlease take only what you need and leave some for others.' },
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
