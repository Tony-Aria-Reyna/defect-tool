// Handover pack generator: FM Manual (property team), Home User Guide (residents), and a zip with every document linked.
import { S } from './state.js';
import { APP } from './config.js';
import { $, esc, toast, modal, closeModal, busy, todayISO, nzDate, stamp, natural, safeName, deliver, loadScript, confirmBox } from './util.js';
import { can } from './state.js';
import { buildPdf, buildXlsx } from './exports.js';

let X = {};
export function init(ctx) { X = ctx; }   // ctx: { fm(), getBytes(url), addFreq, warrantyExpiry, freqText, SYSTEMS }

/* ------------------------------------------------------------ text helpers */
function clean(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/—/g, ', ').replace(/→/g, '->').replace(/[^\n\x20-\x7e\xa0-\xff€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–˜™š›œžŸ]/g, ''); }
const hexc = h => { const n = parseInt(h.slice(1), 16); return PDFLib.rgb((n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255); };
async function embedAny(doc, bytes) { const b = new Uint8Array(bytes); return (b[0] === 0x89 && b[1] === 0x50) ? doc.embedPng(b) : doc.embedJpg(b); }

/* ------------------------------------------------------------ a small flowing-layout engine on top of pdf-lib */
async function Writer(o) {
  const P = PDFLib, doc = await P.PDFDocument.create();
  const f = await doc.embedFont(P.StandardFonts.Helvetica), fb = await doc.embedFont(P.StandardFonts.HelveticaBold);
  const W = 595.28, H = 841.89, M = 50, NAVY = hexc('#011C35'), TEAL = hexc('#3bafbe'), GREY = hexc('#6a7886'), LINE = hexc('#dde3e9'), TXT = hexc('#18232f');
  const base = o.base || 10; // body font size (Home User Guide uses a larger size)
  let res = null, cli = null;
  try { res = await embedAny(doc, await X.getBytes('img/resero-navy.png')); } catch (e) {}
  try { if (S.project.clientLogo) cli = await embedAny(doc, await X.getBytes(S.project.clientLogo)); } catch (e) {}
  const w = { doc, P, f, fb, W, H, M, NAVY, TEAL, GREY, LINE, TXT, base, pages: [], links: [], anchors: {}, pg: null, y: 0, section: '' };
  w.text = (t, x, y, size, font, color) => w.pg.drawText(clean(t), { x, y, size, font: font || f, color: color || TXT });
  w.wrap = (t, font, size, maxw) => { const out = []; clean(t).split('\n').forEach(par => { let line = ''; par.split(/\s+/).forEach(word => { const tr = line ? line + ' ' + word : word; if (font.widthOfTextAtSize(tr, size) <= maxw) line = tr; else { if (line) out.push(line); while (font.widthOfTextAtSize(word, size) > maxw && word.length > 1) { let k = word.length; while (k > 1 && font.widthOfTextAtSize(word.slice(0, k), size) > maxw) k--; out.push(word.slice(0, k)); word = word.slice(k); } line = word; } }); out.push(line); }); return out; };
  w.newPage = () => {
    const pg = doc.addPage([W, H]); w.pages.push(pg); w.pg = pg;
    if (cli) { const h = 30, ww = Math.min(140, h * cli.width / cli.height), hh = ww * cli.height / cli.width; pg.drawImage(cli, { x: M, y: H - 36 - hh, width: ww, height: hh }); }
    w.text(o.title, W - M - fb.widthOfTextAtSize(clean(o.title), 9), H - 44, 9, fb, NAVY);
    if (w.section) w.text(w.section, W - M - f.widthOfTextAtSize(clean(w.section), 8), H - 56, 8, f, GREY);
    pg.drawRectangle({ x: M, y: H - 72, width: W - 2 * M, height: 1.2, color: TEAL });
    w.y = H - 96; return pg;
  };
  w.need = h => { if (w.y - h < M + 30) w.newPage(); };
  w.h1 = (t, anchor, flow) => { w.section = t; if (flow && w.pg && w.y > H * 0.4 && w.pages.length > 2) { w.y -= 30; w.pg.drawRectangle({ x: M, y: w.y + 30, width: 60, height: 2, color: TEAL }); } else w.newPage(); if (anchor) w.anchors[anchor] = { pg: w.pg, y: w.y + 20 }; w.text(t, M, w.y, 20, fb, NAVY); w.y -= 30; };
  w.h2 = t => { w.need(40); w.y -= 6; w.text(t, M, w.y, base + 3, fb, NAVY); w.y -= base + 10; };
  w.para = (t, opt = {}) => { const size = opt.size || base, font = opt.bold ? fb : f, lh = size * 1.38; const lines = w.wrap(t, font, size, W - 2 * M - (opt.indent || 0)); lines.forEach(l => { w.need(lh); w.text(l, M + (opt.indent || 0), w.y, size, font, opt.color); w.y -= lh; }); w.y -= opt.after ?? size * 0.6; };
  w.bullets = (items, opt = {}) => items.forEach(t => { const size = opt.size || base, lh = size * 1.38, lines = w.wrap(t, f, size, W - 2 * M - 16); lines.forEach((l, i) => { w.need(lh); if (!i) w.pg.drawCircle({ x: M + 5, y: w.y + size * 0.32, size: size * 0.16, color: TEAL }); w.text(l, M + 16, w.y, size, f); w.y -= lh; }); w.y -= size * 0.3; });
  // table: cols [{label, w (fraction), key or fn, link: row => target}]
  w.table = (cols, rows, opt = {}) => {
    const size = opt.size || Math.min(base, 8.5), lh = size * 1.3, tw = W - 2 * M; const cw = cols.map(c => c.w * tw);
    const head = () => { w.need(lh + 10); let x = M; w.pg.drawRectangle({ x: M, y: w.y - 4, width: tw, height: lh + 5, color: NAVY }); cols.forEach((c, i) => { w.text(c.label, x + 3, w.y, size, fb, P.rgb(1, 1, 1)); x += cw[i]; }); w.y -= lh + 6; };
    head();
    rows.forEach((r, ri) => {
      const cells = cols.map((c, i) => w.wrap(typeof c.key === 'function' ? c.key(r) : (r[c.key] ?? ''), c.bold ? fb : f, size, cw[i] - 6));
      const n = Math.max(1, ...cells.map(c => c.length)), rh = n * lh + 4;
      if (w.y - rh < M + 30) { w.newPage(); head(); }
      if (ri % 2) w.pg.drawRectangle({ x: M, y: w.y - rh + lh - 1, width: tw, height: rh, color: hexc('#f6f8fa') });
      let x = M;
      cols.forEach((c, i) => { const tgt = c.link && c.link(r); cells[i].forEach((l, li) => w.text(l, x + 3, w.y - li * lh, size, c.bold ? fb : f, tgt ? hexc('#1f6fb5') : undefined)); if (tgt && cells[i][0]) w.links.push({ pg: w.pg, r: [x, w.y - (cells[i].length - 1) * lh - 3, x + cw[i], w.y + lh - 2], target: tgt }); x += cw[i]; });
      w.y -= rh;
    });
    w.y -= 8;
  };
  w.cover = (big, sub, lines) => {
    const pg = doc.addPage([W, H]); w.pages.push(pg); w.pg = pg;
    pg.drawRectangle({ x: 0, y: H - 300, width: W, height: 300, color: NAVY });
    if (cli) { const ww = 200, hh = ww * cli.height / cli.width; pg.drawRectangle({ x: M - 10, y: H - 70 - hh - 10, width: ww + 20, height: hh + 20, color: P.rgb(1, 1, 1) }); pg.drawImage(cli, { x: M, y: H - 70 - hh, width: ww, height: hh }); }
    w.text(big, M, H - 220, 30, fb, P.rgb(1, 1, 1)); w.text(sub, M, H - 250, 14, f, hexc('#bfe6eb'));
    let y = H - 350; lines.filter(l => l[1]).forEach(([k, v]) => { w.text(k, M, y, 11, fb, GREY); w.wrap(v, f, 11, W - 2 * M - 170).forEach((l, i) => w.text(l, M + 170, y - i * 15, 11, f)); y -= 15 * Math.max(1, w.wrap(v, f, 11, W - 2 * M - 170).length) + 6; });
    if (res) { const h = 22, ww = h * res.width / res.height; pg.drawImage(res, { x: M, y: M + 10, width: ww, height: h }); }
    w.text('Prepared by ' + APP.company + (S.project.client ? ' for ' + S.project.client : '') + '  |  ' + nzDate(todayISO()), M, M - 6, 9, f, GREY);
  };
  w.contents = entries => { // entries [{t, anchor}]
    w.section = ''; w.newPage(); w.text('Contents', M, w.y, 20, fb, NAVY); w.y -= 34; const pgc = w.pg;
    entries.forEach((e, i) => { w.text(`${i + 1}.  ${e.t}`, M, w.y, base + 2, f, hexc('#1f6fb5')); w.links.push({ pg: pgc, r: [M, w.y - 4, W - M, w.y + base + 4], anchor: e.anchor }); w.y -= base * 2.2; });
  };
  w.finish = async () => {
    const n = w.pages.length, foot = `Prepared by ${APP.company}${S.project.client ? ' for ' + S.project.client : ''}`;
    w.pages.forEach((p, i) => { if (!i) return; p.drawRectangle({ x: M, y: M - 8, width: W - 2 * M, height: 0.5, color: LINE }); p.drawText(clean(foot), { x: M, y: M - 20, size: 7.5, font: f, color: GREY }); const t = `Page ${i + 1} of ${n}`; p.drawText(t, { x: W - M - f.widthOfTextAtSize(t, 7.5), y: M - 20, size: 7.5, font: f, color: GREY }); });
    const annot = (page, dict) => { const ref = doc.context.register(doc.context.obj(dict)); let an = page.node.lookup(P.PDFName.of('Annots')); if (!an) { an = doc.context.obj([]); page.node.set(P.PDFName.of('Annots'), an); } an.push(ref); };
    w.links.forEach(l => {
      let A;
      if (l.anchor) { const t = w.anchors[l.anchor]; if (!t) return; annot(l.pg, { Type: 'Annot', Subtype: 'Link', Rect: l.r, Border: [0, 0, 0], Dest: [t.pg.ref, P.PDFName.of('XYZ'), P.PDFNull, P.PDFNumber.of(t.y), P.PDFNull] }); return; }
      const tg = l.target;
      if (/^https?:/i.test(tg)) A = { Type: 'Action', S: 'URI', URI: P.PDFString.of(tg) };
      else if (/\.pdf$/i.test(tg)) A = { Type: 'Action', S: 'GoToR', F: P.PDFString.of(tg), D: [P.PDFNumber.of(0), P.PDFName.of('Fit')], NewWindow: true };
      else A = { Type: 'Action', S: 'Launch', F: P.PDFString.of(tg), NewWindow: true };
      annot(l.pg, { Type: 'Annot', Subtype: 'Link', Rect: l.r, Border: [0, 0, 0], A });
    });
    doc.setTitle(clean(o.title + ' - ' + S.project.name)); doc.setAuthor(APP.company); doc.setProducer(APP.name);
    return new Blob([await doc.save()], { type: 'application/pdf' });
  };
  return w;
}

/* ------------------------------------------------------------ document targets */
// In "zip" mode the manuals link to files inside the zip (relative paths); otherwise to the online copies.
export function docPath(d) { const ext = (/\.[a-z0-9]{2,5}$/i.exec(d.fileName || '') || [''])[0] || '.pdf'; return `${d.restricted ? 'Restricted' : 'Documents'}/${safeName(d.system || 'General').slice(0, 60)}/${safeName(d.type || 'Other').replace(/[()]/g, '').slice(0, 40)}/${safeName(d.title).slice(0, 110)}${ext}`; }
// restricted documents are never linked online: only the copy in the pack's Restricted folder
const target = (d, mode) => d.link ? d.link : mode === 'zip' ? (d.url ? docPath(d) : '') : (d.restricted ? '' : d.url || '');
const contacts = aud => (S.project.contacts || []).filter(c => !aud || !c.audience || c.audience === 'Both' || c.audience === aud);

/* ------------------------------------------------------------ FM Manual */
export async function buildFmManual(mode, st = () => {}) {
  if (!window.PDFLib) await loadScript('lib/pdf-lib.min.js');
  const p = S.project, { assets: A, tasks: T, systems: SY } = X.fm(), Dd = X.fm().docs.filter(d => !d.template && !d.superseded), { SYSTEMS, warrantyExpiry, freqText, addFreq } = X;
  const w = await Writer({ title: 'Facility Management Manual', base: 9.5 });
  const dnpEnd = p.pcDate ? addFreq(p.pcDate, +(p.dnpMonths || 12), 'months') : '';
  w.cover('Facility Management Manual', p.name, [['Property', [p.name, p.address].filter(Boolean).join(', ')], ['Owner', p.client], ['Main contractor', p.contractor], ['Practical completion', nzDate(p.pcDate)], ['Code Compliance Certificate', nzDate(p.cccDate)], ['Compliance schedule', p.csNumber], ['Building consent', p.consent]]);
  const secs = [['How to use this manual', 'use'], ['Key dates and contacts', 'dates'], ['Compliance schedule and building warrant of fitness', 'comp'], ['Maintenance schedule', 'maint'], ['Assets and warranties', 'assets'], ['Document index', 'docs'], ['Defects notification period', 'dnp']];
  w.contents(secs.map(([t, a]) => ({ t, anchor: a })));
  st('Writing the manual…');
  w.h1('How to use this manual', 'use');
  w.para(`This manual brings together what ${p.client || 'the owner'} needs to operate, maintain and keep ${p.name} compliant: key dates and contacts, the compliance schedule and building warrant of fitness (BWoF) obligations, the planned maintenance schedule, the asset and warranty register, and an index of the handover documents.`);
  w.para('Blue text is a link. In the contents it jumps to the section; in the tables it opens the document. ' + (mode === 'zip' ? 'Links open the files in the Documents folder supplied with this manual, so keep the folder and this file together.' : 'Links open the online copy in Resero Site, which needs internet access and a signed-in account for some files.'));
  w.para('Many warranties depend on the maintenance in this manual being carried out and recorded. Keep maintenance records (in Resero Site or with this manual) for the life of each warranty.', { bold: true });
  w.h1('Key dates and contacts', 'dates');
  w.table([{ label: 'Item', w: .55, key: 'a' }, { label: 'Date', w: .45, key: 'b' }], [['Practical completion', p.pcDate], ['Defects notification period ends', dnpEnd], ['Code Compliance Certificate issued', p.cccDate], ['Building warrant of fitness due', p.bwofDue], ['Weathertightness guarantee ends (10 years from PC)', p.pcDate ? addFreq(p.pcDate, 10, 'years') : '']].map(([a, b]) => ({ a, b: b ? nzDate(b) : 'To be confirmed' })), { size: 9.5 });
  const C = contacts('FM');
  if (C.length) { w.h2('Contacts'); w.table([{ label: 'Role', w: .26, key: 'role', bold: true }, { label: 'Company / name', w: .3, key: 'name' }, { label: 'Phone', w: .18, key: 'phone' }, { label: 'Email', w: .26, key: 'email' }], C, { size: 9 }); }
  else w.para('Contacts: add them in Resero Site (Dashboard > Contacts) and regenerate this manual.', { color: w.GREY });
  st('Compliance…');
  w.h1('Compliance schedule and building warrant of fitness', 'comp');
  w.para(`The building has a compliance schedule${p.csNumber ? ' (' + p.csNumber + ')' : ''} listing its specified systems. Under the Building Act 2004 the owner must have each system inspected and maintained as the schedule requires, obtain a Form 12A certificate from an Independent Qualified Person (IQP) for each system every year, then sign the building warrant of fitness, display it in a public place in the building, and give a copy to Auckland Council. ${p.bwofDue ? 'The next BWoF is due ' + nzDate(p.bwofDue) + '.' : ''}${p.iqp ? ' IQP: ' + p.iqp + '.' : ''}`);
  w.table([{ label: 'System', w: .1, key: 'ss', bold: true }, { label: 'Description and location', w: .3, key: r => r.name + (r.location ? '\n' + r.location : '') }, { label: 'Performance standard', w: .28, key: 'standard' }, { label: 'Inspection, maintenance and reporting', w: .32, key: 'inspections' }], SY.slice().sort((a, b) => natural(a.ss, b.ss)));
  st('Maintenance…');
  w.h1('Maintenance schedule', 'maint');
  w.para('Planned and compliance maintenance. Frequencies come from the compliance schedule, the performance standards and the manufacturers\' requirements; confirm them against the O&M manuals. Record each completed task, with any report, in Resero Site.');
  SYSTEMS.forEach(sys => { const rows = T.filter(t => t.system === sys).sort((a, b) => natural(a.ss || 'zz', b.ss || 'zz') || natural(a.title, b.title)); if (!rows.length) return; w.h2(sys); w.table([{ label: 'Task', w: .44, key: r => (r.ss ? r.ss + ' ' : '') + r.title }, { label: 'Frequency', w: .14, key: r => freqText(r) }, { label: 'Responsible', w: .2, key: 'responsible' }, { label: 'Standard / reference', w: .22, key: 'standard' }], rows); });
  st('Assets and warranties…');
  w.h1('Assets and warranties', 'assets');
  w.para(`Warranty periods run from practical completion${p.pcDate ? ' (' + nzDate(p.pcDate) + ')' : ''} unless stated. Make claims through ${p.client || 'the owner'}'s property team. Documents marked as outstanding had not been received at the date of this manual.`);
  SYSTEMS.forEach(sys => { const rows = A.filter(a => a.system === sys).sort((a, b) => natural(a.ref, b.ref)); if (!rows.length) return; w.h2(sys);
    w.table([{ label: 'Element', w: .24, key: r => r.element, bold: true }, { label: 'Product / installer', w: .24, key: r => [r.product, r.installer].filter(Boolean).join('\n') }, { label: 'Warranty', w: .26, key: r => (r.warranties || []).map(x => `${x.label || 'Warranty'}: ${x.months ? (x.months % 12 ? x.months + ' months' : x.months / 12 + ' years') : '?'}${warrantyExpiry(x) ? ', to ' + nzDate(warrantyExpiry(x)) : ''}`).join('\n') || '-' }, { label: 'Documents', w: .26, key: r => { const ds = Dd.filter(d => (d.assetIds || []).includes(r.id)); return ds.length ? ds.map(d => d.title).join('\n') : (r.status === 'Not applicable' ? '-' : 'Outstanding: ' + (r.status || '')); }, link: r => { const ds = Dd.filter(d => (d.assetIds || []).includes(r.id)); return ds.length === 1 ? target(ds[0], mode) : ''; } }], rows); });
  st('Document index…');
  w.h1('Document index', 'docs');
  w.para(`${Dd.length} documents. Click a title to open it.`);
  SYSTEMS.concat(['']).forEach(sys => { const rows = Dd.filter(d => (d.system || '') === sys).sort((a, b) => natural(a.type, b.type) || natural(a.title, b.title)); if (!rows.length) return; w.h2(sys || 'General'); w.table([{ label: 'Document', w: .58, key: 'title', link: d => target(d, mode) }, { label: 'Type', w: .24, key: 'type' }, { label: 'Expiry', w: .18, key: d => d.expiry ? nzDate(d.expiry) : '' }], rows, { size: 8 }); });
  w.h1('Defects notification period', 'dnp');
  const open = S.defects.filter(d => d.status !== 'Closed');
  w.para(`The defects notification period runs for ${p.dnpMonths || 12} months from practical completion${dnpEnd ? ', to ' + nzDate(dnpEnd) : ''}. Report any defect found in this period to the property team so it can be logged in Resero Site and passed to the contractor. ${open.length ? open.length + ' items were open at the date of this manual:' : 'There were no open items at the date of this manual.'}`);
  if (open.length) w.table([{ label: 'ID', w: .1, key: 'id', bold: true }, { label: 'Item', w: .45, key: r => r.title + (r.desc ? '\n' + r.desc : '') }, { label: 'Location', w: .25, key: r => [r.block && 'Block ' + r.block, r.level, r.unit && 'Unit ' + r.unit, r.room].filter(Boolean).join(', ') }, { label: 'Status', w: .2, key: 'status' }], open.sort((a, b) => natural(a.id, b.id)).slice(0, 400), { size: 8 });
  return w.finish();
}

/* ------------------------------------------------------------ Home User Guide (residents) */
const HOME_SECTIONS = p => [
  ['Welcome to your new home', [`Welcome to ${p.name}. This guide explains how to look after your home and what to do if something needs fixing. Please keep it somewhere handy.`, p.homeIntro || '']],
  ['If something needs fixing', [`Please report any repair or problem to ${p.client || 'your landlord'}. Do not contact the builders or trades yourself: we will arrange the right people, and some of the work is still covered by the builder's warranty.`, 'In an emergency (fire, a medical emergency, or danger to people) call 111 first.']],
  ['Fire safety', null, ['Your home has a smoke alarm and the building has fire sprinklers and a fire alarm. If the alarm sounds, leave the building by the nearest exit, close your door behind you, and follow the exit signs to the assembly point.', 'Do not use the lift during a fire alarm.', 'Never hang anything from, paint over, or knock the sprinkler heads on the ceiling. They can go off if damaged.', 'If your smoke alarm goes off while cooking, open a window and use the alarm\'s hush button. Do not remove it from the ceiling.', 'Keep corridors, stairs and exits clear at all times.']],
  ['Heating and fresh air', null, ['Your heat pump heats your living area. Use the remote to choose "Heat" and set a comfortable temperature, around 20 degrees.', 'Open a window for a few minutes each day to let fresh air in and moisture out.', 'Turn on the bathroom and kitchen fans when showering or cooking, and leave them on for a few minutes afterwards.', 'If you see condensation on windows in the morning, wipe it off with a cloth.']],
  ['Kitchen and bathroom', null, ['Wipe up spills on the floor straight away to avoid slips.', 'Clean benchtops with warm soapy water. Avoid abrasive cleaners, which can scratch.', 'Do not pour fat or oil down the sink; let it cool and put it in the rubbish.', 'Tell us about any drips, leaks, or gaps in the silicone around the shower or basin as soon as you notice them.']],
  ['Doors, windows and security', null, ['Keep your front door locked and do not let people you do not know into the building.', 'Keep window and door tracks free of dirt so they slide easily.', 'If a key, lock or door closer is not working properly, please let us know.']],
  ['Looking after your home', null, ['Please do not drill, nail or screw into walls, ceilings or floors without asking us first. There are pipes, wiring and fire protection inside.', 'Use felt pads under furniture legs to protect the floors.', 'Put rubbish and recycling in the bins provided and keep the bin areas tidy.']],
];
export async function buildHomeGuide(mode, st = () => {}) {
  if (!window.PDFLib) await loadScript('lib/pdf-lib.min.js');
  const p = S.project, { assets: A } = X.fm(), Dd = X.fm().docs.filter(d => !d.template && !d.superseded);
  const w = await Writer({ title: 'Home User Guide', base: 13 });
  w.cover('Home User Guide', p.name, [['Your home', [p.name, p.address].filter(Boolean).join(', ')], ['Landlord', p.client]]);
  const mine = A.filter(a => a.audience === 'Home user' || a.audience === 'Both');
  const secs = HOME_SECTIONS(p);
  w.contents([...secs.map((s, i) => ({ t: s[0], anchor: 'h' + i })), ...(mine.length ? [{ t: 'Things in your home', anchor: 'things' }] : []), { t: 'Who to contact', anchor: 'who' }]);
  st('Writing the guide…');
  secs.forEach(([t, paras, bullets], i) => { w.h1(t, 'h' + i, i > 0); (paras || []).filter(Boolean).forEach(x => w.para(x)); if (bullets) w.bullets(bullets); });
  if (mine.length) {
    w.h1('Things in your home', 'things');
    w.para('How to care for the main items in your home. If anything is not working, please let us know rather than trying to repair it yourself.');
    mine.sort((a, b) => natural(a.element, b.element)).forEach(a => { w.h2(a.element); if (a.product) w.para(a.product, { color: w.GREY, size: 11 }); w.para(a.careNote || 'Keep clean and report any damage or faults to us.'); const guides = Dd.filter(d => (d.assetIds || []).includes(a.id) && /care|o&m|manual/i.test(d.type) && d.audience !== 'FM'); guides.forEach(d => { w.need(20); w.text('More information: ' + d.title, w.M, w.y, 11, w.f, hexc('#1f6fb5')); const tg = target(d, mode); if (tg) w.links.push({ pg: w.pg, r: [w.M, w.y - 3, w.W - w.M, w.y + 12], target: tg }); w.y -= 22; }); });
  }
  w.h1('Who to contact', 'who');
  const C = contacts('Resident');
  if (C.length) C.forEach(c => { w.para(c.role, { bold: true, after: 2 }); w.para([c.name, c.phone, c.email].filter(Boolean).join('\n')); });
  else w.para(`${p.client || 'Your landlord'}: please see the contact details provided with your tenancy agreement.`);
  w.para('Emergencies: call 111.', { bold: true });
  return w.finish();
}

/* ------------------------------------------------------------ the offline front page: one HTML file that opens in any browser */
function indexHtml(mode, files) {
  const p = S.project, { assets: A, tasks: T } = X.fm(), D = (S.defects || []), Dd = X.fm().docs.filter(d => !d.template && !d.superseded);
  const link = d => d.link ? d.link : mode === 'zip' && d.url ? encodeURI(docPath(d)).replace(/#/g, '%23') : (d.restricted ? '' : d.url || '');
  const e = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const exp = a => (a.warranties || []).map(w => ({ w, d: X.warrantyExpiry(w) })).filter(x => x.d).sort((x, y) => x.d.localeCompare(y.d));
  const byAsset = id => Dd.filter(d => (d.assetIds || []).includes(id));
  const sec = (id, h, body) => `<section id="${id}"><h2>${h}</h2>${body}</section>`;
  const assets = A.slice().sort((a, b) => natural(a.system || '', b.system || '') || natural(a.ref || '', b.ref || ''));
  const rowsA = assets.map(a => { const ex = exp(a); return `<tr data-s="${e([a.ref, a.element, a.product, a.installer, a.system].join(' ').toLowerCase())}"><td>${e(a.ref)}</td><td><b>${e(a.element)}</b><br><small>${e([a.product, a.installer].filter(Boolean).join(' · '))}</small></td><td>${e((a.system || '').replace(/^\d\d /, ''))}</td><td>${ex.length ? ex.map(x => `${e(x.w.label || 'Warranty')}: ${e(nzDate(x.d))}`).join('<br>') : (a.warranties || []).length ? '<small>runs from practical completion</small>' : '-'}</td><td>${byAsset(a.id).map(d => `<a href="${e(link(d))}" target="_blank">${e(d.title)}</a>`).join('<br>') || '-'}</td></tr>`; }).join('');
  const tasks = T.slice().sort((a, b) => (a.nextDue || '9').localeCompare(b.nextDue || '9'));
  const rowsT = tasks.map(t => `<tr data-s="${e([t.title, t.system, t.responsible].join(' ').toLowerCase())}"><td><b>${e(t.title)}</b><br><small>${e(t.instructions || '').slice(0, 300)}</small></td><td>${e(X.freqText(t))}</td><td>${e(t.responsible || '')}</td><td>${e(t.nextDue ? nzDate(t.nextDue) : '')}</td></tr>`).join('');
  const docsS = Dd.slice().sort((a, b) => natural(a.system || 'zz', b.system || 'zz') || natural(a.title, b.title)); let last = '';
  const rowsD = docsS.map(d => { const g = (d.system || 'General') !== last ? `<tr class="g"><td colspan="3">${e(d.system || 'General')}</td></tr>` : ''; last = d.system || 'General'; return g + `<tr data-s="${e([d.title, d.type, d.party, d.system].join(' ').toLowerCase())}"><td><a href="${e(link(d))}" target="_blank">${e(d.title)}</a></td><td>${e(d.type || '')}</td><td>${e(d.party || '')}</td></tr>`; }).join('');
  const open = D.filter(d => d.status !== 'Closed'), cnt = s => D.filter(d => d.status === s).length;
  const rowsF = open.slice().sort((a, b) => natural(a.id, b.id)).map(d => `<tr data-s="${e([d.id, d.title, d.unit, d.room, d.responsible].join(' ').toLowerCase())}"><td>${e(d.id)}</td><td><b>${e(d.title)}</b><br><small>${e([d.block && 'Block ' + d.block, d.level, d.unit && 'Unit ' + d.unit, d.room].filter(Boolean).join(', '))}</small></td><td>${e(d.status)}</td><td>${e(d.responsible || '')}</td></tr>`).join('');
  const contacts = (p.directory || []).filter(c => (c.audience || 'FM') !== 'Not shown');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(p.name)} - handover</title><style>
body{font:15px/1.45 system-ui,Segoe UI,Arial,sans-serif;margin:0;color:#18232f;background:#f4f6f8}header{background:#011c35;color:#fff;padding:20px 28px}header h1{margin:0;font-size:24px}header p{margin:4px 0 0;opacity:.85}
nav{position:sticky;top:0;background:#fff;border-bottom:1px solid #dde3e9;padding:8px 28px;display:flex;gap:14px;flex-wrap:wrap;align-items:center;z-index:2}nav a{color:#245d97;text-decoration:none;font-weight:600}nav input{margin-left:auto;padding:7px 10px;border:1px solid #c9d0d8;border-radius:8px;min-width:240px}
main{padding:10px 28px 40px;max-width:1300px}section{background:#fff;border:1px solid #dde3e9;border-radius:10px;padding:14px 18px;margin:16px 0}h2{margin:0 0 10px;font-size:18px;color:#011c35}
table{width:100%;border-collapse:collapse}th{text-align:left;font-size:12px;text-transform:uppercase;color:#5b6672;border-bottom:2px solid #dde3e9;padding:6px}td{padding:6px;border-bottom:1px solid #eef1f4;vertical-align:top}small{color:#5b6672}tr.g td{background:#f2f5f8;font-weight:700;color:#011c35}a{color:#245d97}
.k{display:flex;gap:12px;flex-wrap:wrap}.k div{background:#f2f5f8;border-radius:8px;padding:10px 14px}.k b{display:block;font-size:20px}.note{color:#5b6672;font-size:13px}@media print{nav{display:none}}
</style></head><body><header><h1>${e(p.name)}</h1><p>${e([p.address, p.client].filter(Boolean).join(' · '))}</p><p>Handover record prepared by ${e(APP.company)} on ${e(nzDate(todayISO()))}. This page works offline: keep it in the same folder as the Documents folder.</p></header>
<nav><a href="#keys">Key dates</a><a href="#assets">Assets and warranties</a><a href="#maint">Maintenance</a><a href="#docs">Documents</a><a href="#defects">Defects</a><a href="#contacts">Contacts</a><input id="q" type="search" placeholder="Search everything…"></nav><main>
${sec('keys', 'Key dates', `<div class="k">${[['Practical completion', p.pcDate], ['Defects period ends', p.pcDate ? X.addFreq(p.pcDate, +(p.dnpMonths || 12), 'months') : ''], ['Building warrant of fitness due', p.bwofDue], ['Code compliance certificate', p.cccDate]].map(([l, v]) => `<div><small>${l}</small><b>${v ? e(nzDate(v)) : 'not set'}</b></div>`).join('')}</div><p class="note">Warranty expiry dates run from practical completion unless the warranty states otherwise.</p>`)}
${sec('assets', `Assets and warranties (${A.length})`, `<table><tr><th>Ref</th><th>Element</th><th>System</th><th>Warranty to</th><th>Documents</th></tr>${rowsA}</table>`)}
${sec('maint', `Maintenance (${T.length})`, tasks.length ? `<table><tr><th>Task</th><th>How often</th><th>Who</th><th>Next due</th></tr>${rowsT}</table><p class="note">Many warranties depend on this maintenance being done and recorded.</p>` : '<p class="note">No maintenance tasks recorded.</p>')}
${sec('docs', `Documents (${Dd.length})`, `<table><tr><th>Document</th><th>Type</th><th>From</th></tr>${rowsD}</table>${mode === 'zip' ? '' : '<p class="note">Links open the online copies.</p>'}`)}
${sec('defects', 'Defects', `<div class="k">${['Open', 'In progress', 'Ready for review', 'Disputed', 'Closed'].map(s => `<div><small>${s}</small><b>${cnt(s)}</b></div>`).join('')}</div>${open.length ? `<h3>Not closed at the time of handover (${open.length})</h3><table><tr><th>ID</th><th>Defect</th><th>Status</th><th>Responsible</th></tr>${rowsF}</table>` : '<p>All defects were closed at the time of handover.</p>'}<p class="note">The full register with history is in the Defects Register files beside this page.</p>`)}
${sec('contacts', 'Contacts', contacts.length ? `<table><tr><th>Company</th><th>Trade</th><th>Contact</th><th>Phone</th><th>Email</th></tr>${contacts.map(c => `<tr data-s="${e([c.company, c.trade, c.name].join(' ').toLowerCase())}"><td><b>${e(c.legal || c.company)}</b></td><td>${e(c.trade || '')}</td><td>${e(c.name || '')}</td><td>${e(c.phone || '')}${c.afterHours ? '<br><small>After hours ' + e(c.afterHours) + '</small>' : ''}</td><td>${c.email ? `<a href="mailto:${e(c.email)}">${e(c.email)}</a>` : ''}</td></tr>`).join('')}</table>` : '<p class="note">No contacts recorded.</p>')}
</main><script>document.getElementById('q').oninput=function(){var q=this.value.toLowerCase().trim().split(/\\s+/).filter(Boolean);document.querySelectorAll('tr[data-s]').forEach(function(r){r.style.display=!q.length||q.every(function(w){return r.getAttribute('data-s').indexOf(w)>-1})?'':'none'})}</script></body></html>`;
}
// Everything in the project as one data file, kept with the record so the project can be read back later
function dataJson() {
  const p = { ...S.project }; delete p.memberInfo; delete p.members; delete p.memberUids; delete p.access;
  const f = X.fm(), strip = L => (L || []).map(x => JSON.parse(JSON.stringify(x)));
  return new Blob([JSON.stringify({ app: APP.name, type: 'project-archive', version: 1, exported: new Date().toISOString(), project: p, plans: strip(S.plans).map(x => ({ ...x })), defects: strip(S.defects), assets: strip(f.assets), docs: strip(f.docs), tasks: strip(f.tasks), systems: strip(f.systems), guide: strip(f.guide), actions: strip(f.actions) }, null, 1)], { type: 'application/json' });
}

/* ------------------------------------------------------------ after handover: free the cloud storage, keep the records */
export async function archiveDialog() {
  if (!can.admin()) return toast('Only project admins can archive a project');
  const p = S.project, Dd = X.fm().docs.filter(d => d.path && d.url), ph = (S.defects || []).flatMap(d => (d.photos || []).filter(x => x.path)), mb = Dd.reduce((a, d) => a + (d.size || 0), 0) / 1e6;
  if (!p.handoverExported) return toast('Generate and download the handover pack (with the documents bundled) first. Archiving removes the files from the cloud.', 8000);
  modal(`<h2>Archive ${esc(p.name)}</h2><p>The handover pack was downloaded on <b>${esc(nzDate(String(p.handoverExported).slice(0, 10)))}</b>. Archiving:</p>
  <ul><li>removes ${Dd.length} document files (about ${mb.toFixed(0)} MB) and ${ph.length} defect photos from cloud storage;</li><li>keeps every record (defects, histories, assets, warranties, maintenance), so the project's track record stays;</li><li>hides the project from everyone except system administrators.</li></ul>
  <p class="note">This cannot be undone from the app. Check the downloaded pack opens and is stored in the client's system and your own records first.</p>
  <label class="f">Type the project name to confirm<input id="arN" placeholder="${esc(p.name)}"></label>
  <div class="act"><button id="arX">Cancel</button><button class="go warn" id="arGo">Archive</button></div>`);
  $('arX').onclick = closeModal;
  $('arGo').onclick = async () => { if ($('arN').value.trim() !== p.name) return toast('Type the project name exactly to confirm');
    if (!(await confirmBox(`Remove ${Dd.length + ph.length} files from cloud storage and archive ${p.name}? This cannot be undone.`, 'Archive now'))) return;
    const b = busy('Archiving…'); let n = 0;
    try { for (const d of Dd) { b.set(`Removing files ${++n} of ${Dd.length + ph.length}…`); try { await S.store.deleteFile(d.path); } catch (e) {} await S.store.patchItem(p.id, 'docs', d.id, { url: '', fileArchived: new Date().toISOString() }); }
      for (const x of ph) { b.set(`Removing files ${++n} of ${Dd.length + ph.length}…`); try { await S.store.deleteFile(x.path); } catch (e) {} }
      await S.store.updateProject(p.id, { archived: true, archivedAt: new Date().toISOString(), archivedBy: S.user.email }); b.done(); toast('Archived. The records are kept; the files are removed from the cloud.', 8000); }
    catch (e) { b.done(); toast(`Stopped after ${n} files: ${e.message}. Run it again to carry on.`, 9000); } };
}

/* ------------------------------------------------------------ dialog */
export function packDialog() {
  const Dd = X.fm().docs.filter(d => !d.template && !d.superseded); const files = Dd.filter(d => d.url && !d.link); const mb = files.reduce((a, d) => a + (d.size || 0), 0) / 1e6;
  modal(`<h2>Handover pack</h2><p class="note">Generates the handover documents from what is in this project now. Regenerate any time; nothing in the project changes.</p>
  <div class="opt"><input type="checkbox" id="hpF" checked><label for="hpF"><b>Facility Management Manual</b>: key dates, contacts, compliance schedule and BWoF, maintenance schedule, assets and warranties, document index, open defects</label></div>
  <div class="opt"><input type="checkbox" id="hpH" checked><label for="hpH"><b>Home User Guide</b> for residents: large clear type, how to look after the home, fire safety, who to call</label></div>
  <div class="opt"><input type="checkbox" id="hpR" checked><label for="hpR"><b>FM register</b> (Excel) and maintenance calendar (.ics)</label></div>
  <div class="opt"><input type="checkbox" id="hpI" checked><label for="hpI"><b>Front page</b> (Open me first.html): assets, warranties with expiry dates, maintenance, every document and open defects, searchable, opens offline in any browser</label></div>
  <div class="opt"><input type="checkbox" id="hpD" checked><label for="hpD"><b>Defects register at handover</b>: Excel of every defect, and a PDF with each item's full history</label></div>
  <div class="opt" style="margin-left:24px"><input type="checkbox" id="hpDp"><label for="hpDp">Include photos and plan locations in the defects PDF (much larger and slower)</label></div>
  <div class="opt"><input type="checkbox" id="hpJ" checked><label for="hpJ"><b>Data file</b> (JSON): every record, kept with the pack so the project can be read back into Resero Site later</label></div>
  <h3 class="sec">Documents</h3>
  <label class="opt"><input type="radio" name="hpM" value="zip" checked> Bundle every document into one zip, filed by building system and type, with the manuals linking to the files (${files.length} files, about ${mb.toFixed(0)} MB). Best for SharePoint and long-term records.</label>
  <label class="opt"><input type="radio" name="hpM" value="online"> Manuals only, linking to the online copies (small and quick)</label>
  <p class="note">Links to files inside the zip work in Adobe Acrobat Reader and most desktop PDF readers once the zip is extracted. Browser PDF viewers may not follow them.</p>
  <p class="note" id="hpSt"></p>
  <div class="act">${can.admin() ? '<button id="hpAr" class="warn" style="margin-right:auto">Archive after handover…</button>' : ''}<button id="hpX">Close</button><button class="go" id="hpGo">Generate</button></div>`);
  $('hpX').onclick = closeModal; if ($('hpAr')) $('hpAr').onclick = archiveDialog;
  $('hpGo').onclick = async () => {
    const mode = document.querySelector('[name=hpM]:checked').value, st = t => $('hpSt').textContent = t, nm = safeName(S.project.name), n = stamp();
    $('hpGo').disabled = true;
    try {
      const out = [];
      if ($('hpF').checked) { st('Building the FM Manual…'); out.push([`${nm} - Facility Management Manual - ${n}.pdf`, await buildFmManual(mode, st)]); }
      if ($('hpH').checked) { st('Building the Home User Guide…'); out.push([`${nm} - Home User Guide - ${n}.pdf`, await buildHomeGuide(mode, st)]); }
      if ($('hpR').checked) { st('Building the FM register…'); const r = await X.registerBlob(); if (r) out.push([`${nm} - FM Register - ${n}.xlsx`, r]); out.push([`${nm} - Maintenance calendar - ${n}.ics`, X.icsBlob()]); }
      if ($('hpD').checked) { const L = (S.defects || []).slice().sort((a, b) => natural(a.id, b.id)), ctx = { project: S.project, plans: S.plans, getBytes: X.getBytes, logoResero: 'img/resero-navy.png', me: S.user.name };
        st('Building the defects register (Excel)…'); out.push([`${nm} - Defects Register at handover - ${n}.xlsx`, await buildXlsx(L, ctx)]);
        st('Building the defects register (PDF)…'); out.push([`${nm} - Defects Register at handover - ${n}.pdf`, await buildPdf(L, { title: 'Defects register at handover', sub: 'All defects', intro: 'Every defect recorded on the project, with its status and full history, as at handover.', team: true, comments: true, photos: $('hpDp').checked, plans: false, sig: false }, ctx, st)]); }
      if ($('hpJ').checked) out.push([`${nm} - Resero Site data - ${n}.json`, dataJson()]);
      if ($('hpI').checked) out.push(['Open me first.html', new Blob([indexHtml(mode, files)], { type: 'text/html' })]);
      if (mode === 'online' && out.length === 1) { deliver(out[0][1], out[0][0], 'Handover document'); st(''); return; }
      if (!window.JSZip) await loadScript('lib/jszip.min.js');
      const z = new JSZip(), root = `${nm} - Handover Pack - ${n}/`;
      out.forEach(([name, blob]) => z.file(root + name, blob));
      if (mode === 'zip') { let i = 0, fail = []; for (const d of files) { st(`Adding documents ${++i} of ${files.length}: ${d.title}`); try { z.file(root + docPath(d), await X.getBytes(d.url)); } catch (e) { fail.push(d.title); } } if (fail.length) z.file(root + 'Documents not included.txt', 'These documents could not be downloaded when the pack was made (check the storage CORS setting, README step 6):\r\n\r\n' + fail.join('\r\n')); }
      z.file(root + 'Read me.txt', `${S.project.name} handover pack, prepared by ${APP.company}${S.project.client ? ' for ' + S.project.client : ''} on ${nzDate(todayISO())}.\r\n\r\nStart with the Facility Management Manual. Keep this folder together: the manuals link to the files in the Documents folder.\r\nThe Home User Guide is written for residents and can be printed or emailed on its own.\r\n`);
      st('Zipping…'); const blob = await z.generateAsync({ type: 'blob' }, m => st(`Zipping… ${m.percent.toFixed(0)}%`));
      deliver(blob, `${nm} - Handover Pack - ${n}.zip`, 'Handover pack'); st('');
      if (mode === 'zip') { try { await S.store.updateProject(S.project.id, { handoverExported: new Date().toISOString() }); S.project.handoverExported = new Date().toISOString(); } catch (e) {} }
    } catch (e) { console.error(e); st(''); toast('Could not build the pack: ' + e.message, 7000); }
    finally { $('hpGo').disabled = false; }
  };
}
