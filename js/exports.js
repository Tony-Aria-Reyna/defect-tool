// Exports: PDF schedule (pdf-lib, both brands, linked), Excel register, Procore CSV, zip of everything.
import { loadScript, nzDate, todayISO, safeName, stamp } from './util.js';
import { STATUS_COLOURS as SCOL, APP } from './config.js';

const LIB = { pdflib: 'lib/pdf-lib.min.js', jszip: 'lib/jszip.min.js', xlsx: 'lib/xlsx.bundle.js' };
export const locText = d => { const a = []; if (d.block) a.push(/^(site|external)/i.test(d.block) ? d.block : 'Block ' + d.block); if (d.level) a.push(/^(ground|first|second|third|basement|level)/i.test(d.level) && !/floor|level/i.test(d.level) ? d.level + ' floor' : d.level); if (d.unit) a.push('Unit ' + d.unit); if (d.room) a.push(d.room); if (d.surface && d.surface !== 'Floor') a.push(d.surface); if (d.item) a.push(d.item); return a.join(', '); };
export const pinLabel = d => String(d.id).replace(/^[A-Z]+-0*/, '') || d.id;

function clean(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/—/g, ', ').replace(/→/g, '->').replace(/[^\n\x20-\x7e\xa0-\xff€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–˜™š›œžŸ]/g, ''); }
const hex = h => { const n = parseInt(h.slice(1), 16); return PDFLib.rgb((n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255); };

async function embedAny(doc, bytes) { const b = new Uint8Array(bytes); if (b[0] === 0x89 && b[1] === 0x50) return doc.embedPng(b); return doc.embedJpg(b); }

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
  [['Project', [pr.name, pr.address].filter(Boolean).join(', ')], ['Client', pr.client], ['Contract', pr.contract], ['Contractor', pr.contractor], ['Engineer to the Contract', pr.engineer], ['Building consent', pr.consent], ['Schedule date', nzDate(todayISO())], ['Items in this schedule', String(L.length)]].filter(r => r[1]).forEach(([k, v]) => { txt(pg, k, M, y, 9.5, fb, GREY); txt(pg, v, M + 150, y, 9.5); y -= 14; });
  y -= 10; txt(pg, 'Summary', M, y, 11, fb, NAVY); y -= 6;
  const tbl = (rows, x, yy, w) => { rows.forEach((r, i) => { const ry = yy - 14 * (i + 1); if (i === 0) pg.drawRectangle({ x, y: ry - 3, width: w, height: 14, color: NAVY }); else pg.drawRectangle({ x, y: ry - 3, width: w, height: 14, borderColor: LINE, borderWidth: 0.5 }); txt(pg, r[0], x + 5, ry + 1, 8.5, i ? f : fb, i ? undefined : P.rgb(1, 1, 1)); txt(pg, String(r[1]), x + w - 30, ry + 1, 8.5, i ? f : fb, i ? undefined : P.rgb(1, 1, 1)); }); return yy - 14 * rows.length; };
  const statuses = pr.statuses, sevs = pr.severities;
  const y1 = tbl([['Status', 'Items'], ...statuses.map(s => [s, L.filter(d => d.status === s).length]).filter(r => r[1])], M, y, 200);
  const y2 = tbl([['Severity', 'Items'], ...sevs.map(s => [s, L.filter(d => d.severity === s).length]).filter(r => r[1])], M + 220, y, 230);
  y = Math.min(y1, y2) - 18;
  txt(pg, 'How to use this schedule', M, y, 11, fb, NAVY); y -= 14;
  wrap(o.intro, f, 9, W - 2 * M).forEach(l => { txt(pg, l, M, y, 9); y -= 12; });
  if (o.sig) { y -= 16; const bw = (W - 2 * M - 20) / 2; [['Engineer to the Contract', pr.engineer || ''], ['Contractor', pr.contractor || '']].forEach(([r, n], i) => { const x = M + i * (bw + 20); pg.drawRectangle({ x, y: y - 62, width: bw, height: 62, borderColor: LINE, borderWidth: 0.8 }); txt(pg, r, x + 8, y - 14, 9, fb, NAVY); txt(pg, n, x + 8, y - 27, 9, f, GREY); txt(pg, 'Signature: ______________________________   Date: ______________', x + 8, y - 52, 9); }); }
  // ---- schedule table
  st('Writing the schedule…');
  const hasDetail = d => o.photos && ((d.photos && d.photos.some(p => p.url)) || (d.plan && d.x != null));
  const cols = [['ID', 48], ['Location', 120], ['Defect', 300], ['Severity', 82], ['Responsible', 78], ['Target', 58], ['Status', 84]];
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
  if (o.photos) {
    let dpg = null, slot = 0; const half = (H - 2 * M - HEAD - 20) / 2;
    for (const d of L.filter(hasDetail)) {
      if (!dpg || slot === 2) { dpg = newPage('Defect details'); slot = 0; } st('Detail page for ' + d.id + '…');
      const top = H - M - HEAD - 8 - slot * half; detail[d.id] = { pg: dpg, y: top }; let ty;
      dpg.drawRectangle({ x: M, y: top - half + 8, width: W - 2 * M, height: half - 4, borderColor: LINE, borderWidth: 0.7 });
      dpg.drawRectangle({ x: M, y: top - 14, width: W - 2 * M, height: 20, color: hex('#f2f4f6') }); txt(dpg, d.id + '  ' + (d.title || ''), M + 8, top - 8, 11, fb, NAVY);
      const sw = fb.widthOfTextAtSize(clean(d.status), 8); dpg.drawRectangle({ x: W - M - sw - 16, y: top - 11, width: sw + 10, height: 13, color: hex(SCOL[d.status] || '#666') }); txt(dpg, d.status, W - M - sw - 11, top - 7.5, 8, fb, P.rgb(1, 1, 1));
      ty = top - 30; const colW = 300;
      [['Location', locText(d) || '-'], ['Element', d.element || '-'], ['Severity', d.severity], ['Type / trade', [d.type, d.trade].filter(Boolean).join(' / ')], ['Responsible', (d.responsible || '') + (d.targetDate ? ', by ' + nzDate(d.targetDate) : '')], ['Raised', (nzDate(d.dateRaised) || '-') + ' (' + (d.source || '') + (d.extRef ? ' ref ' + d.extRef : '') + ')']].forEach(([k, v]) => { txt(dpg, k, M + 8, ty, 8, fb, GREY); const ls = wrap(v || '-', f, 8.5, colW - 90); ls.slice(0, 2).forEach((l, i) => txt(dpg, l, M + 90, ty - i * 10, 8.5)); ty -= 10 * Math.min(2, ls.length) + 3; });
      ty -= 4; wrap(d.desc || '', f, 8.5, colW).slice(0, 9).forEach(l => { txt(dpg, l, M + 8, ty, 8.5); ty -= 10.5; });
      if (d.action) { ty -= 3; wrap('Action: ' + d.action, fb, 8.5, colW).slice(0, 4).forEach(l => { txt(dpg, l, M + 8, ty, 8.5, fb); ty -= 10.5; }); }
      const ph = (d.photos || []).filter(p => p.url).slice(0, 3), ax = M + colW + 24, aw = W - M - 8 - ax, ah = half - 40, by = top - 24 - ah;
      const snips = []; { const p1 = d.plan && ctx.plans.find(p => p.id === d.plan); if (p1 && d.x != null) snips.push({ p: p1, x: d.x, y: d.y }); const p2 = d.plan2 && ctx.plans.find(p => p.id === d.plan2); if (p2 && d.x2 != null) snips.push({ p: p2, x: d.x2, y: d.y2 }); }
      const snip = async (sp, sx, sw, sh) => { try { const im = await getPlanImg(sp.p); const zoomDiv = sp.p.kind === 'elevation' ? 4 : 3; const sc = Math.min(sw / (im.width / zoomDiv), sh / (im.height / zoomDiv)), cw = sw / sc, ch = sh / sc;
          let cx = sp.x * im.width - cw / 2, cy = sp.y * im.height - ch / 2; cx = Math.max(0, Math.min(im.width - cw, cx)); cy = Math.max(0, Math.min(im.height - ch, cy));
          const ox = sx - cx * sc, oy = by + sh - (im.height - cy) * sc + (im.height - cy) * sc - (ch) * sc; const oy2 = by - (im.height - cy - ch) * sc;
          dpg.pushOperators(P.pushGraphicsState(), P.rectangle(sx, by, sw, sh), P.clip(), P.endPath()); dpg.drawImage(im, { x: ox, y: oy2, width: im.width * sc, height: im.height * sc }); dpg.pushOperators(P.popGraphicsState());
          const px = sx + (sp.x * im.width - cx) * sc, py = by + sh - (sp.y * im.height - cy) * sc;
          dpg.drawCircle({ x: px, y: py, size: 7, color: hex(SCOL[d.status] || '#666'), borderColor: P.rgb(1, 1, 1), borderWidth: 1.2 }); dpg.drawRectangle({ x: sx, y: by, width: sw, height: sh, borderColor: LINE, borderWidth: 0.5 }); txt(dpg, (sp.p.kind === 'elevation' ? 'On ' : 'Location on ') + (sp.p.code || sp.p.name), sx, by - 10, 7.5, f, GREY); } catch (e) { txt(dpg, 'Plan could not be loaded', sx, by + sh / 2, 8, f, GREY); } };
      const photoW = ph.length ? (snips.length ? aw * 0.58 : aw) : 0, snipW = aw - photoW - (ph.length && snips.length ? 8 : 0);
      if (ph.length) {
        const gw = (photoW - (ph.length - 1) * 6) / ph.length;
        for (let i = 0; i < ph.length; i++) { try { const im = await embedAny(doc, await ctx.getBytes(ph[i].url)); const s = Math.min(gw / im.width, ah / im.height); dpg.drawImage(im, { x: ax + i * (gw + 6) + (gw - im.width * s) / 2, y: by + (ah - im.height * s) / 2, width: im.width * s, height: im.height * s }); } catch (e) { txt(dpg, 'Photo could not be loaded', ax + i * (gw + 6), by + ah / 2, 8, f, GREY); } }
        const p = d.plan && ctx.plans.find(p => p.id === d.plan); if (p && !snips.length) txt(dpg, 'Pinned on ' + (p.code || p.name), M + 8, top - half + 16, 7.5, f, GREY);
      }
      if (snips.length) { const sx0 = ax + photoW + (ph.length ? 8 : 0), each = (snipW - (snips.length - 1) * 6) / snips.length; for (let i = 0; i < snips.length; i++) await snip(snips[i], sx0 + i * (each + 6), each, ah); }
      slot++;
    }
  }
  // ---- footers, links
  const n = pages.length, foot = `Prepared by ${APP.company}${pr.client ? ' for ' + pr.client : ''}`;
  pages.forEach((p, i) => { p.drawRectangle({ x: M, y: M - 22, width: W - 2 * M, height: 0.5, color: LINE }); txt(p, foot, M, M - 32, 7.5, f, GREY); const t = 'Page ' + (i + 1) + ' of ' + n; txt(p, t, W - M - f.widthOfTextAtSize(t, 7.5), M - 32, 7.5, f, GREY); });
  const annot = (page, dict) => { const ref = doc.context.register(doc.context.obj(dict)); let an = page.node.lookup(P.PDFName.of('Annots')); if (!an) { an = doc.context.obj([]); page.node.set(P.PDFName.of('Annots'), an); } an.push(ref); };
  const dest = t => [t.pg.ref, P.PDFName.of('XYZ'), P.PDFNull, P.PDFNumber.of(t.y + 20), P.PDFNull];
  links.forEach(l => { const t = detail[l.id]; if (t) annot(l.pg, { Type: 'Annot', Subtype: 'Link', Rect: l.r, Border: [0, 0, 0], Dest: dest(t) }); });
  Object.entries(detail).forEach(([id, t]) => { const r = rowRefs[id]; if (r) annot(t.pg, { Type: 'Annot', Subtype: 'Link', Rect: [M, t.y - 14, M + 200, t.y + 6], Border: [0, 0, 0], Dest: dest(r) }); });
  doc.setTitle(clean(o.title + ' - ' + pr.name)); doc.setAuthor(APP.company); doc.setSubject(clean(o.sub)); doc.setProducer(APP.name);
  return new Blob([await doc.save()], { type: 'application/pdf' });
}

