// Contract section, second part: the registers that let a claim be tested against the record.
//   Delay events   who caused what, when, on which activity; shows concurrent delay on each claim
//   Programme      each programme the contractor issues, compared activity by activity with the baseline
//   Weather        daily rainfall against the contract's test and the programme's weather allowance
//   Variations     variation price requests with their response dates and the time effect stated
//   Obligations    what the contract requires of each party, checked month by month
//   Intake         drop a document or email; proposed register entries are approved one by one
//   Letters and the evidence pack are written from the registers.
// Admins only, like the rest of the section (see contract.js and firestore.rules).
import { S } from './state.js';
import { $, esc, toast, modal, closeModal, busy, confirmBox, uid, todayISO, nzDate, natural, download, loadScript } from './util.js';
import { aiCall } from './ai.js';
import * as FT from './filetext.js';
import { isWD, isoOf } from './workdays.js';
import { COLL, all, of, cfg, save, nextRef, form, read, editor, body, st, outBox, plus, gap, money, W, wdc, rowClick, F, view, goTab, clocks, exposure, infoState, infoOpen, isOwed, needOf, dateOf, csvRows, chaseText, timeLive, costGround, actOpen, decOpen, STAGES, ACT_ST, TIME_TYPES, safeUrl } from './contract.js';

