// Document viewer: read a PDF inside the app, mark the clauses that set a requirement (warranty, maintenance, documents),
// link each marked box to assets and maintenance tasks, and search the contract and specification in plain words.
import { S, can } from './state.js';
import * as Nav from './nav.js';
import { aiCall } from './ai.js';
import { $, esc, toast, busy, confirmBox, uid, natural } from './util.js';
import { search, norm } from './clausefind.js';

let X = null, pdfjs = null, V = null;
export const KINDS = ['Warranty requirement', 'Maintenance requirement', 'Document requirement', 'Other'];
const KCLS = { 'Warranty requirement': 'kw', 'Maintenance requirement': 'km', 'Document requirement': 'kd', 'Other': 'ko' };
const fm = () => S.fm || { assets: [], docs: [], tasks: [], systems: [] };
export function init(ctx) { X = ctx; }
export const isPdf = d => !!d && !!d.url && (/\.pdf$/i.test(d.fileName || '') || d.mime === 'application/pdf');
// Source documents are where requirements come from: the contract and the specification, or anything ticked as a source or already marked up.
export const isSource = d => isPdf(d) && d.source !== false && (d.source === true || (d.marks || []).length > 0 || ['Contract document', 'Specification / drawing'].includes(d.type));
export const marksFor = (kind, id) => fm().docs.flatMap(d => (d.marks || []).filter(m => ((kind === 'asset' ? m.assetIds : m.taskIds) || []).includes(id)).map(m => ({ d, m }))).sort((a, b) => natural(a.d.title, b.d.title) || a.m.page - b.m.page);
export const markLine = ({ d, m }) => [d.title, 'p. ' + m.page, m.clause ? 'cl. ' + m.clause : '', m.period || ''].filter(Boolean).join(' · ');

