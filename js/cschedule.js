// Compliance schedule reader. Takes the council's compliance schedule PDF (Auckland Council form AC2004 and others laid out the
// same way: one table per specified system with a label column and a content column) and reads out each specified system, word
// for word: what it is, where, the performance standard, the inspection, maintenance and reporting procedures, how often and by
// whom, and the documents the schedule lists as attached. Nothing is reworded: the schedule is the legal document.
import { S, can } from './state.js';
import * as DV from './docview.js';
import { $, esc, toast, modal, closeModal, busy, uid, nzDate, natural } from './util.js';

let X = {};
export function init(ctx) { X = ctx; }
const fm = () => S.fm || { assets: [], docs: [], tasks: [], systems: [] };
const SYS14 = '14 Compliance Schedule & BWoF';

/* ---------------- keys and matching */
// SS 1/1, SS1.1, ss 1-1 and "SS 15 c", "SS 15(c)" all mean the same system
export const ssKey = s => String(s || '').toLowerCase().replace(/^\s*s\/?s/, '').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, '.');
const norm = s => String(s || '').toLowerCase().replace(/\.pdf$/, '').replace(/[^a-z0-9]+/g, '');
// library documents whose name starts with the name the schedule gives the attachment
export function attDocs(name, all) {
  const k = norm(name); if (k.length < 6) return [];
  const names = all || fm().systems.flatMap(s => (s.attachments || []).map(a => a.name));
  return fm().docs.filter(d => [d.title, d.fileName].some(t => { const n = norm(t); if (!n.startsWith(k)) return false;
    return !names.some(o => norm(o).length > k.length && n.startsWith(norm(o))); }));   // a longer attachment name that also fits wins
}
export const attState = s => { const A = s.attachments || []; return { n: A.length, have: A.filter(a => attDocs(a.name).length).length }; };

/* ---------------- frequency lines: "Monthly by competent and qualified personnel", "Six Monthly and Annual inspections by IQP" */
const FREQ = [[/^daily/i, 1, 'days', 'Daily'], [/^weekly/i, 1, 'weeks', 'Weekly'], [/^(six|6)[- ]?monthly/i, 6, 'months', 'Six-monthly'], [/^(three|3)[- ]?monthly|^quarterly/i, 3, 'months', 'Quarterly'], [/^(two|2)[- ]?monthly/i, 2, 'months', 'Two-monthly'], [/^monthly/i, 1, 'months', 'Monthly'], [/^(two|2)[- ]?yearly|^biennial/i, 2, 'years', 'Two-yearly'], [/^(five|5)[- ]?yearly/i, 5, 'years', 'Five-yearly'], [/^annual(ly)?|^yearly/i, 1, 'years', 'Annual']];
const whoOf = t => /independent(ly)? qualified|\bIQP\b/i.test(t) ? 'IQP' : /owner/i.test(t) ? 'Owner or owner\'s representative' : /competent/i.test(t) ? 'Competent and qualified person' : '';
export function freqsOf(text, kind) {
  const out = [];
  String(text || '').split('\n').forEach(raw => { let t = raw.replace(/^[\s•◦o\-–]+(?=\S)/, '').trim(); const first = FREQ.find(f => f[0].test(t)); if (!first) return;
    const who = whoOf(t), add = f => { if (!out.some(o => o.n === f[1] && o.unit === f[2] && o.who === who)) out.push({ n: f[1], unit: f[2], label: f[3], who, kind, text: t }); };
    add(first); const rest = t.replace(first[0], '').trim(), m = /^(?:and|&|,)\s+(.*)/i.exec(rest); if (m) { const second = FREQ.find(f => f[0].test(m[1])); if (second) add(second); } });
  return out;
}

