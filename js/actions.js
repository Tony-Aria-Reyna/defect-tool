// Actions: practical completion conditions, Council CCC RFI items and other close-out actions, kept in the app so the
// PC status report can show them. Also the two "bring the pack registers in" imports (Action Register, Warranty Requirements Register).
import { S, can } from './state.js';
import { $, esc, toast, modal, closeModal, busy, confirmBox, uid, todayISO, nzDate, natural, loadScript } from './util.js';

export const STATUS = ['Open', 'Evidence held', 'Submitted to Council', 'Closed'], PRI = ['High', 'Medium', 'Low'];
const acts = () => (S.fm && S.fm.actions) || [];
const F = { q: '', st: 'notclosed', cat: '' };
const iso = v => { if (!v) return ''; if (v instanceof Date) return new Date(v.getTime() - v.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); const s = String(v).trim(); let m = /^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/.exec(s); if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); return m ? m[0] : ''; };
const stCls = s => s === 'Closed' ? 'st-ok' : s === 'Open' ? 'st-bad' : 'st-warn';
export const isPcCondition = a => /^PC/i.test(a.ref || '') || /^PC /i.test(a.category || '');
export const isCouncil = a => /^CCC/i.test(a.ref || '');

export function view() {
  const A = acts().slice().sort((a, b) => natural(a.ref || '', b.ref || '')), q = F.q.toLowerCase(), cats = [...new Set(A.map(a => a.category).filter(Boolean))].sort();
  const L = A.filter(a => (F.st === 'all' || (F.st === 'notclosed' ? a.status !== 'Closed' : a.status === F.st)) && (!F.cat || a.category === F.cat) && (!q || [a.ref, a.category, a.action, a.detail, a.responsible, a.notes].join(' ').toLowerCase().includes(q)));
  const n = s => A.filter(a => a.status === s).length; let last = '';
  $('fmView').innerHTML = `<div class="fbar"><h2>Actions</h2><input type="search" id="acQ" placeholder="Search actions…" value="${esc(F.q)}"><select id="acS"><option value="notclosed">Not closed</option><option value="all" ${F.st === 'all' ? 'selected' : ''}>All</option>${STATUS.map(s => `<option ${F.st === s ? 'selected' : ''}>${s}</option>`).join('')}</select><select id="acC"><option value="">All categories</option>${cats.map(c => `<option ${F.cat === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>${can.edit() ? '<button class="btn2 go" id="acNew">+ New action</button><button class="btn2" id="acImp">⬆ Bring in the Action Register (Excel)</button><button class="btn2" id="acReg">⬆ Update assets from the Warranty Requirements Register (Excel)</button>' : ''}<input type="file" id="acFile" accept=".xlsx" hidden><input type="file" id="acFile2" accept=".xlsx" hidden></div>
  <p class="muted small">${L.length} of ${A.length} actions · ${n('Open')} open · ${n('Evidence held')} evidence held · ${n('Submitted to Council')} submitted to Council · ${n('Closed')} closed. Practical completion conditions and Council items appear in the PC status report (Export).</p>
  ${L.length ? `<table class="ftable"><tr><th>Ref</th><th>Action required</th><th class="hm">Responsible</th><th>Priority</th><th>Due</th><th>Status</th></tr>${L.map(a => { const g = (a.category || '') !== last ? `<tr class="grp"><td colspan="6">${esc(a.category || 'Other')}</td></tr>` : ''; last = a.category || '';
    return g + `<tr class="click" data-id="${esc(a.id)}"><td><b>${esc(a.ref || '')}</b></td><td>${esc(a.action || '')}${a.detail ? '<br><span class="muted small">' + esc(String(a.detail).slice(0, 220)) + '</span>' : ''}</td><td class="hm">${esc(a.responsible || '')}</td><td>${esc(a.priority || '')}</td><td>${a.due ? esc(nzDate(a.due)) : ''}</td><td><span class="st ${stCls(a.status)}">${esc(a.status || '')}</span></td></tr>`; }).join('')}</table>`
    : `<div class="empty2">${A.length ? 'No actions match.' : 'No actions yet. Press "Bring in the Action Register" and choose the Action Register workbook from the handover pack, or add one by hand.'}</div>`}`;
  L.sort((a, b) => natural(a.category || '', b.category || '') || natural(a.ref || '', b.ref || ''));
  $('acQ').oninput = e => { F.q = e.target.value; view(); $('acQ').focus(); $('acQ').setSelectionRange(F.q.length, F.q.length); };
  $('acS').value = F.st; $('acS').onchange = e => { F.st = e.target.value; view(); }; $('acC').onchange = e => { F.cat = e.target.value; view(); };
  document.querySelectorAll('#fmView tr[data-id]').forEach(r => r.onclick = () => edit(acts().find(a => a.id === r.dataset.id)));
  if ($('acNew')) { $('acNew').onclick = () => edit(null); $('acImp').onclick = () => $('acFile').click(); $('acReg').onclick = () => $('acFile2').click();
    $('acFile').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) importActions(f); }; $('acFile2').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) importRegister(f); }; }
}
function edit(a) {
  const isNew = !a, ro = !can.edit(); a = a ? { ...a } : { id: uid(), ref: '', category: '', action: '', detail: '', responsible: '', priority: 'Medium', status: 'Open', due: '', closed: '', notes: '' };
  const f = (l, id, v, full) => `<label class="f${full ? ' full' : ''}">${l}<input id="${id}" value="${esc(v || '')}" ${ro ? 'disabled' : ''}></label>`, ta = (l, id, v) => `<label class="f full">${l}<textarea id="${id}" rows="3" ${ro ? 'disabled' : ''}>${esc(v || '')}</textarea></label>`, se = (l, id, L, v) => `<label class="f">${l}<select id="${id}" ${ro ? 'disabled' : ''}>${L.map(x => `<option ${x === v ? 'selected' : ''}>${x}</option>`).join('')}</select></label>`;
  modal(`<h2>${isNew ? 'New action' : esc(a.ref || 'Action')}</h2><div class="grid">${f('Ref', 'aeR', a.ref)}${f('Category', 'aeC', a.category)}${ta('Action required', 'aeA', a.action)}${ta('Detail (Council RFI comment, clause, what is wrong)', 'aeD', a.detail)}${f('Responsible', 'aeW', a.responsible)}${se('Priority', 'aeP', PRI, a.priority)}${se('Status', 'aeS', STATUS, a.status)}<label class="f">Due date<input type="date" id="aeDue" value="${esc(a.due || '')}" ${ro ? 'disabled' : ''}></label>${ta('Notes', 'aeN', a.notes)}</div>
    <div class="act">${!isNew && !ro ? '<button id="aeDel" class="warn">Delete</button>' : ''}<button id="aeX">${ro ? 'Close' : 'Cancel'}</button>${ro ? '' : '<button id="aeOk" class="go">Save</button>'}</div>`, true);
  $('aeX').onclick = closeModal;
  if ($('aeOk')) $('aeOk').onclick = async () => { const v = id => $(id).value.trim(), o = { ...a, ref: v('aeR'), category: v('aeC'), action: v('aeA'), detail: v('aeD'), responsible: v('aeW'), priority: v('aeP'), status: v('aeS'), due: v('aeDue'), notes: v('aeN'), updated: new Date().toISOString(), updatedBy: S.user.email };
    if (!o.action) return toast('Say what the action is'); if (!o.ref) { let k = 0; acts().forEach(x => { const m = /^AI-(\d+)$/.exec(x.ref || ''); if (m) k = Math.max(k, +m[1]); }); o.ref = 'AI-' + String(k + 1).padStart(2, '0'); }
    if (o.status === 'Closed' && !o.closed) o.closed = todayISO(); if (o.status !== 'Closed') o.closed = '';
    try { await S.store.saveItem(S.project.id, 'actions', o); closeModal(); toast(o.ref + ' saved'); } catch (e) { toast('Could not save: ' + e.message, 6000); } };
  if ($('aeDel')) $('aeDel').onclick = async () => { if (!(await confirmBox(`Delete ${a.ref}? This cannot be undone.`, 'Delete'))) return; await S.store.deleteItem(S.project.id, 'actions', a.id); closeModal(); };
}
async function sheetRows(file, want) {
  if (!window.XLSX) await loadScript('lib/xlsx.bundle.js');
  const wb = window.XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
  for (const name of wb.SheetNames) { const rows = window.XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: true }), h = rows.findIndex(r => want.every(w => r.some(c => String(c).trim().toLowerCase().startsWith(w)))); if (h >= 0) return { head: rows[h].map(c => String(c).trim().toLowerCase()), rows: rows.slice(h + 1) }; }
  return null;
}
// The Action Register workbook from the handover pack: Ref, Category, Action required, Council RFI comment / detail, Responsible, Priority, Status, Due date, Date closed, Notes.
export async function importActions(file) {
  const t = await sheetRows(file, ['ref', 'category', 'action']); if (!t) return toast('That does not look like the Action Register (no Ref, Category and Action columns found).', 7000);
  const col = n => t.head.findIndex(h => h.startsWith(n)), c = { ref: col('ref'), cat: col('category'), act: col('action'), det: t.head.findIndex(h => /detail|comment/.test(h)), who: col('responsible'), pri: col('priority'), st: col('status'), due: col('due'), cl: t.head.findIndex(h => /closed/.test(h)), no: col('notes') };
  const g = (r, i) => i >= 0 ? String(r[i] == null ? '' : r[i]).trim() : '', out = [], cur = Object.fromEntries(acts().map(a => [String(a.ref || '').toLowerCase(), a]));
  for (const r of t.rows) { const ref = g(r, c.ref); if (/^summary$/i.test(ref)) break; if (!ref || !g(r, c.act)) continue; const old = cur[ref.toLowerCase()];
    out.push({ ...(old || {}), id: old ? old.id : 'act-' + ref.toLowerCase().replace(/[^a-z0-9]+/g, '-'), ref, category: g(r, c.cat), action: g(r, c.act), detail: g(r, c.det), responsible: g(r, c.who), priority: PRI.includes(g(r, c.pri)) ? g(r, c.pri) : 'Medium', status: STATUS.includes(g(r, c.st)) ? g(r, c.st) : 'Open', due: iso(c.due >= 0 ? r[c.due] : ''), closed: iso(c.cl >= 0 ? r[c.cl] : ''), notes: g(r, c.no), updated: new Date().toISOString(), updatedBy: S.user.email }); }
  if (!out.length) return toast('No actions found in that workbook.');
  const fresh = out.filter(o => !cur[o.ref.toLowerCase()]).length;
  if (!(await confirmBox(`Bring in ${out.length} actions from the Action Register? ${fresh} are new and ${out.length - fresh} will be updated to match the workbook. Actions that are only in the app are left alone.`, 'Bring in'))) return;
  const b = busy('Bringing in the actions…'); try { await S.store.bulkSave(S.project.id, 'actions', out); b.done(); toast(`${out.length} actions brought in`, 5000); } catch (e) { b.done(); toast('Could not save: ' + e.message, 7000); }
}
// The Warranty Requirements Register workbook: each element's status, installer, what was received and what is wrong, matched to the app's assets by element name.
const ST_MAP = { 'received, execution incomplete': 'Partial' }, ST_OK = ['Received', 'Partial', 'Revision required', 'Query', 'Confirm', 'Not received', 'Not applicable'];
export async function importRegister(file) {
  const t = await sheetRows(file, ['ref', 'building system', 'element']); if (!t) return toast('That does not look like the Warranty Requirements Register (no Ref, Building System and Element columns found).', 7000);
  const col = re => t.head.findIndex(h => re.test(h)), c = { ref: col(/^ref/), sys: col(/^building system/), loc: col(/^location/), ri: col(/required: installer/), rm: col(/required: manufacturer/), el: col(/^element/), prod: col(/^product/), inst: col(/^installer/), doc: col(/^received document/), per: col(/^received period/), st: col(/^status/), vr: col(/^variance/) };
  const g = (r, i) => i >= 0 ? String(r[i] == null ? '' : r[i]).trim() : '', key = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ''), A = Object.fromEntries(((S.fm && S.fm.assets) || []).map(a => [key(a.element), a]));
  const ch = [], add = []; let miss = 0;
  for (const r of t.rows) { const el = g(r, c.el); if (!el || !g(r, c.st)) continue; const a = A[key(el)]; if (!a) { miss++; add.push(r); continue; }
    const raw = g(r, c.st), st = ST_MAP[raw.toLowerCase()] || (ST_OK.includes(raw) ? raw : a.status), notes = [g(r, c.doc) ? 'Received: ' + g(r, c.doc) + (g(r, c.per) ? ' (' + g(r, c.per) + ')' : '') : '', /execution incomplete/i.test(raw) ? 'Deed not yet fully executed.' : '', g(r, c.vr)].filter(Boolean).join(' ');
    const p = { status: st, installer: g(r, c.inst) || a.installer || '', product: g(r, c.prod) || a.product || '', notes }; if (Object.keys(p).some(k => (a[k] || '') !== p[k])) ch.push({ id: a.id, p }); }
  // rows the app does not have yet become new elements, after you confirm them
  const AS = (S.fm && S.fm.assets) || [], sysOf = v => { const pre = String(v || '').slice(0, 2), hit = AS.find(a => String(a.system || '').startsWith(pre)); return hit ? hit.system : v; };
  let n = 0; AS.forEach(a => { const m = /^A-(\d+)$/.exec(a.ref || ''); if (m) n = Math.max(n, +m[1]); });
  const fresh = add.map(r => { const raw = g(r, c.st); return { id: 'as-' + Math.random().toString(36).slice(2, 10), ref: 'A-' + String(++n).padStart(3, '0'), regRef: g(r, c.ref), system: sysOf(g(r, c.sys)), element: g(r, c.el), product: g(r, c.prod), installer: g(r, c.inst), location: g(r, c.loc), instWarranty: g(r, c.ri), mfrWarranty: g(r, c.rm), status: ST_MAP[raw.toLowerCase()] || (ST_OK.includes(raw) ? raw : 'Not received'), notes: [g(r, c.doc) ? 'Received: ' + g(r, c.doc) + (g(r, c.per) ? ' (' + g(r, c.per) + ')' : '') : '', g(r, c.vr)].filter(Boolean).join(' '), warranties: [], om: true, maint: false, audience: 'FM', created: new Date().toISOString() }; });
  if (!ch.length && !fresh.length) return toast('The assets already match the register.', 6000);
  modal(`<h2>Update from the Warranty Requirements Register</h2>
  ${ch.length ? `<p><b>${ch.length}</b> existing element${ch.length === 1 ? '' : 's'} will be updated: status, installer, product and notes are replaced with the register's.</p>` : ''}
  ${fresh.length ? `<p><b>${fresh.length}</b> element${fresh.length === 1 ? ' is' : 's are'} in the register but not in the app. Tick the ones to add:</p><div style="max-height:300px;overflow:auto;border:1px solid var(--line);border-radius:8px;padding:6px 10px">${fresh.map((a, i) => `<label style="display:flex;gap:8px;padding:4px 0"><input type="checkbox" data-nw="${i}" checked><span><b>${esc(a.element)}</b> <span class="muted small">${esc([a.regRef, a.system, a.installer].filter(Boolean).join(' · '))}</span></span></label>`).join('')}</div>` : ''}
  <div class="act"><button id="ruX">Cancel</button><button class="go" id="ruGo">Update</button></div>`, true);
  $('ruX').onclick = closeModal;
  $('ruGo').onclick = async () => { const pick = fresh.filter((_, i) => document.querySelector(`[data-nw="${i}"]`).checked); closeModal(); const b = busy('Updating the register…'), tot = ch.length + pick.length; let k = 0;
    try { for (const x of ch) { b.set(`Updating ${++k} of ${tot}…`); await S.store.patchItem(S.project.id, 'assets', x.id, x.p); }
      for (const a of pick) { b.set(`Adding ${++k} of ${tot}: ${a.element}`); await S.store.saveItem(S.project.id, 'assets', a); }
      b.done(); toast(`${ch.length} updated, ${pick.length} added from the register`, 6000); } catch (e) { b.done(); toast('Stopped: ' + e.message, 7000); } };
}
