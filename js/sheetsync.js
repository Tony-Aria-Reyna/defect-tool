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
export function start() {
  if (!can.write()) return toast('Your role cannot update defects'); if (!pool().length) return toast('No items from the contractor\'s own register are in this project yet');
  modal(`<h2>Update the contractor's spreadsheet</h2><p>Choose the current copy of the register (the Excel file with Unit, Description, Contractor, Interior/Exterior and Completed). The app compares it with the ${pool().length} register items it holds and shows you every change before anything happens.</p><ul class="note"><li>Rows marked completed in the spreadsheet close the item in the app.</li><li>Items closed in the app are marked completed in the spreadsheet.</li><li>New rows in the spreadsheet are added to the app; new items in the app are added to the spreadsheet.</li></ul><p class="note">You get your own file back with only those cells changed. Everything else in it is left exactly as it was.</p><button class="bigcam" id="ssPick">Choose the spreadsheet</button><input type="file" id="ssF" accept=".xlsx" hidden><div class="act"><button id="ssX">Cancel</button></div>`);
  $('ssX').onclick = closeModal; $('ssPick').onclick = () => $('ssF').click();
  $('ssF').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; closeModal(); const b = busy('Reading the spreadsheet…'); try { const plan = await compare(f); b.done(); review(plan); } catch (x) { b.done(); console.error(x); toast('Could not read that spreadsheet: ' + x.message, 8000); } };
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
export function review(p) {
  const sec = (id, title, list, line, note) => list.length ? `<h3 class="sec"><label><input type="checkbox" id="${id}" checked> ${title} (${list.length})</label></h3>${note ? `<p class="note">${note}</p>` : ''}<div class="sslist">${list.slice(0, 200).map(line).join('')}${list.length > 200 ? `<div>… and ${list.length - 200} more</div>` : ''}</div>` : '';
  const canAdd = can.edit() || true;
  modal(`<h2>Check the changes</h2><p>${p.rows.length} rows in the spreadsheet; ${p.matched} match items in the app.</p>
    ${sec('ssA', 'Close in the app: marked completed in the spreadsheet', p.closeInApp, r => `<div><b>${esc(r.d.id)}</b> ${esc(r.area)} · ${esc(r.desc)}</div>`)}
    ${sec('ssB', `Mark "${esc(p.yes)}" in the spreadsheet: closed in the app`, p.markInSheet, r => `<div>Row ${r.row} · ${esc(r.area)} · ${esc(r.desc)} <b>${esc(r.d.id)}</b></div>`)}
    ${sec('ssC', 'Add to the app: new rows in the spreadsheet', p.newInSheet, r => `<div>Row ${r.row} · ${esc(r.area)} · ${esc(r.desc)}</div>`, 'Rows that are not completed and have no matching item in the app. Completed rows that are not in the app are left alone.')}
    ${sec('ssD', 'Add to the spreadsheet: items raised in the app', p.newInApp, d => `<div><b>${esc(d.id)}</b> ${esc(listed(d))} · ${esc(d.desc)}${d.status === 'Closed' ? ' (closed)' : ''}</div>`, 'Added as new rows at the bottom of the sheet.')}
    ${p.closeInApp.length + p.markInSheet.length + p.newInSheet.length + p.newInApp.length ? '' : '<p class="note"><b>Nothing to change.</b> The spreadsheet and the app agree.</p>'}
    <p class="note" id="ssSt"></p><div class="act"><button id="ssX2">Cancel</button><button class="go" id="ssGo">Apply and download the updated spreadsheet</button></div>`, true);
  $('ssX2').onclick = closeModal;
  $('ssGo').onclick = async () => { $('ssGo').disabled = true; const on = id => $(id) && $(id).checked, t = new Date().toISOString(), day = todayISO(), pr = S.project; let nA = 0, nC = 0;
    try {
      if (on('ssA')) for (const r of p.closeInApp) { $('ssSt').textContent = `Closing ${++nA} of ${p.closeInApp.length}…`; await S.store.updateDefect(pr.id, r.d.id, { status: 'Closed' }, [{ t, who: S.user.name, txt: `Marked "${r.doneRaw}" in the contractor's spreadsheet (${p.file.name}, row ${r.row}). Status ${r.d.status} → Closed.` }]); r.d.status = 'Closed'; }
      if (on('ssC') && p.newInSheet.length) { const P = pool(), like = P[0], pre = like.id.split('-')[0], conv = P.some(d => /old number/i.test((d.ext || {})['Listed under'] || '')), map = pr.renumberMap || {}; let mx = S.defects.reduce((a, d) => d.id.startsWith(pre + '-') ? Math.max(a, parseInt(d.id.slice(pre.length + 1), 10) || 0) : a, 0);
        for (const r of p.newInSheet) { $('ssSt').textContent = `Adding ${++nC} of ${p.newInSheet.length}…`; const isU = /^\d+$/.test(r.raw), unit = isU ? String(conv && map[r.raw] ? map[r.raw] : r.raw) : '';
          const d = { id: pre + '-' + String(++mx).padStart(3, '0'), extRef: 'PSD row ' + r.row, source: like.source, dateRaised: day, title: r.desc.length > 70 ? r.desc.slice(0, 67) + '…' : r.desc, desc: r.desc, action: '', element: '', unit, room: isU ? '' : r.raw, block: '', level: '', type: pr.types[0], severity: sevDefault(pr), trade: pr.trades[0], responsible: like.responsible, subcontractor: r.sub, targetDate: '', status: 'Open', plan: '', x: null, y: null, photos: [], needsPin: true, ext: { 'Listed under': r.area + (isU && conv && map[r.raw] ? ' (old number; now Unit ' + unit + ')' : ''), 'Interior / exterior': r.ie, 'Subcontractor': r.sub, 'Register row': String(r.row) }, history: [{ t, who: S.user.name, txt: `Added from the contractor's spreadsheet (${p.file.name}, row ${r.row}).` }], created: t, updated: t, createdBy: S.user.email, updatedBy: S.user.email };
          const pp = isU && X.pinPatch ? X.pinPatch(d, null, null, null, '', '') : null; if (pp) { Object.assign(d, pp); d.needsPin = false; d.room = ''; }
          await S.store.createDefect(pr.id, JSON.parse(JSON.stringify(d))); } }
      $('ssSt').textContent = 'Writing the spreadsheet…';
      const zip = await JSZip.loadAsync(p.buf), path = zip.file('xl/worksheets/sheet1.xml') ? 'xl/worksheets/sheet1.xml' : Object.keys(zip.files).find(k => /^xl\/worksheets\/[^/]+\.xml$/.test(k)); let xml = await zip.file(path).async('string'), wrote = 0, added = 0;
      const setCell = (row, col, text) => { const ref = col + row, re = new RegExp('<c r="' + ref + '"([^>]*?)(/>|>[\\s\\S]*?</c>)'), m = re.exec(xml), mk = attrs => `<c r="${ref}"${(/ s="\d+"/.exec(attrs || '') || [''])[0]} t="inlineStr"><is><t>${xesc(text)}</t></is></c>`; if (m) { xml = xml.replace(re, mk(m[1])); return true; } const rr = new RegExp('(<row r="' + row + '"[^>]*>)([\\s\\S]*?)(</row>)'), m2 = rr.exec(xml); if (!m2) return false; xml = xml.replace(rr, (a, o, body, c) => o + body + mk('') + c); return true; };
      if (on('ssB')) p.markInSheet.forEach(r => { if (setCell(r.row, 'E', p.yes)) wrote++; });
      if (on('ssD') && p.newInApp.length) { const tpl = p.rows.find(r => r.d) || p.rows[0], sty = c => (new RegExp('<c r="' + c + tpl.row + '"[^>]*? s="(\\d+)"').exec(xml) || [])[1], sA = sty('A'), sB = sty('B'), sC = sty('C'), sD = sty('D'), sE = sty('E'), s = v => v ? ` s="${v}"` : ''; let last = 0; xml.replace(/<row r="(\d+)"/g, (a, n) => { last = Math.max(last, +n); return a; });
        const str = (ref, st, v) => `<c r="${ref}"${s(st)} t="inlineStr"><is><t>${xesc(v)}</t></is></c>`; let out = '';
        p.newInApp.forEach(d => { const n = ++last, a = listed(d).replace(/^Unit\s+/i, ''); out += `<row r="${n}" spans="1:5">${/^\d+$/.test(a) ? `<c r="A${n}"${s(sA)}><v>${a}</v></c>` : str('A' + n, sA, a)}${str('B' + n, sB, d.desc || d.title || '')}${str('C' + n, sC, d.subcontractor || '')}${str('D' + n, sD, (d.ext || {})['Interior / exterior'] || '')}${d.status === 'Closed' ? str('E' + n, sE, p.yes) : `<c r="E${n}"${s(sE)}/>`}</row>`; added++; });
        xml = xml.replace('</sheetData>', out + '</sheetData>').replace(/<dimension ref="([A-Z]+\d+):([A-Z]+)\d+"\/>/, (a, x, c) => `<dimension ref="${x}:${c}${last}"/>`); }
      zip.file(path, xml); const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', compression: 'DEFLATE' });
      const name = p.file.name.replace(/\.xlsx$/i, '').replace(/ \(updated [\d-]+\)$/, '') + ' (updated ' + day + ').xlsx'; if (wrote || added) download(blob, name);
      closeModal(); if (X.reloadProject) await X.reloadProject(); X.render && X.render();
      modal(`<h2>Done</h2><p>In the app: <b>${nA}</b> closed, <b>${nC}</b> added.<br>In the spreadsheet: <b>${wrote}</b> marked "${esc(p.yes)}", <b>${added}</b> rows added.</p>${wrote || added ? `<p class="note">The updated file has been downloaded as <b>${esc(name)}</b>. Use it as the register from now on, so the next update starts from it.</p>` : '<p class="note">The spreadsheet did not need changing, so no file was downloaded.</p>'}<div class="act"><button class="go" id="ssOk">Done</button></div>`); $('ssOk').onclick = closeModal;
    } catch (e) { console.error(e); $('ssSt').textContent = ''; toast('Stopped: ' + e.message, 8000); $('ssGo').disabled = false; } };
}
