// Handover pack generator: FM Manual (property team), Home User Guide (residents), and a zip with every document linked.
import { S } from './state.js';
import { APP } from './config.js';
import { $, esc, toast, modal, closeModal, busy, todayISO, nzDate, stamp, natural, safeName, deliver, loadScript } from './util.js';

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
export function docPath(d) { const ext = (/\.[a-z0-9]{2,5}$/i.exec(d.fileName || '') || [''])[0] || '.pdf'; return `Documents/${safeName(d.system || 'General').slice(0, 60)}/${safeName(d.type || 'Other').replace(/[()]/g, '').slice(0, 40)}/${safeName(d.title).slice(0, 110)}${ext}`; }
const target = (d, mode) => d.link ? d.link : mode === 'zip' ? (d.url ? docPath(d) : '') : (d.url || '');
const contacts = aud => (S.project.contacts || []).filter(c => !aud || !c.audience || c.audience === 'Both' || c.audience === aud);

/* ------------------------------------------------------------ FM Manual */
export async function buildFmManual(mode, st = () => {}) {
  if (!window.PDFLib) await loadScript('lib/pdf-lib.min.js');
  const p = S.project, { assets: A, tasks: T, systems: SY, docs: Dd } = X.fm(), { SYSTEMS, warrantyExpiry, freqText, addFreq } = X;
  const w = await Writer({ title: 'Facility Management Manual', base: 9.5 });
  const dnpEnd = p.pcDate ? addFreq(p.pcDate, +(p.dnpMonths || 12), 'months') : '';
  w.cover('Facility Management Manual', p.name, [['Property', [p.name, p.address].filter(Boolean).join(', ')], ['Owner', p.client], ['Main contractor', p.contractor], ['Practical completion', nzDate(p.pcDate)], ['Code Compliance Certificate', nzDate(p.cccDate)], ['Compliance schedule', p.csNumber], ['Building consent', p.consent]]);
  const secs = [['How to use this manual', 'use'], ['Key dates and contacts', 'dates'], ['Compliance schedule and building warrant of fitness', 'comp'], ['Maintenance schedule', 'maint'], ['Assets and warranties', 'assets'], ['Document index', 'docs'], ['Defects notification period', 'dnp']];
  w.contents(secs.map(([t, a]) => ({ t, anchor: a })));
  st('Writing the manual…');
  w.h1('How to use this manual', 'use');
  w.para(`This manual brings together what ${p.client || 'the owner'} needs to operate, maintain and keep ${p.name} compliant: key dates and contacts, the compliance schedule and building warrant of fitness (BWoF) obligations, the planned maintenance schedule, the asset and warranty register, and an index of the handover documents.`);
  w.para('Blue text is a link. In the contents it jumps to the section; in the tables it opens the document. ' + (mode === 'zip' ? 'Links open the files in the Documents folder supplied with this manual, so keep the folder and this file together.' : 'Links open the online copy in Resero Defects, which needs internet access and a signed-in account for some files.'));
  w.para('Many warranties depend on the maintenance in this manual being carried out and recorded. Keep maintenance records (in Resero Defects or with this manual) for the life of each warranty.', { bold: true });
  w.h1('Key dates and contacts', 'dates');
  w.table([{ label: 'Item', w: .55, key: 'a' }, { label: 'Date', w: .45, key: 'b' }], [['Practical completion', p.pcDate], ['Defects notification period ends', dnpEnd], ['Code Compliance Certificate issued', p.cccDate], ['Building warrant of fitness due', p.bwofDue], ['Weathertightness guarantee ends (10 years from PC)', p.pcDate ? addFreq(p.pcDate, 10, 'years') : '']].map(([a, b]) => ({ a, b: b ? nzDate(b) : 'To be confirmed' })), { size: 9.5 });
  const C = contacts('FM');
  if (C.length) { w.h2('Contacts'); w.table([{ label: 'Role', w: .26, key: 'role', bold: true }, { label: 'Company / name', w: .3, key: 'name' }, { label: 'Phone', w: .18, key: 'phone' }, { label: 'Email', w: .26, key: 'email' }], C, { size: 9 }); }
  else w.para('Contacts: add them in Resero Defects (Dashboard > Contacts) and regenerate this manual.', { color: w.GREY });
  st('Compliance…');
  w.h1('Compliance schedule and building warrant of fitness', 'comp');
  w.para(`The building has a compliance schedule${p.csNumber ? ' (' + p.csNumber + ')' : ''} listing its specified systems. Under the Building Act 2004 the owner must have each system inspected and maintained as the schedule requires, obtain a Form 12A certificate from an Independent Qualified Person (IQP) for each system every year, then sign the building warrant of fitness, display it in a public place in the building, and give a copy to Auckland Council. ${p.bwofDue ? 'The next BWoF is due ' + nzDate(p.bwofDue) + '.' : ''}${p.iqp ? ' IQP: ' + p.iqp + '.' : ''}`);
  w.table([{ label: 'System', w: .1, key: 'ss', bold: true }, { label: 'Description and location', w: .3, key: r => r.name + (r.location ? '\n' + r.location : '') }, { label: 'Performance standard', w: .28, key: 'standard' }, { label: 'Inspection, maintenance and reporting', w: .32, key: 'inspections' }], SY.slice().sort((a, b) => natural(a.ss, b.ss)));
  st('Maintenance…');
  w.h1('Maintenance schedule', 'maint');
  w.para('Planned and compliance maintenance. Frequencies come from the compliance schedule, the performance standards and the manufacturers\' requirements; confirm them against the O&M manuals. Record each completed task, with any report, in Resero Defects.');
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
  w.para(`The defects notification period runs for ${p.dnpMonths || 12} months from practical completion${dnpEnd ? ', to ' + nzDate(dnpEnd) : ''}. Report any defect found in this period to the property team so it can be logged in Resero Defects and passed to the contractor. ${open.length ? open.length + ' items were open at the date of this manual:' : 'There were no open items at the date of this manual.'}`);
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
  const p = S.project, { assets: A, docs: Dd } = X.fm();
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

/* ------------------------------------------------------------ dialog */
export function packDialog() {
  const { docs: Dd } = X.fm(); const files = Dd.filter(d => d.url && !d.link); const mb = files.reduce((a, d) => a + (d.size || 0), 0) / 1e6;
  modal(`<h2>Handover pack</h2><p class="note">Generates the handover documents from what is in this project now. Regenerate any time; nothing in the project changes.</p>
  <div class="opt"><input type="checkbox" id="hpF" checked><label for="hpF"><b>Facility Management Manual</b>: key dates, contacts, compliance schedule and BWoF, maintenance schedule, assets and warranties, document index, open defects</label></div>
  <div class="opt"><input type="checkbox" id="hpH" checked><label for="hpH"><b>Home User Guide</b> for residents: large clear type, how to look after the home, fire safety, who to call</label></div>
  <div class="opt"><input type="checkbox" id="hpR" checked><label for="hpR"><b>FM register</b> (Excel) and maintenance calendar (.ics)</label></div>
  <h3 class="sec">Documents</h3>
  <label class="opt"><input type="radio" name="hpM" value="zip" checked> Bundle every document into one zip, filed by building system and type, with the manuals linking to the files (${files.length} files, about ${mb.toFixed(0)} MB). Best for SharePoint and long-term records.</label>
  <label class="opt"><input type="radio" name="hpM" value="online"> Manuals only, linking to the online copies (small and quick)</label>
  <p class="note">Links to files inside the zip work in Adobe Acrobat Reader and most desktop PDF readers once the zip is extracted. Browser PDF viewers may not follow them.</p>
  <p class="note" id="hpSt"></p>
  <div class="act"><button id="hpX">Close</button><button class="go" id="hpGo">Generate</button></div>`);
  $('hpX').onclick = closeModal;
  $('hpGo').onclick = async () => {
    const mode = document.querySelector('[name=hpM]:checked').value, st = t => $('hpSt').textContent = t, nm = safeName(S.project.name), n = stamp();
    $('hpGo').disabled = true;
    try {
      const out = [];
      if ($('hpF').checked) { st('Building the FM Manual…'); out.push([`${nm} - Facility Management Manual - ${n}.pdf`, await buildFmManual(mode, st)]); }
      if ($('hpH').checked) { st('Building the Home User Guide…'); out.push([`${nm} - Home User Guide - ${n}.pdf`, await buildHomeGuide(mode, st)]); }
      if ($('hpR').checked) { st('Building the FM register…'); const r = await X.registerBlob(); if (r) out.push([`${nm} - FM Register - ${n}.xlsx`, r]); out.push([`${nm} - Maintenance calendar - ${n}.ics`, X.icsBlob()]); }
      if (mode === 'online' && out.length === 1) { deliver(out[0][1], out[0][0], 'Handover document'); st(''); return; }
      if (!window.JSZip) await loadScript('lib/jszip.min.js');
      const z = new JSZip(), root = `${nm} - Handover Pack - ${n}/`;
      out.forEach(([name, blob]) => z.file(root + name, blob));
      if (mode === 'zip') { let i = 0, fail = []; for (const d of files) { st(`Adding documents ${++i} of ${files.length}: ${d.title}`); try { z.file(root + docPath(d), await X.getBytes(d.url)); } catch (e) { fail.push(d.title); } } if (fail.length) z.file(root + 'Documents not included.txt', 'These documents could not be downloaded when the pack was made (check the storage CORS setting, README step 6):\r\n\r\n' + fail.join('\r\n')); }
      z.file(root + 'Read me.txt', `${S.project.name} handover pack, prepared by ${APP.company}${S.project.client ? ' for ' + S.project.client : ''} on ${nzDate(todayISO())}.\r\n\r\nStart with the Facility Management Manual. Keep this folder together: the manuals link to the files in the Documents folder.\r\nThe Home User Guide is written for residents and can be printed or emailed on its own.\r\n`);
      st('Zipping…'); const blob = await z.generateAsync({ type: 'blob' }, m => st(`Zipping… ${m.percent.toFixed(0)}%`));
      deliver(blob, `${nm} - Handover Pack - ${n}.zip`, 'Handover pack'); st('');
    } catch (e) { console.error(e); st(''); toast('Could not build the pack: ' + e.message, 7000); }
    finally { $('hpGo').disabled = false; }
  };
}