/* ---------------- the PDF */
const LABELS = [[/^specified system/i, 'group'], [/^description/i, 'desc'], [/^type/i, 'sysType'], [/^make/i, 'make'], [/^location/i, 'location'], [/^performance/i, 'standard'], [/^inspection/i, 'inspections'], [/^interface/i, 'interfaceTest'], [/^maintenance/i, 'maintenance'], [/^reporting/i, 'reporting'], [/^attachment/i, 'att']];
// one page: its words as lines, cut into table rows using the rules drawn under each label cell
async function pageRows(lib, page) {
  const H = page.view[3], c = await page.getTextContent(), ops = await page.getOperatorList();
  const items = c.items.filter(i => i.str && i.str.trim()).map(i => ({ x: i.transform[4], y: H - i.transform[5], w: i.width || 0, s: i.str }));
  // horizontal rules: thin, wide rectangles. The label column's rules mark the rows.
  const rules = []; ops.fnArray.forEach((f, i) => { if (f !== lib.OPS.constructPath) return; const a = ops.argsArray[i]; if (!a || !Array.isArray(a[0]) || !a[1]) return;
    let k = 0; a[0].forEach(op => { if (op === lib.OPS.rectangle) { const [x, y, w, h] = a[1].slice(k, k + 4); if (Math.abs(h) < 1.6 && w > 60) rules.push({ x, y: H - y, w }); k += 4; } else if (op === lib.OPS.moveTo || op === lib.OPS.lineTo) k += 2; else if (op === lib.OPS.curveTo) k += 6; else if (op === lib.OPS.curveTo2 || op === lib.OPS.curveTo3) k += 4; }); });
  const left = rules.filter(r => r.x < 70 && r.w < 220);
  if (left.length < 3) return { rows: [], items, split: 0 };
  const split = Math.max(...left.map(r => r.x + r.w)) - 2, ys = [...new Set(left.map(r => Math.round(r.y)))].sort((a, b) => a - b);
  const rows = []; for (let i = 0; i + 1 < ys.length; i++) { const top = ys[i], bot = ys[i + 1], inb = items.filter(t => t.y > top && t.y <= bot + 1);
    rows.push({ label: lines(inb.filter(t => t.x < split)).map(l => l.t).join(' ').replace(/\s+/g, ' ').trim(), lines: lines(inb.filter(t => t.x >= split)) }); }
  return { rows, items, split };
}
// words to lines; cells in a line that sit well apart are columns of a small table
function lines(items) {
  const L = []; items.slice().sort((a, b) => a.y - b.y || a.x - b.x).forEach(t => { const l = L.find(l => Math.abs(l.y - t.y) < 3.5); if (l) l.it.push(t); else L.push({ y: t.y, it: [t] }); });
  return L.sort((a, b) => a.y - b.y).map(l => { l.it.sort((a, b) => a.x - b.x); let t = '', cols = 1; l.it.forEach((it, i) => { if (i) { const p = l.it[i - 1], gap = it.x - (p.x + p.w); const bullet = /^([•o]|[a-z0-9]{1,2}[.)])$/.test(p.s.trim()); if (gap > 14 && !bullet) { t += ' | '; cols++; } else t += ' '; } t += it.s.trim(); });
    const tx = (l.it.find(it => !/^[•o]$/.test(it.s.trim())) || l.it[0]).x; return { y: l.y, x: l.it[0].x, tx, t: t.replace(/\s+([,.;:)])/g, '$1').replace(/\s+/g, ' ').trim(), cols }; });
}
// lines to text: wrapped lines are joined, bullets kept, a wider gap starts a new paragraph
function prose(L) {
  const out = []; let prev = null;
  L.forEach(l => { let t = l.t; const b = /^•\s*/.test(t), sb = /^o\s+(?=\S)/.test(t); if (b) t = '• ' + t.replace(/^•\s*/, ''); else if (sb) t = '   ◦ ' + t.replace(/^o\s+/, '');
    const near = prev && !b && !sb && l.cols === 1 && prev.cols === 1 && l.y - prev.y < 14.5 && l.x >= prev.tx - 4 && !FREQ.some(f => f[0].test(t)) && !/^S\/?S\s*\d/.test(t) && !/^[a-z0-9]{1,2}[.)]\s/.test(t), cont = near && (!/[.:]$/.test(prev.t) || /^[a-z(]/.test(t));
    if (cont && out.length) out[out.length - 1] += ' ' + t; else out.push(t); prev = l; });
  return out.join('\n').trim();
}
export async function parsePdf(bytes) {
  const lib = await DV.pdfLib(), pdf = await lib.getDocument({ data: new Uint8Array(bytes) }).promise;
  const systems = []; let cur = null, field = '', front = '', all = '';
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n), { rows, items } = await pageRows(lib, page), txt = lines(items).map(l => l.t).join('\n'); all += txt + '\n';
    if (!systems.length && !rows.some(r => /^specified system/i.test(r.label))) { front += txt + '\n'; continue; }
    for (const r of rows) {
      const hit = LABELS.find(l => l[0].test(r.label));
      if (hit && hit[1] === 'group') { cur = { page: n, raw: {}, att: [] }; systems.push(cur); }
      if (!cur) continue;
      if (hit) field = hit[1]; else if (r.label) continue;   // an unknown label: leave it out rather than guess
      if (field === 'att') r.lines.forEach(l => { const p = l.t.split(' | ').map(x => x.trim()).filter(Boolean); if (!p.length || /^(document name|attached to compliance|schedule version)/i.test(p[0])) return; const ver = p.length > 1 && /^\d+$/.test(p[p.length - 1]) ? p.pop() : ''; cur.att.push({ name: p.join(' '), ver }); });
      else (cur.raw[field] = cur.raw[field] || []).push(...r.lines.map(l => ({ ...l, y: l.y + n * 2000 })));
    }
  }
  const out = systems.map(s => { const g = k => prose(s.raw[k] || []), desc = g('desc').replace(/\n/g, ' '), m = /^(?:S\/?S\s*)?(\d+(?:\s*[\/.]\s*\d+)?(?:\s*\([a-z]\))?)\s+(.+)$/i.exec(desc);
    const o = { ss: m ? 'SS ' + m[1].replace(/\s+/g, '').replace('.', '/') : '', name: (m ? m[2] : desc).trim(), group: g('group'), sysType: g('sysType'), make: g('make'), location: g('location'), standard: g('standard'), inspections: g('inspections'), interfaceTest: g('interfaceTest'), maintenance: g('maintenance'), reporting: g('reporting'), attachments: s.att, csPage: s.page };
    o.freqs = [...freqsOf(o.inspections, 'Inspection'), ...freqsOf(o.maintenance, 'Maintenance').filter(f => /maintenance/i.test(f.text))]; return o; }).filter(o => o.ss);
  const f = re => ((re.exec(front) || re.exec(all) || [])[1] || '').replace(/^[\s|]+/, '').split(' | ')[0].trim();
  const issued = toISO(f(/Date of issue:\s*(\d{1,2} \w+ \d{4})/i)), listed = [...front.matchAll(/^\s*S\/?S\s*(\d+(?:\/\d+)?(?:\s*\([a-z]\))?)\s+\S/gim)].map(m => 'SS ' + m[1].replace(/\s+/g, ''));
  return { number: f(/Compliance Schedule(?: No)?:\s*([A-Z]{2,5}\d{5,})/i), issued, address: f(/Street address:\s*(.+)/i), owner: f(/\bName:\s*(.+)/), keptAt: f(/(On site:[^\n]+)/i),
    consent: f(/\b(BCO\d+(?:-\d+)?)/), version: f(/\bV(\d+)\s+SS/) || '1', pages: pdf.numPages, systems: out, listed, missing: listed.filter(l => !out.some(o => ssKey(o.ss) === ssKey(l))) };
}
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
function toISO(t) { const m = /(\d{1,2}) (\w+) (\d{4})/.exec(t || ''); if (!m) return ''; const mo = MONTHS.indexOf(m[2].toLowerCase()); return mo < 0 ? '' : `${m[3]}-${String(mo + 1).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`; }

