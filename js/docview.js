// Document viewer: read a PDF inside the app, mark the clauses that set a requirement (warranty, maintenance, documents),
// link each marked box to assets and maintenance tasks, and search the contract and specification in plain words.
import { S, can } from './state.js';
import * as Nav from './nav.js';
import { aiCall } from './ai.js';
import { $, esc, toast, busy, confirmBox, uid, natural, nzDate, loadScript, safeName } from './util.js';
import { search, norm } from './clausefind.js';

let X = null, pdfjs = null, V = null;
export const KINDS = ['Warranty requirement', 'Maintenance requirement', 'Document requirement', 'Product or finish detail', 'Warranty period', 'Parties', 'Execution and signatures', 'Date', 'Condition or exclusion', 'Other'];
const KCLS = { 'Warranty requirement': 'kw', 'Maintenance requirement': 'km', 'Document requirement': 'kd', 'Product or finish detail': 'kp', 'Warranty period': 'kw', 'Parties': 'kd', 'Execution and signatures': 'kd', 'Date': 'kp', 'Condition or exclusion': 'km', 'Other': 'ko' };
export { loadPdf, lib as pdfLib };
const fm = () => S.fm || { assets: [], docs: [], tasks: [], systems: [] };
export function init(ctx) { X = ctx; }
// Who may draw and edit boxes: editors anywhere; contractors on the warranties they have submitted.
const canMark = () => can.edit() || (can.contractor() && !!(V && V.d && V.d.submitted));
const quick = () => V && V.d && (V.d.submitted || V.d.template);
export const isPdf = d => !!d && !!d.url && (/\.pdf$/i.test(d.fileName || '') || d.mime === 'application/pdf');
// Source documents are where requirements come from: the contract and the specification, or anything ticked as a source or already marked up.
export const isSource = d => isPdf(d) && d.source !== false && (d.source === true || (d.marks || []).some(m => !m.ai) || ['Contract document', 'Specification / drawing'].includes(d.type));
export const marksFor = (kind, id) => fm().docs.flatMap(d => (d.marks || []).filter(m => ((kind === 'asset' ? m.assetIds : m.taskIds) || []).includes(id)).map(m => ({ d, m }))).sort((a, b) => natural(a.d.title, b.d.title) || a.m.page - b.m.page);
export const markLine = ({ d, m }) => [d.title, 'p. ' + m.page, m.clause ? 'cl. ' + m.clause : '', m.period || ''].filter(Boolean).join(' · ');

async function lib() { if (!pdfjs) { pdfjs = await import('../lib/pdfjs/pdf.min.mjs'); pdfjs.GlobalWorkerOptions.workerSrc = new URL('../lib/pdfjs/pdf.worker.min.mjs', import.meta.url).href; } return pdfjs; }
async function loadPdf(d) {
  const L = await lib(); let u = ''; try { u = await S.store.resolveUrl(d.url); } catch (e) {}
  if (u) { try { return await L.getDocument({ url: u }).promise; } catch (e) { console.warn('pdf by url failed, reading the whole file', e); } }
  const b = new Uint8Array(await X.getBytes(d.url));
  if (!b.length) throw new Error('the stored file is empty. Upload it again.');
  if (String.fromCharCode(...b.slice(0, 1024)).indexOf('%PDF') < 0) throw new Error(b[0] === 0x3c ? 'the file server sent back a web page instead of the PDF (sign in again, or check your connection).' : 'this file is not a PDF, or it is damaged. Download the original to check it.');
  return await L.getDocument({ data: b }).promise;
}
/* ---------- text index: the words on each page, read once and kept beside the document ---------- */
const idxCache = {};
async function textIndex(d, pdf, onProg) {
  if (idxCache[d.id]) return idxCache[d.id];
  if (d.textIdx) { try { const j = JSON.parse(new TextDecoder().decode(await X.getBytes(d.textIdx))); if (j && j.pages) return (idxCache[d.id] = j.pages); } catch (e) { console.warn('saved index unreadable, rebuilding', e); } }
  pdf = pdf || await loadPdf(d); const pages = []; let chars = 0;
  for (let i = 1; i <= pdf.numPages; i++) { const pg = await pdf.getPage(i); const tc = await pg.getTextContent(); const t = tc.items.map(it => it.str).join(' ').replace(/\s+/g, ' ').trim(); chars += t.length; pages.push({ p: i, t }); onProg && onProg(i, pdf.numPages); }
  idxCache[d.id] = pages;
  if (can.edit()) { try { const url = await S.store.putFile(`projects/${S.project.id}/docs/${d.id}/text.json`, new Blob([JSON.stringify({ v: 1, pages })], { type: 'application/json' })); await S.store.patchItem(S.project.id, 'docs', d.id, { textIdx: url, pageCount: pdf.numPages, scanned: chars < pdf.numPages * 40 }); } catch (e) { console.warn('could not save the text index', e); } }
  return pages;
}

