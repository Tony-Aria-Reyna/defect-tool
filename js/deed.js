// Ready-to-sign warranty deeds: the contract's Schedule 13 form, filled in from Project settings, the company directory and the
// register, as a fillable PDF. The warrantor checks the details, dates it and signs. Everything they still need to do is boxed
// and explained on a cover page.
import { S, can } from './state.js';
import { $, esc, toast, modal, closeModal, busy, natural, safeName, deliver, loadScript, stamp, uid } from './util.js';

let X = {};
export function init(ctx) { X = ctx; }
const fm = () => S.fm || { assets: [], docs: [] };
const coKey = s => String(s || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/\b(limited|ltd|nz|new zealand|the)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
const clean = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/[^\n\x20-\x7e\xa0-\xff]/g, '');

/* ---------------- the form wording (NZS 3916:2013 Schedule 13, as issued with the contract) */
const SCH13 = [
  ['h', 'BACKGROUND'],
  ['n', 'A', "The Principal has entered into a contract (the 'Contract') with the Contractor for carrying out the Contract Works. The Warranted Works are part of the Contract Works."],
  ['n', 'B', 'The Contractor has agreed to arrange for the provision of a warranty in respect of the Warranted Works for the Warranty Period on the terms set out in this warranty.'],
  ['n', 'C', 'The Warrantor has agreed to provide a warranty in respect of the Warranted Works for the Warranty Period on the terms set out in this warranty.'],
  ['h', 'IT IS HEREBY AGREED'],
  ['n', '1', 'The Warrantor warrants to the Principal that the Warranted Works are as required in the Contract. If not otherwise specified the works shall be in accordance with good trade practice.'],
  ['n', '2', "This warranty shall be in addition to and shall not derogate from any manufacturer's warranty or any warranty implied by law or the Defects Notification Period in the Contract, attaching to any part of the Warranted Works."],
  ['n', '3', "Warrantor's obligations", true],
  ['n', '3.1', 'The Warrantor agrees that, if within the Warranty Period the Warrantor is advised by the Principal in writing of any defect in the Warranted Works for which the Warrantor is liable under the terms of this warranty, the Warrantor will promptly take steps to remedy the defect.'],
  ['n', '3.2', 'Any remedial work which the Warrantor is liable to undertake under this warranty shall be carried out:'],
  ['s', '(a)', 'To the standard required by the Contract;'], ['s', '(b)', 'In a prompt and timely manner;'], ['s', '(c)', 'Without unnecessary inconvenience to any occupants;'], ['s', '(d)', "At the Warrantor's Cost; and"], ['s', '(e)', 'Subject to reasonable access being provided to the Warrantor for the purpose of carrying out the remedial work.'],
  ['n', '3.3', 'Where the Cost of replacement of work and/or Materials is out of all proportion to the consequences of the defect, or where the defect may not be reasonably capable of rectification without substantial expense which is out of all proportion to the Cost of the Warranted Works:'],
  ['s', '(a)', "If the defect is reasonably able to be rectified by repair rather than by replacement, the Warrantor's obligation under this warranty shall be only to repair or otherwise make good the defect;"],
  ['s', '(b)', 'The Warrantor may propose reasonable monetary compensation in lieu of remedying the defect; or'], ['s', '(c)', 'The Warrantor may propose a combination of both repair and compensation.'],
  ['n', '3.4', "The Principal shall consider the Warrantor's reasonable proposals and the parties shall endeavour in good faith to reach agreement. Where agreement cannot be reached, the dispute shall be resolved in accordance with clause 7."],
  ['n', '4', 'Failure by Warrantor to perform remedial work', true],
  ['n', '4.1', 'If the Warrantor fails to promptly, adequately and satisfactorily carry out the remedial work or to propose acceptable repair or compensation, the Principal may then arrange for the remedial work to be carried out by others.'],
  ['n', '4.2', 'The Principal shall first give the Warrantor 10 Working Days notice, or such other reasonable time as agreed by the Principal, to carry out and complete the remedial work. If the Warrantor does not do so within that time, the Principal may then advise the Warrantor in writing that the work will be carried out by other Persons.'],
  ['n', '4.3', 'In such an event, the Warrantor is not released from its obligations under this warranty, which continue in full force and effect, except for the defect remedied by the Principal or by another Person contracted by the Principal.'],
  ['n', '4.4', 'The reasonable Cost of remedial work carried out by such other Persons including all reasonable Costs of the Principal shall be paid to the Principal by the Warrantor on demand.'],
  ['n', '5', 'Exclusions', true],
  ['p', 'The Principal agrees that the Warrantor is not liable for any defect or damage caused by:'],
  ['s', '(a)', 'Wilful act or negligence of the Principal or any Person other than the Warrantor;'], ['s', '(b)', 'Fire, explosion, earthquake, war, subsidence, slips, faulty materials, or workmanship other than caused by the defect in the Warranted Works;'],
  ['s', '(c)', 'Any force of nature which the Warrantor could not have reasonably foreseen;'], ['s', '(d)', 'Any neglect or unnecessary delay by the Principal in giving notice to the Warrantor of a defect in the Warranted Works becoming apparent;'],
  ['s', '(e)', 'Design faults, errors, or discrepancies, unless the Warrantor undertook the design of the part of the Warranted Works that is the subject of the defect;'],
  ['s', '(f)', 'Use of the Warranted Works by the Principal or any other Person in any manner or for any purpose not being the intended manner of use or purpose of the Warranted Works;'],
  ['s', '(g)', "Failure by the Principal or other Person to maintain the Warranted Works in accordance with good practice and any manufacturer's stated or recommended instructions or requirements; or"], ['s', '(h)', 'Fair wear and tear.'],
  ['n', '6', 'Assignment', true], ['p', 'The Principal may assign the benefit of this warranty to any Person.'],
  ['n', '7', 'Disputes', true],
  ['p', "Any dispute between the Principal and the Warrantor arising out of this warranty is to be referred to arbitration before a sole arbitrator. If, within 15 Working Days of notice of dispute, the Principal and the Warrantor cannot agree on a single arbitrator, either party may request the President of the Arbitrators' and Mediators' Institute of New Zealand to appoint an arbitrator."],
];
const EXEC_NOTE = 'NOTE - The warranty shall be executed by the Warrantor and the Principal in the manner required for execution of a deed. Any of these parties which are a company shall execute the warranty by having it signed, under the name of the company, by two or more directors. If there is only one director, it is sufficient if the Warranty is signed under the name of the company by that director, but the signature shall be witnessed by another person. The witness shall not only sign but shall also add his or her occupation and address. Alternatively, companies may execute under power of attorney.';

