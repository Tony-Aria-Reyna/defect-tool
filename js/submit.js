// Warranty submissions: the contractor uploads a warranty against the asset that needs it, the app checks it against the
// project's deed standard straight away, and the reviewer accepts it or sends it back with what has to change.
// A submission is an ordinary document with submitted:true and a "sub" record: {kind, status, by, at, note, check, review, history}.
import { S, can } from './state.js';
import { aiCall } from './ai.js';
import * as DV from './docview.js';
import { pageRuns, locate, pageImage, parse } from './docai.js';
import { $, esc, toast, modal, closeModal, busy, uid, nzDate, natural, safeName, deliver, loadScript, stamp } from './util.js';

let X = {};
const VF = { q: '', sys: '', st: '' };
export function init(ctx) { X = ctx; }
const fm = () => S.fm || { assets: [], docs: [] };
const now = () => new Date().toISOString();
const dt = t => t ? nzDate(String(t).slice(0, 10)) : '';
const plain = o => JSON.parse(JSON.stringify(o));

export const STATUS = ['Checking', 'Failed check', 'Awaiting review', 'Sent back', 'Accepted', 'Superseded'];
const ST_CLS = { 'Accepted': 'st-ok', 'Awaiting review': 'st-info', 'Failed check': 'st-bad', 'Sent back': 'st-bad', 'Checking': 'st-grey', 'Superseded': 'st-grey' };
const chip = s => `<span class="st ${ST_CLS[s] || 'st-grey'}">${esc(s === 'Failed check' ? 'Failed check: fix and resubmit' : s || '')}</span>`;
const KIND = { deed: 'Schedule 13 deed (installer or subcontractor)', product: 'Manufacturer or product warranty', other: 'Supporting document (O&M manual, PS3, test record…)' };
export const isSub = d => !!(d && d.submitted && d.sub);
export const subsOf = id => fm().docs.filter(d => isSub(d) && (d.assetIds || []).includes(id)).sort((a, b) => String(b.sub.at || '').localeCompare(String(a.sub.at || '')));
const live = L => L.filter(d => d.sub.status !== 'Superseded');
const assetOf = d => fm().assets.find(a => (d.assetIds || []).includes(a.id));
export const counts = () => { const L = fm().docs.filter(isSub); return { review: L.filter(d => d.sub.status === 'Awaiting review').length, fix: L.filter(d => ['Failed check', 'Sent back'].includes(d.sub.status)).length, accepted: L.filter(d => d.sub.status === 'Accepted').length }; };

/* ================================================================ the standard a document is checked against */
const deedForm = p => p.deedForm || 'NZS 3916:2013 Schedule 13';
const deedPoints = p => [
  ['form', `On the ${deedForm(p)} form`, `The document is the ${deedForm(p)} form of Contractor (or Subcontractor) warranty. A different standard's version (for example NZS 3910 where NZS 3916 is required) or a company's own warranty form does not meet this.`],
  ['principal', `Principal is ${p.client || 'the Principal named in the contract'}`, `The Principal is named exactly as "${p.client || ''}". An address, a council, or another company in that place does not meet this.`],
  ['contractor', `Contractor is ${p.contractor || 'the head contractor'}`, `The Contractor is named as "${p.contractor || ''}". "Ltd" for "Limited" is acceptable. Any extra or different word in the name (for example "North", "Holdings", "Group") is a different company and does not meet this.`],
  ['warrantor', 'Warrantor is a full registered company name', 'The Warrantor is filled in with what reads as a full registered company name (normally ending Limited or Ltd), not a trading name alone and not left as a placeholder.'],
  ['works', 'Warranted Works are clearly described', 'The Warranted Works say which works, systems or products are covered. A blank, a placeholder, or a catch-all such as "workmanship" with nothing else does not meet this.'],
  ['period', 'Warranty Period is stated and runs from Practical Completion', 'A period in years is stated and it runs from the date of Practical Completion. A period running from installation, supply or invoice does not meet this.'],
  ['date', 'Date of the deed is filled in', 'The date at the top of the deed is filled in (not "Click to enter a date" or blank).'],
];
const execPoints = p => [
  ['exec', 'Warrantor has executed it as a deed', 'In the block "SIGNED on behalf of the Warrantor" there are real signatures (handwriting or a pasted signature image) of two directors, OR of one director together with a witness who has signed and added their occupation and address. One director alone with no witness does not meet this. A typed name alone is not a signature.'],
  ['contractorSig', `Contractor block is signed by ${p.contractor || 'the Contractor'}`, `In the block "SIGNED on behalf of the Contractor" there is a real signature. The text "Click to enter text or paste signature" or an empty line means it is not signed. A subcontractor's own name in this block is wrong.`],
  ['principalBlank', `Principal block is left blank for ${p.client || 'the Principal'}`, 'The block "SIGNED on behalf of the Principal" has no signature and no name written in it. It must be left empty for the Principal to sign later. Any signature or name in it does not meet this.'],
];
const productPoints = p => [
  ['owner', `Names ${p.client || 'the owner'} or this property`, `The warranty names "${p.client || ''}" as the owner or customer, or it clearly identifies this project or property (${[p.name, p.address].filter(Boolean).join(', ')}). Naming a council or a different owner does not meet this.`],
  ['product', 'Product or system covered is identified', 'It says which product, system or installation it covers.'],
  ['period', 'Warranty period is stated', 'A warranty period is stated.'],
  ['issuer', 'Issued by the manufacturer or supplier', 'It is issued by a named manufacturer or supplier and carries a date, a reference number or a signature.'],
  ['complete', 'Completed, not a blank template', 'The details are filled in. A template with empty fields for the parties, works or periods does not meet this.'],
];
const MARK_KIND = { principal: 'Parties', contractor: 'Parties', warrantor: 'Parties', owner: 'Parties', period: 'Warranty period', date: 'Date', exec: 'Execution and signatures', contractorSig: 'Execution and signatures', principalBlank: 'Execution and signatures' };