// The words on the first few pages, including what has been typed into form fields (producer statements are usually fillable forms).
export async function frontText(d, pages) {
  const pdf = await loadPdf(d); let t = '';
  try { for (let i = 1; i <= Math.min(pages || 3, pdf.numPages); i++) { const pg = await pdf.getPage(i); const tc = await pg.getTextContent(); t += ' ' + tc.items.map(it => it.str).join(' ');
      try { for (const an of await pg.getAnnotations()) { const v = an.fieldValue; if (typeof v === 'string' && v.length > 1 && v !== 'Off') t += ' \n ' + v; } } catch (e) {} } }
  finally { try { pdf.destroy(); } catch (e) {} }
  return t;
}
// What the AI needs from an attached PDF: the words on the first pages (including filled-in form fields), or a picture of page one if it is a scan.
export async function pdfDigest(bytes, pages = 4) {
  const L = await lib(), pdf = await L.getDocument({ data: bytes }).promise; let t = '', img = '';
  try { for (let i = 1; i <= Math.min(pages, pdf.numPages); i++) { const pg = await pdf.getPage(i); const tc = await pg.getTextContent(); t += ' ' + tc.items.map(it => it.str).join(' ');
      try { for (const an of await pg.getAnnotations()) { const v = an.fieldValue; if (typeof v === 'string' && v.length > 1 && v !== 'Off') t += ' | ' + v; } } catch (e) {} }
    t = t.replace(/\s+/g, ' ').trim();
    if (t.length < 120) { const pg = await pdf.getPage(1), b = pg.getViewport({ scale: 1 }), vp = pg.getViewport({ scale: Math.min(2.2, 1700 / Math.max(b.width, b.height)) }), c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height); const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); await pg.render({ canvasContext: x, viewport: vp }).promise; img = c.toDataURL('image/jpeg', 0.8); }
    return { text: t.slice(0, 5000), image: img, pages: pdf.numPages };
  } finally { try { pdf.destroy(); } catch (e) {} }
}
/* ---------- shell ---------- */
function shell() {
  if ($('dv')) return;
  const el = document.createElement('div'); el.id = 'dv';
  el.innerHTML = `<div class="dvh"><button id="dvX" title="Close the document">‹ Back</button><b id="dvT"></b><span class="sp"></span>
    <button id="dvFind" class="ic" title="Find in the document">🔍</button>
    <span class="dvgrp"><button id="dvPrev" class="ic" title="Previous page">↑</button><button id="dvNext" class="ic" title="Next page">↓</button><input id="dvP" type="number" min="1" title="Go to page"><span id="dvN" class="muted"></span></span>
    <span class="dvgrp"><button id="dvZo" class="ic" title="Zoom out">−</button><span id="dvZ" class="muted" title="Zoom">100%</span><button id="dvZi" class="ic" title="Zoom in">+</button><button id="dvFit" class="ic" title="Fit to width">↔</button></span>
    <span class="dvgrp" id="dvRotG"><button id="dvRot" class="ic" title="Turn this page a quarter turn clockwise (saved to the file)">⟳</button><button id="dvRotA" title="Turn every page a quarter turn clockwise (saved to the file)">⟳ All</button><button id="dvDel" title="Remove this page from the file, for example a cover sheet (the file as it was is kept)">🗑 Page</button></span>
    <button id="dvMark" class="go" title="Draw a box around a clause or detail and link it to an asset or task">▭ Mark</button>
    <button id="dvDl" class="ic" title="Download the original file">⬇</button><button id="dvDlM" title="Download a copy with every box drawn on it and a summary page">⬇ With markup</button><button id="dvTab" class="ic" title="Open in a new tab (to print)">↗</button></div>
    <div class="dvb"><div class="dvpage" id="dvScroll"><div id="dvPages"></div></div><aside class="dvside" id="dvSide"></aside></div>`;
  document.body.appendChild(el);
  $('dvX').onclick = () => close(); $('dvRot').onclick = () => rotate(false); $('dvRotA').onclick = () => rotate(true); $('dvDel').onclick = delPage; $('dvPrev').onclick = () => show(V.page - 1); $('dvNext').onclick = () => show(V.page + 1);
  $('dvP').onchange = e => show(+e.target.value || 1);
  const zoom = z => { const keep = V.page; V.zoom = Math.max(0.4, Math.min(5, z)); V.gen++; size(); show(keep); };
  $('dvZi').onclick = () => zoom(V.zoom * 1.2); $('dvZo').onclick = () => zoom(V.zoom / 1.2); $('dvFit').onclick = () => zoom(1);
  $('dvFind').onclick = () => { if (V.side !== 'home') home(); const q = $('dvQ'); if (q) { q.focus(); q.select(); } };
  $('dvMark').onclick = () => setMode(V.mode === 'mark' ? 'view' : 'mark');
  $('dvTab').onclick = async () => { const u = await S.store.resolveUrl(V.d.url); if (u) window.open(u, '_blank', 'noopener'); };
  $('dvDl').onclick = async () => { try { const buf = await X.getBytes(V.d.url); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([buf], { type: 'application/pdf' })); a.download = V.d.fileName || (V.d.title + '.pdf'); document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); } catch (e) { toast('Could not download: ' + e.message, 5000); } };
  // Ctrl (or Cmd) + mouse wheel, and a trackpad pinch, zoom about the pointer
  $('dvScroll').addEventListener('wheel', e => { if (!(e.ctrlKey || e.metaKey) || !V || !V.pp.length) return; e.preventDefault();
    const sc = $('dvScroll'), r = sc.getBoundingClientRect(), ox = e.clientX - r.left, oy = e.clientY - r.top, px = sc.scrollLeft + ox, py = sc.scrollTop + oy, w0 = sc.scrollWidth, h0 = sc.scrollHeight;
    const nz = Math.max(0.4, Math.min(5, V.zoom * Math.exp(-Math.max(-60, Math.min(60, e.deltaY)) * 0.004))); if (Math.abs(nz - V.zoom) < 0.001) return;
    V.zoom = nz; V.gen++; size(); sc.scrollLeft = px * (sc.scrollWidth / w0) - ox; sc.scrollTop = py * (sc.scrollHeight / h0) - oy; onScroll(); }, { passive: false });
  let raf = 0; $('dvScroll').addEventListener('scroll', () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; onScroll(); }); });
  addEventListener('resize', () => { if (V && $('dv').classList.contains('show')) { const keep = V.page; V.gen++; size(); show(keep); } });
  document.addEventListener('keydown', e => { if (!V || !$('dv').classList.contains('show') || $('modal').classList.contains('show') || document.querySelector('.askov')) return; const typing = /INPUT|TEXTAREA|SELECT/.test((e.target || {}).tagName || '');
    if (e.key === 'Escape') { if (V.mode === 'mark') setMode('view'); else if (V.side !== 'home') home(); else close(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); $('dvFind').click(); }
    else if (!typing && e.key === 'PageDown') { e.preventDefault(); show(V.page + 1); } else if (!typing && e.key === 'PageUp') { e.preventDefault(); show(V.page - 1); }
    else if (!typing && e.key === 'Home') show(1); else if (!typing && e.key === 'End') show(V.n); });
  $('dvDlM').onclick = () => window.dispatchEvent(new CustomEvent('rd-marked-pdf', { detail: V.d.id }));
  wireDraw();
}
function setMode(m) { V.mode = m; $('dvMark').classList.toggle('on', m === 'mark'); $('dvMark').textContent = m === 'mark' ? '✕ Stop marking' : '▭ Mark'; $('dvPages').classList.toggle('drawing', m === 'mark'); if (m === 'mark') toast('Drag a box around the clause or detail on the page', 3500); }
function close(silent) {
  if (!V) return; const ret = V.ret; V.gen = -1; $('dv').classList.remove('show'); $('dvPages').innerHTML = ''; V = null; if (!silent) Nav.closed('docview');
  if (ret) ret();
}
// opts: {page, markId, query, all, asset (preselect when marking), ret (called after closing)}
export const current = () => V && V.d;
export function refreshSide() { if (V && V.side === 'home') home(); }
// Turn pages a quarter turn clockwise and save the file again. The file as it was is kept with the entry so it can be put
// back, and boxes drawn on a turned page turn with it.
let rotBusy = false;
async function rotate(all) {
  if (!V || !V.d || rotBusy || !can.edit()) return; const d = V.d, pg = V.page, n = V.n; rotBusy = true; const b = busy(all ? 'Turning every page…' : 'Turning page ' + pg + '…');
  try { if (!window.PDFLib) await loadScript('lib/pdf-lib.min.js');
    const P = window.PDFLib, doc = await P.PDFDocument.load(await X.getBytes(d.url), { ignoreEncryption: true }), pages = doc.getPages(), which = all ? pages.map((_, i) => i + 1) : [pg];
    which.forEach(k => { const p = pages[k - 1]; p.setRotation(P.degrees(((p.getRotation().angle || 0) + 90) % 360)); });
    const bytes = await doc.save(), blob = new Blob([bytes], { type: 'application/pdf' });
    const dir = String(d.path || `projects/${S.project.id}/docs/${d.id}/x`).split('/').slice(0, -1).join('/'), path = `${dir}/${Date.now().toString(36)}-${safeName(d.fileName || 'document.pdf')}`, url = await S.store.putFile(path, blob);
    const prev = [...(d.prevFiles || []), { url: d.url, path: d.path || '', size: d.size || 0, at: new Date().toISOString(), by: S.user.email, why: all ? 'Before every page was turned' : `Before page ${pg} was turned`, marks: d.marks || [] }].slice(-5);
    const marks = (d.marks || []).map(m => which.includes(m.page) ? { ...m, x: Math.max(0, 1 - (m.y + m.h)), y: m.x, w: m.h, h: m.w } : m);
    const patch = { url, path, size: blob.size, prevFiles: prev, marks, textIdx: null }; await S.store.patchItem(S.project.id, 'docs', d.id, patch); Object.assign(d, patch);
    b.done(); rotBusy = false; await open(d, { page: pg });
  } catch (e) { b.done(); rotBusy = false; toast('Could not turn the page: ' + e.message, 8000); }
}
// Remove the page being looked at (a cover sheet, a stray blank) and save the file again. The file as it was is kept with the
// entry. Boxes on that page go with it; boxes on later pages move up one.
async function delPage() {
  if (!V || !V.d || rotBusy || !can.edit()) return; const d = V.d, pg = V.page; if (V.n < 2) return toast('This is the only page');
  let signed = false, bytes0; try { bytes0 = await X.getBytes(d.url); const head = new TextDecoder('latin1').decode(new Uint8Array(bytes0.buffer || bytes0)); signed = /\/ByteRange\s*\[/.test(head); } catch (e) {}
  if (!(await confirmBox(`Remove page ${pg} of ${V.n} from this document?${signed ? ' WARNING: this file carries a digital signature. Removing a page changes the file, so the digital signature will show as invalid. If it was signed digitally, leave the cover page on.' : ''} The file as it is now is kept, and can be put back from the document's details.`, signed ? 'Remove it anyway' : 'Remove page ' + pg))) return open(d, { page: pg });
  rotBusy = true; const b = busy('Removing page ' + pg + '…');
  try { if (!window.PDFLib) await loadScript('lib/pdf-lib.min.js');
    const P = window.PDFLib, doc = await P.PDFDocument.load(bytes0 || await X.getBytes(d.url), { ignoreEncryption: true }); doc.removePage(pg - 1);
    const blob = new Blob([await doc.save()], { type: 'application/pdf' });
    const dir = String(d.path || `projects/${S.project.id}/docs/${d.id}/x`).split('/').slice(0, -1).join('/'), path = `${dir}/${Date.now().toString(36)}-${safeName(d.fileName || 'document.pdf')}`, url = await S.store.putFile(path, blob);
    const prev = [...(d.prevFiles || []), { url: d.url, path: d.path || '', size: d.size || 0, at: new Date().toISOString(), by: S.user.email, why: `Before page ${pg} was removed`, marks: d.marks || [] }].slice(-5);
    const marks = (d.marks || []).filter(m => m.page !== pg).map(m => m.page > pg ? { ...m, page: m.page - 1 } : m);
    const patch = { url, path, size: blob.size, prevFiles: prev, marks, textIdx: null }; await S.store.patchItem(S.project.id, 'docs', d.id, patch); Object.assign(d, patch);
    b.done(); rotBusy = false; await open(d, { page: Math.min(pg, V.n - 1) });
  } catch (e) { b.done(); rotBusy = false; toast('Could not remove the page: ' + e.message, 8000); }
}
export async function open(d, opts = {}) {
  if (!isPdf(d)) return toast('Only PDF documents open in the viewer');
  shell(); const fresh = !V;
  if (fresh) { V = { zoom: 1, gen: 0, pp: [], mode: 'view', side: 'home', res: null, q: '', all: !!opts.all, asset: opts.asset || null, ret: opts.ret || null }; Nav.open('docview', () => close(true)); $('dv').classList.add('show'); }
  if (opts.asset) V.asset = opts.asset; if (opts.all != null) V.all = !!opts.all;
  setMode('view');
  const b = busy('Opening the document…');
  try { if (!V.d || V.d.id !== d.id) V.selCk = null; V.d = fm().docs.find(x => x.id === d.id) || d; V.pdf = await loadPdf(V.d); V.n = V.pdf.numPages; V.hl = null; }
  catch (e) { b.done(); toast('Could not open this document: ' + e.message, 6000); close(); return; }
  b.done(); $('dvMark').style.display = canMark() ? '' : 'none'; $('dvRotG').style.display = can.edit() ? '' : 'none'; $('dvT').textContent = V.d.title; $('dvN').textContent = '/ ' + V.n; $('dvP').max = V.n;
  const mk = opts.markId ? (V.d.marks || []).find(m => m.id === opts.markId) : null;
  await layout(); if (!V) return;
  await show(mk ? mk.page : (opts.page || 1), mk ? mk.y : 0);
  if (mk) detail(mk); else home();
  if (opts.query) { V.q = opts.query; home(); runSearch(); }
}
// Open the search across the contract and specification. opts: {query, asset, ret}
export async function findClause(opts = {}) {
  const src = fm().docs.filter(isSource).sort((a, b) => ((b.marks || []).length - (a.marks || []).length) || (a.type === 'Contract document' ? -1 : 1) - (b.type === 'Contract document' ? -1 : 1) || natural(a.title, b.title));
  if (!src.length) return toast('No contract or specification PDFs yet. Upload them in Documents (type "Contract document" or "Specification / drawing"), then try again.', 8000);
  await open(src[0], { ...opts, all: true });
}

/* ---------- pages: one continuous column that scrolls like a PDF reader; pages are drawn as they come near the screen ---------- */
async function layout() {
  const first = await V.pdf.getPage(1), b = first.getViewport({ scale: 1 }), host = $('dvPages'); host.innerHTML = ''; V.pp = []; V.gen++;
  for (let i = 1; i <= V.n; i++) { const el = document.createElement('div'); el.className = 'dvpg'; el.dataset.p = i; el.innerHTML = '<canvas></canvas><div class="dvo"></div><span class="dvpn">' + i + '</span>'; host.appendChild(el); V.pp.push({ p: i, el, c: el.firstChild, o: el.children[1], w: b.width, h: b.height, gen: -1, pg: null, tc: null }); }
  V.baseW = b.width; size();
}
const scaleNow = () => (Math.max(280, $('dvScroll').clientWidth - 28) / V.baseW) * V.zoom;
function size() { const sc = scaleNow(); V.pp.forEach(pp => { pp.el.style.width = Math.round(pp.w * sc) + 'px'; pp.el.style.height = Math.round(pp.h * sc) + 'px'; }); $('dvZ').textContent = Math.round(V.zoom * 100) + '%'; }
async function drawPage(pp) {
  const gen = V.gen; if (pp.gen === gen || pp.busy === gen) return; pp.busy = gen;
  try {
    const pg = pp.pg || (pp.pg = await V.pdf.getPage(pp.p)); if (!V || V.gen !== gen) return;
    const base = pg.getViewport({ scale: 1 }); if (Math.abs(base.width - pp.w) > 0.5 || Math.abs(base.height - pp.h) > 0.5) { pp.w = base.width; pp.h = base.height; const sc0 = scaleNow(); pp.el.style.width = Math.round(pp.w * sc0) + 'px'; pp.el.style.height = Math.round(pp.h * sc0) + 'px'; }
    const sc = scaleNow(), dpr = Math.min(2, window.devicePixelRatio || 1), vp = pg.getViewport({ scale: sc * dpr });
    const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise; if (!V || V.gen !== gen) return;
    pp.c.replaceWith(c); pp.c = c; pp.vp1 = pg.getViewport({ scale: sc }); pp.gen = gen; await overlayPage(pp);
  } catch (e) { console.warn('page', pp.p, e); } finally { if (pp.busy === gen) pp.busy = null; }
}
function onScroll() {
  if (!V || !V.pp.length) return; const sc = $('dvScroll'), top = sc.scrollTop, bot = top + sc.clientHeight, mid = top + sc.clientHeight * 0.35; let cur = V.page || 1;
  for (const pp of V.pp) { const y = pp.el.offsetTop, h = pp.el.offsetHeight;
    if (y <= mid && y + h >= mid) cur = pp.p;
    if (y + h > top - 900 && y < bot + 900) drawPage(pp);
    else if (pp.gen >= 0 && (y + h < top - 6000 || y > bot + 6000)) { pp.c.width = pp.c.height = 0; pp.gen = -1; }   // let go of pages far away so a long specification stays light
  }
  if (cur !== V.page) { V.page = cur; $('dvP').value = cur; if (V.side === 'home' && V.res) drawResults(); }
}
// Go to a page (and optionally part-way down it, as a fraction of its height)
async function show(p, frac) {
  if (!V || !V.pp.length) return; p = Math.max(1, Math.min(V.n, p || 1)); V.page = p; $('dvP').value = p; const pp = V.pp[p - 1];
  await drawPage(pp); if (!V) return;   // drawing first means the page has its true height before we scroll to it
  $('dvScroll').scrollTop = Math.max(0, pp.el.offsetTop - 8 + (frac ? frac * pp.el.offsetHeight - 90 : 0)); onScroll();
}
async function runs(pp) {
  if (!pp.tc) pp.tc = await pp.pg.getTextContent(); const W = pp.vp1.width, H = pp.vp1.height, L = await lib();
  return pp.tc.items.filter(it => it.str && it.str.trim()).map(it => { const tx = L.Util.transform(pp.vp1.transform, it.transform), h = Math.hypot(tx[2], tx[3]) || 8; return { s: it.str, x: tx[4] / W, y: (tx[5] - h) / H, w: (it.width * pp.vp1.scale) / W, h: (h * 1.15) / H }; });
}
const names = (ids, list, key) => (ids || []).map(id => list.find(x => x.id === id)).filter(Boolean).map(x => x[key]);
async function overlayPage(pp) {
  let h = ''; const all = (V.d.marks || []).slice().sort((a, b) => a.page - b.page || a.y - b.y);
  all.forEach((m, i) => { if (m.page !== pp.p) return; const an = names(m.assetIds, fm().assets, 'element'), tn = names(m.taskIds, fm().tasks, 'title');
    h += `<div class="dvm ${KCLS[m.kind] || 'ko'}${m.pass ? ' pass' : ''}${m.flag ? ' flag' : ''}${m.pending ? ' pend' : ''}${V.sel === m.id ? ' sel' : ''}" data-m="${esc(m.id)}" style="z-index:${Math.max(1, Math.round(1000 - m.w * m.h * 1000))};left:${m.x * 100}%;top:${m.y * 100}%;width:${m.w * 100}%;height:${m.h * 100}%"><i>${i + 1}</i><div class="dvtip"><b>${esc(m.kind || 'Requirement')}${m.period ? ': ' + esc(m.period) : ''}</b>${m.flag ? '<br><span style="color:#ffb4b4">Problem: ' + esc(m.flag) + '</span>' : ''}${m.pending ? '<br>Marked by AI, not checked yet' : ''}${m.clause ? '<br>Clause ' + esc(m.clause) : ''}${an.length ? '<br>Assets: ' + esc(an.join('; ')) : ''}${tn.length ? '<br>Tasks: ' + esc(tn.join('; ')) : ''}<br><u>${V.d.submitted && m.ck ? 'Click to see this point' : 'Click to open'}</u></div></div>`; });
  if (V.hl && V.hl.length && pp.pg && pp.vp1) { const set = new Set(V.hl); try { for (const r of await runs(pp)) { if (norm(r.s).split(' ').some(w => set.has(w))) h += `<div class="dvhl" style="left:${r.x * 100}%;top:${r.y * 100}%;width:${r.w * 100}%;height:${r.h * 100}%"></div>`; } } catch (e) {} }
  if (!V) return; pp.o.innerHTML = h;
  pp.o.querySelectorAll('.dvm').forEach(el => el.onclick = e => { if (V.mode === 'mark') return; e.stopPropagation(); const m = (V.d.marks || []).find(x => x.id === el.dataset.m); if (!m) return; if (V.d.submitted && m.ck) { V.selCk = m.id; V.sel = m.id; home(); return; } detail(m); overlay(); });
}
function overlay() { if (V) V.pp.forEach(pp => { if (pp.gen === V.gen) overlayPage(pp); }); }
function wireDraw() {
  const host = $('dvPages'); let st = null, box = null, pp = null, o = null;
  const pt = e => { const r = o.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) }; };
  host.addEventListener('pointerdown', e => { if (!V || V.mode !== 'mark' || e.button > 0) return; const el = e.target.closest('.dvpg'); if (!el) return; pp = V.pp[+el.dataset.p - 1]; if (!pp || pp.gen !== V.gen) return; o = pp.o; e.preventDefault(); st = pt(e); box = document.createElement('div'); box.className = 'dvm kw draft'; o.appendChild(box); try { host.setPointerCapture(e.pointerId); } catch (x) {} });
  host.addEventListener('pointermove', e => { if (!st) return; const p = pt(e); Object.assign(box.style, { left: Math.min(st.x, p.x) * 100 + '%', top: Math.min(st.y, p.y) * 100 + '%', width: Math.abs(p.x - st.x) * 100 + '%', height: Math.abs(p.y - st.y) * 100 + '%' }); });
  const end = async e => { if (!st) return; const p = pt(e), r = { x: Math.min(st.x, p.x), y: Math.min(st.y, p.y), w: Math.abs(p.x - st.x), h: Math.abs(p.y - st.y) }, on = pp; st = null; box.remove(); box = null;
    if (r.w < 0.02 || r.h < 0.008) return toast('Drag a bigger box around the words');
    let text = ''; try { text = (await runs(on)).filter(t => t.x + t.w / 2 >= r.x && t.x + t.w / 2 <= r.x + r.w && t.y + t.h / 2 >= r.y && t.y + t.h / 2 <= r.y + r.h).map(t => t.s).join(' ').replace(/\s+/g, ' ').trim(); } catch (x) {}
    const cl = /^\(?([A-Z]?\d+(?:\.\d+){0,3}[a-z]?)\)?[\s.:]/.exec(text), per = /(\d+|one|two|three|five|ten|fifteen|twenty)\s*\(?\d*\)?\s*(year|yr|month)s?/i.exec(text);
    const req = /warrant|guarant/i.test(text), mt = /maint|servic|clean|inspect/i.test(text), src = isSource(V.d);
    const kind = req ? 'Warranty requirement' : mt ? 'Maintenance requirement' : src ? 'Warranty requirement' : 'Product or finish detail';
    form({ id: uid(), page: on.p, ...r, kind, text: text.slice(0, 900), clause: cl && src ? cl[1] : '', period: kind === 'Product or finish detail' ? text.slice(0, 120) : per ? per[0].replace(/\s+/g, ' ') : '', assetIds: V.asset ? [V.asset.id] : (V.d.assetIds || []).slice(), taskIds: [] }, true);
  };
  host.addEventListener('pointerup', end); host.addEventListener('pointercancel', () => { if (box) box.remove(); st = box = null; });
}