/* ---------------- tasks the schedule asks for */
const respOf = f => f.who === 'IQP' ? (S.project.iqp || 'IQP') : f.who || 'To be assigned';
function taskFor(s, f, cs) {
  // first one falls due one interval after the schedule was issued; the yearly IQP inspection a month before the BWoF, so the Form 12A is in hand
  const base = cs.issued || new Date().toISOString().slice(0, 10); let due = X.addFreq(base, f.n, f.unit === 'days' ? 'weeks' : f.unit); if (f.unit === 'years' && f.n === 1 && f.who === 'IQP') due = X.addFreq(due, -1, 'months');
  return { id: uid(), title: `${s.ss} ${s.name.split(/ that forms| for communicating| relating/)[0]}: ${f.label.toLowerCase()} ${f.kind.toLowerCase()}${f.who ? ' (' + (f.who === 'IQP' ? 'IQP' : f.who === 'Competent and qualified person' ? 'competent person' : 'owner') + ')' : ''}`,
    category: 'Compliance (BWoF)', ss: s.ss, system: SYS14, freqN: f.unit === 'days' ? 1 : f.n, freqUnit: f.unit === 'days' ? 'weeks' : f.unit, nextDue: due, responsible: respOf(f), standard: s.standard.replace(/\n/g, '; ').slice(0, 300),
    instructions: `From compliance schedule ${cs.number || ''} (page ${s.csPage}): ${f.text}\n\n${f.kind === 'Maintenance' ? s.maintenance : s.inspections}`, csFreq: f.label, csWho: f.who, created: new Date().toISOString(), createdBy: S.user.email };
}
const sameTask = (t, s, f) => ssKey(t.ss) === ssKey(s.ss) && ((t.csFreq === f.label && (t.csWho || '') === f.who) || (!t.csFreq && +t.freqN === f.n && t.freqUnit === f.unit));

