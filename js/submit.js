// Warranty submissions: the contractor uploads a warranty against the asset that needs it, the app checks it against the
// project's deed standard straight away, and the reviewer accepts it or sends it back with what has to change.
// A submission is an ordinary document with submitted:true and a "sub" record: {kind, status, by, at, note, check, review, history}.
import { S, can } from './state.js';
import { aiCall } from './ai.js';
import * as DV from './docview.js';
import * as Deed from './deed.js';
import { pageRuns, locate, pageImage, parse } from './docai.js';
import { $, esc, toast, modal, closeModal, busy, confirmBox, uid, nzDate, natural, safeName, deliver, loadScript, stamp } from './util.js';

let X = {};
const VF = { q: '', sys: '', st: '' };
export function init(ctx) { X = ctx; Deed.init(ctx); }
export function setShowSubs(f) { X.showSubs = f; }
const fm = () => S.fm || { assets: [], docs: [] };
const now = () => new Date().toISOString();
const dt = t => t ? nzDate(String(t).slice(0, 10)) : '';
const plain = o => JSON.parse(JSON.stringify(o));

export const STATUS = ['Checking', 'Failed check', 'Awaiting review', 'Sent back', 'Accepted', 'Superseded'];
const ST_CLS = { 'Accepted': 'st-ok', 'Awaiting review': 'st-info', 'Failed check': 'st-bad', 'Sent back': 'st-bad', 'Checking': 'st-grey', 'Superseded': 'st-grey' };
const chip = s => `<span class="st ${ST_CLS[s] || 'st-grey'}">${s === 'Checking' ? '<i class="sbspin"></i>' : ''}${esc(s === 'Failed check' ? 'Failed check: fix and resubmit' : s === 'Checking' ? 'Checking…' : s || '')}</span>`;
// The kinds of document that can be submitted. Built in: the NZS 3910/3916 schedules and the usual securities.
// A project can add its own under Project settings > Warranty and guarantee types (checked with general points).
const KIND0 = {
  deed: ['Schedule 13 deed (installer or subcontractor warranty)', 'Sch 13 deed', 'Schedule 13 Deed', 'Warranty (Schedule 13 deed)'],
  sch19: ['Schedule 19 weathertightness guarantee (Contractor)', 'Sch 19 guarantee', 'Schedule 19 Weathertightness Guarantee', 'Guarantee (Schedule 19 weathertightness)'],
  sch18: ['Schedule 18 parent company guarantee', 'Sch 18 PCG', 'Schedule 18 Parent Company Guarantee', 'Guarantee (Schedule 18 parent company)'],
  bond: ['Bond or bank guarantee (performance, retention, advance payment)', 'Bond', 'Bond', 'Bond / security'],
  product: ['Manufacturer or product warranty', 'Product warranty', 'Product Warranty', 'Warranty (product)'],
  other: ['Supporting document (O&M manual, PS3, test record…)', 'Supporting', '', ''],
};
const customKinds = () => String((S.project && S.project.guaranteeTypes) || '').split('\n').map(x => x.trim()).filter(Boolean).slice(0, 20);
const kinds = () => { const o = { ...KIND0 }; customKinds().forEach(n => { o['c:' + n] = [n, n.slice(0, 22), n, n]; }); return o; };
const KIND = new Proxy({}, { get: (_, k) => (kinds()[k] || [])[0] });
export const kindOpts = sel => Object.entries(kinds()).map(([k, v]) => `<option value="${esc(k)}" ${k === sel ? 'selected' : ''}>${esc(v[1])}</option>`).join('');
const isDeedLike = k => ['deed', 'sch19', 'sch18'].includes(k);
export const isSub = d => !!(d && d.submitted && d.sub);
export const subsOf = id => fm().docs.filter(d => isSub(d) && (d.assetIds || []).includes(id)).sort((a, b) => String(b.sub.at || '').localeCompare(String(a.sub.at || '')));
const live = L => L.filter(d => d.sub.status !== 'Superseded');
const assetOf = d => fm().assets.find(a => (d.assetIds || []).includes(a.id));
export const counts = () => { const L = fm().docs.filter(isSub); return { review: L.filter(d => d.sub.status === 'Awaiting review').length, fix: L.filter(d => ['Failed check', 'Sent back'].includes(d.sub.status)).length, accepted: L.filter(d => d.sub.status === 'Accepted').length }; };

/* ================================================================ naming convention: [Contractor] - [Document type] - [What it covers] (warranty length) */
const TYPE_LBL = new Proxy({}, { get: (_, k) => (kinds()[k] || [])[2] || undefined });
const TYPE_SHORT = [[/o&m/i, 'O&M Manual'], [/care/i, 'Care & Maintenance Guide'], [/producer|certificate/i, 'Producer Statement'], [/commission|test/i, 'Commissioning & Test Record'], [/as-built/i, 'As-Built Drawing'], [/data sheet/i, 'Product Data Sheet']];
const FOLDER = [[/schedule 13/i, 'Warranties/Schedule 13 Deeds'], [/warranty/i, 'Warranties/Product Warranties'], [/o&m/i, 'O&M Manuals'], [/care/i, 'Care & Maintenance Guides'], [/producer|certificate/i, 'Producer Statements & Certificates'], [/commission|test/i, 'Commissioning & Test Data'], [/as-built/i, 'As-Built Drawings'], [/data sheet/i, 'Product Data Sheets']];
const tidy = t => String(t || '').replace(/\s+/g, ' ').replace(/[.\s]+$/, '').trim();
export const fileSafe = t => String(t || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 170);
// While points are open the name says so, the way the filed copies do; the tag drops off once it is accepted.
export function convName(d, sub = d.sub) {
  if (sub.nameFixed) return d.title;
  const c = sub.check || {}, a = assetOf(d), items = c.items || [], bad = k => items.some(i => i.k === k && i.ok === false);
  let tag = '';
  if (sub.status !== 'Accepted' && items.length) { const t = [bad('form') && 'wrong form', bad('contractor') && 'Contractor misnamed', bad('principal') && 'Principal misnamed', bad('owner') && 'owner not named', bad('complete') && 'blank template', (bad('exec') || bad('contractorSig')) && 'execution incomplete', bad('principalBlank') && 'Principal block signed', bad('contractDate') && 'contract date blank', bad('signed') && 'unsigned', bad('amount') && 'no amount'].filter(Boolean), n = items.filter(i => i.ok === false).length; tag = t.length ? ` (${t.slice(0, 2).join(', ')})` : n ? ` (${n} to fix)` : ''; }
  const who = tidy(c.warrantor || d.party || (a && a.installer) || 'Unknown'), type = TYPE_LBL[sub.kind] || (TYPE_SHORT.find(([re]) => re.test(d.type || '')) || [0, d.type || 'Document'])[1];
  const works = tidy(c.worksShort || (a && a.element) || ''), per = tidy(c.periodShort || '');
  return `${who} - ${type}${tag}${works ? ' - ' + works : ''}${per ? ` (${per})` : ''}`.slice(0, 180);
}
const ext = d => (/\.[a-z0-9]{2,5}$/i.exec(d.fileName || '') || ['.pdf'])[0].toLowerCase();
const folderOf = d => `${d.system || 'Unsorted'}/${(FOLDER.find(([re]) => re.test(d.type || '')) || [0, 'Other'])[1]}`;

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
const ctr = p => p.contractor || 'the Contractor', prn = p => p.client || 'the Principal';
const sch19Points = p => [
  ['form', 'On the contract\'s Schedule 19 weathertightness guarantee form', 'The document is the contract\'s Schedule 19 form of weathertightness guarantee given by the Contractor, not a subcontractor warranty or a company\'s own form.'],
  ['principal', `In favour of ${prn(p)}`, `The guarantee is given to "${prn(p)}" by name. Any other company, a council or a former owner does not meet this.`],
  ['contractor', `Given by ${ctr(p)}`, `The Contractor giving the guarantee is "${ctr(p)}". "Ltd" for "Limited" is acceptable; any extra or different word (for example "North", "Holdings") is a different company.`],
  ['contractDate', 'Contract date filled in', 'The date of the construction contract is filled in where the form asks for it. "[insert date]", a blank or a placeholder does not meet this.'],
  ['period', 'Guarantee period stated from the PC certificate', 'The guarantee period is stated (normally 10 years) and runs from the date of the practical completion certificate.'],
  ['date', 'Date of the deed filled in', 'The date of the deed itself is filled in.'],
];
const sch18Points = p => [
  ['form', 'On the contract\'s Schedule 18 parent company guarantee form', 'The document is the contract\'s Schedule 18 form of parent company guarantee.'],
  ['principal', `In favour of ${prn(p)}`, `The guarantee is given to "${prn(p)}" by name.`],
  ['contractor', `Guarantees ${ctr(p)}`, `The company whose obligations are guaranteed is "${ctr(p)}". Any extra or different word in the name is a different company.`],
  ['guarantor', 'Guarantor is the parent company, named in full', 'The guarantor is a different company from the Contractor (the parent or holding company), named with its full registered name.'],
  ['contractDate', 'Contract date filled in', 'The date of the construction contract is filled in. "[●]", "[insert date]" or a blank does not meet this.'],
  ['date', 'Date of the deed filled in', 'The date of the deed itself is filled in.'],
];
const bondPoints = p => [
  ['issuer', 'Issued by a bank or insurer', 'The bond or guarantee is issued by a named bank, insurer or surety company, on its letterhead or form.'],
  ['principal', `Beneficiary is ${prn(p)}`, `The beneficiary (the party that can call on it) is "${prn(p)}".`],
  ['contractor', `On behalf of ${ctr(p)}`, `It is given on behalf of "${ctr(p)}". Any extra or different word in the name is a different company.`],
  ['amount', 'Amount stated', 'A sum of money is stated, in figures or words.'],
  ['expiry', 'Expiry or release stated', 'An expiry date, or the event on which it is released or reduced (for example practical completion or the end of the defects period), is stated.'],
  ['signed', 'Signed by the issuer', 'It is signed for the bank, insurer or surety (a signature can be seen, or it states it is digitally signed).'],
];
const customPoints = (p, name) => [
  ['form', `It is a ${name}`, `The document is a ${name}.`],
  ['principal', `Names ${prn(p)} or this property`, `It names "${prn(p)}" as the party it is given to, or clearly identifies this project or property (${[p.name, p.address].filter(Boolean).join(', ')}).`],
  ['party', 'Who gives it is named in full', 'The company or person giving it is named in full.'],
  ['works', 'What it covers is clear', 'It says what works, products or obligations it covers.'],
  ['period', 'Period or expiry stated', 'A period, an expiry date or a release event is stated.'],
  ['date', 'Dated', 'It carries a date.'],
];
const execFor = (p, k) => k === 'deed' ? execPoints(p) : k === 'sch19' ? [
  ['exec', `${ctr(p)} has executed it as a deed`, `In the block for the Contractor (or Guarantor) there are real signatures (handwriting or a pasted signature image) of two directors, OR of one director together with a witness who has signed and added their occupation and address. Check the company named in the execution block is "${ctr(p)}", not a holding company or another company. A typed name alone is not a signature.`],
  ['principalBlank', `Principal block left blank for ${prn(p)}`, 'Any block for the Principal has no signature in it.'],
] : k === 'sch18' ? [
  ['exec', 'Guarantor has executed it as a deed', 'In the block for the Guarantor (the parent company) there are real signatures of two directors, OR of one director with a witness who has signed and added their occupation and address. A typed name alone is not a signature.'],
  ['principalBlank', `Principal block left blank for ${prn(p)}`, 'Any block for the Principal has no signature in it.'],
] : [];
const frontFor = (p, k) => k === 'deed' ? deedPoints(p) : k === 'sch19' ? sch19Points(p) : k === 'sch18' ? sch18Points(p) : k === 'bond' ? bondPoints(p) : String(k).startsWith('c:') ? customPoints(p, k.slice(2)) : productPoints(p);
const MARK_KIND = { contractDate: 'Date', guarantor: 'Parties', issuer: 'Parties', amount: 'Other', expiry: 'Date', signed: 'Execution and signatures', party: 'Parties', principal: 'Parties', contractor: 'Parties', warrantor: 'Parties', owner: 'Parties', period: 'Warranty period', date: 'Date', exec: 'Execution and signatures', contractorSig: 'Execution and signatures', principalBlank: 'Execution and signatures' };

