// Contract and communications: the contract administrator's own control layer for a project.
//   Time         notices of delay (NOD) and extension of time (EOT) claims, with the contract's Working Day clocks
//   Information  RFIs, consultant advice notes and design deliverables owed to the contractor, by who holds each
//   Decisions    client decisions, tracked from "awaiting decision" to "confirmed on site"
//   Actions      who owes what by when, reviewed meeting by meeting (PCG, client weekly, design and contractor)
//   Meetings     the three meeting series share the registers above; each meeting links to its recording (TicNote)
// Everything here is kept in the project's "contract" collection, which only project admins can read or write
// (see firestore.rules): assessment notes and positions must never reach the contractor or consultants.
import { S, can } from './state.js';
import { $, esc, toast, modal, closeModal, busy, confirmBox, uid, todayISO, nzDate, natural, download } from './util.js';
import { aiCall } from './ai.js';
import { addWD, wdBetween, REGIONS } from './workdays.js';
import * as X2 from './contract2.js';

export const COLL = 'contract', SET_ID = '_settings';
export const all = () => (S.fm && S.fm.contract) || [];
export const of = k => all().filter(x => x.kind === k);
// Defaults are the unamended NZS 3910:2023 periods. Each project confirms them against its own special conditions in Set-up.
export const DEF = {
  form: 'NZS 3910:2023', principal: '', contractor: '', ca: '', ic: '', designLead: '',
  noticeWD: 20, noticeStrict: false, detailsChaseWD: 20, instructWD: 10, icWD: 20, vprWD: 10, rfiWD: 5, stuckWD: 5,
  critPath: false, concurrent: false, weatherNote: '', ldRate: 0, timeRate: 0, due: '',
  wxRain: 13, wxStation: '', region: 'Auckland / Northland', extra: '', series: 'PCG, Client weekly, Design and contractor', mailTag: '', notes: '',
};
export const cfg = () => ({ ...DEF, ...(all().find(x => x.id === SET_ID) || {}) });
export const wdc = () => { const c = cfg(); return { region: c.region, extra: String(c.extra || '').split(/[,\s]+/).filter(Boolean) }; };
export const seriesList = () => String(cfg().series || DEF.series).split(',').map(s => s.trim()).filter(Boolean);
export const plus = (iso, n) => addWD(iso, n, wdc()), gap = (a, b) => wdBetween(a, b, wdc());
export const W = n => `${n} Working Day${Math.abs(n) === 1 ? '' : 's'}`;
export const money = n => '$' + Math.round(+n || 0).toLocaleString('en-NZ');
export const save = o => S.store.saveItem(S.project.id, COLL, { ...o, updated: new Date().toISOString(), updatedBy: S.user.email });
export const nextRef = (kind, prefix) => { let k = 0; of(kind).forEach(x => { const m = new RegExp('^' + prefix + '[\\s#-]*(\\d+)$', 'i').exec(x.ref || ''); if (m) k = Math.max(k, +m[1]); }); return prefix + '-' + String(k + 1).padStart(2, '0'); };

/* ---------------------------------------------------------------- time: NODs and EOT claims */
export const GROUNDS = ['(a) Net effect of a Variation', '(b) Weather', '(c) Strike, lockout or industrial action', '(d) Loss or damage to the Contract Works or Materials', '(e) Flood, volcanic or seismic event', '(f) Circumstances not reasonably foreseeable', '(g) Default by the Principal (not a Variation)', 'Not stated'];
export const TIME_TYPES = ['Raised in a meeting (no notice)', 'NOD (notice of delay)', 'EOT claim'];
export const TIME_ST = ['Raised, no notice', 'Notice only', 'Period claimed', 'In discussion', 'Agreed', 'Instructed', 'Referred to Independent Certifier', 'Decided by Independent Certifier', 'Declined', 'Closed, no claim'];
const TIME_DONE = ['Instructed', 'Decided by Independent Certifier', 'Declined', 'Closed, no claim'];
export const timeLive = t => !TIME_DONE.includes(t.status);
export const costGround = t => /^\((a|g)\)/.test(t.ground || '');
// The clocks that apply to one time item, as { txt, due, left, cls, clause, mine }. "left" is Working Days from today (negative = past).
export function clocks(t, today = todayISO()) {
  const c = cfg(), out = [], live = timeLive(t), strict = c.noticeStrict ? ' Strict compliance is a condition precedent under the special conditions.' : '';
  if (t.aware) {
    const limit = plus(t.aware, c.noticeWD);
    if (t.received) { const n = gap(t.aware, t.received), ok = n <= c.noticeWD;
      out.push({ k: 'notice', txt: ok ? `Notice given ${W(n)} after the Contractor became aware (limit ${c.noticeWD}).` : `Notice given ${W(n)} after the Contractor became aware: ${W(n - c.noticeWD)} outside the ${c.noticeWD} Working Day limit.${strict}`, cls: ok ? 'ok' : 'bad', clause: '10.3.2(a)' }); }
    else if (live) { const left = gap(today, limit);
      out.push({ k: 'notice', txt: left >= 0 ? `No notice yet. The Contractor has until ${nzDate(limit)} to give notice (${W(left)} left).` : `No notice received. The ${c.noticeWD} Working Day period ended ${nzDate(limit)}.${strict}`, due: limit, left, cls: left < 0 ? 'bad' : left <= 5 ? 'warn' : 'info', clause: '10.3.2(a)' }); }
  } else if (live) out.push({ k: 'notice', txt: 'The date the Contractor became aware is not recorded, so the notice period cannot be tested. Record it from the minutes or correspondence.', cls: 'warn', clause: '10.3.2(a)', mine: true });
  if (live && t.received && !(+t.daysClaimed > 0)) { const age = gap(t.received, today);
    out.push({ k: 'details', txt: `Notice only: no period of extension claimed, ${age} Working Days after the notice. Details are due within a reasonable time.`, cls: age > c.detailsChaseWD ? 'warn' : 'info', clause: '10.3.2(b)' }); }
  if (t.agreedOn && !t.instructedOn) { const due = plus(t.agreedOn, c.instructWD), left = gap(today, due);
    out.push({ k: 'instruct', txt: `Agreed ${nzDate(t.agreedOn)}. Your Instruction is due by ${nzDate(due)} (${left} Working Days ${left < 0 ? 'overdue' : 'left'}).`.replace('(-', '('), due, left, cls: left < 0 ? 'bad' : left <= 3 ? 'warn' : 'info', clause: '10.3.4', mine: true }); }
  if (t.icRequested && !t.icDecided) { const due = plus(t.icRequested, c.icWD), left = gap(today, due);
    out.push({ k: 'ic', txt: `Referred to the Independent Certifier ${nzDate(t.icRequested)}. Decision due by ${nzDate(due)} or as soon as practicable after (${Math.abs(left)} Working Days ${left < 0 ? 'past' : 'left'}).`, due, left, cls: left < 0 ? 'warn' : 'info', clause: '10.3.5' }); }
  return out;
}
// What a claim is worth if granted in full: relief from liquidated damages, plus time-related cost where the ground carries cost.
export function exposure(t) { const c = cfg(), d = +t.daysClaimed || 0; return { days: d, ld: d * (+c.ldRate || 0), cost: costGround(t) ? d * (+c.timeRate || 0) : 0 }; }

/* ---------------------------------------------------------------- information owed */
export const INFO_TYPES = ['RFI', 'CAN (consultant advice note)', 'Shop drawing review', 'Design deliverable', 'Other'];
export const infoOpen = i => !/^closed/i.test(i.status || '');
// RFIs, shop drawing reviews and deliverables are owed to the contractor and carry a date. Advice notes are information already issued.
export const isOwed = i => /^RFI|^Shop|^Design/.test(i.type || 'RFI');
const owedOpen = i => infoOpen(i) && isOwed(i);
// The date that matters is the contractor's need date; where that has not been set, the response due date stands in for it.
export const needOf = i => i.needBy || i.due || '';
export function infoState(i, today = todayISO()) {
  if (!infoOpen(i)) { const known = !!(i.answered && needOf(i)), late = known ? gap(needOf(i), i.answered) : 0; return { open: false, known, late: late > 0 ? late : 0 }; }
  if (!isOwed(i)) return { open: true, left: null, cls: 'grey', txt: 'Issued' };
  const n = needOf(i); if (!n) return { open: true, left: null, cls: 'grey', txt: 'No date required' };
  const left = gap(today, n); return { open: true, left, cls: left < 0 ? 'bad' : left <= 3 ? 'warn' : 'ok', txt: left < 0 ? `${-left} WD late` : left === 0 ? 'Due today' : `${left} WD left` };
}
export function scorecard(list = of('info')) {
  const by = {}; list.filter(isOwed).forEach(i => { const k = i.owner || 'Not assigned', s = infoState(i), o = by[k] = by[k] || { owner: k, open: 0, late: 0, lateWD: 0, closed: 0, onTime: 0, worst: 0 };
    if (s.open) { o.open++; if (s.left < 0) { o.late++; o.lateWD += -s.left; o.worst = Math.max(o.worst, -s.left); } } else if (s.known) { o.closed++; if (!s.late) o.onTime++; } });
  return Object.values(by).sort((a, b) => b.late - a.late || b.open - a.open);
}

/* ---------------------------------------------------------------- decisions and actions */
export const STAGES = ['Awaiting decision', 'Decided', 'Documented', 'Priced', 'Instructed', 'Confirmed on site'];
export const decOpen = d => d.stage !== 'Confirmed on site' && d.stage !== 'Not proceeding';
const stageAge = d => d.stageOn ? gap(d.stageOn, todayISO()) : null;
export const ACT_ST = ['Open', 'In progress', 'Blocked', 'Done', 'Closed'];
export const actOpen = a => a.status !== 'Done' && a.status !== 'Closed';
export const overdue = x => !!(x.due && x.due < todayISO());