/* ---------- side panel: search and the list of marked clauses ---------- */
const QUICK = [['Warranties', 'warranty guarantee'], ['Maintenance', 'maintenance'], ['O&M manuals', 'o&m manual'], ['As-builts', 'as-built'], ['Producer statements', 'producer statement']];
function home() {
  if (!V) return; V.side = 'home'; V.sel = V.d && V.d.submitted ? (V.selCk || null) : null; const marks = (V.d.marks || []).slice().sort((a, b) => a.page - b.page || a.y - b.y);
  $('dvSide').innerHTML = `${V.asset ? `<div class="dvctx">Marking for: <b>${esc(V.asset.element)}</b><br><span class="muted small">Find the clause, press “Mark”, and drag a box around it.</span></div>` : ''}
    ${V.d.submitted && X.subBox ? X.subBox(V.d, (V.d.marks || []).find(m => m.id === V.selCk)) : ''}
    <div class="dvsearch" ${V.d.submitted ? 'hidden' : ''}><input type="search" id="dvQ" placeholder="Find a clause, e.g. roof warranty" value="${esc(V.q || '')}"><button class="go" id="dvGo">Search</button></div>
    <div class="dvquick" ${V.d.submitted ? 'hidden' : ''}>${QUICK.map(([l, q]) => `<button data-q="${esc(q)}">${l}</button>`).join('')}</div>
    <label class="dvall" ${V.d.submitted ? 'hidden' : ''}><input type="checkbox" id="dvAll" ${V.all ? 'checked' : ''}> Search all contract and specification documents</label>
    <div id="dvRes"></div>
    ${V.d.aiRead && !V.d.submitted ? `<div class="dvctx"><b>✨ Read by AI</b> ${esc(nzDate(String(V.d.aiRead).slice(0, 10)))}${V.d.aiSummary ? '<br><span class="small">' + esc(V.d.aiSummary) + '</span>' : ''}${(V.d.aiProblems || []).length ? '<br><span class="small" style="color:#a32222"><b>Problems found:</b><br>' + V.d.aiProblems.map(x => '• ' + esc(x)).join('<br>') + '</span>' : ''}${marks.some(m => m.pending) && can.edit() ? `<br><button class="mini" id="dvAcc">✔ Accept all ${marks.filter(m => m.pending).length} AI boxes</button>` : ''}</div>` : ''}
    ${can.edit() && V.d.size ? `<p><button class="mini" id="dvRead">✨ ${V.d.aiRead ? 'Read again with AI' : 'Read this document with AI'}</button></p>` : ''}
    <h4>Marked in this document (${marks.length})</h4>
    ${marks.map((m, i) => `<div class="dvrow" data-go="${esc(m.id)}"><i class="${KCLS[m.kind] || 'ko'}">${i + 1}</i><div><b>${esc(m.period || m.kind || 'Requirement')}</b>${m.flag ? ' <span class="st st-bad">problem</span>' : ''}${m.pending ? ' <span class="st st-warn">to check</span>' : ''} <span class="muted small">p. ${m.page}${m.clause ? ' · cl. ' + esc(m.clause) : ''}</span><br><span class="small">${esc(names(m.assetIds, fm().assets, 'element').concat(names(m.taskIds, fm().tasks, 'title')).join('; ') || 'Not linked yet')}</span></div></div>`).join('') || `<p class="muted small">${V.d.template && canMark() ? 'Nothing marked yet. Press “Mark” and drag a box around each place the recipient must fill in, then “⬇ With markup” gives them a copy with numbered boxes and instructions.' : V.d.submitted && canMark() ? 'Nothing marked yet. Press “Mark” and drag a box around anything that is wrong or needs explaining.' : can.edit() ? 'Nothing marked yet. Press “Mark” and drag a box around the words: a clause that sets a requirement, or a product detail such as a colour or model.' : 'Nothing has been marked in this document.'}</p>`}
    ${can.edit() ? `<label class="dvall" style="margin-top:10px"><input type="checkbox" id="dvSrc" ${isSource(V.d) ? 'checked' : ''}> This is a requirement source (included in clause searches)</label>` : ''}`;
  if (X.subWire) X.subWire(V.d, d => open(d), async m => { V.selCk = m.id; V.sel = m.id; await show(m.page, Math.max(0, m.y - 0.15)); home(); });
  if ($('dvRead')) $('dvRead').onclick = () => window.dispatchEvent(new CustomEvent('rd-ai-read', { detail: V.d.id }));
  if ($('dvAcc')) $('dvAcc').onclick = async () => { await saveMarks((V.d.marks || []).map(m => m.pending ? { ...m, pending: false, checkedBy: S.user.email } : m)); toast('Accepted'); home(); };
  $('dvGo').onclick = runSearch; $('dvQ').onkeydown = e => { if (e.key === 'Enter') runSearch(); };
  $('dvSide').querySelectorAll('[data-q]').forEach(b => b.onclick = () => { $('dvQ').value = b.dataset.q; runSearch(); });
  $('dvAll').onchange = e => { V.all = e.target.checked; if (V.q) runSearch(); };
  if ($('dvSrc')) $('dvSrc').onchange = async e => { try { await S.store.patchItem(S.project.id, 'docs', V.d.id, { source: e.target.checked }); V.d.source = e.target.checked; } catch (x) { toast(x.message); } };
  $('dvSide').querySelectorAll('[data-go]').forEach(r => r.onclick = async () => { const m = (V.d.marks || []).find(x => x.id === r.dataset.go); if (!m) return; await show(m.page, m.y); detail(m); });
  if (V.res) drawResults(); overlay();
}
async function runSearch(extra) {
  const q = ($('dvQ') ? $('dvQ').value : V.q).trim(); V.q = q; if (!q) return;
  const list = V.all ? [V.d, ...fm().docs.filter(d => isSource(d) && d.id !== V.d.id)] : [V.d];
  const b = busy('Reading the documents…'); const out = []; let scanned = 0, failed = 0;
  for (const [i, d] of list.entries()) {
    try { const pages = await textIndex(d, d.id === V.d.id ? V.pdf : null, (p, n) => b.set(`Reading ${i + 1} of ${list.length}: ${d.title} (page ${p} of ${n})`)); if (pages.reduce((a, x) => a + x.t.length, 0) < pages.length * 40) scanned++;
      const r = search(pages, q, extra); r.hits.forEach(h => out.push({ d, ...h, partial: r.partial })); }
    catch (e) { failed++; console.warn('search', d.title, e); }
  }
  b.done(); if (!V) return;
  const full = out.filter(h => !h.partial);
  V.res = { q, hits: (full.length ? full : out).sort((a, b) => b.score - a.score).slice(0, 120), partial: !full.length && out.length > 0, scanned, failed, docs: list.length, ai: !!extra };
  if (V.side === 'home') drawResults(); else home();
}
function drawResults() {
  const R = V.res, el = $('dvRes'); if (!el || !R) return;
  let last = '';
  el.innerHTML = `<h4>${R.hits.length ? R.hits.length + (R.hits.length === 120 ? '+' : '') + ' page' + (R.hits.length === 1 ? '' : 's') + ' for' : 'Nothing found for'} “${esc(R.q)}”${R.docs > 1 ? ' in ' + R.docs + ' documents' : ''}</h4>
    ${R.partial ? '<p class="muted small">No page has all of those words. These pages have some of them.</p>' : ''}
    ${R.hits.map((h, i) => { const g = V.all && h.d.id !== last ? `<div class="dvdoc">${esc(h.d.title)}</div>` : ''; last = h.d.id; return g + `<div class="dvhit${h.d.id === V.d.id && h.p === V.page ? ' on' : ''}" data-h="${i}"><b>p. ${h.p}</b> <span class="small">${esc(h.snippet)}</span></div>`; }).join('')}
    ${R.scanned ? `<p class="muted small">${R.scanned === 1 && R.docs === 1 ? 'This document is a scan with no readable text, so it cannot be searched.' : R.scanned + ' scanned document' + (R.scanned === 1 ? '' : 's') + ' have no readable text and were skipped.'}</p>` : ''}${R.failed ? `<p class="muted small">${R.failed} document${R.failed === 1 ? '' : 's'} could not be read.</p>` : ''}
    ${!R.ai ? `<p><button class="mini" id="dvAi">✨ ${R.hits.length ? 'Not what you wanted? Ask AI for other words' : 'Ask AI for other words to try'}</button></p>` : '<p class="muted small">Searched again with words suggested by AI.</p>'}`;
  el.querySelectorAll('[data-h]').forEach(r => r.onclick = async () => { const h = R.hits[+r.dataset.h]; if (h.d.id !== V.d.id) { const keep = { q: V.q, res: V.res, all: V.all }; await open(h.d, { page: h.p }); if (!V) return; Object.assign(V, keep); V.hl = h.words; await show(h.p); home(); } else { V.hl = h.words; await show(h.p); overlay(); drawResults(); } });
  if ($('dvAi')) $('dvAi').onclick = async () => { const btn = $('dvAi'); btn.disabled = true; btn.textContent = 'Asking…';
    try { const t = await aiCall(`Someone is searching a New Zealand construction contract and specification for: "${R.q}". List other words or short phrases those documents might use for the same thing (trade terms, formal contract wording, product names, abbreviations). Return JSON {"terms":["...", up to 12]}.`); let terms = []; try { terms = JSON.parse(String(t).replace(/^```(?:json)?\s*|\s*```$/g, '')).terms || []; } catch (e) {} if (!terms.length) throw new Error('AI gave no suggestions'); await runSearch(terms.slice(0, 12).map(String)); }
    catch (e) { toast(e.message === 'nokey' ? 'Set up the AI helper first (☰ > AI)' : e.message, 5000); btn.disabled = false; btn.textContent = '✨ Ask AI for other words'; } };
}