function brief(p, a, points, where) {
  return `You are checking a construction warranty document in New Zealand before the Principal's project manager accepts it. Check ONLY the numbered points below, strictly and literally. Do not be generous: if a point is not clearly met, it is not met.

PROJECT: ${p.name || ''}${p.address ? ', ' + p.address : ''}
PRINCIPAL: ${p.client || '(not recorded)'}
HEAD CONTRACTOR: ${p.contractor || '(not recorded)'}
THE ELEMENT THIS WAS SUBMITTED FOR: ${[a && a.ref, a && a.element, a && a.installer ? 'installer ' + a.installer : ''].filter(Boolean).join(' · ') || '(not recorded)'}${a && /\d+\s*(yr|year|month)/i.test(a.instWarranty || '') ? '\nPERIOD THE CONTRACT REQUIRES FOR THIS ELEMENT: ' + a.instWarranty + ' (a shorter stated period does not meet the period point)' : ''}
${p.deedNotes ? 'WARRANTY RULES FOR THIS PROJECT (these override anything general): ' + String(p.deedNotes).slice(0, 5000) + '\n' : ''}${p.aiContext ? 'PROJECT NOTES: ' + String(p.aiContext).slice(0, 2500) + '\n' : ''}
POINTS TO CHECK
${points.map(([k, , rule]) => `${k}: ${rule}`).join('\n')}

Answer with JSON only, in this shape:
{"warrantor":"company giving the warranty","works":"what it covers, short","period":"the period as written","date":"the date as written","worksShort":"what it covers in 2 to 6 words in Title Case, e.g. Archimax Cladding Installation","periodShort":"the period in short form, e.g. 5yr, or 10yr materials, 2yr workmanship","items":[{"k":"point key","ok":true,"found":"what the document actually says or shows for this point, under 25 words","fix":"exactly what has to change, written to the contractor, under 30 words; empty when ok is true","page":1,${where}}]}
Give one item for every point key listed. "ok" is true when the point is met, false when it is not, and null only when what you were given does not let you tell.`;
}
const Q_TEXT = '"quote":"6 to 15 words copied exactly from the document at the place this point is decided"';
const Q_BOX = '"box":[x,y,w,h] as fractions 0 to 1 of the picture width and height measured from the top left, drawn tightly around the place this point is decided';

/* ================================================================ the check */
export async function runCheck(d0, onProg = () => {}) {
  let d = fm().docs.find(x => x.id === d0.id) || d0; const p = S.project, a = assetOf(d), kind = d.sub.kind, hist = (d.sub.history || []).slice();
  const save = async (status, check, extra = {}) => {
    const sub = { ...d.sub, status, check, history: [...hist, { t: now(), who: 'Automatic check', txt: check.error ? 'Could not be checked automatically: ' + check.error : check.skipped ? 'Not a warranty: no automatic check.' : (check.items.filter(i => i.ok === false).length ? check.items.filter(i => i.ok === false).length + ' point(s) to fix.' : 'All points passed.') }] };
    const patch = plain({ sub, ...extra }); patch.title = convName({ ...d, ...patch }, sub); if (sub.check && sub.check.warrantor) patch.party = String(sub.check.warrantor).slice(0, 80); await S.store.patchItem(p.id, 'docs', d.id, patch); d = { ...d, ...patch }; return d;
  };
  if (kind === 'other' || !DV.isPdf(d)) return save('Awaiting review', { at: now(), skipped: true, items: [] });
  let pdf = null;
  try {
    onProg('Opening the document…'); const L = await DV.pdfLib(); pdf = await DV.loadPdf(d); const n = pdf.numPages, pages = {};
    const page = async k => pages[k] || (pages[k] = await (async () => { const pg = await pdf.getPage(k), runs = await pageRuns(L, pg); return { pg, runs, t: runs.map(r => r.s).join(' ').replace(/\s+/g, ' ').trim() }; })());
    const first = Math.min(n, 3); for (let k = 1; k <= first; k++) await page(k);
    const scanned = pages[1].t.length < 200, found = {}, meta = {};
    const take = (j, pgNo) => { if (!j) return; ['warrantor', 'works', 'period', 'date', 'worksShort', 'periodShort'].forEach(k => { if (j[k] && !meta[k]) meta[k] = String(j[k]).slice(0, 200); }); (j.items || []).forEach(it => { if (it && it.k) found[it.k] = { ...it, page: Math.max(1, Math.min(n, +it.page || pgNo || 1)) }; }); };
    const front = frontFor(p, kind), execs = execFor(p, kind);
    // the front matter: from the words where the PDF has them, from a picture of page 1 where it is a scan
    const askFront = async () => {
      onProg(scanned ? 'Reading page 1 (scanned)…' : 'Reading the parties, works and period…');
      if (scanned) return take(parse(await aiCall(brief(p, a, front, Q_BOX) + '\n\nThe picture is page 1 of ' + n + ' of a scanned document. Use "page":1.', await pageImage(pages[1].pg))), 1);
      const txt = [...Array(first)].map((_, i) => `--- PAGE ${i + 1} ---\n${pages[i + 1].t.slice(0, 5000)}`).join('\n');
      take(parse(await aiCall(brief(p, a, front, Q_TEXT) + '\n\nTHE DOCUMENT TEXT\n' + txt)));
    };
    // the execution page is always looked at as a picture: a typed name is not a signature
    const askExec = async () => {
      if (!execs.length) return; let ex = n;
      for (let k = Math.min(n, 12); k >= 1; k--) { const t = (await page(k)).t; if (/signed\s+(on behalf|by)|in witness/i.test(t)) { ex = k; break; } }
      onProg('Looking at the signatures on page ' + ex + '…');
      take(parse(await aiCall(brief(p, a, execs, Q_BOX) + `\n\nThe picture is page ${ex} of ${n}: the execution (signature) page. Judge the signatures from what you can SEE in the picture, not from the typed names. Use "page":${ex}.`, await pageImage((await page(ex)).pg))), ex);
    };
    await Promise.all([askFront(), askExec()]);
    const defs = [...front, ...execs];
    if (!defs.some(([k]) => found[k])) throw new Error('the AI answer could not be read');
    const items = defs.map(([k, label]) => { const r = found[k] || {}; return { k, label, ok: r.ok === true ? true : r.ok === false ? false : null, found: String(r.found || '').slice(0, 240), fix: r.ok === true ? '' : String(r.fix || '').slice(0, 300) }; });
    // a box on the page for every point that failed, so the marked-up copy shows where
    const marks = [];
    for (const it of items.filter(i => i.ok !== null)) {
      const r = found[it.k]; let box = null;
      if (Array.isArray(r.box) && r.box.length === 4 && r.box.every(v => typeof v === 'number')) { const [x, y, w, h] = r.box.map(v => Math.max(0, Math.min(1, v))); if (w > 0.01 && h > 0.005) box = { x, y, w: Math.min(w, 1 - x), h: Math.min(h, 1 - y) }; }
      if (!box && r.quote) { try { box = locate((await page(r.page)).runs, r.quote); } catch (e) {} }
      if (!box) continue;
      marks.push({ id: uid(), page: r.page, ...box, kind: MARK_KIND[it.k] || 'Other', period: it.label.slice(0, 160), text: it.found, flag: it.ok === false ? (it.fix || it.label) : '', note: '', ck: it.k, pass: it.ok === true || undefined, assetIds: (d.assetIds || []).slice(), taskIds: [], ai: true, chk: true, updated: now(), by: 'Automatic check' });
    }
    const fails = items.filter(i => i.ok === false);
    return await save(fails.length ? 'Failed check' : 'Awaiting review', { at: now(), items, ...meta, via: (aiCall.last && aiCall.last.via) || '' },
      { marks: [...(d.marks || []).filter(m => !m.chk), ...marks], aiRead: now(), aiSummary: [meta.warrantor, meta.works, meta.period].filter(Boolean).join(' · ').slice(0, 400), aiProblems: [...new Set([...(d.marks || []).filter(m => !m.chk && m.flag).map(m => m.flag), ...fails.map(i => i.fix || i.label)])].slice(0, 14) });
  } catch (e) {
    console.warn('submission check', e);
    return save('Awaiting review', { at: now(), error: e.message === 'offline' ? 'no connection at the time' : (e.message || 'the check did not run'), items: [] });
  } finally { try { pdf && pdf.destroy(); } catch (e) {} }
}

