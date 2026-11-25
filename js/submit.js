// Warranty submissions: the contractor uploads a warranty against the asset that needs it, the app checks it against the
// project's deed standard straight away, and the reviewer accepts it or sends it back with what has to change.
// A submission is an ordinary document with submitted:true and a "sub" record: {kind, status, by, at, note, check, review, history}.
import { S, can } from './state.js';
import { aiCall } from './ai.js';
import * as DV from './docview.js';
import * as Deed from './deed.js';
import * as Reg from './coreg.js';
import { note as noteContacts } from './contacts.js';
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
const coShort = () => String(S.project.contractor || 'the Contractor').replace(/\s+(construction\s+)?(limited|ltd)\.?$/i, '');
const readyToSign = sub => !!sub && sub.status === 'Awaiting review' && !!(sub.check && sub.check.toSign);
const chip = (s, sub) => readyToSign(sub) ? `<span class="st st-warn">Ready for ${esc(coShort())} to sign</span>` : `<span class="st ${ST_CLS[s] || 'st-grey'}">${s === 'Checking' ? '<i class="sbspin"></i>' : ''}${esc(s === 'Failed check' ? 'Failed check: fix and resubmit' : s === 'Checking' ? 'Checking…' : s || '')}</span>`;
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
  ['contractorSig', `Contractor block is signed by ${p.contractor || 'the Contractor'}`, `In the block "SIGNED on behalf of the Contractor" there is a real signature. The text "Click to enter text or paste signature" or an empty line means it is not signed. A subcontractor's own name in this block is wrong. If the block is simply empty (nobody has signed it yet), set ok to false and start "found" with the single word EMPTY.`],
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
    if (d0.sub && d0.sub.status === 'Accepted') status = 'Accepted';   // checking an accepted document again refreshes the findings, never the decision
    const sub = { ...d.sub, status, check, history: [...hist, { t: now(), who: 'Automatic check', txt: check.error ? 'Could not be checked automatically: ' + check.error : check.skipped ? 'Not a warranty: no automatic check.' : (check.items.filter(i => i.ok === false).length ? check.items.filter(i => i.ok === false).length + ' point(s) to fix.' : check.toSign ? 'Ready for ' + (p.contractor || 'the Contractor') + ' to sign.' : 'All points passed.') }] };
    const patch = plain({ sub, ...extra }); patch.title = convName({ ...d, ...patch }, sub); if (sub.check && sub.check.warrantor) patch.party = String(sub.check.warrantor).slice(0, 80); await S.store.patchItem(p.id, 'docs', d.id, patch); d = { ...d, ...patch }; return d;
  };
  if (kind === 'other' || !DV.isPdf(d)) return save('Awaiting review', { at: now(), skipped: true, items: [] });
  let pdf = null, seen = null;
  try {
    onProg('Opening the document…'); const L = await DV.pdfLib(); pdf = await DV.loadPdf(d); const n = pdf.numPages, pages = {}; seen = pages;
    const page = async k => pages[k] || (pages[k] = await (async () => { const pg = await pdf.getPage(k), runs = await pageRuns(L, pg); return { pg, runs, t: runs.map(r => r.s).join(' ').replace(/\s+/g, ' ').trim() }; })());
    const first = Math.min(n, 3); for (let k = 1; k <= first; k++) await page(k);
    const scanned = pages[1].t.length < 200, found = {}, meta = {};
    const take = (j, pgNo) => { if (!j) return; ['warrantor', 'works', 'period', 'date', 'worksShort', 'periodShort'].forEach(k => { if (j[k] && !meta[k]) meta[k] = String(j[k]).slice(0, 200); }); (j.items || []).forEach(it => { if (it && it.k) found[it.k] = { ...it, page: Math.max(1, Math.min(n, +it.page || pgNo || 1)) }; }); };
    const front = frontFor(p, kind), execs = execFor(p, kind);
    // the front matter: from the words where the PDF has them, from a picture of page 1 where it is a scan
    const askFront = async () => {
      onProg(scanned ? 'Reading page 1 (scanned)…' : 'Reading the parties, works and period…');
      if (scanned) { const ask1 = async k => parse(await aiCall(brief(p, a, front, Q_BOX) + `\n\nThe picture is page ${k} of ${n} of a scanned or photographed document. Use "page":${k}.`, await pageImage((await page(k)).pg))), score = j => ((j && j.items) || []).filter(i => i && i.ok === true).length;
        let j = await ask1(1), at = 1; if (n > 1 && score(j) < front.length / 2) { onProg('Page 1 looks like a cover: reading page 2…'); const j2 = await ask1(2); if (score(j2) > score(j)) { j = j2; at = 2; } }
        return take(j, at); }
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
    // The Contractor signs last: an empty Contractor block is "waiting for the Contractor", not something for the warrantor to fix
    items.forEach(it => { if (it.k === 'contractorSig' && it.ok === false && /^\W*EMPTY\b/i.test(it.found)) { it.ok = null; it.wait = true; it.found = it.found.replace(/^\W*EMPTY\W*/i, '').replace(/^./, c => c.toUpperCase()); it.fix = ''; } else if (it.found) it.found = it.found.replace(/^\W*EMPTY\W*/i, ''); });
    const toSign = !items.some(i => i.ok === false) && items.some(i => i.wait);
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
    return await save(fails.length ? 'Failed check' : 'Awaiting review', { at: now(), items, ...(toSign ? { toSign: true } : {}), ...meta, via: (aiCall.last && aiCall.last.via) || '' },
      { marks: [...(d.marks || []).filter(m => !m.chk), ...marks], aiRead: now(), aiSummary: [meta.warrantor, meta.works, meta.period].filter(Boolean).join(' · ').slice(0, 400), aiProblems: [...new Set([...(d.marks || []).filter(m => !m.chk && m.flag).map(m => m.flag), ...fails.map(i => i.fix || i.label)])].slice(0, 14) });
  } catch (e) {
    console.warn('submission check', e);
    return save('Awaiting review', { at: now(), error: e.message === 'offline' ? 'no connection at the time' : (e.message || 'the check did not run'), items: [] });
  } finally { try { pdf && pdf.destroy(); } catch (e) {} if (seen) noteContacts(d0, Object.values(seen).map(x => x.t).join(' \n ')); }
}

/* ================================================================ background checks: up to three at once, the page stays usable */
const Q = [], RUN = new Set(); let running = 0;
export const checking = id => RUN.has(id) || Q.some(d => d.id === id);
// The AI check is optional: each person chooses, and the choice is remembered on this device
export const aiOn = () => { try { return localStorage.getItem('subAI') !== '0'; } catch (e) { return true; } };
const setAi = v => { try { localStorage.setItem('subAI', v ? '1' : '0'); } catch (e) {} };
const aiToggle = id => `<label class="sbai"><input type="checkbox" id="${id}" ${aiOn() ? 'checked' : ''}> <b>Check automatically with AI</b> <span class="muted small">Untick to review it yourself: it goes straight to review, and you can run the check later from Details.</span></label>`;
async function manual(d) { const sub = plain({ ...d.sub, status: 'Awaiting review', check: { at: now(), manual: true, items: [] }, history: [...(d.sub.history || []), { t: now(), who: S.user.name, txt: 'Sent for manual review (automatic check not run).' }] }); await S.store.patchItem(S.project.id, 'docs', d.id, { sub }); refresh(); }
export const route = (d, ai) => (ai === false || (ai == null && !aiOn())) ? manual(d) : enqueue(d);
export function enqueue(d) { if (checking(d.id)) return; Q.push(d); pump(); }
function pump() {
  while (running < 3 && Q.length) { const d = Q.shift(); running++; RUN.add(d.id); refresh();
    runCheck(d).then(r => { const n = ((r.sub.check || {}).items || []).filter(i => i.ok === false).length; toast(`${r.title.split(' - ')[0]}: ${r.sub.check && r.sub.check.error ? 'could not be checked automatically' : n ? n + ' point' + (n === 1 ? '' : 's') + ' to fix' : 'passed the check'}`, 4000); })
      .catch(e => console.warn('check', e)).finally(() => { running--; RUN.delete(d.id); refresh(); pump(); }); }
}
const refresh = () => { try { X.render(); } catch (e) {} try { if (DV.current() && RUN.size >= 0) DV.refreshSide(); } catch (e) {} };
// a check left half way (page closed while it ran) is picked up again
function resume() { if (!can.write()) return; fm().docs.filter(d => isSub(d) && d.sub.status === 'Checking' && !checking(d.id) && Date.now() - Date.parse(d.sub.at || 0) > 120000).slice(0, 10).forEach(enqueue); }