function brief(p, a, points, where) {
  return `You are checking a construction warranty document in New Zealand before the Principal's project manager accepts it. Check ONLY the numbered points below, strictly and literally. Do not be generous: if a point is not clearly met, it is not met.

PROJECT: ${p.name || ''}${p.address ? ', ' + p.address : ''}
PRINCIPAL: ${p.client || '(not recorded)'}
HEAD CONTRACTOR: ${p.contractor || '(not recorded)'}
THE ELEMENT THIS WAS SUBMITTED FOR: ${[a && a.ref, a && a.element, a && a.installer ? 'installer ' + a.installer : ''].filter(Boolean).join(' · ') || '(not recorded)'}${a && /\d+\s*(yr|year|month)/i.test(a.instWarranty || '') ? '\nPERIOD THE CONTRACT REQUIRES FOR THIS ELEMENT: ' + a.instWarranty + ' (a shorter stated period does not meet the period point)' : ''}
${p.aiContext ? 'PROJECT NOTES: ' + String(p.aiContext).slice(0, 2500) + '\n' : ''}
POINTS TO CHECK
${points.map(([k, , rule]) => `${k}: ${rule}`).join('\n')}

Answer with JSON only, in this shape:
{"warrantor":"company giving the warranty","works":"what it covers, short","period":"the period as written","date":"the date as written","items":[{"k":"point key","ok":true,"found":"what the document actually says or shows for this point, under 25 words","fix":"exactly what has to change, written to the contractor, under 30 words; empty when ok is true","page":1,${where}}]}
Give one item for every point key listed. "ok" is true when the point is met, false when it is not, and null only when what you were given does not let you tell.`;
}
const Q_TEXT = '"quote":"6 to 15 words copied exactly from the document at the place this point is decided"';
const Q_BOX = '"box":[x,y,w,h] as fractions 0 to 1 of the picture width and height measured from the top left, drawn tightly around the place this point is decided';