/* ================================================================ background checks: up to three at once, the page stays usable */
const Q = [], RUN = new Set(); let running = 0;
export const checking = id => RUN.has(id) || Q.some(d => d.id === id);
export function enqueue(d) { if (checking(d.id)) return; Q.push(d); pump(); }
function pump() {
  while (running < 3 && Q.length) { const d = Q.shift(); running++; RUN.add(d.id); refresh();
    runCheck(d).then(r => { const n = ((r.sub.check || {}).items || []).filter(i => i.ok === false).length; toast(`${r.title.split(' - ')[0]}: ${r.sub.check && r.sub.check.error ? 'could not be checked automatically' : n ? n + ' point' + (n === 1 ? '' : 's') + ' to fix' : 'passed the check'}`, 4000); })
      .catch(e => console.warn('check', e)).finally(() => { running--; RUN.delete(d.id); refresh(); pump(); }); }
}
const refresh = () => { try { X.render(); } catch (e) {} try { if (DV.current() && RUN.size >= 0) DV.refreshSide(); } catch (e) {} };
// a check left half way (page closed while it ran) is picked up again
function resume() { if (!can.write()) return; fm().docs.filter(d => isSub(d) && d.sub.status === 'Checking' && !checking(d.id) && Date.now() - Date.parse(d.sub.at || 0) > 120000).slice(0, 10).forEach(enqueue); }

async function upload(f, a, k, note, replaces, type) {
  const pid = S.project.id, id = uid(), path = `projects/${pid}/docs/${id}/${safeName(f.name)}`, url = await S.store.putFile(path, f);
  const d = { id, title: `${a.installer ? a.installer + ' - ' : ''}${TYPE_LBL[k] || type} - ${a.element || ''}`.slice(0, 180), type, system: a.system || '', party: a.installer || '', assetIds: [a.id], url, path, fileName: f.name, size: f.size, mime: f.type || 'application/pdf', srcPath: '', taskId: '', audience: 'FM', created: now(), createdBy: S.user.email, submitted: true, source: false, marks: [],
    sub: { kind: k, status: 'Checking', by: S.user.email, byName: S.user.name, at: now(), note, replaces: replaces ? replaces.id : '', history: [{ t: now(), who: S.user.name, txt: 'Submitted' + (replaces ? ' as a corrected version' : '') + (note ? ': ' + note : '') + '.' }] } };
  await S.store.saveItem(pid, 'docs', plain(d));
  if (replaces && replaces.sub.status !== 'Accepted') { try { await S.store.patchItem(pid, 'docs', replaces.id, { sub: plain({ ...replaces.sub, status: 'Superseded', history: [...(replaces.sub.history || []), { t: now(), who: S.user.name, txt: 'Replaced by a corrected version.' }] }) }); } catch (e) { console.warn('supersede', e); } }
  return d;
}
const typeOf = (k, t) => (kinds()[k] || [])[3] || t;

/* ================================================================ smart element picker: type any part of the ref, element, company, product or system */
const ALIAS = { hwc: 'hot water cylinder', ps3: 'producer statement', om: 'o&m', sch: 'schedule', ac: 'air conditioning heat pump', hvac: 'heat pump ventilation', ff: 'fire', bwof: 'compliance', tank: 'rainwater tank', gutter: 'gutter spouting membrane', roof: 'roof roofing', door: 'door doors', window: 'window joinery glazing', wall: 'wall cladding plaster' };
const pickText = a => [a.ref, a.element, a.installer, a.product, a.system].join(' ').toLowerCase();
function rank(q, A) {
  const W = q.toLowerCase().split(/[^a-z0-9&]+/).filter(Boolean).flatMap(w => [w, ...(ALIAS[w] ? ALIAS[w].split(' ') : [])]); if (!W.length) return A;
  return A.map(a => { const t = pickText(a), el = String(a.element || '').toLowerCase(); let sc = 0; for (const w of W) { if (el.startsWith(w)) sc += 5; else if (new RegExp('\\b' + w.replace(/[^a-z0-9]/g, '')).test(el)) sc += 4; else if (t.includes(w)) sc += 2; else if (w.length > 4 && t.includes(w.slice(0, -1))) sc += 1; } return { a, sc }; }).filter(x => x.sc > 0).sort((x, y) => y.sc - x.sc || natural(x.a.ref || '', y.a.ref || '')).map(x => x.a);
}
const label = a => a ? `${a.ref || ''} ${a.element}${a.installer ? ' (' + a.installer + ')' : ''}` : '';
export const pickHtml = (key, a, ph) => `<div class="apk" data-apk="${esc(key)}" data-id="${esc(a ? a.id : '')}"><input type="search" placeholder="${esc(ph || 'Type to find the element…')}" value="${esc(label(a))}" autocomplete="off"><div class="apkl" hidden></div></div>`;
export const pickVal = key => { const el = document.querySelector(`[data-apk="${key}"]`); return el ? el.dataset.id : ''; };
export function wirePicks(A, onPick) {
  document.querySelectorAll('[data-apk]').forEach(box => { if (box.dataset.w) return; box.dataset.w = 1; const inp = box.querySelector('input'), list = box.querySelector('.apkl'); let hits = [], hi = 0;
    const draw = () => { hits = rank(inp.value === label(A.find(a => a.id === box.dataset.id)) ? '' : inp.value, A).slice(0, 40); hi = 0; list.innerHTML = hits.map((a, i) => `<div data-i="${i}" class="${i === hi ? 'on' : ''}"><b>${esc(a.ref || '')}</b> ${esc(a.element)}<small>${esc([a.installer, a.product].filter(Boolean).join(' · '))}</small></div>`).join('') || '<p class="muted small">No element matches. Try another word.</p>'; list.hidden = false; };
    const choose = a => { box.dataset.id = a ? a.id : ''; inp.value = label(a); list.hidden = true; onPick && onPick(box.dataset.apk, a); };
    inp.onfocus = () => { inp.select(); draw(); }; inp.oninput = draw;
    inp.onkeydown = e => { if (list.hidden) return; if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); hi = Math.max(0, Math.min(hits.length - 1, hi + (e.key === 'ArrowDown' ? 1 : -1))); list.querySelectorAll('[data-i]').forEach(d => d.classList.toggle('on', +d.dataset.i === hi)); list.querySelector('.on')?.scrollIntoView({ block: 'nearest' }); } else if (e.key === 'Enter') { e.preventDefault(); if (hits[hi]) choose(hits[hi]); } else if (e.key === 'Escape') { list.hidden = true; inp.value = label(A.find(a => a.id === box.dataset.id)); } };
    list.onmousedown = e => { const d = e.target.closest('[data-i]'); if (d) { e.preventDefault(); choose(hits[+d.dataset.i]); } };
    inp.onblur = () => setTimeout(() => { list.hidden = true; if (!inp.value.trim()) choose(null); else inp.value = label(A.find(a => a.id === box.dataset.id)); }, 150);
  });
}

/* ================================================================ drop many at once: each file is matched to its element, you confirm, they upload and check in the background */
const words = t => String(t || '').toLowerCase().replace(/\.pdf$/, '').split(/[^a-z0-9]+/).filter(w => w.length > 2 && !['the', 'and', 'ltd', 'limited', 'schedule', 'warranty', 'deed', 'signed', 'pdf', 'godley', 'road', 'for'].includes(w));
function guess(name) {
  const W = words(name); let best = null, bs = 0;
  for (const a of fm().assets) { if (a.status === 'Not applicable') continue; const hay = words([a.installer, a.element, a.product].join(' ')); const sc = W.filter(w => hay.some(h => h.startsWith(w) || w.startsWith(h))).length; if (sc > bs) { bs = sc; best = a; } }
  const k = kindFromText(name);
  // a contract-wide guarantee goes on its own element when the register has one
  const own = { sch19: /weathertight/i, sch18: /parent company/i, bond: /bond|retention|security/i }[k];
  if (own) { const hit = fm().assets.find(a => own.test(a.element || '')); if (hit) return { a: hit, k, sure: true }; }
  return { a: bs ? best : null, k, sure: bs >= 2 };
}
async function aiGuess(f, rows) {
  try { const L = await DV.pdfLib(), pdf = await L.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise; const pg = await pdf.getPage(1), t = (await pageRuns(L, pg)).map(r => r.s).join(' ').replace(/\s+/g, ' ').slice(0, 2500);
    const list = fm().assets.filter(a => a.status !== 'Not applicable').map(a => `${a.ref} | ${a.element} | ${a.installer || ''} | ${a.product || ''}`).join('\n').slice(0, 9000);
    const ask = `Match this construction warranty document to the one element it covers. Answer JSON only: {"ref":"the element ref from the list","kind":"deed" for a Schedule 13 / contractor warranty deed, "product" for a manufacturer or product warranty, "other" for anything else}.\n\nELEMENTS (ref | element | installer | product)\n${list}\n\nFILE NAME: ${f.name}\n`;
    const j = parse(await aiCall(t.length > 150 ? ask + 'PAGE 1 TEXT: ' + t : ask + 'The picture is page 1.', t.length > 150 ? undefined : await pageImage(pg))); pdf.destroy();
    return j && { a: fm().assets.find(a => String(a.ref) === String(j.ref)), k: ['deed', 'product', 'other'].includes(j.kind) ? j.kind : null };
  } catch (e) { console.warn('match', e); return null; }
}
export function bulk(files) {
  if (!can.write()) return toast('Your role cannot submit documents');
  const L = files.filter(f => /\.pdf$/i.test(f.name)), skipped = files.length - L.length; if (!L.length) return toast('Drop PDF files here. Warranties must be PDFs.');
  const A = fm().assets.filter(a => a.status !== 'Not applicable').sort((a, b) => natural(a.system, b.system) || natural(a.ref || '', b.ref || ''));
  const opt = id => `<option value="">Choose the element…</option>` + A.map(a => `<option value="${esc(a.id)}" ${a.id === id ? 'selected' : ''}>${esc((a.ref || '') + ' ' + a.element + (a.installer ? ' (' + a.installer + ')' : ''))}</option>`).join('');
  const rows = L.map(f => ({ f, ...guess(f.name) }));
  modal(`<h2>⬆ Submit ${L.length} document${L.length === 1 ? '' : 's'}</h2><p class="note">Each file has been matched to the element it most likely covers${skipped ? ` (${skipped} non-PDF file${skipped === 1 ? '' : 's'} left out)` : ''}. Check the matches, then submit. They upload and are checked in the background, so you can carry on working.</p>
  <table class="ftable bkt"><tr><th>File</th><th>Element</th><th>Type</th></tr>${rows.map((r, i) => `<tr><td class="small">${esc(r.f.name)}<br><span class="muted" id="bkS${i}">${r.sure ? 'matched by name' : 'matching…'}</span></td><td>${pickHtml('bkA' + i, r.a)}</td><td><select id="bkK${i}">${kindOpts(r.k)}</select></td></tr>`).join('')}</table>
  <div class="act"><button id="bkX">Cancel</button><button class="go" id="bkGo">Submit and check</button></div>`, true);
  $('bkX').onclick = closeModal; const touched = new Set(); wirePicks(A, k => touched.add(k));
  rows.forEach(async (r, i) => { if (r.sure) return; const g = await aiGuess(r.f); const box = document.querySelector(`[data-apk="bkA${i}"]`); if (!box) return; if (g && g.a && !touched.has('bkA' + i)) { box.dataset.id = g.a.id; box.querySelector('input').value = label(g.a); $('bkS' + i).textContent = 'matched by reading page 1'; } else $('bkS' + i).textContent = g && g.a ? '' : 'no match found: choose it'; if (g && g.k && !$('bkK' + i).dataset.touched) $('bkK' + i).value = g.k; });
  L.forEach((_, i) => { $('bkK' + i).onchange = e => e.target.dataset.touched = 1; });
  $('bkGo').onclick = async () => {
    const go = L.map((f, i) => ({ f, a: fm().assets.find(a => a.id === pickVal('bkA' + i)), k: $('bkK' + i).value }));
    const miss = go.filter(x => !x.a).length; if (miss) return toast(`Choose the element for ${miss} file${miss === 1 ? '' : 's'}`);
    closeModal(); const b = busy('Uploading…'); let n = 0;
    try { for (const x of go) { b.set(`Uploading ${++n} of ${go.length}: ${x.f.name}`); enqueue(await upload(x.f, x.a, x.k, '', null, typeOf(x.k, 'Other'))); } b.done(); toast(`${go.length} uploaded. Checking in the background: the results appear in the list as they finish.`, 6000); }
    catch (e) { b.done(); toast(`Stopped after ${n - 1}: ${e.message}`, 8000); }
    try { X.showSubs ? X.showSubs() : X.render(); } catch (e) {}
  };
}

