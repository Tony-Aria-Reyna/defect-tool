// Building faces: work out where an elevation sits on the floor plan.
// A face is rarely one straight line. Decks step out, entries step back, a wing returns at 90 degrees. So a link between an
// elevation and a floor plan carries a path: a stepped polyline along the outside of the building on the floor plan, derived
// automatically from the wall lines on the drawing. Elevation x is mapped onto the plan through the grid bubbles the two
// drawings share (piecewise, so uneven grid spacing on either sheet does not matter), then dropped onto the path.
//
// Conventions: side is 'top' | 'bottom' | 'left' | 'right' (where the face sits on the floor plan sheet). The coordinate that runs
// along the face is u (plan x for top/bottom, plan y for left/right); the one across it is v.

export const GRID_RE = /^[A-Z]{1,2}\d{0,2}$|^\d{1,2}$/;
// A drawing title such as "Block A West Elevation" or "North Elevation 1": short, no dashes or commas, singular.
export const isElevTitle = t => /\belevation\b/i.test(t) && !/[-,:;]|plan|section|schedule|notes|refer|where|shown|typical/i.test(t) && t.trim().split(/\s+/).length <= 7;
export const isAlong = (side) => side === 'top' || side === 'bottom';
export const toUV = (side, p) => isAlong(side) ? [p[0], p[1]] : [p[1], p[0]];
export const fromUV = (side, u, v) => isAlong(side) ? [u, v] : [v, u];
// inward direction across the face, in v
export const inward = (side) => (side === 'top' || side === 'left') ? 1 : -1;

// Stepped outline of the building on the chosen side, between u0 and u1, from the drawing's wall lines.
// lines: flat [x1,y1,x2,y2,...] normalised; vr: [vmin,vmax] band across the face to look in (the grid box, padded).
export function deriveFacePath(lines, side, along, vr, opt = {}) {
  if (!lines || lines.length < 8) return null;
  const pad = opt.pad == null ? 0.02 : opt.pad, step = 0.002, tol = 0.004, minRun = opt.minRun || 0.015;
  const segs = [];
  for (let i = 0; i + 3 < lines.length; i += 4) {
    const a = toUV(side, [lines[i], lines[i + 1]]), b = toUV(side, [lines[i + 2], lines[i + 3]]);
    if (Math.abs(a[1] - b[1]) >= 0.0015 || Math.abs(a[0] - b[0]) < 0.008) continue;   // along the face only, not tiny
    const s = { u0: Math.min(a[0], b[0]), u1: Math.max(a[0], b[0]), v: (a[1] + b[1]) / 2 };
    if (s.u1 <= along[0] - pad || s.u0 >= along[1] + pad) continue;
    if (vr && (s.v < vr[0] || s.v > vr[1])) continue;
    segs.push(s);
  }
  // keep only walls: a line with a parallel partner a wall's thickness away, overlapping it along most of its length
  const walls = segs.filter(a => segs.some(b => { const d = Math.abs(a.v - b.v); if (d < 0.0015 || d > 0.015) return false; const ov = Math.min(a.u1, b.u1) - Math.max(a.u0, b.u0); return ov >= 0.5 * Math.min(a.u1 - a.u0, b.u1 - b.u0); }));
  if (!walls.length) return null;
  const outer = (side === 'top' || side === 'left') ? Math.min : Math.max;
  // room boundaries, when the plan has them, say where the building is: the face is the wall just outside the boundary; where there
  // is no boundary (a lobby, a stair) the outermost wall in the band is used
  const zedges = []; (opt.zones || []).forEach(z => { if (!z.poly || z.poly.length < 3 || (z.kind !== 'unit' && z.kind !== 'room' && z.kind !== 'area')) return; z.poly.forEach((p, i) => { const a = toUV(side, p), b = toUV(side, z.poly[(i + 1) % z.poly.length]); zedges.push({ u0: Math.min(a[0], b[0]), u1: Math.max(a[0], b[0]), va: a[1], vb: b[1], ua: a[0], ub: b[0] }); }); });
  const zoneV = u => { const vs = zedges.filter(e => e.u0 <= u && u <= e.u1 && e.u1 - e.u0 > 1e-6).map(e => e.va + (u - e.ua) / (e.ub - e.ua) * (e.vb - e.va)); return vs.length ? outer(...vs) : null; };
  const n = Math.floor((along[1] - along[0]) / step) + 1, runs = [];
  for (let i = 0; i < n; i++) {
    const u = along[0] + i * step, zv = zedges.length ? zoneV(u) : null, inw = inward(side);
    let vs = walls.filter(s => s.u0 - 0.001 <= u && u <= s.u1 + 0.001).map(s => s.v), v;
    if (zv != null) {
      // the face is the outer side of the wall that backs the room boundary; decks, fences and eaves further out are not the face
      const near = vs.filter(x => (zv - x) * inw >= -0.004 && Math.abs(x - zv) <= 0.03);
      v = near.length ? outer(...near) : zv;
    } else { if (!vs.length) continue; v = outer(...vs); }
    const r = runs[runs.length - 1];
    if (r && Math.abs(r.v - v) < tol && u - r.u1 <= step * 1.5) { r.u1 = u; r.v = (r.v * r.k + v) / (r.k + 1); r.k++; } else runs.push({ u0: u, u1: u, v, k: 1 });
  }
  // short blips (door reveals, text) merge into the neighbour they are closest to
  let ch = true;
  while (ch && runs.length > 1) {
    ch = false;
    for (let i = 0; i < runs.length; i++) {
      const r = runs[i]; if (r.u1 - r.u0 >= minRun) continue;
      const prev = runs[i - 1], next = runs[i + 1];
      const nb = prev && (!next || Math.abs(prev.v - r.v) <= Math.abs(next.v - r.v)) ? prev : next;
      nb.u0 = Math.min(nb.u0, r.u0); nb.u1 = Math.max(nb.u1, r.u1); runs.splice(i, 1); ch = true; break;
    }
  }
  if (!runs.length) return null;
  const pts = [];
  runs.forEach((r, i) => { const a = i ? (runs[i - 1].u1 + r.u0) / 2 : r.u0, b = i < runs.length - 1 ? (r.u1 + runs[i + 1].u0) / 2 : r.u1; pts.push(fromUV(side, a, r.v), fromUV(side, b, r.v)); });
  return pts.map(p => [+p[0].toFixed(4), +p[1].toFixed(4)]);
}