async function lib() { if (!pdfjs) { pdfjs = await import('../lib/pdfjs/pdf.min.mjs'); pdfjs.GlobalWorkerOptions.workerSrc = new URL('../lib/pdfjs/pdf.worker.min.mjs', import.meta.url).href; } return pdfjs; }
async function loadPdf(d) {
  const L = await lib(); let u = ''; try { u = await S.store.resolveUrl(d.url); } catch (e) {}
  if (u) { try { return await L.getDocument({ url: u }).promise; } catch (e) { console.warn('pdf by url failed, reading the whole file', e); } }
  return await L.getDocument({ data: await X.getBytes(d.url) }).promise;
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

/* ---------- shell ---------- */
function shell() {
  if ($('dv')) return;
  const el = document.createElement('div'); el.id = 'dv';
  el.innerHTML = `<div class="dvh"><button id="dvX" title="Close">‹ Back</button><b id="dvT"></b><span class="sp"></span>
    <button id="dvPrev" title="Previous page">‹</button><input id="dvP" type="number" min="1" title="Page"><span id="dvN" class="muted"></span><button id="dvNext" title="Next page">›</button>
    <button id="dvZo" title="Zoom out">−</button><button id="dvZi" title="Zoom in">+</button>
    <button id="dvMark" class="go" title="Draw a box around a clause and link it to an asset or task">▭ Mark a clause</button><button id="dvTab" title="Open the file in a new tab">↗</button></div>
    <div class="dvb"><div class="dvpage" id="dvScroll"><div id="dvWrap"><canvas id="dvC"></canvas><div id="dvO"></div></div></div><aside class="dvside" id="dvSide"></aside></div>`;
  document.body.appendChild(el);
  $('dvX').onclick = () => close(); $('dvPrev').onclick = () => show(V.page - 1); $('dvNext').onclick = () => show(V.page + 1);
  $('dvP').onchange = e => show(+e.target.value || 1);
  $('dvZi').onclick = () => { V.zoom = Math.min(4, V.zoom * 1.25); show(V.page); }; $('dvZo').onclick = () => { V.zoom = Math.max(0.5, V.zoom / 1.25); show(V.page); };
  $('dvMark').onclick = () => setMode(V.mode === 'mark' ? 'view' : 'mark');
  $('dvTab').onclick = async () => { const u = await S.store.resolveUrl(V.d.url); if (u) window.open(u, '_blank', 'noopener'); };
  document.addEventListener('keydown', e => { if (!V || !$('dv').classList.contains('show') || $('modal').classList.contains('show') || document.querySelector('.askov')) return; const typing = /INPUT|TEXTAREA|SELECT/.test((e.target || {}).tagName || '');
    if (e.key === 'Escape') { if (V.mode === 'mark') setMode('view'); else if (V.side !== 'home') home(); else close(); } else if (!typing && (e.key === 'ArrowRight' || e.key === 'PageDown')) show(V.page + 1); else if (!typing && (e.key === 'ArrowLeft' || e.key === 'PageUp')) show(V.page - 1); });
  wireDraw();
}
function setMode(m) { V.mode = m; $('dvMark').classList.toggle('on', m === 'mark'); $('dvMark').textContent = m === 'mark' ? '✕ Stop marking' : '▭ Mark a clause'; $('dvO').classList.toggle('drawing', m === 'mark'); if (m === 'mark') toast('Drag a box around the clause on the page', 3500); }
function close(silent) {
  if (!V) return; const ret = V.ret; try { V.task && V.task.cancel(); } catch (e) {} $('dv').classList.remove('show'); V = null; if (!silent) Nav.closed('docview');
  if (ret) ret();
}
// opts: {page, markId, query, all, asset (preselect when marking), ret (called after closing)}
export async function open(d, opts = {}) {
  if (!isPdf(d)) return toast('Only PDF documents open in the viewer');
  shell(); const fresh = !V;
  if (fresh) { V = { zoom: 1, mode: 'view', side: 'home', res: null, q: '', all: !!opts.all, asset: opts.asset || null, ret: opts.ret || null }; Nav.open('docview', () => close(true)); $('dv').classList.add('show'); }
  if (opts.asset) V.asset = opts.asset; if (opts.all != null) V.all = !!opts.all;
  $('dvMark').style.display = can.edit() ? '' : 'none'; setMode('view');
  const b = busy('Opening the document…');
  try { V.d = fm().docs.find(x => x.id === d.id) || d; V.pdf = await loadPdf(V.d); V.n = V.pdf.numPages; V.hl = null; }
  catch (e) { b.done(); toast('Could not open this document: ' + e.message, 6000); close(); return; }
  b.done(); $('dvT').textContent = V.d.title; $('dvN').textContent = '/ ' + V.n; $('dvP').max = V.n;
  const mk = opts.markId ? (V.d.marks || []).find(m => m.id === opts.markId) : null;
  await show(mk ? mk.page : (opts.page || 1));
  if (mk) detail(mk); else home();
  if (opts.query) { V.q = opts.query; home(); runSearch(); }
}
// Open the search across the contract and specification. opts: {query, asset, ret}
export async function findClause(opts = {}) {
  const src = fm().docs.filter(isSource).sort((a, b) => ((b.marks || []).length - (a.marks || []).length) || (a.type === 'Contract document' ? -1 : 1) - (b.type === 'Contract document' ? -1 : 1) || natural(a.title, b.title));
  if (!src.length) return toast('No contract or specification PDFs yet. Upload them in Documents (type "Contract document" or "Specification / drawing"), then try again.', 8000);
  await open(src[0], { ...opts, all: true });
}

/* ---------- page ---------- */
async function show(p) {
  if (!V) return; p = Math.max(1, Math.min(V.n, p || 1)); V.page = p; $('dvP').value = p; const tok = (V.tok = (V.tok || 0) + 1);
  const pg = await V.pdf.getPage(p); if (!V || tok !== V.tok) return;
  const base = pg.getViewport({ scale: 1 }), avail = Math.max(280, $('dvScroll').clientWidth - 24), sc = (avail / base.width) * V.zoom, dpr = Math.min(2, window.devicePixelRatio || 1);
  const vp = pg.getViewport({ scale: sc * dpr }), c = $('dvC');
  try { V.task && V.task.cancel(); } catch (e) {}
  c.width = Math.round(vp.width); c.height = Math.round(vp.height); $('dvWrap').style.width = Math.round(base.width * sc) + 'px'; $('dvWrap').style.height = Math.round(base.height * sc) + 'px';
  V.task = pg.render({ canvasContext: c.getContext('2d'), viewport: vp });
  try { await V.task.promise; } catch (e) { if (e && e.name === 'RenderingCancelledException') return; console.warn(e); }
  if (!V || tok !== V.tok) return;
  V.pg = pg; V.vp1 = pg.getViewport({ scale: sc }); V.tc = null; $('dvScroll').scrollTop = 0;
  await overlay();
}
async function pageText() { if (!V.tc) V.tc = await V.pg.getTextContent(); return V.tc; }
// rectangles (as fractions of the page) of every text run on this page
async function runs() {
  const tc = await pageText(), W = V.vp1.width, H = V.vp1.height, L = await lib();
  return tc.items.filter(it => it.str && it.str.trim()).map(it => { const tx = L.Util.transform(V.vp1.transform, it.transform), h = Math.hypot(tx[2], tx[3]) || 8; return { s: it.str, x: tx[4] / W, y: (tx[5] - h) / H, w: (it.width * V.vp1.scale) / W, h: (h * 1.15) / H }; });
}
const names = (ids, list, key) => (ids || []).map(id => list.find(x => x.id === id)).filter(Boolean).map(x => x[key]);
async function overlay() {
  const o = $('dvO'); let h = '';
  const all = (V.d.marks || []).slice().sort((a, b) => a.page - b.page || a.y - b.y);
  all.forEach((m, i) => { if (m.page !== V.page) return; const an = names(m.assetIds, fm().assets, 'element'), tn = names(m.taskIds, fm().tasks, 'title');
    h += `<div class="dvm ${KCLS[m.kind] || 'ko'}${V.sel === m.id ? ' sel' : ''}" data-m="${esc(m.id)}" style="left:${m.x * 100}%;top:${m.y * 100}%;width:${m.w * 100}%;height:${m.h * 100}%"><i>${i + 1}</i><div class="dvtip"><b>${esc(m.kind || 'Requirement')}${m.period ? ': ' + esc(m.period) : ''}</b>${m.clause ? '<br>Clause ' + esc(m.clause) : ''}${an.length ? '<br>Assets: ' + esc(an.join('; ')) : ''}${tn.length ? '<br>Tasks: ' + esc(tn.join('; ')) : ''}<br><u>Click to open</u></div></div>`; });
  if (V.hl && V.hl.length) { const set = new Set(V.hl); for (const r of await runs()) { if (norm(r.s).split(' ').some(w => set.has(w))) h += `<div class="dvhl" style="left:${r.x * 100}%;top:${r.y * 100}%;width:${r.w * 100}%;height:${r.h * 100}%"></div>`; } }
  if (!V) return; o.innerHTML = h;
  o.querySelectorAll('.dvm').forEach(el => el.onclick = e => { if (V.mode === 'mark') return; e.stopPropagation(); const m = (V.d.marks || []).find(x => x.id === el.dataset.m); if (m) detail(m); });
}
function wireDraw() {
  const o = $('dvO'); let st = null, box = null;
  const pt = e => { const r = o.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) }; };
  o.addEventListener('pointerdown', e => { if (!V || V.mode !== 'mark' || e.button > 0) return; e.preventDefault(); st = pt(e); box = document.createElement('div'); box.className = 'dvm kw draft'; o.appendChild(box); o.setPointerCapture(e.pointerId); });
  o.addEventListener('pointermove', e => { if (!st) return; const p = pt(e); Object.assign(box.style, { left: Math.min(st.x, p.x) * 100 + '%', top: Math.min(st.y, p.y) * 100 + '%', width: Math.abs(p.x - st.x) * 100 + '%', height: Math.abs(p.y - st.y) * 100 + '%' }); });
  const end = async e => { if (!st) return; const p = pt(e), r = { x: Math.min(st.x, p.x), y: Math.min(st.y, p.y), w: Math.abs(p.x - st.x), h: Math.abs(p.y - st.y) }; st = null; box.remove(); box = null;
    if (r.w < 0.02 || r.h < 0.008) return toast('Drag a bigger box around the clause');
    let text = ''; try { text = (await runs()).filter(t => t.x + t.w / 2 >= r.x && t.x + t.w / 2 <= r.x + r.w && t.y + t.h / 2 >= r.y && t.y + t.h / 2 <= r.y + r.h).map(t => t.s).join(' ').replace(/\s+/g, ' ').trim(); } catch (x) {}
    const cl = /^\(?([A-Z]?\d+(?:\.\d+){0,3}[a-z]?)\)?[\s.:]/.exec(text), per = /(\d+|one|two|three|five|ten|fifteen|twenty)\s*\(?\d*\)?\s*(year|yr|month)s?/i.exec(text);
    form({ id: uid(), page: V.page, ...r, kind: /maint|servic|clean|inspect/i.test(text) && !/warrant|guarant/i.test(text) ? 'Maintenance requirement' : 'Warranty requirement', text: text.slice(0, 900), clause: cl ? cl[1] : '', period: per ? per[0].replace(/\s+/g, ' ') : '', assetIds: V.asset ? [V.asset.id] : [], taskIds: [] }, true);
  };
  o.addEventListener('pointerup', end); o.addEventListener('pointercancel', () => { if (box) box.remove(); st = box = null; });
}