/* ================================================================ link what is already in the library: no upload, the document becomes a submission and is checked */
const libCands = () => fm().docs.filter(d => !d.submitted && !d.superseded && !d.template && DV.isPdf(d) && !/(^|\/)Superseded\//i.test(d.srcPath || '') && !/superseded/i.test(d.title || ''));
const isWarr = d => /warrant|deed|guarant|bond|security/i.test([d.type, d.title, d.fileName].join(' '));
export function kindFromText(t) {
  t = String(t || ''); const c = customKinds().find(n => t.toLowerCase().includes(n.toLowerCase())); if (c) return 'c:' + c;
  return /schedule\s*19|sch\s*19|weather\s*tight/i.test(t) ? 'sch19' : /schedule\s*18|sch\s*18|parent\s*company/i.test(t) ? 'sch18' : /\bbond\b|bank guarantee|retention|performance security|advance payment/i.test(t) ? 'bond' : /schedule\s*13|sch\s*13|deed/i.test(t) ? 'deed' : /warrant|guarant/i.test(t) ? 'product' : 'other';
}
const kindOf = d => kindFromText([d.type, d.title, d.fileName].join(' '));
async function convert(d, a, k) {
  const sub = { kind: k, status: 'Checking', by: S.user.email, byName: S.user.name, at: now(), note: 'Linked from the document library.', replaces: '', history: [{ t: now(), who: S.user.name, txt: 'Linked from the document library and submitted for checking.' }] };
  const patch = plain({ submitted: true, source: false, assetIds: [...new Set([a.id, ...(d.assetIds || [])])], type: typeOf(k, d.type), system: d.system || a.system || '', sub });
  await S.store.patchItem(S.project.id, 'docs', d.id, patch); const r = { ...d, ...patch }; enqueue(r); return r;
}
export function linkExisting(a) {
  const W = words([a.installer, a.element, a.product].join(' ')), score = d => { const h = words([d.title, d.party, d.fileName].join(' ')); return W.filter(w => h.some(x => x.startsWith(w) || w.startsWith(x))).length + ((d.assetIds || []).includes(a.id) ? 5 : 0) + (isWarr(d) ? 1 : 0); };
  const L = libCands().map(d => ({ d, sc: score(d) })).sort((x, y) => y.sc - x.sc || natural(x.d.title, y.d.title));
  modal(`<h2>🔗 Link a document to ${esc(a.ref || '')} ${esc(a.element)}</h2><p class="note">Choose a document already in the library. It is checked the same way as an upload. The best matches are at the top.</p>
  <input type="search" id="lkQ" placeholder="Search the library…" style="width:100%;margin-bottom:8px"><div class="lkl" id="lkL"></div>
  <div class="act"><button id="lkX">Cancel</button></div>`, true);
  const draw = () => { const q = $('lkQ').value.toLowerCase().trim(); $('lkL').innerHTML = L.filter(x => !q || q.split(' ').every(w => [x.d.title, x.d.fileName, x.d.system].join(' ').toLowerCase().includes(w))).slice(0, 60).map(({ d, sc }) => `<div class="lkr"><div><b>${esc(d.title)}</b><br><span class="muted small">${esc(d.system || '')} · ${esc(d.type || '')}${(d.assetIds || []).includes(a.id) ? ' · already linked to this element' : ''}</span></div><select data-lk="${esc(d.id)}">${kindOpts(kindOf(d))}</select><button class="btn2 sm" data-lkgo="${esc(d.id)}">Link</button></div>`).join('') || '<p class="muted">No documents match.</p>';
    document.querySelectorAll('[data-lkgo]').forEach(b => b.onclick = async () => { const d = fm().docs.find(x => x.id === b.dataset.lkgo), k = document.querySelector(`[data-lk="${b.dataset.lkgo}"]`).value || kindOf(d); closeModal(); try { await convert(d, a, k); toast('Linked. Checking in the background.', 4000); refresh(); } catch (e) { toast('Could not link: ' + e.message, 6000); } }); };
  $('lkQ').oninput = draw; $('lkX').onclick = closeModal; draw(); $('lkQ').focus();
}
// Every warranty already in the library, matched to its element in one go
// Every warranty already in the library, matched to its element in one go. Documents that look like versions of each other are
// grouped: you compare them side by side and decide which is current. Nothing is left out or deleted without you choosing it.
const ML = { over: {}, solo: new Set() };
const TPL = /(^|[^a-z])(form of|template|draft|fillable|prepopulated|blank|unexecuted)([^a-z]|$)/i;
const dateIn = d => { const m = /(\d{1,2})[-./](\d{1,2})[-./](20\d\d)/.exec([d.title, d.fileName].join(' ')); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : String(d.created || '').slice(0, 10); };
const simWords = d => new Set(words([d.title, d.fileName].join(' ')).filter(w => !/^\d+$/.test(w) && !['yr', 'check', 'signed', 'dated', 'unsigned', 'version', 'issue', 'copy', 'final'].includes(w)));
const similar = (x, y) => { const A = simWords(x), B = simWords(y); if (!A.size || !B.size) return false; let n = 0; A.forEach(w => B.has(w) && n++); return n / Math.min(A.size, B.size) >= 0.7; };
export function matchLibrary() {
  const L = libCands().filter(isWarr); if (!L.length) return toast('No unlinked warranties in the library');
  const A = fm().assets.filter(a => a.status !== 'Not applicable').sort((a, b) => natural(a.system, b.system) || natural(a.ref || '', b.ref || ''));
  const rows = L.map(d => { const g = guess([d.title, d.party, d.fileName].join(' ')), k = kindOf(d), lk = (d.assetIds || []).map(id => A.find(a => a.id === id)).filter(Boolean), own = ['sch19', 'sch18', 'bond'].includes(k) && g.sure;
    const o = ML.over[d.id]; return { d, a: o ? A.find(a => a.id === o.a) || null : own ? g.a : lk[0] || g.a, sure: own || !!lk[0] || g.sure, k: o ? o.k : k, tpl: TPL.test([d.title, d.fileName].join(' ')), empty: !d.size }; });
  // groups: same element and type, or near-identical names, in the same building system
  const gid = new Map(); let next = 0;
  rows.forEach((r, i) => rows.forEach((q, j) => { if (j <= i || r.tpl || q.tpl || (ML.solo.has(r.d.id) && ML.solo.has(q.d.id))) return; const same = (r.a && q.a && r.a.id === q.a.id && r.k === q.k && !['product', 'other'].includes(r.k)) || ((r.d.system || '') === (q.d.system || '') && similar(r.d, q.d));
    if (!same) return; const g = gid.get(r.d.id) ?? gid.get(q.d.id) ?? next++; [r, q].forEach(x => { const old = gid.get(x.d.id); if (old != null && old !== g) rows.forEach(y => { if (gid.get(y.d.id) === old) gid.set(y.d.id, g); }); gid.set(x.d.id, g); }); }));
  const groups = {}; rows.forEach(r => { const g = gid.get(r.d.id); if (g != null) (groups[g] = groups[g] || []).push(r); });
  Object.values(groups).forEach(G => G.sort((x, y) => (x.empty - y.empty) || dateIn(y.d).localeCompare(dateIn(x.d))));
  rows.forEach(r => { const G = groups[gid.get(r.d.id)]; r.grp = G && G.length > 1 ? G : null; r.newest = r.grp ? r.grp[0] === r : true; });
  // first time through, only the newest of a group and no templates are put forward; your own choices are kept
  rows.forEach(r => { if (ML.over[r.d.id] && !r.empty) return; if (r.tpl || !r.newest || r.empty) r.a = null; });
  rows.sort((x, y) => natural(x.d.system || '', y.d.system || '') || (gid.get(x.d.id) ?? 1e9) - (gid.get(y.d.id) ?? 1e9) || (x.grp && y.grp ? x.grp.indexOf(x) - y.grp.indexOf(y) : 0) || natural(x.d.title, y.d.title));
  const nG = Object.values(groups).filter(G => G.length > 1).length, note = r => r.grp ? `<span class="mlg ${r.newest ? '' : 'old'}">${r.newest ? '⧉ newest of ' + r.grp.length + ' similar' : '⧉ similar to a newer document'} · <a href="#" data-cmp="${esc(r.d.id)}">compare side by side</a></span>` : '';
  modal(`<h2>🔗 Match warranties already in the library</h2><p class="note">${L.length} warranties in the library are not yet tracked as submissions. Each has been matched to its element by its name and the company. ${nG ? `<b>${nG} groups look like versions of the same document</b>: only the newest of each is filled in. Use “compare side by side” to check, then link, move to Superseded or delete.` : ''} Blank forms and templates start empty. Click an element box and type to change it; leave it empty to leave the document out.</p>
  <table class="ftable bkt"><colgroup><col><col style="width:31%"><col style="width:180px"><col style="width:132px"></colgroup><tr><th>Document</th><th>Element</th><th>Type</th><th></th></tr>${rows.map((r, i) => `<tr class="${r.grp ? 'mlgr' : ''}${r.grp && !r.newest ? ' mlold' : ''}"><td class="small"><b>${esc(r.d.title)}</b><br><span class="muted">${esc(r.d.system || '')} · ${esc(dateIn(r.d) ? nzDate(dateIn(r.d)) : '')}${r.empty ? ' · <b style="color:#a32222">no file stored (empty entry)</b>' : ''}${r.tpl ? ' · <b>blank form or template</b>' : ''}${!r.grp && !r.tpl && !r.sure ? ' · <i>check this match</i>' : ''}</span>${note(r)}</td><td>${pickHtml('mlA' + i, r.a, 'Type to find it, or leave empty to leave out')}</td><td><select id="mlK${i}">${kindOpts(r.k)}</select></td><td class="mlact">${r.d.size ? `<button class="mini" data-mv="${esc(r.d.id)}" title="View the document">👁</button>` : '<span class="mlph"></span>'}${r.tpl && can.edit() ? `<button class="mini" data-mt="${esc(r.d.id)}" title="Keep it for the project team under Documents > Templates. Never in the handover export.">📋</button>` : '<span class="mlph"></span>'}${can.admin() ? `<button class="mini warn" data-md="${esc(r.d.id)}" title="Delete from the library">🗑</button>` : ''}</td></tr>`).join('')}</table>
  <div class="act"><button id="mlX">Cancel</button><button class="go" id="mlGo">Link and check</button></div>`, true);
  const keep = () => rows.forEach((r, i) => { if (document.querySelector(`[data-apk="mlA${i}"]`)) ML.over[r.d.id] = { a: pickVal('mlA' + i), k: $('mlK' + i).value }; });
  $('mlX').onclick = () => { ML.over = {}; ML.solo = new Set(); closeModal(); }; wirePicks(A);
  const docOf = id => fm().docs.find(x => x.id === id);
  document.querySelectorAll('[data-mv]').forEach(b => b.onclick = () => { keep(); closeModal(); DV.open(docOf(b.dataset.mv), { ret: () => matchLibrary() }); });
  document.querySelectorAll('[data-mt]').forEach(b => b.onclick = async () => { keep(); const d = docOf(b.dataset.mt); try { await S.store.patchItem(S.project.id, 'docs', d.id, { template: true, type: 'Template / blank form' }); delete ML.over[d.id]; toast('Saved under Documents > Templates', 3500); matchLibrary(); } catch (e) { toast('Could not save: ' + e.message, 6000); } });
  document.querySelectorAll('[data-md]').forEach(b => b.onclick = async () => { keep(); const d = docOf(b.dataset.md);
    if (!(await confirmBox(d.size ? `Delete "${d.title}" (${d.fileName || ''})? It is removed from the library and cannot be recovered. Your file in OneDrive is not touched.` : `Delete this empty entry "${d.title}"? It has no file stored, so nothing is lost.`, 'Delete for good'))) return matchLibrary();
    try { await S.store.deleteItem(S.project.id, 'docs', d.id); if (d.path && d.size) { try { await S.store.deleteFile(d.path); } catch (e) {} } delete ML.over[d.id]; toast('Deleted'); } catch (e) { toast('Could not delete: ' + e.message, 6000); } matchLibrary(); });
  document.querySelectorAll('[data-cmp]').forEach(l => l.onclick = e => { e.preventDefault(); keep(); const r = rows.find(x => x.d.id === l.dataset.cmp); compare(r.grp.map(x => x.d), r.grp[0].a || r.a || A.find(a => a.id === pickVal('mlA' + rows.indexOf(r))), r.k); });
  $('mlGo').onclick = async () => { const go = rows.map((r, i) => ({ d: r.d, a: A.find(a => a.id === pickVal('mlA' + i)), k: $('mlK' + i).value })).filter(x => x.a);
    if (!go.length) return toast('Nothing chosen'); ML.over = {}; closeModal(); const b = busy('Linking…'); let n = 0;
    try { for (const x of go) { b.set(`Linking ${++n} of ${go.length}…`); await convert(x.d, x.a, x.k); } b.done(); toast(`${go.length} linked. Checking in the background: results appear as they finish.`, 6000); } catch (e) { b.done(); toast(`Stopped after ${n - 1}: ${e.message}`, 8000); }
    refresh(); };
}

/* ---------------- compare similar documents side by side, then decide */
async function renderInto(el, d, token) {
  if (!d.size) { el.innerHTML = `<div class="cmpempty"><b>No file is stored for this entry.</b><p>It was added on ${esc(nzDate(String(d.created || '').slice(0, 10)))} while the file was online-only in OneDrive, so only the name came through. It holds nothing to compare.</p><p>${can.admin() ? 'Delete this empty entry with the Delete button above. Your file in OneDrive is not touched.' : 'Ask an admin to delete this empty entry.'}</p></div>`; return; }
  el.innerHTML = '<p class="muted small">Loading…</p>';
  try { const pdf = await DV.loadPdf(d); if (el.dataset.tok !== token) return; el.innerHTML = `<p class="muted small">${pdf.numPages} page${pdf.numPages === 1 ? '' : 's'}</p>`;
    for (let p = 1; p <= Math.min(pdf.numPages, 12); p++) { const pg = await pdf.getPage(p), base = pg.getViewport({ scale: 1 }), vp = pg.getViewport({ scale: Math.min(2, 900 / base.width) }), c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height; c.className = 'cmpg';
      await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise; if (el.dataset.tok !== token) return; el.appendChild(c); }
    if (pdf.numPages > 12) el.insertAdjacentHTML('beforeend', '<p class="muted small">First 12 pages shown. Open it to see the rest.</p>'); pdf.destroy();
  } catch (e) { el.innerHTML = `<p class="note">Could not show this document: ${esc(e.message)}</p>`; }
}
function compare(G, a, k) {
  G = G.map(d => fm().docs.find(x => x.id === d.id)).filter(Boolean); if (G.length < 2) return matchLibrary();
  let L = 0, R = 1; const adm = can.admin();
  const side = (i, w) => { const d = G[i]; return `<div class="cmps"><div class="cmph"><select data-side="${w}">${G.map((x, j) => `<option value="${j}" ${j === i ? 'selected' : ''}>${esc(nzDate(dateIn(x)) || '')} · ${esc(x.title)}</option>`).join('')}</select>
    <div class="small muted">${esc(d.fileName || '')} · ${d.size ? (d.size / 1e6).toFixed(1) + ' MB' : '<b style="color:#a32222">empty: no file stored</b>'} · added ${esc(nzDate(String(d.created || '').slice(0, 10)))}${d.createdBy ? ' by ' + esc(d.createdBy) : ''}</div>
    <div class="cmpa">${d.size ? `<button class="btn2 go sm" data-use="${w}">✔ Link this one</button>` : ''}<button class="btn2 sm" data-sup="${w}">Move to Superseded</button>${adm ? `<button class="btn2 sm warn" data-del="${w}">🗑 Delete</button>` : ''}<button class="btn2 sm" data-open="${w}">Open</button></div></div><div class="cmpb" id="cmp${w}"></div></div>`; };
  const draw = () => { modal(`<h2>⧉ Compare similar documents (${G.length})</h2><p class="note">Scroll each side to compare. Pick which to link, move older versions to Superseded (kept, but out of the way), or delete a file that should not be here.</p><div class="cmpw">${side(L, 'L')}${side(R, 'R')}</div><div class="act"><button id="cmApart" title="They were grouped because they matched the same element or have similar names">≠ These are different documents</button><button id="cmX">‹ Back to the list</button></div>`, true);
    $('mbox').classList.add('xwide'); ['L', 'R'].forEach(w => { const el = $('cmp' + w); el.dataset.tok = Math.random().toString(36); renderInto(el, G[w === 'L' ? L : R], el.dataset.tok); });
    const both = [$('cmpL'), $('cmpR')]; let lock = false; both.forEach((el, i) => el.onscroll = () => { if (lock) return; lock = true; const o = both[1 - i]; o.scrollTop = el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight) * (o.scrollHeight - o.clientHeight); requestAnimationFrame(() => lock = false); });
    document.querySelectorAll('[data-side]').forEach(s => s.onchange = () => { if (s.dataset.side === 'L') L = +s.value; else R = +s.value; draw(); });
    const pick = w => G[w === 'L' ? L : R];
    $('cmX').onclick = () => { $('mbox').classList.remove('xwide'); matchLibrary(); };
    $('cmApart').onclick = () => { G.forEach(x => { ML.solo.add(x.id); const o = ML.over[x.id]; if (o && !o.a) delete ML.over[x.id]; }); $('mbox').classList.remove('xwide'); toast('Kept apart. Check each one is matched to the right element.', 5000); matchLibrary(); };
    document.querySelectorAll('[data-open]').forEach(b => b.onclick = () => { $('mbox').classList.remove('xwide'); closeModal(); DV.open(pick(b.dataset.open), { ret: () => compare(G, a, k) }); });
    document.querySelectorAll('[data-use]').forEach(b => b.onclick = () => { const d = pick(b.dataset.use); G.forEach(x => { if (x.id !== d.id) ML.over[x.id] = { a: '', k: (ML.over[x.id] || {}).k || kindOf(x) }; }); ML.over[d.id] = { a: (a && a.id) || (ML.over[d.id] || {}).a || '', k: (ML.over[d.id] || {}).k || k || kindOf(d) }; $('mbox').classList.remove('xwide'); toast('Set to link this one. The others are left out.', 3500); matchLibrary(); });
    document.querySelectorAll('[data-sup]').forEach(b => b.onclick = async () => { const d = pick(b.dataset.sup); if (!(await confirmBox(`Move "${d.title}" to Superseded? It stays in the library, marked superseded, and is left out of warranty matching.`, 'Move to Superseded'))) return draw();
      try { await S.store.patchItem(S.project.id, 'docs', d.id, { superseded: true, supersededAt: now(), supersededBy: S.user.email, title: /superseded/i.test(d.title) ? d.title : d.title + ' (superseded)' }); delete ML.over[d.id]; toast('Moved to Superseded'); G = G.filter(x => x.id !== d.id); if (G.length < 2) { $('mbox').classList.remove('xwide'); return matchLibrary(); } L = 0; R = 1; draw(); } catch (e) { toast('Could not move: ' + e.message, 6000); draw(); } });
    document.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { const d = pick(b.dataset.del); if (!(await confirmBox(d.size ? `Delete "${d.title}" (${d.fileName || ''})? The file is removed from the library and cannot be recovered. Your copy in the OneDrive folders is not touched.` : `Delete this empty entry "${d.title}"? It has no file stored, so nothing is lost.`, 'Delete for good'))) return draw();
      try { await S.store.deleteItem(S.project.id, 'docs', d.id); if (d.path) { try { await S.store.deleteFile(d.path); } catch (e) {} } delete ML.over[d.id]; toast('Deleted'); G = G.filter(x => x.id !== d.id); if (G.length < 2) { $('mbox').classList.remove('xwide'); return matchLibrary(); } L = 0; R = 1; draw(); } catch (e) { toast('Could not delete: ' + e.message, 6000); draw(); } });
  };
  draw();
}