const today = () => todayISO();
const refs = v => String(v || '').split(/[,;]+/).map(x => x.trim().toLowerCase()).filter(Boolean);
// "NOD #4", "nod 4" and "#4" all cite the same item
const key = r => String(r || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
export const cites = (list, ref) => { const k = key(ref), n = (/(\d+)\s*$/.exec(ref || '') || [])[1]; return refs(list).some(x => key(x) === k || (n && key(x) === n)); };

/* ---------------------------------------------------------------- delay events and concurrency */
export const CAUSES = ['Contractor', "Principal's side", 'Neutral'];
const CATS = ['Procurement or supply', 'Rework or defective work', 'Resourcing', 'Sequencing or planning', 'Health and safety', 'Late information', 'Change by the Principal', 'Access or site', 'Weather', 'Authority or utility', 'Other'];
const causeCls = c => c === 'Contractor' ? 'bad' : c === 'Neutral' ? 'grey' : 'info';
// the Working Days an event covers (an event with no end date is still running)
export function wdSet(from, to, end = today()) {
  const out = new Set(); if (!from) return out; const c = wdc(), last = to || end; let d = new Date(from + 'T00:00'), n = 0;
  while (isoOf(d) <= last && n++ < 1500) { const i = isoOf(d); if (isWD(i, c)) out.add(i); d.setDate(d.getDate() + 1); }
  return out;
}
// For one notice or claim: the Working Days covered by events on each side, and the days where both were running.
export function concurrency(t, end = today()) {
  const E = of('delay').filter(d => cites(d.timeRefs, t.ref)), exc = new Set(), inexc = new Set();
  E.forEach(d => wdSet(d.from, d.to, end).forEach(x => (d.cause === 'Contractor' ? inexc : exc).add(x)));
  const both = [...exc].filter(x => inexc.has(x)).length;
  return { events: E, exc: exc.size, inexc: inexc.size, both, excOnly: exc.size - both };
}
export function concHtml(t) {
  const c = concurrency(t); if (!c.events.length) return `<div class="cclk">${st('Record', 'grey')} No delay events are linked to this item yet. Log what happened on both sides so concurrent delay can be shown.</div>`;
  return `<div class="cclk">${st('Record', c.both ? 'warn' : 'grey')} ${c.events.length} delay events linked: ${W(c.exc)} with a cause on the Principal's side or neutral, ${W(c.inexc)} with a cause on the Contractor's side, ${W(c.both)} where both were running.${cfg().concurrent && costGround(t) && c.both ? ` On the record, time-related Cost would run for ${W(c.excOnly)} of the ${c.exc}.` : ''}</div>`;
}
export function delayView() {
  const A = of('delay'), L = A.filter(d => (!F.owner || d.cause === F.owner) && (F.show === 'all' || !d.to || d.to >= plus(today(), -20))).sort((a, b) => String(b.from || '').localeCompare(String(a.from || '')));
  const sum = c => { const s = new Set(); A.filter(d => d.cause === c).forEach(d => wdSet(d.from, d.to).forEach(x => s.add(x))); return s.size; };
  body(`<div class="fbar"><select id="cShow"><option value="open">Running or recent</option><option value="all" ${F.show === 'all' ? 'selected' : ''}>All</option></select><select id="cOwn"><option value="">All causes</option>${CAUSES.map(o => `<option ${F.owner === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select><span style="flex:1"></span><button class="btn2 go" id="cNew">+ Delay event</button></div>
    <div class="cstages">${CAUSES.map(c => `<span><b>${A.filter(d => d.cause === c).length}</b> ${esc(c)} · ${W(sum(c))} covered</span>`).join('')}</div>
    <p class="muted small">Log every event that held up work, whoever caused it, on the day you learn of it. Cite the notice or claim it bears on. The Independent Certifier will see both sides, so the record has to be complete to be believed.</p>
    ${L.length ? `<table class="ftable"><tr><th>Ref</th><th>Event</th><th>Cause</th><th>From</th><th>To</th><th class="hm">Activity</th><th>Cited in</th></tr>${L.map(d => `<tr class="click" data-id="${esc(d.id)}"><td><b>${esc(d.ref || '')}</b></td><td>${esc(d.title || '')}${d.evidence ? `<br><span class="muted small">${esc(String(d.evidence).slice(0, 160))}</span>` : ''}</td><td>${st(d.cause || '', causeCls(d.cause))}<br><span class="muted small">${esc(d.category || '')}</span></td><td>${d.from ? esc(nzDate(d.from)) : ''}</td><td>${d.to ? esc(nzDate(d.to)) : st('Running', 'warn')}</td><td class="hm">${esc(d.activity || '')}${d.critical === 'Yes' ? ' ' + st('Critical', 'bad') : ''}</td><td>${esc(d.timeRefs || '')}</td></tr>`).join('')}</table>` : `<div class="empty2">${A.length ? 'Nothing matches.' : 'No delay events logged. Start with what the meeting summaries and the contractor\'s reports already record.'}</div>`}`);
  $('cShow').onchange = e => { F.show = e.target.value; view(); }; $('cOwn').onchange = e => { F.owner = e.target.value; view(); }; $('cNew').onclick = () => editDelay(null); rowClick('#cBody tr[data-id]', editDelay);
}
export function editDelay(d, preset) {
  const isNew = !d; d = d ? { ...d } : { id: uid(), kind: 'delay', cause: 'Contractor', category: CATS[0], from: today(), critical: 'Not known', ...(preset || {}) };
  const spec = [{ k: 'ref', l: 'Ref' }, { k: 'cause', l: 'Cause sits with', t: 'sel', L: CAUSES }, { k: 'title', l: 'What happened', full: true }, { k: 'category', l: 'Type', t: 'sel', L: CATS }, { k: 'who', l: 'Party or subcontractor' }, { k: 'from', l: 'From', t: 'date' }, { k: 'to', l: 'To (leave empty while it is running)', t: 'date' }, { k: 'activity', l: 'Programme activity affected' }, { k: 'critical', l: 'On the critical path', t: 'sel', L: ['Not known', 'Yes', 'No'] }, { k: 'timeRefs', l: 'Bears on notice or claim (refs)', ph: 'NOD #5, NOD #7' }, { k: 'link', l: 'Link to the record', t: 'url' }, { k: 'evidence', l: 'Evidence (document, minute, photo, who said what)', t: 'ta', rows: 2 }, { k: 'notes', l: 'Notes', t: 'ta', rows: 2 }];
  editor(isNew ? 'New delay event' : `${d.ref} delay event`, spec, d, isNew, isNew ? '' : `<div class="cbox"><div class="cclk">${W(wdSet(d.from, d.to).size)} covered${d.to ? '' : ', still running'}.</div></div>`, n => { if (!n.title) { toast('Say what happened'); return null; } if (!n.from) { toast('Give the date it started'); return null; } if (n.to && n.to < n.from) { toast('The end date is before the start'); return null; } if (!n.ref) n.ref = nextRef('delay', 'DE'); return n; }, 'event');
}

/* ---------------------------------------------------------------- programme tracking */
const pdate = v => v instanceof Date ? isoOf(new Date(v.getTime() + 12 * 36e5)) : dateOf(String(v || '').trim().replace(/^[A-Za-z]{3,}\s+/, ''));
const yes = v => /^(y|yes|true|1)$/i.test(String(v).trim());
// rows from a Microsoft Project export (Excel or CSV): Name, Start, Finish, and where present ID, Critical, % Complete
// Microsoft Project's own XML format (File > Save As > XML): read in the browser with no conversion. Baseline 0 is the baseline finish.
export function mspdiActs(xml) {
  const d = new DOMParser().parseFromString(xml, 'application/xml'); if (d.getElementsByTagName('parsererror').length) throw new Error('the XML could not be read');
  const kid = (e, n) => [...e.children].find(c => c.localName === n), g = (e, n) => { const c = kid(e, n); return c ? c.textContent.trim() : ''; };
  const root = d.documentElement, issued = (g(root, 'StatusDate') || g(root, 'LastSaved') || g(root, 'CurrentDate') || '').slice(0, 10);
  const acts = [...d.getElementsByTagNameNS('*', 'Task')].filter(t => t.parentElement && t.parentElement.localName === 'Tasks' && g(t, 'OutlineLevel') !== '0' && g(t, 'IsNull') !== '1').map(t => {
    const bl = [...t.children].filter(c => c.localName === 'Baseline').find(b => g(b, 'Number') === '0');
    return { n: g(t, 'Name'), id: g(t, 'ID') || g(t, 'UID'), s: g(t, 'Start').slice(0, 10), f: g(t, 'Finish').slice(0, 10), crit: g(t, 'Critical') === '1', pct: g(t, 'PercentComplete') !== '' ? +g(t, 'PercentComplete') : null, bf: bl ? g(bl, 'Finish').slice(0, 10) : '', sum: g(t, 'Summary') === '1' };
  }).filter(a => a.n && /^\d{4}-\d{2}-\d{2}$/.test(a.f));
  return { acts, issued };
}
export function progActs(rows) {
  const hi = rows.findIndex(r => r.some(c => /^(task )?name$|^activity/i.test(String(c).trim())) && r.some(c => /^finish|^end/i.test(String(c).trim()))); if (hi < 0) return [];
  const h = rows[hi].map(c => String(c).trim().toLowerCase()), col = re => h.findIndex(x => re.test(x)), cN = col(/^(task )?name$|^activity/), cS = col(/^start/), cF = col(/^finish|^end/), cI = col(/^(unique )?id$|^wbs$/), cC = col(/^critical/), cP = col(/% ?complete|^percent/), cB = col(/baseline finish/), cU = col(/^summary/);
  return rows.slice(hi + 1).map(r => ({ n: String(r[cN] || '').trim(), id: cI >= 0 ? String(r[cI]).trim() : '', s: cS >= 0 ? pdate(r[cS]) : '', f: pdate(r[cF]), crit: cC >= 0 && yes(r[cC]), pct: cP >= 0 ? parseFloat(r[cP]) || 0 : null, bf: cB >= 0 ? pdate(r[cB]) : '', sum: cU >= 0 && yes(r[cU]) })).filter(a => a.n && a.f);
}
const progs = () => of('prog').sort((a, b) => String(a.issued).localeCompare(String(b.issued)));
// Activity by activity: how far each finish has moved between two issues of the programme.
export function progCompare(base, cur) {
  const k = a => a.id ? 'i' + a.id : 'n' + a.n.toLowerCase(), B = new Map((base.acts || []).map(a => [k(a), a]));
  return (cur.acts || []).map(a => { const b = B.get(k(a)) || B.get('n' + a.n.toLowerCase()); return { n: a.n, crit: a.crit, pct: a.pct, was: b ? b.f : '', now: a.f, slip: b ? gap(b.f, a.f) : null, isNew: !b }; });
}
// Activities the programme says should be finished by the day it was issued, and are not: the dates were not moved to match progress.
export const progBehind = p => (p.acts || []).filter(a => !a.sum && a.pct != null && a.pct < 100 && a.f < p.issued).map(a => ({ ...a, late: gap(a.f, p.issued) })).sort((x, y) => y.late - x.late);
const lastFinish = p => (p.acts || []).reduce((m, a) => a.f > m ? a.f : m, '');
export function progView() {
  const P = progs(); let b = P.find(p => p.id === F.pb) || P.find(p => p.baseline) || P[0], c = P.find(p => p.id === F.pc) || P[P.length - 1];
  const rows = b && c && b !== c ? progCompare(b, c) : [], show = rows.filter(r => (F.show === 'all' || (r.slip || 0) !== 0 || r.isNew) && (!F.q || r.crit)).sort((x, y) => (y.slip || 0) - (x.slip || 0));
  const D = of('delay'), ev = n => D.filter(d => d.activity && n.toLowerCase().includes(String(d.activity).toLowerCase())).map(d => d.ref).join(', ');
  const behind = c ? progBehind(c) : [], noBase = c && (c.acts || []).length && (c.acts || []).filter(a => a.bf).length < (c.acts || []).length / 2;
  const opt = (sel) => P.map(p => `<option value="${esc(p.id)}" ${sel && p.id === sel.id ? 'selected' : ''}>${esc(p.name)} (${esc(nzDate(p.issued))})${p.baseline ? ' · baseline' : ''}</option>`).join('');
  body(`<div class="fbar">${P.length > 1 ? `<span class="muted small">Compare</span><select id="pB">${opt(b)}</select><span class="muted small">with</span><select id="pC">${opt(c)}</select><select id="cShow"><option value="open">Moved or new</option><option value="all" ${F.show === 'all' ? 'selected' : ''}>All activities</option></select><label class="small"><input type="checkbox" id="pCrit" ${F.q ? 'checked' : ''}> Critical only</label>` : ''}<span style="flex:1"></span><button class="btn2 go" id="pImp">⬆ Programme (Microsoft Project XML, Excel or CSV)</button><input type="file" id="pFile" accept=".xml,.xlsx,.xls,.csv,.mpp" hidden></div>
    ${P.length ? `<table class="ftable cscore"><tr><th>Programme</th><th>Issued</th><th>Activities</th><th>Last finish</th><th></th></tr>${P.map(p => `<tr class="click" data-pid="${esc(p.id)}"><td><b>${esc(p.name)}</b>${p.baseline ? ' ' + st('Baseline', 'info') : ''}</td><td>${esc(nzDate(p.issued))}</td><td>${(p.acts || []).length}</td><td>${esc(nzDate(lastFinish(p)))}</td><td class="muted small">Open to rename, set as baseline or delete</td></tr>`).join('')}</table>` : ''}
    ${rows.length && rows.some(r => (r.slip || 0) !== 0 || r.isNew) ? `<p class="muted small">${rows.filter(r => r.slip > 0).length} activities finish later than in "${esc(b.name)}", ${rows.filter(r => r.slip < 0).length} earlier, ${rows.filter(r => r.isNew).length} new. Last finish moved ${W(gap(lastFinish(b), lastFinish(c)))}${rows.some(r => r.crit) ? '' : '. The export carries no critical path column, so the critical test cannot be run from it'}.</p>
      <table class="ftable"><tr><th>Activity</th><th>Finish was</th><th>Finish now</th><th>Moved</th><th>Delay events</th></tr>${show.slice(0, 250).map(r => `<tr><td>${esc(r.n)}${r.crit ? ' ' + st('Critical', 'bad') : ''}${r.pct != null ? ` <span class="muted small">${r.pct}%</span>` : ''}</td><td>${r.was ? esc(nzDate(r.was)) : '<span class="muted">New</span>'}</td><td>${esc(nzDate(r.now))}</td><td>${r.slip == null ? '' : r.slip > 0 ? st('+' + r.slip + ' WD', r.crit ? 'bad' : 'warn') : r.slip < 0 ? st(r.slip + ' WD', 'ok') : 'None'}</td><td>${esc(ev(r.n))}</td></tr>`).join('')}</table>`
    : P.length > 1 && b !== c ? `<div class="empty2" style="margin-bottom:10px">No finish date differs between "${esc(b.name)}" and "${esc(c.name)}": ${(c.acts || []).length} activities, none moved. If progress has slipped, the programme has been updated for percentage complete only and has not been rescheduled.</div>` : `<div class="empty2">${P.length === 1 ? 'One programme loaded. Bring in the next issue to see what has moved.' : P.length ? '' : 'No programme loaded. Ask the contractor to issue each programme as a Microsoft Project XML file as well as the .mpp (in Project: File, Save As, XML Format). It carries every activity, the critical flag, % complete and the baseline. An Excel or CSV task table (ID, Name, Start, Finish, % Complete, Critical) also works. Load the contract programme first and mark it as the baseline, then each tracked programme as it is issued.'}</div>`}`);
  if (c && (behind.length || noBase)) $('cBody').insertAdjacentHTML('beforeend', `<h3 class="sec">"${esc(c.name)}" against its own dates</h3>${noBase ? `<p class="muted small">${(c.acts || []).filter(a => a.bf).length} of ${(c.acts || []).length} activities carry a baseline finish, so the file does not show a comparison with the baseline.</p>` : ''}${behind.length ? `<p class="muted small">${behind.length} activities were due to finish before the programme was issued (${esc(nzDate(c.issued))}) and are not complete${behind.some(a => a.crit) ? `, ${behind.filter(a => a.crit).length} of them on the critical path` : ', none of them marked critical'}.</p><table class="ftable"><tr><th>Activity</th><th>Programme finish</th><th>Complete</th><th>Past its date</th></tr>${behind.slice(0, 150).map(a => `<tr><td>${esc(a.n)}${a.crit ? ' ' + st('Critical', 'bad') : ''}</td><td>${esc(nzDate(a.f))}</td><td>${a.pct}%</td><td>${st(a.late + ' WD', a.late > 20 ? 'bad' : 'warn')}</td></tr>`).join('')}</table>` : ''}`);
  if ($('pB')) { $('pB').onchange = e => { F.pb = e.target.value; view(); }; $('pC').onchange = e => { F.pc = e.target.value; view(); }; $('cShow').onchange = e => { F.show = e.target.value; view(); }; $('pCrit').onchange = e => { F.q = e.target.checked ? '1' : ''; view(); }; }
  $('pImp').onclick = () => $('pFile').click(); $('pFile').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) importProg(f); };
  document.querySelectorAll('[data-pid]').forEach(r => r.onclick = () => editProg(all().find(x => x.id === r.dataset.pid)));
}
async function importProg(file) {
  if (/\.mpp$/i.test(file.name)) { modal(`<h2>Microsoft Project file</h2><p>A .mpp file cannot be opened in a web browser. Two ways to bring it in:</p><ol><li>Open it in Microsoft Project, then File, Save As, and choose <b>XML Format (*.xml)</b>. Bring that file in here.</li><li>Better: ask the contractor to issue the XML with every programme, alongside the .mpp. Clause 5.13 programmes then load in one step each month.</li></ol><div class="act"><button class="go" id="mpX">OK</button></div>`); $('mpX').onclick = closeModal; return; }
  let acts, issued = '';
  try {
    if (/\.xml$/i.test(file.name)) ({ acts, issued } = mspdiActs(await file.text()));
    else { let rows; if (/\.csv$/i.test(file.name)) rows = csvRows(await file.text()); else { if (!window.XLSX) await loadScript('lib/xlsx.bundle.js'); const wb = window.XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true }); rows = window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: true }); } acts = progActs(rows); }
  } catch (e) { return toast('Could not read that file: ' + e.message, 6000); }
  if (!acts.length) return toast('No activities found. The file needs Name and Finish columns.', 7000);
  editProg({ id: uid(), kind: 'prog', name: file.name.replace(/\.[^.]+$/, ''), issued: issued || today(), baseline: !progs().length, acts }, true);
}
function editProg(p, isNew) {
  const spec = [{ k: 'name', l: 'Programme name', full: true }, { k: 'issued', l: 'Date issued by the contractor', t: 'date' }, { k: 'baseline', l: 'This is the contract (baseline) programme', t: 'chk' }];
  editor(isNew ? `New programme: ${p.acts.length} activities` : p.name, spec, p, isNew, `<p class="muted small">${p.acts.length} activities, last finish ${esc(nzDate(lastFinish(p)))}.</p>`, n => { if (!n.issued) { toast('Give the date it was issued'); return null; } if (n.baseline) of('prog').filter(x => x.baseline && x.id !== n.id).forEach(x => save({ ...x, baseline: false })); return n; }, 'programme');
}

/* ---------------------------------------------------------------- weather against the allowance */
const monthOf = d => d.slice(0, 7), wxDoc = m => all().find(x => x.id === 'wx-' + m) || { id: 'wx-' + m, kind: 'wx', month: m, allowance: '', days: {} };
export function wxMonth(doc, c = cfg()) { const L = Object.entries(doc.days || {}).filter(([d, v]) => isWD(d, wdc()) && ((+v.mm > +c.wxRain) || v.other)); return { hit: L.length, allow: +doc.allowance || 0, over: Math.max(0, L.length - (+doc.allowance || 0)) }; }
export function wxView() {
  const c = cfg(), m = F.wm || monthOf(today()), doc = wxDoc(m), months = [...new Set([...of('wx').map(x => x.month), monthOf(today())])].sort(), days = []; const d = new Date(m + '-01T00:00');
  while (isoOf(d).slice(0, 7) === m) { const i = isoOf(d); if (isWD(i, wdc())) days.push(i); d.setDate(d.getDate() + 1); }
  const tot = of('wx').reduce((s, x) => { const r = wxMonth(x); return { hit: s.hit + r.hit, allow: s.allow + r.allow, over: s.over + r.over }; }, { hit: 0, allow: 0, over: 0 }), r = wxMonth(doc);
  body(`<div class="fbar"><select id="wM">${months.map(x => `<option ${x === m ? 'selected' : ''}>${x}</option>`).join('')}</select><input type="month" id="wAdd" title="Open another month"><span style="flex:1"></span><button class="btn2" id="wImp">⬆ Rainfall (CSV: date, mm)</button><input type="file" id="wFile" accept=".csv" hidden><button class="btn2 go" id="wSave">Save month</button></div>
    <div class="cstages"><span><b>${r.hit}</b> qualifying days this month</span><span><b>${r.allow}</b> allowed in the programme</span><span><b>${r.over}</b> over the allowance</span><i>|</i><span><b>${tot.over}</b> over the allowance across ${of('wx').length} months recorded</span></div>
    <p class="muted small">A day counts where rain in 24 hours on a Working Day is more than ${esc(c.wxRain)} mm${c.wxStation ? ' at ' + esc(c.wxStation) : ' at the station the contract names (set it in Set-up)'}, or where you tick it for wind or fog under the contract's other tests. ${esc(c.weatherNote || 'Only days over the programme\'s weather allowance can support an extension.')}</p>
    <div class="grid" style="max-width:420px"><label class="f">Weather days allowed in the programme this month<input type="number" id="wAl" value="${esc(doc.allowance)}"></label></div>
    <table class="ftable" style="max-width:820px;margin-top:8px"><tr><th>Working Day</th><th>Rain (mm)</th><th>Wind or fog test met</th><th>Note</th><th></th></tr>${days.map(i => { const v = (doc.days || {})[i] || {}, hit = (+v.mm > +c.wxRain) || v.other; return `<tr data-d="${i}"><td>${esc(new Date(i + 'T00:00').toLocaleDateString('en-NZ', { weekday: 'short', day: '2-digit', month: 'short' }))}</td><td><input type="number" step="0.1" data-mm value="${esc(v.mm == null ? '' : v.mm)}" style="width:90px"></td><td><input type="checkbox" data-ot ${v.other ? 'checked' : ''}></td><td><input data-nt value="${esc(v.note || '')}" style="width:100%"></td><td>${hit ? st('Counts', 'warn') : ''}</td></tr>`; }).join('')}</table>`);
  const collect = () => { const o = { ...doc, allowance: $('wAl').value === '' ? '' : +$('wAl').value, days: { ...(doc.days || {}) } }; document.querySelectorAll('tr[data-d]').forEach(tr => { const mm = tr.querySelector('[data-mm]').value, ot = tr.querySelector('[data-ot]').checked, nt = tr.querySelector('[data-nt]').value.trim(); if (mm === '' && !ot && !nt) delete o.days[tr.dataset.d]; else o.days[tr.dataset.d] = { ...(mm === '' ? {} : { mm: +mm }), ...(ot ? { other: true } : {}), ...(nt ? { note: nt } : {}) }; }); return o; };
  $('wM').onchange = e => { F.wm = e.target.value; view(); }; $('wAdd').onchange = e => { if (e.target.value) { F.wm = e.target.value; view(); } };
  $('wSave').onclick = async () => { try { await save(collect()); toast('Weather saved for ' + m); } catch (e) { toast('Could not save: ' + e.message, 6000); } };
  $('wImp').onclick = () => $('wFile').click(); $('wFile').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; const by = {}; csvRows(await f.text()).forEach(r => { const dt = dateOf(r[0]), mm = parseFloat(r[1]); if (dt && !isNaN(mm)) (by[monthOf(dt)] = by[monthOf(dt)] || {})[dt] = mm; });
    const ms = Object.keys(by); if (!ms.length) return toast('No rows read. The file needs a date in the first column and millimetres in the second.', 7000);
    for (const k of ms) { const o = wxDoc(k); o.days = { ...(o.days || {}) }; Object.entries(by[k]).forEach(([dt, mm]) => { o.days[dt] = { ...(o.days[dt] || {}), mm }; }); await save(o); } toast(`Rainfall brought in for ${ms.length} month${ms.length === 1 ? '' : 's'}`, 5000); };
}

/* ---------------------------------------------------------------- variation price requests */
const VPR_ST = ['Issued', 'Response received', 'Accepted', 'Declined', 'Instructed as a Variation', 'Withdrawn'];
export const vprLive = v => ['Issued', 'Response received', 'Accepted'].includes(v.status);
const vprDue = v => v.respDue || (v.issued ? plus(v.issued, cfg().vprWD) : '');
export function vprState(v) {
  const due = vprDue(v);
  if (v.status === 'Issued' && !v.received && due) { const left = gap(today(), due); return { cls: left < 0 ? 'bad' : left <= 2 ? 'warn' : 'info', txt: left < 0 ? `Response ${W(-left)} overdue (was due ${nzDate(due)})` : `Response due ${nzDate(due)} (${W(left)} left)`, due, late: left < 0 }; }
  if (v.received && (v.timeDays === '' || v.timeDays == null) && vprLive(v)) return { cls: 'warn', txt: 'Response received with no critical path days stated. Ask for the figure, or record nil, before the Variation is directed.' };
  if (v.received && due && v.received > due) return { cls: 'grey', txt: `Response received ${W(gap(due, v.received))} late` };
  return { cls: 'grey', txt: '' };
}
export function vprView() {
  const L = of('vpr').filter(v => F.show === 'all' || vprLive(v)).sort((a, b) => natural(a.ref || '', b.ref || ''));
  body(`<div class="fbar"><select id="cShow"><option value="open">Live</option><option value="all" ${F.show === 'all' ? 'selected' : ''}>All</option></select><span style="flex:1"></span><button class="btn2 go" id="cNew">+ Variation price request</button></div>
    <p class="muted small">The Contractor's response is due on the date stated in the request, otherwise within ${cfg().vprWD} Working Days, and must state the Working Days that affect the critical path. Those days are the basis for any extension when the Variation is directed, so fix them before you instruct.</p>
    ${L.length ? `<table class="ftable"><tr><th>Ref</th><th>Request</th><th>Issued</th><th>Price</th><th>Time stated</th><th>Status</th><th>Position</th></tr>${L.map(v => { const s = vprState(v); return `<tr class="click" data-id="${esc(v.id)}"><td><b>${esc(v.ref || '')}</b></td><td>${esc(v.title || '')}${v.ciRef ? `<br><span class="muted small">${esc(v.ciRef)}</span>` : ''}</td><td>${v.issued ? esc(nzDate(v.issued)) : ''}</td><td>${v.price !== '' && v.price != null ? esc(money(v.price)) : ''}</td><td>${v.timeDays !== '' && v.timeDays != null ? W(+v.timeDays) : '<span class="muted">Not stated</span>'}</td><td>${st(v.status || '', vprLive(v) ? 'info' : 'grey')}</td><td>${s.txt ? st(s.cls === 'bad' ? 'Overdue' : s.cls === 'warn' ? 'Watch' : 'Note', s.cls) + ' ' + esc(s.txt) : ''}</td></tr>`; }).join('')}</table>` : '<div class="empty2">No variation price requests recorded.</div>'}`);
  $('cShow').onchange = e => { F.show = e.target.value; view(); }; $('cNew').onclick = () => editVpr(null); rowClick('#cBody tr[data-id]', editVpr);
}
export function editVpr(v) {
  const isNew = !v; v = v ? { ...v } : { id: uid(), kind: 'vpr', status: 'Issued', issued: today() };
  const spec = [{ k: 'ref', l: 'Ref' }, { k: 'status', l: 'Status', t: 'sel', L: VPR_ST }, { k: 'title', l: 'Work to be priced', full: true }, { k: 'issued', l: 'Issued', t: 'date' }, { k: 'respDue', l: 'Response date stated in the request (if any)', t: 'date' }, { k: 'received', l: 'Response received', t: 'date' }, { k: 'price', l: 'Price ($)', t: 'num' }, { k: 'timeDays', l: 'Critical path Working Days stated by the Contractor', t: 'num' }, { k: 'timeCost', l: 'Time-related cost included ($)', t: 'num' }, { k: 'instructedOn', l: 'Instructed as a Variation on', t: 'date' }, { k: 'ciRef', l: 'CI or variation reference' }, { k: 'eotDays', l: 'Extension granted with the instruction (Working Days)', t: 'num' }, { k: 'notes', l: 'Notes', t: 'ta', rows: 2 }];
  const s = isNew ? { txt: '' } : vprState(v);
  editor(isNew ? 'New variation price request' : `${v.ref} ${v.title}`, spec, v, isNew, s.txt ? `<div class="cbox"><div class="cclk">${st('9A', s.cls)} ${esc(s.txt)}</div></div>` : '', n => { if (!n.title) { toast('Say what is to be priced'); return null; } if (!n.ref) n.ref = nextRef('vpr', 'VPR'); if (n.received && n.status === 'Issued') n.status = 'Response received'; if (n.instructedOn) n.status = 'Instructed as a Variation'; return n; }, 'request');
}

/* ---------------------------------------------------------------- obligations */
const OWNERS = ['Contractor', 'Principal', 'Contract Administrator', 'Independent Certifier', 'Consultant'], FREQ = ['Once', 'Monthly', 'Each event', 'Ongoing'], CHK = ['', 'Complied', 'In part', 'Not complied', 'Not applicable'];
const thisMonth = () => today().slice(0, 7);
export function oblState(o, m = thisMonth()) {
  if (o.status === 'Complied' || o.status === 'Not applicable') return { cls: 'ok', txt: o.status };
  if (o.freq === 'Monthly') { const c = (o.checks || []).find(x => x.p === m); return c && c.s ? { cls: c.s === 'Complied' || c.s === 'Not applicable' ? 'ok' : 'bad', txt: `${m}: ${c.s}`, bad: c.s === 'Not complied' || c.s === 'In part' } : { cls: 'warn', txt: `${m}: not checked` }; }
  if (o.status === 'Not complied') return { cls: 'bad', txt: 'Not complied', bad: true };
  if (o.due) { const left = gap(today(), o.due); return left < 0 ? { cls: 'bad', txt: `Due ${nzDate(o.due)}, ${W(-left)} ago`, bad: true } : { cls: left <= 5 ? 'warn' : 'info', txt: `Due ${nzDate(o.due)}` }; }
  return { cls: 'grey', txt: o.freq || '' };
}
// The time obligations of the unamended NZS 3910:2023, as a starting point. Everything else comes from the project's own contract.
const STARTER = () => { const c = cfg(); return [
  { id: 'std-1032a', clause: '10.3.2(a)', owner: 'Contractor', freq: 'Each event', text: `Give the Contract Administrator and the Independent Certifier written notice of the circumstances relied on for an extension within ${c.noticeWD} Working Days of becoming aware of them.`, evidence: 'The notice, with the date and who it was given to' },
  { id: 'std-1032b', clause: '10.3.2(b)', owner: 'Contractor', freq: 'Each event', text: 'Give notice of the period of extension sought, in the first notice or in a second notice within a reasonable time.', evidence: 'The period claimed, in Working Days' },
  { id: 'std-1034', clause: '10.3.4', owner: 'Contract Administrator', freq: 'Each event', text: `Issue an Instruction within ${c.instructWD} Working Days of any agreement on an extension.`, evidence: 'The Instruction' },
  { id: 'std-1035', clause: '10.3.5', owner: 'Independent Certifier', freq: 'Each event', text: `Decide a claimed extension within ${c.icWD} Working Days of a request, or as soon as practicable after, with reasons.`, evidence: 'The Decision' }].map(o => ({ ...o, kind: 'obl', status: 'Open', ref: o.clause })); };
export function oblView() {
  const A = of('obl'), m = thisMonth(), L = A.filter(o => (!F.owner || o.owner === F.owner) && (F.show === 'all' || !['Complied', 'Not applicable'].includes(o.status))).sort((a, b) => natural(a.clause || '', b.clause || ''));
  body(`<div class="fbar"><select id="cShow"><option value="open">Open</option><option value="all" ${F.show === 'all' ? 'selected' : ''}>All</option></select><select id="cOwn"><option value="">Everyone</option>${OWNERS.map(o => `<option ${F.owner === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select><span style="flex:1"></span><button class="btn2 go" id="cNew">+ Obligation</button><button class="btn2" id="oStd">+ Time obligations from the standard</button><button class="btn2" id="oDoc">Read the contract for more (Intake)</button></div>
    <p class="muted small">${A.length} obligations · ${A.filter(o => oblState(o).bad).length} not met · ${A.filter(o => o.freq === 'Monthly' && !(o.checks || []).some(x => x.p === m && x.s)).length} monthly checks still to do for ${m}. Each line carries the clause, so a letter can cite it.</p>
    ${L.length ? `<table class="ftable"><tr><th>Clause</th><th>Obligation</th><th>Owed by</th><th>When</th><th>${m}</th><th>Position</th></tr>${L.map(o => { const s = oblState(o), c = (o.checks || []).find(x => x.p === m) || {}; return `<tr class="click" data-id="${esc(o.id)}"><td><b>${esc(o.clause || '')}</b></td><td>${esc(o.text || '')}${o.evidence ? `<br><span class="muted small">Evidence: ${esc(o.evidence)}</span>` : ''}</td><td>${esc(o.owner || '')}</td><td>${esc(o.freq || '')}${o.due ? '<br><span class="muted small">' + esc(nzDate(o.due)) + '</span>' : ''}</td><td>${o.freq === 'Monthly' ? `<select data-chk="${esc(o.id)}">${CHK.map(x => `<option ${x === (c.s || '') ? 'selected' : ''}>${x}</option>`).join('')}</select>` : ''}</td><td>${st(s.txt, s.cls)}</td></tr>`; }).join('')}</table>` : `<div class="empty2">${A.length ? 'Nothing matches.' : 'No obligations yet. Add the time obligations from the standard, then read the contract in Intake to propose the rest.'}</div>`}`);
  $('cShow').onchange = e => { F.show = e.target.value; view(); }; $('cOwn').onchange = e => { F.owner = e.target.value; view(); }; $('cNew').onclick = () => editObl(null); rowClick('#cBody tr[data-id]', editObl);
  $('oDoc').onclick = () => goTab('in');
  $('oStd').onclick = async () => { const have = new Set(all().map(x => x.id)), nu = STARTER().filter(o => !have.has(o.id) && !A.some(x => String(x.clause || '').startsWith(o.clause))); if (!nu.length) return toast('Already added'); await S.store.bulkSave(S.project.id, COLL, nu.map(o => ({ ...o, updated: new Date().toISOString(), updatedBy: S.user.email }))); toast(nu.length + ' added'); };
  document.querySelectorAll('[data-chk]').forEach(x => x.onchange = async () => { const o = all().find(y => y.id === x.dataset.chk); await save({ ...o, checks: [...(o.checks || []).filter(c => c.p !== m), { p: m, s: x.value, on: today() }] }); });
}
export function editObl(o) {
  const isNew = !o; o = o ? { ...o } : { id: uid(), kind: 'obl', owner: 'Contractor', freq: 'Once', status: 'Open' };
  const spec = [{ k: 'clause', l: 'Clause' }, { k: 'owner', l: 'Owed by', t: 'sel', L: OWNERS }, { k: 'text', l: 'Obligation', t: 'ta', rows: 3 }, { k: 'freq', l: 'When', t: 'sel', L: FREQ }, { k: 'due', l: 'Due (for a one-off)', t: 'date' }, { k: 'status', l: 'Status', t: 'sel', L: ['Open', 'Complied', 'Not complied', 'Not applicable'] }, { k: 'evidence', l: 'Evidence that shows it was met', full: true }, { k: 'notes', l: 'Notes', t: 'ta', rows: 2 }];
  const hist = (o.checks || []).length ? `<p class="muted small">${o.checks.slice().sort((a, b) => a.p.localeCompare(b.p)).map(c => `${esc(c.p)}: ${esc(c.s || 'not checked')}`).join(' · ')}</p>` : '';
  editor(isNew ? 'New obligation' : `Clause ${o.clause}`, spec, o, isNew, hist, n => { if (!n.text) { toast('Say what the obligation is'); return null; } n.ref = n.clause || n.ref || nextRef('obl', 'OB'); return n; }, 'obligation');
}
// vpr and obligation items for the "needs attention" list in contract.js
export function extraRunning(R) {
  of('vpr').forEach(v => { const s = vprState(v); if (s.cls === 'bad' || s.cls === 'warn') R.push({ id: v.id, what: `${v.ref} ${v.title}`, txt: s.txt, due: s.due || '', cls: s.cls, who: 'Contractor', tab: 'vpr' }); });
  of('obl').forEach(o => { const s = oblState(o); if (s.bad) R.push({ id: o.id, what: `Clause ${o.clause} ${String(o.text).slice(0, 60)}`, txt: s.txt, due: o.due || '', cls: 'bad', who: o.owner || '', tab: 'obl' }); });
}

/* ---------------------------------------------------------------- intake: documents and emails into the registers */
// One instruction serves the in-app AI helper and a paste into Claude. The reply is a single JSON block.
export function handoverText(ctx, text) {
  const c = cfg(), T = of('time').filter(timeLive), I = of('info').filter(i => infoOpen(i) && isOwed(i));
  return `You are helping the Contract Administrator on ${S.project.name} (${c.form}). Below is ${ctx.label}. Read it and propose entries for the project registers.
Reply with one JSON object only, in this shape, and nothing else. Leave out any list that has nothing in it.
{"updates":[{"ref":"A-01","status":"Open|In progress|Blocked|Done|Closed","note":"what was said, one sentence"}],
 "actions":[{"text":"new action","owner":"a named person","due":"YYYY-MM-DD or empty"}],
 "decisions":[{"text":"decision made or needed","madeBy":"who","stage":"Awaiting decision|Decided"}],
 "time":[{"title":"a delay or programme impact the contractor raised for the first time","aware":"${ctx.date}","note":"who said what"}],
 "delays":[{"title":"what held up the work","cause":"Contractor|Principal's side|Neutral","category":"Procurement or supply|Rework or defective work|Resourcing|Sequencing or planning|Health and safety|Late information|Change by the Principal|Access or site|Weather|Authority or utility|Other","from":"YYYY-MM-DD","to":"YYYY-MM-DD or empty if still running","activity":"programme activity affected","timeRefs":"notice refs it bears on","evidence":"the words or figures that show it"}],
 "info":[{"ref":"RFI 57","status":"Closed","answered":"YYYY-MM-DD","note":"how it was answered"}],
 "obligations":[{"clause":"5.22.1","owner":"Contractor|Principal|Contract Administrator|Independent Certifier|Consultant","freq":"Once|Monthly|Each event|Ongoing","text":"what must be done, in the contract's terms","evidence":"what would show it was done"}],
 "vprs":[{"title":"work priced","price":0,"timeDays":0,"received":"YYYY-MM-DD"}]}
Rules: use only what the document says; do not invent owners, dates or days; keep the speaker's key phrases; New Zealand English. Record delay events on every side, including late information from the design team and changes by the Principal, because the record must be complete. A cause is the Contractor's where it is the Contractor's own supply, labour, planning, workmanship or safety. "obligations" is for a contract, specification or special conditions: one entry per dated or repeating duty, with its clause number.
LIVE NOTICES AND CLAIMS
${T.map(t => `${t.ref} | ${t.title}`).join('\n') || 'none'}
OPEN ACTIONS
${(ctx.actions || of('action').filter(actOpen)).slice(0, 80).map(a => `${a.ref} | ${a.owner || 'no owner'} | ${a.text}`).join('\n') || 'none'}
OPEN RFIS
${I.slice(0, 60).map(i => `${i.ref} | ${i.subject}`).join('\n') || 'none'}
DOCUMENT
${text}`;
}
export function parseReply(txt) { const a = String(txt || '').indexOf('{'), b = String(txt || '').lastIndexOf('}'); if (a < 0 || b <= a) return null; try { return JSON.parse(String(txt).slice(a, b + 1)); } catch (e) { return null; } }
// Turn a reply into a list of proposals { t, txt, sub, cls, run }. Kept apart from the screen so it can be tested.
export function proposals(ctx, j) {
  const P = [], cnt = {}, num = (kind, pre) => { cnt[kind] = (cnt[kind] || 0) + 1; return pre + '-' + String(+nextRef(kind, pre).split('-')[1] + cnt[kind] - 1).padStart(2, '0'); }, src = `${ctx.label}${ctx.link ? ' (' + ctx.link + ')' : ''}`, okSt = s => ACT_ST.includes(s);
  (j.updates || []).forEach(u => { const a = of('action').find(x => key(x.ref) === key(u.ref)); if (a) P.push({ t: 'Update', cls: 'grey', txt: `${a.ref} ${a.text}`, sub: `${u.status || a.status}: ${u.note || ''}`, run: () => save({ ...a, status: okSt(u.status) ? u.status : a.status, updates: [...(a.updates || []).filter(x => !ctx.id || x.m !== ctx.id), { m: ctx.id || '', d: ctx.date, s: ctx.series || '', status: okSt(u.status) ? u.status : a.status, note: u.note || '' }] }) }); });
  (j.actions || []).filter(x => x.text).forEach(x => { const ref = num('action', 'A'); P.push({ t: 'New action', cls: 'info', txt: x.text, sub: `${x.owner || 'No owner'}${dateOf(x.due) ? ', due ' + nzDate(dateOf(x.due)) : ', no date'}`, run: () => save({ id: uid(), kind: 'action', ref, text: x.text, owner: x.owner || '', due: dateOf(x.due), status: 'Open', raised: ctx.date, series: ctx.series ? [ctx.series] : [], notes: ctx.series ? '' : 'From ' + src, updates: [{ m: ctx.id || '', d: ctx.date, s: ctx.series || '', status: 'Open', note: 'Raised' }] }) }); });
  (j.decisions || []).filter(x => x.text).forEach(x => { const ref = num('decision', 'DEC'), sg = STAGES.includes(x.stage) ? x.stage : 'Decided'; P.push({ t: sg === 'Decided' ? 'Decision made' : 'Decision needed', cls: 'info', txt: x.text, sub: x.madeBy || '', run: () => save({ id: uid(), kind: 'decision', ref, text: x.text, madeBy: x.madeBy || '', madeOn: ctx.date, stage: sg, stageOn: today(), source: ctx.label, link: ctx.link || '' }) }); });
  (j.time || []).filter(x => x.title).forEach(x => { const ref = num('time', 'M'); P.push({ t: 'Delay raised by the contractor', cls: 'bad', txt: x.title, sub: `Contractor aware ${nzDate(dateOf(x.aware) || ctx.date)}. ${x.note || ''}`, run: () => save({ id: uid(), kind: 'time', ref, type: TIME_TYPES[0], title: x.title, ground: 'Not stated', status: 'Raised, no notice', aware: dateOf(x.aware) || ctx.date, awareNote: src, notes: x.note || '' }) }); });
  (j.delays || []).filter(x => x.title && dateOf(x.from)).forEach(x => { const ref = num('delay', 'DE'), cause = CAUSES.includes(x.cause) ? x.cause : 'Neutral'; P.push({ t: 'Delay event: ' + cause, cls: causeCls(cause), txt: x.title, sub: `${nzDate(dateOf(x.from))}${dateOf(x.to) ? ' to ' + nzDate(dateOf(x.to)) : ', running'}${x.activity ? '. ' + x.activity : ''}${x.timeRefs ? '. Bears on ' + x.timeRefs : ''}. ${x.evidence || ''}`, run: () => save({ id: uid(), kind: 'delay', ref, title: x.title, cause, category: CATS.includes(x.category) ? x.category : 'Other', from: dateOf(x.from), to: dateOf(x.to), activity: x.activity || '', critical: 'Not known', timeRefs: x.timeRefs || '', evidence: `${x.evidence || ''} [${src}]`.trim(), link: ctx.link || '' }) }); });
  (j.info || []).forEach(u => { const i = of('info').find(x => key(x.ref) === key(u.ref)); if (i) P.push({ t: 'Information item', cls: 'grey', txt: `${i.ref} ${i.subject}`, sub: `${u.status || ''}${dateOf(u.answered) ? ' ' + nzDate(dateOf(u.answered)) : ''}. ${u.note || ''}`, run: () => save({ ...i, status: /closed/i.test(u.status || '') ? 'Closed' : i.status, answered: dateOf(u.answered) || i.answered || '', notes: [i.notes, u.note ? `${u.note} [${src}]` : ''].filter(Boolean).join('\n') }) }); });
  (j.obligations || []).filter(x => x.text).forEach(x => { const id = 'obl-' + key(x.clause || x.text.slice(0, 30)); if (all().some(y => y.id === id)) return; P.push({ t: 'Obligation', cls: 'info', txt: `${x.clause || ''} ${x.text}`, sub: `${x.owner || 'Contractor'}, ${x.freq || 'Once'}${x.evidence ? '. Evidence: ' + x.evidence : ''}`, run: () => save({ id, kind: 'obl', ref: x.clause || '', clause: x.clause || '', text: x.text, owner: OWNERS.includes(x.owner) ? x.owner : 'Contractor', freq: FREQ.includes(x.freq) ? x.freq : 'Once', evidence: x.evidence || '', status: 'Open', notes: 'From ' + src }) }); });
  (j.vprs || []).filter(x => x.title).forEach(x => { const ref = num('vpr', 'VPR'); P.push({ t: 'Variation price response', cls: 'info', txt: x.title, sub: `${x.price ? money(x.price) : 'No price'}, ${x.timeDays != null && x.timeDays !== '' ? W(+x.timeDays) : 'no time stated'}`, run: () => save({ id: uid(), kind: 'vpr', ref, title: x.title, status: 'Response received', received: dateOf(x.received) || ctx.date, price: x.price ?? '', timeDays: x.timeDays ?? '', notes: 'From ' + src }) }); });
  return P;
}
export function applyReply(ctx, txt, back) {
  const j = parseReply(txt); if (!j) { toast('Could not find the JSON block in that reply', 6000); return back && back(); }
  const P = proposals(ctx, j); if (!P.length) { toast('Nothing to bring in from that reply', 5000); return back && back(); }
  modal(`<h2>Proposed from ${esc(ctx.label)}</h2><p class="muted small">Untick anything that is wrong. Nothing is saved until you press Apply. Check every delay event: the cause and the dates are yours to stand behind.</p>${P.map((p, i) => `<label class="cprop"><input type="checkbox" data-p="${i}" checked> <span>${st(p.t, p.cls)} <b>${esc(p.txt)}</b><br><span class="muted small">${esc(p.sub)}</span></span></label>`).join('')}<div class="act"><button id="ppX">Cancel</button><button class="go" id="ppOk">Apply</button></div>`, true);
  $('ppX').onclick = () => { closeModal(); back && back(); };
  $('ppOk').onclick = async () => { const pick = [...document.querySelectorAll('[data-p]')].filter(x => x.checked).map(x => P[+x.dataset.p]); for (const p of pick) await p.run(); closeModal(); toast(pick.length + ' applied'); if (back) setTimeout(back, 300); };
}
async function docxText(bytes) { if (!window.JSZip) await loadScript('lib/jszip.min.js'); const z = await window.JSZip.loadAsync(bytes), f = z.file('word/document.xml'); if (!f) return ''; return (await f.async('string')).replace(/<\/w:p>/g, '\n').replace(/<w:tab\/>/g, '\t').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/\n{3,}/g, '\n\n'); }
export async function fileText(file, max = 60000) { const b = await file.arrayBuffer(); return (/\.docx$/i.test(file.name) ? await docxText(b) : await FT.textOf(b, file.name, max)).slice(0, max); }
const IN = { name: '', text: '', date: today(), mail: '' };
/* --- forwarded emails, through the project's Google helper (admin key needed) --- */
const INBOX = { list: null, at: 0, err: '', addr: '' };
export const mailTag = () => String(cfg().mailTag || (S.project && S.project.name || '').split(/\s+/)[0] || '').toLowerCase().replace(/[^a-z0-9]/g, '');
export const inboxCount = () => (INBOX.list || []).length;
async function helper(action, extra) {
  const h = S.ai || {}; if (!h.helperUrl) throw new Error('nohelper');
  const r = await fetch(h.helperUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ key: h.helperKey || '', adminKey: (S.aiAdmin || {}).adminKey || '', action, ...(extra || {}) }), redirect: 'follow' });
  let j; try { j = JSON.parse(await r.text()); } catch (e) { throw new Error('The helper sent back something unexpected'); } if (j.error) throw new Error(j.error); return j;
}
export async function inboxCheck(force) {
  if (!force && INBOX.at && Date.now() - INBOX.at < 10 * 60e3) return; INBOX.at = Date.now();
  try { const j = await helper('inboxGet', { tag: mailTag() }); if (!Array.isArray(j.items)) { INBOX.err = 'old'; INBOX.list = []; return; } INBOX.list = j.items; INBOX.addr = j.addr || ''; INBOX.err = ''; }
  catch (e) { INBOX.err = e.message === 'nohelper' ? 'nohelper' : e.message; INBOX.list = INBOX.list || []; }
}
// The first look this session happens in the background; the page redraws if anything is waiting.
export function inboxNote() { if (INBOX.at) return; inboxCheck().then(() => { if (inboxCount() && $('cBody')) view(); }); }
const sentLine = t => { const m = /^\s*(?:Sent|Date):\s*(.+)$/m.exec(t || ''); if (!m) return ''; const d = new Date(m[1].replace(/\s+at\s+/i, ' ')); return isNaN(d) ? '' : isoOf(d); };
function inboxHtml() {
  const tag = mailTag(), L = INBOX.list || [];
  const how = INBOX.addr ? `Forward to <b>${esc(INBOX.addr)}</b>, or put <b>[${esc(tag)}]</b> in the subject.` : `Forward to your helper's Gmail address with <b>+${esc(tag)}</b> before the @, or put <b>[${esc(tag)}]</b> in the subject.`;
  const err = INBOX.err === 'nohelper' ? 'This project has no Google helper yet (menu, AI). Until then, drag the email from Outlook onto the box below.' : INBOX.err === 'old' ? 'The Google helper needs updating to version 4 to read forwarded emails (see helper/Code.gs, five steps). Until then, drag the email from Outlook onto the box below.' : INBOX.err ? 'Could not check: ' + INBOX.err : '';
  return `<div class="cinbox"><div class="fbar" style="margin:0"><b>Forwarded emails${L.length ? ` (${L.length} waiting)` : ''}</b><span style="flex:1"></span><button class="btn2" id="ibChk">Check now</button></div>
    ${err ? `<p class="small" style="color:#a32222">${esc(err)}</p>` : `<p class="muted small">${how}</p>`}
    ${L.length ? `<ul class="clist">${L.map((m, i) => `<li${IN.mail === m.id ? ' style="background:#eef6f3"' : ''}><b>${esc(m.subject || '(no subject)')}</b> <span class="muted small">${esc(m.from)} · ${esc(nzDate(m.date.slice(0, 10)))}${m.files.length ? ' · ' + m.files.length + ' attachment' + (m.files.length === 1 ? '' : 's') : ''}</span><br><button class="btn2" data-ib="${i}">Read into Intake</button>${m.files.map(f => ` <button class="btn2" data-ia="${i}:${f.n}" title="Read this attachment into Intake">📎 ${esc(f.name.slice(0, 40))}</button>`).join('')} <button class="btn2" data-id2="${i}">Mark as filed</button></li>`).join('')}</ul>` : INBOX.at && !err ? '<p class="muted small">Nothing waiting.</p>' : ''}</div>`;
}
function inboxWire(take) {
  const L = INBOX.list || [], rd = () => { INBOX.at = 0; intakeView(); };
  $('ibChk').onclick = async () => { $('ibChk').disabled = true; $('ibChk').textContent = 'Checking…'; await inboxCheck(true); intakeView(); };
  document.querySelectorAll('[data-ib]').forEach(b => b.onclick = () => { const m = L[+b.dataset.ib]; IN.mail = m.id; IN.name = m.subject || 'Email'; IN.date = sentLine(m.text) || m.date.slice(0, 10); IN.text = `From: ${m.from}\nTo: ${m.to}\nForwarded: ${m.date.slice(0, 10)}\nSubject: ${m.subject}\nAttachments: ${m.files.map(f => f.name).join(', ') || 'none'}\n\n${m.text}`; intakeView(); $('inSt').textContent = 'Email read in. Check the date (the original sent date where the forward shows it), then read it. Mark it as filed when you are done.'; });
  document.querySelectorAll('[data-ia]').forEach(b => b.onclick = async () => { const [i, n] = b.dataset.ia.split(':'), m = L[+i]; $('inSt').textContent = 'Fetching the attachment…'; try { const j = await helper('inboxFile', { id: m.id, n: +n }), bin = Uint8Array.from(atob(j.data), c => c.charCodeAt(0)); IN.mail = m.id; IN.name = ''; IN.date = sentLine(m.text) || m.date.slice(0, 10); const dt = sentLine(m.text) || m.date.slice(0, 10); await take(new File([bin], j.name, { type: j.mime })); IN.date = dt; if ($('inDate')) $('inDate').value = dt; } catch (e) { $('inSt').textContent = 'Could not fetch it: ' + e.message; } });
  document.querySelectorAll('[data-id2]').forEach(b => b.onclick = async () => { const m = L[+b.dataset.id2]; try { await helper('inboxDone', { tag: mailTag(), id: m.id }); INBOX.list = L.filter(x => x !== m); if (IN.mail === m.id) IN.mail = ''; toast('Filed. It will not be listed again.'); intakeView(); } catch (e) { toast('Could not mark it: ' + e.message, 6000); } });
}
export function intakeView() {
  if (!INBOX.at) inboxCheck().then(() => { if ($('ibChk')) intakeView(); });
  body(`${inboxHtml()}<div id="inDrop" class="aedrop" style="margin-bottom:10px">Drop a document or email here (PDF, Word, an email dragged from Outlook, text), or <a href="#" id="inPick">choose a file</a>.<input type="file" id="inFile" accept=".pdf,.docx,.msg,.eml,.txt,.md,.csv,.htm,.html" hidden></div>
    <div class="grid"><label class="f">What it is<input id="inName" value="${esc(IN.name)}" placeholder="e.g. C3 contractor report, October 2026"></label><label class="f">Its date<input type="date" id="inDate" value="${esc(IN.date)}"></label><label class="f full">Text (read from the file, or paste it here)<textarea id="inText" rows="10">${esc(IN.text)}</textarea></label></div>
    <p><button class="btn2 go" id="inAI">✨ Read it and propose entries</button> <button class="btn2" id="inHand">Copy a hand-over for Claude</button> <button class="btn2" id="inPaste">Paste Claude's reply</button> <span id="inSt" class="muted small"></span></p>
    <p class="muted small">The reader proposes actions, decisions, delay events on every side, RFI answers, variation responses and, from a contract or specification, obligations with their clause numbers. You approve each one. Long documents are read in the first ${Math.round(60000 / 1000)},000 characters: for a full contract, take it a section at a time. "Read it" sends the text to this project's AI helper; the hand-over copies it for you to paste to Claude yourself.</p>`);
  const keep = () => { IN.name = $('inName').value.trim(); IN.date = $('inDate').value || today(); IN.text = $('inText').value; }, ctx = () => ({ date: IN.date, label: IN.name || 'a document', link: '' });
  const take = async f => { $('inSt').textContent = 'Reading ' + f.name + '…'; try { const t = await fileText(f); keep(); IN.text = t; if (!IN.name) IN.name = f.name.replace(/\.[^.]+$/, ''); intakeView(); $('inSt').textContent = t ? `${t.length.toLocaleString()} characters read from ${f.name}.` : 'No text could be read from that file. If it is a scan, paste the text instead.'; } catch (e) { $('inSt').textContent = 'Could not read it: ' + e.message; } };
  inboxWire(take);
  $('inPick').onclick = e => { e.preventDefault(); $('inFile').click(); }; $('inFile').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) take(f); };
  const dz = $('inDrop'); dz.ondragover = e => { e.preventDefault(); dz.classList.add('over'); }; dz.ondragleave = () => dz.classList.remove('over'); dz.ondrop = e => { e.preventDefault(); dz.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) take(f); };
  $('inAI').onclick = async () => { keep(); if (!IN.text.trim()) return toast('Add the text first'); $('inSt').textContent = 'Reading…'; try { const ans = await aiCall(handoverText(ctx(), IN.text)); applyReply(ctx(), ans, () => view()); } catch (e) { $('inSt').textContent = 'The AI helper could not read it: ' + e.message + '. Use the hand-over for Claude instead.'; } };
  $('inHand').onclick = async () => { keep(); const t = handoverText(ctx(), IN.text.trim() || '[paste the document text here]'); try { await navigator.clipboard.writeText(t); toast('Copied. Paste it to Claude, then bring the reply back with "Paste Claude\'s reply".', 6000); } catch (e) { outBox('Hand-over for Claude', t, 'Copy this to Claude.'); } };
  $('inPaste').onclick = () => { keep(); modal(`<h2>Paste Claude's reply</h2><textarea id="pjT" rows="12" style="width:100%" placeholder="Paste the reply, including the block that starts with {"></textarea><div class="act"><button id="pjX">Cancel</button><button class="go" id="pjOk">Read it</button></div>`, true); $('pjX').onclick = closeModal; $('pjOk').onclick = () => applyReply(ctx(), $('pjT').value, () => view()); };
}