/* ---------- side panel: search and the list of marked clauses ---------- */
const QUICK = [['Warranties', 'warranty guarantee'], ['Maintenance', 'maintenance'], ['O&M manuals', 'o&m manual'], ['As-builts', 'as-built'], ['Producer statements', 'producer statement']];
function home() {
  if (!V) return; V.side = 'home'; V.sel = null; const marks = (V.d.marks || []).slice().sort((a, b) => a.page - b.page || a.y - b.y);
  $('dvSide').innerHTML = `${V.asset ? `<div class="dvctx">Marking for: <b>${esc(V.asset.element)}</b><br><span class="muted small">Find the clause, press “Mark a clause”, and drag a box around it.</span></div>` : ''}
    <div class="dvsearch"><input type="search" id="dvQ" placeholder="Find a clause, e.g. roof warranty" value="${esc(V.q || '')}"><button class="go" id="dvGo">Search</button></div>
    <div class="dvquick">${QUICK.map(([l, q]) => `<button data-q="${esc(q)}">${l}</button>`).join('')}</div>
    <label class="dvall"><input type="checkbox" id="dvAll" ${V.all ? 'checked' : ''}> Search all contract and specification documents</label>
    <div id="dvRes"></div>
    <h4>Marked in this document (${marks.length})</h4>
    ${marks.map((m, i) => `<div class="dvrow" data-go="${esc(m.id)}"><i class="${KCLS[m.kind] || 'ko'}">${i + 1}</i><div><b>${esc(m.period || m.kind || 'Requirement')}</b> <span class="muted small">p. ${m.page}${m.clause ? ' · cl. ' + esc(m.clause) : ''}</span><br><span class="small">${esc(names(m.assetIds, fm().assets, 'element').concat(names(m.taskIds, fm().tasks, 'title')).join('; ') || 'Not linked yet')}</span></div></div>`).join('') || `<p class="muted small">${can.edit() ? 'Nothing marked yet. Press “Mark a clause” and drag a box around the words that set the requirement.' : 'Nothing has been marked in this document.'}</p>`}
    ${can.edit() ? `<label class="dvall" style="margin-top:10px"><input type="checkbox" id="dvSrc" ${isSource(V.d) ? 'checked' : ''}> This is a requirement source (included in clause searches)</label>` : ''}`;
  $('dvGo').onclick = runSearch; $('dvQ').onkeydown = e => { if (e.key === 'Enter') runSearch(); };
  $('dvSide').querySelectorAll('[data-q]').forEach(b => b.onclick = () => { $('dvQ').value = b.dataset.q; runSearch(); });
  $('dvAll').onchange = e => { V.all = e.target.checked; if (V.q) runSearch(); };
  if ($('dvSrc')) $('dvSrc').onchange = async e => { try { await S.store.patchItem(S.project.id, 'docs', V.d.id, { source: e.target.checked }); V.d.source = e.target.checked; } catch (x) { toast(x.message); } };
  $('dvSide').querySelectorAll('[data-go]').forEach(r => r.onclick = async () => { const m = (V.d.marks || []).find(x => x.id === r.dataset.go); if (!m) return; if (m.page !== V.page) await show(m.page); detail(m); });
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
  el.querySelectorAll('[data-h]').forEach(r => r.onclick = async () => { const h = R.hits[+r.dataset.h]; if (h.d.id !== V.d.id) { const keep = { q: V.q, res: V.res, all: V.all }; await open(h.d, { page: h.p }); if (!V) return; Object.assign(V, keep); V.hl = h.words; await show(h.p); home(); } else { V.hl = h.words; await show(h.p); drawResults(); } });
  if ($('dvAi')) $('dvAi').onclick = async () => { const btn = $('dvAi'); btn.disabled = true; btn.textContent = 'Asking…';
    try { const t = await aiCall(`Someone is searching a New Zealand construction contract and specification for: "${R.q}". List other words or short phrases those documents might use for the same thing (trade terms, formal contract wording, product names, abbreviations). Return JSON {"terms":["...", up to 12]}.`); let terms = []; try { terms = JSON.parse(String(t).replace(/^```(?:json)?\s*|\s*```$/g, '')).terms || []; } catch (e) {} if (!terms.length) throw new Error('AI gave no suggestions'); await runSearch(terms.slice(0, 12).map(String)); }
    catch (e) { toast(e.message === 'nokey' ? 'Set up the AI helper first (☰ > Gemini)' : e.message, 5000); btn.disabled = false; btn.textContent = '✨ Ask AI for other words'; } };
}