// Point on a face path at along-coordinate u (clamped to the path's extent). Returns [x,y] on the plan.
export function pathAt(path, side, u) {
  if (!path || path.length < 2) return null;
  const uv = path.map(p => toUV(side, p)); let best = null;
  for (let i = 0; i + 1 < uv.length; i++) {
    const a = uv[i], b = uv[i + 1], lo = Math.min(a[0], b[0]), hi = Math.max(a[0], b[0]);
    if (u >= lo - 1e-6 && u <= hi + 1e-6) { if (hi - lo < 1e-6) { best = a; break; } const t = (u - a[0]) / (b[0] - a[0]); best = [u, a[1] + t * (b[1] - a[1])]; break; }
  }
  if (!best) { const first = uv[0], last = uv[uv.length - 1]; const lo = Math.min(first[0], last[0]), hi = Math.max(first[0], last[0]); best = u < lo ? (first[0] < last[0] ? first : last) : (first[0] > last[0] ? first : last); best = [u, best[1]]; }
  return fromUV(side, best[0], best[1]);
}

// Map elevation x to plan u through shared grids: gmap = [[ex, u], ...]. Piecewise linear, extrapolated at the ends.
export function gridMap(gmap, ex) {
  const g = gmap.slice().sort((a, b) => a[0] - b[0]); if (g.length < 2) return null;
  let i = 0; while (i < g.length - 2 && ex > g[i + 1][0]) i++;
  const [x0, u0] = g[i], [x1, u1] = g[i + 1]; return u0 + (ex - x0) / ((x1 - x0) || 1) * (u1 - u0);
}

// Group grid bubbles into rows (same y) or columns (same x). Returns [{ pos, items:[...] }] with at least `min` lettered labels.
export function gridRows(grids, axis = 'y', min = 2, tol = 0.012) {
  const rows = [];
  (grids || []).filter(g => GRID_RE.test(g.l)).sort((a, b) => a[axis] - b[axis]).forEach(g => { const r = rows[rows.length - 1]; if (r && Math.abs(r.pos - g[axis]) <= tol) { r.items.push(g); r.pos = (r.pos * (r.items.length - 1) + g[axis]) / r.items.length; } else rows.push({ pos: g[axis], items: [g] }); });
  return rows.filter(r => r.items.filter(g => /[A-Z]/.test(g.l)).length >= min);
}