/* ---------------- choose the schedule, check what was read, save */
const isCs = d => DV.isPdf(d) && /compliance schedule/i.test(d.title + ' ' + d.fileName) && !/statement|invoice|handbook/i.test(d.title + ' ' + d.fileName);
export function readDialog() {
  if (!can.admin()) return toast('Only an admin can read in the compliance schedule: it sets the key compliance dates.', 6000);
  const L = fm().docs.filter(isCs).sort((a, b) => natural(b.title, a.title));
  modal(`<h2>📄 Read the compliance schedule</h2><p class="note">Choose the compliance schedule the council issued (the full schedule, not the one-page statement). Every specified system is read from it word for word: what it is, where it is, the performance standard, the inspection and maintenance procedures and how often, and the documents it lists as attached. You check the result before anything is saved.</p>
  ${L.length ? `<label class="f full">From the library<select id="csD">${L.map(d => `<option value="${esc(d.id)}">${esc(d.title)}</option>`).join('')}<option value="">Upload a different file…</option></select></label>` : ''}
  <label class="f full" id="csFw" ${L.length ? 'hidden' : ''}>Compliance schedule (PDF)<input type="file" id="csF" accept="application/pdf"></label>
  <div class="act"><button id="csX">Cancel</button><button class="go" id="csGo">Read it</button></div>`);
  if ($('csD')) $('csD').onchange = () => $('csFw').hidden = !!$('csD').value;
  $('csX').onclick = closeModal;
  $('csGo').onclick = async () => { const id = $('csD') && $('csD').value, file = $('csF').files[0]; if (!id && !file) return toast('Choose the compliance schedule PDF');
    closeModal(); const b = busy('Reading the compliance schedule…');
    try { const d = id ? fm().docs.find(x => x.id === id) : null, bytes = d ? await X.getBytes(d.url) : await file.arrayBuffer(), cs = await parsePdf(bytes.slice ? bytes.slice(0) : bytes); b.done();
      if (!cs.systems.length) return toast('No specified systems could be read from this PDF. It needs to be the council\'s compliance schedule with selectable text (not a scan).', 9000);
      preview(cs, d, file); } catch (e) { console.error(e); b.done(); toast('Could not read it: ' + e.message, 8000); } };
}
function preview(cs, d, file) {
  const p = S.project, old = fm().systems, T = fm().tasks, names = cs.systems.flatMap(s => s.attachments.map(a => a.name));
  const rows = cs.systems.map(s => ({ s, ex: old.find(o => ssKey(o.ss) === ssKey(s.ss)), newT: s.freqs.filter(f => !T.some(t => sameTask(t, s, f))) }));
  const extra = old.filter(o => !cs.systems.some(s => ssKey(s.ss) === ssKey(o.ss))), nT = rows.reduce((n, r) => n + r.newT.length, 0), bw = cs.issued ? X.addFreq(cs.issued, 1, 'years') : '';
  const nA = names.length, haveA = names.filter(n => attDocs(n, names).length).length;
  modal(`<h2>Check what was read</h2>
  <div class="kpis"><div class="kpi"><b>${esc(cs.number || '?')}</b><span>Compliance schedule, version ${esc(cs.version)}${cs.consent ? ' · ' + esc(cs.consent) : ''}</span></div><div class="kpi"><b>${cs.issued ? nzDate(cs.issued) : '?'}</b><span>Date of issue</span></div><div class="kpi"><b>${bw ? nzDate(bw) : '?'}</b><span>First BWoF due (12 months from issue)</span></div><div class="kpi" style="--c:${haveA < nA ? '#d98c0d' : '#2e8b57'}"><b>${haveA} / ${nA}</b><span>Attached documents found in the library</span></div></div>
  ${cs.owner ? `<p class="small muted">Owner on the schedule: <b>${esc(cs.owner)}</b>${cs.keptAt ? ' · Kept: ' + esc(cs.keptAt) : ''}</p>` : ''}
  ${cs.missing.length ? `<p class="note" style="border-color:#d64545"><b>Not read:</b> the front page lists ${esc(cs.missing.join(', '))}, but no section for ${cs.missing.length === 1 ? 'it' : 'them'} could be read. Add ${cs.missing.length === 1 ? 'it' : 'them'} by hand after saving.</p>` : ''}
  <table class="ftable"><tr><th>System</th><th>How often, and who</th><th>Documents the schedule attaches</th><th></th></tr>
  ${rows.map(({ s, ex, newT }) => `<tr><td><b>${esc(s.ss)}</b> ${esc(s.name)}<br><span class="muted small">Page ${s.csPage}${s.location ? ' · ' + esc(s.location.split('\n')[0].slice(0, 90)) : ''}</span></td>
    <td class="small">${s.freqs.map(f => `${esc(f.label)} ${esc(f.kind.toLowerCase())}: ${esc(f.who || 'not stated')}${newT.includes(f) ? '' : ' <span class="muted">(task exists)</span>'}`).join('<br>') || '<span class="st st-warn">No frequency read: check page ' + s.csPage + '</span>'}</td>
    <td class="small">${s.attachments.map(a => `${attDocs(a.name, names).length ? '✓' : '<b style="color:#a32222">✗ not in library</b>'} ${esc(a.name)}`).join('<br>') || '<span class="muted">None listed</span>'}</td>
    <td>${ex ? '<span class="st st-info">Update</span>' : '<span class="st st-ok">New</span>'}</td></tr>`).join('')}</table>
  ${extra.length ? `<p class="small muted">Already in the app but not in this schedule (left as they are): ${esc(extra.map(o => o.ss + ' ' + o.name).join('; '))}</p>` : ''}
  <div class="opt"><input type="checkbox" id="csT" ${nT ? 'checked' : 'disabled'}><label for="csT">Create the ${nT} inspection and maintenance task${nT === 1 ? '' : 's'} the schedule asks for. Yearly IQP inspections are set one month before the BWoF is due.</label></div>
  ${p.bwofDue && bw && p.bwofDue !== bw ? `<div class="opt"><input type="checkbox" id="csB" checked><label for="csB">Change the BWoF due date from ${nzDate(p.bwofDue)} to ${nzDate(bw)}</label></div>` : ''}
  <p class="note">The wording of each system is saved exactly as the schedule gives it. Existing Form 12A records are kept.</p>
  <div class="act"><button id="csX">Cancel</button><button class="go" id="csOk">Save ${rows.length} systems</button></div>`, true);
  $('csX').onclick = closeModal;
  $('csOk').onclick = async () => { const mkT = $('csT').checked, setB = !p.bwofDue || ($('csB') && $('csB').checked); closeModal(); const b = busy('Saving…');
    try {
      let docId = d ? d.id : ''; if (!docId && file && X.uploadAs) docId = await X.uploadAs(file, { title: file.name.replace(/\.[^.]+$/, ''), type: 'Consent / authority document', system: SYS14 });
      const now = new Date().toISOString();
      for (const { s, ex } of rows) { const { freqs, ...rest } = s; await S.store.saveItem(p.id, 'systems', { ...(ex || { id: uid(), cert12A: {} }), ...rest, freqs: freqs.map(({ n, unit, label, who, kind, text }) => ({ n, unit, label, who, kind, text })), csNumber: cs.number, csVersion: cs.version, updated: now, updatedBy: S.user.email }); }
      let made = 0; if (mkT) { const list = rows.flatMap(({ s, newT }) => newT.map(f => taskFor(s, f, cs))); if (list.length) await S.store.bulkSave(p.id, 'tasks', list); made = list.length; }
      const patch = { csNumber: cs.number || p.csNumber || '', csIssued: cs.issued, csVersion: cs.version, csKeptAt: cs.keptAt, csDocId: docId, csRead: now }; if (setB && bw) patch.bwofDue = bw;
      await S.store.updateProject(p.id, patch); Object.assign(S.project, patch); b.done(); toast(`${rows.length} specified systems saved${made ? `, ${made} tasks created` : ''}.`, 6000); X.render && X.render();
    } catch (e) { console.error(e); b.done(); toast('Could not save: ' + e.message, 9000); } };
}