export const COLS = [['ID', 'id'], ['Title', 'title'], ['Description', 'desc'], ['Action required', 'action'], ['Block', 'block'], ['Level', 'level'], ['Unit', 'unit'], ['Room / area', 'room'], ['Surface', 'surface'], ['Item', 'item'], ['Element', 'element'], ['Type', 'type'], ['Severity', 'severity'], ['Trade', 'trade'], ['Responsible', 'responsible'], ['Status', 'status'], ['Target date', 'targetDate'], ['Date raised', 'dateRaised'], ['Source', 'source'], ['External ref', 'extRef'], ['Plan', 'plan'], ['Photos', d => (d.photos || []).length], ['Last comment', d => { const h = (d.history || []).slice(-1)[0]; return h ? nzDate(h.t) + ' ' + h.who + ': ' + h.txt : ''; }], ['Last updated', d => d.updated ? nzDate(d.updated) : '']];
export async function buildXlsx(L, ctx) {
  if (!window.XLSX) await loadScript(LIB.xlsx);
  const val = (d, f) => typeof f === 'function' ? f(d) : f === 'plan' ? ((ctx.plans.find(p => p.id === d.plan) || {}).name || '') : (d[f] == null ? '' : d[f]);
  const head = COLS.map(c => c[0]), data = L.map(d => COLS.map(c => val(d, c[1])));
  const ws = XLSX.utils.aoa_to_sheet([[`${ctx.project.name} - Defects Register`], [`Exported ${nzDate(new Date().toISOString())} by ${ctx.me}. ${L.length} defects. Prepared by ${APP.company}${ctx.project.client ? ' for ' + ctx.project.client : ''}.`], [], head, ...data]);
  ws['!cols'] = COLS.map(c => ({ wch: { desc: 60, action: 40, title: 34 }[c[1]] || (typeof c[1] === 'function' ? 28 : 14) }));
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 3, c: 0 }, e: { r: 3 + data.length, c: head.length - 1 } }) };
  const hs = { font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '011C35' } }, alignment: { wrapText: true, vertical: 'center' } };
  head.forEach((_, i) => { const a = XLSX.utils.encode_cell({ r: 3, c: i }); if (ws[a]) ws[a].s = hs; });
  if (ws.A1) ws.A1.s = { font: { bold: true, sz: 14, color: { rgb: '011C35' } } };
  const si = COLS.findIndex(c => c[1] === 'status');
  data.forEach((row, r) => row.forEach((_, c) => { const a = XLSX.utils.encode_cell({ r: 4 + r, c }); if (ws[a]) ws[a].s = { alignment: { wrapText: true, vertical: 'top' }, ...(c === si && SCOL[row[c]] ? { fill: { fgColor: { rgb: SCOL[row[c]].slice(1).toUpperCase() } }, font: { color: { rgb: 'FFFFFF' }, bold: true } } : {}) }; }));
  const pr = ctx.project;
  const sum = [['Summary by status'], ['Status', 'Count'], ...pr.statuses.map(s => [s, L.filter(d => d.status === s).length]), [], ['Summary by severity'], ['Severity', 'Count'], ...pr.severities.map(s => [s, L.filter(d => d.severity === s).length]), [], ['Open items by trade'], ['Trade', 'Count'], ...pr.trades.map(t => [t, L.filter(d => d.trade === t && d.status !== 'Closed').length]).filter(r => r[1]), [], ['Open items by responsible party'], ['Responsible', 'Count'], ...[...new Set(L.map(d => d.responsible))].map(t => [t, L.filter(d => d.responsible === t && d.status !== 'Closed').length]).filter(r => r[1])];
  const ws2 = XLSX.utils.aoa_to_sheet(sum); ws2['!cols'] = [{ wch: 30 }, { wch: 10 }];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Defects'); XLSX.utils.book_append_sheet(wb, ws2, 'Summary');
  return new Blob([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
export function buildCsv(L) {
  const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const rows = [['Title', 'Description', 'Status', 'Location', 'Trade', 'Assignee', 'Due Date', 'Type', 'Priority', 'Reference'].map(q).join(',')];
  L.forEach(d => rows.push([d.id + ' ' + (d.title || ''), (d.desc || '') + (d.action ? ' ACTION: ' + d.action : ''), d.status === 'Closed' ? 'Closed' : d.status === 'Ready for review' ? 'Ready for Review' : 'Open', locText(d), d.trade, d.responsible, d.targetDate, d.type, /^Major/.test(d.severity || '') ? 'High' : 'Medium', d.extRef || d.source].map(q).join(',')));
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