/* ---------- one marked clause: view, edit, save ---------- */
async function snipImg(el, m) { if (!m.snip) { el.style.display = 'none'; return; } try { el.src = await S.store.resolveUrl(m.snip); } catch (e) { el.style.display = 'none'; } }
function detail(m) {
  if (!V) return; V.side = 'detail'; V.sel = m.id; const A = (m.assetIds || []).map(id => fm().assets.find(a => a.id === id)).filter(Boolean), T = (m.taskIds || []).map(id => fm().tasks.find(t => t.id === id)).filter(Boolean);
  // Boxes in reading order, so Previous and Next step through the document the same way the numbers on the page run.
  const all = (V.d.marks || []).slice().sort((a, b) => a.page - b.page || a.y - b.y), ix = all.findIndex(x => x.id === m.id);
  $('dvSide').innerHTML = `<div class="dvnav"><button class="dvback" id="dvB">‹ Search and list</button><span><button class="mini" id="dvPv" ${ix <= 0 ? 'disabled' : ''}>‹ Previous</button> <b>${ix + 1} of ${all.length}</b> <button class="mini" id="dvNx" ${ix >= all.length - 1 ? 'disabled' : ''}>Next ›</button></span></div>
    <h3><span class="dvk ${KCLS[m.kind] || 'ko'}">${esc(m.kind || 'Requirement')}</span></h3>
    ${m.period ? `<p class="dvper">${esc(m.period)}</p>` : ''}<p class="muted small">${esc(V.d.title)} · page ${m.page}${m.clause ? ' · clause ' + esc(m.clause) : ''}</p>
    <img class="dvsnip" id="dvSn" alt="The marked clause">${m.text ? `<p class="dvtext">${esc(m.text)}</p>` : ''}${m.note ? `<p><b>Note:</b> ${esc(m.note)}</p>` : ''}${m.flag ? `<p style="color:#a32222"><b>Problem:</b> ${esc(m.flag)}</p>` : ''}${m.pending ? `<p class="muted small">Marked by AI. Check the box is in the right place and linked to the right asset.${can.edit() ? ' <button class="mini" id="dvOk">✔ Accept</button>' : ''}</p>` : ''}
    <h4>Applies to</h4>${A.map(a => `<button class="dvlink" data-a="${esc(a.id)}">▤ ${esc(a.ref || '')} ${esc(a.element)}<small>Open the asset</small></button>`).join('')}${T.map(t => `<button class="dvlink" data-t="${esc(t.id)}">⟳ ${esc(t.title)}<small>Open the maintenance task</small></button>`).join('')}${!A.length && !T.length ? '<p class="muted small">Not linked to an asset or task yet.</p>' : ''}
    ${canMark() ? '<div class="act"><button id="dvDel" class="warn">Delete</button><button id="dvEd" class="go">Edit</button></div>' : ''}`;
  snipImg($('dvSn'), m); $('dvB').onclick = home; const step = async k => { const t = all[ix + k]; if (!t) return; await show(t.page, t.y); detail(t); overlay(); }; $('dvPv').onclick = () => step(-1); $('dvNx').onclick = () => step(1);
  if ($('dvOk')) $('dvOk').onclick = async () => { const o = { ...m, pending: false, checkedBy: S.user.email }; await saveMarks((V.d.marks || []).map(x => x.id === m.id ? o : x)); toast('Accepted'); detail(o); };
  $('dvSide').querySelectorAll('[data-a]').forEach(b => b.onclick = () => { const id = b.dataset.a; if (V) V.ret = null; close(); X.openAsset(id); });
  $('dvSide').querySelectorAll('[data-t]').forEach(b => b.onclick = () => { const id = b.dataset.t; if (V) V.ret = null; close(); X.openTask(id); });
  if ($('dvEd')) $('dvEd').onclick = () => form(JSON.parse(JSON.stringify(m)), false);
  if ($('dvDel')) $('dvDel').onclick = async () => { if (!(await confirmBox(V.d.submitted ? 'Delete this box?' : 'Delete this marked clause? The links to its assets and tasks go with it.', 'Delete'))) return; await saveMarks((V.d.marks || []).filter(x => x.id !== m.id), m.flag, ''); if (m.snip && can.edit()) { try { Promise.resolve(S.store.deleteFile(`projects/${S.project.id}/docs/${V.d.id}/snips/${m.id}.jpg`)).catch(() => {}); } catch (e) {} } toast('Deleted'); home(); };
  overlay();
}
const pick = (list, ids, label, key) => `<div class="dvpick" data-pick="${key}"><input type="search" placeholder="Filter ${label}…"><div class="dvlist">${list.map(x => `<label data-s="${esc((x.txt).toLowerCase())}"><input type="checkbox" value="${esc(x.id)}" ${ids.includes(x.id) ? 'checked' : ''}> ${esc(x.txt)}</label>`).join('')}</div></div>`;
// On a submitted warranty a box only needs to say what is wrong: one field, one tap to save.
function quickForm(m, isNew) {
  V.side = 'form'; setMode('view'); V.sel = m.id;
  $('dvSide').innerHTML = `<h3>${isNew ? 'New box' : 'Edit box'}</h3><p class="muted small">Page ${m.page} of ${esc(V.d.title)}</p>
    ${m.text ? `<p class="dvtext">${esc(m.text.slice(0, 300))}</p>` : ''}
    <label class="f">${V.d.template ? 'What they need to fill in here' : 'What needs to change here?'}<textarea id="qkF" rows="4" placeholder="${V.d.template ? 'e.g. Insert your company\'s full registered name' : 'e.g. Contractor must read Miles Construction Limited'}">${esc(m.flag || '')}</textarea></label>
    <label class="f">Note (optional, not a problem)<input id="qkN" value="${esc(m.note || '')}" placeholder="e.g. Signature confirmed by phone"></label>
    <div class="act"><button id="qkX">Cancel</button>${can.edit() ? '<button id="qkMore">More options</button>' : ''}<button id="qkS" class="go">Save</button></div>`;
  const read = () => ({ ...m, kind: m.kind && !isNew ? m.kind : 'Other', flag: $('qkF').value.trim(), note: $('qkN').value.trim(), period: (m.chk ? m.period : '') || ($('qkF').value.trim() || $('qkN').value.trim()).slice(0, 80), assetIds: (m.assetIds || []).length ? m.assetIds : (V.d.assetIds || []).slice(), taskIds: m.taskIds || [], pending: false, chk: false, updated: new Date().toISOString(), by: S.user.email });
  $('qkX').onclick = () => { const cur = (V.d.marks || []).find(x => x.id === m.id); cur ? detail(cur) : home(); };
  if ($('qkMore')) $('qkMore').onclick = () => form(read(), isNew, true);
  $('qkS').onclick = async () => { const o = read(); if (!o.flag && !o.note) return toast('Say what needs to change, or add a note');
    const b = busy('Saving…'); try { if (isNew || !o.snip) { try { o.snip = await makeSnip(o); } catch (e) { console.warn('snip', e); } } await saveMarks([...(V.d.marks || []).filter(x => x.id !== o.id), o].map(x => JSON.parse(JSON.stringify(x))), m.flag || '', o.flag); b.done(); toast('Saved'); home(); }
    catch (e) { b.done(); toast('Could not save: ' + e.message, 6000); } };
  setTimeout(() => $('qkF') && $('qkF').focus(), 50); overlay();
}
function form(m, isNew, full) {
  if (quick() && !full) return quickForm(m, isNew);
  V.side = 'form'; setMode('view'); V.sel = m.id;
  const A = fm().assets.slice().sort((a, b) => natural(a.system, b.system) || natural(a.ref || '', b.ref || '')).map(a => ({ id: a.id, txt: `${a.ref || ''} ${a.element}${a.installer ? ' (' + a.installer + ')' : ''}`.trim() }));
  const T = fm().tasks.slice().sort((a, b) => natural(a.system || '', b.system || '') || natural(a.title, b.title)).map(t => ({ id: t.id, txt: t.title }));
  // ticked items float to the top so the current links are visible
  const top = (L, ids) => L.filter(x => ids.includes(x.id)).concat(L.filter(x => !ids.includes(x.id)));
  $('dvSide').innerHTML = `<h3>${isNew ? 'New marked clause' : 'Edit marked clause'}</h3><p class="muted small">Page ${m.page} of ${esc(V.d.title)}</p>
    <label class="f">What is this?<select id="mkK">${KINDS.map(k => `<option ${k === m.kind ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
    <label class="f">Period, frequency or product detail<input id="mkP" value="${esc(m.period || '')}" placeholder="e.g. 10 years from practical completion, or the colour and model"></label>
    <label class="f">Clause number<input id="mkC" value="${esc(m.clause || '')}" placeholder="e.g. 11.5"></label>
    <label class="f">What it says (read from the box; correct it if needed)<textarea id="mkX" rows="4">${esc(m.text || '')}</textarea></label>
    <label class="f">Note<input id="mkN" value="${esc(m.note || '')}" placeholder="Optional"></label>
    <label class="f">Problem<textarea id="mkF" rows="3" placeholder="Leave empty if there is nothing wrong">${esc(m.flag || '')}</textarea><small class="note">Edit the wording, or clear it if this is not a problem.</small></label>
    <h4>Assets this applies to</h4>${pick(top(A, m.assetIds || []), m.assetIds || [], 'assets', 'a')}
    <details ${(m.taskIds || []).length ? 'open' : ''}><summary>Maintenance tasks this applies to${(m.taskIds || []).length ? ' (' + m.taskIds.length + ')' : ''}</summary>${pick(top(T, m.taskIds || []), m.taskIds || [], 'tasks', 't')}</details>
    <div class="act"><button id="mkX2">Cancel</button><button id="mkS" class="go">Save</button></div>`;
  $('dvSide').querySelectorAll('.dvpick').forEach(p => { p.querySelector('input[type=search]').oninput = e => { const q = e.target.value.toLowerCase().trim(); p.querySelectorAll('label').forEach(l => l.style.display = !q || q.split(' ').every(w => l.dataset.s.includes(w)) ? '' : 'none'); }; });
  const ids = k => [...$('dvSide').querySelectorAll(`[data-pick=${k}] input[type=checkbox]:checked`)].map(i => i.value);
  $('mkX2').onclick = () => { const cur = (V.d.marks || []).find(x => x.id === m.id); cur ? detail(cur) : home(); };
  $('mkS').onclick = async () => {
    const o = { ...m, kind: $('mkK').value, period: $('mkP').value.trim(), clause: $('mkC').value.trim(), text: $('mkX').value.trim().slice(0, 900), note: $('mkN').value.trim(), flag: $('mkF').value.trim(), assetIds: ids('a'), taskIds: ids('t'), pending: false, updated: new Date().toISOString(), by: S.user.email };
    if (!o.assetIds.length && !o.taskIds.length && !(await confirmBox('This clause is not linked to an asset or a task yet. Save it anyway?', 'Save'))) return;
    const b = busy('Saving…');
    try { if (isNew || !o.snip) { try { o.snip = await makeSnip(o); } catch (e) { console.warn('snip', e); } }
      const rest = (V.d.marks || []).filter(x => x.id !== o.id); await saveMarks([...rest, o], m.flag, o.flag); b.done(); toast('Saved'); detail(o); }
    catch (e) { b.done(); toast('Could not save: ' + e.message, 6000); }
  };
  overlay();
}
// When a box's problem wording is edited or cleared, the document's problem list follows, so badges and "To check" stay true.
async function saveMarks(marks, oldFlag, newFlag) { const patch = { marks };
  if (oldFlag !== undefined && oldFlag !== newFlag) { const L = (V.d.aiProblems || []).filter(x => x !== oldFlag); if (newFlag) L.push(newFlag); patch.aiProblems = [...new Set(L)]; } if (V.d.source == null && marks.length) patch.source = true; await S.store.patchItem(S.project.id, 'docs', V.d.id, patch); V.d = { ...V.d, ...patch }; }
// A picture of the marked box, kept beside the document so it can be shown on the asset and in exports without opening the PDF.
async function makeSnip(m) {
  const pg = await V.pdf.getPage(m.page), base = pg.getViewport({ scale: 1 }), sc = Math.max(1.2, Math.min(3, 1000 / (m.w * base.width))), vp = pg.getViewport({ scale: sc });
  const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height); const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  await pg.render({ canvasContext: x, viewport: vp }).promise;
  const pad = 6, sx = Math.max(0, m.x * c.width - pad), sy = Math.max(0, m.y * c.height - pad), sw = Math.min(c.width - sx, m.w * c.width + pad * 2), sh = Math.min(c.height - sy, m.h * c.height + pad * 2);
  const o = document.createElement('canvas'); o.width = Math.round(sw); o.height = Math.round(sh); o.getContext('2d').drawImage(c, sx, sy, sw, sh, 0, 0, o.width, o.height);
  const blob = await new Promise(res => o.toBlob(res, 'image/jpeg', 0.82));
  return await S.store.putFile(`projects/${S.project.id}/docs/${V.d.id}/snips/${m.id}.jpg`, blob);
}