/* ---------------------------------------------------------------- letters from the register */
const head = (to, subj) => { const c = cfg(); return `${nzDate(today())}\n\n${to}\n\nCopy: ${c.ic ? c.ic + ', Independent Certifier; ' : ''}${c.principal || 'the Principal'}\n\n${S.project.name}: ${subj}\n\nI write as Contract Administrator under the Contract (${c.form}).\n\n`; };
const sign = () => `\n${cfg().ca || 'Contract Administrator'}\nContract Administrator`;
const RESERVE = 'Nothing in this letter is an acceptance that any notice was given within the time the Contract requires, or that any entitlement to an extension of time or to Cost arises. The Principal\'s rights under the Contract are reserved in full.';
export function letterPeriod(by = plus(today(), 10)) {
  const T = of('time').filter(t => timeLive(t) && t.received && !(+t.daysClaimed > 0)); if (!T.length) return '';
  return head(cfg().contractor || 'The Contractor', 'notices of delay: period claimed') + `1. The following notices have been given and none states a period of extension:\n${T.map(t => `   ${t.ref} ${t.title}, notice given ${nzDate(t.received)}`).join('\n')}\n2. Clause 10.3.2(b) requires notice of the details of the period sought, in the first notice or within a reasonable time after it.\n3. Please provide for each notice by ${nzDate(by)}:\n   (a) the ground relied on under clause 10.3.1;\n   (b) the circumstances relied on and the date the Contractor first became aware of them, with the supporting record;\n   (c) the period claimed in Working Days and the part of the Contract Works it applies to;\n   (d) the effect on the critical path, shown against the current programme;\n   (e) the steps taken and proposed to mitigate the delay;\n   (f) any time-related Cost claimed, with its basis.\n4. If no extension is to be claimed under a notice, please confirm that in writing so it can be closed.\n5. I will then meet with you under clause 10.3.4 to work through each claim.\n\n${RESERVE}\n` + sign();
}
export function letterInstruction(t) {
  const c = cfg(), days = t.grantedDays !== '' && t.grantedDays != null ? t.grantedDays : t.recDays;
  return head(c.contractor || 'The Contractor', `Instruction: extension of time, ${t.ref}`) + `1. This Instruction is issued under clause 10.3.4 and records the agreement reached on ${t.agreedOn ? nzDate(t.agreedOn) : '[date]'} on ${t.ref} ${t.title}.\n2. Ground: ${t.ground || '[ground]'}.\n3. Extension agreed: ${days !== '' && days != null ? W(+days) : '[number] Working Days'}${t.sp ? ', applying to ' + t.sp : ''}.\n4. The Due Date for Completion is adjusted accordingly. [State the new date.]\n5. ${costGround(t) ? `Time-related Cost: ${c.concurrent && t.excDays !== '' && t.excDays != null ? W(Math.max(0, (+t.excDays || 0) - (+t.inexcDays || 0))) + ' at the Working Day rate, the balance of the period being concurrent with delay for which the Contractor is responsible (Special Condition 10.3.9)' : '[number] Working Days at the Working Day rate'}.` : 'This ground carries time only. No time-related Cost is payable.'}\n6. This Instruction is in full and final settlement of ${t.ref}. Please update the programme to reflect it.\n` + sign();
}
export function letterVpr() {
  const L = of('vpr').filter(v => vprState(v).late); if (!L.length) return '';
  return head(cfg().contractor || 'The Contractor', 'variation price requests: responses overdue') + `1. The Contractor's Response to the following requests is overdue:\n${L.map(v => `   ${v.ref} ${v.title}, issued ${nzDate(v.issued)}, response due ${nzDate(vprState(v).due)}`).join('\n')}\n2. Each Response is to give a fixed lump sum price, fully broken down, and to state the Working Days that affect the critical path.\n3. Please provide each Response by ${nzDate(plus(today(), 5))}. If a Response is not provided, the Principal's rights in respect of the work are reserved.\n` + sign();
}
export function letterObl(owner = 'Contractor') {
  const m = thisMonth(), L = of('obl').filter(o => o.owner === owner && oblState(o).bad); if (!L.length) return '';
  return head(owner === 'Contractor' ? (cfg().contractor || 'The Contractor') : owner, 'requirements of the Contract not yet met') + `The following requirements have not been met. Please attend to each by ${nzDate(plus(today(), 5))} and confirm in writing when done.\n\n${L.map((o, i) => `${i + 1}. Clause ${o.clause}: ${o.text}${o.evidence ? `\n   Required: ${o.evidence}.` : ''}\n   Position: ${oblState(o, m).txt}.`).join('\n')}\n\nThe Principal's rights under the Contract are reserved.\n` + sign();
}
export function letters() {
  const T = of('time').filter(t => t.agreedOn && !t.instructedOn), opt = [['period', 'Request the period claimed on notices with no days', letterPeriod()], ...T.map(t => ['ins' + t.id, `Instruction recording the agreed extension: ${t.ref}`, letterInstruction(t)]), ['vpr', 'Variation price responses overdue', letterVpr()], ['obl', 'Contract requirements not met by the Contractor', letterObl('Contractor')], ['chase', 'Chase list by consultant', chaseText()]];
  modal(`<h2>Letters from the register</h2><p class="muted small">Each is written from what the registers hold today. Read it, add what only you know, and have anything that reserves or asserts a right reviewed before it goes.</p>${opt.map(([k, l, t]) => `<div class="cprop" ${t ? `data-l="${k}"` : 'style="opacity:.5;cursor:default"'}><span><b>${esc(l)}</b><br><span class="muted small">${t ? 'Ready' : 'Nothing in the register calls for this today'}</span></span></div>`).join('')}<div class="act"><button id="ltX">Close</button></div>`, true);
  $('ltX').onclick = closeModal; document.querySelectorAll('[data-l]').forEach(x => x.onclick = () => { const o = opt.find(y => y[0] === x.dataset.l); outBox(o[1], o[2], 'A draft from the register. Check it before it is sent.'); });
}

