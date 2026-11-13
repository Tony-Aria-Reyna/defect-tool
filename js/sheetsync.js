// Two-way update between the app and the contractor's own Excel register (Unit | Description | Contractor | Interior/Exterior? | Completed).
// The person picks their current spreadsheet. Rows completed in the sheet close the matching items in the app; items closed in the app are
// marked completed in the sheet; rows only in the sheet are added to the app; items only in the app are added to the sheet. The sheet that
// comes back is their own file with only those cells changed (formatting, logo, filters and every other row are untouched).
import { S, can, sevDefault, selfClose } from './state.js';
import { $, esc, toast, modal, closeModal, busy, loadScript, download, todayISO } from './util.js';
let X = {}; export function init(ctx) { X = ctx; }
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const isDone = v => /^(y|yes|completed?|done|✓|✔|x)$/i.test(String(v || '').trim());
const listed = d => String((d.ext && d.ext['Listed under']) || (d.unit ? 'Unit ' + d.unit : d.room || '')).replace(/\s*\(old number.*$/i, '').trim();
const areaOf = a => /^\d+$/.test(String(a).trim()) ? 'Unit ' + String(a).trim() : String(a).trim();
const xesc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const pool = () => S.defects.filter(selfClose);
/* ---- a spreadsheet linked on this computer (Chrome or Edge): the app reads it and writes back into it in place ---- */
const canLink = () => 'showOpenFilePicker' in window;
const idb = () => new Promise((res, rej) => { const q = indexedDB.open('resero-links', 1); q.onupgradeneeded = () => q.result.createObjectStore('h'); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
const hGet = async k => { const db = await idb(); return new Promise((res, rej) => { const q = db.transaction('h').objectStore('h').get(k); q.onsuccess = () => res(q.result || null); q.onerror = () => rej(q.error); }); };
const hSet = async (k, v) => { const db = await idb(); return new Promise((res, rej) => { const tx = db.transaction('h', 'readwrite'); v == null ? tx.objectStore('h').delete(k) : tx.objectStore('h').put(v, k); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }); };
const lkey = () => 'sheet:' + S.project.id, akey = () => 'resero-sync-auto:' + S.project.id, tkey = () => 'resero-sync-last:' + S.project.id;
const setLast = r => { try { localStorage.setItem(tkey(), JSON.stringify({ t: new Date().toISOString(), ...r })); } catch (e) {} };
const getLast = () => { try { return JSON.parse(localStorage.getItem(tkey()) || 'null'); } catch (e) { return null; } };
export async function linked() { try { return canLink() ? await hGet(lkey()) : null; } catch (e) { return null; } }
// Read the linked file. ask=true may show the browser's permission prompt (needs a click); ask=false only works if permission is already held.
async function openLinked(ask) { const h = await linked(); if (!h) return null; let ok = (await h.queryPermission({ mode: 'readwrite' })) === 'granted'; if (!ok && ask) ok = (await h.requestPermission({ mode: 'readwrite' })) === 'granted'; if (!ok) return { h, denied: true }; const plan = await compare(await h.getFile()); plan.handle = h; return plan; }
let autoTimer = null, autoBusy = false;
// Automatic mode does only the two changes that cannot create duplicates: completed rows close items here, closed items are ticked off in the sheet.
// New rows and new items wait for a manual update, where you see them first.
async function autoRun() { if (autoBusy || !navigator.onLine || !S.project || localStorage.getItem(akey()) !== '1' || !pool().length) return; autoBusy = true;
  try { const p = await openLinked(false); if (!p) return; if (p.denied) { toast('Spreadsheet link needs reconnecting: open the menu and choose "Update the contractor\'s spreadsheet".', 8000); return; }
    if (!p.closeInApp.length && !p.markInSheet.length) { setLast({ nA: 0, wrote: 0, auto: true, pending: p.newInSheet.length + p.newInApp.length }); return; }
    const r = await applyPlan(p, { A: true, B: true, C: false, D: false }); setLast({ ...r, auto: true, pending: p.newInSheet.length + p.newInApp.length }); if (r.nA && X.render) X.render();
    toast(`Register updated automatically: ${r.nA} closed here, ${r.wrote} ticked off in the spreadsheet${p.newInSheet.length + p.newInApp.length ? '. ' + (p.newInSheet.length + p.newInApp.length) + ' new items are waiting for a manual update' : ''}`, 9000);
  } catch (e) { console.warn('auto sync', e); if (/NoModificationAllowed|locked|InvalidState/i.test(e.name + e.message)) toast('Could not update the spreadsheet: it is open in Excel on this computer.', 7000); } finally { autoBusy = false; } }
export function autoStart() { if (autoTimer) { clearInterval(autoTimer); autoTimer = null; } if (!canLink() || !S.project || localStorage.getItem(akey()) !== '1') return; setTimeout(autoRun, 8000); autoTimer = setInterval(autoRun, 5 * 60 * 1000); }

export async function start() {
  if (!can.write()) return toast('Your role cannot update defects'); if (!pool().length) return toast('No items from the contractor\'s own register are in this project yet');
  const h = await linked(), last = getLast(), auto = localStorage.getItem(akey()) === '1';
  modal(`<h2>Update the contractor's spreadsheet</h2><p>The app compares the register (the Excel file with Unit, Description, Contractor, Interior/Exterior and Completed) with the ${pool().length} register items it holds, and shows you every change before anything happens.</p>
    ${h ? `<div class="rdgem"><div><b>🔗 Linked on this computer: ${esc(h.name)}</b><span class="note">${last ? 'Last updated ' + new Date(last.t).toLocaleString('en-NZ', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) + (last.auto ? ' (automatic)' : '') + (last.pending ? '. ' + last.pending + ' new items waiting for you to check' : '') : 'Not updated yet'}</span></div></div>
      <button class="bigcam" id="ssNow">Update now</button>
      <label class="chk" style="margin-top:10px"><input type="checkbox" id="ssAuto" ${auto ? 'checked' : ''}> Keep it up to date automatically while the app is open on this computer (every 5 minutes)</label>
      <p class="note">Automatic updates tick off completed work in both directions. New rows and new items are only added when you press Update now, so you see them first.</p>
      <div class="rdmore"><a href="#" id="ssUnlink">Unlink this file</a> · <a href="#" id="ssPick">use a different copy just this once</a></div>`
    : `${canLink() ? `<button class="bigcam" id="ssLink">🔗 Link the register on this computer</button><p class="note">Choose the Excel file in your OneDrive folder once. After that the app reads it and writes back into it directly, and OneDrive shares the changes. Works in Chrome or Edge on a computer.</p><div class="rdmore"><a href="#" id="ssPick">or choose a copy just this once (you get an updated file to download)</a></div>` : `<button class="bigcam" id="ssPick">Choose the spreadsheet</button><p class="note">You get your own file back with only the changed cells altered. On a computer in Chrome or Edge the file can be linked so this happens in place.</p>`}`}
    <input type="file" id="ssF" accept=".xlsx" hidden><div class="act"><button id="ssX">Close</button></div>`);
  $('ssX').onclick = closeModal; if ($('ssPick')) $('ssPick').onclick = e => { e.preventDefault(); $('ssF').click(); };
  const run = async get => { closeModal(); const b = busy('Reading the spreadsheet…'); try { const plan = await get(); b.done(); if (!plan) return; if (plan.denied) return toast('The browser was not given permission to open the file. Press Update now again and choose Allow.', 8000); review(plan); } catch (x) { b.done(); console.error(x); toast('Could not read that spreadsheet: ' + x.message, 8000); } };
  $('ssF').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) run(() => compare(f)); };
  if ($('ssLink')) $('ssLink').onclick = async () => { let hs; try { hs = await window.showOpenFilePicker({ types: [{ description: 'Excel workbook', accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] } }] }); } catch (e) { return; } const nh = hs[0]; if ((await nh.requestPermission({ mode: 'readwrite' })) !== 'granted') return toast('Permission to edit the file was not given, so it is not linked.', 7000); await hSet(lkey(), nh); toast('Linked: ' + nh.name, 4000); run(() => openLinked(true)); };
  if ($('ssNow')) $('ssNow').onclick = () => run(() => openLinked(true));
  if ($('ssUnlink')) $('ssUnlink').onclick = async e => { e.preventDefault(); await hSet(lkey(), null); localStorage.removeItem(akey()); autoStart(); toast('Unlinked. The file itself is not changed.'); start(); };
  if ($('ssAuto')) $('ssAuto').onchange = () => { if ($('ssAuto').checked) localStorage.setItem(akey(), '1'); else localStorage.removeItem(akey()); autoStart(); toast($('ssAuto').checked ? 'Automatic updates are on for this computer' : 'Automatic updates are off'); };
}
export async function compare(file) {
  if (!window.XLSX) await loadScript('lib/xlsx.bundle.js'); if (!window.JSZip) await loadScript('lib/jszip.min.js');
  const buf = await file.arrayBuffer(), wb = XLSX.read(buf, { type: 'array' }), ws = wb.Sheets[wb.SheetNames[0]], rng = XLSX.utils.decode_range(ws['!ref']);
  const cell = (r, c) => { const v = ws[XLSX.utils.encode_cell({ r, c })]; return v ? String(v.w != null ? v.w : v.v).trim() : ''; };
  const rows = []; for (let r = rng.s.r; r <= rng.e.r; r++) { const a = cell(r, 0), bb = cell(r, 1); if (!a || !bb || /^(unit|project:?|job no\.?|access:?|date:?)$/i.test(a) || /pre-settlement inspection/i.test(bb)) continue; rows.push({ row: r + 1, area: areaOf(a), raw: a, desc: bb, sub: cell(r, 2), ie: cell(r, 3), done: isDone(cell(r, 4)), doneRaw: cell(r, 4) }); }
  if (rows.length < 5) throw new Error('no register rows found (expected Unit and Description in the first two columns)');
  const P = pool(), key = (area, desc) => norm(area) + '|' + norm(desc), by = {}; P.forEach(d => { (by[key(listed(d), d.desc)] = by[key(listed(d), d.desc)] || []).push(d); });
  const used = new Set(), pairs = [];
  // same row number first, then the same unit and wording in order
  rows.forEach(r => { const q = by[key(r.area, r.desc)] || []; const d = q.find(x => !used.has(x.id) && String((x.ext || {})['Register row'] || '') === String(r.row)); if (d) { used.add(d.id); r.d = d; } });
  rows.forEach(r => { if (r.d) return; const q = by[key(r.area, r.desc)] || []; const d = q.find(x => !used.has(x.id)); if (d) { used.add(d.id); r.d = d; } });
  const closeInApp = rows.filter(r => r.d && r.done && r.d.status !== 'Closed'), markInSheet = rows.filter(r => r.d && !r.done && r.d.status === 'Closed'), newInSheet = rows.filter(r => !r.d && !r.done), newInApp = P.filter(d => !used.has(d.id));
  const words = {}; rows.forEach(r => { if (r.done) words[r.doneRaw] = (words[r.doneRaw] || 0) + 1; }); const yes = (Object.entries(words).sort((a, b) => b[1] - a[1])[0] || ['Yes'])[0];
  return { file, buf, rows, closeInApp, markInSheet, newInSheet, newInApp, yes, matched: rows.filter(r => r.d).length };
}
// Carry out a comparison. on = which of the four groups to apply; st = progress text. Writes back into the linked file when there is one, else downloads.
export async function applyPlan(p, on, st = () => {}) {
  const t = new Date().toISOString(), day = todayISO(), pr = S.project; let nA = 0, nC = 0;

      if (on.A) for (const r of p.closeInApp) { st(`Closing ${++nA} of ${p.closeInApp.length}…`); await S.store.updateDefect(pr.id, r.d.id, { status: 'Closed' }, [{ t, who: S.user.name, txt: `Marked "${r.doneRaw}" in the contractor's spreadsheet (${p.file.name}, row ${r.row}). Status ${r.d.status} → Closed.` }]); r.d.status = 'Closed'; }
      if (on.C && p.newInSheet.length) { const P = pool(), like = P[0], pre = like.id.split('-')[0], conv = P.some(d => /old number/i.test((d.ext || {})['Listed under'] || '')), map = pr.renumberMap || {}; let mx = S.defects.reduce((a, d) => d.id.startsWith(pre + '-') ? Math.max(a, parseInt(d.id.slice(pre.length + 1), 10) || 0) : a, 0);
        for (const r of p.newInSheet) { st(`Adding ${++nC} of ${p.newInSheet.length}…`); const isU = /^\d+$/.test(r.raw), unit = isU ? String(conv && map[r.raw] ? map[r.raw] : r.raw) : '';
          const d = { id: pre + '-' + String(++mx).padStart(3, '0'), extRef: 'PSD row ' + r.row, source: like.source, dateRaised: day, title: r.desc.length > 70 ? r.desc.slice(0, 67) + '…' : r.desc, desc: r.desc, action: '', element: '', unit, room: isU ? '' : r.raw, block: '', level: '', type: pr.types[0], severity: sevDefault(pr), trade: pr.trades[0], responsible: like.responsible, subcontractor: r.sub, targetDate: '', status: 'Open', plan: '', x: null, y: null, photos: [], needsPin: true, ext: { 'Listed under': r.area + (isU && conv && map[r.raw] ? ' (old number; now Unit ' + unit + ')' : ''), 'Interior / exterior': r.ie, 'Subcontractor': r.sub, 'Register row': String(r.row) }, history: [{ t, who: S.user.name, txt: `Added from the contractor's spreadsheet (${p.file.name}, row ${r.row}).` }], created: t, updated: t, createdBy: S.user.email, updatedBy: S.user.email };
          const pp = isU && X.pinPatch ? X.pinPatch(d, null, null, null, '', '') : null; if (pp) { Object.assign(d, pp); d.needsPin = false; d.room = ''; }
          await S.store.createDefect(pr.id, JSON.parse(JSON.stringify(d))); } }
      if (X.addSubs) { try { await X.addSubs(p.rows.map(r => r.sub)); } catch (e) { console.warn(e); } }
      st('Writing the spreadsheet…');
      const zip = await JSZip.loadAsync(p.buf), path = zip.file('xl/worksheets/sheet1.xml') ? 'xl/worksheets/sheet1.xml' : Object.keys(zip.files).find(k => /^xl\/worksheets\/[^/]+\.xml$/.test(k)); let xml = await zip.file(path).async('string'), wrote = 0, added = 0;
      const setCell = (row, col, text) => { const ref = col + row, re = new RegExp('<c r="' + ref + '"([^>]*?)(/>|>[\\s\\S]*?</c>)'), m = re.exec(xml), mk = attrs => `<c r="${ref}"${(/ s="\d+"/.exec(attrs || '') || [''])[0]} t="inlineStr"><is><t>${xesc(text)}</t></is></c>`; if (m) { xml = xml.replace(re, mk(m[1])); return true; } const rr = new RegExp('(<row r="' + row + '"[^>]*>)([\\s\\S]*?)(</row>)'), m2 = rr.exec(xml); if (!m2) return false; xml = xml.replace(rr, (a, o, body, c) => o + body + mk('') + c); return true; };
      if (on.B) p.markInSheet.forEach(r => { if (setCell(r.row, 'E', p.yes)) wrote++; });
      if (on.D && p.newInApp.length) { const tpl = p.rows.find(r => r.d) || p.rows[0], sty = c => (new RegExp('<c r="' + c + tpl.row + '"[^>]*? s="(\\d+)"').exec(xml) || [])[1], sA = sty('A'), sB = sty('B'), sC = sty('C'), sD = sty('D'), sE = sty('E'), s = v => v ? ` s="${v}"` : ''; let last = 0; xml.replace(/<row r="(\d+)"/g, (a, n) => { last = Math.max(last, +n); return a; });
        const str = (ref, st, v) => `<c r="${ref}"${s(st)} t="inlineStr"><is><t>${xesc(v)}</t></is></c>`; let out = '';
        p.newInApp.forEach(d => { const n = ++last, a = listed(d).replace(/^Unit\s+/i, ''); out += `<row r="${n}" spans="1:5">${/^\d+$/.test(a) ? `<c r="A${n}"${s(sA)}><v>${a}</v></c>` : str('A' + n, sA, a)}${str('B' + n, sB, d.desc || d.title || '')}${str('C' + n, sC, d.subcontractor || '')}${str('D' + n, sD, (d.ext || {})['Interior / exterior'] || '')}${d.status === 'Closed' ? str('E' + n, sE, p.yes) : `<c r="E${n}"${s(sE)}/>`}</row>`; added++; });
        xml = xml.replace('</sheetData>', out + '</sheetData>').replace(/<dimension ref="([A-Z]+\d+):([A-Z]+)\d+"\/>/, (a, x, c) => `<dimension ref="${x}:${c}${last}"/>`); }
      zip.file(path, xml); const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', compression: 'DEFLATE' });
      const name = p.file.name.replace(/\.xlsx$/i, '').replace(/ \(updated [\d-]+\)$/, '') + ' (updated ' + day + ').xlsx'; if (wrote || added) { if (p.handle) { const w = await p.handle.createWritable(); await w.write(blob); await w.close(); } else download(blob, name); }
  return { nA, nC, wrote, added, name };
}
export function review(p) {
  const sec = (id, title, list, line, note) => list.length ? `<h3 class="sec"><label><input type="checkbox" id="${id}" checked> ${title} (${list.length})</label></h3>${note ? `<p class="note">${note}</p>` : ''}<div class="sslist">${list.slice(0, 200).map(line).join('')}${list.length > 200 ? `<div>… and ${list.length - 200} more</div>` : ''}</div>` : '';
  const canAdd = can.edit() || true;
  modal(`<h2>Check the changes</h2><p>${p.rows.length} rows in the spreadsheet; ${p.matched} match items in the app.</p>
    ${sec('ssA', 'Close in the app: marked completed in the spreadsheet', p.closeInApp, r => `<div><b>${esc(r.d.id)}</b> ${esc(r.area)} · ${esc(r.desc)}</div>`)}
    ${sec('ssB', `Mark "${esc(p.yes)}" in the spreadsheet: closed in the app`, p.markInSheet, r => `<div>Row ${r.row} · ${esc(r.area)} · ${esc(r.desc)} <b>${esc(r.d.id)}</b></div>`)}
    ${sec('ssC', 'Add to the app: new rows in the spreadsheet', p.newInSheet, r => `<div>Row ${r.row} · ${esc(r.area)} · ${esc(r.desc)}</div>`, 'Rows that are not completed and have no matching item in the app. Completed rows that are not in the app are left alone.')}
    ${sec('ssD', 'Add to the spreadsheet: items raised in the app', p.newInApp, d => `<div><b>${esc(d.id)}</b> ${esc(listed(d))} · ${esc(d.desc)}${d.status === 'Closed' ? ' (closed)' : ''}</div>`, 'Added as new rows at the bottom of the sheet.')}
    ${p.closeInApp.length + p.markInSheet.length + p.newInSheet.length + p.newInApp.length ? '' : '<p class="note"><b>Nothing to change.</b> The spreadsheet and the app agree.</p>'}
    <p class="note" id="ssSt"></p><div class="act"><button id="ssX2">Cancel</button><button class="go" id="ssGo">${p.handle ? 'Apply and update the linked spreadsheet' : 'Apply and download the updated spreadsheet'}</button></div>`, true);
  $('ssX2').onclick = closeModal;
  $('ssGo').onclick = async () => { $('ssGo').disabled = true; const ck = id => !!($(id) && $(id).checked);
    try { const r = await applyPlan(p, { A: ck('ssA'), B: ck('ssB'), C: ck('ssC'), D: ck('ssD') }, m => { if ($('ssSt')) $('ssSt').textContent = m; });
      closeModal(); if (X.reloadProject) await X.reloadProject(); X.render && X.render(); setLast(r);
      modal(`<h2>Done</h2><p>In the app: <b>${r.nA}</b> closed, <b>${r.nC}</b> added.<br>In the spreadsheet: <b>${r.wrote}</b> marked "${esc(p.yes)}", <b>${r.added}</b> rows added.</p>${r.wrote || r.added ? (p.handle ? `<p class="note">The linked file <b>${esc(p.file.name)}</b> has been updated in place. OneDrive will carry the changes to everyone it is shared with.</p>` : `<p class="note">The updated file has been downloaded as <b>${esc(r.name)}</b>. Use it as the register from now on, so the next update starts from it.</p>`) : '<p class="note">The spreadsheet did not need changing.</p>'}<div class="act"><button class="go" id="ssOk">Done</button></div>`); $('ssOk').onclick = closeModal;
    } catch (e) { console.error(e); if ($('ssSt')) $('ssSt').textContent = ''; toast('Stopped: ' + (/NoModificationAllowed|locked|InvalidState/i.test(e.name + e.message) ? 'the spreadsheet is open in Excel on this computer. Close it there and try again.' : e.message), 9000); if ($('ssGo')) $('ssGo').disabled = false; } };
}