// Photos and scans saved as pictures become a PDF on the way in (one page per picture, in name order), so they are viewed,
// checked and marked up like any other submission.
const isImg = f => /^image\/(jpeg|png|webp)$/i.test(f.type || '') || /\.(jpe?g|png|webp)$/i.test(f.name || '');
export async function imgToPdf(files) {
  if (!window.PDFLib) await loadScript('lib/pdf-lib.min.js'); const P = window.PDFLib, doc = await P.PDFDocument.create();
  for (const f of files.slice().sort((a, b) => natural(a.name, b.name))) { const url = URL.createObjectURL(f); try { const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error(f.name + ' could not be read as a picture')); i.src = url; });
      const sc = Math.min(1, 2200 / Math.max(im.width, im.height)), c = document.createElement('canvas'); c.width = Math.round(im.width * sc); c.height = Math.round(im.height * sc); const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0, c.width, c.height);
      const jpg = await doc.embedJpg(await (await new Promise(r => c.toBlob(r, 'image/jpeg', 0.82))).arrayBuffer()), land = c.width > c.height, W = land ? 841.89 : 595.28, H = land ? 595.28 : 841.89, k = Math.min(W / c.width, H / c.height);
      doc.addPage([W, H]).drawImage(jpg, { x: (W - c.width * k) / 2, y: (H - c.height * k) / 2, width: c.width * k, height: c.height * k }); } finally { URL.revokeObjectURL(url); } }
  return new File([await doc.save()], files[0].name.replace(/\.[^.]+$/, '') + '.pdf', { type: 'application/pdf' });
}
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
async function newAsset(name, sys, inst) {
  const AS = fm().assets; let n = 0; AS.forEach(a => { const m = /^A-(\d+)$/.exec(a.ref || ''); if (m) n = Math.max(n, +m[1]); });
  const a = { id: uid(), ref: 'A-' + String(n + 1).padStart(3, '0'), system: sys, element: name, installer: inst, status: 'Not received', warranties: [], om: true, maint: false, audience: 'FM', created: now() };
  await S.store.saveItem(S.project.id, 'assets', a); if (!AS.some(x => x.id === a.id)) AS.push(a); return a;
}
export function wirePicks(A, onPick) {
  document.querySelectorAll('[data-apk]').forEach(box => { if (box.dataset.w) return; box.dataset.w = 1; const inp = box.querySelector('input'), list = box.querySelector('.apkl'); let hits = [], hi = 0;
    const draw = () => { hits = rank(inp.value === label(A.find(a => a.id === box.dataset.id)) ? '' : inp.value, A).slice(0, 40); hi = 0; list.innerHTML = (hits.map((a, i) => `<div data-i="${i}" class="${i === hi ? 'on' : ''}"><b>${esc(a.ref || '')}</b> ${esc(a.element)}<small>${esc([a.installer, a.product].filter(Boolean).join(' · '))}</small></div>`).join('') || '<p class="muted small">No element matches. Try another word, or create it.</p>') + (can.edit() ? `<div data-new="1" class="apnew">＋ New element${inp.value.trim() && inp.value !== label(A.find(a => a.id === box.dataset.id)) ? ': <b>' + esc(inp.value.trim()) + '</b>' : ''}</div>` : ''); list.hidden = false; };
    const choose = a => { box.dataset.id = a ? a.id : ''; inp.value = label(a); list.hidden = true; onPick && onPick(box.dataset.apk, a); };
    inp.onfocus = () => { inp.select(); draw(); }; inp.oninput = draw;
    inp.onkeydown = e => { if (list.hidden) return; if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); hi = Math.max(0, Math.min(hits.length - 1, hi + (e.key === 'ArrowDown' ? 1 : -1))); list.querySelectorAll('[data-i]').forEach(d => d.classList.toggle('on', +d.dataset.i === hi)); list.querySelector('.on')?.scrollIntoView({ block: 'nearest' }); } else if (e.key === 'Enter') { e.preventDefault(); if (hits[hi]) choose(hits[hi]); } else if (e.key === 'Escape') { list.hidden = true; inp.value = label(A.find(a => a.id === box.dataset.id)); } };
    const create = () => { const q = inp.value.trim() && inp.value !== label(A.find(a => a.id === box.dataset.id)) ? inp.value.trim() : '', sys = X.SYSTEMS || [];
      list.innerHTML = `<div class="apform"><b>New element</b><input class="apN" placeholder="Element, e.g. Blockwork" value="${esc(q)}"><select class="apS">${sys.map(x => `<option>${esc(x)}</option>`).join('')}</select><input class="apI" placeholder="Installer or company (optional)"><span><button class="mini apC">Cancel</button><button class="mini go apG">Create</button></span></div>`; list.hidden = false; keepOpen = true;
      const fN = list.querySelector('.apN'); setTimeout(() => fN.focus(), 0);
      list.querySelector('.apC').onclick = ev => { ev.preventDefault(); keepOpen = false; list.hidden = true; inp.value = label(A.find(a => a.id === box.dataset.id)); };
      list.querySelector('.apG').onclick = async ev => { ev.preventDefault(); const nm = fN.value.trim(); if (!nm) return toast('Name the element'); try { const a = await newAsset(nm, list.querySelector('.apS').value, list.querySelector('.apI').value.trim()); if (!A.some(x => x.id === a.id)) A.push(a); keepOpen = false; choose(a); toast('Created ' + a.ref + ' ' + a.element, 3500); } catch (x) { toast('Could not create: ' + x.message, 6000); } }; };
    let keepOpen = false;
    list.onmousedown = e => { if (e.target.closest('.apform')) return; if (e.target.closest('[data-new]')) { e.preventDefault(); return create(); } const d = e.target.closest('[data-i]'); if (d) { e.preventDefault(); choose(hits[+d.dataset.i]); } };
    inp.onblur = () => setTimeout(() => { if (keepOpen) return; list.hidden = true; if (!inp.value.trim()) choose(null); else inp.value = label(A.find(a => a.id === box.dataset.id)); }, 150);
  });
}

