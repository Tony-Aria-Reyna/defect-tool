// Exports: PDF schedule (pdf-lib, both brands, linked), Excel register, Procore CSV, zip of everything.
import { natural, loadScript, nzDate, todayISO, safeName, stamp } from './util.js';
import { STATUS_COLOURS as SCOL, APP } from './config.js';

const LIB = { pdflib: 'lib/pdf-lib.min.js', jszip: 'lib/jszip.min.js', xlsx: 'lib/xlsx.bundle.js' };
export const locText = d => { const a = []; if (d.block) a.push(/^(site|external)/i.test(d.block) ? d.block : 'Block ' + d.block); if (d.level) a.push(/^(ground|first|second|third|basement|level)/i.test(d.level) && !/floor|level/i.test(d.level) ? d.level + ' floor' : d.level); if (d.unit) a.push('Unit ' + d.unit); if (d.room) a.push(d.room); if (d.surface && d.surface !== 'Floor') a.push(d.surface); if (d.item) a.push(d.item); return a.join(', '); };
// Pin label: a letter for who raised it, then the number. Items raised in this app carry the project's own ID prefix and show R (Resero);
// imported consultant items show the first letter of their prefix (MM-308 shows M308).
let OWN_PREFIX = 'D', PRJ = {}; export const setProjectCtx = p => { PRJ = p || {}; OWN_PREFIX = String(PRJ.idPrefix || 'D').toUpperCase(); };
export const pinLabel = d => { const m = /^([A-Za-z]+)-0*(.*)$/.exec(String(d.id)); if (!m) return String(d.id); const pre = m[1].toUpperCase(); return (pre === OWN_PREFIX ? 'R' : pre === 'MM' ? 'M' : pre.slice(0, 2)) + (m[2] || '0'); };

function clean(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/—/g, ', ').replace(/→/g, '->').replace(/[^\n\x20-\x7e\xa0-\xff€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–˜™š›œžŸ]/g, ''); }
const hex = h => { const n = parseInt(h.slice(1), 16); return PDFLib.rgb((n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255); };

async function embedAny(doc, bytes) { const b = new Uint8Array(bytes); if (b[0] === 0x89 && b[1] === 0x50) return doc.embedPng(b); return doc.embedJpg(b); }

// Wall sheets: one A4 page (or more) per unit, plus common areas grouped by block and level, open items only, with tick boxes for
// the subcontractor (done), the main contractor (accepted) and, for Maynard Marks items, their sign-off. Made to print and pin up.
const recentPhotos = d => { const out = []; histSorted(d).forEach(h => (h.photos || []).forEach(p => p.url && out.push(p))); (d.photos || []).filter(p => p.url).slice().reverse().forEach(p => out.push(p)); return out; };
export async function buildUnitSheets(L, ctx, st = () => {}, o = {}) {
  if (!window.PDFLib) { st('Loading the PDF tools…'); await loadScript(LIB.pdflib); }
  const P = PDFLib, doc = await P.PDFDocument.create(), pr = ctx.project, f = await doc.embedFont(P.StandardFonts.Helvetica), fb = await doc.embedFont(P.StandardFonts.HelveticaBold);
  const W = 595.28, H = 841.89, M = 28, NAVY = hex('#011C35'), GREY = hex('#6a7886'), LINE = hex('#c9d0d8');
  const logo = async u => { try { return u ? await embedAny(doc, await ctx.getBytes(u)) : null; } catch (e) { return null; } };
  const res = await logo(ctx.logoResero), cli = await logo(pr.clientLogo), conL = await logo(pr.contractorLogo);
  const con = pr.contractor || 'Contractor', own = new Set(pr.selfCloseSources || []), needsCons = d => !own.has(d.source);
  const groups = {}; L.forEach(d => { const k = d.unit ? 'Unit ' + d.unit : 'Common areas' + (d.block ? ', ' + (/^(site|external)/i.test(d.block) ? d.block : 'Block ' + d.block) : '') + (d.level ? ', ' + d.level : ''); (groups[k] = groups[k] || []).push(d); });
  const keys = Object.keys(groups).sort((a, b) => (a.startsWith('Unit') ? 0 : 1) - (b.startsWith('Unit') ? 0 : 1) || natural(a, b));
  const wrap = (t, font, size, maxw) => { const out = []; clean(t).split('\n').forEach(par => { let ln = ''; par.split(/\s+/).forEach(w => { const tr = ln ? ln + ' ' + w : w; if (font.widthOfTextAtSize(tr, size) <= maxw) ln = tr; else { if (ln) out.push(ln); ln = w; } }); if (ln) out.push(ln); }); return out; };
  const T = (pg, t, x, y, s, font, c) => pg.drawText(clean(t), { x, y, size: s, font: font || f, color: c || hex('#18232f') });
  const planImg = {}, getPlan = async p => planImg[p.id] || (planImg[p.id] = await embedAny(doc, await ctx.getBytes(p.img)));
  // thumbnail of the first photo, and a crop of the plan around the pin
  const photo = async (pg, d, x, y, w, h) => { const p = recentPhotos(d)[0]; if (!p) return; try { const im = await embedAny(doc, await ctx.getBytes(p.url)); const s = Math.min(w / im.width, h / im.height); pg.drawImage(im, { x: x + (w - im.width * s) / 2, y: y + (h - im.height * s) / 2, width: im.width * s, height: im.height * s }); } catch (e) {} };
  const where = async (pg, d, x, y, w, h) => { const pl = d.plan && d.x != null && ctx.plans.find(p => p.id === d.plan); if (!pl) return; try { const im = await getPlan(pl), z = pl.kind === 'elevation' ? 5 : 6, sc = Math.min(w / (im.width / z), h / (im.height / z)), cw = w / sc, ch = h / sc;
      let cx = d.x * im.width - cw / 2, cy = d.y * im.height - ch / 2; cx = Math.max(0, Math.min(im.width - cw, cx)); cy = Math.max(0, Math.min(im.height - ch, cy));
      pg.pushOperators(P.pushGraphicsState(), P.rectangle(x, y, w, h), P.clip(), P.endPath()); pg.drawImage(im, { x: x - cx * sc, y: y - (im.height - cy - ch) * sc, width: im.width * sc, height: im.height * sc }); pg.pushOperators(P.popGraphicsState());
      pg.drawCircle({ x: x + (d.x * im.width - cx) * sc, y: y + h - (d.y * im.height - cy) * sc, size: 5, color: hex('#e53935'), borderColor: P.rgb(1, 1, 1), borderWidth: 1 }); pg.drawRectangle({ x, y, width: w, height: h, borderColor: LINE, borderWidth: 0.5 }); } catch (e) {} };
  const C = [['Ref', 40], ['Room', 50], ['Item', 212], ['Subcontractor', 60], ['Photo', 62], ['Sub done', 37], [con.split(' ')[0] + ' OK', 37], ['Consultant sign-off', 41]];
  for (const k of keys) {
    const items = groups[k].sort((a, b) => String(a.room || '').localeCompare(String(b.room || '')) || natural(a.id, b.id)); let pg, y, page = 0; st('Building ' + k + '…');
    const head = noTable => { pg = doc.addPage([W, H]); page++;
      // logos: Resero left, then client and contractor on the right
      // every logo gets the same area, so a wide wordmark and a square badge look the same weight; all sit on one centre line
      const fit = im => { const ar = im.width / im.height; let h = Math.sqrt(2400 / ar); h = Math.min(h, 40); let w = h * ar; if (w > 140) { w = 140; h = w / ar; } return { w, h }; }, mid = H - M - 18;
      if (res) { const z = fit(res); pg.drawImage(res, { x: M, y: mid - z.h / 2, width: z.w, height: z.h }); }
      let rx = W - M; [conL, cli].forEach(im => { if (!im) return; const z = fit(im); rx -= z.w; pg.drawImage(im, { x: rx, y: mid - z.h / 2, width: z.w, height: z.h }); rx -= 18; });
      T(pg, k, M, H - M - 58, 26, fb, NAVY); T(pg, (pr.name || '') + '  |  Open items at ' + nzDate(todayISO()) + '  |  ' + items.length + ' item' + (items.length === 1 ? '' : 's') + (page > 1 ? '  |  page ' + page : ''), M, H - M - 74, 9.5, f, GREY);
      T(pg, 'Subcontractor: tick and initial when complete. ' + con + ': tick when accepted. Consultant: tick when signed off.', M, H - M - 88, 8, f, GREY);
      y = H - M - 104; if (noTable) return; pg.drawRectangle({ x: M, y: y - 12, width: W - 2 * M, height: 24, color: NAVY }); let cx = M + 3; C.forEach(([h, w]) => { wrap(h, fb, 7, w - 4).slice(0, 2).forEach((l, i) => T(pg, l, cx, y + 3 - i * 8.5, 7, fb, hex('#ffffff'))); cx += w; }); y -= 14; };
    head();
    for (const d of items) {
      const lm = o.comments === false ? null : latestMove(d), cl = lm && lm.text ? wrap('Latest ' + nzDate(String(lm.when || '').slice(0, 10)) + (lm.who ? ' ' + lm.who : '') + ': ' + lm.text, fb, 7, C[2][1] - 6) : [];
      const lines = wrap((d.title || '') + (d.desc && d.desc !== d.title ? ': ' + d.desc : ''), f, 7.5, C[2][1] - 6), rl = wrap(d.room || '', f, 7.5, C[1][1] - 4).slice(0, 3), sl = wrap(d.subcontractor || d.responsible || '', f, 7.5, C[3][1] - 4).slice(0, 3);
      const hasPh = recentPhotos(d).length > 0, h = Math.max(hasPh ? 60 : 24, 12 + Math.max(lines.length * 9.5 + (cl.length ? 5 + cl.length * 8.5 : 0), rl.length * 9.5, sl.length * 9.5));
      if (y - h < M + 30) head();
      let cx = M + 3; T(pg, d.id, cx, y - 11, 8, fb); cx += C[0][1]; rl.forEach((l, i) => T(pg, l, cx, y - 11 - i * 9.5, 7.5)); cx += C[1][1]; lines.forEach((l, i) => T(pg, l, cx, y - 11 - i * 9.5, 7.5)); cl.forEach((l, i) => T(pg, l, cx, y - 16 - lines.length * 9.5 - i * 8.5, 7, fb, hex('#a32222'))); cx += C[2][1]; sl.forEach((l, i) => T(pg, l, cx, y - 11 - i * 9.5, 7.5)); cx += C[3][1];
      await photo(pg, d, cx - 1, y - h + 4, C[4][1] - 4, h - 8); cx += C[4][1];
      [0, 1, 2].forEach(i => { const w = C[5 + i][1]; if (i === 2 && !needsCons(d)) T(pg, 'n/a', cx + w / 2 - 8, y - h / 2 - 3, 7, f, GREY); else pg.drawRectangle({ x: cx + w / 2 - 10, y: y - h / 2 - 8, width: 16, height: 16, borderColor: NAVY, borderWidth: 1 }); cx += w; });
      y -= h; pg.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: LINE });
    }
    // the unit (or area) cut from its floor plan, its boundary marked, every item's pin labelled
    { const pinned = items.filter(d => d.plan && d.x != null), byPlan = {}; pinned.forEach(d => { byPlan[d.plan] = (byPlan[d.plan] || 0) + 1; });
      const nu = v => String(v || '').toLowerCase().replace(/unit|\s/g, ''), uk = k.startsWith('Unit ') ? nu(k.slice(5)) : null;
      let pl = null, zone = null;
      if (uk) for (const p of ctx.plans) { const z = (p.zones || []).find(z => z.kind === 'unit' && z.poly && z.poly.length > 2 && (nu(z.unit) === uk || nu(z.name) === uk)); if (z && (!pl || (byPlan[p.id] || 0) > (byPlan[pl.id] || 0))) { pl = p; zone = z; } }
      if (!pl) { const top = Object.entries(byPlan).sort((a, b) => b[1] - a[1])[0]; pl = top && ctx.plans.find(p => p.id === top[0]); }
      if (pl && pl.kind !== 'elevation') try {
        const im = await getPlan(pl), pts = zone ? zone.poly : pinned.filter(d => d.plan === pl.id).map(d => [d.x, d.y]);
        let x0 = Math.min(...pts.map(q => q[0])), x1 = Math.max(...pts.map(q => q[0])), y0 = Math.min(...pts.map(q => q[1])), y1 = Math.max(...pts.map(q => q[1]));
        const pad = zone ? 0.003 : Math.max(0.01, (x1 - x0) * 0.06, (y1 - y0) * 0.06); x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(1, x1 + pad); y1 = Math.min(1, y1 + pad);
        const cwp = (x1 - x0) * im.width, chp = (y1 - y0) * im.height, boxW = (W - 2 * M) * 0.62, maxH = 240;
        let sc = Math.min(boxW / cwp, maxH / chp); const dw = cwp * sc, dh = chp * sc;
        if (y - dh - 30 < M + 22) head(true);
        const bx = M + (W - 2 * M - dw) / 2, by = y - 22 - dh; T(pg, 'Where the items are' + (pl.code || pl.name ? ' (' + (pl.code || pl.name) + ')' : ''), M, y - 14, 9, fb, NAVY);
        pg.pushOperators(P.pushGraphicsState(), P.rectangle(bx, by, dw, dh), P.clip(), P.endPath()); pg.drawImage(im, { x: bx - x0 * im.width * sc, y: by - (1 - y1) * im.height * sc, width: im.width * sc, height: im.height * sc }); pg.pushOperators(P.popGraphicsState());
        const tp = q => [bx + (q[0] - x0) * im.width * sc, by + dh - (q[1] - y0) * im.height * sc];
        if (zone) { const z = zone.poly.map(tp); for (let i = 0; i < z.length; i++) { const a = z[i], b = z[(i + 1) % z.length]; pg.drawLine({ start: { x: a[0], y: a[1] }, end: { x: b[0], y: b[1] }, thickness: 1.6, color: hex('#e53935'), dashArray: [5, 3] }); } }
        pg.drawRectangle({ x: bx, y: by, width: dw, height: dh, borderColor: LINE, borderWidth: 0.6 });
        pinned.filter(d => d.plan === pl.id).forEach(d => { const [px, py] = tp([d.x, d.y]), lab = clean(pinLabel(d)), tw = fb.widthOfTextAtSize(lab, 7) + 8;
          pg.drawCircle({ x: px, y: py, size: 4, color: hex('#e53935'), borderColor: P.rgb(1, 1, 1), borderWidth: 1 }); pg.drawRectangle({ x: px - tw / 2, y: py + 6, width: tw, height: 11, color: hex('#e53935') }); T(pg, lab, px - tw / 2 + 4, py + 9, 7, fb, P.rgb(1, 1, 1)); });
        y = by - 6;
      } catch (e) { console.warn('unit plan', e); } }
    T(pg, 'Unit signed off: ____________________   Date: __________', M, M + 6, 9, fb, NAVY);
  }
  if (!keys.length) { const pg = doc.addPage([W, H]); T(pg, 'No open items.', M, H - 80, 14, fb); }
  return new Blob([await doc.save()], { type: 'application/pdf' });
}