/* ================================================================ the check */
export async function runCheck(d0, onProg = () => {}) {
  let d = fm().docs.find(x => x.id === d0.id) || d0; const p = S.project, a = assetOf(d), kind = d.sub.kind, hist = (d.sub.history || []).slice();
  const save = async (status, check, extra = {}) => {
    const sub = { ...d.sub, status, check, history: [...hist, { t: now(), who: 'Automatic check', txt: check.error ? 'Could not be checked automatically: ' + check.error : check.skipped ? 'Not a warranty: no automatic check.' : (check.items.filter(i => i.ok === false).length ? check.items.filter(i => i.ok === false).length + ' point(s) to fix.' : 'All points passed.') }] };
    const patch = plain({ sub, ...extra }); await S.store.patchItem(p.id, 'docs', d.id, patch); d = { ...d, ...patch }; return d;
  };
  if (kind === 'other' || !DV.isPdf(d)) return save('Awaiting review', { at: now(), skipped: true, items: [] });
  let pdf = null;
  try {
    onProg('Opening the document…'); const L = await DV.pdfLib(); pdf = await DV.loadPdf(d); const n = pdf.numPages, pages = {};
    const page = async k => pages[k] || (pages[k] = await (async () => { const pg = await pdf.getPage(k), runs = await pageRuns(L, pg); return { pg, runs, t: runs.map(r => r.s).join(' ').replace(/\s+/g, ' ').trim() }; })());
    const first = Math.min(n, 3); for (let k = 1; k <= first; k++) await page(k);
    const scanned = pages[1].t.length < 200, found = {}, meta = {};
    const take = (j, pgNo) => { if (!j) return; ['warrantor', 'works', 'period', 'date'].forEach(k => { if (j[k] && !meta[k]) meta[k] = String(j[k]).slice(0, 200); }); (j.items || []).forEach(it => { if (it && it.k) found[it.k] = { ...it, page: Math.max(1, Math.min(n, +it.page || pgNo || 1)) }; }); };
    const front = kind === 'deed' ? deedPoints(p) : productPoints(p);
    // the front matter: from the words where the PDF has them, from a picture of page 1 where it is a scan
    const askFront = async () => {
      onProg(scanned ? 'Reading page 1 (scanned)…' : 'Reading the parties, works and period…');
      if (scanned) return take(parse(await aiCall(brief(p, a, front, Q_BOX) + '\n\nThe picture is page 1 of ' + n + ' of a scanned document. Use "page":1.', await pageImage(pages[1].pg))), 1);
      const txt = [...Array(first)].map((_, i) => `--- PAGE ${i + 1} ---\n${pages[i + 1].t.slice(0, 5000)}`).join('\n');
      take(parse(await aiCall(brief(p, a, front, Q_TEXT) + '\n\nTHE DOCUMENT TEXT\n' + txt)));
    };
    // the execution page is always looked at as a picture: a typed name is not a signature
    const askExec = async () => {
      if (kind !== 'deed') return; let ex = n;
      for (let k = Math.min(n, 12); k >= 1; k--) { const t = (await page(k)).t; if (/signed\s+(on behalf|by)|in witness/i.test(t)) { ex = k; break; } }
      onProg('Looking at the signatures on page ' + ex + '…');
      take(parse(await aiCall(brief(p, a, execPoints(p), Q_BOX) + `\n\nThe picture is page ${ex} of ${n}: the execution (signature) page. Judge the signatures from what you can SEE in the picture, not from the typed names. Use "page":${ex}.`, await pageImage((await page(ex)).pg))), ex);
    };
    await askFront(); await askExec();
    const defs = kind === 'deed' ? [...deedPoints(p), ...execPoints(p)] : front;
    if (!defs.some(([k]) => found[k])) throw new Error('the AI answer could not be read');
    const items = defs.map(([k, label]) => { const r = found[k] || {}; return { k, label, ok: r.ok === true ? true : r.ok === false ? false : null, found: String(r.found || '').slice(0, 240), fix: r.ok === true ? '' : String(r.fix || '').slice(0, 300) }; });
    // a box on the page for every point that failed, so the marked-up copy shows where
    const marks = [];
    for (const it of items.filter(i => i.ok === false)) {
      const r = found[it.k]; let box = null;
      if (Array.isArray(r.box) && r.box.length === 4 && r.box.every(v => typeof v === 'number')) { const [x, y, w, h] = r.box.map(v => Math.max(0, Math.min(1, v))); if (w > 0.01 && h > 0.005) box = { x, y, w: Math.min(w, 1 - x), h: Math.min(h, 1 - y) }; }
      if (!box && r.quote) { try { box = locate((await page(r.page)).runs, r.quote); } catch (e) {} }
      if (!box) continue;
      marks.push({ id: uid(), page: r.page, ...box, kind: MARK_KIND[it.k] || 'Other', period: it.label.slice(0, 160), text: it.found, flag: it.fix || it.label, note: '', assetIds: (d.assetIds || []).slice(), taskIds: [], ai: true, chk: true, updated: now(), by: 'Automatic check' });
    }
    const fails = items.filter(i => i.ok === false);
    return await save(fails.length ? 'Failed check' : 'Awaiting review', { at: now(), items, ...meta, via: (aiCall.last && aiCall.last.via) || '' },
      { marks: [...(d.marks || []).filter(m => !m.chk), ...marks], aiRead: now(), aiSummary: [meta.warrantor, meta.works, meta.period].filter(Boolean).join(' · ').slice(0, 400), aiProblems: [...new Set([...(d.marks || []).filter(m => !m.chk && m.flag).map(m => m.flag), ...fails.map(i => i.fix || i.label)])].slice(0, 14) });
  } catch (e) {
    console.warn('submission check', e);
    return save('Awaiting review', { at: now(), error: e.message === 'offline' ? 'no connection at the time' : (e.message || 'the check did not run'), items: [] });
  } finally { try { pdf && pdf.destroy(); } catch (e) {} }
}

