// Fill units from one finished unit, automatically.
// The finished unit is the template. For every other unit outline the template is tried the four ways round, lined up against
// the walls on the drawing itself, and each fixture is then nudged onto its own lines. Nothing has to be dragged or mirrored by hand.
// All coordinates are normalised (0..1) to the plan image.

const ORI = { same: [1, 1], mirror: [-1, 1], flip: [1, -1], rot180: [-1, -1] };
export const TURN_LABEL = { same: 'same way round', mirror: 'mirrored', flip: 'flipped', rot180: 'turned 180°' };
const bb = P => { let x0 = 9, y0 = 9, x1 = -9, y1 = -9; for (const q of P) { if (q[0] < x0) x0 = q[0]; if (q[1] < y0) y0 = q[1]; if (q[0] > x1) x1 = q[0]; if (q[1] > y1) y1 = q[1]; } return [x0, y0, x1, y1]; };
export const inPoly = (c, P) => { let o = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const a = P[i], b = P[j]; if ((a[1] > c[1]) !== (b[1] > c[1]) && c[0] < (b[0] - a[0]) * (c[1] - a[1]) / (b[1] - a[1]) + a[0]) o = !o; } return o; };
export const cen = P => [P.reduce((a, q) => a + q[0], 0) / P.length, P.reduce((a, q) => a + q[1], 0) / P.length];

// Distance (in pixels, capped) from every pixel to the nearest dark line on the drawing.
export function distanceMap(img, W, H) {
  const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d', { willReadFrequently: true }); x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); x.drawImage(img, 0, 0, W, H);
  const px = x.getImageData(0, 0, W, H).data, d = new Uint16Array(W * H), BIG = 60 * 3;
  for (let i = 0, k = 0; i < d.length; i++, k += 4) d[i] = (px[k] * 0.3 + px[k + 1] * 0.59 + px[k + 2] * 0.11) < 120 ? 0 : BIG;
  for (let y = 0; y < H; y++) for (let xx = 0; xx < W; xx++) { const i = y * W + xx; let v = d[i]; if (!v) continue; if (xx > 0) v = Math.min(v, d[i - 1] + 3); if (y > 0) { v = Math.min(v, d[i - W] + 3); if (xx > 0) v = Math.min(v, d[i - W - 1] + 4); if (xx < W - 1) v = Math.min(v, d[i - W + 1] + 4); } d[i] = v; }
  for (let y = H - 1; y >= 0; y--) for (let xx = W - 1; xx >= 0; xx--) { const i = y * W + xx; let v = d[i]; if (!v) continue; if (xx < W - 1) v = Math.min(v, d[i + 1] + 3); if (y < H - 1) { v = Math.min(v, d[i + W] + 3); if (xx < W - 1) v = Math.min(v, d[i + W + 1] + 4); if (xx > 0) v = Math.min(v, d[i + W - 1] + 4); } d[i] = v; }
  return { d, W, H };
}
// mean distance (px) from a shape's edges to the drawn lines
function edgeScore(M, poly, dx = 0, dy = 0) {
  const { d, W, H } = M; let tot = 0, n = 0;
  for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; const L = Math.max(2, Math.round(Math.hypot((b[0] - a[0]) * W, (b[1] - a[1]) * H) / 3));
    for (let k = 0; k < L; k++) { const xi = Math.min(W - 1, Math.max(0, Math.round((a[0] + (b[0] - a[0]) * k / L + dx) * W))), yi = Math.min(H - 1, Math.max(0, Math.round((a[1] + (b[1] - a[1]) * k / L + dy) * H))); tot += Math.min(d[yi * W + xi] / 3, 20); n++; } }
  return n ? tot / n : 99;
}
function nearOnPoly(p, P, W, H) { let best = null; const px = p[0] * W, py = p[1] * H;
  for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length], ax = a[0] * W, ay = a[1] * H, bx = b[0] * W, by = b[1] * H, l2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1; const t = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / l2)), x = ax + t * (bx - ax), y = ay + t * (by - ay), dd = Math.hypot(px - x, py - y); if (!best || dd < best.d) best = { d: dd, pt: [x / W, y / H] }; }
  return best; }

// Fit one template (outline + members, on a plan of aspect tplAspect = w/h) into one target outline, against that plan's distance map.
export function fitUnit(M, tplOutline, members, tgtOutline, opt = {}) {
  const tb = bb(tplOutline), t = bb(tgtOutline), W = M.W, H = M.H;
  // the template keeps its true size; where the two sheets are drawn at different sizes it is scaled by the outline widths
  const k = opt.scale || 1, TW = (tb[2] - tb[0]) * k, TH = (tb[3] - tb[1]) * k * (opt.aspect || 1);
  const xf = (o, anchor, dx = 0, dy = 0) => { const [mx, my] = ORI[o]; return p => { let u = (p[0] - tb[0]) * k, v = (p[1] - tb[1]) * k * (opt.aspect || 1); if (mx < 0) u = TW - u; if (my < 0) v = TH - v; return [t[0] + u + dx, (anchor === 'top' ? t[1] : t[3] - TH) + v + dy]; }; };
  const polys = members.map(m => m.poly), all = f => polys.reduce((a, P) => a + edgeScore(M, P.map(f)), 0) / (polys.length || 1);
  const cands = []; for (const o of (opt.turns || Object.keys(ORI))) for (const a of ['top', 'bottom']) cands.push({ o, a, s: all(xf(o, a)) });
  cands.sort((x, y) => x.s - y.s);
  let best = null;
  for (const c of cands.slice(0, 3)) { let bv = { s: c.s, dx: 0, dy: 0 };
    for (const [step, r] of [[3, 6], [1, 3]]) { const cx = bv.dx, cy = bv.dy; for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) { const dx = cx + i * step / W, dy = cy + j * step / H, s = all(xf(c.o, c.a, dx, dy)); if (s < bv.s) bv = { s, dx, dy }; } }
    if (!best || bv.s < best.s) best = { ...bv, o: c.o, a: c.a }; }
  const other = cands.find(c => c.o !== best.o), f = xf(best.o, best.a, best.dx, best.dy), rev = ORI[best.o][0] * ORI[best.o][1] < 0;
  let outside = 0, itemsBefore = 0, itemsAfter = 0, nItems = 0; const zones = [];
  for (const m of members) { let poly = m.poly.map(f); if (rev) poly.reverse();
    if (m.kind === 'item') {   // each fixture is lined up on its own lines, preferring the smallest move that fits
      const b0 = edgeScore(M, poly); let bv = { s: b0, dx: 0, dy: 0 }; const r = 9;
      for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) { const s = edgeScore(M, poly, i / W, j / H) + 0.012 * Math.hypot(i, j); if (s < bv.s) bv = { s, dx: i / W, dy: j / H }; }
      poly = poly.map(q => [q[0] + bv.dx, q[1] + bv.dy]); itemsBefore += b0; itemsAfter += edgeScore(M, poly); nItems++;
    } else poly = poly.map(q => { const nr = nearOnPoly(q, tgtOutline, W, H); if (nr.d <= 9) return nr.pt; if (!inPoly(q, tgtOutline)) outside = Math.max(outside, nr.d); return q; });
    zones.push({ kind: m.kind, name: m.name || '', room: m.room || '', poly: poly.map(q => [+q[0].toFixed(5), +q[1].toFixed(5)]) }); }
  return { turn: best.o, score: best.s, margin: other ? other.s / Math.max(best.s, 0.01) : 9, outside, itemsBefore: nItems ? itemsBefore / nItems : 0, itemsAfter: nItems ? itemsAfter / nItems : 0, zones };
}