/* ================================================================ submit */
export function submitDialog(a, replaces) {
  const k0 = replaces ? replaces.sub.kind : (/weathertight/i.test(a.element || '') ? 'sch19' : /parent company/i.test(a.element || '') ? 'sch18' : /bond|retention|security/i.test(a.element || '') ? 'bond' : 'deed');
  modal(`<h2>⬆ Submit for ${esc(a.ref || '')} ${esc(a.element || '')}</h2>
  ${replaces ? `<p class="note">This replaces <b>${esc(replaces.fileName || replaces.title)}</b> (${esc(replaces.sub.status)}). The earlier version is kept in the history.</p>` : ''}
  <p class="muted small">${[a.installer ? 'Installer: ' + esc(a.installer) : '', a.instWarranty ? 'Required from the installer: ' + esc(a.instWarranty) : '', a.mfrWarranty && a.mfrWarranty !== '-' ? 'Required from the manufacturer: ' + esc(a.mfrWarranty) : ''].filter(Boolean).join(' · ')}</p>
  <p class="lbl2">What are you submitting?</p>
  <div class="sbk">${Object.entries(kinds()).map(([k, [l]]) => `<label><input type="radio" name="sbK" value="${k}" ${k === k0 ? 'checked' : ''}> ${esc(l)}</label>`).join('')}</div>
  <label class="f" id="sbTW" style="display:none">Document type<select id="sbT">${(X.DOC_TYPES || []).filter(t => !/^Warranty/.test(t)).map(t => `<option>${esc(t)}</option>`).join('')}</select></label>
  <label class="f">File (PDF)<input type="file" id="sbF" accept=".pdf,application/pdf"></label>
  <label class="f">Note to the reviewer (optional)<textarea id="sbN" rows="2" placeholder="e.g. Signed copy to follow by post"></textarea></label>
  <p class="note" id="sbHint"></p>
  <div class="act"><button id="sbX">Cancel</button><button class="go" id="sbGo">Upload and check</button></div>`);
  const kind = () => document.querySelector('input[name="sbK"]:checked').value;
  const sync = () => { const k = kind(); $('sbTW').style.display = k === 'other' ? '' : 'none'; $('sbF').accept = k === 'other' ? '' : '.pdf,application/pdf'; $('sbHint').textContent = isDeedLike(k) && k !== 'deed' ? 'It is checked straight away against the contract form: parties, contract date, period and execution as a deed.' : k === 'bond' ? 'It is checked straight away: issuer, beneficiary, contractor, amount and expiry or release date.' : k.startsWith('c:') ? 'It is checked straight away: parties, what it covers, period and signatures.' : k === 'deed' ? 'It is checked straight away: form, parties, works, period, date and signatures. You will see the result in about a minute and can fix anything before it goes for review.' : k === 'product' ? 'It is checked straight away: owner or property named, product, period and issuer.' : 'Supporting documents go straight to the reviewer.'; };
  document.querySelectorAll('input[name="sbK"]').forEach(r => r.onchange = sync); sync();
  $('sbX').onclick = () => replaces ? detail(replaces) : closeModal();
  $('sbGo').onclick = async () => {
    const f = $('sbF').files[0], k = kind(), note = $('sbN').value.trim(); if (!f) return toast('Choose the file first');
    if (!f.size) return toast('That file reads as empty (0 bytes). If it is in OneDrive, open it once so it downloads, then choose it again.', 9000);
    if (f.size > 150e6) return toast('That file is over 150 MB');
    if (k !== 'other' && !/\.pdf$/i.test(f.name)) return toast('Warranties must be submitted as a PDF');
    const type = typeOf(k, $('sbT').value);
    closeModal(); const b = busy('Uploading ' + f.name + '…'); let d;
    try { d = await upload(f, a, k, note, replaces, type); } catch (e) { b.done(); return toast(e.message === 'offline' ? 'No connection: the file was not uploaded. Try again when you are back online.' : 'Could not upload: ' + e.message, 8000); }
    b.done(); enqueue(d); toast('Uploaded. Checking in the background: the result appears in the list in about a minute.', 5000);
  };
}