/* ================================================================ drop many at once: each file is matched to its element, you confirm, they upload and check in the background */
const words = t => String(t || '').toLowerCase().replace(/\.pdf$/, '').split(/[^a-z0-9]+/).filter(w => w.length > 2 && !['the', 'and', 'ltd', 'limited', 'schedule', 'warranty', 'deed', 'signed', 'pdf', 'godley', 'road', 'for'].includes(w));
const ck = s => String(s || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/\b(limited|ltd|nz|new zealand|the|group|t\/a)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
function guess(name) {
  const k = kindFromText(name), nm = ' ' + ck(name) + ' ';
  // a contract-wide guarantee goes on its own element when the register has one
  const own = { sch19: /weathertight/i, sch18: /parent company/i, bond: /\bbond\b|retention|security/i }[k];
  if (own) { const hit = fm().assets.find(a => own.test(a.element || '')); if (hit) return { a: hit, k, sure: true }; }
  const W = words(name), score = a => { const hay = words([a.element, a.product].join(' ')); return W.filter(w => hay.some(h => h.startsWith(w) || w.startsWith(h))).length; };
  // the company first: a company in Contacts with the elements it did, or the installer named on the element
  const firstWord = s => ck(s).split(' ').find(w => w.length >= 4) || '';
  const co = (S.project.directory || []).find(c => (c.assetIds || []).length && [c.company, c.legal].some(x => firstWord(x) && nm.includes(' ' + firstWord(x) + ' ')));
  let pool = co ? co.assetIds.map(id => fm().assets.find(a => a.id === id)).filter(Boolean) : [];
  if (!pool.length) pool = fm().assets.filter(a => a.status !== 'Not applicable' && String(a.installer || '').split(/[\/;,]/).some(x => firstWord(x) && nm.includes(' ' + firstWord(x) + ' ')));
  if (pool.length === 1) return { a: pool[0], k, sure: true };
  if (pool.length > 1) { const best = pool.map(a => ({ a, sc: score(a) })).sort((x, y) => y.sc - x.sc); return { a: best[0].a, k, sure: best[0].sc > (best[1] ? best[1].sc : -1) }; }
  // otherwise by words, but only a clear match; a weak one is left for you rather than guessed
  let best = null, bs = 0; for (const a of fm().assets) { if (a.status === 'Not applicable') continue; const sc = score(a); if (sc > bs) { bs = sc; best = a; } }
  return { a: bs >= 2 ? best : null, k, sure: bs >= 2, none: bs < 2 };
}
async function aiGuess(f, rows) {
  try { const L = await DV.pdfLib(), pdf = await L.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise; const pg = await pdf.getPage(1), t = (await pageRuns(L, pg)).map(r => r.s).join(' ').replace(/\s+/g, ' ').slice(0, 2500);
    const list = fm().assets.filter(a => a.status !== 'Not applicable').map(a => `${a.ref} | ${a.element} | ${a.installer || ''} | ${a.product || ''}`).join('\n').slice(0, 9000);
    const ask = `Match this construction warranty document to the one element it covers. Answer JSON only: {"ref":"the element ref from the list","kind":"deed" for a Schedule 13 / contractor warranty deed, "sch19" for a Schedule 19 weathertightness guarantee, "sch18" for a parent company guarantee, "bond" for a performance, retention or advance payment bond or bank guarantee, "product" for a manufacturer or product warranty, "other" for anything else}.\n\nELEMENTS (ref | element | installer | product)\n${list}\n\nFILE NAME: ${f.name}\n`;
    const j = parse(await aiCall(t.length > 150 ? ask + 'PAGE 1 TEXT: ' + t : ask + 'The picture is page 1.', t.length > 150 ? undefined : await pageImage(pg))); pdf.destroy();
    return j && { a: fm().assets.find(a => String(a.ref) === String(j.ref)), k: Object.keys(kinds()).includes(j.kind) ? j.kind : null };
  } catch (e) { console.warn('match', e); return null; }
}
export async function bulk(files0) {
  if (!can.write()) return toast('Your role cannot submit documents');
  const files = []; for (const f of files0) { if (isImg(f)) { try { files.push(await imgToPdf([f])); } catch (e) { files.push(f); } } else files.push(f); }
  const L = files.filter(f => /\.pdf$/i.test(f.name)), skipped = files.length - L.length; if (!L.length) return toast('Drop PDFs or photos (JPG, PNG) here.');
  const A = fm().assets.filter(a => a.status !== 'Not applicable').sort((a, b) => natural(a.system, b.system) || natural(a.ref || '', b.ref || ''));
  const opt = id => `<option value="">Choose the element…</option>` + A.map(a => `<option value="${esc(a.id)}" ${a.id === id ? 'selected' : ''}>${esc((a.ref || '') + ' ' + a.element + (a.installer ? ' (' + a.installer + ')' : ''))}</option>`).join('');
  const rows = L.map(f => ({ f, ...guess(f.name) }));
  modal(`<h2>⬆ Submit ${L.length} document${L.length === 1 ? '' : 's'}</h2><p class="note">Each file has been matched to the element it most likely covers${skipped ? ` (${skipped} non-PDF file${skipped === 1 ? '' : 's'} left out)` : ''}. Check the matches, then submit. They upload and are checked in the background, so you can carry on working.</p>
  <table class="ftable bkt bkbig"><colgroup><col style="width:150px"><col><col style="width:34%"><col style="width:200px"></colgroup><tr><th></th><th>File</th><th>Element</th><th>Type</th></tr>${rows.map((r, i) => `<tr><td><canvas class="bkth" id="bkT${i}" title="Click to see it larger"></canvas></td><td>${esc(r.f.name)}<br><span class="muted" id="bkS${i}">${r.sure ? 'matched by company or name' : 'matching…'}</span></td><td>${pickHtml('bkA' + i, r.a)}</td><td><select id="bkK${i}">${kindOpts(r.k)}</select></td></tr>`).join('')}</table>
  ${aiToggle('bkAi')}
  <div class="act"><button id="bkX">Cancel</button><button class="go" id="bkGo">Submit</button></div>`, true);
  $('mbox').classList.add('xwide'); $('bkX').onclick = () => { $('mbox').classList.remove('xwide'); closeModal(); }; const touched = new Set(); wirePicks(A, k => touched.add(k));
  // page 1 of each file, so the match can be checked at a glance; click for a big view
  rows.forEach(async (r, i) => { try { const L = await DV.pdfLib(), pdf = await L.getDocument({ data: new Uint8Array(await r.f.arrayBuffer()) }).promise, pg = await pdf.getPage(1), b = pg.getViewport({ scale: 1 }), vp = pg.getViewport({ scale: 1100 / b.width }), c = $('bkT' + i); if (!c) return; c.width = vp.width; c.height = vp.height; await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise; c.onclick = () => c.classList.toggle('big'); pdf.destroy(); } catch (e) { console.warn('thumb', e); } });
  rows.forEach(async (r, i) => { if (r.sure) return; const g = await aiGuess(r.f); const box = document.querySelector(`[data-apk="bkA${i}"]`); if (!box) return; if (g && g.a && !touched.has('bkA' + i)) { box.dataset.id = g.a.id; box.querySelector('input').value = label(g.a); $('bkS' + i).textContent = 'matched by reading page 1'; } else $('bkS' + i).textContent = g && g.a ? '' : 'no match found: choose it'; if (g && g.k && !$('bkK' + i).dataset.touched && (r.k === 'other' || r.k === 'product')) $('bkK' + i).value = g.k; });
  L.forEach((_, i) => { $('bkK' + i).onchange = e => e.target.dataset.touched = 1; });
  $('bkGo').onclick = async () => {
    const go = L.map((f, i) => ({ f, a: fm().assets.find(a => a.id === pickVal('bkA' + i)), k: $('bkK' + i).value }));
    const miss = go.filter(x => !x.a).length; if (miss) return toast(`Choose the element for ${miss} file${miss === 1 ? '' : 's'}`);
    const useAi = $('bkAi').checked; setAi(useAi); $('mbox').classList.remove('xwide'); closeModal(); const b = busy('Uploading…'); let n = 0;
    try { for (const x of go) { b.set(`Uploading ${++n} of ${go.length}: ${x.f.name}`); route(await upload(x.f, x.a, x.k, '', null, typeOf(x.k, 'Other')), useAi); } b.done(); toast(useAi ? `${go.length} uploaded. Checking in the background: the results appear in the list as they finish.` : `${go.length} uploaded and sent for review.`, 6000); }
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
async function convert(d, a, k, ai) {
  const sub = { kind: k, status: 'Checking', by: S.user.email, byName: S.user.name, at: now(), note: 'Linked from the document library.', replaces: '', history: [{ t: now(), who: S.user.name, txt: 'Linked from the document library and submitted for checking.' }] };
  const patch = plain({ submitted: true, source: false, assetIds: [...new Set([a.id, ...(d.assetIds || [])])], type: typeOf(k, d.type), system: d.system || a.system || '', sub });
  await S.store.patchItem(S.project.id, 'docs', d.id, patch); const r = { ...d, ...patch }; route(r, ai); return r;
}
export function linkExisting(a) {
  const W = words([a.installer, a.element, a.product].join(' ')), score = d => { const h = words([d.title, d.party, d.fileName].join(' ')); return W.filter(w => h.some(x => x.startsWith(w) || w.startsWith(x))).length + ((d.assetIds || []).includes(a.id) ? 5 : 0) + (isWarr(d) ? 1 : 0); };
  const L = libCands().map(d => ({ d, sc: score(d) })).sort((x, y) => y.sc - x.sc || natural(x.d.title, y.d.title));
  modal(`<h2>🔗 Link a document to ${esc(a.ref || '')} ${esc(a.element)}</h2><p class="note">Choose a document already in the library. It is checked the same way as an upload. The best matches are at the top.</p>
  <input type="search" id="lkQ" placeholder="Search the library…" style="width:100%;margin-bottom:8px"><div class="lkl" id="lkL"></div>
  ${aiToggle('lkAi')}
  <div class="act"><button id="lkX">Cancel</button></div>`, true);
  const draw = () => { const q = $('lkQ').value.toLowerCase().trim(); $('lkL').innerHTML = L.filter(x => !q || q.split(' ').every(w => [x.d.title, x.d.fileName, x.d.system].join(' ').toLowerCase().includes(w))).slice(0, 60).map(({ d, sc }) => `<div class="lkr"><div><b>${esc(d.title)}</b><br><span class="muted small">${esc(d.system || '')} · ${esc(d.type || '')}${(d.assetIds || []).includes(a.id) ? ' · already linked to this element' : ''}</span></div><select data-lk="${esc(d.id)}">${kindOpts(kindOf(d))}</select><button class="btn2 sm" data-lkgo="${esc(d.id)}">Link</button></div>`).join('') || '<p class="muted">No documents match.</p>';
    document.querySelectorAll('[data-lkgo]').forEach(b => b.onclick = async () => { const d = fm().docs.find(x => x.id === b.dataset.lkgo), k = document.querySelector(`[data-lk="${b.dataset.lkgo}"]`).value || kindOf(d); const useAi = $('lkAi').checked; setAi(useAi); closeModal(); try { await convert(d, a, k, useAi); toast(useAi ? 'Linked. Checking in the background.' : 'Linked and sent for review.', 4000); refresh(); } catch (e) { toast('Could not link: ' + e.message, 6000); } }); };
  $('lkQ').oninput = draw; $('lkX').onclick = closeModal; draw(); $('lkQ').focus();
}
// Every warranty already in the library, matched to its element in one go
// Every warranty already in the library, matched to its element in one go. Documents that look like versions of each other are
// grouped: you compare them side by side and decide which is current. Nothing is left out or deleted without you choosing it.
const ML = { over: {}, solo: new Set(), out: new Set() };
// the company a document came from: its name up to the first " - ", brackets included, without generic words
const CO_GENERIC = ['construction', 'constructions', 'services', 'service', 'group', 'limited', 'ltd', 'company', 'holdings', 'contracting', 'contractors', 'contractor', 'solutions', 'building', 'builders', 'new', 'zealand', 'and', 'the', 'auckland', 'north', 'south', 'nz'];
const coWords = d => new Set(String(d.party || String(d.title || '').split(' - ')[0] || '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2 && !CO_GENERIC.includes(w)));
const sameCo = (x, y) => { const A = coWords(x), B = coWords(y); if (!A.size || !B.size) return true; for (const w of A) if (B.has(w)) return true; return false; };
const TPL = /(^|[^a-z])(form of|template|draft|fillable|prepopulated|blank|unexecuted)([^a-z]|$)/i;
const dateIn = d => { const m = /(\d{1,2})[-./](\d{1,2})[-./](20\d\d)/.exec([d.title, d.fileName].join(' ')); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : String(d.created || '').slice(0, 10); };
const simWords = d => new Set(words([d.title, d.fileName].join(' ')).filter(w => !/^\d+$/.test(w) && !['yr', 'check', 'signed', 'dated', 'unsigned', 'version', 'issue', 'copy', 'final'].includes(w)));
const similar = (x, y) => { const A = simWords(x), B = simWords(y); if (!A.size || !B.size) return false; let n = 0; A.forEach(w => B.has(w) && n++); return n / Math.min(A.size, B.size) >= 0.7; };
export function matchLibrary() {
  clearPeeks();
  const L = libCands().filter(isWarr); if (!L.length) return toast('No unlinked warranties in the library');
  const A = fm().assets.filter(a => a.status !== 'Not applicable').sort((a, b) => natural(a.system, b.system) || natural(a.ref || '', b.ref || ''));
  const rows = L.map(d => { const g = guess([d.title, d.party, d.fileName].join(' ')), k = kindOf(d), lk = (d.assetIds || []).map(id => A.find(a => a.id === id)).filter(Boolean), own = ['sch19', 'sch18', 'bond'].includes(k) && g.sure;
    const rv = d.mlReviewed && d.mlReviewed.at ? d.mlReviewed : null, o = ML.over[d.id] || rv; return { d, rev: rv, a: o ? A.find(a => a.id === o.a) || null : own ? g.a : lk[0] || g.a, sure: own || !!lk[0] || g.sure, k: o ? (o.k || k) : k, tpl: TPL.test([d.title, d.fileName].join(' ')), empty: !d.size }; });
  // groups: same element and type, or near-identical names, in the same building system
  const gid = new Map(); let next = 0;
  rows.forEach((r, i) => rows.forEach((q, j) => { if (j <= i || r.tpl || q.tpl || ML.out.has(r.d.id) || ML.out.has(q.d.id) || (ML.solo.has(r.d.id) && ML.solo.has(q.d.id)) || !sameCo(r.d, q.d)) return; const same = (r.a && q.a && r.a.id === q.a.id && r.k === q.k && !['product', 'other'].includes(r.k)) || ((r.d.system || '') === (q.d.system || '') && similar(r.d, q.d));
    if (!same) return; const g = gid.get(r.d.id) ?? gid.get(q.d.id) ?? next++; [r, q].forEach(x => { const old = gid.get(x.d.id); if (old != null && old !== g) rows.forEach(y => { if (gid.get(y.d.id) === old) gid.set(y.d.id, g); }); gid.set(x.d.id, g); }); }));
  const groups = {}; rows.forEach(r => { const g = gid.get(r.d.id); if (g != null) (groups[g] = groups[g] || []).push(r); });
  Object.values(groups).forEach(G => G.sort((x, y) => (x.empty - y.empty) || dateIn(y.d).localeCompare(dateIn(x.d))));
  rows.forEach(r => { const G = groups[gid.get(r.d.id)]; r.grp = G && G.length > 1 ? G : null; r.newest = r.grp ? r.grp[0] === r : true; });
  // first time through, only the newest of a group and no templates are put forward; your own choices are kept
  rows.forEach(r => { if ((ML.over[r.d.id] || r.rev) && !r.empty) return; if (r.tpl || !r.newest || r.empty) r.a = null; });
  rows.sort((x, y) => natural(x.d.system || '', y.d.system || '') || (gid.get(x.d.id) ?? 1e9) - (gid.get(y.d.id) ?? 1e9) || (x.grp && y.grp ? x.grp.indexOf(x) - y.grp.indexOf(y) : 0) || natural(x.d.title, y.d.title));
  const nG = Object.values(groups).filter(G => G.length > 1).length, note = r => r.grp ? `<span class="mlg ${r.newest ? '' : 'old'}">${r.newest ? '⧉ newest of ' + r.grp.length + ' similar' : '⧉ similar to a newer document'} · <a href="#" data-cmp="${esc(r.d.id)}">compare side by side</a></span>` : '';
  modal(`<h2>🔗 Match warranties already in the library</h2><p class="note">${L.length} warranties in the library are not yet tracked as submissions. Each has been matched to its element by its name and the company. ${nG ? `<b>${nG} groups look like versions of the same document</b>: only the newest of each is filled in. Use “compare side by side” to check, then link, move to Superseded or delete.` : ''} Blank forms and templates start empty. Click an element box and type to change it; leave it empty to leave the document out. <b>Tick each row once you have checked it</b>: ticks are saved, so you can stop and come back.</p>
  <div class="mlprog"><span><b id="mlN">0</b> of ${rows.length} checked</span><label><input type="checkbox" id="mlHide" ${ML.hide ? 'checked' : ''}> Hide checked rows</label></div>
  <table class="ftable bkt${ML.hide ? ' mlhide' : ''}" id="mlT"><colgroup><col style="width:46px"><col><col style="width:30%"><col style="width:180px"><col style="width:132px"></colgroup><tr><th title="Tick each row once you have checked it">✓</th><th>Document</th><th>Element</th><th>Type</th><th></th></tr>${rows.map((r, i) => `<tr data-row="${i}" class="${r.grp ? 'mlgr' : ''}${r.grp && !r.newest ? ' mlold' : ''}${r.rev ? ' mlrev' : ''}"><td class="mlck"><input type="checkbox" data-rv="${i}" title="Tick when you have checked this row" ${r.rev ? 'checked' : ''}></td><td class="small mlt"><b id="mlTi${i}">${esc(r.d.title)}</b>${can.edit() ? ` <button class="mini" data-mn="${i}" title="Rename this document">✎</button>` : ''}<br><span class="muted">${esc(r.d.system || '')} · ${esc(dateIn(r.d) ? nzDate(dateIn(r.d)) : '')}${r.empty ? ' · <b style="color:#a32222">no file stored (empty entry)</b>' : ''}${r.tpl ? ' · <b>blank form or template</b>' : ''}${!r.grp && !r.tpl && !r.a ? ' · <b style="color:#8a5e00">no element fits: choose one or create it</b>' : !r.grp && !r.tpl && !r.sure ? ' · <i>check this match</i>' : ''}</span>${note(r)}<span class="mlrvby" id="mlRv${i}">${r.rev ? '✓ Checked by ' + esc(r.rev.name || r.rev.by || '') + ', ' + esc(nzDate(String(r.rev.at).slice(0, 10))) : ''}</span></td><td>${pickHtml('mlA' + i, r.a, 'Type to find it, or leave empty to leave out')}</td><td><select id="mlK${i}">${kindOpts(r.k)}</select></td><td class="mlact">${r.d.size ? `<button class="mini" data-mv="${esc(r.d.id)}" title="View the document">👁</button>` : '<span class="mlph"></span>'}${r.tpl && can.edit() ? `<button class="mini" data-mt="${esc(r.d.id)}" title="Keep it for the project team under Documents > Templates. Never in the handover export.">📋</button>` : '<span class="mlph"></span>'}${can.admin() ? `<button class="mini warn" data-md="${esc(r.d.id)}" title="Delete from the library">🗑</button>` : ''}</td></tr>`).join('')}</table>
  ${aiToggle('mlAi')}
  <div class="act"><button id="mlX">Close</button><button id="mlGo" title="Link every row that has an element filled in, ticked or not">Link all filled in</button><button class="go" id="mlGoT" title="Link only the rows you have ticked">Link ticked (<span id="mlNT">0</span>)</button></div>`, true);
  const keep = () => rows.forEach((r, i) => { if (document.querySelector(`[data-apk="mlA${i}"]`)) ML.over[r.d.id] = { a: pickVal('mlA' + i), k: $('mlK' + i).value }; });
  $('mlX').onclick = () => { ML.over = {}; ML.solo = new Set(); closeModal(); };
  const ticked = i => !!(document.querySelector(`[data-rv="${i}"]`) || {}).checked;
  const counts = () => { $('mlN').textContent = rows.filter((r, i) => ticked(i)).length; $('mlNT').textContent = rows.filter((r, i) => ticked(i) && pickVal('mlA' + i)).length; };
  const saveRev = async (i, on) => { const r = rows[i], rec = on ? { by: S.user.email, name: S.user.name || S.user.email, at: now(), a: pickVal('mlA' + i) || '', k: $('mlK' + i).value } : null;
    r.rev = rec; const tr = document.querySelector(`tr[data-row="${i}"]`); if (tr) tr.classList.toggle('mlrev', !!on); $('mlRv' + i).textContent = on ? '✓ Checked by ' + rec.name + ', ' + nzDate(rec.at.slice(0, 10)) : ''; counts();
    try { await S.store.patchItem(S.project.id, 'docs', r.d.id, { mlReviewed: rec }); r.d.mlReviewed = rec; } catch (e) { toast('Could not save the tick: ' + e.message, 6000); } };
  wirePicks(A, key => { const i = +String(key).replace('mlA', ''); if (rows[i] && ticked(i)) saveRev(i, true); else counts(); });
  document.querySelectorAll('[data-rv]').forEach(c => c.onchange = () => saveRev(+c.dataset.rv, c.checked));
  rows.forEach((r, i) => { const k = $('mlK' + i); if (k) k.addEventListener('change', () => { if (ticked(i)) saveRev(i, true); }); });
  $('mlHide').onchange = e => { ML.hide = e.target.checked; $('mlT').classList.toggle('mlhide', ML.hide); }; counts();
  const docOf = id => fm().docs.find(x => x.id === id);
  document.querySelectorAll('[data-mv]').forEach(b => { const d = docOf(b.dataset.mv); docPeek(b, d); const td = b.closest('tr') && b.closest('tr').querySelector('td.mlt'); if (td) docPeek(td, d, true); b.onclick = () => { if (b._held) { b._held = 0; return; } keep(); closeModal(); DV.open(d, { ret: () => matchLibrary() }); }; });
  document.querySelectorAll('[data-mn]').forEach(b => b.onclick = e => { e.stopPropagation(); const i = +b.dataset.mn, r = rows[i], t = $('mlTi' + i); if (t.querySelector('input')) return;
    t.innerHTML = `<input class="mlren" style="width:100%" value="${esc(r.d.title)}">`; const inp = t.querySelector('input'); inp.focus(); inp.select(); let done = 0;
    const fin = async ok => { if (done++) return; const v = inp.value.trim(); if (!ok || !v || v === r.d.title) { t.textContent = r.d.title; return; }
      try { await S.store.patchItem(S.project.id, 'docs', r.d.id, { title: v }); r.d.title = v; t.textContent = v; toast('Renamed', 2500); } catch (err) { t.textContent = r.d.title; toast('Could not rename: ' + err.message, 6000); } };
    inp.onkeydown = ev => { if (ev.key === 'Enter') { ev.preventDefault(); fin(true); } else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); fin(false); } }; inp.onblur = () => fin(true); inp.onclick = ev => ev.stopPropagation(); });
  document.querySelectorAll('[data-mt]').forEach(b => b.onclick = async () => { keep(); const d = docOf(b.dataset.mt); try { await S.store.patchItem(S.project.id, 'docs', d.id, { template: true, type: 'Template / blank form' }); delete ML.over[d.id]; toast('Saved under Documents > Templates', 3500); matchLibrary(); } catch (e) { toast('Could not save: ' + e.message, 6000); } });
  document.querySelectorAll('[data-md]').forEach(b => b.onclick = async () => { keep(); const d = docOf(b.dataset.md);
    if (!(await confirmBox(d.size ? `Delete "${d.title}" (${d.fileName || ''})? It is removed from the library and cannot be recovered. Your file in OneDrive is not touched.` : `Delete this empty entry "${d.title}"? It has no file stored, so nothing is lost.`, 'Delete for good'))) return matchLibrary();
    try { await S.store.deleteItem(S.project.id, 'docs', d.id); if (d.path && d.size) { try { await S.store.deleteFile(d.path); } catch (e) {} } delete ML.over[d.id]; toast('Deleted'); } catch (e) { toast('Could not delete: ' + e.message, 6000); } matchLibrary(); });
  document.querySelectorAll('[data-cmp]').forEach(l => l.onclick = e => { e.preventDefault(); keep(); const r = rows.find(x => x.d.id === l.dataset.cmp); compare(r.grp.map(x => x.d), r.grp[0].a || r.a || A.find(a => a.id === pickVal('mlA' + rows.indexOf(r))), r.k); });
  const linkRows = async only => { const go = rows.map((r, i) => ({ d: r.d, a: A.find(a => a.id === pickVal('mlA' + i)), k: $('mlK' + i).value, t: ticked(i) })).filter(x => x.a && (!only || x.t));
    if (!go.length) return toast(only ? 'Tick the rows you have checked first. Each one needs an element to link to.' : 'Nothing chosen', 5000); const useAi = $('mlAi').checked; setAi(useAi); ML.over = {}; closeModal(); const b = busy('Linking…'); let n = 0;
    try { for (const x of go) { b.set(`Linking ${++n} of ${go.length}…`); await convert(x.d, x.a, x.k, useAi); } b.done(); toast(useAi ? `${go.length} linked. Checking in the background: results appear as they finish.` : `${go.length} linked and sent for review.`, 6000); } catch (e) { b.done(); toast(`Stopped after ${n - 1}: ${e.message}`, 8000); }
    refresh(); };
  $('mlGo').onclick = () => linkRows(false); $('mlGoT').onclick = () => linkRows(true);
}

/* ---------------- compare similar documents side by side, then decide */
async function renderInto(el, d, token) {
  if (!d.size) { el.innerHTML = `<div class="cmpempty"><b>No file is stored for this entry.</b><p>It was added on ${esc(nzDate(String(d.created || '').slice(0, 10)))} while the file was online-only in OneDrive, so only the name came through. It holds nothing to compare.</p><p>${can.admin() ? 'Delete this empty entry with the Delete button above. Your file in OneDrive is not touched.' : 'Ask an admin to delete this empty entry.'}</p></div>`; return; }
  el.innerHTML = '<p class="muted small">Loading…</p>';
  const words = []; el._words = null;
  try { const pdf = await DV.loadPdf(d); if (el.dataset.tok !== token) return; el.innerHTML = `<p class="muted small">${pdf.numPages} page${pdf.numPages === 1 ? '' : 's'}</p>`;
    for (let p = 1; p <= Math.min(pdf.numPages, 12); p++) { const pg = await pdf.getPage(p), base = pg.getViewport({ scale: 1 }), vp = pg.getViewport({ scale: Math.min(2, 900 / base.width) }), c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height; c.className = 'cmpg';
      await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise; if (el.dataset.tok !== token) return; const blank = isBlank(c);
      el.insertAdjacentHTML('beforeend', `<div class="cmppg">Page ${p} of ${pdf.numPages}${blank ? ' <b class="cmpbl">blank page</b>' : ''}${can.edit() && pdf.numPages > 1 ? ` <button class="mini" data-rmpg="${p}">🗑 Remove this page</button>` : ''}${can.edit() && pdf.numPages > 1 ? ` <button class="mini" data-split="${p}" title="Make these pages a separate document">✂ Split from here</button>` : ''}</div>`);
      const wrap = document.createElement('div'), ov = document.createElement('canvas'); wrap.className = 'cmpgw'; ov.className = 'cmpo'; ov.width = c.width; ov.height = c.height; wrap.append(c, ov); el.appendChild(wrap);
      try { const tc = await pg.getTextContent(), U = (await DV.pdfLib()).Util;
        tc.items.forEach(it => { const str = it.str || ''; if (!str.trim()) return; const t = U.transform(vp.transform, it.transform), fh = Math.hypot(t[2], t[3]) || 10, wd = (it.width || 0) * vp.scale, n = str.length || 1;
          const full = MEAS.measureText(str).width || n;   // place each word by the measured width of the text before it, not by letter count
          str.replace(/\S+/g, (w, i) => { const x0 = MEAS.measureText(str.slice(0, i)).width / full, x1 = MEAS.measureText(str.slice(0, i + w.length)).width / full; words.push({ w, k: norm(w), ov, x: t[4] + wd * x0, y: t[5] - fh, wd: wd * (x1 - x0), h: fh * 1.2 }); return w; }); });
      } catch (e) {} }
    el._words = words.filter(x => x.k);
    el.querySelectorAll('[data-rmpg]').forEach(b => b.onclick = () => removePage(d, +b.dataset.rmpg, pdf.numPages, el));
    el.querySelectorAll('[data-split]').forEach(b => b.onclick = () => splitDoc(d, +b.dataset.split, pdf.numPages, el));
    if (pdf.numPages > 12) el.insertAdjacentHTML('beforeend', '<p class="muted small">First 12 pages shown. Open it to see the rest.</p>'); pdf.destroy();
  } catch (e) { const gone = /40[34]|not.?found|unauthori/i.test(e.message || '');
    el.innerHTML = gone ? `<div class="cmpempty"><b>The file for this entry is missing from storage.</b><p>The library entry is here but its file could not be fetched (${esc(e.message)}). Choose the same file again from your folders to restore it; the entry, its links and history are kept.</p>${can.edit() ? '<p><label class="btn2 sm">⬆ Choose the file again<input type="file" accept=".pdf,application/pdf" hidden></label></p>' : ''}</div>` : `<p class="note">Could not show this document: ${esc(e.message)}</p>`;
    const inp = el.querySelector('input[type=file]'); if (inp) inp.onchange = async () => { const f = inp.files[0]; if (!f || !f.size) return toast('That file reads as empty'); const b = busy('Uploading ' + f.name + '…');
      try { const path = `projects/${S.project.id}/docs/${d.id}/${safeName(f.name)}`, url = await S.store.putFile(path, f); await S.store.patchItem(S.project.id, 'docs', d.id, { url, path, size: f.size, fileName: f.name, mime: f.type || 'application/pdf' }); Object.assign(d, { url, path, size: f.size, fileName: f.name }); b.done(); toast('File restored'); el.dataset.tok = Math.random().toString(36); renderInto(el, d, el.dataset.tok); } catch (x) { b.done(); toast('Could not upload: ' + x.message, 7000); } }; }
}
let CMP_LOCK = true, CMP_DIFF = true, CMP_SCROLL = null;
// A page is blank when almost every pixel is close to white (scanners leave specks, so a little ink is allowed)
function isBlank(c) { try { const w = 400, h = Math.round(c.height / c.width * w) || 1, t = document.createElement('canvas'); t.width = w; t.height = h; const x = t.getContext('2d'); x.drawImage(c, 0, 0, w, h);
  const px = x.getImageData(0, 0, w, h).data; let ink = 0; for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] < 600) ink++; return ink < 25; } catch (e) { return false; } }
// Remove one page from a stored PDF. The file before the change is kept with the entry, so it can be put back.
async function removePage(d, n, total, el) {
  // the confirm box takes over the window, so remember where both sides were and bring the comparison back afterwards
  const back = el._redraw, keep = { L: ($('cmpL') || {}).scrollTop || 0, R: ($('cmpR') || {}).scrollTop || 0 };
  const reopen = () => { if (back) { CMP_SCROLL = keep; back(); } };
  if (!(await confirmBox(`Remove page ${n} of ${total} from "${d.title}"? The file is saved again without it. The file as it was is kept with this entry, so it can be put back.`, 'Remove the page'))) return reopen();
  const b = busy('Removing page ' + n + '…');
  try { if (!window.PDFLib) await loadScript('lib/pdf-lib.min.js');
    const P = window.PDFLib, doc = await P.PDFDocument.load(await X.getBytes(d.url), { ignoreEncryption: true }); if (doc.getPageCount() < 2) throw new Error('it only has one page');
    doc.removePage(n - 1); const bytes = await doc.save(), blob = new Blob([bytes], { type: 'application/pdf' });
    const dir = String(d.path || `projects/${S.project.id}/docs/${d.id}/x`).split('/').slice(0, -1).join('/'), path = `${dir}/${Date.now().toString(36)}-${safeName(d.fileName || 'document.pdf')}`, url = await S.store.putFile(path, blob);
    const prev = [...(d.prevFiles || []), { url: d.url, path: d.path || '', size: d.size || 0, at: new Date().toISOString(), by: S.user.email, why: `Before page ${n} of ${total} was removed`, marks: d.marks || [] }];
    // clause boxes follow their pages; any on the removed page go
    const marks = (d.marks || []).filter(m => m.page !== n).map(m => m.page > n ? { ...m, page: m.page - 1 } : m);
    const patch = { url, path, size: blob.size, prevFiles: prev, marks, textIdx: null };
    await S.store.patchItem(S.project.id, 'docs', d.id, patch); Object.assign(d, patch); b.done(); toast(`Page ${n} removed. The earlier file is kept with this entry.`, 5000);
    if (back) return reopen(); el.dataset.tok = Math.random().toString(36); await renderInto(el, d, el.dataset.tok);
  } catch (e) { b.done(); toast('Could not remove the page: ' + e.message, 8000); reopen(); }
}
// Differences: a word counts as shared when it appears in the other document with the same word before or after it,
// so a changed date, name, figure or clause stands out while text that has only moved is left alone.
const MEAS = (() => { const g = document.createElement('canvas').getContext('2d'); g.font = '20px Helvetica, Arial, sans-serif'; return g; })();
const norm = w => String(w).toLowerCase().replace(/[^a-z0-9$%.\/-]/g, '').replace(/^[.\/-]+|[.\/-]+$/g, '');
function markDiffs(A, B, on) {
  const pairs = W => { const s = new Set(); for (let i = 0; i < W.length - 1; i++) s.add(W[i].k + ' ' + W[i + 1].k); return s; };
  const pa = pairs(A), pb = pairs(B), only = (W, other) => W.filter((x, i) => !((i > 0 && other.has(W[i - 1].k + ' ' + x.k)) || (i < W.length - 1 && other.has(x.k + ' ' + W[i + 1].k))));
  const dA = only(A, pb), dB = only(B, pa);
  [...A, ...B].forEach(x => { if (!x.ov._clr) { x.ov.getContext('2d').clearRect(0, 0, x.ov.width, x.ov.height); x.ov._clr = 1; } }); [...A, ...B].forEach(x => delete x.ov._clr);
  if (on) [[dA, 'rgba(255,196,0,.42)'], [dB, 'rgba(0,170,255,.32)']].forEach(([L, col]) => L.forEach(x => { const g = x.ov.getContext('2d'); g.fillStyle = col; g.fillRect(x.x - 1, x.y, x.wd + 2, x.h); }));
  return { dA, dB };
}
// Split a PDF that holds two documents: chosen pages become a new library entry (same system, company and links),
// and are taken out of this one unless you choose to keep them. The file as it was is kept with this entry.
async function splitDoc(d, from, total, el) {
  const back = el._redraw, keep = { L: ($('cmpL') || {}).scrollTop || 0, R: ($('cmpR') || {}).scrollTop || 0 }, reopen = () => { if (back) { CMP_SCROLL = keep; back(); } };
  const base = String(d.title || '').replace(/\s*\([^)]*\)\s*$/, '');
  modal(`<h2>✂ Split into a new document</h2><p class="note">"${esc(d.title)}" has ${total} pages. The pages you choose become a new document in the library, filed under the same system and company and linked to the same elements.</p>
    <div class="grid"><label class="f">From page<input id="spA" type="number" min="1" max="${total}" value="${from}"></label><label class="f">To page<input id="spB" type="number" min="1" max="${total}" value="${total}"></label>
    <label class="f full">Name of the new document<input id="spT" value="${esc(base)} - "></label>
    <label class="f full">Type<select id="spY">${(X.DOC_TYPES || []).map(t => `<option ${t === d.type ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
    <div class="opt full"><input type="checkbox" id="spK" checked><label for="spK">Take these pages out of "${esc(d.title)}" (the file as it was is kept with it, so this can be put back)</label></div></div>
    <div class="act"><button id="spX">Cancel</button><button class="go" id="spGo">Split</button></div>`);
  $('spX').onclick = () => { closeModal(); reopen(); };
  $('spGo').onclick = async () => {
    const a = Math.max(1, +$('spA').value || 1), z = Math.min(total, +$('spB').value || total), title = $('spT').value.trim().replace(/\s*-\s*$/, ''), cut = $('spK').checked;
    if (a > z) return toast('The first page has to come before the last');
    if (cut && a === 1 && z === total) return toast('That is every page: untick "Take these pages out", or choose fewer pages');
    if (!title || title === base) return toast('Give the new document its own name, for example what the warranty covers and its length');
    closeModal(); const b = busy('Splitting…');
    try { if (!window.PDFLib) await loadScript('lib/pdf-lib.min.js');
      const P = window.PDFLib, src = await P.PDFDocument.load(await X.getBytes(d.url), { ignoreEncryption: true }), idx = Array.from({ length: z - a + 1 }, (_, i) => a - 1 + i);
      const nd = await P.PDFDocument.create(); (await nd.copyPages(src, idx)).forEach(pg => nd.addPage(pg)); const nb = new Blob([await nd.save()], { type: 'application/pdf' });
      const id = uid(), fileName = safeName(title) + '.pdf', folder = d.restricted ? 'restricted' : 'docs', path = `projects/${S.project.id}/${folder}/${id}/${fileName}`, url = await S.store.putFile(path, nb);
      const o = { id, title, fileName, url, path, size: nb.size, mime: 'application/pdf', type: $('spY') ? $('spY').value : d.type, system: d.system || '', party: d.party || '', issued: d.issued || '', audience: d.audience || 'FM', assetIds: (d.assetIds || []).slice(),
        marks: (d.marks || []).filter(m => m.page >= a && m.page <= z).map(m => ({ ...m, page: m.page - a + 1 })), splitFrom: { id: d.id, title: d.title, pages: `${a}-${z}` }, created: new Date().toISOString(), createdBy: S.user.email };
      if (!$('spY')) o.type = d.type || 'Other';
      if (d.restricted) await S.store.bulkSave(S.project.id, 'rdocs', [o]); else await S.store.saveItem(S.project.id, 'docs', o);
      if (cut) { idx.slice().reverse().forEach(i => src.removePage(i)); const ob = new Blob([await src.save()], { type: 'application/pdf' });
        const dir = String(d.path || `projects/${S.project.id}/docs/${d.id}/x`).split('/').slice(0, -1).join('/'), op = `${dir}/${Date.now().toString(36)}-${safeName(d.fileName || 'document.pdf')}`, ou = await S.store.putFile(op, ob);
        const prev = [...(d.prevFiles || []), { url: d.url, path: d.path || '', size: d.size || 0, at: new Date().toISOString(), by: S.user.email, why: `Before pages ${a} to ${z} were split out into "${title}"`, marks: d.marks || [] }];
        const marks = (d.marks || []).filter(m => m.page < a || m.page > z).map(m => m.page > z ? { ...m, page: m.page - (z - a + 1) } : m);
        const patch = { url: ou, path: op, size: ob.size, prevFiles: prev, marks, textIdx: null }; await S.store.patchItem(S.project.id, 'docs', d.id, patch); Object.assign(d, patch); }
      b.done(); toast(`"${title}" is now its own document${(d.assetIds || []).length ? ', linked to the same elements' : ''}.`, 6000); reopen();
    } catch (e) { b.done(); toast('Could not split it: ' + e.message, 8000); reopen(); }
  };
}
function compare(G, a, k) {
  clearPeeks();
  G = G.map(d => fm().docs.find(x => x.id === d.id)).filter(Boolean); if (G.length < 2) return matchLibrary();
  let L = 0, R = 1; const adm = can.admin();
  const side = (i, w) => { const d = G[i]; return `<div class="cmps"><div class="cmph"><select data-side="${w}">${G.map((x, j) => `<option value="${j}" ${j === i ? 'selected' : ''}>${esc(nzDate(dateIn(x)) || '')} · ${esc(x.title)}</option>`).join('')}</select>
    <div class="small muted">${esc(d.fileName || '')} · ${d.size ? (d.size / 1e6).toFixed(1) + ' MB' : '<b style="color:#a32222">empty: no file stored</b>'} · added ${esc(nzDate(String(d.created || '').slice(0, 10)))}${d.createdBy ? ' by ' + esc(d.createdBy) : ''}</div>
    <div class="cmpa">${d.size ? `<button class="btn2 go sm" data-use="${w}">✔ Link this one</button>` : ''}<button class="btn2 sm" data-sup="${w}">Move to Superseded</button>${adm ? `<button class="btn2 sm warn" data-del="${w}">🗑 Delete</button>` : ''}<button class="btn2 sm" data-open="${w}">Open</button>${G.length > 2 ? `<button class="btn2 sm" data-out="${w}" title="This one is a different document: take it out of this group">≠ Not this one</button>` : ''}</div></div><div class="cmpb" id="cmp${w}"></div></div>`; };
  const draw = () => { modal(`<h2>⧉ Compare similar documents (${G.length})</h2><p class="note">Scroll each side to compare <label class="cmplk"><input type="checkbox" id="cmLock" ${CMP_LOCK ? 'checked' : ''}> scroll together, page by page</label> <label class="cmplk"><input type="checkbox" id="cmDiff" ${CMP_DIFF ? 'checked' : ''}> highlight differences</label> <span id="cmDN" class="small"></span> <button class="mini" id="cmNext" hidden>Next difference ▾</button>. Pick which to link, move older versions to Superseded (kept, but out of the way), or delete a file that should not be here.</p><div class="cmpw">${side(L, 'L')}${side(R, 'R')}</div><div class="act"><button id="cmApart" title="They were grouped because they matched the same element or have similar names">≠ These are different documents</button><button id="cmX">‹ Back to the list</button></div>`, true);
    $('mbox').classList.add('xwide'); const loads = ['L', 'R'].map(w => { const el = $('cmp' + w); el.dataset.tok = Math.random().toString(36); return renderInto(el, G[w === 'L' ? L : R], el.dataset.tok); });
    let spots = [], at = -1;
    const diffs = () => { const A = $('cmpL') && $('cmpL')._words, B = $('cmpR') && $('cmpR')._words; if (!A || !B) return;
      if (!A.length || !B.length) { $('cmDN').textContent = `(${!A.length && !B.length ? 'both are scans' : (!A.length ? 'the left one' : 'the right one') + ' is a scan'} with no readable text, so differences cannot be shown)`; return; }
      const r = markDiffs(A, B, CMP_DIFF); spots = r.dA.length ? r.dA : []; at = -1;
      $('cmDN').innerHTML = CMP_DIFF ? (r.dA.length || r.dB.length ? `<span class="cmpk l"></span>${r.dA.length} word${r.dA.length === 1 ? "" : "s"} only on the left · <span class="cmpk r"></span>${r.dB.length} only on the right` : 'No differences in the text') : ''; $('cmNext').hidden = !CMP_DIFF || !spots.length; };
    $('cmpL')._redraw = $('cmpR')._redraw = draw;
    Promise.all(loads).then(() => { diffs(); if (CMP_SCROLL) { const k = CMP_SCROLL; CMP_SCROLL = null; let lk = CMP_LOCK; CMP_LOCK = false; $('cmpL').scrollTop = k.L; $('cmpR').scrollTop = k.R; setTimeout(() => { CMP_LOCK = lk; }, 200); } });
    $('cmDiff').onchange = e => { CMP_DIFF = e.target.checked; diffs(); };
    $('cmNext').onclick = () => { if (!spots.length) return; const el = $('cmpL'); let k = at, y0 = el.scrollTop + 40;
      // jump to the next highlighted word lower down the left side (wrapping to the top)
      const yOf = x => x.ov.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop + x.y * (x.ov.offsetHeight / x.ov.height);
      const nxt = spots.findIndex(x => yOf(x) > y0); at = nxt < 0 ? 0 : nxt; el.scrollTop = Math.max(0, yOf(spots[at]) - 60); el.dispatchEvent(new Event('scroll')); };
    // Scroll together by page, not by overall length: the same page number, the same distance down it, so two
    // documents with different page counts or page sizes stay lined up. Untick to scroll each side on its own.
    const both = [$('cmpL'), $('cmpR')]; let lock = false; $('cmLock').onchange = e => { CMP_LOCK = e.target.checked; };
    const pages = el => [...el.querySelectorAll('canvas.cmpg')], topOf = (el, c) => c.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
    both.forEach((el, i) => el.onscroll = () => { if (lock || !CMP_LOCK) return; const P = pages(el), o = both[1 - i], Q = pages(o); if (!P.length || !Q.length) return;
      const y = el.scrollTop + 1; let k = 0; while (k < P.length - 1 && topOf(el, P[k + 1]) <= y) k++;
      const f = Math.max(0, Math.min(1, (y - topOf(el, P[k])) / P[k].offsetHeight)), j = Math.min(k, Q.length - 1), g = k > Q.length - 1 ? 1 : f;
      lock = true; o.scrollTop = topOf(o, Q[j]) + g * Q[j].offsetHeight - 1; requestAnimationFrame(() => lock = false); });
    document.querySelectorAll('[data-side]').forEach(s => s.onchange = () => { const v = +s.value; if (s.dataset.side === 'L') { if (v === R) R = L; L = v; } else { if (v === L) L = R; R = v; } draw(); });
    document.querySelectorAll('[data-out]').forEach(b => b.onclick = () => { const d = pick(b.dataset.out); ML.out.add(d.id); G = G.filter(x => x.id !== d.id); toast('Taken out of this group: ' + d.title, 4000); if (G.length < 2) { $('mbox').classList.remove('xwide'); return matchLibrary(); } L = 0; R = 1; draw(); });
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
  <label class="f">File (PDF, or photos of each page)<input type="file" id="sbF" multiple accept=".pdf,application/pdf,image/jpeg,image/png,image/webp"></label>
  <label class="f">Note to the reviewer (optional)<textarea id="sbN" rows="2" placeholder="e.g. Signed copy to follow by post"></textarea></label>
  ${aiToggle('sbAi')}
  <p class="note" id="sbHint"></p>
  <div class="act"><button id="sbX">Cancel</button><button class="go" id="sbGo">Upload and check</button></div>`);
  const kind = () => document.querySelector('input[name="sbK"]:checked').value;
  const sync = () => { const k = kind(); $('sbTW').style.display = k === 'other' ? '' : 'none'; $('sbF').accept = k === 'other' ? '' : '.pdf,application/pdf,image/jpeg,image/png,image/webp'; $('sbHint').textContent = isDeedLike(k) && k !== 'deed' ? 'It is checked straight away against the contract form: parties, contract date, period and execution as a deed.' : k === 'bond' ? 'It is checked straight away: issuer, beneficiary, contractor, amount and expiry or release date.' : k.startsWith('c:') ? 'It is checked straight away: parties, what it covers, period and signatures.' : k === 'deed' ? 'It is checked straight away: form, parties, works, period, date and signatures. You will see the result in about a minute and can fix anything before it goes for review.' : k === 'product' ? 'It is checked straight away: owner or property named, product, period and issuer.' : 'Supporting documents go straight to the reviewer.'; };
  document.querySelectorAll('input[name="sbK"]').forEach(r => r.onchange = sync); sync();
  $('sbX').onclick = () => replaces ? detail(replaces) : closeModal();
  $('sbGo').onclick = async () => {
    const F = [...$('sbF').files], k = kind(), note = $('sbN').value.trim(); let f = F[0]; if (!f) return toast('Choose the file first');
    if (F.length > 1 && !F.every(isImg)) return toast('Choose one PDF, or several photos of the same document');
    if (F.every(isImg) && k !== 'other') { const bb = busy(F.length > 1 ? `Joining ${F.length} photos into one PDF…` : 'Turning the photo into a PDF…'); try { f = await imgToPdf(F); } catch (e) { bb.done(); return toast('Could not use that picture: ' + e.message + '. Phone HEIC photos need saving as JPG first.', 9000); } bb.done(); }
    if (!f.size) return toast('That file reads as empty (0 bytes). If it is in OneDrive, open it once so it downloads, then choose it again.', 9000);
    if (f.size > 150e6) return toast('That file is over 150 MB');
    if (k !== 'other' && !/\.pdf$/i.test(f.name)) return toast('Warranties must be submitted as a PDF');
    const type = typeOf(k, $('sbT').value);
    const useAi = $('sbAi') ? $('sbAi').checked : aiOn(); setAi(useAi); closeModal(); const b = busy('Uploading ' + f.name + '…'); let d;
    try { d = await upload(f, a, k, note, replaces, type); } catch (e) { b.done(); return toast(e.message === 'offline' ? 'No connection: the file was not uploaded. Try again when you are back online.' : 'Could not upload: ' + e.message, 8000); }
    b.done(); route(d, useAi); toast(useAi ? 'Uploaded. Checking in the background: the result appears in the list in about a minute.' : 'Uploaded and sent for review.', 5000);
  };
}

/* ================================================================ one submission: result, actions, history */
const ICON = { true: '✓', false: '✗', null: '?' };
const checkHtml = (c, sel, d) => c && c.manual ? '<p class="note">Reviewing by hand: the automatic check was not run. Use Details > Check again to run it.</p>' : !c ? '<p class="muted small">Not checked yet.</p>' : c.error ? `<p class="note">The automatic check could not run (${esc(c.error)}). It has gone to the reviewer as it is. Use “Check again” to retry.</p>` : c.skipped ? '<p class="muted small">Supporting document: no automatic check.</p>'
  : `<div class="ckl">${c.items.map(i => `<div class="ck ${i.ok === true ? 'ok' : i.ok === false ? 'bad' : i.wait ? 'unk wait' : 'unk'}${sel === i.k ? ' sel' : ''}${d && (d.marks || []).some(m => m.ck === i.k) ? ' go' : ''}" data-ck="${esc(i.k)}"><i>${i.wait ? '✍' : ICON[i.ok]}</i><div><b>${esc(i.label)}</b>${i.found ? `<small>Found: ${esc(i.found)}</small>` : ''}${i.ok === false && i.fix ? `<small class="fix">To fix: ${esc(i.fix)}</small>` : ''}${i.wait ? `<small class="wait">Waiting for ${esc(S.project.contractor || 'the Contractor')} to sign its block. Everything the warrantor had to do is done.</small>` : i.ok === null ? '<small>Could not be told from the document: the reviewer will check this.</small>' : ''}</div></div>`).join('')}</div>`;
const handMarks = d => (d.marks || []).filter(m => !m.chk && (m.flag || m.note)).sort((x, y) => x.page - y.page || x.y - y.y);
// The document viewer's side panel is the review screen: the check, the actions, and the next one to review.
const queueFor = () => { const ed = can.edit(), want = ed ? ['Awaiting review'] : ['Failed check', 'Sent back']; return fm().docs.filter(x => isSub(x) && want.includes(x.sub.status) && DV.isPdf(x)).sort((a, b) => String(a.sub.at || '').localeCompare(String(b.sub.at || ''))); };
export function wireBox(d, openDoc, goMark) {
  if (isSub(d)) Reg.wire(fm().docs.find(x => x.id === d.id) || d, () => openDoc(fm().docs.find(x => x.id === d.id) || d));
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
  ${checking(d.id) || s.status === 'Checking' ? '<p class="muted small">Checking now. The result appears here when it finishes.</p>' : checkHtml(s.check, selMark && selMark.ck, d) + Reg.html(d)}${(s.check && s.check.items || []).length && !(d.marks || []).some(m => m.pass) ? '<p class="muted small">Checked before the passed points were boxed on the page. Use Details > Check again to box every point.</p>' : ''}
  <div class="sbact">${ed && s.status !== 'Superseded' && s.status !== 'Accepted' ? '<button class="btn2 go" id="sbvAcc">✔ Accept</button>' : ''}${ed && s.status !== 'Superseded' ? '<button class="btn2 warn" id="sbvBack">↩ Send back</button>' : ''}<button class="btn2" id="sbvMk">⬇ With markup</button><button class="btn2" id="sbvDet">Details</button><button class="btn2" id="sbvNx">Next ›${n ? ' (' + n + ')' : ''}</button></div>
  <p class="muted small">Press <b>Mark</b> and drag a box on the page to add your own point. It appears in the send-back note and the marked-up copy.</p></div>`;
}
function oldBoxHtml(d) {
  if (!isSub(d)) return ''; const s = d.sub, c = s.check, bad = c && c.items ? c.items.filter(i => i.ok === false) : [];
  return `<div class="dvctx"><b>Submission</b> ${chip(s.status, s)}<br><span class="small muted">Submitted ${esc(dt(s.at))} by ${esc(s.byName || s.by || '')}</span>${s.review && s.review.note ? `<br><span class="small" style="color:#a32222"><b>Reviewer:</b> ${esc(s.review.note).replace(/\n/g, '<br>')}</span>` : ''}${bad.length ? '<br><span class="small" style="color:#a32222"><b>To fix:</b><br>' + bad.map(i => '• ' + esc(i.fix || i.label)).join('<br>') + '</span>' : c && c.items && c.items.length ? '<br><span class="small" style="color:#1d6e43">Automatic check: all points passed.</span>' : ''}</div>`;
}
export function detail(d0) {
  const d = fm().docs.find(x => x.id === d0.id) || d0, s = d.sub, a = assetOf(d), c = s.check, hm = handMarks(d), ed = can.edit(), wr = can.write();
  const open = !['Accepted', 'Superseded'].includes(s.status);
  modal(`<h2>${esc(a ? (a.ref || '') + ' ' + (a.element || '') : d.title)}</h2>
  <p>${chip(s.status, s)} <span class="muted small">${esc(KIND[s.kind] || '')} · submitted ${esc(dt(s.at))} by ${esc(s.byName || s.by || '')}</span></p>
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
// Deeds that have passed every point and wait only for the Contractor's signature. The files go out untouched (a digital
// signature already on a deed would be broken by changing the file), in one zip for the Contractor's director to sign.
const signList = () => fm().docs.filter(d => isSub(d) && readyToSign(d.sub) && DV.isPdf(d));
async function signPack() {
  const L = signList(); if (!L.length) return toast('Nothing is waiting for signature'); const b = busy('Building the signing pack…');
  try { if (!window.JSZip) await loadScript('lib/jszip.min.js'); const z = new window.JSZip(), used = new Set();
    for (const [i, d] of L.entries()) { b.set(`Adding ${i + 1} of ${L.length}…`); let n = safeName(d.title).slice(0, 110) + '.pdf'; while (used.has(n)) n = n.replace(/\.pdf$/, ' (2).pdf'); used.add(n); z.file(n, await X.getBytes(d.url)); }
    z.file('READ ME.txt', `${L.length} deed${L.length === 1 ? '' : 's'} checked in Resero Site on ${nzDate(now())}: every point passed, and each waits only for ${S.project.contractor || 'the Contractor'} to sign the Contractor block.\r\n\r\nSign each one, then submit the signed copy against the same element (Details > Submit a new version). If a deed was signed digitally by the warrantor, sign it digitally too: printing and scanning it is also accepted, but do not edit the file.\r\n`);
    b.done(); deliver(await z.generateAsync({ type: 'blob' }), `${safeName(S.project.name)} - Deeds for ${safeName(coShort())} to sign - ${stamp()}.zip`, 'Signing pack'); } catch (e) { b.done(); toast('Could not build the pack: ' + e.message, 8000); }
}
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
  $('fmView').innerHTML = `<div class="fbar"><h2>Assets &amp; warranties</h2><input type="search" id="svQ" placeholder="Search element, product, installer…" value="${esc(VF.q)}"><select id="svS"><option value="">All systems</option>${(X.SYSTEMS || []).map(s => `<option ${s === VF.sys ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select><select id="svT">${[['', 'Everything'], ['out', 'Still outstanding'], ['fix', 'Needs fixing (' + C.fix + ')'], ['review', 'Awaiting review (' + C.review + ')'], ['acc', 'Accepted (' + C.accepted + ')']].map(([v, l]) => `<option value="${v}" ${v === VF.st ? 'selected' : ''}>${l}</option>`).join('')}</select>${can.edit() && signList().length ? `<button class="btn2" id="svSign" title="Every deed that has passed its check and is waiting only for ${esc(S.project.contractor || 'the Contractor')} to sign, in one download">✍ Signing pack (${signList().length})</button>` : ''}${can.edit() ? '<button class="btn2" id="svDeed" title=""Fillable Schedule 13 deeds, filled in from Project settings and Contacts, for the warrantor to sign">📝 Prepare deeds for signing</button>' : ''}${can.edit() ? `<button class="btn2" id="svLib">🔗 Match library warranties (${libCands().filter(isWarr).length})</button>` : ''}<button class="btn2 go" id="svRev">${can.edit() ? '▶ Review next (' + C.review + ')' : '▶ Fix next (' + C.fix + ')'}</button>${can.edit() ? `<button class="btn2" id="svZip" title="Accepted documents, named to the convention, in the handover folder structure">📦 Accepted, ready to file${toFile(false).length ? ' (' + toFile(false).length + ' new)' : ''}</button>` : ''}</div>
  ${tabs}
  <div class="sbdrop">⬇ Drop warranty PDFs anywhere on this page. Each one is matched to its element and checked in the background. You can drop many at once.</div>
  <p class="muted small">${can.edit() ? `${C.review} awaiting your review · ${C.fix} with the contractor to fix · ${C.accepted} accepted.` : `Submit each warranty against the element it covers. It is checked straight away so you can fix anything before it is reviewed. ${C.fix} need fixing · ${C.review} with the reviewer · ${C.accepted} accepted.`}</p>
  ${rows.length ? `<table class="ftable sbt"><tr><th>Ref</th><th>Element</th><th class="hm">Required</th><th>Status</th><th>Submitted</th><th></th></tr>
  ${rows.map(({ a, L }) => { const g = a.system !== last ? `<tr class="grp"><td colspan="6">${esc(a.system)}</td></tr>` : ''; last = a.system;
    return g + `<tr><td>${esc(a.ref || '')}</td><td><b>${esc(a.element || '')}</b><br><span class="muted small">${esc([a.installer, a.product].filter(Boolean).join(' · '))}</span></td><td class="hm small">${esc([a.instWarranty && 'Installer: ' + a.instWarranty, a.mfrWarranty && a.mfrWarranty !== '-' && 'Manufacturer: ' + a.mfrWarranty].filter(Boolean).join(' · '))}</td><td><span class="st ${a.status === 'Received' ? 'st-ok' : a.status === 'Not received' ? 'st-bad' : 'st-warn'}">${esc(a.status || '')}</span></td><td>${L.map(d => `<a href="#" class="sbchip" data-sd="${esc(d.id)}" title="${esc(d.title)}">${chip(d.sub.status, d.sub)}<small>${esc((kinds()[d.sub.kind] || ['', 'Document'])[1])} · ${esc(dt(d.sub.at))}</small></a>`).join('') || '<span class="muted small">Nothing yet</span>'}</td><td class="sbbtns">${wr ? `<button class="btn2 sm" data-sub="${esc(a.id)}">⬆ Submit</button>` : ''}${can.edit() ? `<button class="btn2 sm" data-lnk="${esc(a.id)}" title="Link a document already in the library">🔗 Link</button>` : ''}</td></tr>`; }).join('')}</table>` : '<div class="empty2">Nothing matches. Change the filter to see more.</div>'}`;
  $('svQ').oninput = e => { VF.q = e.target.value; X.render(); const i = $('svQ'); if (i) { i.focus(); i.setSelectionRange(VF.q.length, VF.q.length); } };
  if ($('svZip')) $('svZip').onclick = filingPack;
  $('svS').onchange = e => { VF.sys = e.target.value; X.render(); }; $('svT').onchange = e => { VF.st = e.target.value; X.render(); };
  document.querySelectorAll('[data-sub]').forEach(b => b.onclick = () => submitDialog(fm().assets.find(a => a.id === b.dataset.sub)));
  document.querySelectorAll('[data-sd]').forEach(l => l.onclick = e => { e.preventDefault(); const d = fm().docs.find(x => x.id === l.dataset.sd); if (!d) return; DV.isPdf(d) ? DV.open(d) : detail(d); });
  document.querySelectorAll('[data-lnk]').forEach(b => b.onclick = () => linkExisting(fm().assets.find(a => a.id === b.dataset.lnk)));
  if ($('svLib')) $('svLib').onclick = matchLibrary;
  if ($('svDeed')) $('svDeed').onclick = () => Deed.prepareDialog(); if ($('svSign')) $('svSign').onclick = signPack;
  if ($('svRev')) $('svRev').onclick = () => { const L = queueFor(); if (!L.length) return toast(can.edit() ? 'Nothing is waiting for review' : 'Nothing needs fixing'); DV.open(L[0]); };
  resume();
}

// Sneak view: hover a document (desktop) for a quick look at page 1; press and hold the eye for a full-screen look, let go to close.
const PEEK = new Map();
export function clearPeeks() { document.querySelectorAll('.dpop').forEach(x => x.remove()); }
function peekImg(d) {
  if (!PEEK.has(d.id)) PEEK.set(d.id, (async () => { const pdf = await DV.loadPdf(d), pg = await pdf.getPage(1), b = pg.getViewport({ scale: 1 }), vp = pg.getViewport({ scale: 1400 / b.width }), c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height; await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise; return { src: c.toDataURL('image/jpeg', .85), n: pdf.numPages }; })().catch(e => { PEEK.delete(d.id); throw e; }));
  return PEEK.get(d.id);
}
function docPeek(el, d, hoverOnly) {
  if (!d || el._dp) return; el._dp = 1; let ht = null, pop = null, t = null, ov = null;
  const fill = (box, big) => { box.innerHTML = '<div class="dpl">Loading page 1…</div>'; peekImg(d).then(r => { if (!box.isConnected) return; box.innerHTML = `<img alt="" src="${r.src}"><span>${esc(d.title)} · page 1 of ${r.n}${big ? ' · let go to close' : ''}</span>`; }).catch(() => { if (box.isConnected) box.innerHTML = '<div class="dpl">Preview not available. Click to open it.</div>'; }); };
  let iv = null; const hide = () => { clearTimeout(ht); ht = null; clearInterval(iv); iv = null; if (pop) { pop.remove(); pop = null; } };
  if (matchMedia('(hover: hover)').matches) {
    el.addEventListener('mouseenter', e => { if (ov) return; clearTimeout(ht); ht = setTimeout(() => { if (!el.isConnected || !el.matches(':hover')) return; clearPeeks(); pop = document.createElement('div'); pop.className = 'dpop'; document.body.appendChild(pop); const r = el.getBoundingClientRect(), w = Math.min(460, innerWidth * .4), left = r.right + 14 + w < innerWidth ? r.right + 14 : Math.max(8, r.left - w - 14); pop.style.left = left + 'px'; pop.style.width = w + 'px'; pop.style.top = Math.max(8, Math.min(r.top - 40, innerHeight - w * 1.45 - 8)) + 'px'; fill(pop); iv = setInterval(() => { if (!el.isConnected || !el.matches(':hover')) hide(); }, 200); }, 350); });
    el.addEventListener('mouseleave', hide); el.addEventListener('pointerdown', hide, true);
  }
  if (hoverOnly) return;
  const end = () => { clearTimeout(t); t = null; ['pointerup', 'pointercancel', 'blur'].forEach(n => window.removeEventListener(n, end, true)); if (ov) { ov.remove(); ov = null; setTimeout(() => { el._held = 0; }, 400); } };
  el.addEventListener('pointerdown', e => { if (e.button) return; hide(); clearTimeout(t); t = setTimeout(() => { hide(); el._held = 1; ov = document.createElement('div'); ov.className = 'peek dpeek'; document.body.appendChild(ov); fill(ov, true); try { navigator.vibrate && navigator.vibrate(15); } catch (x) {} }, 300); ['pointerup', 'pointercancel', 'blur'].forEach(n => window.addEventListener(n, end, true)); });
  el.addEventListener('contextmenu', e => e.preventDefault());
}