/* ---------------------------------------------------------------- evidence pack for one notice or claim */
export function packHtml(t, internal) {
  const c = cfg(), con = concurrency(t), C = clocks(t), I = of('info').filter(i => cites(t.infoRefs, i.ref) || cites(i.timeRefs, t.ref)), P = progs(), b = P.find(p => p.baseline) || P[0], cur = P[P.length - 1];
  const acts = [...new Set(con.events.map(d => String(d.activity || '').toLowerCase()).filter(Boolean))], cmp = b && cur && b !== cur ? progCompare(b, cur).filter(r => acts.some(a => r.n.toLowerCase().includes(a))) : [], e = exposure(t);
  const row = (k, v) => v === '' || v == null ? '' : `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`, tb = (h, R) => R.length ? `<table><tr>${h.map(x => `<th>${esc(x)}</th>`).join('')}</tr>${R.map(r => `<tr>${r.map(x => `<td>${esc(x == null ? '' : x)}</td>`).join('')}</tr>`).join('')}</table>` : '<p>None recorded.</p>';
  return `<!doctype html><html lang="en-NZ"><head><meta charset="utf-8"><title>${esc(t.ref)} evidence pack</title><style>body{font:11pt/1.45 Arial,sans-serif;color:#18232f;max-width:900px;margin:24px auto;padding:0 18px}h1{font:700 18pt 'Times New Roman',serif;color:#011C35;border-bottom:2px solid #011C35;padding-bottom:6px}h2{font:700 13pt 'Times New Roman',serif;color:#011C35;margin-top:22px}table{border-collapse:collapse;width:100%;margin:6px 0 10px}th,td{border:1px solid #cfd6dd;padding:5px 8px;text-align:left;vertical-align:top;font-size:10pt}th{background:#eef2f5;white-space:nowrap}.k th{width:230px}.n{color:#6a7886;font-size:9.5pt}.w{border:1px solid #c44;background:#fdeeee;padding:8px 10px;font-weight:700}</style></head><body>
<h1>${esc(S.project.name)}: ${esc(t.ref)} ${esc(t.title)}</h1><p class="n">Evidence pack prepared ${esc(nzDate(today()))} by ${esc(c.ca || 'the Contract Administrator')} from the project record. ${esc(c.form)}.</p>
${internal ? '<p class="w">Internal: contains the Contract Administrator\'s assessment. Not for issue to the Contractor.</p>' : ''}
<h2>1. The notice or claim</h2><table class="k">${row('Type', t.type)}${row('Ground relied on', t.ground)}${row('Status', t.status)}${row('Contractor became aware', t.aware ? nzDate(t.aware) : 'Not recorded')}${row('Evidence for that date', t.awareNote)}${row('Written notice received', t.received ? nzDate(t.received) : 'None')}${row('Given to the Independent Certifier', t.received ? (t.toIC ? 'Yes' : 'Not recorded') : '')}${row('Working Days claimed', +t.daysClaimed > 0 ? t.daysClaimed : 'None stated')}${row('Applies to', t.sp)}</table>
<h2>2. Time limits</h2>${tb(['Clause', 'Position'], C.map(x => [x.clause, x.txt]))}<p class="n">Notice of the grounds is required within ${esc(c.noticeWD)} Working Days of the Contractor becoming aware (10.3.2(a))${c.noticeStrict ? ', and the special conditions make strict compliance a condition precedent' : ''}.${c.critPath ? ' No extension is available unless the delay affects the critical path.' : ''}</p>
<h2>3. Delay events on the record</h2>${tb(['Ref', 'Event', 'Cause', 'From', 'To', 'Activity', 'Evidence'], con.events.sort((x, y) => String(x.from).localeCompare(String(y.from))).map(d => [d.ref, d.title, d.cause, nzDate(d.from), d.to ? nzDate(d.to) : 'Running', (d.activity || '') + (d.critical === 'Yes' ? ' (critical)' : ''), d.evidence]))}
${con.events.length ? `<p>Working Days covered by events with a cause on the Principal's side or neutral: <b>${con.exc}</b>. Working Days covered by events with a cause on the Contractor's side: <b>${con.inexc}</b>. Working Days where both were running: <b>${con.both}</b>.</p>` : ''}
<h2>4. Information items</h2>${tb(['Ref', 'Subject', 'Held by', 'Raised', 'Required', 'Answered', 'Position'], I.map(i => { const s = infoState(i); return [i.ref, i.subject, i.owner, i.raised ? nzDate(i.raised) : '', needOf(i) ? nzDate(needOf(i)) : '', i.answered ? nzDate(i.answered) : '', s.open ? s.txt : (s.late ? `Closed ${s.late} WD late` : 'Closed')]; }))}
<h2>5. Programme</h2>${cmp.length ? `<p class="n">"${esc(b.name)}" (${esc(nzDate(b.issued))}) compared with "${esc(cur.name)}" (${esc(nzDate(cur.issued))}).</p>` + tb(['Activity', 'Finish was', 'Finish now', 'Moved (Working Days)', 'Critical'], cmp.map(r => [r.n, r.was ? nzDate(r.was) : 'New', nzDate(r.now), r.slip, r.crit ? 'Yes' : ''])) : '<p>No programme comparison is available for the activities named in the delay events.</p>'}
<h2>6. What the claim is worth if granted in full</h2><p>${e.days ? `${e.days} Working Days: ${money(e.ld)} of liquidated damages no longer recoverable${e.cost ? `, and ${money(e.cost)} of time-related Cost at the Working Day rate` : costGround(t) ? '' : '. This ground carries time only'}.` : 'No period has been claimed.'}</p>
${internal ? `<h2>7. Assessment (internal)</h2><table class="k">${row('Critical path', t.critical)}${row('Excusable delay (Working Days)', t.excDays)}${row('Concurrent inexcusable delay (Working Days)', t.inexcDays)}${row('Working Days assessed as fair', t.recDays)}${row('Mitigation by the Contractor', t.mitigation)}${row('Assessment and reasons', t.assessment)}${row('Notes', t.notes)}</table>` : ''}
</body></html>`;
}
export function packDialog(t) {
  modal(`<h2>Evidence pack: ${esc(t.ref)}</h2><p>One document from the record: the notice, the time limits, the delay events on both sides, the information items, the programme comparison and what the claim is worth.</p><p class="muted small">It opens in Word or a browser and prints to PDF.</p><div class="act"><button id="pkX">Cancel</button><button id="pkI">Internal, with my assessment</button><button class="go" id="pkE">For the Independent Certifier (record only)</button></div>`);
  const go = internal => { download(new Blob([packHtml(t, internal)], { type: 'application/msword' }), `${S.project.name} - ${t.ref} evidence pack${internal ? ' (internal)' : ''} - ${today()}.doc`); closeModal(); };
  $('pkX').onclick = closeModal; $('pkI').onclick = () => go(true); $('pkE').onclick = () => go(false);
}