/* ---------------- who a deed goes to: the directory, plus installers named in the register */
const listOf = c => { const adr = S.project.address || S.project.name || '', els = [...new Set(c.assets.map(a => a.element + (a.location && !/^(all|whole|site|various)/i.test(a.location) ? ' (' + a.location + ')' : '')).filter(Boolean))];
  return `${(c.saved && c.saved.trade) || 'Works'} to ${adr}${els.length ? ': ' + els.join('; ') : ''}.`; };
export function warrantors() {
  const dir = (S.project.directory || []), out = new Map();
  const add = (name, o) => { const k = coKey(name); if (!k) return; const c = out.get(k) || { key: k, company: name, legal: '', email: '', name: '', address: '', nzbn: '', assets: [], saved: null }; Object.assign(c, o || {}); out.set(k, c); return c; };
  dir.filter(c => (c.role || 'Subcontractor') !== 'Consultant').forEach(c => add(c.company, { saved: c, company: c.company, legal: c.legal || '', email: c.email || '', name: c.name || '', address: c.address || '', nzbn: c.nzbn || '' }));
  const generic = /^(\[|confirm|tbc|various|supplier|carpentry|roofing|flooring|concrete|insulation|electrical|mechanical|plumbing|services|fire contractor|metalwork|precast|groundworks|joiner|glazing|fencing|bricklayer|plasterer|facade|window)/i;
  fm().assets.forEach(a => { if (a.status === 'Not applicable') return; String(a.installer || '').split(/\s*[\/;]\s*|\s+and\s+/).map(x => x.replace(/\(.*?\)/g, '').trim()).filter(x => x.length > 2 && !generic.test(x)).forEach(n => { const c = out.get(coKey(n)) || [...out.values()].find(c => coKey(c.company).split(' ')[0] === coKey(n).split(' ')[0]) || add(n); if (!c.assets.includes(a)) c.assets.push(a); }); });
  // the legal name read from a deed already received, where we have one
  fm().docs.filter(d => d.sub && d.sub.check && d.sub.check.warrantor).forEach(d => { const w = d.sub.check.warrantor, c = [...out.values()].find(c => coKey(w).split(' ')[0] === c.key.split(' ')[0]); if (c && !c.legal) c.legalSeen = w; if (c) { const k = d.sub.check; if (k.works && !c.seenWorks) c.seenWorks = String(k.works); if (k.period && !c.seenPeriod) c.seenPeriod = String(k.period); if (!c.seenDoc) c.seenDoc = d.title || ''; } });
  (S.project.directory || []).forEach(sv => { const c = out.get(coKey(sv.company)); if (c && (sv.assetIds || []).length) c.assets = [...new Set([...c.assets, ...sv.assetIds.map(id => fm().assets.find(a => a.id === id)).filter(Boolean)])]; });
  return [...out.values()].sort((a, b) => natural(a.company, b.company));
}
const yrs = t => { const m = String(t || '').match(/(\d+)\s*(?:yr|year)/i) || String(t || '').match(/^\s*(\d+)\s*$/); return m ? m[1] : ''; };
const periodOf = A => { const L = [...new Set(A.map(a => a.instWarranty).filter(x => /\d+\s*(yr|year|month)/i.test(x || '')))]; return L.length === 1 ? L[0].replace(/\s*\(.*$/, '') : ''; };

/* ---------------- the PDF */
export async function buildDeed(c) {
  if (!window.PDFLib) await loadScript('lib/pdf-lib.min.js');
  const P = window.PDFLib, p = S.project, doc = await P.PDFDocument.create(), form = doc.getForm();
  const f = await doc.embedFont(P.StandardFonts.Helvetica), fb = await doc.embedFont(P.StandardFonts.HelveticaBold), fi = await doc.embedFont(P.StandardFonts.HelveticaOblique);
  const W = 595.28, H = 841.89, M = 56, INK = P.rgb(0.1, 0.12, 0.15), GREY = P.rgb(0.42, 0.46, 0.5), AMB = P.rgb(0.86, 0.55, 0.05), NAVY = P.rgb(0.004, 0.11, 0.21), LINE = P.rgb(0.6, 0.64, 0.68);
  const form13 = clean(p.deedForm || 'NZS 3916:2013 Schedule 13'), std = /3910/.test(form13) ? 'NZS 3910:2013 Conditions of contract for building and civil engineering construction' : 'NZS 3916:2013 Conditions of contract for building and civil engineering - Design and construct';
  const wrap = (t, font, size, maxw) => { const out = []; clean(t).split('\n').forEach(par => { let line = ''; par.split(/\s+/).forEach(w => { const tr = line ? line + ' ' + w : w; if (font.widthOfTextAtSize(tr, size) <= maxw) line = tr; else { if (line) out.push(line); line = w; } }); out.push(line); }); return out; };
  let pg, y, pn = 0; const pages = [];
  const newPage = () => { pg = doc.addPage([W, H]); pages.push(pg); y = H - 60; };
  const text = (t, x, size = 9.5, font = f, color = INK) => pg.drawText(clean(t), { x, y, size, font, color });
  const para = (t, x, size = 9.5, font = f, maxw = W - M - x, gap = 3) => { wrap(t, font, size, maxw).forEach(l => { if (y < 70) newPage(); pg.drawText(l, { x, y, size, font, color: INK }); y -= size + 3.2; }); y -= gap; };
  let nf = 0; const field = (name, value, x, w, h = 16, opts = {}) => { const tf = form.createTextField(`${name}.${++nf}`); if (opts.multi) tf.enableMultiline(); tf.setText(clean(value || '')); tf.addToPage(pg, { x, y: y - h + 12, width: w, height: h, font: opts.bold ? fb : f, borderColor: opts.todo ? AMB : LINE, borderWidth: opts.todo ? 1.2 : 0.6, backgroundColor: opts.todo ? P.rgb(1, 0.97, 0.88) : P.rgb(0.97, 0.98, 0.99) }); tf.setFontSize(opts.size || 9.5); return tf; };
  const tag = (n, x) => { pg.drawCircle({ x, y: y + 4, size: 7, color: AMB }); const s = String(n); pg.drawText(s, { x: x - fb.widthOfTextAtSize(s, 8) / 2, y: y + 1.2, size: 8, font: fb, color: P.rgb(1, 1, 1) }); };
  const legal = c.legal || c.company, works = c.works || '', period = c.period || '', contractor = clean(p.contractor || ''), principal = clean(p.client || '');

  // ---- cover: what to do
  newPage(); pg.drawRectangle({ x: 0, y: H - 92, width: W, height: 92, color: NAVY });
  pg.drawText(clean(`${form13}: warranty for signing`), { x: M, y: H - 46, size: 16, font: fb, color: P.rgb(1, 1, 1) });
  pg.drawText(clean(`${p.name || ''}${p.address ? ', ' + p.address : ''}`), { x: M, y: H - 68, size: 10, font: f, color: P.rgb(1, 1, 1) });
  y = H - 130; text('For: ' + legal, M, 13, fb); y -= 20;
  para(`This warranty has been filled in for you from the contract and the project records. It is a fillable PDF: the details can be corrected in the boxes if anything is wrong. Please complete the numbered amber boxes, sign, and return the signed PDF to ${contractor || 'the Contractor'}${c.returnTo ? ' (' + c.returnTo + ')' : ''}.`, M, 10.5); y -= 6;
  text('What you need to do', M, 12, fb, NAVY); y -= 20;
  const steps = [['Check the details', `Check your company's full registered name, the Warranted Works and the Warranty Period on page 2. Correct them in the boxes if they are wrong, and tell ${contractor || 'the Contractor'} what you changed.`],
    ['Date the deed', 'Enter the date it is signed in the box at the top of page 2.'],
    ['Sign as a deed', 'Two directors sign for your company, or one director signs and a witness signs and adds their occupation and address. Write each name in the box beside the signature.'],
    ['Leave the Contractor and Principal blocks', `${contractor || 'The Contractor'} signs the Contractor block. ${principal || 'The Principal'} signs last. Do not sign or write in those blocks.`],
    ['Return it', 'Scan or save the signed pages as one PDF and return it. If your warranty depends on maintenance, attach your maintenance requirements.']];
  steps.forEach(([h, t], i) => { if (y < 120) newPage(); tag(i + 1, M + 7); text(h, M + 22, 10.5, fb); y -= 15; para(t, M + 22, 10); y -= 4; });
  y -= 6; pg.drawRectangle({ x: M, y: y - 40, width: W - 2 * M, height: 50, color: P.rgb(0.95, 0.97, 0.99), borderColor: LINE, borderWidth: 0.6 });
  y -= 2; text('Common reasons a warranty is sent back', M + 10, 9.5, fb); y -= 13;
  para(`The Contractor named as anything other than "${contractor}" (for example with "North" added); one director signing with no witness; a signature in the Principal's block; the date left blank.`, M + 10, 9, f, W - 2 * M - 20);

  // ---- the deed
  newPage(); text(std, M, 9.5, f, GREY); y -= 22; text('Schedule 13 - Form of Contractor (or Subcontractor) warranty', M, 15, fb); y -= 14;
  pg.drawRectangle({ x: M, y, width: W - 2 * M, height: 0.8, color: INK }); y -= 30;
  const row = (label, sub, value, right, opts = {}) => { text(label, M, 10, fb); if (sub) { y -= 11; text(sub, M, 9); y += 11; } field(opts.name || label.toLowerCase(), value, M + 112, W - 2 * M - 112 - 70, 17, opts); y -= 2; text(right, W - M - 62, 8, fi, GREY); y -= 26; };
  tag(2, M + 104); row('THIS AGREEMENT', 'is made on', '', '(insert date)', { name: 'date', todo: true });
  row('BETWEEN', '', principal, "('the Principal')", { bold: true, name: 'principal' });
  row('AND', '', contractor, "('the Contractor')", { bold: true, name: 'contractor' });
  tag(1, M + 104); row('AND', '', legal, "('the Warrantor')", { bold: true, name: 'warrantor' });
  y -= 6; text('DEFINITIONS', M, 10.5, fb); y -= 22;
  const wl = wrap(works, f, 9, W - 2 * M - 112 - 6).length, wh = Math.max(40, wl * 11 + 10); text("'Warranted Works'", M, 9.5); field('works', works, M + 112, W - 2 * M - 112, wh, { multi: true, size: 9 }); y -= wh + 10;
  text("'Warranty Period'", M, 9.5); field('period', period, M + 112, 110, 17, { todo: !period }); text('years from the date of Practical Completion', M + 230, 9, fi); y -= 12; text('of the Contract Works', M + 230, 9, fi); y -= 32;
  for (const r of SCH13) { if (y < 90) newPage();
    if (r[0] === 'h') { y -= 6; text(r[1], M, 10.5, fb); y -= 16; }
    else if (r[0] === 'p') para(r[1], M, 9.5);
    else if (r[0] === 's') { text(r[1], M + 4, 9.5); para(r[2], M + 30, 9.5, f, W - M - (M + 30), 1); }
    else if (r[3]) { y -= 2; text(r[1], M, 10, fb); text(r[2], M + 30, 10, fb); y -= 15; }
    else if (/^\d\.\d$/.test(r[1])) { text(r[1], M, 9.5, fb); y -= 13; para(r[2], M, 9.5); }
    else { text(r[1], M, 9.5, fb); para(r[2], M + 30, 9.5, f, W - M - (M + 30)); } }
  // ---- execution
  if (y < 380) newPage(); y -= 8; text('In witness of which this deed has been executed.', M, 9.5); y -= 24;
  const sig = (who, rows, opts = {}) => { if (y < 150) newPage(); text(who, M, 10, fb); if (opts.note) { text(opts.note, M + fb.widthOfTextAtSize(clean(who), 10) + 8, 8.5, fi, opts.todo ? AMB : GREY); } y -= 20;
    rows.forEach(([lbl, val, todo]) => { if (y < 70) newPage(); if (todo && opts.num) tag(opts.num, M - 8); pg.drawLine({ start: { x: M, y: y - 4 }, end: { x: M + 210, y: y - 4 }, thickness: 0.6, color: todo ? AMB : LINE }); text('Signature', M, 7.5, f, GREY); field(`${opts.key}.name`, val, M + 228, W - 2 * M - 228, 16, { todo }); y -= 12; text(lbl, M + 228, 7.5, f, GREY); y -= 18; }); y -= 10; };
  sig('SIGNED on behalf of the Contractor by:', [['Director (name)', '', false]], { key: 'contractor', note: `(${contractor || 'Contractor'} signs this block)` });
  sig('SIGNED on behalf of the Warrantor by:', [['Director (name)', c.director1 || '', true], ['Director (name), or Witness (name, occupation and address)', '', true]], { key: 'warrantor', num: 3, todo: true, note: '(you sign here: two directors, or one director and a witness)' });
  sig('SIGNED on behalf of the Principal by:', [['Director (name)', '', false], ['Director (name)', '', false]], { key: 'principal', note: `(leave blank: ${principal || 'the Principal'} signs last)` });
  para(EXEC_NOTE, M, 8, f);
  // page numbers and footer
  pages.forEach((q, i) => { const t = clean(`${p.name || ''} | ${legal} | page ${i + 1} of ${pages.length}`); q.drawText(t, { x: M, y: 28, size: 7.5, font: f, color: GREY }); });
  form.updateFieldAppearances(f);
  return new Blob([await doc.save()], { type: 'application/pdf' });
}

/* ---------------- choose who to send to, check the details, build */
export function prepareDialog(preset) {
  if (!can.edit()) return toast('Only admins and editors can prepare deeds');
  const p = S.project; if (!p.contractor || !p.client) return toast('Set the Client and Contractor in Project settings first: they are written into every deed.', 7000);
  const L = warrantors(), ret = (p.directory || []).find(c => /miles|contractor/i.test((c.role || '') + ' ' + c.company) && c.email);
  modal(`<h2>📝 Prepare warranties for signing</h2><p class="note">Tick who each one goes to. Each gets a fillable PDF of the ${esc(p.deedForm || 'NZS 3916:2013 Schedule 13')} already filled in from Project settings (Principal ${esc(p.client)}, Contractor ${esc(p.contractor)}), the company's details and the elements it covers. They only check, date and sign. Details you correct here are saved to Contacts.</p>
  <input type="search" id="pdQ" placeholder="Find a company…" style="width:100%;margin-bottom:6px">
  <div class="pdl">${L.map((c, i) => { const sv = c.saved || {}, list = listOf(c), per = sv.deedPeriod || yrs(periodOf(c.assets)) || yrs(c.seenPeriod), w = sv.deedWorks || list, req = [...new Set(c.assets.map(a => a.instWarranty).filter(Boolean))].join('; ');
    return `<div class="pdr" data-s="${esc((c.company + ' ' + c.legal + ' ' + w).toLowerCase())}"><label class="pdt"><input type="checkbox" data-pi="${i}" ${preset && preset.includes(c.key) ? 'checked' : ''}><b>${esc(c.company)}</b> <span class="muted small">${esc(c.assets.map(a => a.ref).join(', '))}</span>${c.legal ? '' : c.legalSeen ? ` <span class="st st-info">name read from their deed</span>` : ` <span class="st st-warn">full name to confirm</span>`}</label>
      <div class="pdf" hidden><label class="f">Full registered name<input data-pl="${i}" value="${esc(c.legal || c.legalSeen || c.company)}"></label><label class="f">Email<input data-pe="${i}" value="${esc(c.email)}" placeholder="for your records"></label>
      <label class="f full">Warranted Works <span class="muted small">(trade, where, and what it includes: this is what the warranty covers)</span><textarea data-pw="${i}" rows="4">${esc(w)}</textarea></label>
      <div class="full small" style="margin:-4px 0 6px">${c.seenWorks ? `<button type="button" class="mini" data-pu="${i}" title="${esc(c.seenDoc)}">⤓ Use their draft wording</button> ` : ''}<button type="button" class="mini" data-pr="${i}">↺ List from the register</button>${c.seenWorks ? ` <span class="muted">Their draft says: ${esc(c.seenWorks)}</span>` : ''}</div>
      <label class="f full">Excludes <span class="muted small">(optional, added at the end, e.g. reinforcing, propping and scaffolding)</span><input data-px="${i}" value="${esc(sv.deedExcl || '')}" placeholder="leave blank if nothing is excluded"></label>
      <label class="f">Warranty Period (years)<input data-pp="${i}" value="${esc(per)}" inputmode="numeric" placeholder="blank: they fill it in"></label><div class="small muted" style="align-self:end;padding-bottom:8px">${req ? 'Register requires: ' + esc(req) : 'No period set in the register'}${c.seenPeriod ? ' · their draft: ' + esc(c.seenPeriod) : ''}</div></div></div>`; }).join('') || '<p class="muted">No companies yet. Add them under Contacts, or name the installer on each element in the register.</p>'}</div>
  <div class="act"><button id="pdX">Cancel</button><button class="go" id="pdGo">Build PDFs</button></div>`, true);
  const sync = () => document.querySelectorAll('[data-pi]').forEach(cb => cb.closest('.pdr').querySelector('.pdf').hidden = !cb.checked);
  document.querySelectorAll('[data-pi]').forEach(cb => cb.onchange = sync); sync();
  $('pdQ').oninput = e => { const q = e.target.value.toLowerCase().trim(); document.querySelectorAll('.pdr').forEach(r => r.style.display = !q || q.split(' ').every(w => r.dataset.s.includes(w)) ? '' : 'none'); };
  document.querySelectorAll('[data-pu]').forEach(b => b.onclick = () => { const i = +b.dataset.pu; document.querySelector(`[data-pw="${i}"]`).value = L[i].seenWorks; });
  document.querySelectorAll('[data-pr]').forEach(b => b.onclick = () => { const i = +b.dataset.pr; document.querySelector(`[data-pw="${i}"]`).value = listOf(L[i]); });
  $('pdX').onclick = closeModal;
  $('pdGo').onclick = async () => {
    const pick = [...document.querySelectorAll('[data-pi]:checked')].map(cb => { const i = +cb.dataset.pi, v = k => document.querySelector(`[data-p${k}="${i}"]`).value.trim(); const wk = v('w'), ex = v('x').replace(/^excludes?\s*:?\s*/i, '').replace(/\.$/, ''); return { ...L[i], legal: v('l'), email: v('e'), worksOnly: wk, excl: ex, works: wk.replace(/\s*$/, '') + (ex ? (/[.;:]$/.test(wk) ? ' ' : '. ') + 'Excludes ' + ex + '.' : ''), period: yrs(v('p')) || v('p') }; });
    if (!pick.length) return toast('Tick at least one company');
    const miss = pick.filter(c => !c.works); if (miss.length) return toast(`Describe the Warranted Works for ${miss.map(c => c.company).join(', ')}`, 6000);
    closeModal(); const b = busy('Building the deeds…');
    try {
      const files = []; for (const [i, c] of pick.entries()) { b.set(`Building ${i + 1} of ${pick.length}: ${c.company}`); files.push({ name: `${safeName(c.legal)} - Schedule 13 Deed - for signing.pdf`, blob: await buildDeed({ ...c, returnTo: ret ? ret.email : '' }) }); }
      // keep what was confirmed, so next time it is already filled in
      const dir = (p.directory || []).slice(); pick.forEach(c => { const i = dir.findIndex(x => coKey(x.company) === c.key); const o = { ...(i > -1 ? dir[i] : { id: uid(), company: c.company, role: 'Subcontractor', audience: 'FM' }), legal: c.legal, email: c.email || (i > -1 ? dir[i].email : ''), assetIds: c.assets.map(a => a.id), deedWorks: c.worksOnly, deedExcl: c.excl, deedPeriod: c.period, updated: new Date().toISOString() }; if (i > -1) dir[i] = o; else dir.push(o); });
      try { await S.store.updateProject(p.id, { directory: dir }); S.project.directory = dir; } catch (e) { console.warn('directory', e); }
      if (files.length === 1) { b.done(); return deliver(files[0].blob, files[0].name, 'Deed for signing'); }
      if (!window.JSZip) await loadScript('lib/jszip.min.js'); const z = new window.JSZip(); files.forEach(x => z.file(x.name, x.blob));
      const blob = await z.generateAsync({ type: 'blob' }); b.done(); deliver(blob, `${safeName(p.name)} - Schedule 13 deeds for signing - ${stamp()}.zip`, 'Deeds for signing');
    } catch (e) { console.error(e); b.done(); toast('Could not build the deeds: ' + e.message, 8000); }
  };
}