/* ---------- one marked clause: view, edit, save ---------- */
async function snipImg(el, m) { if (!m.snip) { el.style.display = 'none'; return; } try { el.src = await S.store.resolveUrl(m.snip); } catch (e) { el.style.display = 'none'; } }
function detail(m) {
  if (!V) return; V.side = 'detail'; V.sel = m.id; const A = (m.assetIds || []).map(id => fm().assets.find(a => a.id === id)).filter(Boolean), T = (m.taskIds || []).map(id => fm().tasks.find(t => t.id === id)).filter(Boolean);
  $('dvSide').innerHTML = `<button class="dvback" id="dvB">‹ Search and list</button>
    <h3><span class="dvk ${KCLS[m.kind] || 'ko'}">${esc(m.kind || 'Requirement')}</span></h3>
    ${m.period ? `<p class="dvper">${esc(m.period)}</p>` : ''}<p class="muted small">${esc(V.d.title)} · page ${m.page}${m.clause ? ' · clause ' + esc(m.clause) : ''}</p>
    <img class="dvsnip" id="dvSn" alt="The marked clause">${m.text ? `<p class="dvtext">${esc(m.text)}</p>` : ''}${m.note ? `<p><b>Note:</b> ${esc(m.note)}</p>` : ''}
    <h4>Applies to</h4>${A.map(a => `<button class="dvlink" data-a="${esc(a.id)}">▤ ${esc(a.ref || '')} ${esc(a.element)}<small>Open the asset</small></button>`).join('')}${T.map(t => `<button class="dvlink" data-t="${esc(t.id)}">⟳ ${esc(t.title)}<small>Open the maintenance task</small></button>`).join('')}${!A.length && !T.length ? '<p class="muted small">Not linked to an asset or task yet.</p>' : ''}
    ${can.edit() ? '<div class="act"><button id="dvDel" class="warn">Delete</button><button id="dvEd" class="go">Edit</button></div>' : ''}`;
  snipImg($('dvSn'), m); $('dvB').onclick = home;
  $('dvSide').querySelectorAll('[data-a]').forEach(b => b.onclick = () => { const id = b.dataset.a; if (V) V.ret = null; close(); X.openAsset(id); });
  $('dvSide').querySelectorAll('[data-t]').forEach(b => b.onclick = () => { const id = b.dataset.t; if (V) V.ret = null; close(); X.openTask(id); });
  if ($('dvEd')) $('dvEd').onclick = () => form(JSON.parse(JSON.stringify(m)), false);
  if ($('dvDel')) $('dvDel').onclick = async () => { if (!(await confirmBox('Delete this marked clause? The links to its assets and tasks go with it.', 'Delete'))) return; await saveMarks((V.d.marks || []).filter(x => x.id !== m.id)); if (m.snip) { try { S.store.deleteFile(`projects/${S.project.id}/docs/${V.d.id}/snips/${m.id}.jpg`); } catch (e) {} } toast('Deleted'); home(); };
  overlay();
}
const pick = (list, ids, label, key) => `<div class="dvpick" data-pick="${key}"><input type="search" placeholder="Filter ${label}…"><div class="dvlist">${list.map(x => `<label data-s="${esc((x.txt).toLowerCase())}"><input type="checkbox" value="${esc(x.id)}" ${ids.includes(x.id) ? 'checked' : ''}> ${esc(x.txt)}</label>`).join('')}</div></div>`;
function form(m, isNew) {
  V.side = 'form'; setMode('view'); V.sel = m.id;
  const A = fm().assets.slice().sort((a, b) => natural(a.system, b.system) || natural(a.ref || '', b.ref || '')).map(a => ({ id: a.id, txt: `${a.ref || ''} ${a.element}${a.installer ? ' (' + a.installer + ')' : ''}`.trim() }));
  const T = fm().tasks.slice().sort((a, b) => natural(a.system || '', b.system || '') || natural(a.title, b.title)).map(t => ({ id: t.id, txt: t.title }));
  // ticked items float to the top so the current links are visible
  const top = (L, ids) => L.filter(x => ids.includes(x.id)).concat(L.filter(x => !ids.includes(x.id)));
  $('dvSide').innerHTML = `<h3>${isNew ? 'New marked clause' : 'Edit marked clause'}</h3><p class="muted small">Page ${m.page} of ${esc(V.d.title)}</p>
    <label class="f">What does this clause require?<select id="mkK">${KINDS.map(k => `<option ${k === m.kind ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
    <label class="f">Required period or frequency<input id="mkP" value="${esc(m.period || '')}" placeholder="e.g. 10 years from practical completion"></label>
    <label class="f">Clause number<input id="mkC" value="${esc(m.clause || '')}" placeholder="e.g. 11.5"></label>
    <label class="f">What it says (read from the box; correct it if needed)<textarea id="mkX" rows="4">${esc(m.text || '')}</textarea></label>
    <label class="f">Note<input id="mkN" value="${esc(m.note || '')}" placeholder="Optional"></label>
    <h4>Assets this applies to</h4>${pick(top(A, m.assetIds || []), m.assetIds || [], 'assets', 'a')}
    <details ${(m.taskIds || []).length ? 'open' : ''}><summary>Maintenance tasks this applies to${(m.taskIds || []).length ? ' (' + m.taskIds.length + ')' : ''}</summary>${pick(top(T, m.taskIds || []), m.taskIds || [], 'tasks', 't')}</details>
    <div class="act"><button id="mkX2">Cancel</button><button id="mkS" class="go">Save</button></div>`;
  $('dvSide').querySelectorAll('.dvpick').forEach(p => { p.querySelector('input[type=search]').oninput = e => { const q = e.target.value.toLowerCase().trim(); p.querySelectorAll('label').forEach(l => l.style.display = !q || q.split(' ').every(w => l.dataset.s.includes(w)) ? '' : 'none'); }; });
  const ids = k => [...$('dvSide').querySelectorAll(`[data-pick=${k}] input[type=checkbox]:checked`)].map(i => i.value);
  $('mkX2').onclick = () => { const cur = (V.d.marks || []).find(x => x.id === m.id); cur ? detail(cur) : home(); };
  $('mkS').onclick = async () => {
    const o = { ...m, kind: $('mkK').value, period: $('mkP').value.trim(), clause: $('mkC').value.trim(), text: $('mkX').value.trim().slice(0, 900), note: $('mkN').value.trim(), assetIds: ids('a'), taskIds: ids('t'), updated: new Date().toISOString(), by: S.user.email };
    if (!o.assetIds.length && !o.taskIds.length && !(await confirmBox('This clause is not linked to an asset or a task yet. Save it anyway?', 'Save'))) return;
    const b = busy('Saving…');
    try { if (isNew || !o.snip) { try { o.snip = await makeSnip(o); } catch (e) { console.warn('snip', e); } }
      const rest = (V.d.marks || []).filter(x => x.id !== o.id); await saveMarks([...rest, o]); b.done(); toast('Saved'); detail(o); }
    catch (e) { b.done(); toast('Could not save: ' + e.message, 6000); }
  };
  overlay();
}
async function saveMarks(marks) { const patch = { marks }; if (V.d.source == null && marks.length) patch.source = true; await S.store.patchItem(S.project.id, 'docs', V.d.id, patch); V.d = { ...V.d, ...patch }; }
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