/* ================================================================ one submission: result, actions, history */
const ICON = { true: '✓', false: '✗', null: '?' };
const checkHtml = (c, sel, d) => !c ? '<p class="muted small">Not checked yet.</p>' : c.error ? `<p class="note">The automatic check could not run (${esc(c.error)}). It has gone to the reviewer as it is. Use “Check again” to retry.</p>` : c.skipped ? '<p class="muted small">Supporting document: no automatic check.</p>'
  : `<div class="ckl">${c.items.map(i => `<div class="ck ${i.ok === true ? 'ok' : i.ok === false ? 'bad' : 'unk'}${sel === i.k ? ' sel' : ''}${d && (d.marks || []).some(m => m.ck === i.k) ? ' go' : ''}" data-ck="${esc(i.k)}"><i>${ICON[i.ok]}</i><div><b>${esc(i.label)}</b>${i.found ? `<small>Found: ${esc(i.found)}</small>` : ''}${i.ok === false && i.fix ? `<small class="fix">To fix: ${esc(i.fix)}</small>` : ''}${i.ok === null ? '<small>Could not be told from the document: the reviewer will check this.</small>' : ''}</div></div>`).join('')}</div>`;
const handMarks = d => (d.marks || []).filter(m => !m.chk && (m.flag || m.note)).sort((x, y) => x.page - y.page || x.y - y.y);
// The document viewer's side panel is the review screen: the check, the actions, and the next one to review.
const queueFor = () => { const ed = can.edit(), want = ed ? ['Awaiting review'] : ['Failed check', 'Sent back']; return fm().docs.filter(x => isSub(x) && want.includes(x.sub.status) && DV.isPdf(x)).sort((a, b) => String(a.sub.at || '').localeCompare(String(b.sub.at || ''))); };
export function wireBox(d, openDoc, goMark) {
  if (!isSub(d) || !$('sbvNx')) return; const cur = fm().docs.find(x => x.id === d.id) || d;
  // a point in the list takes you to its box on the page
  document.querySelectorAll('.sbv [data-ck]').forEach(el => el.onclick = () => { const m = (cur.marks || []).find(x => x.ck === el.dataset.ck); if (m && goMark) goMark(m); else toast('This point has no box on the page'); });
  const sel = document.querySelector('.sbv .ck.sel'); if (sel) sel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  const next = () => { const L = queueFor().filter(x => x.id !== cur.id); if (!L.length) return toast(can.edit() ? 'Nothing else is waiting for review' : 'Nothing else needs fixing'); openDoc(L[0]); };
  $('sbvNx').onclick = next;
  if ($('sbvAcc')) $('sbvAcc').onclick = () => decide(cur, true, next); if ($('sbvBack')) $('sbvBack').onclick = () => decide(cur, false, next);
  if ($('sbvMk')) $('sbvMk').onclick = () => markedPdf(cur); if ($('sbvDet')) $('sbvDet').onclick = () => detail(cur);
}
export function boxHtml(d, selMark) {
  if (!isSub(d)) return ''; d = fm().docs.find(x => x.id === d.id) || d; const s = d.sub, a = assetOf(d), ed = can.edit(), n = queueFor().filter(x => x.id !== d.id).length;
  return `<div class="sbv"><div class="sbvh"><b>${esc(a ? (a.ref || '') + ' ' + a.element : 'Submission')}</b>${chip(checking(d.id) ? 'Checking' : s.status)}</div>
  ${s.review && s.review.note ? `<div class="sbrev ${s.review.accepted ? 'ok' : ''}">${esc(s.review.note).replace(/\n/g, '<br>')}</div>` : ''}
  ${checking(d.id) || s.status === 'Checking' ? '<p class="muted small">Checking now. The result appears here when it finishes.</p>' : checkHtml(s.check, selMark && selMark.ck, d)}${(s.check && s.check.items || []).length && !(d.marks || []).some(m => m.pass) ? '<p class="muted small">Checked before the passed points were boxed on the page. Use Details > Check again to box every point.</p>' : ''}
  <div class="sbact">${ed && s.status !== 'Superseded' && s.status !== 'Accepted' ? '<button class="btn2 go" id="sbvAcc">✔ Accept</button>' : ''}${ed && s.status !== 'Superseded' ? '<button class="btn2 warn" id="sbvBack">↩ Send back</button>' : ''}<button class="btn2" id="sbvMk">⬇ With markup</button><button class="btn2" id="sbvDet">Details</button><button class="btn2" id="sbvNx">Next ›${n ? ' (' + n + ')' : ''}</button></div>
  <p class="muted small">Press <b>Mark</b> and drag a box on the page to add your own point. It appears in the send-back note and the marked-up copy.</p></div>`;
}
function oldBoxHtml(d) {
  if (!isSub(d)) return ''; const s = d.sub, c = s.check, bad = c && c.items ? c.items.filter(i => i.ok === false) : [];
  return `<div class="dvctx"><b>Submission</b> ${chip(s.status)}<br><span class="small muted">Submitted ${esc(dt(s.at))} by ${esc(s.byName || s.by || '')}</span>${s.review && s.review.note ? `<br><span class="small" style="color:#a32222"><b>Reviewer:</b> ${esc(s.review.note).replace(/\n/g, '<br>')}</span>` : ''}${bad.length ? '<br><span class="small" style="color:#a32222"><b>To fix:</b><br>' + bad.map(i => '• ' + esc(i.fix || i.label)).join('<br>') + '</span>' : c && c.items && c.items.length ? '<br><span class="small" style="color:#1d6e43">Automatic check: all points passed.</span>' : ''}</div>`;
}
export function detail(d0) {
  const d = fm().docs.find(x => x.id === d0.id) || d0, s = d.sub, a = assetOf(d), c = s.check, hm = handMarks(d), ed = can.edit(), wr = can.write();
  const open = !['Accepted', 'Superseded'].includes(s.status);
  modal(`<h2>${esc(a ? (a.ref || '') + ' ' + (a.element || '') : d.title)}</h2>
  <p>${chip(s.status)} <span class="muted small">${esc(KIND[s.kind] || '')} · submitted ${esc(dt(s.at))} by ${esc(s.byName || s.by || '')}</span></p>
  <p class="small sbname"><b>Filed as:</b> ${esc(d.title)}${ed ? ' <a href="#" id="sdRn">✎ Rename</a>' : ''}${d.fileName ? `<br><span class="muted">Uploaded as: ${esc(d.fileName)}</span>` : ''}</p>
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
  if ($('sdRe')) $('sdRe').onclick = () => { closeModal(); enqueue(d); toast('Checking again in the background', 3000); };
  if ($('sdNew')) $('sdNew').onclick = () => submitDialog(a, d);
  if ($('sdAny')) $('sdAny').onclick = () => noteBox('Send for review anyway', 'Tell the reviewer why the points above do not apply (optional)', 'Send for review', async note => { await setStatus(d, 'Awaiting review', 'Sent for review with check points outstanding' + (note ? ': ' + note : '') + '.', { note: [s.note, note].filter(Boolean).join(' | ') }); toast('Sent for review'); });
  if ($('sdRn')) $('sdRn').onclick = e => { e.preventDefault();
    modal(`<h2>Rename</h2><p class="note">Convention: [Contractor] - [Document type] - [What it covers] (warranty length)</p><label class="f">Name<input id="rnT" value="${esc(d.title)}"></label><div class="act"><button id="rnX">Cancel</button><button id="rnA">Use the automatic name</button><button class="go" id="rnGo">Save</button></div>`);
    const put = async (title, fixed) => { try { const sub = plain({ ...s, nameFixed: fixed, history: [...(s.history || []), { t: now(), who: S.user.name, txt: 'Renamed to "' + title + '".' }] }); await S.store.patchItem(S.project.id, 'docs', d.id, { title, sub }); try { X.render(); } catch (x) {} detail({ ...d, title, sub }); } catch (x) { toast('Could not rename: ' + x.message, 6000); } };
    $('rnX').onclick = () => detail(d); $('rnGo').onclick = () => { const t = $('rnT').value.trim(); if (!t) return toast('Enter a name'); put(t, true); }; $('rnA').onclick = () => put(convName(d, { ...s, nameFixed: false }), false); };
  if ($('sdAcc')) $('sdAcc').onclick = () => decide(d, true);
  if ($('sdBack')) $('sdBack').onclick = () => decide(d, false);
}
async function setStatus(d, status, txt, extra = {}) {
  const cur = fm().docs.find(x => x.id === d.id) || d, sub = plain({ ...cur.sub, ...extra, status, history: [...(cur.sub.history || []), { t: now(), who: S.user.name, txt }] });
  const title = convName(cur, sub); await S.store.patchItem(S.project.id, 'docs', d.id, { sub, title }); const r = { ...cur, sub, title }; try { X.render(); } catch (e) {} if (!DV.current()) detail(r); return r;
}
function noteBox(title, ask, btn, go) {
  modal(`<h2>${esc(title)}</h2><label class="f">${esc(ask)}<textarea id="nbT" rows="4"></textarea></label><div class="act"><button id="nbX">Cancel</button><button class="go" id="nbGo">${esc(btn)}</button></div>`);
  $('nbX').onclick = closeModal; $('nbGo').onclick = async () => { const v = $('nbT').value.trim(); try { await go(v); } catch (e) { toast('Could not save: ' + e.message, 7000); } };
}
// Accept, or send back with a list of what to change. The list starts from the failed check points and anything marked on the document.
function decide(d0, accept, after) {
  const d = fm().docs.find(x => x.id === d0.id) || d0, s = d.sub, a = assetOf(d), c = s.check;
  const fixes = [...((c && c.items) || []).filter(i => i.ok === false).map(i => i.fix || i.label), ...handMarks(d).map(m => `Page ${m.page}: ${m.flag || m.note}`)];
  const stOpts = accept ? ['Received', 'Partial', ''] : ['Revision required', ''];
  modal(`<h2>${accept ? '✔ Accept' : '↩ Send back'}: ${esc(a ? (a.ref || '') + ' ' + (a.element || '') : d.title)}</h2>
  ${accept && fixes.length ? `<p class="note">${fixes.length} point(s) are still flagged on this document. Accept only if you are satisfied they do not matter.</p>` : ''}
  <label class="f">${accept ? 'Note (optional)' : 'What has to change (the contractor sees this, with your boxes on the document)'}<textarea id="dcN" rows="${accept ? 3 : 8}">${accept ? '' : esc(fixes.map((f, i) => `${i + 1}. ${f}`).join('\n'))}</textarea></label>
  ${a ? `<label class="f">Set the asset's document status to<select id="dcS">${stOpts.map(o => `<option value="${o}">${o ? o + (o === 'Partial' ? ' (other documents still needed)' : o === 'Received' ? ' (everything for this element is in)' : '') : 'Leave as it is (' + esc(a.status || '') + ')'}</option>`).join('')}</select></label>` : ''}
  ${accept ? '' : '<p class="muted small">Tip: use “Open and mark up” first to draw a box around each thing that is wrong. The boxes appear here and in the contractor\'s marked-up copy.</p>'}
  <div class="act"><button id="dcX">Cancel</button><button class="go" id="dcGo">${accept ? 'Accept' : 'Send back'}</button></div>`);
  $('dcX').onclick = () => after ? closeModal() : detail(d);
  $('dcGo').onclick = async () => {
    const note = $('dcN').value.trim(), st = $('dcS') ? $('dcS').value : ''; if (!accept && !note) return toast('Say what has to change, so the contractor knows what to fix');
    const b = busy('Saving…');
    try {
      const r = await setStatus(d, accept ? 'Accepted' : 'Sent back', (accept ? 'Accepted' : 'Sent back') + (note ? ': ' + note.replace(/\n+/g, ' ') : '') + '.', { review: { by: S.user.email, byName: S.user.name, at: now(), note, accepted: accept } });
      if (a && st && st !== a.status) await S.store.patchItem(S.project.id, 'assets', a.id, { status: st });
      b.done();
      if (accept) { toast('Accepted'); if (after) { closeModal(); after(); } return; }
      const link = location.origin + location.pathname, body = `${a ? (a.ref || '') + ' ' + (a.element || '') : d.title}\nDocument: ${d.fileName || d.title}\n\nThis has been sent back. What has to change:\n\n${note}\n\nOpen it in Resero Site (Assets & warranties > Warranty submissions) to see the marked-up copy and upload the corrected version:\n${link}`;
      modal(`<h2>Sent back</h2><p>${esc(s.byName || s.by || 'The contractor')} will see this under <b>Warranty submissions</b>, with your note and the boxes on the document.</p><p class="muted small">The app does not send emails by itself. Use the button to tell them now.</p><div class="act"><button id="sbD">Done</button><a class="sbmail" id="sbM" href="mailto:${esc(s.by || '')}?subject=${encodeURIComponent((S.project.name || '') + ': warranty sent back, ' + (a ? a.element : d.title))}&body=${encodeURIComponent(body)}">✉ Email ${esc(s.byName || s.by || 'them')}</a></div>`);
      $('sbD').onclick = () => { if (after) { closeModal(); after(); } else detail(r); }; $('sbM').onclick = () => setTimeout(() => { if (after) { closeModal(); after(); } else detail(r); }, 400);
    } catch (e) { b.done(); toast('Could not save: ' + e.message, 7000); }
  };
}
async function openFile(d) { try { const u = await S.store.resolveUrl(d.url); if (u) window.open(u, '_blank', 'noopener'); } catch (e) { toast('Could not open: ' + e.message); } }
export async function original(d) {
  const b = busy('Fetching the original…');
  try { const buf = await X.getBytes(d.url); b.done(); deliver(new Blob([buf], { type: d.mime || 'application/pdf' }), fileSafe(d.submitted ? d.title : (d.fileName || d.title).replace(/\.[a-z0-9]{2,5}$/i, '')) + ext(d), 'Original'); }
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
      const [ax, ay] = map(m.x, m.y), [bx, by] = map(m.x + m.w, m.y + m.h), x = Math.min(ax, bx), y = Math.min(ay, by), w = Math.abs(bx - ax), h = Math.abs(by - ay), col = d.template ? AMB : m.flag ? RED : m.pass ? GREEN : BLUE;
      pg.drawRectangle({ x, y, width: w, height: h, borderColor: col, borderWidth: 1.6, color: col, opacity: 0.07, borderOpacity: 1 });
      const [cx, cy] = map(m.x, m.y), n = String(i + 1); pg.drawCircle({ x: cx, y: cy, size: 8, color: col });
      pg.drawText(n, { x: cx - fb.widthOfTextAtSize(n, 8) / 2, y: cy - 2.8, size: 8, font: fb, color: P.rgb(1, 1, 1) });
    });
    // summary
    const W = 595.28, H = 841.89, M = 44; let pg = null, y = 0;
    const wrap = (t, font, size, maxw) => { const out = []; latin(t).split('\n').forEach(par => { let line = ''; par.split(/\s+/).forEach(w => { const tr = line ? line + ' ' + w : w; if (font.widthOfTextAtSize(tr, size) <= maxw) line = tr; else { if (line) out.push(line); line = w; } }); out.push(line); }); return out; };
    const newPage = () => { pg = doc.addPage([W, H]); pg.drawRectangle({ x: 0, y: H - 46, width: W, height: 46, color: NAVY }); pg.drawText(d.template ? 'How to complete this form' : 'Review markup', { x: M, y: H - 30, size: 15, font: fb, color: P.rgb(1, 1, 1) }); pg.drawText(latin(S.project.name || ''), { x: W - M - f.widthOfTextAtSize(latin(S.project.name || ''), 9), y: H - 28, size: 9, font: f, color: P.rgb(1, 1, 1) }); y = H - 70; };
    const line = (t, o = {}) => { const size = o.size || 9.5, font = o.bold ? fb : f, ind = o.ind || 0; wrap(t, font, size, W - 2 * M - ind).forEach(l => { if (y < 56) newPage(); pg.drawText(l, { x: M + ind, y, size, font, color: o.color || P.rgb(0.1, 0.14, 0.18) }); y -= size + 3.5; }); y -= o.gap || 0; };
    newPage(); const s = d.sub, a = assetOf(d);
    line(d.title, { bold: true, size: 12, gap: 2 }); line([d.fileName, a ? (a.ref || '') + ' ' + (a.element || '') : '', 'printed ' + nzDate(now().slice(0, 10))].filter(Boolean).join('  |  '), { color: GREY, gap: 6 });
    if (s) { line(`Status: ${s.status}   |   Submitted ${dt(s.at)} by ${s.byName || s.by || ''}`, { bold: true, gap: 4 });
      if (s.review && s.review.note) { line((s.review.accepted ? 'Accepted' : 'Sent back') + ` by ${s.review.byName || s.review.by || ''}, ${dt(s.review.at)}:`, { bold: true, color: s.review.accepted ? GREEN : RED }); line(s.review.note, { ind: 10, gap: 8 }); }
      const c = s.check; if (c && c.items && c.items.length) { line('Automatic check', { bold: true, size: 11, color: NAVY, gap: 2 });
        c.items.forEach(i => { line(`${i.ok === true ? 'PASS ' : i.ok === false ? 'FIX  ' : 'CHECK'}   ${i.label}`, { bold: true, color: i.ok === true ? GREEN : i.ok === false ? RED : AMB }); if (i.found) line('Found: ' + i.found, { ind: 44, color: GREY }); if (i.ok === false && i.fix) line('To fix: ' + i.fix, { ind: 44 }); y -= 3; }); y -= 6; } }
    const shown = marks.filter(m => !m.pass); line(d.template ? `Fill in each numbered box (${shown.length})` : `Boxes marked on the document (${shown.length}; green boxes show points that passed)`, { bold: true, size: 11, color: NAVY, gap: 2 });
    if (!shown.length) line('Nothing has been marked on the pages.', { color: GREY });
    marks.forEach((m, i) => { if (m.pass) return; line(`${i + 1}.  Page ${m.page}  |  ${m.period || m.kind || ''}`, { bold: true, color: m.flag ? RED : BLUE }); if (m.flag) line((d.template ? 'To complete: ' : 'To fix: ') + m.flag, { ind: 16 }); if (m.note) line('Note: ' + m.note, { ind: 16 }); if (m.text) line('"' + m.text.slice(0, 260) + '"', { ind: 16, color: GREY }); y -= 3; });
    const out = await doc.save(); b.done(); deliver(new Blob([out], { type: 'application/pdf' }), `${fileSafe(d.submitted || d.template ? d.title : (d.fileName || d.title).replace(/\.pdf$/i, ''))} - ${d.template ? 'how to complete' : 'with markup'}.pdf`, 'Marked-up copy');
  } catch (e) { console.error(e); b.done(); toast('Could not build the marked-up copy: ' + e.message, 7000); }
}

/* ================================================================ filing pack: accepted documents, named to the convention, in the handover folder structure */
const toFile = all => fm().docs.filter(d => isSub(d) && d.sub.status === 'Accepted' && (all || !d.sub.filed));
export async function filingPack() {
  let L = toFile(false), all = false;
  if (!L.length) { L = toFile(true); all = true; if (!L.length) return toast('Nothing has been accepted yet'); if (!(await confirmBox(`Everything accepted has already been downloaded for filing. Download all ${L.length} accepted documents again?`, 'Download all'))) return; }
  const b = busy('Building the filing pack…');
  try {
    if (!window.JSZip) await loadScript('lib/jszip.min.js');
    const zip = new window.JSZip(), used = new Set(), rows = [['Folder', 'File', 'Element', 'Accepted', 'By', 'Uploaded as']];
    for (const [i, d] of L.entries()) { b.set(`Adding ${i + 1} of ${L.length}: ${d.title}`); let path = `${folderOf(d)}/${fileSafe(d.title)}${ext(d)}`; for (let k = 2; used.has(path.toLowerCase()); k++) path = `${folderOf(d)}/${fileSafe(d.title)} (${k})${ext(d)}`; used.add(path.toLowerCase());
      zip.file(path, await X.getBytes(d.url)); const a = assetOf(d), r = d.sub.review || {}; rows.push([folderOf(d), path.split('/').pop(), a ? (a.ref || '') + ' ' + (a.element || '') : '', dt(r.at), r.byName || r.by || '', d.fileName || '']); }
    zip.file('Filing list.csv', '\ufeff' + rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\r\n'));
    const blob = await zip.generateAsync({ type: 'blob' }); b.done(); deliver(blob, `${fileSafe(S.project.name)} - accepted documents to file - ${stamp()}.zip`, 'Filing pack');
    if (!all) for (const d of L) { try { await S.store.patchItem(S.project.id, 'docs', d.id, { sub: plain({ ...d.sub, filed: now() }) }); } catch (e) { console.warn('filed mark', e); } }
    try { X.render(); } catch (e) {}
  } catch (e) { console.error(e); b.done(); toast('Could not build the filing pack: ' + e.message, 7000); }
}

/* ================================================================ the list: every element, what is needed, what has been submitted */
export function view(tabs) {
  const A = fm().assets.slice().sort((a, b) => natural(a.system, b.system) || natural(a.ref || '', b.ref || '')), q = VF.q.toLowerCase(), C = counts(), wr = can.write();
  const state = a => { const L = live(subsOf(a.id)); return { L, review: L.some(d => d.sub.status === 'Awaiting review'), fix: L.some(d => ['Failed check', 'Sent back'].includes(d.sub.status)), acc: L.some(d => d.sub.status === 'Accepted') }; };
  const rows = A.map(a => ({ a, ...state(a) })).filter(({ a, L, review, fix, acc }) => a.status !== 'Not applicable' && (!VF.sys || a.system === VF.sys) && (!q || [a.ref, a.element, a.product, a.installer].join(' ').toLowerCase().includes(q))
    && (!VF.st || (VF.st === 'out' ? !['Received'].includes(a.status) && !review : VF.st === 'review' ? review : VF.st === 'fix' ? fix : VF.st === 'acc' ? acc : true)));
  let last = '';
  $('fmView').innerHTML = `<div class="fbar"><h2>Assets &amp; warranties</h2><input type="search" id="svQ" placeholder="Search element, product, installer…" value="${esc(VF.q)}"><select id="svS"><option value="">All systems</option>${(X.SYSTEMS || []).map(s => `<option ${s === VF.sys ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select><select id="svT">${[['', 'Everything'], ['out', 'Still outstanding'], ['fix', 'Needs fixing (' + C.fix + ')'], ['review', 'Awaiting review (' + C.review + ')'], ['acc', 'Accepted (' + C.accepted + ')']].map(([v, l]) => `<option value="${v}" ${v === VF.st ? 'selected' : ''}>${l}</option>`).join('')}</select>${can.edit() ? '<button class="btn2" id="svDeed" title="Fillable Schedule 13 deeds, filled in from Project settings and Contacts, for the warrantor to sign">📝 Prepare deeds for signing</button>' : ''}${can.edit() ? `<button class="btn2" id="svLib">🔗 Match library warranties (${libCands().filter(isWarr).length})</button>` : ''}<button class="btn2 go" id="svRev">${can.edit() ? '▶ Review next (' + C.review + ')' : '▶ Fix next (' + C.fix + ')'}</button>${can.edit() ? `<button class="btn2" id="svZip" title="Accepted documents, named to the convention, in the handover folder structure">📦 Accepted, ready to file${toFile(false).length ? ' (' + toFile(false).length + ' new)' : ''}</button>` : ''}</div>
  ${tabs}
  <div class="sbdrop">⬇ Drop warranty PDFs anywhere on this page. Each one is matched to its element and checked in the background. You can drop many at once.</div>
  <p class="muted small">${can.edit() ? `${C.review} awaiting your review · ${C.fix} with the contractor to fix · ${C.accepted} accepted.` : `Submit each warranty against the element it covers. It is checked straight away so you can fix anything before it is reviewed. ${C.fix} need fixing · ${C.review} with the reviewer · ${C.accepted} accepted.`}</p>
  ${rows.length ? `<table class="ftable sbt"><tr><th>Ref</th><th>Element</th><th class="hm">Required</th><th>Status</th><th>Submitted</th><th></th></tr>
  ${rows.map(({ a, L }) => { const g = a.system !== last ? `<tr class="grp"><td colspan="6">${esc(a.system)}</td></tr>` : ''; last = a.system;
    return g + `<tr><td>${esc(a.ref || '')}</td><td><b>${esc(a.element || '')}</b><br><span class="muted small">${esc([a.installer, a.product].filter(Boolean).join(' · '))}</span></td><td class="hm small">${esc([a.instWarranty && 'Installer: ' + a.instWarranty, a.mfrWarranty && a.mfrWarranty !== '-' && 'Manufacturer: ' + a.mfrWarranty].filter(Boolean).join(' · '))}</td><td><span class="st ${a.status === 'Received' ? 'st-ok' : a.status === 'Not received' ? 'st-bad' : 'st-warn'}">${esc(a.status || '')}</span></td><td>${L.map(d => `<a href="#" class="sbchip" data-sd="${esc(d.id)}" title="${esc(d.title)}">${chip(d.sub.status)}<small>${esc((kinds()[d.sub.kind] || ['', 'Document'])[1])} · ${esc(dt(d.sub.at))}</small></a>`).join('') || '<span class="muted small">Nothing yet</span>'}</td><td class="sbbtns">${wr ? `<button class="btn2 sm" data-sub="${esc(a.id)}">⬆ Submit</button>` : ''}${can.edit() ? `<button class="btn2 sm" data-lnk="${esc(a.id)}" title="Link a document already in the library">🔗 Link</button>` : ''}</td></tr>`; }).join('')}</table>` : '<div class="empty2">Nothing matches. Change the filter to see more.</div>'}`;
  $('svQ').oninput = e => { VF.q = e.target.value; X.render(); const i = $('svQ'); if (i) { i.focus(); i.setSelectionRange(VF.q.length, VF.q.length); } };
  if ($('svZip')) $('svZip').onclick = filingPack;
  $('svS').onchange = e => { VF.sys = e.target.value; X.render(); }; $('svT').onchange = e => { VF.st = e.target.value; X.render(); };
  document.querySelectorAll('[data-sub]').forEach(b => b.onclick = () => submitDialog(fm().assets.find(a => a.id === b.dataset.sub)));
  document.querySelectorAll('[data-sd]').forEach(l => l.onclick = e => { e.preventDefault(); const d = fm().docs.find(x => x.id === l.dataset.sd); if (!d) return; DV.isPdf(d) ? DV.open(d) : detail(d); });
  document.querySelectorAll('[data-lnk]').forEach(b => b.onclick = () => linkExisting(fm().assets.find(a => a.id === b.dataset.lnk)));
  if ($('svLib')) $('svLib').onclick = matchLibrary;
  if ($('svDeed')) $('svDeed').onclick = () => Deed.prepareDialog();
  if ($('svRev')) $('svRev').onclick = () => { const L = queueFor(); if (!L.length) return toast(can.edit() ? 'Nothing is waiting for review' : 'Nothing needs fixing'); DV.open(L[0]); };
  resume();
}