// Working out one face link from an elevation drawing (its grid bubbles along one row, between bandX) and a floor plan.
// Returns { side, axis, gmap, a, b, ea, eb, path, grids } or null.
export function faceFromGrids(ep, fp, rowItems, band, bandX, opt = {}) {
  const used = {}; (fp.grids || []).filter(g => GRID_RE.test(g.l)).forEach(g => { (used[g.l] = used[g.l] || []).push(g); });
  let pairs = rowItems.filter(g => used[g.l] && (!bandX || (g.x >= bandX[0] && g.x <= bandX[1])));
  const seen = new Set(); pairs = pairs.sort((a, b) => a.x - b.x).filter(g => !seen.has(g.l) && seen.add(g.l));
  const alpha = pairs.filter(g => /[A-Z]/.test(g.l)); if (alpha.length >= 2) pairs = alpha;
  if (pairs.length < 2) return null;
  // on the floor plan each label may appear at both ends of its grid line; the line's position is the coordinate they share
  const pos = {}; pairs.forEach(g => { const gs = used[g.l]; const xs = gs.map(q => q.x), ys = gs.map(q => q.y); pos[g.l] = { x: median(xs), y: median(ys), sx: spread(xs), sy: spread(ys) }; });
  // grids spread along x on the plan run across the sheet -> face is top or bottom; spread along y -> left or right
  const L = pairs[0], R = pairs[pairs.length - 1];
  const dx = Math.abs(pos[R.l].x - pos[L.l].x), dy = Math.abs(pos[R.l].y - pos[L.l].y), axis = dx >= dy ? 'x' : 'y';
  const uOf = l => axis === 'x' ? pos[l].x : pos[l].y;
  const sameOrder = uOf(R.l) > uOf(L.l);
  // looking at the near face, plan u runs the same way as the elevation when the viewer stands at the bottom (or left) of the sheet
  const side = axis === 'x' ? (sameOrder ? 'bottom' : 'top') : (sameOrder ? 'left' : 'right');
  const gmap = pairs.map(g => [+g.x.toFixed(4), +uOf(g.l).toFixed(4)]);
  const us = gmap.map(p => p[1]), along = [Math.min(...us) - 0.03, Math.max(...us) + 0.03];
  // band across the face: the extent of the crossing grids, padded, else the whole sheet
  // crossing grids are the other kind of label in the same series: A1..A6 across AA..AK, numbers across letters, letters across numbers
  const sample = L.l, crossRe = /^[A-Z]{2}$/.test(sample) ? new RegExp('^' + sample[0] + '\\d{1,2}$') : /^[A-Z]{1,2}\d{1,2}$/.test(sample) ? new RegExp('^' + sample.replace(/\d+$/, '') + '[A-Z]$') : /^[A-Z]$/.test(sample) ? /^\d{1,2}$/ : /^[A-Z]{1,2}$/;
  const cross = (fp.grids || []).filter(g => crossRe.test(g.l) && !pos[g.l]); const cv = cross.map(g => axis === 'x' ? g.y : g.x).filter(v => v > 0.05 && v < 0.95);
  const vr = cv.length >= 2 ? [Math.max(0.03, Math.min(...cv) - 0.1), Math.min(0.97, Math.max(...cv) + 0.1)] : [0.05, 0.95];
  const path = opt.noPath ? null : deriveFacePath(fp.lines, side, along, vr, { zones: fp.zones });
  const vFace = path ? median(path.map(p => toUV(side, p)[1])) : (opt.v != null ? opt.v : (vr[0] + vr[1]) / 2);
  const a = fromUV(side, uOf(L.l), vFace), b = fromUV(side, uOf(R.l), vFace);
  return { side, axis, gmap, a, b, ea: L.x, eb: R.x, path, grids: [L.l, R.l], band, bandX };
}
const median = a => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const spread = a => Math.max(...a) - Math.min(...a);