/* ---------------------------------------------------------------- the screen */
let TAB = 'now';
export const F = { q: '', show: 'open', owner: '', series: '' };
// Four groups, with This week as the front page. Each group keeps its own last-opened tab.
const GROUPS = [['now', 'This week', ['now']], ['g-time', 'Time', ['time', 'delay', 'prog', 'wx']], ['g-info', 'Information and variations', ['info', 'vpr']], ['g-dec', 'Decisions and actions', ['dec', 'act', 'mtg']], ['g-con', 'Contract', ['obl', 'in', 'set']]];
const TABS = [['now', 'This week'], ['time', 'Notices and claims'], ['delay', 'Delay events'], ['prog', 'Programme'], ['wx', 'Weather'], ['info', 'Information (RFIs)'], ['vpr', 'Variations'], ['dec', 'Decisions'], ['act', 'Actions'], ['mtg', 'Meetings'], ['obl', 'Obligations'], ['in', 'Intake'], ['set', 'Set-up']];
const LAST = {};
export const groupOf = t => GROUPS.find(g => g[2].includes(t)) || GROUPS[0];
export const safeUrl = u => /^https?:\/\//i.test(u || '') ? u : '';
export const st = (txt, cls) => `<span class="st st-${cls}">${esc(txt)}</span>`;
export const goTab = t => { TAB = t; view(); };
export function view() {
  if (!can.admin()) { $('fmView').innerHTML = '<div class="empty2">This section is for the contract administrator only.</div>'; return; }
  const n = { time: of('time').filter(timeLive).length, info: of('info').filter(i => owedOpen(i) && infoState(i).left < 0).length, dec: of('decision').filter(decOpen).length, act: of('action').filter(actOpen).length, vpr: of('vpr').filter(X2.vprLive).length, obl: of('obl').filter(o => X2.oblState(o).bad).length };
  n.in = X2.inboxCount(); const G = groupOf(TAB), lab = k => (TABS.find(x => x[0] === k) || [k, k])[1], sum = g => g[2].reduce((a, k) => a + (n[k] || 0), 0); LAST[G[0]] = TAB;
  $('fmView').innerHTML = `<div class="fbar"><h2>Contract</h2><div class="ctabs cgroups">${GROUPS.map(g => `<button data-g="${g[0]}" class="${G === g ? 'on' : ''}">${g[1]}${sum(g) ? ` <b>${sum(g)}</b>` : ''}</button>`).join('')}</div></div>
    ${G[2].length > 1 ? `<div class="ctabs csub">${G[2].map(k => `<button data-t="${k}" class="${TAB === k ? 'on' : ''}">${lab(k)}${n[k] ? ` <b>${n[k]}</b>` : ''}</button>`).join('')}</div>` : ''}
    <p class="muted small cnote">Visible to project admins only. Nothing here is shown to the contractor, consultants or the client.</p><div id="cBody"></div>`;
  document.querySelectorAll('.cgroups button').forEach(b => b.onclick = () => { const g = GROUPS.find(x => x[0] === b.dataset.g); TAB = LAST[g[0]] || g[2][0]; F.q = ''; F.owner = ''; view(); });
  document.querySelectorAll('.csub button').forEach(b => b.onclick = () => { TAB = b.dataset.t; F.q = ''; F.owner = ''; view(); });
  ({ now, time: timeView, info: infoView, dec: decView, act: actView, mtg: mtgView, set: setView, delay: X2.delayView, prog: X2.progView, wx: X2.wxView, vpr: X2.vprView, obl: X2.oblView, in: X2.intakeView })[TAB]();
}
export const body = html => { $('cBody').innerHTML = html; };
export const rowClick = (sel, fn) => document.querySelectorAll(sel).forEach(r => r.onclick = e => { if (e.target.closest('button,a,select,input')) return; fn(all().find(x => x.id === r.dataset.id)); });

/* --- This week: everything with a date on it, most urgent first --- */
function running() {
  const R = [], today = todayISO();
  of('time').forEach(t => clocks(t).filter(c => c.cls === 'bad' || c.cls === 'warn' || c.due).forEach(c => R.push({ id: t.id, what: `${t.ref} ${t.title}`, txt: c.txt, due: c.due || '', cls: c.cls, who: c.mine ? 'You' : c.k === 'ic' ? 'Independent Certifier' : 'Contractor', tab: 'time' })));
  of('info').filter(infoOpen).forEach(i => { const s = infoState(i); if (s.left != null && s.left <= 3) R.push({ id: i.id, what: `${i.ref} ${i.subject}`, txt: `${s.txt}. Needed ${nzDate(needOf(i))}.`, due: needOf(i), cls: s.cls, who: i.person || i.owner || '', tab: 'info' }); });
  of('decision').filter(decOpen).forEach(d => { const a = stageAge(d), late = overdue(d); if (late || (a != null && a > cfg().stuckWD)) R.push({ id: d.id, what: `${d.ref} ${d.text}`, txt: `${d.stage}${a != null ? ' for ' + a + ' Working Days' : ''}${d.due ? '. Next step due ' + nzDate(d.due) : ''}.`, due: d.due || '', cls: late ? 'bad' : 'warn', who: d.owner || '', tab: 'dec' }); });
  of('action').filter(a => actOpen(a) && a.due && gap(today, a.due) <= 3).forEach(a => R.push({ id: a.id, what: `${a.ref} ${a.text}`, txt: a.due < today ? `Overdue since ${nzDate(a.due)}.` : `Due ${nzDate(a.due)}.`, due: a.due, cls: a.due < today ? 'bad' : 'warn', who: a.owner || '', tab: 'act' }));
  X2.extraRunning(R);
  const rank = { bad: 0, warn: 1, info: 2, ok: 3 }, first = r => r.tab === 'time' ? 0 : 1;   // notices and claims lead: their dates cannot be recovered later
  return R.sort((a, b) => first(a) - first(b) || rank[a.cls] - rank[b.cls] || String(a.due || '9').localeCompare(String(b.due || '9')));
}
function now() {
  const c = cfg(), T = of('time').filter(timeLive), ex = T.reduce((s, t) => { const e = exposure(t); return { days: s.days + e.days, ld: s.ld + e.ld, cost: s.cost + e.cost }; }, { days: 0, ld: 0, cost: 0 });
  const I = of('info').filter(owedOpen), late = I.filter(i => infoState(i).left < 0), D = of('decision').filter(decOpen), A = of('action').filter(actOpen), R = running(), unq = T.filter(t => t.received && !(+t.daysClaimed > 0)).length;
  const k = (b, s, t) => `<div class="kpi" data-go="${t}"><span>${s}</span><b>${b}</b></div>`;
  body(`${all().length <= 1 && !c.contractor ? '<div class="empty2" style="margin-bottom:12px"><b>Start in Set-up.</b> Enter the contract periods and rates, then bring in the RFI register and the PCG data file from the Information and Actions tabs.</div>' : ''}
    <div class="kpis">${k(T.length, `Live notices and claims${unq ? ` · ${unq} with no period claimed` : ''}`, 'time')}${k(ex.days ? ex.days + ' WD' : 'None', `Working Days claimed${ex.days ? ` · ${money(ex.ld)} LD relief · ${money(ex.cost)} time cost` : ''}`, 'time')}${k(`${late.length} of ${I.length}`, 'Open information items past the date required', 'info')}${k(D.filter(d => d.stage === 'Awaiting decision').length, 'Matters awaiting a decision', 'dec')}${k(D.filter(d => d.stage !== 'Awaiting decision').length, 'Decisions made, not yet confirmed on site', 'dec')}${k(`${A.filter(overdue).length} of ${A.length}`, 'Open actions overdue', 'act')}</div>
    <div class="fbar"><h2 style="font-size:15px">Needs attention</h2><span style="flex:1"></span><button class="btn2 go" id="cBrief">Weekly client update</button><button class="btn2" id="cLet">Letters</button><button class="btn2" id="cChase">Chase list by consultant</button><button class="btn2" id="cPcg">PCG report section</button></div>
    ${R.length ? `<table class="ftable"><tr><th>Item</th><th>Position</th><th class="hm">With</th><th>Date</th></tr>${R.slice(0, F.allNow ? 200 : 12).map(r => `<tr class="click" data-id="${esc(r.id)}" data-tab="${r.tab}"><td><b>${esc(r.what.slice(0, 90))}</b></td><td>${st(r.cls === 'bad' ? 'Overdue' : r.cls === 'warn' ? 'Watch' : 'Running', r.cls)} ${esc(r.txt)}</td><td class="hm">${esc(r.who)}</td><td>${r.due ? esc(nzDate(r.due)) : ''}</td></tr>`).join('')}</table>${R.length > 12 ? `<p class="small"><a href="#" id="cMore">${F.allNow ? 'Show the first 12 only' : `Show all ${R.length}`}</a></p>` : ''}` : '<div class="empty2">Nothing is overdue or due within three Working Days.</div>'}`);
  document.querySelectorAll('.kpi[data-go]').forEach(x => x.onclick = () => { TAB = x.dataset.go; view(); });
  document.querySelectorAll('#cBody tr[data-id]').forEach(r => r.onclick = () => openItem(all().find(x => x.id === r.dataset.id)));
  if ($('cMore')) $('cMore').onclick = e => { e.preventDefault(); F.allNow = !F.allNow; view(); };
  X2.inboxNote();
  $('cLet').onclick = () => X2.letters();
  $('cBrief').onclick = () => outBox('Weekly client update', briefText(), 'Plain wording for the client. It carries no assessment notes. Check it, then copy it into your email.');
  $('cChase').onclick = () => outBox('Chase list by consultant', chaseText(), 'One block for each company holding open information, oldest need date first.');
  $('cPcg').onclick = () => outBox('PCG report: time and information', pcgText(), 'For the programme and design sections of the PCG report.');
}
export const openItem = x => x && ({ time: editTime, info: editInfo, decision: editDec, action: editAct, meeting: runMeeting, delay: X2.editDelay, vpr: X2.editVpr, obl: X2.editObl })[x.kind]?.(x);