/* ================================================================ submit */
export function submitDialog(a, replaces) {
  const k0 = replaces ? replaces.sub.kind : 'deed';
  modal(`<h2>⬆ Submit for ${esc(a.ref || '')} ${esc(a.element || '')}</h2>
  ${replaces ? `<p class="note">This replaces <b>${esc(replaces.fileName || replaces.title)}</b> (${esc(replaces.sub.status)}). The earlier version is kept in the history.</p>` : ''}
  <p class="muted small">${[a.installer ? 'Installer: ' + esc(a.installer) : '', a.instWarranty ? 'Required from the installer: ' + esc(a.instWarranty) : '', a.mfrWarranty && a.mfrWarranty !== '-' ? 'Required from the manufacturer: ' + esc(a.mfrWarranty) : ''].filter(Boolean).join(' · ')}</p>
  <p class="lbl2">What are you submitting?</p>
  <div class="sbk">${Object.entries(KIND).map(([k, l]) => `<label><input type="radio" name="sbK" value="${k}" ${k === k0 ? 'checked' : ''}> ${esc(l)}</label>`).join('')}</div>
  <label class="f" id="sbTW" style="display:none">Document type<select id="sbT">${(X.DOC_TYPES || []).filter(t => !/^Warranty/.test(t)).map(t => `<option>${esc(t)}</option>`).join('')}</select></label>
  <label class="f">File (PDF)<input type="file" id="sbF" accept=".pdf,application/pdf"></label>
  <label class="f">Note to the reviewer (optional)<textarea id="sbN" rows="2" placeholder="e.g. Signed copy to follow by post"></textarea></label>
  <p class="note" id="sbHint"></p>
  <div class="act"><button id="sbX">Cancel</button><button class="go" id="sbGo">Upload and check</button></div>`);
  const kind = () => document.querySelector('input[name="sbK"]:checked').value;
  const sync = () => { const k = kind(); $('sbTW').style.display = k === 'other' ? '' : 'none'; $('sbF').accept = k === 'other' ? '' : '.pdf,application/pdf'; $('sbHint').textContent = k === 'deed' ? 'It is checked straight away: form, parties, works, period, date and signatures. You will see the result in about a minute and can fix anything before it goes for review.' : k === 'product' ? 'It is checked straight away: owner or property named, product, period and issuer.' : 'Supporting documents go straight to the reviewer.'; };
  document.querySelectorAll('input[name="sbK"]').forEach(r => r.onchange = sync); sync();
  $('sbX').onclick = () => replaces ? detail(replaces) : closeModal();
  $('sbGo').onclick = async () => {
    const f = $('sbF').files[0], k = kind(), note = $('sbN').value.trim(); if (!f) return toast('Choose the file first');
    if (!f.size) return toast('That file reads as empty (0 bytes). If it is in OneDrive, open it once so it downloads, then choose it again.', 9000);
    if (f.size > 150e6) return toast('That file is over 150 MB');
    if (k !== 'other' && !/\.pdf$/i.test(f.name)) return toast('Warranties must be submitted as a PDF');
    const type = k === 'deed' ? 'Warranty (Schedule 13 deed)' : k === 'product' ? 'Warranty (product)' : $('sbT').value;
    closeModal(); const b = busy('Uploading ' + f.name + '…'), pid = S.project.id, id = uid();
    let d;
    try {
      const path = `projects/${pid}/docs/${id}/${safeName(f.name)}`, url = await S.store.putFile(path, f);
      d = { id, title: `${a.installer ? a.installer + ' - ' : ''}${k === 'deed' ? 'Schedule 13 Deed' : k === 'product' ? 'Product Warranty' : type} - ${a.element || ''}`.slice(0, 180), type, system: a.system || '', party: a.installer || '', assetIds: [a.id], url, path, fileName: f.name, size: f.size, mime: f.type || 'application/pdf', srcPath: '', taskId: '', audience: 'FM', created: now(), createdBy: S.user.email, submitted: true, source: false, marks: [],
        sub: { kind: k, status: 'Checking', by: S.user.email, byName: S.user.name, at: now(), note, replaces: replaces ? replaces.id : '', history: [{ t: now(), who: S.user.name, txt: 'Submitted' + (replaces ? ' as a corrected version' : '') + (note ? ': ' + note : '') + '.' }] } };
      await S.store.saveItem(pid, 'docs', plain(d));
      if (replaces && replaces.sub.status !== 'Accepted') { try { await S.store.patchItem(pid, 'docs', replaces.id, { sub: plain({ ...replaces.sub, status: 'Superseded', history: [...(replaces.sub.history || []), { t: now(), who: S.user.name, txt: 'Replaced by a corrected version.' }] }) }); } catch (e) { console.warn('supersede', e); } }
    } catch (e) { b.done(); return toast(e.message === 'offline' ? 'No connection: the file was not uploaded. Try again when you are back online.' : 'Could not upload: ' + e.message, 8000); }
    try { d = await runCheck(d, b.set); } catch (e) { console.warn(e); }
    b.done(); try { X.render(); } catch (e) {} detail(d);
  };
}

/* ================================================================ one submission: result, actions, history */
const ICON = { true: '✓', false: '✗', null: '?' };
const checkHtml = c => !c ? '<p class="muted small">Not checked yet.</p>' : c.error ? `<p class="note">The automatic check could not run (${esc(c.error)}). It has gone to the reviewer as it is. Use “Check again” to retry.</p>` : c.skipped ? '<p class="muted small">Supporting document: no automatic check.</p>'
  : `<div class="ckl">${c.items.map(i => `<div class="ck ${i.ok === true ? 'ok' : i.ok === false ? 'bad' : 'unk'}"><i>${ICON[i.ok]}</i><div><b>${esc(i.label)}</b>${i.found ? `<small>Found: ${esc(i.found)}</small>` : ''}${i.ok === false && i.fix ? `<small class="fix">To fix: ${esc(i.fix)}</small>` : ''}${i.ok === null ? '<small>Could not be told from the document: the reviewer will check this.</small>' : ''}</div></div>`).join('')}</div>`;
