// Facilities Guide: the building handed to a facilities management team as one navigable PDF.
// Who to call, what to do if, warranties, each building system (what is installed, how it works, what the team does, what not to do,
// its maintenance and its documents), the planned maintenance calendar, compliance, and an A to Z index. Every page carries a
// navigation bar, the bookmark panel lists every section, and every document title opens the document itself.
// The data comes from the app (assets, tasks, specified systems, documents, contacts); the words about how each system works are
// kept on the project (fmGuide) and edited in "Facilities guide notes".
import { S } from './state.js';
import { APP } from './config.js';
import { loadScript, natural, todayISO, nzDate } from './util.js';
import { SYSTEMS, freqText, addFreq } from './fm.js';

const clean = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/→/g, '->').replace(/[\t\r]/g, ' ').replace(/[^\n\x20-\x7e\xa0-\xff‘’“”•–—…]/g, '');
const SYS_LIST = () => SYSTEMS.filter(s => !/^(00|14) /.test(s));
const sysName = s => String(s || '').replace(/^\d\d\s+/, '').replace(/\s*\(.*?\)\s*$/, '');
const SS_SYS = { SS1: '08', SS2: '08', SS4: '08', SS14: '08', SS15: '08', SS3: '10', SS8: '09', SS9: '07', SS7: '05' };
const ssHome = ss => SS_SYS[(/^SS\d+/.exec(ss || '') || [''])[0]] || '';
const TYPE_ORDER = ['O&M manual', 'Care and maintenance guide', 'As-built drawing', 'Commissioning / test record', 'Producer statement / certificate', 'Warranty (Schedule 13 deed)', 'Warranty (product)', 'Product data sheet', 'Design PS1 / report', 'Specification / drawing', 'Inspection / QA record', 'Consent / authority document', 'Compliance (Form 12A / BWoF)', 'Maintenance record', 'Contract document', 'Correspondence (email / letter)', 'Other'];
const TYPE_HEAD = { 'O&M manual': 'O&M manuals', 'Care and maintenance guide': 'Care and maintenance guides', 'As-built drawing': 'As-built drawings', 'Commissioning / test record': 'Commissioning and test records', 'Producer statement / certificate': 'Producer statements and certificates', 'Warranty (Schedule 13 deed)': 'Warranties: Schedule 13 deeds', 'Warranty (product)': 'Warranties: product warranties', 'Product data sheet': 'Product data sheets', 'Design PS1 / report': 'Design reports and PS1s', 'Specification / drawing': 'Specifications and drawings', 'Inspection / QA record': 'Inspection and QA records', 'Consent / authority document': 'Consent and authority documents', 'Compliance (Form 12A / BWoF)': 'Compliance certificates', 'Maintenance record': 'Maintenance records', 'Contract document': 'Contract documents' };
const period = m => !m ? '' : m % 12 ? `${m} months` : `${m / 12} year${m === 12 ? '' : 's'}`;
const titlePeriod = t => { const m = /\(([^)]*?\d+\s*(?:yr|year|mth|month)[^)]*)\)/i.exec(t || ''); return m ? m[1] : ''; };
const titleMonths = t => { const m = /(\d+)\s*(yr|year|mth|month)/i.exec(titlePeriod(t)); return m ? +m[1] * (/y/i.test(m[2]) ? 12 : 1) : 0; };

// What a new project starts with. Plain and general: the project's own notes replace these system by system.
export const DEFAULT_WHATIF = [
  ['Fire or smoke', 'Dial 111 and ask for Fire. Follow the building evacuation procedure and go to the assembly point. Do not use the lift. Do not silence or reset the alarm panel until Fire and Emergency says so.'],
  ['Sprinkler operating with no fire', 'Call the fire contractor and 111 if unsure. Only a trained person isolates the sprinkler valve. Record the time and the cause.'],
  ['Water leak', 'Close the isolation valve to that home or area, then the main if needed. Call the plumber. Protect electrical equipment and tell the residents below.'],
  ['Power off in one home', 'Check the switchboard in the home: reset a tripped breaker once only. If it trips again, leave it off and call the electrician.'],
  ['Power off to the whole building', 'Check the network operator\'s outage map. Check the lift for trapped passengers and that emergency lighting has come on.'],
  ['Lift stopped or someone trapped', 'Use the lift phone or call the lift contractor\'s 24 hour number. Do not try to open the doors. Stay and talk to the person until help arrives.'],
  ['Entry door or intercom not working', 'Check for a fire alarm (doors release on alarm). Use the manual release or key. Call the access control contractor.'],
  ['No hot water in a home', 'Check the cylinder isolator and the switchboard breaker. If the relief valve is discharging continuously, close the supply and call the plumber.'],
  ['Heating, cooling or ventilation fault', 'Check the remote batteries and the isolator. Do not open the unit. Call the mechanical contractor.'],
  ['A defect in the building work', 'Record it with a photo and report it as set out in Defects and warranties. Do not have another contractor repair it without agreement.'],
];

const cfgOf = p => ({ sys: {}, whatIf: null, ...(p.fmGuide || {}) });