/* ---------------- on screen: the schedule's own words for one system, and its attached documents */
export function attHtml(s) {
  const A = s.attachments || []; if (!A.length) return '';
  return `<h3 class="sec">Documents attached to the compliance schedule</h3><div class="hist">${A.map((a, i) => { const D = attDocs(a.name); return `<div>${D.length ? D.map(d => `<a href="#" data-csd="${esc(d.id)}">📄 ${esc(d.title)}</a>`).join('<br>') : `<b style="color:#a32222">Not in the library yet:</b> ${esc(a.name)} <span class="muted small">(upload the file with a name starting with this)</span>`}${a.ver ? ` <span class="muted small">· schedule version ${esc(a.ver)}</span>` : ''}</div>`; }).join('')}</div>`;
}
export function wireAtt(close) {
  document.querySelectorAll('[data-csd]').forEach(a => a.onclick = e => { e.preventDefault(); const d = fm().docs.find(x => x.id === a.dataset.csd); if (!d) return; if (DV.isPdf(d)) { close && close(); DV.open(d); } else window.open(d.url, '_blank'); });
  const o = $('csOpen'); if (o) o.onclick = e => { e.preventDefault(); const d = fm().docs.find(x => x.id === S.project.csDocId); if (!d) return toast('The compliance schedule is no longer in the library'); close && close(); DV.open(d, { page: +o.dataset.pg || 1 }); };
}
export const openLink = (s, label) => S.project.csDocId && fm().docs.some(d => d.id === S.project.csDocId) ? `<a href="#" id="csOpen" data-pg="${s ? s.csPage || 1 : 1}">${label}</a>` : '';