// Read the drawings on an elevation sheet from its text labels and grid bubbles.
// labels: [{ t, x, y }] text on the sheet. Returns [{ title, block, face, titleY, row:{pos,items}, x0, x1, y0, y1, levels:[{y, name}] }]
export function readElevationSheet(ep) {
  const labels = ep.labels || [], titles = labels.filter(l => isElevTitle(l.t));
  const rows = gridRows(ep.grids, 'y', 2);
  const out = [];
  for (const t of titles) {
    // the grid row for this drawing: nearest row above the title (bubbles sit above elevations)
    // the grid row for this drawing: nearest row above the title that spans the title's position across the sheet
    const spans = r => { const xs = r.items.map(g => g.x); return t.x >= Math.min(...xs) - 0.12 && t.x <= Math.max(...xs) + 0.12; };
    const above = rows.filter(r => r.pos < t.y).sort((a, b) => b.pos - a.pos), row = above.find(spans) || above[0]; if (!row) continue;
    const xs = row.items.map(g => g.x); const x0 = Math.min(...xs) - 0.04, x1 = Math.max(...xs) + 0.04;
    const y0 = row.pos, y1 = t.y;
    // level markers inside the drawing: reduced levels like 34,600 / RL 34.600 / FFL, or floor names
    const marks = labels.filter(l => l.y > y0 && l.y < y1 && (l.x > x0 - 0.12 && l.x < x1 + 0.12) && (/^(RL|FFL|FL)?\s*\d{1,3}[.,]\d{3}$/i.test(l.t) || /^(ground|first|second|third|fourth|lower|upper)\s*(floor|level)?$|^level\s*\d|^L\d$/i.test(l.t)));
    const ym = {}; marks.forEach(m => { const k = m.y.toFixed(2); if (!ym[k]) ym[k] = m; }); const levels = Object.values(ym).sort((a, b) => a.y - b.y).map(m => ({ y: m.y, name: m.t }));
    const block = (/block\s*([A-Z0-9]+)/i.exec(t.t) || [])[1] || (/building\s*([A-Z0-9]+)/i.exec(t.t) || [])[1] || '';
    const face = (/(north|south|east|west)/i.exec(t.t) || [])[1] || ''; const faceName = face ? face[0].toUpperCase() + face.slice(1).toLowerCase() : '';
    out.push({ title: t.t, block, face: faceName, titleY: t.y, row, x0, x1, y0, y1, levels });
  }
  return out;
}

// Storey bands for a drawing: from level markers when there are enough, else equal bands between the grid row and the title.
export function storeyBands(dr, nStoreys) {
  const top = dr.y0 + 0.02, bottom = dr.titleY - 0.015;
  let marks = dr.levels.filter(l => l.y > top && l.y < bottom);
  // reduced levels: floor levels sit at a regular storey height (2.4 to 4.5 m), so keep the longest evenly spaced chain and drop
  // roof, parapet, retaining and split-level marks
  const rl = marks.map(l => ({ y: l.y, v: parseFloat(String(l.name).replace(/^(RL|FFL|FL)\s*/i, '').replace(/,/g, '')) })).filter(m => !isNaN(m.v));
  if (rl.length >= 2) {
    const vals = [...new Set(rl.map(m => m.v))].sort((a, b) => a - b); let best = [];
    for (let i = 0; i < vals.length; i++) for (let j = i + 1; j < vals.length; j++) { const d = vals[j] - vals[i]; if (d < 2.4 || d > 4.5) { if (d < 2400 || d > 4500) continue; } const chain = [vals[i], vals[j]]; let cur = vals[j]; for (;;) { const nx = vals.find(v => v > cur && Math.abs(v - cur - d) <= Math.max(0.15, d * 0.05)); if (nx == null) break; chain.push(nx); cur = nx; } if (chain.length > best.length || (chain.length === best.length && chain[0] < best[0])) best = chain; }
    if (best.length >= 2) { const keep = new Set(best); marks = rl.filter(m => keep.has(m.v)).map(m => ({ y: m.y })); }
  }
  const ys = [...new Set(marks.map(l => +l.y.toFixed(3)))].sort((a, b) => a - b);
  // markers mark floor levels (and usually the roof or ceiling above the top floor): bands run from one marker down to the next;
  // the ground band runs to the bottom of the drawing so a lower split level still counts as ground
  if (ys.length >= nStoreys + 1) { const use = ys.slice(-(nStoreys + 1)); return use.slice(0, -1).map((y, i) => [y, i === nStoreys - 1 ? bottom : use[i + 1]]).reverse(); }
  if (ys.length === nStoreys && nStoreys > 1) { const bands = ys.slice(0, -1).map((y, i) => [y, i === nStoreys - 2 ? bottom : ys[i + 1]]); bands.unshift([top, ys[0]]); return bands.reverse(); }
  const h = (bottom - top) / nStoreys; return Array.from({ length: nStoreys }, (_, i) => [bottom - (i + 1) * h, bottom - i * h]);   // ground first
}