// ctx: {project, plans, getBytes(url) -> ArrayBuffer, logoResero (url)}
export async function buildPdf(L, o, ctx, st = () => {}) {
  if (!window.PDFLib) { st('Loading the PDF tools…'); await loadScript(LIB.pdflib); }
  const P = PDFLib, doc = await P.PDFDocument.create(), pr = ctx.project;
  const f = await doc.embedFont(P.StandardFonts.Helvetica), fb = await doc.embedFont(P.StandardFonts.HelveticaBold);
  const NAVY = hex('#011C35'), TEAL = hex('#3bafbe'), GREY = hex('#6a7886'), LINE = hex('#dde3e9'), W = 841.89, H = 595.28, M = 36;
  let res = null, cli = null;
  try { res = await embedAny(doc, await ctx.getBytes(ctx.logoResero)); } catch (e) { console.warn('Resero logo', e); }
  try { if (pr.clientLogo) cli = await embedAny(doc, await ctx.getBytes(pr.clientLogo)); } catch (e) { console.warn('client logo', e); }
  const links = [], pages = [];
  const wrap = (t, font, size, maxw) => { const out = []; clean(t).split('\n').forEach(par => { let line = ''; par.split(/\s+/).forEach(w => { const tr = line ? line + ' ' + w : w; if (font.widthOfTextAtSize(tr, size) <= maxw) line = tr; else { if (line) out.push(line); while (font.widthOfTextAtSize(w, size) > maxw && w.length > 1) { let k = w.length; while (k > 1 && font.widthOfTextAtSize(w.slice(0, k), size) > maxw) k--; out.push(w.slice(0, k)); w = w.slice(k); } line = w; } }); out.push(line); }); return out; };
  const txt = (pg, t, x, y, size, font, color) => pg.drawText(clean(t), { x, y, size, font: font || f, color: color || hex('#18232f') });
  const HEAD = 46;
  const newPage = title => {
    const pg = doc.addPage([W, H]); pages.push(pg);
    let x = M;
    if (res) { const h = 24, w = h * res.width / res.height; pg.drawImage(res, { x, y: H - M - h + 4, width: w, height: h }); x += w + 14; }
    if (cli) { const h = 30, w = Math.min(150, h * cli.width / cli.height), hh = w * cli.height / cli.width; pg.drawImage(cli, { x: W - M - w, y: H - M - hh + 6, width: w, height: hh }); }
    txt(pg, o.title, x, H - M - 6, 13, fb, NAVY); txt(pg, (pr.name || '') + '  |  ' + (title || o.sub), x, H - M - 20, 9, f, GREY);
    pg.drawRectangle({ x: M, y: H - M - 32, width: W - 2 * M, height: 1.5, color: TEAL }); return pg;
  };
  // ---- summary
  st('Writing the summary…'); let pg = newPage(o.sub), y = H - M - HEAD - 24;
  txt(pg, o.sub, M, y, 18, fb, NAVY); y -= 22;
  [['Project', [pr.name, pr.address].filter(Boolean).join(', ')], ['Client', pr.client], ['Contract', pr.contract], ['Contractor', pr.contractor], ...(o.team ? [] : [['Engineer to the Contract', pr.engineer]]), ['Building consent', pr.consent], ['Schedule date', nzDate(todayISO())], ['Items in this schedule', String(L.length)]].filter(r => r[1]).forEach(([k, v]) => { txt(pg, k, M, y, 9.5, fb, GREY); txt(pg, v, M + 150, y, 9.5); y -= 14; });
  y -= 10; txt(pg, 'Summary', M, y, 11, fb, NAVY); y -= 6;
  const tbl = (rows, x, yy, w) => { rows.forEach((r, i) => { const ry = yy - 14 * (i + 1); if (i === 0) pg.drawRectangle({ x, y: ry - 3, width: w, height: 14, color: NAVY }); else pg.drawRectangle({ x, y: ry - 3, width: w, height: 14, borderColor: LINE, borderWidth: 0.5 }); txt(pg, r[0], x + 5, ry + 1, 8.5, i ? f : fb, i ? undefined : P.rgb(1, 1, 1)); txt(pg, String(r[1]), x + w - 30, ry + 1, 8.5, i ? f : fb, i ? undefined : P.rgb(1, 1, 1)); }); return yy - 14 * rows.length; };
  const statuses = pr.statuses, sevs = pr.severities;
  const y1 = tbl([['Status', 'Items'], ...statuses.map(s => [s, L.filter(d => d.status === s).length]).filter(r => r[1])], M, y, 200);
  const y2 = tbl([[pr.sevLabel || 'Severity', 'Items'], ...sevs.map(s => [s, L.filter(d => d.severity === s).length]).filter(r => r[1])], M + 220, y, 230);
  y = Math.min(y1, y2) - 18;
  txt(pg, 'How to use this schedule', M, y, 11, fb, NAVY); y -= 14;
  wrap(o.intro, f, 9, W - 2 * M).forEach(l => { txt(pg, l, M, y, 9); y -= 12; });
  if (o.sig) { y -= 16; const bw = (W - 2 * M - 20) / 2; [['Engineer to the Contract', pr.engineer || ''], ['Contractor', pr.contractor || '']].forEach(([r, n], i) => { const x = M + i * (bw + 20); pg.drawRectangle({ x, y: y - 62, width: bw, height: 62, borderColor: LINE, borderWidth: 0.8 }); txt(pg, r, x + 8, y - 14, 9, fb, NAVY); txt(pg, n, x + 8, y - 27, 9, f, GREY); txt(pg, 'Signature: ______________________________   Date: ______________', x + 8, y - 52, 9); }); }
  // ---- schedule table
  st('Writing the schedule…');
  const hasDetail = d => o.single || o.photos && ((d.photos && d.photos.some(p => p.url)) || (d.plan && d.x != null));
  const cols = [['ID', 48], ['Location', 120], ['Defect', 300], [pr.sevLabel || 'Severity', 82], ['Responsible', 78], ['Target', 58], ['Status', 84]];
  const tw = cols.reduce((a, c) => a + c[1], 0), sc = (W - 2 * M) / tw; cols.forEach(c => c[1] *= sc);
  const rowRefs = {}; let tpg = null;
  const head = () => { tpg = newPage('Schedule'); y = H - M - HEAD - 4; let x = M; tpg.drawRectangle({ x: M, y: y - 5, width: W - 2 * M, height: 16, color: NAVY }); cols.forEach(c => { txt(tpg, c[0], x + 4, y, 8.5, fb, P.rgb(1, 1, 1)); x += c[1]; }); y -= 16; };
  head();
  for (const d of L) {
    const tl = wrap(d.title || '', fb, 8, cols[2][1] - 8);
    const cells = [[d.id], wrap(locText(d) || '-', f, 8, cols[1][1] - 8), [...tl, ...wrap(d.desc || '', f, 8, cols[2][1] - 8), ...(d.action ? wrap('Action: ' + d.action, f, 8, cols[2][1] - 8) : [])], wrap(d.severity || '', f, 8, cols[3][1] - 8), wrap(d.responsible || '', f, 8, cols[4][1] - 8), [d.targetDate ? nzDate(d.targetDate) : '-'], [d.status]];
    const rh = Math.max(...cells.map(c => c.length)) * 10 + 6; if (y - rh < M + 20) head();
    let x = M; tpg.drawRectangle({ x: M, y: y - rh + 9, width: W - 2 * M, height: rh, borderColor: LINE, borderWidth: 0.5 });
    cells.forEach((c, ci) => { c.forEach((l, li) => {
      if (ci === 6) { tpg.drawRectangle({ x: x + 3, y: y - 3, width: fb.widthOfTextAtSize(clean(l), 7.5) + 8, height: 11, color: hex(SCOL[d.status] || '#666') }); txt(tpg, l, x + 7, y, 7.5, fb, P.rgb(1, 1, 1)); }
      else txt(tpg, l, x + 4, y - li * 10, 8, ci === 0 || (ci === 2 && li < tl.length) ? fb : f, ci === 0 && hasDetail(d) ? hex('#2f78c4') : undefined);
    }); x += cols[ci][1]; });
    if (hasDetail(d)) links.push({ pg: tpg, r: [M, y - 4, M + cols[0][1], y + 9], id: d.id });
    rowRefs[d.id] = { pg: tpg, y }; y -= rh;
  }
  // ---- plans
  const planImg = {};
  const getPlanImg = async p => planImg[p.id] || (planImg[p.id] = await embedAny(doc, await ctx.getBytes(p.img)));
  if (o.plans) for (const p of ctx.plans) {
    const pins = L.filter(d => d.plan === p.id && d.x != null); if (!pins.length) continue; st('Placing ' + p.name + '…');
    const ppg = newPage(p.name + (p.code ? ' (' + p.code + ')' : '')); const img = await getPlanImg(p);
    const bw = W - 2 * M, bh = H - 2 * M - HEAD - 10, s = Math.min(bw / img.width, bh / img.height), iw = img.width * s, ih = img.height * s, ix = M + (bw - iw) / 2, iy = M + 4 + (bh - ih) / 2;
    ppg.drawImage(img, { x: ix, y: iy, width: iw, height: ih }); ppg.drawRectangle({ x: ix, y: iy, width: iw, height: ih, borderColor: LINE, borderWidth: 0.5 });
    pins.forEach(d => { const px = ix + d.x * iw, py = iy + ih - d.y * ih, lab = clean(pinLabel(d)), r = Math.max(6.5, fb.widthOfTextAtSize(lab, 7) / 2 + 3); ppg.drawCircle({ x: px, y: py, size: r, color: hex(SCOL[d.status] || '#666'), borderColor: P.rgb(1, 1, 1), borderWidth: 1 }); txt(ppg, lab, px - fb.widthOfTextAtSize(lab, 7) / 2, py - 2.5, 7, fb, P.rgb(1, 1, 1)); if (hasDetail(d)) links.push({ pg: ppg, r: [px - r, py - r, px + r, py + r], id: d.id }); });
    let lx = M; statuses.forEach(s => { ppg.drawCircle({ x: lx + 5, y: M - 10, size: 4, color: hex(SCOL[s] || '#666') }); txt(ppg, s, lx + 12, M - 13, 8, f, GREY); lx += f.widthOfTextAtSize(s, 8) + 30; });
  }
  // ---- detail pages
  const detail = {};
  if (o.photos || o.single) {
    // A single-item sheet gives the item the whole page.
    let dpg = null, slot = 0; const per = o.single ? 1 : 2, half = (H - 2 * M - HEAD - 20) / per;
    for (const d of L.filter(hasDetail)) {
      if (!dpg || slot === per) { dpg = newPage(o.single ? o.sub : 'Defect details'); slot = 0; } st('Detail page for ' + d.id + '…');
      const top = H - M - HEAD - 8 - slot * half; detail[d.id] = { pg: dpg, y: top }; let ty;
      dpg.drawRectangle({ x: M, y: top - half + 8, width: W - 2 * M, height: half - 4, borderColor: LINE, borderWidth: 0.7 });
      dpg.drawRectangle({ x: M, y: top - 14, width: W - 2 * M, height: 20, color: hex('#f2f4f6') }); txt(dpg, d.id + '  ' + (d.title || ''), M + 8, top - 8, 11, fb, NAVY);
      const sw = fb.widthOfTextAtSize(clean(d.status), 8); dpg.drawRectangle({ x: W - M - sw - 16, y: top - 11, width: sw + 10, height: 13, color: hex(SCOL[d.status] || '#666') }); txt(dpg, d.status, W - M - sw - 11, top - 7.5, 8, fb, P.rgb(1, 1, 1));
      ty = top - 30; const colW = 300;
      [['Location', locText(d) || '-'], ['Element', d.element || '-'], [pr.sevLabel || 'Severity', d.severity], ['Type / trade', [d.type, d.trade].filter(Boolean).join(' / ')], ['Responsible', (d.responsible || '') + (d.targetDate ? ', by ' + nzDate(d.targetDate) : '')], ['Raised', (nzDate(d.dateRaised) || '-') + ' (' + (d.source || '') + (d.extRef ? ' ref ' + d.extRef : '') + ')']].forEach(([k, v]) => { txt(dpg, k, M + 8, ty, 8, fb, GREY); const ls = wrap(v || '-', f, 8.5, colW - 90); ls.slice(0, 2).forEach((l, i) => txt(dpg, l, M + 90, ty - i * 10, 8.5)); ty -= 10 * Math.min(2, ls.length) + 3; });
      ty -= 4; wrap(d.desc || '', f, 8.5, colW).slice(0, 9).forEach(l => { txt(dpg, l, M + 8, ty, 8.5); ty -= 10.5; });
      if (d.action) { ty -= 3; wrap('Action: ' + d.action, fb, 8.5, colW).slice(0, 4).forEach(l => { txt(dpg, l, M + 8, ty, 8.5, fb); ty -= 10.5; }); }
      { const lm = o.comments === false ? null : latestMove(d); if (lm) { const head = wrap(`Latest: ${lm.label}, ${nzDate(String(lm.when || '').slice(0, 10)) || ''}${lm.who ? ', ' + lm.who : ''}`, fb, 8.5, colW - 12).slice(0, 2), body = lm.text ? wrap((lm.noteWho && lm.noteWho !== lm.who ? lm.noteWho + ': ' : '') + lm.text, f, 8.5, colW - 12).slice(0, 5) : [];
          const bh = (head.length + body.length) * 10.5 + 8, floor = top - half + 26; if (ty - 6 - bh > floor) { ty -= 6; dpg.drawRectangle({ x: M + 8, y: ty - bh + 4, width: colW, height: bh, color: hex('#eef6f8'), borderColor: hex(SCOL[d.status] || '#3bafbe'), borderWidth: 0.8 }); ty -= 7;
            head.forEach(l => { txt(dpg, l, M + 14, ty, 8.5, fb, NAVY); ty -= 10.5; }); body.forEach(l => { txt(dpg, l, M + 14, ty, 8.5); ty -= 10.5; }); } } }
      const ph = o.noPh ? [] : recentPhotos(d).slice(0, o.single ? 4 : 3), ax = M + colW + 24, aw = W - M - 8 - ax, ah = half - 40, by = top - 24 - ah;
      const snips = []; if (!o.noSnip) { const p1 = d.plan && ctx.plans.find(p => p.id === d.plan); if (p1 && d.x != null) snips.push({ p: p1, x: d.x, y: d.y }); const p2 = d.plan2 && ctx.plans.find(p => p.id === d.plan2); if (p2 && d.x2 != null) snips.push({ p: p2, x: d.x2, y: d.y2 }); }
      const snip = async (sp, sx, sw, sh) => { try { const im = await getPlanImg(sp.p); const zoomDiv = sp.p.kind === 'elevation' ? 4 : 3; const sc = Math.min(sw / (im.width / zoomDiv), sh / (im.height / zoomDiv)), cw = sw / sc, ch = sh / sc;
          let cx = sp.x * im.width - cw / 2, cy = sp.y * im.height - ch / 2; cx = Math.max(0, Math.min(im.width - cw, cx)); cy = Math.max(0, Math.min(im.height - ch, cy));
          const ox = sx - cx * sc, oy = by + sh - (im.height - cy) * sc + (im.height - cy) * sc - (ch) * sc; const oy2 = by - (im.height - cy - ch) * sc;
          dpg.pushOperators(P.pushGraphicsState(), P.rectangle(sx, by, sw, sh), P.clip(), P.endPath()); dpg.drawImage(im, { x: ox, y: oy2, width: im.width * sc, height: im.height * sc }); dpg.pushOperators(P.popGraphicsState());
          const px = sx + (sp.x * im.width - cx) * sc, py = by + sh - (sp.y * im.height - cy) * sc;
          dpg.drawCircle({ x: px, y: py, size: 7, color: hex(SCOL[d.status] || '#666'), borderColor: P.rgb(1, 1, 1), borderWidth: 1.2 }); dpg.drawRectangle({ x: sx, y: by, width: sw, height: sh, borderColor: LINE, borderWidth: 0.5 }); txt(dpg, (sp.p.kind === 'elevation' ? 'On ' : 'Location on ') + (sp.p.code || sp.p.name), sx, by - 10, 7.5, f, GREY); } catch (e) { txt(dpg, 'Plan could not be loaded', sx, by + sh / 2, 8, f, GREY); } };
      const photoW = ph.length ? (snips.length ? aw * 0.58 : aw) : 0, snipW = aw - photoW - (ph.length && snips.length ? 8 : 0);
      if (ph.length) {
        // Single-item sheet: a grid two wide so the photos fill the page. Otherwise one row.
        const nc = o.single ? Math.min(2, ph.length) : ph.length, nr = Math.ceil(ph.length / nc), gw = (photoW - (nc - 1) * 6) / nc, gh = (ah - (nr - 1) * 6) / nr;
        for (let i = 0; i < ph.length; i++) { try { const im = await embedAny(doc, await ctx.getBytes(ph[i].url)); const s = Math.min(gw / im.width, gh / im.height), cx = ax + (i % nc) * (gw + 6), cy = by + ah - gh - Math.floor(i / nc) * (gh + 6); dpg.drawImage(im, { x: cx + (gw - im.width * s) / 2, y: cy + (gh - im.height * s) / 2, width: im.width * s, height: im.height * s }); } catch (e) { txt(dpg, 'Photo could not be loaded', ax + i * (gw + 6), by + ah / 2, 8, f, GREY); } }
        const p = d.plan && ctx.plans.find(p => p.id === d.plan); if (p && !snips.length) txt(dpg, 'Pinned on ' + (p.code || p.name), M + 8, top - half + 16, 7.5, f, GREY);
      }
      if (snips.length) { const sx0 = ax + photoW + (ph.length ? 8 : 0), each = (snipW - (snips.length - 1) * 6) / snips.length; for (let i = 0; i < snips.length; i++) await snip(snips[i], sx0 + i * (each + 6), each, ah); }
      slot++;
    }
  }
  // ---- footers, links
  // A single-item sheet keeps only the item's own page: no summary and no one-row schedule.
  if (o.single) { const keep = new Set(Object.values(detail).map(t => t.pg)); for (let i = pages.length - 1; i >= 0; i--) if (!keep.has(pages[i])) { doc.removePage(i); pages.splice(i, 1); } links.length = 0; Object.keys(rowRefs).forEach(k => delete rowRefs[k]); }
  // ---- full item pack (single item): every photo, the whole history, the plans it is pinned on, attached documents
  if (o.single && o.pack && L[0]) {
    const d = L[0], K = o.pack, TOPY = H - M - HEAD - 18, BOT = M + 10;
    if (K.history) {
      st('Writing the full history…'); let hp = newPage('Full history'), yy = TOPY; txt(hp, 'Full history (' + (d.history || []).length + ' entries, oldest first)', M, yy, 12, fb, NAVY); yy -= 20;
      const ents = (d.history || []).slice().sort((a, b) => String(a.t || '').localeCompare(String(b.t || '')));
      for (const h of ents) {
        const head = [String(h.t || '').slice(0, 16).replace('T', ' '), h.who || ''].filter(Boolean).join('  ·  ') + (h.st && h.st[1] ? '   [' + (h.st[0] ? h.st[0] + ' -> ' : '') + h.st[1] + ']' : '');
        const body = wrap(h.txt || '', f, 9, W - 2 * M - 20); if ((h.photos || []).length) body.push('(' + h.photos.length + ' photo' + (h.photos.length === 1 ? '' : 's') + ' attached, shown in the photo pages)');
        const need = 14 + body.length * 11 + 8; if (yy - need < BOT) { hp = newPage('Full history (continued)'); yy = TOPY; }
        if (h.st && h.st[1]) hp.drawRectangle({ x: M, y: yy - need + 12, width: 3, height: need - 4, color: hex(SCOL[h.st[1]] || '#3bafbe') });
        txt(hp, head, M + 10, yy, 9, fb, NAVY); yy -= 12; body.forEach(l => { txt(hp, l, M + 10, yy, 9); yy -= 11; }); yy -= 8;
        hp.drawRectangle({ x: M + 10, y: yy + 4, width: W - 2 * M - 10, height: 0.4, color: LINE });
      }
    }
    if (K.photos) {
      const all = []; (d.photos || []).filter(x => x.url).forEach(x => all.push({ ...x, cap: (x.name || 'Photo') + (x.t ? ', ' + String(x.t).slice(0, 10) : '') }));
      (d.history || []).forEach(h => (h.photos || []).filter(x => x.url).forEach(x => all.push({ ...x, cap: (x.name || 'Photo') + ', ' + String(h.t || '').slice(0, 10) + (h.who ? ', ' + h.who : '') })));
      const seen = new Set(), uniq = all.filter(x => !seen.has(x.url) && seen.add(x.url));
      const gw = (W - 2 * M - 12) / 2, gh = (TOPY - BOT - 40) / 2;
      for (let i = 0; i < uniq.length; i++) {
        if (i % 4 === 0) { st('Adding photos ' + (i + 1) + ' to ' + Math.min(i + 4, uniq.length) + ' of ' + uniq.length + '…'); var pp = newPage('Photos (' + uniq.length + ')'); }
        const cx = M + (i % 2) * (gw + 12), cy = TOPY - 6 - (Math.floor(i % 4 / 2) + 1) * (gh + 20) + 20;
        try { const im = await embedAny(doc, await ctx.getBytes(uniq[i].url)); const sc = Math.min(gw / im.width, gh / im.height); pp.drawImage(im, { x: cx + (gw - im.width * sc) / 2, y: cy + (gh - im.height * sc) / 2, width: im.width * sc, height: im.height * sc }); }
        catch (e) { txt(pp, 'Photo could not be loaded', cx + 10, cy + gh / 2, 9, f, GREY); }
        txt(pp, (i + 1) + '. ' + uniq[i].cap, cx, cy - 12, 8, f, GREY);
      }
    }
    if (K.plans) {
      for (const [pid, x, y2] of [[d.plan, d.x, d.y], [d.plan2, d.x2, d.y2]]) {
        const pl = pid && ctx.plans.find(p => p.id === pid); if (!pl || x == null) continue; st('Adding plan ' + (pl.code || pl.name) + '…');
        try { const im = await getPlanImg(pl), lp = newPage('Location: ' + (pl.code ? pl.code + ' ' : '') + (pl.name || '')), aw = W - 2 * M, ah = TOPY - BOT - 10, sc = Math.min(aw / im.width, ah / im.height), ox = M + (aw - im.width * sc) / 2, oy = BOT + (ah - im.height * sc) / 2;
          lp.drawImage(im, { x: ox, y: oy, width: im.width * sc, height: im.height * sc }); const px = ox + x * im.width * sc, py = oy + (1 - y2) * im.height * sc;
          lp.drawCircle({ x: px, y: py, size: 14, borderColor: hex('#d62828'), borderWidth: 2.5 }); lp.drawCircle({ x: px, y: py, size: 5, color: hex(SCOL[d.status] || '#d62828'), borderColor: P.rgb(1, 1, 1), borderWidth: 1 });
          txt(lp, d.id + '  ' + (locText(d) || ''), M, TOPY + 4, 9, fb, NAVY); } catch (e) { console.warn('plan page', e); }
      }
    }
    const chosen = (d.files || []).filter((x, i) => !K.files || K.files.includes(i));
    if (K.docs && chosen.length) {
      const list = [], ix = newPage('Attached documents');
      for (const fl of chosen) {
        const u = fl.url || fl.data; if (!u) { list.push([fl.name, 'not uploaded yet']); continue; } st('Adding ' + (fl.name || 'document') + '…');
        try { const b = new Uint8Array(await ctx.getBytes(u));
          if (b[0] === 0x25 && b[1] === 0x50) { const src = await P.PDFDocument.load(b, { ignoreEncryption: true }), cp = await doc.copyPages(src, src.getPageIndices()); cp.forEach(q => doc.addPage(q)); list.push([fl.name, 'included, ' + cp.length + ' page' + (cp.length === 1 ? '' : 's')]); }
          else if ((b[0] === 0xFF && b[1] === 0xD8) || (b[0] === 0x89 && b[1] === 0x50)) { const im = await embedAny(doc, b), ip = newPage('Document: ' + (fl.name || '')), aw = W - 2 * M, ah = TOPY - BOT, sc = Math.min(aw / im.width, ah / im.height); ip.drawImage(im, { x: M + (aw - im.width * sc) / 2, y: BOT + (ah - im.height * sc) / 2, width: im.width * sc, height: im.height * sc }); list.push([fl.name, 'included as an image']); }
          else list.push([fl.name, 'cannot be embedded in a PDF, open it in the app']);
        } catch (e) { list.push([fl.name, 'could not be read: ' + e.message]); }
      }
      let yy = TOPY; txt(ix, 'Attached documents (' + list.length + ')', M, yy, 12, fb, NAVY); yy -= 20;
      list.forEach(([nm, how], i) => { txt(ix, (i + 1) + '. ' + (nm || 'Document'), M, yy, 9.5, fb); txt(ix, how, M + 360, yy, 9, f, GREY); yy -= 15; });
    }
  }
  const n = pages.length, foot = `Prepared by ${APP.company}${pr.client ? ' for ' + pr.client : ''}`;
  pages.forEach((p, i) => { p.drawRectangle({ x: M, y: M - 22, width: W - 2 * M, height: 0.5, color: LINE }); txt(p, foot, M, M - 32, 7.5, f, GREY); const t = 'Page ' + (i + 1) + ' of ' + n; txt(p, t, W - M - f.widthOfTextAtSize(t, 7.5), M - 32, 7.5, f, GREY); });
  const annot = (page, dict) => { const ref = doc.context.register(doc.context.obj(dict)); let an = page.node.lookup(P.PDFName.of('Annots')); if (!an) { an = doc.context.obj([]); page.node.set(P.PDFName.of('Annots'), an); } an.push(ref); };
  const dest = t => [t.pg.ref, P.PDFName.of('XYZ'), P.PDFNull, P.PDFNumber.of(t.y + 20), P.PDFNull];
  links.forEach(l => { const t = detail[l.id]; if (t) annot(l.pg, { Type: 'Annot', Subtype: 'Link', Rect: l.r, Border: [0, 0, 0], Dest: dest(t) }); });
  Object.entries(detail).forEach(([id, t]) => { const r = rowRefs[id]; if (r) annot(t.pg, { Type: 'Annot', Subtype: 'Link', Rect: [M, t.y - 14, M + 200, t.y + 6], Border: [0, 0, 0], Dest: dest(r) }); });
  doc.setTitle(clean(o.title + ' - ' + pr.name)); doc.setAuthor(APP.company); doc.setSubject(clean(o.sub)); doc.setProducer(APP.name);
  return new Blob([await doc.save()], { type: 'application/pdf' });
}