/* --- a small form builder so each editor is a list of fields --- */
export function form(spec, o) {
  return `<div class="grid">${spec.map(f => { const v = o[f.k] == null ? '' : o[f.k], id = 'cf_' + f.k, cl = `f${f.full ? ' full' : ''}`;
    if (f.h) return `<h3 class="sec full" style="grid-column:1/-1">${esc(f.h)}</h3>`;
    if (f.t === 'ta') return `<label class="${cl} full">${esc(f.l)}<textarea id="${id}" rows="${f.rows || 3}">${esc(v)}</textarea></label>`;
    if (f.t === 'sel') return `<label class="${cl}">${esc(f.l)}<select id="${id}">${f.blank ? '<option value=""></option>' : ''}${f.L.map(x => `<option ${x === v ? 'selected' : ''}>${esc(x)}</option>`).join('')}${v && !f.L.includes(v) ? `<option selected>${esc(v)}</option>` : ''}</select></label>`;
    if (f.t === 'chk') return `<label class="${cl} cchk"><input type="checkbox" id="${id}" ${v ? 'checked' : ''}> ${esc(f.l)}</label>`;
    return `<label class="${cl}">${esc(f.l)}<input id="${id}" type="${f.t === 'date' ? 'date' : f.t === 'num' ? 'number' : f.t === 'url' ? 'url' : 'text'}" value="${esc(v)}" ${f.ph ? `placeholder="${esc(f.ph)}"` : ''}></label>`; }).join('')}</div>`;
}
export const read = spec => { const o = {}; spec.forEach(f => { if (f.h) return; const e = $('cf_' + f.k); o[f.k] = f.t === 'chk' ? e.checked : f.t === 'num' ? (e.value === '' ? '' : +e.value) : e.value.trim(); }); return o; };
export function editor(title, spec, o, isNew, extra, onSave, kindLabel) {
  modal(`<h2>${esc(title)}</h2>${extra || ''}${form(spec, o)}<div class="act">${isNew ? '' : '<button id="cfDel" class="warn">Delete</button>'}<button id="cfX">Cancel</button><button id="cfOk" class="go">Save</button></div>`, true);
  $('cfX').onclick = closeModal;
  $('cfOk').onclick = async () => { const n = onSave({ ...o, ...read(spec) }); if (!n) return; try { await save(n); closeModal(); toast((n.ref || kindLabel) + ' saved'); } catch (e) { toast('Could not save: ' + e.message, 6000); } };
  if ($('cfDel')) $('cfDel').onclick = async () => { if (!(await confirmBox(`Delete ${o.ref || 'this ' + kindLabel}? This cannot be undone.`, 'Delete'))) return; await S.store.deleteItem(S.project.id, COLL, o.id); closeModal(); };
}

/* --- Time --- */
function timeView() {
  const c = cfg(), L = of('time').filter(t => F.show === 'all' || timeLive(t)).sort((a, b) => natural(a.ref || '', b.ref || ''));
  body(`<div class="fbar"><select id="cShow"><option value="open">Live</option><option value="all" ${F.show === 'all' ? 'selected' : ''}>All</option></select><span style="flex:1"></span><button class="btn2 go" id="cNew">+ Notice or claim</button></div>
    <p class="muted small">${esc(c.form)}: notice within ${c.noticeWD} Working Days of the Contractor becoming aware (10.3.2(a))${c.noticeStrict ? ', a condition precedent under the special conditions' : ''}; period by agreement with the Contract Administrator, Instruction within ${c.instructWD} Working Days of agreement (10.3.4); failing agreement the Independent Certifier Decides within ${c.icWD} Working Days of a request (10.3.5).${c.critPath ? ' No extension unless the delay affects the critical path.' : ''}</p>
    ${L.length ? `<table class="ftable"><tr><th>Ref</th><th>Matter</th><th>Status</th><th>Days</th><th>Clocks</th></tr>${L.map(t => { const C = clocks(t), e = exposure(t);
      return `<tr class="click" data-id="${esc(t.id)}"><td><b>${esc(t.ref || '')}</b><br><span class="muted small">${esc((t.type || '').replace(/ \(.*/, ''))}</span></td><td>${esc(t.title || '')}<br><span class="muted small">${esc(t.ground || '')}${t.aware ? ' · aware ' + esc(nzDate(t.aware)) : ''}${t.received ? ' · notice ' + esc(nzDate(t.received)) : ''}</span></td><td>${st(t.status || '', TIME_DONE.includes(t.status) ? 'grey' : 'info')}</td><td>${e.days ? `<b>${e.days}</b> claimed` : '<span class="muted">None claimed</span>'}${t.recDays !== '' && t.recDays != null ? `<br><span class="muted small">${esc(t.recDays)} assessed</span>` : ''}</td><td>${C.map(x => `<div class="cclk">${st(x.clause, x.cls)} ${esc(x.txt)}</div>`).join('') || '<span class="muted">None running</span>'}</td></tr>`; }).join('')}</table>`
    : '<div class="empty2">No notices or claims recorded. Add each one the day it is raised or received: the dates entered here are your record if a claim follows.</div>'}`);
  $('cShow').onchange = e => { F.show = e.target.value; view(); }; $('cNew').onclick = () => editTime(null); rowClick('#cBody tr[data-id]', editTime);
}
function editTime(t) {
  const isNew = !t, c = cfg(); t = t ? { ...t } : { id: uid(), kind: 'time', ref: '', type: TIME_TYPES[1], title: '', ground: 'Not stated', status: 'Notice only', toIC: false };
  const spec = [{ k: 'ref', l: 'Ref', ph: 'NOD #8 or EOT-01' }, { k: 'type', l: 'Type', t: 'sel', L: TIME_TYPES }, { k: 'title', l: 'Matter', full: true }, { k: 'ground', l: 'Ground relied on (10.3.1)', t: 'sel', L: GROUNDS }, { k: 'status', l: 'Status', t: 'sel', L: TIME_ST },
    { h: 'Dates' }, { k: 'aware', l: 'Contractor became aware', t: 'date' }, { k: 'awareNote', l: 'Evidence for that date (minute, email, RFI)' }, { k: 'received', l: 'Written notice received', t: 'date' }, { k: 'toIC', l: 'Notice also given to the Independent Certifier', t: 'chk' }, { k: 'daysClaimed', l: 'Working Days claimed', t: 'num' }, { k: 'detailsOn', l: 'Period claimed on', t: 'date' },
    { h: 'Your assessment (never shown outside this section)' }, { k: 'critical', l: 'Critical path', t: 'sel', L: ['Not yet shown', 'Shown on the programme', 'Not on the critical path'], blank: true }, { k: 'sp', l: 'Applies to', ph: 'Contract Works or a Separable Portion' }, { k: 'excDays', l: 'Excusable delay (Working Days)', t: 'num' }, { k: 'inexcDays', l: 'Concurrent inexcusable delay (Working Days)', t: 'num' }, { k: 'recDays', l: 'Working Days you assess as fair', t: 'num' }, { k: 'infoRefs', l: 'Information items relied on (refs)', ph: 'RFI 74, CAN071' }, { k: 'mitigation', l: 'Mitigation by the Contractor', t: 'ta', rows: 2 }, { k: 'assessment', l: 'Assessment and reasons', t: 'ta', rows: 4 },
    { h: 'Outcome' }, { k: 'agreedOn', l: 'Agreed with the Contractor on', t: 'date' }, { k: 'instructedOn', l: 'Instruction issued on', t: 'date' }, { k: 'icRequested', l: 'Independent Certifier asked to Decide on', t: 'date' }, { k: 'icDecided', l: 'Decision received on', t: 'date' }, { k: 'grantedDays', l: 'Working Days granted', t: 'num' }, { k: 'notes', l: 'Notes', t: 'ta', rows: 2 }];
  const C = isNew ? [] : clocks(t), e = exposure(t), cc = c.concurrent && costGround(t) && t.excDays !== '' && t.excDays != null ? Math.max(0, (+t.excDays || 0) - (+t.inexcDays || 0)) : null;
  const top = isNew ? '' : `<div class="cbox">${C.map(x => `<div class="cclk">${st(x.clause, x.cls)} ${esc(x.txt)}</div>`).join('')}${e.days ? `<div class="cclk">${st('Exposure', 'grey')} ${e.days} Working Days claimed: ${money(e.ld)} of liquidated damages relief${e.cost ? ` and ${money(e.cost)} of time-related cost at the agreed Working Day rate` : costGround(t) ? '' : '. This ground carries time only, no time-related cost (10.3.7)'}.</div>` : ''}${cc != null ? `<div class="cclk">${st('10.3.9', 'grey')} Concurrent delay: time for the whole excusable period (${t.excDays} Working Days); time-related cost for ${cc} Working Days only.</div>` : ''}${X2.concHtml(t)}<div class="cclk" style="margin-top:6px"><button class="btn2 sm" id="tPack">Evidence pack</button> <button class="btn2 sm" id="tLog">+ Delay event for this claim</button></div></div>`;
  editor(isNew ? 'New notice or claim' : `${t.ref} ${t.title}`, spec, t, isNew, top, n => { if (!n.title) { toast('Say what the matter is'); return null; } if (!n.ref) n.ref = nextRef('time', /EOT/.test(n.type) ? 'EOT' : 'NOD'); return n; }, 'item');
  if ($('tPack')) { $('tPack').onclick = () => X2.packDialog(t); $('tLog').onclick = () => { closeModal(); X2.editDelay(null, { timeRefs: t.ref }); }; }
}