const handMarks = d => (d.marks || []).filter(m => !m.chk && (m.flag || m.note)).sort((x, y) => x.page - y.page || x.y - y.y);
// shown in the document viewer's side panel
export function boxHtml(d) {
  if (!isSub(d)) return ''; const s = d.sub, c = s.check, bad = c && c.items ? c.items.filter(i => i.ok === false) : [];
  return `<div class="dvctx"><b>Submission</b> ${chip(s.status)}<br><span class="small muted">Submitted ${esc(dt(s.at))} by ${esc(s.byName || s.by || '')}</span>${s.review && s.review.note ? `<br><span class="small" style="color:#a32222"><b>Reviewer:</b> ${esc(s.review.note).replace(/\n/g, '<br>')}</span>` : ''}${bad.length ? '<br><span class="small" style="color:#a32222"><b>To fix:</b><br>' + bad.map(i => '• ' + esc(i.fix || i.label)).join('<br>') + '</span>' : c && c.items && c.items.length ? '<br><span class="small" style="color:#1d6e43">Automatic check: all points passed.</span>' : ''}</div>`;
}
export function detail(d0) {
  const d = fm().docs.find(x => x.id === d0.id) || d0, s = d.sub, a = assetOf(d), c = s.check, hm = handMarks(d), ed = can.edit(), wr = can.write();
  const open = !['Accepted', 'Superseded'].includes(s.status);
  modal(`<h2>${esc(a ? (a.ref || '') + ' ' + (a.element || '') : d.title)}</h2>
  <p>${chip(s.status)} <span class="muted small">${esc(KIND[s.kind] || '')} · ${esc(d.fileName || '')} · submitted ${esc(dt(s.at))} by ${esc(s.byName || s.by || '')}</span></p>
  ${s.note ? `<p class="small"><b>Submitter's note:</b> ${esc(s.note)}</p>` : ''}
  ${s.review && s.review.note ? `<div class="sbrev ${s.status === 'Accepted' ? 'ok' : ''}"><b>${s.status === 'Accepted' ? 'Accepted' : 'Sent back'} by ${esc(s.review.byName || s.review.by || '')}, ${esc(dt(s.review.at))}</b><br>${esc(s.review.note).replace(/\n/g, '<br>')}</div>` : ''}
  ${c && c.items && c.items.length ? `<p class="muted small">${[c.warrantor && 'Warrantor: ' + esc(c.warrantor), c.works && 'Works: ' + esc(c.works), c.period && 'Period: ' + esc(c.period), c.date && 'Dated: ' + esc(c.date)].filter(Boolean).join(' · ')}</p>` : ''}
  <h3 class="sec">Automatic check${c && c.at ? ` <span class="muted small">${esc(dt(c.at))}</span>` : ''}</h3>${checkHtml(c)}
  ${hm.length ? `<h3 class="sec">Marked on the document (${hm.length})</h3>${hm.map(m => `<div class="ck bad"><i>▭</i><div><b>Page ${m.page}</b>${m.flag ? `<small class="fix">${esc(m.flag)}</small>` : ''}${m.note ? `<small>${esc(m.note)}</small>` : ''}</div></div>`).join('')}` : ''}
  <div class="sbact">
    <button class="btn2 go" id="sdOpen">▭ Open and mark up</button><button class="btn2" id="sdOrig">⬇ Original</button><button class="btn2" id="sdMk">⬇ With markup</button>
    ${wr && open && (ed || s.status !== 'Sent back') ? '<button class="btn2" id="sdRe">↻ Check again</button>' : ''}
    ${wr && a && s.status !== 'Superseded' ? '<button class="btn2" id="sdNew">⬆ Upload corrected version</button>' : ''}
    ${wr && s.status === 'Failed check' ? '<button class="btn2" id="sdAny">Send for review anyway</button>' : ''}
  </div>
  ${ed && s.status !== 'Superseded' ? `<div class="sbact rev"><span class="muted small">Reviewer:</span>${s.status !== 'Accepted' ? '<button class="btn2 go" id="sdAcc">✔ Accept</button>' : ''}<button class="btn2 warn" id="sdBack">↩ Send back with what to change</button></div>` : ''}
  <details class="sbhist"><summary>History (${(s.history || []).length})</summary>${(s.history || []).slice().reverse().map(h => `<div class="small"><b>${esc(dt(h.t))}</b> · ${esc(h.who || '')}: ${esc(h.txt || '')}</div>`).join('')}</details>
  <div class="act"><button id="sdX">Close</button></div>`, true);
  $('sdX').onclick = closeModal;
  $('sdOpen').onclick = () => { if (!DV.isPdf(d)) return openFile(d); closeModal(); DV.open(d, { ret: () => detail(d) }); };
  $('sdOrig').onclick = () => original(d); $('sdMk').onclick = () => markedPdf(d);
  if ($('sdRe')) $('sdRe').onclick = async () => { closeModal(); const b = busy('Checking again…'); let r = d; try { r = await runCheck({ ...d, sub: { ...s, status: 'Checking' } }, b.set); } catch (e) { toast('Could not check: ' + e.message, 6000); } b.done(); detail(r); };
  if ($('sdNew')) $('sdNew').onclick = () => submitDialog(a, d);
  if ($('sdAny')) $('sdAny').onclick = () => noteBox('Send for review anyway', 'Tell the reviewer why the points above do not apply (optional)', 'Send for review', async note => { await setStatus(d, 'Awaiting review', 'Sent for review with check points outstanding' + (note ? ': ' + note : '') + '.', { note: [s.note, note].filter(Boolean).join(' | ') }); toast('Sent for review'); });
  if ($('sdAcc')) $('sdAcc').onclick = () => decide(d, true);
  if ($('sdBack')) $('sdBack').onclick = () => decide(d, false);
}
async function setStatus(d, status, txt, extra = {}) {
  const cur = fm().docs.find(x => x.id === d.id) || d, sub = plain({ ...cur.sub, ...extra, status, history: [...(cur.sub.history || []), { t: now(), who: S.user.name, txt }] });
  await S.store.patchItem(S.project.id, 'docs', d.id, { sub }); const r = { ...cur, sub }; try { X.render(); } catch (e) {} detail(r); return r;
}
function noteBox(title, ask, btn, go) {
  modal(`<h2>${esc(title)}</h2><label class="f">${esc(ask)}<textarea id="nbT" rows="4"></textarea></label><div class="act"><button id="nbX">Cancel</button><button class="go" id="nbGo">${esc(btn)}</button></div>`);
  $('nbX').onclick = closeModal; $('nbGo').onclick = async () => { const v = $('nbT').value.trim(); try { await go(v); } catch (e) { toast('Could not save: ' + e.message, 7000); } };
}
// Accept, or send back with a list of what to change. The list starts from the failed check points and anything marked on the document.
function decide(d0, accept) {
  const d = fm().docs.find(x => x.id === d0.id) || d0, s = d.sub, a = assetOf(d), c = s.check;
  const fixes = [...((c && c.items) || []).filter(i => i.ok === false).map(i => i.fix || i.label), ...handMarks(d).map(m => `Page ${m.page}: ${m.flag || m.note}`)];
  const stOpts = accept ? ['Received', 'Partial', ''] : ['Revision required', ''];
  modal(`<h2>${accept ? '✔ Accept' : '↩ Send back'}: ${esc(a ? (a.ref || '') + ' ' + (a.element || '') : d.title)}</h2>
  ${accept && fixes.length ? `<p class="note">${fixes.length} point(s) are still flagged on this document. Accept only if you are satisfied they do not matter.</p>` : ''}
  <label class="f">${accept ? 'Note (optional)' : 'What has to change (the contractor sees this, with your boxes on the document)'}<textarea id="dcN" rows="${accept ? 3 : 8}">${accept ? '' : esc(fixes.map((f, i) => `${i + 1}. ${f}`).join('\n'))}</textarea></label>
  ${a ? `<label class="f">Set the asset's document status to<select id="dcS">${stOpts.map(o => `<option value="${o}">${o ? o + (o === 'Partial' ? ' (other documents still needed)' : o === 'Received' ? ' (everything for this element is in)' : '') : 'Leave as it is (' + esc(a.status || '') + ')'}</option>`).join('')}</select></label>` : ''}
  ${accept ? '' : '<p class="muted small">Tip: use “Open and mark up” first to draw a box around each thing that is wrong. The boxes appear here and in the contractor\'s marked-up copy.</p>'}
  <div class="act"><button id="dcX">Cancel</button><button class="go" id="dcGo">${accept ? 'Accept' : 'Send back'}</button></div>`);
  $('dcX').onclick = () => detail(d);
  $('dcGo').onclick = async () => {
    const note = $('dcN').value.trim(), st = $('dcS') ? $('dcS').value : ''; if (!accept && !note) return toast('Say what has to change, so the contractor knows what to fix');
    const b = busy('Saving…');
    try {
      const r = await setStatus(d, accept ? 'Accepted' : 'Sent back', (accept ? 'Accepted' : 'Sent back') + (note ? ': ' + note.replace(/\n+/g, ' ') : '') + '.', { review: { by: S.user.email, byName: S.user.name, at: now(), note, accepted: accept } });
      if (a && st && st !== a.status) await S.store.patchItem(S.project.id, 'assets', a.id, { status: st });
      b.done();
      if (accept) return toast('Accepted');
      const link = location.origin + location.pathname, body = `${a ? (a.ref || '') + ' ' + (a.element || '') : d.title}\nDocument: ${d.fileName || d.title}\n\nThis has been sent back. What has to change:\n\n${note}\n\nOpen it in Resero Site (Assets & warranties > Warranty submissions) to see the marked-up copy and upload the corrected version:\n${link}`;
      modal(`<h2>Sent back</h2><p>${esc(s.byName || s.by || 'The contractor')} will see this under <b>Warranty submissions</b>, with your note and the boxes on the document.</p><p class="muted small">The app does not send emails by itself. Use the button to tell them now.</p><div class="act"><button id="sbD">Done</button><a class="sbmail" id="sbM" href="mailto:${esc(s.by || '')}?subject=${encodeURIComponent((S.project.name || '') + ': warranty sent back, ' + (a ? a.element : d.title))}&body=${encodeURIComponent(body)}">✉ Email ${esc(s.byName || s.by || 'them')}</a></div>`);
      $('sbD').onclick = () => detail(r); $('sbM').onclick = () => setTimeout(() => detail(r), 400);
    } catch (e) { b.done(); toast('Could not save: ' + e.message, 7000); }
  };
}
async function openFile(d) { try { const u = await S.store.resolveUrl(d.url); if (u) window.open(u, '_blank', 'noopener'); } catch (e) { toast('Could not open: ' + e.message); } }
export async function original(d) {
  const b = busy('Fetching the original…');
  try { const buf = await X.getBytes(d.url); b.done(); deliver(new Blob([buf], { type: d.mime || 'application/pdf' }), d.fileName || (safeName(d.title) + '.pdf'), 'Original'); }
  catch (e) { b.done(); toast('Could not download: ' + e.message, 6000); }
}

/* ================================================================ marked-up copy: the original with every box drawn on it, then a summary page */
const latin = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/•/g, '-').replace(/[^\n\x20-\x7e\xa0-\xff]/g, '');
export async function markedPdf(d0) {
  const d = fm().docs.find(x => x.id === d0.id) || d0; if (!DV.isPdf(d)) return toast('Only PDF documents can be marked up');
  const b = busy('Building the marked-up copy…');
  try {
    if (!window.PDFLib) await loadScript('lib/pdf-lib.min.js');
    const P = window.PDFLib, doc = await P.PDFDocument.load(await X.getBytes(d.url), { ignoreEncryption: true }), f = await doc.embedFont(P.StandardFonts.Helvetica), fb = await doc.embedFont(P.StandardFonts.HelveticaBold);
    const RED = P.rgb(0.78, 0.13, 0.13), BLUE = P.rgb(0.14, 0.36, 0.6), NAVY = P.rgb(0.004, 0.11, 0.21), GREY = P.rgb(0.4, 0.45, 0.5), GREEN = P.rgb(0.11, 0.43, 0.26), AMB = P.rgb(0.54, 0.37, 0);
    const marks = (d.marks || []).slice().sort((x, y) => x.page - y.page || x.y - y.y), pages = doc.getPages();
    marks.forEach((m, i) => {
      const pg = pages[m.page - 1]; if (!pg) return; const { width: W, height: H } = pg.getSize(), R = ((pg.getRotation().angle % 360) + 360) % 360;
      // fractions are of the page as it is viewed; turn them back into the page's own coordinates when the page is rotated
      const map = (u, v) => R === 90 ? [v * W, u * H] : R === 180 ? [W - u * W, v * H] : R === 270 ? [W - v * W, H - u * H] : [u * W, H - v * H];
      const [ax, ay] = map(m.x, m.y), [bx, by] = map(m.x + m.w, m.y + m.h), x = Math.min(ax, bx), y = Math.min(ay, by), w = Math.abs(bx - ax), h = Math.abs(by - ay), col = m.flag ? RED : BLUE;
      pg.drawRectangle({ x, y, width: w, height: h, borderColor: col, borderWidth: 1.6, color: col, opacity: 0.07, borderOpacity: 1 });
      const [cx, cy] = map(m.x, m.y), n = String(i + 1); pg.drawCircle({ x: cx, y: cy, size: 8, color: col });
      pg.drawText(n, { x: cx - fb.widthOfTextAtSize(n, 8) / 2, y: cy - 2.8, size: 8, font: fb, color: P.rgb(1, 1, 1) });
    });
    // summary
    const W = 595.28, H = 841.89, M = 44; let pg = null, y = 0;
    const wrap = (t, font, size, maxw) => { const out = []; latin(t).split('\n').forEach(par => { let line = ''; par.split(/\s+/).forEach(w => { const tr = line ? line + ' ' + w : w; if (font.widthOfTextAtSize(tr, size) <= maxw) line = tr; else { if (line) out.push(line); line = w; } }); out.push(line); }); return out; };
    const newPage = () => { pg = doc.addPage([W, H]); pg.drawRectangle({ x: 0, y: H - 46, width: W, height: 46, color: NAVY }); pg.drawText('Review markup', { x: M, y: H - 30, size: 15, font: fb, color: P.rgb(1, 1, 1) }); pg.drawText(latin(S.project.name || ''), { x: W - M - f.widthOfTextAtSize(latin(S.project.name || ''), 9), y: H - 28, size: 9, font: f, color: P.rgb(1, 1, 1) }); y = H - 70; };
    const line = (t, o = {}) => { const size = o.size || 9.5, font = o.bold ? fb : f, ind = o.ind || 0; wrap(t, font, size, W - 2 * M - ind).forEach(l => { if (y < 56) newPage(); pg.drawText(l, { x: M + ind, y, size, font, color: o.color || P.rgb(0.1, 0.14, 0.18) }); y -= size + 3.5; }); y -= o.gap || 0; };
    newPage(); const s = d.sub, a = assetOf(d);
    line(d.title, { bold: true, size: 12, gap: 2 }); line([d.fileName, a ? (a.ref || '') + ' ' + (a.element || '') : '', 'printed ' + nzDate(now().slice(0, 10))].filter(Boolean).join('  |  '), { color: GREY, gap: 6 });
    if (s) { line(`Status: ${s.status}   |   Submitted ${dt(s.at)} by ${s.byName || s.by || ''}`, { bold: true, gap: 4 });
      if (s.review && s.review.note) { line((s.review.accepted ? 'Accepted' : 'Sent back') + ` by ${s.review.byName || s.review.by || ''}, ${dt(s.review.at)}:`, { bold: true, color: s.review.accepted ? GREEN : RED }); line(s.review.note, { ind: 10, gap: 8 }); }
      const c = s.check; if (c && c.items && c.items.length) { line('Automatic check', { bold: true, size: 11, color: NAVY, gap: 2 });
        c.items.forEach(i => { line(`${i.ok === true ? 'PASS ' : i.ok === false ? 'FIX  ' : 'CHECK'}   ${i.label}`, { bold: true, color: i.ok === true ? GREEN : i.ok === false ? RED : AMB }); if (i.found) line('Found: ' + i.found, { ind: 44, color: GREY }); if (i.ok === false && i.fix) line('To fix: ' + i.fix, { ind: 44 }); y -= 3; }); y -= 6; } }
    line(`Boxes marked on the document (${marks.length})`, { bold: true, size: 11, color: NAVY, gap: 2 });
    if (!marks.length) line('Nothing has been marked on the pages.', { color: GREY });
    marks.forEach((m, i) => { line(`${i + 1}.  Page ${m.page}  |  ${m.period || m.kind || ''}`, { bold: true, color: m.flag ? RED : BLUE }); if (m.flag) line('To fix: ' + m.flag, { ind: 16 }); if (m.note) line('Note: ' + m.note, { ind: 16 }); if (m.text) line('"' + m.text.slice(0, 260) + '"', { ind: 16, color: GREY }); y -= 3; });
    const out = await doc.save(); b.done(); deliver(new Blob([out], { type: 'application/pdf' }), `${safeName((d.fileName || d.title).replace(/\.pdf$/i, ''))} - with markup - ${stamp()}.pdf`, 'Marked-up copy');
  } catch (e) { console.error(e); b.done(); toast('Could not build the marked-up copy: ' + e.message, 7000); }
}

/* ================================================================ the list: every element, what is needed, what has been submitted */
export function view(tabs) {
  const A = fm().assets.slice().sort((a, b) => natural(a.system, b.system) || natural(a.ref || '', b.ref || '')), q = VF.q.toLowerCase(), C = counts(), wr = can.write();
  const state = a => { const L = live(subsOf(a.id)); return { L, review: L.some(d => d.sub.status === 'Awaiting review'), fix: L.some(d => ['Failed check', 'Sent back'].includes(d.sub.status)), acc: L.some(d => d.sub.status === 'Accepted') }; };
  const rows = A.map(a => ({ a, ...state(a) })).filter(({ a, L, review, fix, acc }) => a.status !== 'Not applicable' && (!VF.sys || a.system === VF.sys) && (!q || [a.ref, a.element, a.product, a.installer].join(' ').toLowerCase().includes(q))
    && (!VF.st || (VF.st === 'out' ? !['Received'].includes(a.status) && !review : VF.st === 'review' ? review : VF.st === 'fix' ? fix : VF.st === 'acc' ? acc : true)));
  let last = '';
  $('fmView').innerHTML = `<div class="fbar"><h2>Assets &amp; warranties</h2><input type="search" id="svQ" placeholder="Search element, product, installer…" value="${esc(VF.q)}"><select id="svS"><option value="">All systems</option>${(X.SYSTEMS || []).map(s => `<option ${s === VF.sys ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select><select id="svT">${[['', 'Everything'], ['out', 'Still outstanding'], ['fix', 'Needs fixing (' + C.fix + ')'], ['review', 'Awaiting review (' + C.review + ')'], ['acc', 'Accepted (' + C.accepted + ')']].map(([v, l]) => `<option value="${v}" ${v === VF.st ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
  ${tabs}
  <p class="muted small">${can.edit() ? `${C.review} awaiting your review · ${C.fix} with the contractor to fix · ${C.accepted} accepted.` : `Submit each warranty against the element it covers. It is checked straight away so you can fix anything before it is reviewed. ${C.fix} need fixing · ${C.review} with the reviewer · ${C.accepted} accepted.`}</p>
  ${rows.length ? `<table class="ftable sbt"><tr><th>Ref</th><th>Element</th><th class="hm">Required</th><th>Status</th><th>Submitted</th><th></th></tr>
  ${rows.map(({ a, L }) => { const g = a.system !== last ? `<tr class="grp"><td colspan="6">${esc(a.system)}</td></tr>` : ''; last = a.system;
    return g + `<tr><td>${esc(a.ref || '')}</td><td><b>${esc(a.element || '')}</b><br><span class="muted small">${esc([a.installer, a.product].filter(Boolean).join(' · '))}</span></td><td class="hm small">${esc([a.instWarranty && 'Installer: ' + a.instWarranty, a.mfrWarranty && a.mfrWarranty !== '-' && 'Manufacturer: ' + a.mfrWarranty].filter(Boolean).join(' · '))}</td><td><span class="st ${a.status === 'Received' ? 'st-ok' : a.status === 'Not received' ? 'st-bad' : 'st-warn'}">${esc(a.status || '')}</span></td><td>${L.map(d => `<a href="#" class="sbchip" data-sd="${esc(d.id)}" title="${esc(d.fileName || d.title)}">${chip(d.sub.status)}<small>${esc(d.sub.kind === 'deed' ? 'Deed' : d.sub.kind === 'product' ? 'Product' : 'Supporting')} · ${esc(dt(d.sub.at))}</small></a>`).join('') || '<span class="muted small">Nothing yet</span>'}</td><td>${wr ? `<button class="btn2 sm" data-sub="${esc(a.id)}">⬆ Submit</button>` : ''}</td></tr>`; }).join('')}</table>` : '<div class="empty2">Nothing matches. Change the filter to see more.</div>'}`;
  $('svQ').oninput = e => { VF.q = e.target.value; X.render(); const i = $('svQ'); if (i) { i.focus(); i.setSelectionRange(VF.q.length, VF.q.length); } };
  $('svS').onchange = e => { VF.sys = e.target.value; X.render(); }; $('svT').onchange = e => { VF.st = e.target.value; X.render(); };
  document.querySelectorAll('[data-sub]').forEach(b => b.onclick = () => submitDialog(fm().assets.find(a => a.id === b.dataset.sub)));
  document.querySelectorAll('[data-sd]').forEach(l => l.onclick = e => { e.preventDefault(); const d = fm().docs.find(x => x.id === l.dataset.sd); if (d) detail(d); });
}