// The latest change of status on an item (who moved it, when, and what they said), ignoring housekeeping edits such as a moved pin or a corrected unit.
const WF_RE = /^(Ready for inspection|Reopened and sent back|Accepted and closed|In progress|Completed and closed by the contractor)(?:: ([\s\S]+)|\.)?/;
const SYS_RE = /^(Changed |Raised|Imported|Added from|Pin placed|Unit |Filled in|Site note|Status |Ticked|Marked|Handwritten|Resolution note|Category set)/i;
const histSorted = d => (d.history || []).slice().sort((a, b) => String(b.t || '').localeCompare(String(a.t || '')));
export function latestMove(d) {
  let mv = null, note = null;
  for (const h of histSorted(d)) { const t = String(h.txt || ''), m = WF_RE.exec(t), sc = /status ([^→;.]+?) → ([^;.]+)/i.exec(t);
    if (!mv && (m || sc)) mv = { h, label: m ? m[1] : `Status changed from ${sc[1].trim()} to ${sc[2].trim()}`, text: m && m[2] ? m[2].trim() : '' };
    if (!note && !m && t.trim() && !SYS_RE.test(t)) note = { h, text: t.trim() };
    if (mv && note) break; }
  if (!mv && !note) return null;
  // the newer of the two wins, so a comment added after the last status change is what shows
  if (mv && note && String(note.h.t || '') > String(mv.h.t || '')) mv = null;
  const src = mv || note; return { label: mv ? mv.label : 'Comment', when: src.h.t, who: src.h.who || '', text: (mv && mv.text) || (note ? note.text : ''), noteWho: mv && !mv.text && note ? note.h.who || '' : '', photos: (src.h.photos || []).length ? src.h.photos : (note && note.h.photos) || [] };
}
// Evidence the contractor says exists somewhere else (Procore, a CAN, an RFI, an email), so it can be found and attached here.
const REF_RE = /\b(procore|aconex|sharepoint|dropbox|CANs?\b[\s#-]*\d*|CCI[\s#-]*\d+|RFI[\s#-]*\d+|NCR[\s#-]*\d+|CI[\s#-]*\d+|site instruction|variation|e-?mail(?:ed)?|sent (?:to|via|by|through)|see (?:the )?(?:attached|photo|photos|report|drawing)|photos? (?:is|are|was|were)?\s*(?:in|on|uploaded|loaded|provided|sent|taken)|uploaded (?:to|in|on)|provided (?:to|in|via)|as per|refer(?:red)? to|PS[134]\b|producer statement|report)\b[^.;\n]{0,40}/gi;
export function evidenceRefs(L) {
  const rows = [];
  for (const d of L) for (const h of histSorted(d)) { const t = String(h.txt || ''); if (!t.trim() || /^(Raised|Imported|Added from|Pin placed|Filled in|Category set)/i.test(t)) continue; const hits = [...new Set((t.match(REF_RE) || []).map(x => x.trim()))]; if (!hits.length) continue;
    rows.push([d.id, d.title || '', locText(d) || '', d.status || '', (d.photos || []).length, (d.files || []).length, nzDate(String(h.t || '').slice(0, 10)), h.who || '', hits.join(' | '), t.replace(/\s+/g, ' ').slice(0, 600), '']); }
  return rows;
}
// The contractor's own register layout (Unit | Description | Contractor | Interior/Exterior? | Completed), with the same heading block,
// so they can keep sending it in the format they always have. Rows keep their original register order; items added since go at the end.
export async function buildRegisterXlsx(L, ctx) {
  if (!window.XLSX) await loadScript(LIB.xlsx);
  const pr = ctx.project, ex = d => d.ext || {};
  const unitOf = d => { const l = String(ex(d)['Listed under'] || (d.unit ? 'Unit ' + d.unit : d.room || '')).replace(/\s*\(old number.*$/i, '').trim(); const m = /^unit\s+(\d+)$/i.exec(l); return m ? +m[1] : l; };
  const rowNo = d => +(ex(d)['Register row'] || 1e9);
  const items = L.slice().sort((a, b) => rowNo(a) - rowNo(b) || String(unitOf(a)).localeCompare(String(unitOf(b)), 'en', { numeric: true }) || natural(a.id, b.id));
  const done = d => d.status === 'Closed' ? 'Completed' : '';
  const data = items.map(d => [unitOf(d), d.desc || d.title || '', d.subcontractor || ex(d)['Subcontractor'] || '', ex(d)['Interior / exterior'] || '', done(d)]);
  const now = new Date();
  const aoa = [[null, pr.registerTitle || 'Pre-Settlement Inspection Defects Summary'], [], ['Project:', pr.address || pr.name], ['Job No.', pr.jobNo || ''], [], ['Access:', pr.registerAccess || ''], [], ['Date:', now], [], [], ['Unit', 'Description', 'Contractor', 'Interior/Exterior?', 'Completed'], ...data];
  const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });
  ws['!cols'] = [25, 101, 25, 19, 16].map(w => ({ wch: w }));
  ws['!autofilter'] = { ref: `A11:E${11 + data.length}` };
  const B = { font: { bold: true } };
  ['B1', 'A3', 'A4', 'A6', 'A8', 'A11', 'B11', 'C11', 'D11', 'E11'].forEach(a => { if (ws[a]) ws[a].s = B; });
  if (ws.B1) ws.B1.s = { font: { bold: true, sz: 14 } };
  if (ws.B8) { ws.B8.z = 'dd/mm/yyyy'; ws.B8.s = { alignment: { horizontal: 'left' } }; }
  data.forEach((r, i) => { const a = 'E' + (12 + i); if (ws[a]) ws[a].s = B; });
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Unit');
  let out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  if (pr.contractorLogo) try { out = await addLogo(out, pr.contractorLogo); } catch (e) { console.warn('logo', e); }
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
// Put a logo image on the first sheet, top right (columns C to E, rows 1 to 10), as in the contractor's own register.
async function addLogo(buf, dataUrl) {
  if (!window.JSZip) await loadScript(LIB.jszip || 'lib/jszip.min.js');
  const m = /^data:image\/(png|jpe?g);base64,(.*)$/.exec(dataUrl); if (!m) return buf;
  const ext = m[1] === 'png' ? 'png' : 'jpeg';
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = dataUrl; });
  const hEmu = 1500000, wEmu = Math.round(hEmu * img.width / img.height);   // about 4 cm tall, keeps its proportions
  const z = await JSZip.loadAsync(buf);
  z.file('xl/media/logo1.' + ext, m[2], { base64: true });
  z.file('xl/drawings/drawing1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><xdr:oneCellAnchor><xdr:from><xdr:col>2</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="${wEmu}" cy="${hEmu}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="2" name="Logo"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${wEmu}" cy="${hEmu}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>`);
  z.file('xl/drawings/_rels/drawing1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/logo1.${ext}"/></Relationships>`);
  const rp = 'xl/worksheets/_rels/sheet1.xml.rels', rel = `<Relationship Id="rIdLogo" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>`;
  const old = z.file(rp) ? await z.file(rp).async('string') : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
  z.file(rp, old.replace('</Relationships>', rel + '</Relationships>'));
  let sh = await z.file('xl/worksheets/sheet1.xml').async('string');
  sh = sh.replace(/(<\/worksheet>)$/, '<drawing r:id="rIdLogo"/>$1');
  if (!/xmlns:r=/.test(sh.slice(0, 600))) sh = sh.replace('<worksheet ', '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ');
  // the drawing element must come after autoFilter/mergeCells etc. and before legacy parts; SheetJS writes none of those after it
  z.file('xl/worksheets/sheet1.xml', sh);
  let ct = await z.file('[Content_Types].xml').async('string');
  if (!ct.includes('Extension="' + ext + '"')) ct = ct.replace('<Default ', `<Default Extension="${ext}" ContentType="image/${ext}"/><Default `);
  ct = ct.replace('</Types>', '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>');
  z.file('[Content_Types].xml', ct);
  return z.generateAsync({ type: 'arraybuffer' });
}
export async function buildEvidenceXlsx(L, ctx) {
  if (!window.XLSX) await loadScript(LIB.xlsx);
  const head = ['ID', 'Title', 'Location', 'Status', 'Photos here', 'Files here', 'Date', 'Who said it', 'What they referred to', 'Their full comment', 'Collected (tick)'], rows = evidenceRefs(L);
  const ws = window.XLSX.utils.aoa_to_sheet([[`${ctx.project.name}: evidence referred to but held elsewhere`], [`${rows.length} comments on ${new Set(rows.map(r => r[0])).size} items mention Procore, a CAN, an RFI, an email or similar. Find each one and attach it to the item.`], [], head, ...rows]);
  ws['!cols'] = [8, 30, 26, 16, 10, 9, 11, 18, 34, 80, 12].map(w => ({ wch: w })); ws['!autofilter'] = { ref: `A4:K${rows.length + 4}` };
  const wb = window.XLSX.utils.book_new(); window.XLSX.utils.book_append_sheet(wb, ws, 'Evidence to collect');
  return new Blob([window.XLSX.write(wb, { type: 'array', bookType: 'xlsx' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
export const COLS = [['ID', 'id'], ['Title', 'title'], ['Description', 'desc'], ['Action required', 'action'], ['Block', 'block'], ['Level', 'level'], ['Unit', 'unit'], ['Room / area', 'room'], ['Surface', 'surface'], ['Item', 'item'], ['Element', 'element'], ['Type', 'type'], ['Severity', 'severity'], ['Trade', 'trade'], ['Responsible', 'responsible'], ['Subcontractor', 'subcontractor'], ['Status', 'status'], ['Target date', 'targetDate'], ['Date raised', 'dateRaised'], ['Source', 'source'], ['External ref', 'extRef'], ['Plan', 'plan'], ['Photos', d => (d.photos || []).length], ['Last comment', d => { const h = (d.history || []).slice(-1)[0]; return h ? nzDate(h.t) + ' ' + h.who + ': ' + h.txt : ''; }], ['Last updated', d => d.updated ? nzDate(d.updated) : '']];
export async function buildXlsx(L, ctx) {
  if (!window.XLSX) await loadScript(LIB.xlsx);
  const val = (d, f) => typeof f === 'function' ? f(d) : f === 'plan' ? ((ctx.plans.find(p => p.id === d.plan) || {}).name || '') : (d[f] == null ? '' : d[f]);
  const head = COLS.map(c => c[0] === 'Severity' ? (ctx.project.sevLabel || 'Severity') : c[0]), data = L.map(d => COLS.map(c => val(d, c[1])));
  const ws = XLSX.utils.aoa_to_sheet([[`${ctx.project.name} - Defects Register`], [`Exported ${nzDate(new Date().toISOString())} by ${ctx.me}. ${L.length} defects. Prepared by ${APP.company}${ctx.project.client ? ' for ' + ctx.project.client : ''}.`], [], head, ...data]);
  ws['!cols'] = COLS.map(c => ({ wch: { desc: 60, action: 40, title: 34 }[c[1]] || (typeof c[1] === 'function' ? 28 : 14) }));
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 3, c: 0 }, e: { r: 3 + data.length, c: head.length - 1 } }) };
  const hs = { font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '011C35' } }, alignment: { wrapText: true, vertical: 'center' } };
  head.forEach((_, i) => { const a = XLSX.utils.encode_cell({ r: 3, c: i }); if (ws[a]) ws[a].s = hs; });
  if (ws.A1) ws.A1.s = { font: { bold: true, sz: 14, color: { rgb: '011C35' } } };
  const si = COLS.findIndex(c => c[1] === 'status');
  data.forEach((row, r) => row.forEach((_, c) => { const a = XLSX.utils.encode_cell({ r: 4 + r, c }); if (ws[a]) ws[a].s = { alignment: { wrapText: true, vertical: 'top' }, ...(c === si && SCOL[row[c]] ? { fill: { fgColor: { rgb: SCOL[row[c]].slice(1).toUpperCase() } }, font: { color: { rgb: 'FFFFFF' }, bold: true } } : {}) }; }));
  const pr = ctx.project;
  const sum = [['Summary by status'], ['Status', 'Count'], ...pr.statuses.map(s => [s, L.filter(d => d.status === s).length]), [], ['Summary by ' + (pr.sevLabel || 'severity').toLowerCase()], [pr.sevLabel || 'Severity', 'Count'], ...pr.severities.map(s => [s, L.filter(d => d.severity === s).length]), [], ['Open items by trade'], ['Trade', 'Count'], ...pr.trades.map(t => [t, L.filter(d => d.trade === t && d.status !== 'Closed').length]).filter(r => r[1]), [], ['Open items by responsible party'], ['Responsible', 'Count'], ...[...new Set(L.map(d => d.responsible))].map(t => [t, L.filter(d => d.responsible === t && d.status !== 'Closed').length]).filter(r => r[1])];
  const ws2 = XLSX.utils.aoa_to_sheet(sum); ws2['!cols'] = [{ wch: 30 }, { wch: 10 }];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Defects'); XLSX.utils.book_append_sheet(wb, ws2, 'Summary');
  return new Blob([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
export function buildCsv(L) {
  const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const rows = [['Title', 'Description', 'Status', 'Location', 'Trade', 'Assignee', 'Due Date', 'Type', 'Priority', 'Reference'].map(q).join(',')];
  L.forEach(d => rows.push([d.id + ' ' + (d.title || ''), (d.desc || '') + (d.action ? ' ACTION: ' + d.action : ''), d.status === 'Closed' ? 'Closed' : d.status === 'Ready for review' ? 'Ready for Review' : 'Open', locText(d), d.trade, d.responsible, d.targetDate, d.type, (/^Major/.test(d.severity || '') || (PRJ.sevMajor || []).includes(d.severity)) ? 'High' : 'Medium', d.extRef || d.source].map(q).join(',')));
  return new Blob(['﻿' + rows.join('\r\n')], { type: 'text/csv' });
}
export async function buildZip(L, o, ctx, st) {
  if (!window.JSZip) await loadScript(LIB.jszip);
  const z = new JSZip(), n = stamp(), nm = safeName(ctx.project.name);
  st('Building the PDF…'); z.file(`${nm} - ${safeName(o.title)} - ${n}.pdf`, await buildPdf(L, o, ctx, st));
  st('Building the Excel file…'); z.file(`${nm} - Defects Register - ${n}.xlsx`, await buildXlsx(L, ctx)); z.file(`${nm} - Procore punch list - ${n}.csv`, buildCsv(L));
  for (const d of L) for (const [i, p] of (d.photos || []).filter(p => p.url).entries()) { st('Adding photos for ' + d.id + '…'); try { z.file(`Photos/${safeName(d.id + ' - ' + (d.title || '')).slice(0, 60)} (${i + 1}).jpg`, await ctx.getBytes(p.url)); } catch (e) {} }
  st('Zipping…'); return z.generateAsync({ type: 'blob' });
}

// Practical completion action list. Page 1 says, in plain words, who has to do what before PC can be certified.
// Everything else is optional (o.sections) so the report stays short: the defect and document appendices are on by default.
export const PC_SECTIONS = [
  ['units', 'Open defects by unit (summary table)', false],
  ['trades', 'Open defects by trade / subcontractor (summary table)', false],
  ['raised', 'Defects by who raised them (summary table)', false],
  ['systems', 'Documents by building system (summary table)', false],
  ['ccc', 'Council CCC items still open', false],
  ['actions', 'Other open actions from the Actions register', false],
  ['ss', 'Specified systems (compliance schedule)', false],
  ['appDefects', 'Appendix A: open defects, by unit', true],
  ['appDocs', 'Appendix B: outstanding documents', true],
];
export async function buildPcReport(D, fmd, ctx, st = () => {}, o = {}) {
  const on = k => { const x = (o.sections || {})[k]; return x === undefined ? (PC_SECTIONS.find(s => s[0] === k) || [])[2] : !!x; };
  if (!window.PDFLib) { st('Loading the PDF tools…'); await loadScript(LIB.pdflib); }
  const P = PDFLib, doc = await P.PDFDocument.create(), pr = ctx.project, f = await doc.embedFont(P.StandardFonts.Helvetica), fb = await doc.embedFont(P.StandardFonts.HelveticaBold);
  const W = 595.28, H = 841.89, M = 36, NAVY = hex('#011C35'), GREY = hex('#6a7886'), LINE = hex('#d5dae1'), RED = hex('#a32222'), WHITE = P.rgb(1, 1, 1), TILE = hex('#eef2f6');
  const logo = async u => { try { return u ? await embedAny(doc, await ctx.getBytes(u)) : null; } catch (e) { return null; } };
  const res = await logo(ctx.logoResero), cli = await logo(pr.clientLogo);
  const wrap = (t, font, size, maxw) => { const out = []; clean(t).split('\n').forEach(par => { let ln = ''; par.split(/\s+/).forEach(w => { const tr = ln ? ln + ' ' + w : w; if (font.widthOfTextAtSize(tr, size) <= maxw) ln = tr; else { if (ln) out.push(ln); ln = w; } }); if (ln) out.push(ln); }); return out.length ? out : ['']; };
  let pg, y; const T = (t, x, yy, s, font, c) => pg.drawText(clean(t), { x, y: yy, size: s, font: font || f, color: c || hex('#18232f') });
  const title = o.title || 'Practical completion action list';
  const page = () => { pg = doc.addPage([W, H]); if (res) { const h = 18, w = h * res.width / res.height; pg.drawImage(res, { x: M, y: H - M - h + 4, width: w, height: h }); } if (cli) { const h = 24, w = Math.min(130, h * cli.width / cli.height), hh = w * cli.height / cli.width; pg.drawImage(cli, { x: W - M - w, y: H - M - hh + 6, width: w, height: hh }); }
    T(title + '  |  ' + (pr.name || '') + '  |  ' + nzDate(todayISO()) + '  |  Page ' + doc.getPageCount(), M, M - 14, 7.5, f, GREY); pg.drawRectangle({ x: M, y: H - M - 24, width: W - 2 * M, height: 1.2, color: NAVY }); y = H - M - 44; };
  const need = h => { if (y - h < M + 8) page(); };
  const h1 = t => { need(40); y -= 6; T(t, M, y, 13, fb, NAVY); y -= 18; }, h2 = t => { need(34); y -= 2; T(t, M, y, 10, fb, NAVY); y -= 14; };
  const para = (t, c, sz = 9) => wrap(t, f, sz, W - 2 * M).forEach(l => { need(12); T(l, M, y, sz, f, c); y -= sz + 3; });
  const table = (cols, rows, o2 = {}) => { const tw = cols.reduce((a, c) => a + c[1], 0), sc = (W - 2 * M) / tw, C = cols.map(c => [c[0], c[1] * sc, c[2]]);
    const head = () => { need(30); pg.drawRectangle({ x: M, y: y - 5, width: W - 2 * M, height: 15, color: NAVY }); let x = M; C.forEach(([t, w, al]) => { const s = clean(t); T(s, al === 'r' ? x + w - 4 - fb.widthOfTextAtSize(s, 7.5) : x + 4, y, 7.5, fb, WHITE); x += w; }); y -= 9; };
    head(); rows.forEach((r, ri) => { const font = o2.bold && o2.bold(ri) ? fb : f, cells = r.map((v, i) => wrap(String(v == null ? '' : v), font, 8, C[i][1] - 8)), hh = 5 + 10 * Math.max(...cells.map(c => c.length));
      if (y - hh < M + 8) { page(); head(); } let x = M; cells.forEach((ls, i) => { ls.forEach((l, k) => T(l, C[i][2] === 'r' ? x + C[i][1] - 4 - font.widthOfTextAtSize(clean(l), 8) : x + 4, y - 9 - k * 10, 8, font, o2.red && o2.red(ri, i) ? RED : undefined)); x += C[i][1]; });
      y -= hh; pg.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: LINE }); }); y -= 12; };
  // plain words for the app's statuses
  const SAY = { 'Ready for review': 'Ready for inspection', 'In progress': 'Being fixed', 'Open': 'Not started', 'Disputed': 'Disputed' }, say = s => SAY[s] || s || '';
  const major = d => (pr.sevMajor && pr.sevMajor.length ? pr.sevMajor.includes(d.severity || '') : false) || /^Major/i.test(d.severity || '');
  const count = (L, fn) => L.filter(fn).length, who = d => d.subcontractor || d.responsible || 'Not assigned';
  const open = D.filter(d => d.status !== 'Closed'), mj = open.filter(major), rr = open.filter(d => d.status === 'Ready for review'), todo = open.filter(d => d.status !== 'Ready for review');
  const A = (fmd && fmd.assets || []).filter(a => !/^(Not applicable|NA|N\/A)$/i.test(a.status || '')), docs = (fmd && fmd.docs) || [], got = a => a.status === 'Received';
  const outD = A.filter(a => !got(a)), hold = a => /^(yes|y|true)$/i.test(String(a.pcHold || a.holdPc || '')) || a.pcHold === true;
  const AC = (fmd && fmd.actions) || [], isPc = a => /^PC/i.test(a.ref || ''), isC = a => /^CCC/i.test(a.ref || ''), pcOpen = AC.filter(a => isPc(a) && a.status !== 'Closed').sort((a, b) => natural(a.ref, b.ref));
  const contractor = pr.contractor || 'Contractor', client = pr.clientName || pr.client || 'Client';

  // ===== Page 1: where things stand and who has to do what
  page(); T(title, M, y, 20, fb, NAVY); y -= 20; T([pr.name, pr.address].filter(Boolean).join(', '), M, y, 10, f, GREY); y -= 20;
  [['To', pr.engineer ? pr.engineer + ' (Engineer to the Contract)' : ''], ['From', (ctx.me || '') + ', Resero Property'], ['Date', nzDate(todayISO())], ['Contractor', pr.contractor]].filter(r => r[1]).forEach(([k, v]) => { T(k, M, y, 9, fb, GREY); T(v, M + 70, y, 9); y -= 13; }); y -= 10;
  // four tiles
  { const tiles = [[open.length, 'defects still open', 'of ' + D.length + ' recorded'], [mj.length, 'defects holding up PC', mj.length ? 'must close first' : 'none'], [rr.length, 'ready for inspection', 'waiting on the inspector'], [A.length ? outD.length : '-', 'documents outstanding', A.length ? 'of ' + A.length + ' required' : 'not loaded yet']];
    const tw = (W - 2 * M - 3 * 8) / 4; tiles.forEach(([n, l1, l2], i) => { const x = M + i * (tw + 8); pg.drawRectangle({ x, y: y - 50, width: tw, height: 56, color: TILE }); T(String(n), x + 8, y - 22, 22, fb, i === 1 && mj.length ? RED : NAVY); T(l1, x + 8, y - 34, 8, fb); T(l2, x + 8, y - 44, 7.5, f, GREY); }); y -= 70; }
  h1('What needs to happen before practical completion');
  const R = []; // rows: [who, what, by, holds up PC]
  if (pcOpen.length) pcOpen.forEach(a => R.push([a.responsible || contractor, a.action || '', a.due ? nzDate(a.due) : '', 'Yes']));
  if (mj.length) { const g = {}; mj.forEach(d => (g[who(d)] = (g[who(d)] || 0) + 1)); R.push([contractor, `Close the ${mj.length} defect${mj.length === 1 ? '' : 's'} holding up PC (${Object.entries(g).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' ' + v).join(', ')}). Listed first in Appendix A.`, '', 'Yes']); }
  { const L = todo.filter(d => !major(d)); if (L.length) { const g = {}; L.forEach(d => (g[who(d)] = (g[who(d)] || 0) + 1)); const top = Object.entries(g).sort((a, b) => b[1] - a[1]);
    R.push([contractor, `Fix the other ${L.length} open defect${L.length === 1 ? '' : 's'} and mark them ready for inspection. Most are with ${top.slice(0, 4).map(([k, v]) => k + ' (' + v + ')').join(', ')}${top.length > 4 ? ' and ' + (top.length - 4) + ' others' : ''}.`, '', 'No']); } }
  { const g = {}; rr.forEach(d => (g[d.source || 'Not stated'] = (g[d.source || 'Not stated'] || 0) + 1)); Object.entries(g).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => R.push([k, `Inspect the ${v} item${v === 1 ? '' : 's'} marked ready, then close or send back.`, '', count(rr, d => (d.source || 'Not stated') === k && major(d)) ? 'Yes' : 'No'])); }
  if (A.length) { const grp = (fn, txt) => { const L = outD.filter(fn); if (L.length) R.push([contractor, txt(L.length) + ' Refs ' + L.sort((a, b) => natural(a.ref || '', b.ref || '')).map(a => a.ref).filter(Boolean).join(', ') + '.', '', L.some(hold) ? 'Yes' : 'No']); };
    grp(a => a.status === 'Revision required', n => `Re-issue ${n} warranty or handover document${n === 1 ? '' : 's'} that are not correct.`);
    grp(a => a.status === 'Not received' || a.status === 'Partial', n => `Provide ${n} warranty or handover document${n === 1 ? '' : 's'} not yet received (or only partly).`);
    grp(a => a.status === 'Query' || a.status === 'Confirm', n => `Answer ${n} question${n === 1 ? '' : 's'} on products or installers.`);
    const ex = outD.filter(a => /execution/i.test(a.status || '')); if (ex.length) R.push([contractor + ', then ' + client, `Countersign and execute ${ex.length} deed${ex.length === 1 ? '' : 's'} already signed by the installer. Refs ${ex.map(a => a.ref).join(', ')}.`, '', ex.some(hold) ? 'Yes' : 'No']); }
  if (R.length) table([['#', 18, 'r'], ['Who', 100], ['What they need to do', 300], ['By', 50], ['PC?', 34]], R.map((r, i) => [i + 1, ...r]), { red: (ri, i) => i === 4 && R[ri][3] === 'Yes' });
  else para('Nothing outstanding is recorded in the app.');
  para([on('appDefects') ? 'Appendix A lists every open defect by unit' : '', on('appDocs') ? 'Appendix B lists every outstanding document' : ''].filter(Boolean).join('. ') + (on('appDefects') || on('appDocs') ? '.' : ''), GREY, 8.5);

  // ===== optional summaries
  if (on('units')) { h1('Open defects by unit'); const g = {}; open.forEach(d => { const k = d.unit ? 'Unit ' + d.unit : 'Common areas' + (d.block ? ', ' + (/^(site|external)/i.test(d.block) ? d.block : 'Block ' + d.block) : ''); (g[k] = g[k] || []).push(d); });
    const ks = Object.keys(g).sort((a, b) => (a.startsWith('Unit') ? 0 : 1) - (b.startsWith('Unit') ? 0 : 1) || natural(a, b));
    table([['Unit / area', 150], ['Not started', 60, 'r'], ['Being fixed', 60, 'r'], ['Ready for inspection', 85, 'r'], ['Disputed', 55, 'r'], ['Total open', 60, 'r']], ks.map(k => [k, ...['Open', 'In progress', 'Ready for review', 'Disputed'].map(s => count(g[k], d => d.status === s) || ''), g[k].length])); }
  if (on('trades')) { h1('Open defects by trade / subcontractor'); const g = {}; open.forEach(d => (g[who(d)] = g[who(d)] || []).push(d));
    table([['Trade / subcontractor', 200], ['Open', 60, 'r'], ['Ready for inspection', 90, 'r'], ['Holding up PC', 70, 'r'], ['Units', 60, 'r']], Object.keys(g).sort((a, b) => g[b].length - g[a].length).map(k => [k, g[k].length, count(g[k], d => d.status === 'Ready for review') || '', count(g[k], major) || '', new Set(g[k].map(d => d.unit).filter(Boolean)).size || ''])); }
  if (on('raised')) { h1('Defects by who raised them'); const ST = ['Open', 'In progress', 'Ready for review', 'Disputed', 'Closed'], srcs = [...new Set(D.map(d => d.source || 'Not stated'))].sort();
    table([['Raised by', 150], ...ST.map(s => [say(s), 62, 'r']), ['Total', 50, 'r']], [...srcs.map(s => { const L = D.filter(d => (d.source || 'Not stated') === s); return [s, ...ST.map(x => count(L, d => d.status === x)), L.length]; }), ['Total', ...ST.map(x => count(D, d => d.status === x)), D.length]], { bold: i => i === srcs.length }); }
  if (on('systems') && A.length) { h1('Documents by building system'); const AS = ['Received', 'Partial', 'Revision required', 'Query', 'Not received'], sy = [...new Set(A.map(a => a.system || 'Not stated'))].sort();
    table([['Building system', 190], ...AS.map(s => [s.replace(' required', ' needed'), 55, 'r'])], [...sy.map(s => { const L = A.filter(a => (a.system || 'Not stated') === s); return [s, ...AS.map(x => count(L, a => (x === 'Query' ? /Query|Confirm/.test(a.status) : a.status === x)) || '')]; }), ['Total', ...AS.map(x => count(A, a => (x === 'Query' ? /Query|Confirm/.test(a.status) : a.status === x)))]], { bold: i => i === sy.length }); }
  const acols = [['Ref', 44], ['Action', 260], ['Who', 95], ['Status', 70], ['Due', 55]], arow = L => L.map(a => [a.ref || '', a.action || '', a.responsible || '', a.status || '', a.due ? nzDate(a.due) : '']);
  if (on('ccc')) { const co = AC.filter(a => isC(a) && a.status === 'Open').sort((a, b) => natural(a.ref, b.ref)); h1('Council CCC items still open'); if (co.length) table(acols, arow(co)); else para('None.'); }
  if (on('actions')) { const ot = AC.filter(a => !isPc(a) && !isC(a) && a.status !== 'Closed').sort((a, b) => natural(a.ref || '', b.ref || '')); h1('Other open actions'); if (ot.length) table(acols, arow(ot)); else para('None.'); }
  if (on('ss')) { const ss = (fmd && fmd.systems) || []; h1('Specified systems (compliance schedule)'); if (ss.length) table([['System', 50], ['Name', 200], ['Standard', 150], ['Certificate', 120]], ss.map(s => [s.ss || '', s.name || '', s.standard || '', s.cert || 'Not recorded'])); else para('None recorded.'); }

  // ===== Appendix A: every open defect, holding-up items first, then by unit
  if (on('appDefects')) { page(); h1('Appendix A: Open defects'); para('Items holding up practical completion are listed first. "Latest" is the most recent status change or comment.', GREY, 8.5); y -= 4;
    const cols = [['Ref', 40], ['Where', 95], ['Item', 190], ['Who', 80], ['Status', 62], ['Latest', 150]];
    const row = d => { const m = latestMove(d); return [d.id, locText(d) || '', d.title || d.desc || '', who(d), say(d.status), m ? (nzDate(String(m.when || '').slice(0, 10)) + ' ' + (m.text || m.label)).slice(0, 160) : '']; };
    if (mj.length) { h2('Holding up practical completion (' + mj.length + ')'); table(cols, mj.sort((a, b) => natural(a.id, b.id)).map(row), { red: (ri, i) => i === 0 }); }
    const rest = open.filter(d => !major(d)), g = {}; rest.forEach(d => { const k = d.unit ? 'Unit ' + d.unit : 'Common areas' + (d.block ? ', ' + (/^(site|external)/i.test(d.block) ? d.block : 'Block ' + d.block) : ''); (g[k] = g[k] || []).push(d); });
    Object.keys(g).sort((a, b) => (a.startsWith('Unit') ? 0 : 1) - (b.startsWith('Unit') ? 0 : 1) || natural(a, b)).forEach(k => { h2(k + ' (' + g[k].length + ')'); table(cols, g[k].sort((a, b) => natural(a.id, b.id)).map(row)); });
    if (!open.length) para('No open defects.'); }
  // ===== Appendix B: every outstanding document
  if (on('appDocs')) { page(); h1('Appendix B: Outstanding documents');
    if (!A.length) para('No building elements are loaded in Assets and warranties yet.', RED);
    else { const L = outD.slice().sort((a, b) => (hold(b) - hold(a)) || natural(a.ref || '', b.ref || ''));
      para(`${count(A, got)} of ${A.length} received. ${L.length} outstanding.`, GREY, 8.5); y -= 4;
      table([['Ref', 36], ['Element', 120], ['Installer', 85], ['Required', 105], ['Status', 70], ['What is needed', 160]], L.map(a => [a.ref || '', (a.element || '') + (a.product ? ' (' + a.product + ')' : ''), a.installer || '', [a.instWarranty, a.mfrWarranty].filter(x => x && x !== '-').join('; '), (hold(a) ? 'PC: ' : '') + (a.status || ''), a.notes || '']), { red: (ri, i) => i === 4 && (hold(L[ri]) || /Revision|Not received/.test(L[ri].status)) }); } }
  doc.setTitle(clean(title + ' - ' + (pr.name || '')));
  return new Blob([await doc.save()], { type: 'application/pdf' });
}