export async function build(opt = {}) {
  const st = opt.status || (() => {});
  if (!window.PDFLib) await loadScript('lib/pdf-lib.min.js');
  const P = window.PDFLib, doc = await P.PDFDocument.create(), f = await doc.embedFont(P.StandardFonts.Helvetica), fb = await doc.embedFont(P.StandardFonts.HelveticaBold), fi = await doc.embedFont(P.StandardFonts.HelveticaOblique);
  const p = S.project, F = S.fm || {}, G = cfgOf(p), org = (p.guideCfg || {}).org || p.client || 'the owner', phone = (p.guideCfg || {}).phone || '';
  const hx = h => { const n = parseInt(h.slice(1), 16); return P.rgb((n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255); };
  const NAVY = hx('#172B4D'), TEAL = hx('#2A8E9C'), TEALBG = hx('#E6F4F6'), GREY = hx('#5f6b7a'), LINE = hx('#d5dbe2'), TXT = hx('#1a2330'), LINK = hx('#1b6f7c'), WHITE = P.rgb(1, 1, 1), ALT = hx('#f5f7f9'), AMBER = hx('#FFF4D6');
  const A4 = [595.28, 841.89], M = 42;
  const A = (F.assets || []).filter(a => !/^(Not applicable|NA|N\/A)$/i.test(a.status || '')), T = F.tasks || [], SY = (F.systems || []).slice().sort((a, b) => natural(a.ss || '', b.ss || ''));
  const D = (F.docs || []).filter(d => !d.template && !d.superseded && !d.restricted), dir = (p.directory || []).filter(c => c.audience !== 'Not shown');
  const dnpEnd = p.pcDate ? addFreq(p.pcDate, +(p.dnpMonths || 12), 'months') : '', date = nzDate(todayISO());
  const sysList = SYS_LIST().filter(s => A.some(a => a.system === s) || D.some(d => d.system === s) || T.some(t => t.system === s));
  const secNo = s => { const i = sysList.indexOf(s); return i < 0 ? '' : `5.${i + 1}`; };
  const NAV = [['Contents', 'contents'], ['Who to call', 'who'], ['Warranties', 'warr'], ['Systems', 'sys'], ['Maintenance', 'maint'], ['Compliance', 'comp'], ['Index', 'index']];

  /* ---------- writer ---------- */
  let pg = null, y = 0, W = A4[0], H = A4[1]; const pages = [], links = [], anchors = {}, outline = [];
  let cli = null, res = null; const emb = async src => { try { const b = new Uint8Array(await opt.getBytes(src)); return b[0] === 0x89 ? await doc.embedPng(b) : await doc.embedJpg(b); } catch (e) { return null; } };
  if (p.clientLogo) cli = await emb(p.clientLogo); res = await emb('img/resero-navy.png');
  const tw = (t, font, sz) => font.widthOfTextAtSize(clean(t), sz);
  const text = (t, x, yy, sz, font, col) => pg.drawText(clean(t), { x, y: yy, size: sz, font: font || f, color: col || TXT });
  const wrap = (t, font, sz, mw) => { const out = []; clean(t).split('\n').forEach(par => { let ln = ''; par.split(/ +/).forEach(w => { let tr = ln ? ln + ' ' + w : w; if (font.widthOfTextAtSize(tr, sz) <= mw) { ln = tr; return; } if (ln) out.push(ln); while (font.widthOfTextAtSize(w, sz) > mw && w.length > 4) { let k = w.length - 1; while (k > 3 && font.widthOfTextAtSize(w.slice(0, k), sz) > mw) k--; out.push(w.slice(0, k)); w = w.slice(k); } ln = w; }); out.push(ln); }); return out; };
  const newPage = land => { W = land ? A4[1] : A4[0]; H = land ? A4[0] : A4[1]; pg = doc.addPage([W, H]); pages.push({ pg, W, H });
    // navigation bar
    let x = W - M; pg.drawRectangle({ x: 0, y: H - 30, width: W, height: 30, color: TEALBG });
    NAV.slice().reverse().forEach(([t, a]) => { const w = tw(t, fb, 8); x -= w; text(t, x, H - 19, 8, fb, LINK); links.push({ pg, r: [x - 3, H - 26, x + w + 3, H - 8], anchor: a }); x -= 16; });
    text(`${p.name} · Facilities Guide`, M, H - 19, 8, f, GREY);
    y = H - 62; return pg; };
  const need = h => { if (y - h < M + 22) newPage(W > H); };
  const anchor = (id, yy) => { anchors[id] = { pg, y: (yy ?? y) + 22 }; };
  const h1 = (t, id, land) => { newPage(land); if (id) anchor(id, y + 6); outline.push({ t, pg, y: y + 28, kids: [] }); text(t, M, y - 8, 21, fb, NAVY); pg.drawRectangle({ x: M, y: y - 20, width: 46, height: 2.5, color: TEAL }); y -= 46; };
  const h2 = (t, id, o = {}) => { need(o.keep || 70); y -= 8; if (id) anchor(id, y); if (o.outline !== false && outline.length) outline[outline.length - 1].kids.push({ t, pg, y: y + 22 }); text(t, M, y, 13.5, fb, NAVY); y -= 20; };
  const h3 = t => { need(44); y -= 4; text(t, M, y, 10.5, fb, TEAL); y -= 15; };
  const para = (t, o = {}) => { const sz = o.size || 9.5, font = o.bold ? fb : o.it ? fi : f, lh = sz * 1.42; wrap(t, font, sz, W - 2 * M - (o.indent || 0)).forEach(l => { need(lh); text(l, M + (o.indent || 0), y, sz, font, o.color); y -= lh; }); y -= o.after ?? 5; };
  const bullets = (items, o = {}) => { const sz = o.size || 9.5, lh = sz * 1.42; items.filter(Boolean).forEach(t => { wrap(t, f, sz, W - 2 * M - 14).forEach((l, i) => { need(lh); if (!i) pg.drawCircle({ x: M + 4, y: y + sz * 0.33, size: 1.7, color: o.color || TEAL }); text(l, M + 14, y, sz, f); y -= lh; }); y -= 1.5; }); y -= 5; };
  const lines = s => String(s || '').split('\n').map(x => x.replace(/^[\s•*-]+/, '').trim()).filter(Boolean);
  const note = (head, body, col) => { const L = wrap(body, f, 9, W - 2 * M - 24), hh = 16 + (head ? 14 : 0) + L.length * 12.6; need(hh + 8); pg.drawRectangle({ x: M, y: y - hh + 10, width: W - 2 * M, height: hh, color: col || TEALBG }); pg.drawRectangle({ x: M, y: y - hh + 10, width: 3, height: hh, color: col ? hx('#D9A300') : TEAL }); let yy = y - 4; if (head) { text(head, M + 12, yy, 9.5, fb, NAVY); yy -= 14; } L.forEach(l => { text(l, M + 12, yy, 9, f); yy -= 12.6; }); y -= hh + 8; };
  // table: cols [{ label, w (share), key | fn, bold, link: row => url | '#anchor' }]
  const table = (cols, rows, o = {}) => { const sz = o.size || 8.5, lh = sz * 1.32, full = W - 2 * M, tot = cols.reduce((a, c) => a + c.w, 0), cw = cols.map(c => c.w / tot * full);
    const head = () => { need(lh + 26); let x = M; pg.drawRectangle({ x: M, y: y - 5, width: full, height: lh + 7, color: NAVY }); cols.forEach((c, i) => { text(c.label, x + 4, y, sz, fb, WHITE); x += cw[i]; }); y -= lh + 9; };
    if (!o.noHead) head(); if (!rows.length) { text(o.empty || 'Nothing recorded yet.', M + 4, y, sz, fi, GREY); y -= lh + 8; return; }
    rows.forEach((r, ri) => {
      if (r && r.group) { need(lh + 22); pg.drawRectangle({ x: M, y: y - 4, width: full, height: lh + 5, color: TEALBG }); text(r.group, M + 4, y, sz, fb, NAVY); y -= lh + 7; return; }
      const cells = cols.map((c, i) => wrap(typeof c.key === 'function' ? c.key(r) : (r[c.key] ?? ''), c.bold ? fb : f, sz, cw[i] - 8)), n = Math.max(1, ...cells.map(c => c.length)), rh = n * lh + 5;
      if (y - rh < M + 22) { newPage(W > H); head(); }
      if (ri % 2 && !o.plain) pg.drawRectangle({ x: M, y: y - rh + lh - 1.5, width: full, height: rh, color: ALT });
      let x = M; cols.forEach((c, i) => { const tg = c.link && c.link(r); cells[i].forEach((l, k) => text(l, x + 4, y - k * lh, sz, c.bold ? fb : f, tg ? LINK : c.color)); if (tg && cells[i][0]) { const rr = [x + 2, y - (cells[i].length - 1) * lh - 3, x + cw[i] - 2, y + lh - 3]; links.push(tg[0] === '#' ? { pg, r: rr, anchor: tg.slice(1) } : { pg, r: rr, url: tg }); cells[i].forEach((l, k) => pg.drawLine({ start: { x: x + 4, y: y - k * lh - 1.2 }, end: { x: x + 4 + tw(l, c.bold ? fb : f, sz), y: y - k * lh - 1.2 }, thickness: 0.4, color: LINK })); }
        if (c.draw) c.draw(r, x, y, cw[i], rh, lh); x += cw[i]; });
      y -= rh; pg.drawLine({ start: { x: M, y: y + lh - 1.5 }, end: { x: M + full, y: y + lh - 1.5 }, thickness: 0.4, color: LINE }); });
    y -= 10; };
  const kv = (rows, o = {}) => table([{ label: '', w: o.kw || 30, key: 0, bold: true }, { label: '', w: 100 - (o.kw || 30), key: 1, link: o.link }], rows.filter(r => r && r[1]), { noHead: true, size: 9, plain: true });
  const docLink = d => d.link || d.url || '';

  /* ---------- 0 cover ---------- */
  st('Cover and contents…');
  pg = doc.addPage(A4); W = A4[0]; H = A4[1]; pages.push({ pg, W, H, cover: true });
  pg.drawRectangle({ x: 0, y: H - 360, width: W, height: 360, color: NAVY });
  if (cli) { const ww = 190, hh = ww * cli.height / cli.width; pg.drawRectangle({ x: M - 8, y: H - 52 - hh - 8, width: ww + 16, height: hh + 16, color: WHITE }); pg.drawImage(cli, { x: M, y: H - 52 - hh, width: ww, height: hh }); }
  text('Facilities Guide', M, H - 220, 40, fb, WHITE); text(p.name, M, H - 256, 20, f, hx('#BFE6EB')); wrap(p.address || '', f, 12, W - 2 * M).forEach((l, i) => text(l, M, H - 280 - i * 15, 12, f, WHITE));
  text('For the facilities management team', M, H - 400, 13, fb, NAVY); text('Operation, maintenance, compliance, warranties and handover documents', M, H - 418, 10.5, f, GREY);
  let cy = H - 470; [['Owner', p.client], ['Main contractor', p.contractor], ['Building consent', p.consent], ['Practical Completion', p.pcDate ? nzDate(p.pcDate) : 'To be certified'], ['Defects period ends', dnpEnd ? nzDate(dnpEnd) : `${p.dnpMonths || 12} months from Practical Completion`], ['Issued', date]].filter(r => r[1]).forEach(([k, v]) => { text(k, M, cy, 9.5, fb, GREY); const L = wrap(v, f, 9.5, W - 2 * M - 140); L.forEach((l, i) => text(l, M + 140, cy - i * 13, 9.5, f)); cy -= 13 * L.length + 6; });
  if (res) { const hh = 20, ww = hh * res.width / res.height; pg.drawImage(res, { x: M, y: M + 14, width: ww, height: hh }); }
  text(`Prepared by ${APP.company}${p.client ? ', Project Manager for ' + p.client : ''}`, M, M - 2, 8.5, f, GREY);

  /* ---------- contents (filled in at the end, once page numbers are known) ---------- */
  newPage(); anchor('contents', y + 6); const contentsPg = pg; text('Contents', M, y - 8, 21, fb, NAVY); pg.drawRectangle({ x: M, y: y - 20, width: 46, height: 2.5, color: TEAL });
  const contentsRows = [];
  const C = (t, id, lvl) => contentsRows.push({ t, id, lvl: lvl || 0 });

  /* ---------- 1 how to use ---------- */
  C('1  How to use this guide', 'use'); h1('1  How to use this guide', 'use');
  para(`This guide is the single entry point to the handover information for ${p.name}. It tells the facilities management team what is installed, how to operate and look after it, who to call, what is under warranty and what the law requires. The source documents (O&M manuals, as-built drawings, certificates and warranties) open from the links in each section.`, { size: 10.5 });
  h3('Getting around');
  bullets(['Teal underlined text is a link. In this guide it jumps to that section; on a document title it opens the document itself.', 'The bar at the top of every page links to the main sections.', 'The bookmark panel lists every section and every building system. Open it from the left-hand edge of Adobe Acrobat or your browser\'s PDF viewer.', 'In Adobe Acrobat, Alt + Left Arrow (Cmd + Left Arrow on a Mac) returns to where you came from.', 'Ctrl + F searches the guide.', 'Document links open the copy held online in Resero Site. They need an internet connection but no sign-in.']);
  h3('Where to start');
  table([{ label: 'I need to…', w: 60, key: 0 }, { label: 'Go to', w: 40, key: 1, link: r => '#' + r[2] }], [['Report an emergency or an urgent fault', '3 Who to call', 'who'], ['Know what to do about a leak, a power cut or a lift fault', '3 What to do if…', 'whatif'], ['Report a defect in the building work', '4 Defects and warranties', 'warr'], ['Check whether something is under warranty, and until when', '4 Deeds and product warranties', 'deeds'], ['Find out how a system works and what we must do to it', '5 Building systems', 'sys'], ['See what maintenance is due each month', '6 Twelve-month maintenance calendar', 'cal'], ['Know what the Building Warrant of Fitness requires', '7 Compliance', 'comp'], ['See what residents have been told about their homes', '8 What residents have been told', 'res'], ['Find a specific document', '9 Document index A to Z', 'index']], { size: 9.5 });
  note('Precedence', 'This guide summarises the source documents; it does not replace them. Where the guide and a source document differ, the source document governs. Work on any building service must be carried out by suitably qualified people, following the manufacturer\'s instructions.');

  /* ---------- 2 at a glance ---------- */
  C('2  The building at a glance', 'glance'); h1('2  The building at a glance', 'glance');
  kv([['Property', [p.name, p.address].filter(Boolean).join(', ')], ['Owner and landlord', p.client], ['What it is', p.description], ['Main contractor', p.contractor], ['Form of contract', p.contract], ['Building consent', p.consent], ['Practical Completion', p.pcDate ? nzDate(p.pcDate) : 'To be certified'], ['Defects Notification Period', dnpEnd ? `${p.dnpMonths || 12} months. Ends ${nzDate(dnpEnd)}.` : `${p.dnpMonths || 12} months from Practical Completion`], ['Code Compliance Certificate', p.cccDate ? nzDate(p.cccDate) : 'See Section 7'], ['Compliance schedule', p.csNumber || (SY.length ? `${SY.length} specified systems. See Section 7.` : '')], ['Building Warrant of Fitness due', p.bwofDue ? nzDate(p.bwofDue) : '']]);
  if (G.glance) { h3('About the building'); bullets(lines(G.glance)); }
  const team = (p.contacts || []).filter(c => c.role || c.name);
  if (team.length) { h2('Project team'); table([{ label: 'Role', w: 34, key: 'role', bold: true }, { label: 'Organisation and contact', w: 36, key: 'name' }, { label: 'Phone', w: 14, key: 'phone' }, { label: 'Email', w: 26, key: 'email' }], team, { size: 9 }); }
  if (opt.fmMap) { h2('Site services map'); const im = await doc.embedJpg(opt.fmMap), ww = W - 2 * M, hh = Math.min(ww * im.height / im.width, 430), w2 = hh * im.width / im.height; need(hh + 10); pg.drawImage(im, { x: M + (ww - w2) / 2, y: y - hh + 8, width: w2, height: hh }); y -= hh + 6; para('Shut-offs, plant and services as marked on the site map in Resero Site.', { size: 8.5, color: GREY }); }

  /* ---------- 3 who to call ---------- */
  st('Contacts…');
  C('3  Who to call', 'who'); h1('3  Who to call', 'who');
  { const bw = (W - 2 * M - 12) / 2; need(70); pg.drawRectangle({ x: M, y: y - 52, width: bw, height: 62, color: hx('#C8282D') }); text('111', M + 14, y - 22, 26, fb, WHITE); text('Fire, ambulance, police', M + 14, y - 40, 9.5, f, WHITE);
    pg.drawRectangle({ x: M + bw + 12, y: y - 52, width: bw, height: 62, color: NAVY }); text(phone || 'Number to be added', M + bw + 26, y - 22, phone ? 22 : 13, fb, WHITE); text(`${org}: faults, repairs and resident calls`, M + bw + 26, y - 40, 9.5, f, WHITE); y -= 76; }
  h2('Defects in the building work' + (dnpEnd ? ` (to ${nzDate(dnpEnd)})` : ''));
  table([{ label: 'Who', w: 36, key: 'role', bold: true }, { label: 'Name', w: 34, key: 'name' }, { label: 'Contact', w: 30, key: c => [c.phone, c.email].filter(Boolean).join(' · ') || 'To be added' }], team.filter(c => /project manager|contractor|engineer/i.test(c.role || '')), { size: 9, empty: 'Add the project team under Contacts in Resero Site.' });
  para('See Section 4 for how to report a defect.', { size: 8.5, color: GREY });
  h2('System contractors');
  const byCo = new Map(); A.forEach(a => String(a.installer || '').split(/\s*\/\s*/).forEach(n => { n = n.replace(/\s*\(.*?\)/g, '').trim(); if (!n || /^\[|subs?$|contractor$|^(roofing|metalwork|plumber|artist|supplier|watercare|chorus|haumaru contract)$/i.test(n)) return; const k = n.toLowerCase(); if (!byCo.has(k)) byCo.set(k, { company: n, sys: new Set(), what: [] }); const c = byCo.get(k); c.sys.add(a.system); c.what.push(a.element); }));
  const coRows = [...byCo.values()].map(c => { const sv = dir.find(d => { const a = String(d.company || '').toLowerCase().split(' ')[0]; return a.length > 2 && c.company.toLowerCase().includes(a); }) || {}; return { ...c, sv }; }).sort((a, b) => natural([...a.sys][0] || '', [...b.sys][0] || '') || natural(a.company, b.company));
  dir.forEach(d => { if (!coRows.some(c => c.sv === d)) coRows.push({ company: d.company, sys: new Set(), what: [d.trade || ''], sv: d }); });
  table([{ label: 'System', w: 24, key: c => [...c.sys].map(sysName).join('; ') || c.sv.trade || '' }, { label: 'Contractor', w: 24, key: 'company', bold: true }, { label: 'What they installed', w: 26, key: c => [...new Set(c.what)].slice(0, 4).join('; ') }, { label: 'Contact', w: 26, key: c => [c.sv.name, c.sv.phone, c.sv.afterHours && 'After hours ' + c.sv.afterHours, c.sv.email].filter(Boolean).join(' · ') || `Through ${org}` }], coRows, { size: 8 });
  para(`Contractors are taken from the asset register. Where no direct number is held, arrange the call-out through ${org} or the main contractor.`, { size: 8.5, color: GREY });
  C('What to do if…', 'whatif', 1); h2('What to do if…', 'whatif', { keep: 120 });
  table([{ label: 'Situation', w: 28, key: 0, bold: true }, { label: 'Action', w: 72, key: 1 }], (G.whatIf && G.whatIf.length ? G.whatIf.map(r => Array.isArray(r) ? r : [r.s, r.a]) : DEFAULT_WHATIF), { size: 9 });

  /* ---------- 4 defects and warranties ---------- */
  st('Warranties…');
  C('4  Defects and warranties', 'warr'); h1('4  Defects and warranties', 'warr');
  para(`There are three layers of cover. During the first ${p.dnpMonths || 12} months the Contractor must remedy defects in the works. After that, cover comes from the deeds of warranty given directly to ${p.client || 'the owner'} by the Contractor and its subcontractors, and from manufacturers' product warranties.`, { size: 10.5 });
  h2('4.1  The Defects Notification Period');
  para(`${p.pcDate ? 'Practical Completion was certified at ' + nzDate(p.pcDate) + '.' : 'Practical Completion has not yet been certified.'} The Contractor's defects obligations${p.contract ? ' under the Contract (' + p.contract + ')' : ''} run for ${p.dnpMonths || 12} months from that date${dnpEnd ? ', to ' + nzDate(dnpEnd) : ''}. To report a defect in that period:`);
  bullets(['Record it: location, description, date found and a photograph.', 'Make it safe. For an urgent fault, call the system contractor in Section 3.', `Report it to ${org}'s property team, who log it in Resero Site so it reaches ${p.contractor || 'the Contractor'} through ${p.engineer ? p.engineer + ', the Engineer to the Contract' : 'the Engineer to the Contract'}.`, 'Do not have another contractor repair a defect in the works without agreement. It can prejudice the Contractor\'s obligation to remedy it, and the warranties below.']);
  h2('4.2  After the Defects Notification Period');
  para(`Schedule 13 deeds of warranty are given by ${p.contractor || 'the Contractor'} and each subcontractor directly to ${p.client || 'the owner'}. They cover the workmanship (and in some cases the materials) of that trade for the period stated. Claim directly against the warrantor, quoting the deed. Product warranties are given by the manufacturer or supplier and cover the product itself. Most carry conditions: see Keeping warranties valid.`);
  const deeds = D.filter(d => d.type === 'Warranty (Schedule 13 deed)').sort((a, b) => natural(a.party || a.title, b.party || b.title));
  const expOf = d => { const m = titleMonths(d.title); return d.expiry ? nzDate(d.expiry) : m && p.pcDate ? nzDate(addFreq(p.pcDate, m, 'months')) : m ? 'From Practical Completion' : ''; };
  C('4.3  Schedule 13 deeds of warranty', 'deeds', 1); h2('4.3  Schedule 13 deeds of warranty', 'deeds');
  table([{ label: 'Warrantor', w: 24, key: d => d.party || d.title.split(' - ')[0], bold: true }, { label: 'Deed (opens the document)', w: 40, key: d => d.title.split(' - ').slice(1).join(' - ') || d.title, link: docLink }, { label: 'Period', w: 14, key: d => titlePeriod(d.title) }, { label: 'Expires', w: 14, key: expOf }, { label: 'Section', w: 8, key: d => secNo(d.system), link: d => secNo(d.system) ? '#s' + d.system.slice(0, 2) : '' }], deeds, { size: 8, empty: 'No Schedule 13 deeds are filed yet.' });
  para('Expiry dates assume the warranty period runs from Practical Completion, as the Schedule 13 form provides. Check the deed itself before relying on a date. Deeds noted as unsigned or incomplete in their title are not yet effective.', { size: 8.5, color: GREY });
  C('4.4  Product warranties', 'pw', 1); h2('4.4  Product warranties', 'pw');
  { const rows = []; sysList.forEach(s => { const L = D.filter(d => d.type === 'Warranty (product)' && d.system === s).sort((a, b) => natural(a.title, b.title)); if (L.length) { rows.push({ group: `${secNo(s)}  ${sysName(s)}` }); rows.push(...L); } });
    table([{ label: 'Manufacturer or supplier', w: 26, key: d => d.party || d.title.split(' - ')[0], bold: true }, { label: 'Warranty (opens the document)', w: 54, key: d => d.title.split(' - ').slice(1).join(' - ') || d.title, link: docLink }, { label: 'Period and terms', w: 20, key: d => titlePeriod(d.title) || 'See document' }], rows, { size: 8, empty: 'No product warranties are filed yet.' }); }
  C('4.5  Keeping warranties valid', 'valid', 1); h2('4.5  Keeping warranties valid', 'valid');
  para('Most warranties are conditional. The common conditions are below; the tasks that keep each warranty alive are in the maintenance calendar in Section 6.');
  bullets(['Carry out the maintenance the manufacturer requires, at the stated frequency, and keep a dated record of who did it. Without the record a claim can be declined.', 'Use the installer or an approved agent for repairs while the warranty runs.', 'Do not alter, cut into or add to a warranted element (roofing, cladding, membranes, waterproofing, fire stopping) without the warrantor\'s agreement.', 'Report a suspected failure promptly and in writing. Delay that makes the damage worse is usually excluded.', 'Keep the proof of purchase or the deed. The originals are indexed in Section 9.']);
  const wc = T.filter(t => t.category === 'Warranty condition' || /warranty depends|warranty condition/i.test(t.instructions || ''));
  if (wc.length) table([{ label: 'Task that a warranty depends on', w: 50, key: 'title' }, { label: 'How often', w: 16, key: t => freqText(t) }, { label: 'By', w: 22, key: 'responsible' }, { label: 'Section', w: 12, key: t => secNo(t.system), link: t => secNo(t.system) ? '#s' + t.system.slice(0, 2) : '' }], wc.sort((a, b) => natural(a.system, b.system)), { size: 8 });

  /* ---------- 5 building systems ---------- */
  C('5  Building systems', 'sys'); h1('5  Building systems', 'sys');
  para('One chapter for each building system: who installed it and who to call, what is installed, how it works, what the facilities team does, what not to do, the routine maintenance, and every document held for it.', { size: 10.5 });
  table([{ label: 'Section', w: 10, key: s => secNo(s), bold: true }, { label: 'System', w: 44, key: s => sysName(s), link: s => '#s' + s.slice(0, 2) }, { label: 'Assets', w: 10, key: s => String(A.filter(a => a.system === s).length) }, { label: 'Maintenance tasks', w: 18, key: s => String(T.filter(t => t.system === s || ssHome(t.ss) === s.slice(0, 2)).length) }, { label: 'Documents', w: 18, key: s => String(D.filter(d => d.system === s).length) }], sysList, { size: 9.5 });
  const missing = [];
  for (const s of sysList) {
    const code = s.slice(0, 2), no = secNo(s), nm = sysName(s); st(`${no} ${nm}…`);
    const As = A.filter(a => a.system === s).sort((a, b) => natural(a.ref || '', b.ref || '')), Ts = T.filter(t => t.system === s || ssHome(t.ss) === code), Ds = D.filter(d => d.system === s), Ss = SY.filter(x => ssHome(x.ss) === code), N = G.sys[s] || G.sys[code] || {};
    C(`${no}  ${nm}`, 's' + code, 1); newPage(); anchor('s' + code, y + 6); outline[outline.length - 1].kids.push({ t: `${no}  ${nm}`, pg, y: y + 28 }); text(`${no}  ${nm}`, M, y - 6, 17, fb, NAVY); y -= 34;
    const inst = [...new Set(As.flatMap(a => String(a.installer || '').split(/\s*\/\s*/)).map(x => x.trim()).filter(x => x && !/^\[/.test(x)))], faults = coRows.filter(c => c.sys.has(s) && (c.sv.phone || c.sv.email)).map(c => `${c.company}: ${[c.sv.phone, c.sv.afterHours && 'after hours ' + c.sv.afterHours, c.sv.email].filter(Boolean).join(', ')}`);
    const wd = Ds.filter(d => /^Warranty/.test(d.type));
    kv([['Installed by', inst.join('; ') || 'See the asset register'], ['Faults', N.faults || faults.join('\n') || `Through ${org}${phone ? ', ' + phone : ''}`], ['Warranty', wd.length ? `${wd.filter(d => /Schedule 13/.test(d.type)).length} Schedule 13 deed(s) and ${wd.filter(d => /product/.test(d.type)).length} product warranty document(s) held. See Section 4 and the documents below.` : 'No warranty documents filed for this system yet.'], Ss.length ? ['Specified systems', Ss.map(x => `${x.ss} ${x.name}`).join('; ') + '. These are on the compliance schedule: see Section 7.'] : null], { kw: 22 });
    if (As.length) { h3('What is installed'); table([{ label: 'Item', w: 26, key: 'element', bold: true }, { label: 'Product', w: 30, key: a => String(a.product || '').replace(/\[(CONFIRM|per )[^\]]*\]/gi, 'to be confirmed').replace(/^to be/, 'To be') }, { label: 'Where', w: 18, key: a => String(a.location || '').replace(/\[CONFIRM[^\]]*\]/gi, 'To be confirmed') }, { label: 'Installer', w: 16, key: 'installer' }, { label: 'Warranty', w: 14, key: a => (a.warranties || []).map(w => period(+w.months)).filter(Boolean).join('; ') || [a.instWarranty, a.mfrWarranty].filter(x => x && x !== '-').join('; ') }], As, { size: 8 }); }
    if (N.works) { h3('How it works'); bullets(lines(N.works)); }
    if (N.does) { h3('What the facilities team does'); bullets(lines(N.does)); }
    if (N.dont) { h3('Do not'); bullets(lines(N.dont), { color: hx('#C8282D') }); }
    if (!N.works && !N.does) missing.push(`${no} ${nm}`);
    if (Ts.length) { h3('Routine maintenance'); table([{ label: 'Task', w: 44, key: t => (t.ss && !t.title.startsWith(t.ss) ? t.ss + ' ' : '') + t.title, bold: false }, { label: 'How often', w: 14, key: t => freqText(t) }, { label: 'By', w: 20, key: 'responsible' }, { label: 'Standard or reference', w: 22, key: 'standard' }], Ts.sort((a, b) => natural(a.ss || 'zz', b.ss || 'zz') || natural(a.title, b.title)), { size: 8 }); }
    h3(`Documents (${Ds.length})`);
    if (!Ds.length) para('No documents are filed for this system yet.', { it: true, color: GREY });
    else { para('Click a title to open the document.', { size: 8.5, color: GREY, after: 2 }); const rows = [];
      TYPE_ORDER.concat([...new Set(Ds.map(d => d.type))].filter(t => !TYPE_ORDER.includes(t))).forEach(t => { const L = Ds.filter(d => d.type === t).sort((a, b) => natural(a.title, b.title)); if (!L.length) return;
        if (L.length > 14 && /Commissioning|Inspection/.test(t)) { rows.push({ group: `${TYPE_HEAD[t] || t} (${L.length})` }); rows.push({ title: `${L.length} records, mostly site photographs and test sheets. They are listed in the document index.`, sum: true }); return; }
        rows.push({ group: `${TYPE_HEAD[t] || t} (${L.length})` }); rows.push(...L); });
      table([{ label: 'Document', w: 78, key: 'title', link: d => d.sum ? '#index' : docLink(d) }, { label: 'From', w: 22, key: d => d.sum ? '' : d.party || '' }], rows, { size: 8, noHead: true, plain: true }); }
  }
  if (opt.fmPages && opt.fmPages.length) { C('Site notes for the facilities team', 'fmpages', 1); h2('Site notes for the facilities team', 'fmpages', { keep: 400 }); para('Marked-up pages kept in the Home guide for the facilities team only.', { size: 8.5, color: GREY });
    for (const im0 of opt.fmPages) { const im = await doc.embedJpg(im0), hh = 330, ww = hh * im.width / im.height; need(hh + 12); pg.drawImage(im, { x: M, y: y - hh + 8, width: ww, height: hh }); pg.drawRectangle({ x: M, y: y - hh + 8, width: ww, height: hh, borderColor: LINE, borderWidth: 0.6 }); y -= hh + 12; } }

  /* ---------- 6 planned maintenance ---------- */
  st('Maintenance calendar…');
  C('6  Planned maintenance', 'maint'); h1('6  Planned maintenance', 'maint');
  para('Planned maintenance keeps the building working, keeps the warranties alive and keeps the Building Warrant of Fitness current. The calendar on the following pages sets out every task for twelve months, who does it and in which month.', { size: 10.5 });
  h2('Service agreements to put in place');
  para(`These are the recurring services ${org} needs to have arranged. One contractor can hold several of them.`);
  { const m = new Map(); T.forEach(t => { const k = (t.responsible || 'To be assigned').trim(); if (!m.has(k)) m.set(k, []); m.get(k).push(t); });
    table([{ label: 'Provider', w: 24, key: 0, bold: true }, { label: 'Services', w: 48, key: 1 }, { label: 'Frequency', w: 14, key: 2 }, { label: 'Tasks', w: 6, key: 3 }, { label: 'BWoF', w: 8, key: 4 }], [...m.entries()].sort((a, b) => natural(a[0], b[0])).map(([k, L]) => [k, [...new Set(L.map(t => sysName(SYSTEMS.find(s => s.startsWith(ssHome(t.ss) || t.system.slice(0, 2))) || t.system)))].join('; '), [...new Set(L.map(t => freqText(t).replace(/^Every /, '')))].join(', '), String(L.length), L.some(t => t.ss) ? 'Yes' : '']), { size: 8.5 }); }
  // the calendar, landscape
  const start = new Date((p.pcDate || todayISO()) + 'T00:00'); start.setDate(1); start.setMonth(start.getMonth() + 1);
  const months = Array.from({ length: 12 }, (_, i) => { const d = new Date(start); d.setMonth(start.getMonth() + i); return d; }), mk = d => d.getFullYear() * 12 + d.getMonth();
  const due = (t, i) => { const n = +t.freqN || 0, u = t.freqUnit; if (!n) return t.nextDue ? mk(new Date(t.nextDue + 'T00:00')) === mk(months[i]) : false; if (u === 'weeks') return true; const every = u === 'years' ? n * 12 : n; if (every <= 1) return true;
    const first = t.nextDue ? mk(new Date(t.nextDue + 'T00:00')) - mk(months[0]) : every - 1; return i % every === ((first % every) + every) % every; };
  C('Twelve-month maintenance calendar', 'cal', 1); h1('Twelve-month maintenance calendar', 'cal', true); outline.pop(); outline[outline.length - 1].kids.push({ t: 'Twelve-month maintenance calendar', pg, y: y + 60 });
  para(`${T.length} tasks from the maintenance schedule in Resero Site. Month 1 is ${months[0].toLocaleDateString('en-NZ', { month: 'long', year: 'numeric' })}${p.pcDate ? ', the first full month after Practical Completion' : ' (Practical Completion is not yet certified, so the calendar starts next month)'}. A filled block marks a month in which the task is due. Tasks with a specified system number are part of the Building Warrant of Fitness.`, { size: 8.5 });
  { const rows = []; sysList.concat(SYSTEMS.filter(s => /^14 /.test(s))).forEach(s => { const L = T.filter(t => t.system === s).sort((a, b) => natural(a.ss || 'zz', b.ss || 'zz') || natural(a.title, b.title)); if (L.length) { rows.push({ group: /^14 /.test(s) ? '7  Compliance schedule and Building Warrant of Fitness' : `${secNo(s)}  ${sysName(s)}` }); rows.push(...L); } });
    table([{ label: 'Task', w: 40, key: 'title' }, { label: 'Frequency', w: 11, key: t => freqText(t).replace(/^Every /, '') }, { label: 'By', w: 17, key: 'responsible' }, ...months.map((d, i) => ({ label: d.toLocaleDateString('en-NZ', { month: 'short' }), w: 4.2, key: () => '', draw: (t, x, yy, cw, rh, lh) => { if (t.group || !due(t, i)) return; pg.drawRectangle({ x: x + 3, y: yy - 2, width: cw - 6, height: lh - 1, color: t.ss ? NAVY : TEAL }); } }))], rows, { size: 7.5 }); }

  /* ---------- 7 compliance ---------- */
  st('Compliance…');
  C('7  Compliance', 'comp'); h1('7  Compliance', 'comp');
  h2('7.1  Consent record');
  { const cd = D.filter(d => d.type === 'Consent / authority document' && /building consent -|code compliance|resource consent \(|final inspection|compliance schedule|specified systems|minor variation|practical completion/i.test(d.title)).sort((a, b) => natural(a.title, b.title));
    kv([['Building consent', p.consent], ['Practical Completion', p.pcDate ? nzDate(p.pcDate) : 'To be certified'], ['Code Compliance Certificate', p.cccDate ? nzDate(p.cccDate) : 'Date not recorded in Resero Site: see the documents below']]);
    if (cd.length) table([{ label: 'Consent and authority documents (click to open)', w: 100, key: 'title', link: docLink }], cd, { size: 8.5 }); }
  C('7.2  Building Warrant of Fitness and specified systems', 'bwof', 1); h2('7.2  Building Warrant of Fitness and specified systems', 'bwof');
  para(`The building has a compliance schedule${p.csNumber ? ' (' + p.csNumber + ')' : ''} listing its specified systems. Under the Building Act 2004 the owner must:`);
  bullets(['Have each specified system inspected, tested and maintained as the compliance schedule requires, and keep written records of every inspection, test and repair for at least two years.', 'Obtain a Form 12A certificate from an Independent Qualified Person (IQP) for each system every year.', 'Sign the Building Warrant of Fitness (Form 12) each year on the anniversary of the compliance schedule, display it where the public can see it, and give a copy with the Form 12As to Auckland Council.', 'Keep the compliance schedule and the last two years of records in the building, or tell Council where they are kept.', `${p.bwofDue ? 'The next Building Warrant of Fitness is due ' + nzDate(p.bwofDue) + '.' : 'The first Building Warrant of Fitness is due twelve months after the compliance schedule is issued.'}${p.iqp ? ' IQP: ' + p.iqp + '.' : ''}`]);
  table([{ label: 'Ref', w: 9, key: 'ss', bold: true }, { label: 'Specified system', w: 23, key: 'name' }, { label: 'Where', w: 18, key: a => String(a.location || '').replace(/\[CONFIRM[^\]]*\]/gi, 'To be confirmed') }, { label: 'Performance standard', w: 22, key: 'standard' }, { label: 'Inspection, maintenance and reporting', w: 28, key: 'inspections' }], SY, { size: 8, empty: 'The specified systems have not been entered in Resero Site yet.' });
  note('Missing a BWoF is an offence', 'An owner who fails to supply or display a Building Warrant of Fitness, or to follow the compliance schedule, can be fined. Engage the IQP well before the first anniversary so the monthly owner inspections and the annual IQP inspections are in place from Practical Completion.', AMBER);
  if (G.comply) { C('7.3  Other duties', 'duties', 1); h2('7.3  Other duties', 'duties'); bullets(lines(G.comply)); }
  { const cc = D.filter(d => /^00 /.test(d.system || '') && d.type === 'Contract document').sort((a, b) => natural(a.title, b.title)); if (cc.length) { C('Contract documents', 'contract', 1); h2('Contract documents', 'contract'); table([{ label: 'Document (click to open)', w: 100, key: 'title', link: docLink }], cc.slice(0, 60), { size: 8 }); } }

  /* ---------- 8 residents ---------- */
  if (opt.resPages && opt.resPages.length) { st('Resident pages…');
    C('8  What residents have been told', 'res'); h1('8  What residents have been told', 'res');
    para(`Each resident has a Home User Guide: one topic a page, in plain words, with photographs. The pages are shown here so the facilities team knows what residents have been asked to do, and what they have been told to call ${org} about.`, { size: 10.5 });
    const cols = 4, gap = 10, cw = (W - 2 * M - gap * (cols - 1)) / cols; let i = 0;
    for (const r of opt.resPages) { const im = await doc.embedJpg(r.jpg), hh = cw * im.height / im.width; if (i % cols === 0) need(hh + 26); const x = M + (i % cols) * (cw + gap); pg.drawImage(im, { x, y: y - hh, width: cw, height: hh }); pg.drawRectangle({ x, y: y - hh, width: cw, height: hh, borderColor: LINE, borderWidth: 0.6 }); wrap(r.title, f, 7, cw).slice(0, 1).forEach(l => text(l, x, y - hh - 9, 7, f, GREY)); i++; if (i % cols === 0) y -= hh + 22; }
    if (i % cols) y -= cw * 1.414 + 22; }

  /* ---------- 9 index ---------- */
  st('Document index…');
  C('9  Document index A to Z', 'index'); h1('9  Document index A to Z', 'index');
  para(`${D.length} documents. Click a title to open it. The section number links to the system chapter the document belongs to.`, { size: 9 });
  { const rows = []; let last = ''; D.slice().sort((a, b) => natural(a.title || '', b.title || '')).forEach(d => { const L = (clean(d.title || '').trim()[0] || '#').toUpperCase(), g = /[A-Z]/.test(L) ? L : '0-9'; if (g !== last) { rows.push({ group: g }); last = g; } rows.push(d); });
    table([{ label: 'Document', w: 62, key: 'title', link: docLink }, { label: 'Type', w: 26, key: d => (d.type || '').replace(/\s*\(.*\)/, m => /deed|product/.test(m) ? m : '') }, { label: 'Section', w: 12, key: d => secNo(d.system) || (/^00 /.test(d.system || '') ? '7' : /^14 /.test(d.system || '') ? '7.2' : ''), link: d => secNo(d.system) ? '#s' + d.system.slice(0, 2) : /^(00|14) /.test(d.system || '') ? '#comp' : '' }], rows, { size: 7.5 }); }

  /* ---------- 10 open items ---------- */
  C('10  Items to close', 'open'); h1('10  Items to close', 'open');
  para('What was still open in Resero Site when this guide was made. Make the guide again once these are closed.', { size: 10.5 });
  { const nr = A.filter(a => !/^(Received)$/i.test(a.status || '')), conf = A.filter(a => /\[CONFIRM/i.test([a.product, a.location, a.installer].join(' ')));
    const rows = [[!p.pcDate, 'Practical Completion date is not set, so warranty expiry dates and the end of the defects period cannot be shown.'], [!p.cccDate, 'Code Compliance Certificate date is not recorded.'], [!p.csNumber, 'Compliance schedule number is not recorded.'], [!p.bwofDue, 'Building Warrant of Fitness due date is not recorded.'], [!phone, 'Owner\'s contact number for faults is not set.'], [coRows.filter(c => !(c.sv.phone || c.sv.email)).length, `${coRows.filter(c => !(c.sv.phone || c.sv.email)).length} system contractors have no phone number or email held (Contacts).`], [missing.length, `How it works and what the facilities team does are not yet written for: ${missing.join('; ')}.`], [conf.length, `${conf.length} assets have details still to be confirmed: ${conf.map(a => a.element).slice(0, 14).join('; ')}${conf.length > 14 ? '…' : ''}.`], [nr.length, `${nr.length} of ${A.length} asset records do not yet show their handover documents as received.`], [deeds.filter(d => /unsigned|incomplete|misnamed/i.test(d.title)).length, `${deeds.filter(d => /unsigned|incomplete|misnamed/i.test(d.title)).length} Schedule 13 deeds are noted as unsigned or incomplete.`]].filter(r => r[0]).map(r => r[1]);
    if (rows.length) bullets(rows); else para('Nothing is open.');
    if (nr.length) { h2('Handover documents not yet received'); table([{ label: 'Ref', w: 9, key: 'ref', bold: true }, { label: 'Item', w: 33, key: 'element' }, { label: 'System', w: 28, key: a => sysName(a.system), link: a => secNo(a.system) ? '#s' + a.system.slice(0, 2) : '' }, { label: 'Installer', w: 18, key: 'installer' }, { label: 'Status', w: 12, key: 'status' }], nr.sort((a, b) => natural(a.system, b.system) || natural(a.ref || '', b.ref || '')), { size: 8 }); } }

  /* ---------- contents page, page numbers, links, bookmarks ---------- */
  st('Finishing…');
  const pageNo = pgx => pages.findIndex(x => x.pg === pgx) + 1;
  { pg = contentsPg; W = A4[0]; H = A4[1]; let yy = H - 62 - 50; const rh = Math.min(19, (yy - M - 30) / contentsRows.length);
    contentsRows.forEach(r => { const a = anchors[r.id], sz = r.lvl ? Math.min(9.5, rh * 0.6) : Math.min(11, rh * 0.68), font = r.lvl ? f : fb, x = M + (r.lvl ? 16 : 0); text(r.t, x, yy, sz, font, r.lvl ? TXT : NAVY); const n = a ? String(pageNo(a.pg)) : ''; text(n, W - M - tw(n, font, sz), yy, sz, font, r.lvl ? TXT : NAVY);
      const x0 = x + tw(r.t, font, sz) + 6, x1 = W - M - tw(n, font, sz) - 6; if (x1 > x0) pg.drawLine({ start: { x: x0, y: yy + 2 }, end: { x: x1, y: yy + 2 }, thickness: 0.5, color: LINE, dashArray: [1, 3] });
      links.push({ pg, r: [M, yy - 3, W - M, yy + sz], anchor: r.id }); yy -= rh; }); }
  pages.forEach((x, i) => { if (x.cover) return; const t = `${org} · Facilities Guide · ${date}`; x.pg.drawLine({ start: { x: M, y: M - 6 }, end: { x: x.W - M, y: M - 6 }, thickness: 0.5, color: LINE }); x.pg.drawText(clean(t), { x: M, y: M - 18, size: 7.5, font: f, color: GREY }); const n = String(i + 1); x.pg.drawText(n, { x: x.W / 2 - f.widthOfTextAtSize(n, 8) / 2, y: M - 18, size: 8, font: fb, color: GREY }); const r = `Prepared by ${APP.company}`; x.pg.drawText(r, { x: x.W - M - f.widthOfTextAtSize(r, 7.5), y: M - 18, size: 7.5, font: f, color: GREY }); });
  const ctx = doc.context, annot = (page, dict) => { const ref = ctx.register(ctx.obj(dict)); let an = page.node.lookup(P.PDFName.of('Annots')); if (!an) { an = ctx.obj([]); page.node.set(P.PDFName.of('Annots'), an); } an.push(ref); };
  const dest = a => [a.pg.ref, P.PDFName.of('XYZ'), P.PDFNull, P.PDFNumber.of(a.y), P.PDFNull];
  links.forEach(l => { if (l.anchor) { const a = anchors[l.anchor]; if (a) annot(l.pg, { Type: 'Annot', Subtype: 'Link', Rect: l.r, Border: [0, 0, 0], Dest: dest(a) }); } else if (/^https?:/i.test(l.url || '')) annot(l.pg, { Type: 'Annot', Subtype: 'Link', Rect: l.r, Border: [0, 0, 0], A: { Type: 'Action', S: 'URI', URI: P.PDFString.of(l.url) } }); });
  // bookmarks
  { const rootRef = ctx.nextRef(), mk2 = (items, parentRef) => { const refs = items.map(() => ctx.nextRef()); items.forEach((it, i) => { const d = { Title: P.PDFHexString.fromText(clean(it.t)), Parent: parentRef, Dest: dest(it) }; if (i) d.Prev = refs[i - 1]; if (i < items.length - 1) d.Next = refs[i + 1]; if (it.kids && it.kids.length) { const k = mk2(it.kids, refs[i]); d.First = k[0]; d.Last = k[k.length - 1]; d.Count = -it.kids.length; } ctx.assign(refs[i], ctx.obj(d)); }); return refs; };
    const top = mk2(outline, rootRef); ctx.assign(rootRef, ctx.obj({ Type: 'Outlines', First: top[0], Last: top[top.length - 1], Count: top.length })); doc.catalog.set(P.PDFName.of('Outlines'), rootRef); doc.catalog.set(P.PDFName.of('PageMode'), P.PDFName.of('UseOutlines')); }
  doc.setTitle(clean(`${p.name} - Facilities Guide`)); doc.setAuthor(APP.company); doc.setProducer(APP.name);
  return new Blob([await doc.save()], { type: 'application/pdf' });
}

/* ---------- the words about each system: kept on the project, edited here ---------- */
export function notesDialog(X) {
  const p = S.project, G = JSON.parse(JSON.stringify(cfgOf(p))), list = SYS_LIST(); let cur = list[0];
  const wi = () => (G.whatIf && G.whatIf.length ? G.whatIf.map(r => Array.isArray(r) ? r : [r.s, r.a]) : DEFAULT_WHATIF).map(r => r.join(' | ')).join('\n');
  const esc = t => String(t || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  X.modal(`<h2>Facilities guide notes</h2><p class="note">The Facilities Guide takes its registers, contacts, maintenance and documents from the app. These are the words only a person can supply: how each system works, what the team does and what not to do. One point per line.</p>
    <label class="f">Building system<select id="fnS">${list.map(s => `<option value="${esc(s)}">${esc(s)}${(G.sys[s] || {}).works ? ' ✓' : ''}</option>`).join('')}</select></label>
    <label class="f full">How it works<textarea id="fnW" rows="5"></textarea></label>
    <label class="f full">What the facilities team does<textarea id="fnD" rows="5"></textarea></label>
    <label class="f full">Do not<textarea id="fnN" rows="3"></textarea></label>
    <label class="f full">Faults: who to call (leave blank to use the contacts)<input id="fnF"></label>
    <details style="margin-top:10px"><summary><b>Whole-building notes</b></summary>
      <label class="f full">About the building (Section 2)<textarea id="fnG" rows="4">${esc(G.glance)}</textarea></label>
      <label class="f full">What to do if… (Section 3). One per line: Situation | Action<textarea id="fnI" rows="8">${esc(wi())}</textarea></label>
      <label class="f full">Other compliance duties (Section 7)<textarea id="fnC" rows="4">${esc(G.comply)}</textarea></label></details>
    <div class="act"><button id="fnEx">⬇ Notes (.json)</button><button id="fnIm">⬆ Import notes</button><input type="file" id="fnFile" accept=".json" hidden><span style="flex:1"></span><button id="fnX">Cancel</button><button class="go" id="fnOk">Save</button></div>`, true);
  const $ = id => document.getElementById(id);
  const put = () => { const n = G.sys[cur] || {}; $('fnW').value = n.works || ''; $('fnD').value = n.does || ''; $('fnN').value = n.dont || ''; $('fnF').value = n.faults || ''; };
  const take = () => { const n = { works: $('fnW').value.trim(), does: $('fnD').value.trim(), dont: $('fnN').value.trim(), faults: $('fnF').value.trim() }; if (n.works || n.does || n.dont || n.faults) G.sys[cur] = n; else delete G.sys[cur];
    G.glance = $('fnG').value.trim(); G.comply = $('fnC').value.trim(); const w = $('fnI').value.split('\n').map(l => l.split('|').map(x => x.trim())).filter(r => r[0] && r[1]).map(r => [r[0], r.slice(1).join(' | ')]); G.whatIf = JSON.stringify(w) === JSON.stringify(DEFAULT_WHATIF) ? null : w.map(r => ({ s: r[0], a: r[1] })); };
  put(); $('fnS').onchange = e => { take(); cur = e.target.value; put(); };
  $('fnX').onclick = X.closeModal;
  $('fnOk').onclick = async () => { take(); try { await S.store.updateProject(p.id, { fmGuide: G }); S.project.fmGuide = G; X.closeModal(); X.toast('Facilities guide notes saved'); } catch (e) { X.toast('Could not save: ' + e.message, 7000); } };
  $('fnEx').onclick = () => { take(); X.deliver(new Blob([JSON.stringify({ app: 'resero-fm-notes', version: 1, project: p.name, fmGuide: G }, null, 2)], { type: 'application/json' }), `${p.name} - facilities guide notes.json`, 'Notes'); };
  $('fnIm').onclick = () => $('fnFile').click();
  $('fnFile').onchange = async e => { const fl = e.target.files[0]; if (!fl) return; try { const j = JSON.parse(await fl.text()); if (j.app !== 'resero-fm-notes' || !j.fmGuide) return X.toast('That is not a facilities guide notes file'); Object.assign(G, j.fmGuide, { sys: { ...G.sys, ...(j.fmGuide.sys || {}) } }); put(); $('fnG').value = G.glance || ''; $('fnC').value = G.comply || ''; $('fnI').value = wi(); [...$('fnS').options].forEach(o => o.textContent = o.value + ((G.sys[o.value] || {}).works ? ' ✓' : '')); X.toast('Notes loaded. Check them, then press Save.', 5000); } catch (x) { X.toast('That file could not be read'); } };
}