/* --- Information --- */
function infoView() {
  const A = of('info'), owners = [...new Set(A.map(i => i.owner).filter(Boolean))].sort(), q = F.q.toLowerCase();
  const L = A.filter(i => (F.show === 'all' || infoOpen(i)) && (!F.owner || i.owner === F.owner) && (!q || [i.ref, i.subject, i.owner, i.person].join(' ').toLowerCase().includes(q)))
    .sort((a, b) => (infoOpen(b) - infoOpen(a)) || (isOwed(b) - isOwed(a)) || String(needOf(a) || '9').localeCompare(String(needOf(b) || '9')));
  const SC = scorecard(A).filter(s => s.open);
  body(`<div class="fbar"><input type="search" id="cQ" placeholder="Search information…" value="${esc(F.q)}"><select id="cShow"><option value="open">Open</option><option value="all" ${F.show === 'all' ? 'selected' : ''}>All</option></select><select id="cOwn"><option value="">Everyone</option>${owners.map(o => `<option ${F.owner === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>
    <button class="btn2 go" id="cNew">+ Item</button><button class="btn2" id="cImp">⬆ Procore RFI, Correspondence or Submittals export (CSV)</button><input type="file" id="cFile" accept=".csv" multiple hidden></div>
    ${SC.length ? `<table class="ftable cscore"><tr><th>Held by</th><th>Open</th><th>Past date required</th><th>Worst</th><th class="hm">Closed on time</th></tr>${SC.map(s => `<tr class="click" data-own="${esc(s.owner)}"><td><b>${esc(s.owner)}</b></td><td>${s.open}</td><td>${s.late ? st(s.late + ' late', 'bad') : st('None', 'ok')}</td><td>${s.worst ? s.worst + ' WD' : ''}</td><td class="hm">${s.closed ? Math.round(100 * s.onTime / s.closed) + '% of ' + s.closed : ''}</td></tr>`).join('')}</table>` : ''}
    <p class="muted small">${L.length} shown. "Date required" is the contractor's need date where you have set one, otherwise the response due date from Procore. Set the need date on any item the programme depends on.</p>
    ${L.length ? `<table class="ftable"><tr><th>Ref</th><th>Subject</th><th>Held by</th><th class="hm">Raised</th><th>Required</th><th>Position</th></tr>${L.slice(0, 300).map(i => { const s = infoState(i);
      return `<tr class="click" data-id="${esc(i.id)}"><td><b>${esc(i.ref || '')}</b></td><td>${esc(i.subject || '')}${i.timeRefs ? `<br><span class="muted small">Cited in ${esc(i.timeRefs)}</span>` : ''}</td><td>${esc(i.owner || '')}${i.person ? `<br><span class="muted small">${esc(i.person)}</span>` : ''}</td><td class="hm">${i.raised ? esc(nzDate(i.raised)) : ''}</td><td>${needOf(i) ? esc(nzDate(needOf(i))) : ''}${i.needBy ? ' <span class="muted small">need</span>' : ''}</td><td>${s.open && i.closeNote ? st(i.closeNote, /closed$|revision$/.test(i.closeNote) ? 'info' : 'warn') + '<br>' : ''}${s.open ? st(s.txt, s.cls) : st(s.late ? `Closed ${s.late} WD late` : 'Closed', s.late ? 'warn' : 'grey')}</td></tr>`; }).join('')}</table>`
    : `<div class="empty2">${A.length ? 'Nothing matches.' : 'No information items yet. In Procore, export the RFI list and the Correspondence list as CSV and bring both in here. Bringing in a newer export updates the same items and keeps your need dates and notes.'}</div>`}`);
  $('cQ').oninput = e => { F.q = e.target.value; infoView(); $('cQ').focus(); $('cQ').setSelectionRange(F.q.length, F.q.length); };
  $('cShow').onchange = e => { F.show = e.target.value; view(); }; $('cOwn').onchange = e => { F.owner = e.target.value; view(); };
  document.querySelectorAll('.cscore tr[data-own]').forEach(r => r.onclick = () => { F.owner = F.owner === r.dataset.own ? '' : r.dataset.own; view(); });
  $('cNew').onclick = () => editInfo(null); rowClick('#cBody tr[data-id]', editInfo);
  $('cImp').onclick = () => $('cFile').click(); $('cFile').onchange = async e => { const fs = [...e.target.files]; e.target.value = ''; for (const f of fs) await importProcore(f); };
}
function editInfo(i) {
  const isNew = !i; i = i ? { ...i } : { id: uid(), kind: 'info', type: 'Design deliverable', status: 'Open', raised: todayISO() };
  const spec = [{ k: 'ref', l: 'Ref' }, { k: 'type', l: 'Type', t: 'sel', L: INFO_TYPES }, { k: 'subject', l: 'Subject', full: true }, { k: 'owner', l: 'Held by (company)' }, { k: 'person', l: 'Person' }, { k: 'raised', l: 'Raised', t: 'date' }, { k: 'due', l: 'Response due', t: 'date' }, { k: 'needBy', l: "Contractor's need date (programme)", t: 'date' }, { k: 'promised', l: 'Date promised', t: 'date' }, { k: 'status', l: 'Status', t: 'sel', L: ['Open', 'Draft', 'Closed'] }, { k: 'answered', l: 'Answered or closed on', t: 'date' }, { k: 'timeRefs', l: 'Cited in notice or claim (refs)', ph: 'NOD #7' }, { k: 'impact', l: 'Programme consequence if late', full: true }, { k: 'notes', l: 'Notes', t: 'ta', rows: 2 }];
  editor(isNew ? 'New information item' : `${i.ref} ${i.subject}`, spec, i, isNew, i.reviews ? `<p class="small"><b>Reviewers:</b> ${esc(i.reviews)}</p>${i.closeNote ? `<p class="small">${st(i.closeNote, 'info')}</p>` : ''}` : '', n => { if (!n.subject) { toast('Give it a subject'); return null; } if (!n.ref) n.ref = nextRef('info', 'INF'); if (n.status === 'Closed' && !n.answered) n.answered = todayISO(); return n; }, 'item');
}
// dates as Procore writes them: 8/10/2026, 15/10/26, "25/11/26 at 08:00 pm", "30 Sep 2026"
export function dateOf(v) {
  const s = String(v || '').trim(); let m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(s); if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); if (m) return m[0];
  m = /^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/.exec(s); if (m) { const k = 'janfebmaraprmayjunjulaugsepoctnovdec'.indexOf(m[2].toLowerCase()); if (k >= 0 && k % 3 === 0) return `${m[3]}-${String(k / 3 + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  return '';
}
export function csvRows(text) {
  const rows = []; let r = [], c = '', q = false; text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) { const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { c += '"'; i++; } else q = false; } else c += ch; }
    else if (ch === '"') q = true; else if (ch === ',') { r.push(c); c = ''; } else if (ch === '\n') { r.push(c); rows.push(r); r = []; c = ''; } else if (ch !== '\r') c += ch; }
  if (c || r.length) { r.push(c); rows.push(r); } return rows.filter(x => x.some(y => String(y).trim()));
}
// "Ross, Tony (Company)" or "Tony Ross (Company)" -> { person, co }
const plain = v => String(v == null ? '' : v).replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
export function who(v) { const s = plain(v).split(/\n|\||;/)[0].trim(), m = /^(.*?)\s*\(([^)]*)\)?\s*$/.exec(s), n = (m ? m[1] : s).trim(), p = /^([^,]+),\s*(.+)$/.exec(n); return { person: p ? `${p[2]} ${p[1]}` : n, co: m ? m[2].trim() : '' }; }
// Turn a Procore export into information items. Returns [] when the columns are not recognised.
export function procoreItems(text) {
  const R = csvRows(text); if (!R.length) return []; const h = R[0].map(x => String(x).trim().toLowerCase()), col = n => h.indexOf(n), g = (r, n) => { const k = col(n); return k < 0 ? '' : plain(r[k]); };
  if (col('rfi manager') >= 0 && col('number') >= 0) return R.slice(1).filter(r => g(r, 'number')).map(r => { const a = who(g(r, 'assigned id') || g(r, 'assignee')), by = who(g(r, 'created by'));
    return { id: 'rfi-' + g(r, 'number').replace(/\W+/g, '_'), kind: 'info', type: 'RFI', ref: 'RFI ' + g(r, 'number'), subject: g(r, 'subject'), status: /^closed/i.test(g(r, 'status')) ? 'Closed' : g(r, 'status') || 'Open', owner: a.co || a.person, person: a.co ? a.person : '', raised: dateOf(g(r, 'initiated at') || g(r, 'date initiated')), due: dateOf(g(r, 'due date')), answered: dateOf(g(r, 'closed date')), raisedBy: by.person, progImpact: g(r, 'program impact'), src: 'Procore' }; });
  if (col('submittal number') >= 0) return submittalItems(R, g, col);
  if (col('type') >= 0 && col('issued on') >= 0) return R.slice(1).filter(r => g(r, 'number')).map(r => { const by = who(g(r, 'created by')), can0 = /advi[cs]e note/i.test(g(r, 'type'));
    return { id: 'cor-' + g(r, 'number').replace(/\W+/g, '_'), kind: 'info', type: can0 ? INFO_TYPES[1] : 'Other', ref: g(r, 'number').replace(/^CA-WA-/, ''), subject: g(r, 'subject'), status: /^closed/i.test(g(r, 'status')) ? 'Closed' : 'Open', owner: by.co || by.person, person: by.co ? by.person : '', raised: dateOf(g(r, 'issued on')), due: dateOf(g(r, 'due date')), assignees: g(r, 'assignees'), src: 'Procore' }; });
  return [];
}
// Procore submittals: one item per revision, held by whoever the workflow is waiting on.
// A revision is flagged closeable when a later revision replaces it, or when every reviewer has responded.
function submittalItems(R, g, col) {
  const lines = v => String(v || '').split('\n').map(x => x.trim());
  const L = R.slice(1).filter(r => g(r, 'submittal number')).map(r => {
    const num = g(r, 'submittal number'), rev = g(r, 'rev.'), ap = lines(g(r, 'approvers')).filter(Boolean), rs = lines(g(r, 'response')), ret = lines(g(r, 'returned date')).map(x => x.replace(/^'/, ''));
    const revs = ap.map((a, k) => ({ ...who(a), resp: rs[k] || 'Pending', on: dateOf(ret[k]) })).filter(x => !/C3 Construction|Matt Wickham|Resero/i.test(x.co) || !/^(Pending|Submitted)$/.test(x.resp));
    const wait = revs.filter(x => /^Pending/i.test(x.resp)), arb = g(r, 'action required by company'), open = !/^closed/i.test(g(r, 'status'));
    const owner = open ? (wait.length ? [...new Set(wait.map(x => x.co || x.person))].join(', ') : arb || g(r, 'responsible contractor') || 'C3 Construction') : (revs[0] && revs[0].co) || '';
    const done = revs.filter(x => x.on).map(x => x.on).sort();
    return { id: 'sub-' + (num + '-' + g(r, 'title').slice(0, 20) + '-r' + rev).replace(/\W+/g, '_'), kind: 'info', type: INFO_TYPES[2], ref: `SUB ${num.length > 18 ? num.slice(0, 18) + '…' : num}${rev ? ' Rev ' + rev : ''}`, num, rev, subject: g(r, 'title'), status: open ? 'Open' : 'Closed', owner, person: open ? wait.map(x => x.person).join(', ') : '', raised: dateOf(lines(g(r, 'sent date'))[0]), due: dateOf(g(r, 'final due date')), answered: open ? '' : done[done.length - 1] || dateOf(g(r, 'updated at')), reviews: revs.map(x => `${x.person}${x.co ? ' (' + x.co + ')' : ''}: ${x.resp}${x.on ? ', ' + x.on : ''}`).join('; '), noFlow: !ap.length, src: 'Procore submittals' };
  });
  const order = v => /^\d+$/.test(v) ? +v : v ? v.toUpperCase().charCodeAt(0) - 64 : -1;
  L.forEach(i => { if (i.status !== 'Open') return; const same = x => x.num === i.num && x.subject.trim().toLowerCase() === i.subject.trim().toLowerCase(), later = L.filter(x => same(x) && order(x.rev) > order(i.rev)).sort((a, b) => order(b.rev) - order(a.rev))[0];
    if (later) i.closeNote = `Replaced by Rev ${later.rev}: can be closed`;
    else if (!i.noFlow && !/Pending/i.test(i.reviews)) i.closeNote = 'Every reviewer has responded: can be closed';
    else if (/Revise and resubmit/i.test(i.reviews)) i.closeNote = 'Returned "Revise and resubmit": close it and ask for the next revision';
    else if (i.noFlow) i.closeNote = 'No review workflow set up in Procore'; });
  return L;
}
const KEEP = ['needBy', 'promised', 'timeRefs', 'impact', 'notes', 'ownerSet'];   // what you add by hand survives a fresh export
async function importProcore(file) {
  const L = procoreItems(await file.text()); if (!L.length) return toast(`${file.name}: not a Procore RFI, Correspondence or Submittals CSV export`, 7000);
  const have = Object.fromEntries(of('info').map(i => [i.id, i])), b = busy('Bringing in ' + L.length + ' items…'), stamp = new Date().toISOString(); let nu = 0, ch = 0;
  const out = L.map(n => { const o = have[n.id]; if (!o) { nu++; return { ...n, updated: stamp, updatedBy: S.user.email }; } const m = { ...o, ...n }; KEEP.forEach(k => { if (o[k] != null) m[k] = o[k]; }); if (o.ownerSet) { m.owner = o.owner; m.person = o.person; }
    if (['status', 'due', 'answered', 'owner', 'subject'].some(k => (o[k] || '') !== (m[k] || ''))) ch++; return { ...m, updated: stamp, updatedBy: S.user.email }; });
  try { await S.store.bulkSave(S.project.id, COLL, out); toast(`${file.name}: ${nu} new, ${ch} changed, ${L.length - nu - ch} unchanged`, 7000); } catch (e) { toast('Could not bring it in: ' + e.message, 7000); } b.done();
}

/* --- Decisions --- */
function decView() {
  const A = of('decision'), L = A.filter(d => F.show === 'all' || decOpen(d)).sort((a, b) => STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage) || natural(a.ref || '', b.ref || '')); let last = '';
  body(`<div class="fbar"><select id="cShow"><option value="open">Not yet confirmed on site</option><option value="all" ${F.show === 'all' ? 'selected' : ''}>All</option></select><span style="flex:1"></span><button class="btn2 go" id="cNew">+ Decision</button></div>
    <div class="cstages">${STAGES.map(s => `<span><b>${A.filter(d => d.stage === s).length}</b> ${esc(s)}</span>`).join('<i>›</i>')}</div>
    ${L.length ? `<table class="ftable"><tr><th>Ref</th><th>Decision</th><th>Next step with</th><th>Due</th><th>At this stage</th><th></th></tr>${L.map(d => { const g = d.stage !== last ? `<tr class="grp"><td colspan="6">${esc(d.stage || '')}</td></tr>` : ''; last = d.stage; const a = stageAge(d), nx = STAGES[STAGES.indexOf(d.stage) + 1];
      return g + `<tr class="click" data-id="${esc(d.id)}"><td><b>${esc(d.ref || '')}</b></td><td>${esc(d.text || '')}${d.madeOn ? `<br><span class="muted small">${d.stage === 'Awaiting decision' ? 'Raised' : 'Decided'} ${esc(nzDate(d.madeOn))}${d.madeBy ? ' by ' + esc(d.madeBy) : ''}${d.docRef ? ' · ' + esc(d.docRef) : ''}</span>` : ''}</td><td>${esc(d.owner || '')}</td><td>${d.due ? (overdue(d) ? st(nzDate(d.due), 'bad') : esc(nzDate(d.due))) : ''}</td><td>${a != null ? (a > cfg().stuckWD ? st(a + ' WD', 'warn') : a + ' WD') : ''}</td><td>${nx && decOpen(d) ? `<button class="btn2 sm" data-adv="${esc(d.id)}">→ ${esc(nx)}</button>` : ''}</td></tr>`; }).join('')}</table>`
    : '<div class="empty2">No decisions recorded. Add each client decision when it is made, then move it along as it is documented, priced, instructed and confirmed on site.</div>'}`);
  $('cShow').onchange = e => { F.show = e.target.value; view(); }; $('cNew').onclick = () => editDec(null); rowClick('#cBody tr[data-id]', editDec);
  document.querySelectorAll('[data-adv]').forEach(b => b.onclick = async () => { const d = all().find(x => x.id === b.dataset.adv), nx = STAGES[STAGES.indexOf(d.stage) + 1]; await save({ ...d, stage: nx, stageOn: todayISO(), log: [...(d.log || []), { d: todayISO(), to: nx, by: S.user.email }] }); toast(`${d.ref}: ${nx}`); });
}
function editDec(d) {
  const isNew = !d; d = d ? { ...d } : { id: uid(), kind: 'decision', stage: 'Decided', madeOn: todayISO(), stageOn: todayISO() }; const was = d.stage;
  const spec = [{ k: 'ref', l: 'Ref' }, { k: 'stage', l: 'Stage', t: 'sel', L: [...STAGES, 'Not proceeding'] }, { k: 'text', l: 'Decision', t: 'ta', rows: 2 }, { k: 'madeOn', l: 'Decided (or raised) on', t: 'date' }, { k: 'madeBy', l: 'Decided by' }, { k: 'source', l: 'Where it was decided (meeting, email)' }, { k: 'link', l: 'Link to the record', t: 'url', ph: 'TicNote or document link' }, { k: 'owner', l: 'Next step with' }, { k: 'due', l: 'Next step due', t: 'date' }, { k: 'docRef', l: 'References (VPR, CI, variation no.)' }, { k: 'value', l: 'Cost, if known' }, { k: 'notes', l: 'Notes', t: 'ta', rows: 2 }];
  const hist = (d.log || []).length ? `<p class="muted small">${d.log.map(l => `${esc(nzDate(l.d))}: ${esc(l.to)}`).join(' · ')}</p>` : '';
  editor(isNew ? 'New decision' : `${d.ref} decision`, spec, d, isNew, hist, n => { if (!n.text) { toast('Say what the decision is'); return null; } if (!n.ref) n.ref = nextRef('decision', 'DEC'); if (n.stage !== was || isNew) { n.stageOn = todayISO(); n.log = [...(d.log || []), { d: todayISO(), to: n.stage, by: S.user.email }]; } return n; }, 'decision');
}

/* --- Actions --- */
function actView() {
  const A = of('action'), SL = seriesList(), q = F.q.toLowerCase();
  const L = A.filter(a => (F.show === 'all' || actOpen(a)) && (!F.series || (a.series || []).includes(F.series)) && (!q || [a.ref, a.text, a.owner, a.cat].join(' ').toLowerCase().includes(q))).sort((a, b) => (a.owner || 'zz').localeCompare(b.owner || 'zz') || String(a.due || '9').localeCompare(String(b.due || '9')));
  const owners = {}; A.filter(actOpen).forEach(a => { const o = owners[a.owner || 'No owner'] = owners[a.owner || 'No owner'] || [0, 0]; o[0]++; if (overdue(a)) o[1]++; }); let last = null;
  body(`<div class="fbar"><input type="search" id="cQ" placeholder="Search actions…" value="${esc(F.q)}"><select id="cShow"><option value="open">Open</option><option value="all" ${F.show === 'all' ? 'selected' : ''}>All</option></select><select id="cSer"><option value="">All meetings</option>${SL.map(s => `<option ${F.series === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
    <button class="btn2 go" id="cNew">+ Action</button><button class="btn2" id="cImp">⬆ PCG data file (actions, decisions, NODs)</button><input type="file" id="cFile" accept=".json" hidden></div>
    <p class="muted small">Open by owner: ${Object.entries(owners).sort((a, b) => b[1][0] - a[1][0]).map(([o, n]) => `<b>${esc(o)}</b> ${n[0]}${n[1] ? ` (${n[1]} overdue)` : ''}`).join(' · ') || 'none'}</p>
    ${L.length ? `<table class="ftable"><tr><th>Ref</th><th>Action</th><th>Due</th><th>Status</th><th class="hm">Meetings</th></tr>${L.map(a => { const g = (a.owner || 'No owner') !== last ? `<tr class="grp"><td colspan="5">${esc(a.owner || 'No owner')}</td></tr>` : ''; last = a.owner || 'No owner'; const u = (a.updates || []).slice(-1)[0];
      return g + `<tr class="click" data-id="${esc(a.id)}"><td><b>${esc(a.ref || '')}</b></td><td>${esc(a.text || '')}${u && u.note ? `<br><span class="muted small">${esc(nzDate(u.d))}: ${esc(u.note)}</span>` : ''}</td><td>${a.due ? (actOpen(a) && overdue(a) ? st(nzDate(a.due), 'bad') : esc(nzDate(a.due))) : st('No date', 'warn')}</td><td>${st(a.status || 'Open', actOpen(a) ? (a.status === 'Blocked' ? 'bad' : 'info') : 'ok')}</td><td class="hm small">${esc((a.series || []).join(', '))}</td></tr>`; }).join('')}</table>`
    : `<div class="empty2">${A.length ? 'Nothing matches.' : 'No actions yet. Bring in the PCG data file to start from the Client Action Register, or add one by hand.'}</div>`}`);
  $('cQ').oninput = e => { F.q = e.target.value; actView(); $('cQ').focus(); $('cQ').setSelectionRange(F.q.length, F.q.length); };
  $('cShow').onchange = e => { F.show = e.target.value; view(); }; $('cSer').onchange = e => { F.series = e.target.value; view(); };
  $('cNew').onclick = () => editAct(null); rowClick('#cBody tr[data-id]', editAct);
  $('cImp').onclick = () => $('cFile').click(); $('cFile').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) importPcg(f); };
}
function editAct(a, preset) {
  const isNew = !a, SL = seriesList(); a = a ? { ...a } : { id: uid(), kind: 'action', status: 'Open', raised: todayISO(), series: SL.slice(0, 1), ...(preset || {}) };
  const spec = [{ k: 'ref', l: 'Ref' }, { k: 'status', l: 'Status', t: 'sel', L: ACT_ST }, { k: 'text', l: 'Action', t: 'ta', rows: 2 }, { k: 'owner', l: 'Owner (a named person)' }, { k: 'due', l: 'Due', t: 'date' }, { k: 'cat', l: 'Workstream' }, { k: 'raised', l: 'Raised', t: 'date' }, { k: 'notes', l: 'Notes', t: 'ta', rows: 2 }];
  const pick = `<p class="cser"><b>Reviewed at:</b> ${SL.map((s, i) => `<label><input type="checkbox" data-ser="${i}" ${(a.series || []).includes(s) ? 'checked' : ''}> ${esc(s)}</label>`).join(' ')}</p>${(a.updates || []).length ? `<div class="cbox">${a.updates.map(u => `<div class="small">${esc(nzDate(u.d))}${u.s ? ' (' + esc(u.s) + ')' : ''}: ${esc(u.status || '')}${u.note ? '. ' + esc(u.note) : ''}</div>`).join('')}</div>` : ''}`;
  editor(isNew ? 'New action' : `${a.ref} action`, spec, a, isNew, pick, n => { if (!n.text) { toast('Say what the action is'); return null; } if (!n.ref) n.ref = nextRef('action', 'A'); n.series = [...document.querySelectorAll('[data-ser]')].filter(x => x.checked).map(x => SL[+x.dataset.ser]); if (!actOpen(n) && !n.closed) n.closed = todayISO(); return n; }, 'action');
}
// The PCG Report Builder's data file: Client Action Register, Design and Decisions register and the NOD table.
export function pcgItems(d, SL = seriesList()) {
  const s = (d && d.sections) || {}, out = [], stA = v => /closed/i.test(v) ? 'Closed' : /ready to close/i.test(v) ? 'Done' : /progress|review/i.test(v) ? 'In progress' : 'Open';
  ((s.actions || {}).items || []).forEach((x, i) => out.push({ id: 'pcg-a-' + (x._id || i), kind: 'action', text: x.task || '', owner: x.owner || '', status: stA(x.status || ''), cat: x.cat || '', notes: x.comment || '', due: dateOf(x.due || ''), series: SL.filter(n => /pcg|client/i.test(n)), src: 'PCG data file' }));
  ((s.design || {}).tracker || []).forEach((x, i) => out.push({ id: 'pcg-d-' + (x._id || i), kind: 'decision', text: x.task || '', owner: x.owner || '', stage: /closed/i.test(x.status || '') ? 'Confirmed on site' : 'Awaiting decision', notes: x.comment || '', cat: x.cat || '', src: 'PCG data file' }));
  ((s.programme || {}).nods || []).forEach((x, i) => { const closed = /closed/i.test(x.status || ''), days = parseFloat(x.claimed); out.push({ id: 'pcg-n-' + String(x.ref || i).replace(/\W+/g, ''), kind: 'time', ref: x.ref || '', type: TIME_TYPES[1], title: x.description || '', ground: 'Not stated', received: dateOf(x.issued || ''), aware: dateOf(x.eventDate || ''), daysClaimed: isNaN(days) ? '' : days, status: closed ? 'Closed, no claim' : isNaN(days) ? 'Notice only' : 'Period claimed', notes: x.status || '', src: 'PCG data file' }); });
  return out;
}
async function importPcg(file) {
  let d; try { d = JSON.parse(await file.text()); } catch (e) { return toast('That file is not a PCG data file', 6000); }
  const L = pcgItems(d); if (!L.length) return toast('No registers found in that file', 6000);
  const have = Object.fromEntries(all().map(i => [i.id, i])), nu = L.filter(x => !have[x.id]), n = k => nu.filter(x => x.kind === k).length;
  if (!nu.length) return toast('Everything in that file is already here. Items already brought in are not overwritten.', 7000);
  const openOnly = nu.filter(x => x.kind === 'time' || (x.kind === 'action' ? actOpen(x) : decOpen(x)));
  modal(`<h2>Bring in from the PCG data file</h2><p>${esc(file.name)} holds ${n('action')} actions, ${n('decision')} design and decision items and ${n('time')} NODs that are not here yet. Items already brought in are left as they are, so your edits are safe.</p><p class="muted small">Open design and decision items arrive as "Awaiting decision", because the register does not say how far each has got. Set each to its true stage, and name who the decision sits with, afterwards.</p><div class="act"><button id="ipX">Cancel</button><button id="ipAll">All ${nu.length} (with closed items)</button><button class="go" id="ipOpen">Open items only (${openOnly.length})</button></div>`);
  const go = async list => { closeModal(); const b = busy('Bringing in…'), cnt = {}; const pre = { action: 'A', decision: 'DEC' }, stamp = new Date().toISOString();
    list.forEach(x => { if (!x.ref) { cnt[x.kind] = (cnt[x.kind] || 0) + 1; const base = +nextRef(x.kind, pre[x.kind]).split('-')[1]; x.ref = pre[x.kind] + '-' + String(base + cnt[x.kind] - 1).padStart(2, '0'); } if (x.kind === 'decision') x.stageOn = todayISO(); x.updated = stamp; x.updatedBy = S.user.email; });
    try { await S.store.bulkSave(S.project.id, COLL, list); toast(list.length + ' items brought in', 5000); } catch (e) { toast('Could not bring it in: ' + e.message, 7000); } b.done(); };
  $('ipX').onclick = closeModal; $('ipAll').onclick = () => go(nu); $('ipOpen').onclick = () => go(openOnly);
}

/* --- Meetings: one run sheet per meeting, drawn from the same registers --- */
function mtgView() {
  const SL = seriesList(), M = of('meeting').sort((a, b) => String(b.date).localeCompare(String(a.date)));
  body(`<div class="fbar"><span style="flex:1"></span>${SL.map((s, i) => `<button class="btn2 ${i ? '' : 'go'}" data-new="${i}">+ ${esc(s)} meeting</button>`).join('')}</div>
    <p class="muted small">The three meetings work from the same actions, decisions, information and time registers, so a matter raised at the design and contractor meeting is already on the client's weekly list and in the PCG section. Each action says which meetings review it.</p>
    ${M.length ? `<table class="ftable"><tr><th>Date</th><th>Meeting</th><th>Record</th><th>Reviewed</th></tr>${M.map(m => { const r = recon(m); return `<tr class="click" data-id="${esc(m.id)}"><td><b>${esc(nzDate(m.date))}</b></td><td>${esc(m.series || '')}${m.title ? `<br><span class="muted small">${esc(m.title)}</span>` : ''}</td><td>${safeUrl(m.link) ? `<a href="${esc(m.link)}" target="_blank" rel="noopener">Open the recording ↗</a>` : '<span class="muted">No link</span>'}</td><td>${m.held ? (r.missed.length ? st(`${r.missed.length} of ${r.total} not updated`, 'warn') : st('All ' + r.total + ' updated', 'ok')) : st('Not held yet', 'grey')}</td></tr>`; }).join('')}</table>` : '<div class="empty2">No meetings yet. Start one from the buttons above: it opens with every open action for that meeting, the decisions outstanding and the clocks that are running.</div>'}`);
  document.querySelectorAll('[data-new]').forEach(b => b.onclick = async () => { const m = { id: uid(), kind: 'meeting', series: SL[+b.dataset.new], date: todayISO(), link: '', summary: '', held: false }; await save(m); runMeeting(m); });
  rowClick('#cBody tr[data-id]', runMeeting);
}
export const forMeeting = m => of('action').filter(a => (a.series || []).includes(m.series) && (actOpen(a) || (a.updates || []).some(u => u.m === m.id)));
// reconciliation: every action carried into a meeting must leave it with an update
export function recon(m) { const L = forMeeting(m), missed = L.filter(a => !(a.updates || []).some(u => u.m === m.id)); return { total: L.length, missed }; }
function runMeeting(m) {
  m = { ...m }; const A = forMeeting(m).sort((a, b) => (a.owner || 'zz').localeCompare(b.owner || 'zz')), isClient = /client|pcg/i.test(m.series), isDesign = /design|contractor/i.test(m.series) || /pcg/i.test(m.series);
  const D = of('decision').filter(decOpen), dWait = D.filter(d => d.stage === 'Awaiting decision'), dMove = D.filter(d => d.stage !== 'Awaiting decision');
  const I = of('info').filter(i => infoOpen(i) && infoState(i).left != null && infoState(i).left <= 5).sort((a, b) => needOf(a).localeCompare(needOf(b))), T = of('time').filter(timeLive);
  const li = (L, f) => L.length ? `<ul class="clist">${L.slice(0, 25).map(x => `<li data-open="${esc(x.id)}">${f(x)}</li>`).join('')}</ul>${L.length > 25 ? `<p class="muted small">${L.length - 25} more in the register.</p>` : ''}` : '<p class="muted small">None.</p>';
  modal(`<h2>${esc(m.series)} meeting</h2><div class="grid"><label class="f">Date<input type="date" id="mD" value="${esc(m.date)}"></label><label class="f">Title or number<input id="mT" value="${esc(m.title || '')}" placeholder="e.g. PCG No. 12"></label>
    <label class="f full">Link to the recording or summary (TicNote)<span class="clink"><input type="url" id="mL" value="${esc(m.link || '')}" placeholder="Paste the TicNote share link">${safeUrl(m.link) ? `<a href="${esc(m.link)}" target="_blank" rel="noopener" class="btn2 sm">Open ↗</a>` : ''}</span></label></div>
    <h3 class="sec">1. Carried actions (${A.length}) <span class="sp"></span><button class="btn2 sm" id="mAdd">+ Action</button></h3>
    ${A.length ? `<table class="ftable cmt"><tr><th>Action</th><th>Owner</th><th>Due</th><th>Status</th><th>Update at this meeting</th></tr>${A.map(a => { const u = (a.updates || []).find(x => x.m === m.id) || {};
      return `<tr data-a="${esc(a.id)}"><td><b>${esc(a.ref)}</b> ${esc(a.text)}</td><td>${esc(a.owner || '')}</td><td>${a.due ? (overdue(a) && actOpen(a) ? st(nzDate(a.due), 'bad') : esc(nzDate(a.due))) : ''}</td><td><select data-st>${ACT_ST.map(s => `<option ${s === (a.status || 'Open') ? 'selected' : ''}>${s}</option>`).join('')}</select></td><td><input data-note value="${esc(u.note || '')}" placeholder="What was said"></td></tr>`; }).join('')}</table>` : '<p class="muted small">No open actions are set to be reviewed at this meeting.</p>'}
    ${isClient ? `<h3 class="sec">2. Decisions needed from the client (${dWait.length})</h3>${li(dWait, d => `<b>${esc(d.ref)}</b> ${esc(d.text)}${d.due ? ` <span class="muted">needed by ${esc(nzDate(d.due))}</span>` : ''}`)}` : ''}
    <h3 class="sec">${isClient ? 3 : 2}. Decisions made, still to be actioned (${dMove.length})</h3>${li(dMove, d => `<b>${esc(d.ref)}</b> ${esc(d.text)} <span class="muted">${esc(d.stage)}${d.owner ? ', with ' + esc(d.owner) : ''}</span>`)}
    ${isDesign ? `<h3 class="sec">Information due or late (${I.length})</h3>${li(I, i => `<b>${esc(i.ref)}</b> ${esc(i.subject)} <span class="muted">${esc(i.owner || '')}</span> ${st(infoState(i).txt, infoState(i).cls)}`)}
    <h3 class="sec">Time: notices and claims (${T.length})</h3>${li(T, t => `<b>${esc(t.ref)}</b> ${esc(t.title)} <span class="muted">${esc(t.status)}${+t.daysClaimed ? ', ' + t.daysClaimed + ' Working Days claimed' : ', no period claimed'}</span>`)}` : ''}
    <h3 class="sec">After the meeting</h3><label class="f full">Paste the TicNote summary here<textarea id="mS" rows="4" placeholder="Paste the summary or transcript. It is kept with the meeting.">${esc(m.summary || '')}</textarea></label>
    <p><button class="btn2 sm" id="mAI">✨ Read the summary and propose updates</button> <button class="btn2 sm" id="mHand">Copy a hand-over for Claude</button> <button class="btn2 sm" id="mPaste">Paste Claude's reply</button> <span id="mSt" class="muted small"></span></p>
    <div class="act"><button id="mDel" class="warn">Delete</button><button id="mX">Close</button><button id="mOk" class="go">Save updates and mark as held</button></div>`, true);
  const keep = async held => { const stamp = todayISO(); m = { ...m, date: $('mD').value || m.date, title: $('mT').value.trim(), link: $('mL').value.trim(), summary: $('mS').value, held: held || m.held };
    for (const r of document.querySelectorAll('tr[data-a]')) { const a = all().find(x => x.id === r.dataset.a), stv = r.querySelector('[data-st]').value, note = r.querySelector('[data-note]').value.trim(), old = (a.updates || []).find(x => x.m === m.id);
      if (!note && stv === a.status) continue; if (old && old.note === note && old.status === stv && a.status === stv) continue;
      await save({ ...a, status: stv, closed: actOpen({ status: stv }) ? '' : (a.closed || stamp), updates: [...(a.updates || []).filter(x => x.m !== m.id), { m: m.id, d: m.date, s: m.series, status: stv, note }] }); }
    await save(m); };
  $('mX').onclick = async () => { await keep(false); closeModal(); }; $('mOk').onclick = async () => { await keep(true); closeModal(); toast('Meeting saved'); };
  $('mDel').onclick = async () => { if (!(await confirmBox('Delete this meeting record? Action updates made at it are kept.', 'Delete'))) return; await S.store.deleteItem(S.project.id, COLL, m.id); closeModal(); };
  $('mAdd').onclick = async () => { await keep(false); editAct(null, { series: [m.series], raised: m.date }); };
  document.querySelectorAll('[data-open]').forEach(x => x.onclick = async () => { await keep(false); openItem(all().find(y => y.id === x.dataset.open)); });
  $('mAI').onclick = async () => { const txt = $('mS').value.trim(); if (!txt) return toast('Paste the summary first'); $('mSt').textContent = 'Reading…'; try { const ans = await aiCall(handover(m, txt)); await keep(false); propose(m, ans); } catch (e) { $('mSt').textContent = 'The AI helper could not read it: ' + e.message + '. Use the hand-over for Claude instead.'; } };
  $('mHand').onclick = async () => { const t = handover(m, $('mS').value.trim() || '[paste the TicNote summary here]'); try { await navigator.clipboard.writeText(t); toast('Copied. Paste it to Claude, then bring the reply back with "Paste Claude\'s reply".', 6000); } catch (e) { outBox('Hand-over for Claude', t, 'Copy this to Claude.'); } };
  $('mPaste').onclick = async () => { await keep(false); modal(`<h2>Paste Claude's reply</h2><textarea id="pjT" rows="12" style="width:100%" placeholder="Paste the reply, including the block that starts with {"></textarea><div class="act"><button id="pjX">Cancel</button><button class="go" id="pjOk">Read it</button></div>`, true); $('pjX').onclick = () => { closeModal(); runMeeting(m); }; $('pjOk').onclick = () => propose(m, $('pjT').value); };
}
// One instruction serves both the in-app AI helper and a paste into Claude: the reply is a single JSON block.
export function handover(m, summary) { return X2.handoverText({ label: `${m.series} meeting held ${nzDate(m.date)}`, date: m.date, actions: forMeeting(m).filter(actOpen) }, summary); }
const propose = (m, txt) => X2.applyReply({ id: m.id, date: m.date, label: `${m.series} meeting ${nzDate(m.date)}`, link: m.link, series: m.series }, txt, () => runMeeting(all().find(x => x.id === m.id) || m));

/* --- outputs: plain text you can check and paste --- */
export function outBox(title, text, hint) {
  modal(`<h2>${esc(title)}</h2><p class="muted small">${esc(hint)}</p><textarea id="obT" rows="20" style="width:100%;font:13px/1.5 inherit">${esc(text)}</textarea><div class="act"><button id="obX">Close</button><button id="obD">Download (.txt)</button><button class="go" id="obC">Copy</button></div>`, true);
  $('obX').onclick = closeModal; $('obD').onclick = () => download(new Blob([$('obT').value], { type: 'text/plain' }), `${S.project.name} - ${title} - ${todayISO()}.txt`);
  $('obC').onclick = async () => { try { await navigator.clipboard.writeText($('obT').value); toast('Copied'); } catch (e) { $('obT').select(); toast('Press Ctrl+C to copy'); } };
}
export const num = (L, f) => L.length ? L.map((x, i) => `${i + 1}. ${f(x)}`).join('\n') : 'None.';
const one = t => { const l = String(t || '').split(/\n/).map(x => x.trim()).filter(Boolean)[0] || ''; return /[.!?]$/.test(l) ? l : l + '.'; };   // first line only, as a sentence
export function briefText(today = todayISO()) {
  const c = cfg(), D = of('decision').filter(decOpen), A = of('action').filter(a => actOpen(a) && (!(a.series || []).length || (a.series || []).some(s => /client|pcg/i.test(s)))), T = of('time').filter(timeLive), I = of('info').filter(owedOpen), late = I.filter(i => infoState(i, today).left < 0);
  const horizon = plus(today, 10), soon = [...A.filter(a => a.due && a.due <= horizon), ...D.filter(d => d.due && d.due <= horizon)].sort((a, b) => a.due.localeCompare(b.due)), mine = x => new RegExp(String(c.principal || 'client').split(/\s+/)[0], 'i').test(x.owner || '');
  const wait = D.filter(d => d.stage === 'Awaiting decision'), isMine = d => mine(d) || new RegExp(String(c.principal || 'client').split(/\s+/)[0], 'i').test(d.madeBy || '');
  return `${S.project.name}: weekly update, ${nzDate(today)}

DECISIONS WE NEED FROM YOU
${num(wait.filter(isMine), d => `${one(d.text)}${d.due ? ` Needed by ${nzDate(d.due)}.` : ''}`)}

MATTERS AWAITING A DECISION FROM THE PROJECT TEAM
${num(wait.filter(d => !isMine(d)), d => `${one(d.text)}${d.owner ? ` With ${d.owner}.` : ''}${d.due ? ` Due ${nzDate(d.due)}.` : ''}`)}

DECISIONS MADE AND WHERE EACH STANDS
${num(D.filter(d => d.stage !== 'Awaiting decision'), d => `${one(d.text)} Stage: ${d.stage.toLowerCase()}.${d.owner ? ` Next step with ${d.owner}` : ''}${d.due ? `${d.owner ? ',' : ' Next step'} due ${nzDate(d.due)}.` : d.owner ? '.' : ''}`)}

ACTIONS WITH YOUR TEAM
${num(A.filter(mine), a => `${one(a.text)} Owner: ${a.owner}.${a.due ? ` Due ${nzDate(a.due)}${a.due < today ? ' (overdue)' : ''}.` : ''}`)}

ACTIONS WITH THE PROJECT TEAM
${num(A.filter(a => !mine(a)).slice(0, 15), a => `${one(a.text)} Owner: ${a.owner || 'to be confirmed'}.${a.due ? ` Due ${nzDate(a.due)}${a.due < today ? ' (overdue)' : ''}.` : ''}`)}

PROGRAMME AND TIME
${T.length ? `${T.length} notice${T.length === 1 ? '' : 's'} of delay or claim${T.length === 1 ? ' is' : 's are'} live:\n${num(T, t => `${t.ref} ${t.title}: ${+t.daysClaimed ? t.daysClaimed + ' Working Days claimed' : 'notice only, no period claimed'}. ${t.status}.`)}` : 'No notices of delay or extension of time claims are live.'}

DESIGN INFORMATION
${I.length} items are open with the design team and contractor${late.length ? `, ${late.length} past the date required` : ', none past the date required'}.

NEXT TEN WORKING DAYS
${num(soon, x => `${nzDate(x.due)}: ${one(x.text)}${x.owner ? ` (${x.owner})` : ''}`)}
`;
}
export function chaseText(today = todayISO()) {
  const by = {}; of('info').filter(owedOpen).forEach(i => (by[i.owner || 'Not assigned'] = by[i.owner || 'Not assigned'] || []).push(i));
  return Object.keys(by).sort().map(o => { const L = by[o].sort((a, b) => String(needOf(a) || '9').localeCompare(String(needOf(b) || '9'))), late = L.filter(i => infoState(i, today).left < 0).length;
    return `${o.toUpperCase()}: ${L.length} open${late ? `, ${late} past the date required` : ''}\n${num(L, i => { const s = infoState(i, today); return `${i.ref} ${i.subject}. ${i.person ? i.person + '. ' : ''}Required ${needOf(i) ? nzDate(needOf(i)) : 'date not set'}${s.left < 0 ? ` (${-s.left} Working Days late)` : ''}.${i.impact ? ` If late: ${i.impact}.` : ''}`; })}`; }).join('\n\n') || 'No open information items.';
}
export function pcgText() {
  const T = of('time'), SC = scorecard(), I = of('info').filter(owedOpen), D = of('decision').filter(decOpen);
  return `NOTICES OF DELAY AND EXTENSION OF TIME
Ref | Matter | Notice given | Working Days claimed | Working Days granted | Status
${T.sort((a, b) => natural(a.ref || '', b.ref || '')).map(t => `${t.ref} | ${t.title} | ${t.received ? nzDate(t.received) : '-'} | ${+t.daysClaimed || '-'} | ${t.grantedDays !== '' && t.grantedDays != null ? t.grantedDays : '-'} | ${t.status}`).join('\n') || 'None.'}

INFORMATION OUTSTANDING (${I.length} open)
Held by | Open | Past date required | Worst (Working Days)
${SC.filter(s => s.open).map(s => `${s.owner} | ${s.open} | ${s.late} | ${s.worst || '-'}`).join('\n') || 'None.'}

DECISIONS (${D.length} not yet confirmed on site)
${STAGES.slice(0, 5).map(s => `${s}: ${D.filter(d => d.stage === s).length}`).join(' · ')}
`;
}

/* --- Set-up: the contract's own periods and rates --- */
function setView() {
  const c = cfg(), spec = [{ h: 'Contract' }, { k: 'form', l: 'Form of contract' }, { k: 'due', l: 'Due Date(s) for Completion', ph: 'e.g. SP2 Main Works 23 Mar 2027' }, { k: 'principal', l: 'Principal' }, { k: 'contractor', l: 'Contractor' }, { k: 'ca', l: 'Contract Administrator' }, { k: 'ic', l: 'Independent Certifier' },
    { h: 'Time (check each against the special conditions)' }, { k: 'noticeWD', l: 'Notice of grounds: Working Days after the Contractor becomes aware (10.3.2(a))', t: 'num' }, { k: 'noticeStrict', l: 'Timely notice is a condition precedent to any extension', t: 'chk' }, { k: 'instructWD', l: 'Instruction after agreement: Working Days (10.3.4)', t: 'num' }, { k: 'icWD', l: 'Independent Certifier Decision: Working Days from a request (10.3.5)', t: 'num' }, { k: 'detailsChaseWD', l: 'Chase the period claimed after this many Working Days', t: 'num' }, { k: 'critPath', l: 'No extension unless the critical path is affected', t: 'chk' }, { k: 'concurrent', l: 'Concurrent delay: time in full, time-related cost only for the excess', t: 'chk' }, { k: 'weatherNote', l: 'Weather rule', full: true },
    { h: 'Money' }, { k: 'ldRate', l: 'Liquidated damages per Working Day ($)', t: 'num' }, { k: 'timeRate', l: 'Time-related cost per Working Day ($) (9.3.12)', t: 'num' }, { k: 'vprWD', l: 'Variation price request: Working Days for the Contractor to respond', t: 'num' },
    { h: 'Weather' }, { k: 'wxRain', l: 'Rain in 24 hours on a Working Day that counts (mm, more than)', t: 'num' }, { k: 'wxStation', l: 'Weather station the contract names' },
    { h: 'Working Days' }, { k: 'region', l: 'Anniversary day', t: 'sel', L: Object.keys(REGIONS) }, { k: 'extra', l: 'Other non-working days (YYYY-MM-DD, comma separated)' },
    { h: 'Meetings and follow-up' }, { k: 'series', l: 'Meeting series (comma separated)', full: true }, { k: 'stuckWD', l: 'Flag a decision that sits at one stage longer than (Working Days)', t: 'num' }, { k: 'mailTag', l: `Email tag for forwarded mail (blank uses "${X2.mailTag()}")`, ph: 'e.g. channel' }, { k: 'notes', l: 'Other contract notes', t: 'ta', rows: 3 }];
  body(`<p class="muted small">Working Days exclude Saturdays, Sundays, public holidays and 24 December to 5 January inclusive. The periods below start from the unamended standard; change any that your special conditions amend.</p>${form(spec, c)}<div class="act" style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px"><input type="file" id="sFile" accept=".json" hidden><button class="btn2" id="sLoad">⬆ Load a set-up or seed file (.json)</button><button class="btn2" id="sOut">⬇ Save everything in this section to a file</button><button class="btn2 go" id="sOk">Save set-up</button></div>`);
  $('sOk').onclick = async () => { try { await save({ ...read(spec), id: SET_ID, kind: 'settings' }); toast('Set-up saved'); } catch (e) { toast('Could not save: ' + e.message, 6000); } };
  $('sOut').onclick = () => download(new Blob([JSON.stringify({ schema: 'resero-contract/1', project: S.project.name, saved: new Date().toISOString(), items: all() }, null, 1)], { type: 'application/json' }), `${S.project.name} - Contract section - ${todayISO()}.json`);
  $('sLoad').onclick = () => $('sFile').click(); $('sFile').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; let j; try { j = JSON.parse(await f.text()); } catch (x) { return toast('Not a valid file', 5000); }
    if (j.schema !== 'resero-contract/1' || !Array.isArray(j.items)) return toast('That is not a Contract section file', 6000); const have = new Set(all().map(x => x.id)), nu = j.items.filter(x => x && x.id && x.kind && !have.has(x.id));
    if (!(await confirmBox(`${f.name} holds ${j.items.length} items${j.project ? ' for ' + j.project : ''}. ${nu.length} are not here yet and will be added. Items already here are left unchanged.`, 'Add ' + nu.length))) return; const b = busy('Loading…'); try { await S.store.bulkSave(S.project.id, COLL, nu.map(x => ({ ...x, updated: new Date().toISOString(), updatedBy: S.user.email }))); toast(nu.length + ' added'); } catch (x) { toast('Could not load: ' + x.message, 7000); } b.done(); };
}
