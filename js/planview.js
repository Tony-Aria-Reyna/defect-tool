// Plan viewer: pan / pinch / wheel zoom, defect pins, and room boundaries (view, draw, edit, move).
import { esc } from './util.js';

const PIN = c => `<svg viewBox="0 0 28 36"><path d="M14 0C6.3 0 0 6.1 0 13.7 0 24 14 36 14 36s14-12 14-22.3C28 6.1 21.7 0 14 0z" fill="${c}" stroke="#fff" stroke-width="1.5"/></svg>`;
const NS = 'http://www.w3.org/2000/svg';

export class PlanView {
  constructor(vp, o = {}) {
    this.vp = vp; this.o = o; this.pv = { s: 1, x: 0, y: 0 }; this.plan = null; this.pins = []; this.zones = []; this.showZones = false;
    this.mode = 'view'; this.draft = null; this.selZone = null; this.moveZone = false; this.altDown = false;
    addEventListener('keydown', e => { if (e.key === 'Alt') this.altDown = true; }); addEventListener('keyup', e => { if (e.key === 'Alt') this.altDown = false; }); addEventListener('blur', () => { this.altDown = false; });
    try { if (location.search.includes('demo')) window.__pv = this; } catch (e) {}   // demo mode only: handle for automated tests
    vp.classList.add('planvp');
    vp.innerHTML = `<div class="inner"><img alt=""><svg class="zsvg" xmlns="${NS}"></svg><div class="pins"></div></div>
      <div class="banner"></div><div class="zoombar"><button id="zfull" title="Full screen">⛶</button><button data-z="in">+</button><button data-z="out">−</button><button data-z="fit" title="Fit">⤢</button></div>
      <div class="pvempty">No plan uploaded yet</div>`;
    this.inner = vp.querySelector('.inner'); this.img = vp.querySelector('img'); this.svg = vp.querySelector('svg'); this.pinsEl = vp.querySelector('.pins'); this.bannerEl = vp.querySelector('.banner');
    vp.querySelectorAll('[data-z]').forEach(b => b.onclick = e => { e.stopPropagation(); const r = vp.getBoundingClientRect(); if (b.dataset.z === 'fit') this.fit(); else this.zoomAt(r.width / 2, r.height / 2, b.dataset.z === 'in' ? 1.4 : 1 / 1.4); });
    this._events();
    new ResizeObserver(() => { if (!this.pv.user) this.fit(); }).observe(vp);
  }
  _events() {
    const vp = this.vp, pts = new Map(); let st = null, moved = 0, pinch = null, drag = null;
    vp.addEventListener('pointerdown', e => {
      if (e.target.closest('.zoombar,.banner')) return;
      vp.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) {
        st = { x: e.clientX, y: e.clientY, px: this.pv.x, py: this.pv.y, t: Date.now(), target: e.target, tol: e.pointerType === 'touch' ? 12 : 4 }; moved = 0; drag = null;
        const v = e.target.closest && e.target.closest('[data-v]');
        const pinEl = e.target.closest && e.target.closest('.pin');
        if (this.mode === 'view' && pinEl && this.o.canDragPins && this.o.canDragPins()) {
          if (e.pointerType === 'touch') { clearTimeout(this._hold); this._hold = setTimeout(() => { if (st && moved <= st.tol && pts.size === 1) { drag = { kind: 'p', id: pinEl.dataset.id, el: pinEl }; pinEl.classList.add('dragging'); try { navigator.vibrate && navigator.vibrate(30); } catch (x) {} } }, 420); }
          else drag = { kind: 'p', id: pinEl.dataset.id, el: pinEl, pending: true };
        }
        const gh = e.target.closest && e.target.closest('[data-gh]');
        if (this.mode === 'zones' && gh && this.multi.size) { const bb = this.groupBox(); drag = { kind: 'gs', h: +gh.dataset.gh, box: bb, origs: new Map([...this.multi].map(id => { const z = this.zones.find(q => q.id === id); return [id, z ? z.poly.map(p => p.slice()) : null]; })) }; this.o.onEditStart && this.o.onEditStart(); }
        else if (this.mode === 'zones' && v && this.selZone) { const i = +v.dataset.v, p0 = this.selZone.poly[i], tol = 7 / this.pv.s; const shared = this.join === false ? [] : (() => { const out = []; this.zones.forEach(z => { if (!z.poly) return; z.poly.forEach((q, j) => { if (z === this.selZone && j === i) return; if (Math.abs((q[0] - p0[0]) * this.plan.w) < tol && Math.abs((q[1] - p0[1]) * this.plan.h) < tol) out.push([z, j]); }); }); return out; })(); drag = { kind: 'v', i, shared }; this.o.onEditStart && this.o.onEditStart(); }
        else if (this.mode === 'zones' && this.multi && this.multi.size && !v && (() => { const n0 = this._norm(e); return this.zones.some(z => this.multi.has(z.id) && z.poly && z.poly.length > 2 && inPoly(n0.x, n0.y, z.poly)); })()) { drag = { kind: 'g', start: this._norm(e), origs: new Map([...this.multi].map(id => { const z = this.zones.find(q => q.id === id); return [id, z ? z.poly.map(p => p.slice()) : null]; })) }; this.o.onEditStart && this.o.onEditStart(); }
        else if (this.mode === 'zones' && this.marquee && !v && !this._zoneAt(e)) { drag = { kind: 'm', start: this._norm(e), cur: null }; }
        else if (this.mode === 'zones' && this.moveZone && this.selZone && this._zoneAt(e)?.id === this.selZone.id) { drag = { kind: 'z', start: this._norm(e), orig: this.selZone.poly.map(p => p.slice()) }; this.o.onEditStart && this.o.onEditStart(); this.o.onZoneDragStart && this.o.onZoneDragStart(this.selZone); }
        else if (this.mode === 'zones' && !v && this.selZone && this.selZone.poly && this.selZone.kind !== 'band') {
          // pressing on a wall of the selected shape and dragging slides that whole wall; a tap without dragging still adds a corner
          const ed = this._edgeAt(this._norm(e)); if (ed) { const P = this.selZone.poly, ia = ed.i, ib = (ed.i + 1) % P.length; drag = { kind: 'e', ia, ib, pending: true, start: this._norm(e), orig: P.map(q => q.slice()), shA: this._sharedAt(P[ia], this.selZone, ia), shB: this._sharedAt(P[ib], this.selZone, ib) }; }
        }
        this._dragKind = drag && drag.kind;
      } else if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: this.pv.s, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, px: this.pv.x, py: this.pv.y }; moved = 99; drag = null; }
    });
    vp.addEventListener('pointermove', e => {
      if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2 && pinch) { const [a, b] = [...pts.values()], r = vp.getBoundingClientRect(), ns = this._clamp(pinch.s * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d), cx = pinch.cx - r.left, cy = pinch.cy - r.top; this.pv.x = cx - (cx - pinch.px) * ns / pinch.s; this.pv.y = cy - (cy - pinch.py) * ns / pinch.s; this.pv.s = ns; this.pv.user = 1; this._apply(); return; }
      if (pts.size !== 1 || !st) return;
      const dx = e.clientX - st.x, dy = e.clientY - st.y; moved = Math.max(moved, Math.hypot(dx, dy));
      if (moved <= st.tol) return;
      if (this._hold) { clearTimeout(this._hold); this._hold = null; }
      if (drag && drag.kind === 'p' && drag.pending && e.pointerType === 'touch') drag = null;
      if (drag && drag.kind === 'gs') { this._scaleGroup(drag, this._norm(e)); this._drawZones(); return; }
      if (drag && drag.kind === 'e') { if (drag.pending) { drag.pending = false; this.o.onEditStart && this.o.onEditStart(); } this._slideEdge(drag, this._norm(e)); this._drawZones(); this.o.onZoneEdit && this.o.onZoneEdit(this.selZone, 'v'); return; }
      if (drag && drag.kind === 'p') { if (drag.pending) { drag.pending = false; drag.el.classList.add('dragging'); } const n = this._norm(e); drag.cur = n; drag.el.style.left = (n.x * this.plan.w) + 'px'; drag.el.style.top = (n.y * this.plan.h) + 'px'; if (this.o.pinDragLabel) { if (!this._tag) { this._tag = document.createElement('div'); this._tag.className = 'dragtag'; document.body.appendChild(this._tag); } const off = n.x < 0 || n.x > 1 || n.y < 0 || n.y > 1; this._tag.textContent = off ? 'Off the plan: let go to cancel' : (this.o.pinDragLabel(drag.id, n.x, n.y) || 'No unit or room here'); this._tag.style.left = e.clientX + 'px'; this._tag.style.top = (e.clientY - (e.pointerType === 'touch' ? 46 : 14)) + 'px'; } }
      else if (drag && drag.kind === 'v') { const n = this._norm(e); const al = this._align(this.selZone, drag.i, [n.x, n.y]); n.x = al[0]; n.y = al[1]; const old = this.selZone.poly[drag.i]; this.selZone.poly[drag.i] = [n.x, n.y]; if (this.selZone.kind === 'band' && this.selZone.poly.length === 4) this._rect(this.selZone.poly, drag.i, old); drag.shared.forEach(([z, j]) => { z.poly[j] = [n.x, n.y]; }); this._drawZones(); this.o.onZoneEdit && this.o.onZoneEdit(this.selZone, 'v'); }
      else if (drag && drag.kind === 'g') { const n = this._norm(e), ddx = n.x - drag.start.x, ddy = n.y - drag.start.y; drag.origs.forEach((orig, id) => { const z = this.zones.find(q => q.id === id); if (z && orig) z.poly = orig.map(p => [p[0] + ddx, p[1] + ddy]); }); this._drawZones(); }
      else if (drag && drag.kind === 'm') { const n = this._norm(e); drag.cur = n; this._drawZones(drag); }
      else if (drag && drag.kind === 'z') { const n = this._norm(e), ddx = n.x - drag.start.x, ddy = n.y - drag.start.y; this.selZone.poly = drag.orig.map(p => [p[0] + ddx, p[1] + ddy]); this.o.onZoneEdit && this.o.onZoneEdit(this.selZone, 'z', ddx, ddy); this._drawZones(); }
      else { this.pv.x = st.px + dx; this.pv.y = st.py + dy; this.pv.user = 1; this._apply(); }
    });
    const up = e => { if (!pts.has(e.pointerId)) return; pts.delete(e.pointerId); if (pts.size < 2) pinch = null;
      if (pts.size === 1) { const r = [...pts.values()][0]; st = { x: r.x, y: r.y, px: this.pv.x, py: this.pv.y, t: 0, target: null, tol: 12 }; moved = 99; drag = null; }
      clearTimeout(this._hold); this._hold = null; if (this._tag) { this._tag.remove(); this._tag = null; }
      if (pts.size === 0 && st) { if (drag && drag.kind === 'p') { drag.el.classList.remove('dragging'); if (drag.cur && !drag.pending) { const n = drag.cur; if (n.x >= 0 && n.x <= 1 && n.y >= 0 && n.y <= 1) this.o.onPinMoved && this.o.onPinMoved(drag.id, n.x, n.y); else this._drawPins(); } else if (moved <= st.tol && Date.now() - st.t < 1200) this._tap(e, st.target); }
        else if (moved <= st.tol && Date.now() - st.t < 1200) this._tap(e, st.target);
        else if (drag && drag.kind === 'v' && this.selZone) { const n = this._norm(e), sn = this._snap(n, this.selZone, drag.i); if (sn.snapped) { if (sn.snapped !== 'corner') { const al = this._align(this.selZone, drag.i, [sn.x, sn.y]); sn.x = al[0]; sn.y = al[1]; } const old = this.selZone.poly[drag.i]; this.selZone.poly[drag.i] = [sn.x, sn.y]; if (this.selZone.kind === 'band' && this.selZone.poly.length === 4) this._rect(this.selZone.poly, drag.i, old); drag.shared.forEach(([z, j]) => { z.poly[j] = [sn.x, sn.y]; }); this._drawZones(); this.o.onZoneEdit && this.o.onZoneEdit(this.selZone, 'v'); } }
        else if (drag && drag.kind === 'e' && !drag.pending) { this._drawZones(); this.o.onZoneEdit && this.o.onZoneEdit(this.selZone, 'v'); }
        else if (drag && drag.kind === 'z' && this.selZone) { if (this._snapShape(this.selZone)) { this._drawZones(); this.o.onZoneEdit && this.o.onZoneEdit(this.selZone, 'z', 0, 0); } }
        else if (drag && drag.kind === 'g') { this._snapGroup(); this._drawZones(); this.o.onGroupMoved && this.o.onGroupMoved([...this.multi]); }
        else if (drag && drag.kind === 'gs') { this._drawZones(); this.o.onGroupMoved && this.o.onGroupMoved([...this.multi]); }
        else if (drag && drag.kind === 'm') { if (drag.cur) { const x0 = Math.min(drag.start.x, drag.cur.x), x1 = Math.max(drag.start.x, drag.cur.x), y0 = Math.min(drag.start.y, drag.cur.y), y1 = Math.max(drag.start.y, drag.cur.y); const hide = this.hideKinds || new Set(); this.zones.forEach(z => { if (!z.poly || hide.has(z.kind)) return; const inside = z.poly.every(p => p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1); if (inside) this.multi.add(z.id); }); } this._drawZones(); this.o.onMultiChange && this.o.onMultiChange([...this.multi]); }
        st = null; drag = null; } };
    vp.addEventListener('pointerup', up); vp.addEventListener('pointercancel', up);
    vp.addEventListener('wheel', e => { e.preventDefault(); const r = vp.getBoundingClientRect(); this.zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
  }
  // Snap a plan-normalised point to an existing corner, or onto an existing boundary line (a new shared corner is added to that line).
  // Snap a whole shape after a move: the corner that lands closest to something snaps, and the shape shifts with it.
  setMulti(ids) { this.multi = new Set(ids || []); this._drawZones(); }
  // Weld a group to what surrounds it: every corner of the group that sits close to a corner (or a wall) of a shape outside the
  // group is moved onto it, so there are no slivers left between them. Returns how many corners were joined.
  weldGroup(tolPx) {
    const W = this.plan.w, H = this.plan.h, ids = this.multi, tol = (tolPx || 18) / this.pv.s; let n = 0;
    const outside = this.zones.filter(z => z.poly && z.poly.length > 1 && !ids.has(z.id) && z.kind !== 'face' && z.kind !== 'band' && z.kind !== 'bandro');
    ids.forEach(id => { const z = this.zones.find(q => q.id === id); if (!z || !z.poly) return;
      z.poly.forEach((p, i) => {
        let best = null;
        outside.forEach(o => o.poly.forEach(q => { const d = Math.hypot((q[0] - p[0]) * W, (q[1] - p[1]) * H); if (d < tol && d > 1e-9 && (!best || d < best.d)) best = { d, pt: [q[0], q[1]] }; }));
        if (!best) outside.forEach(o => { const P = o.poly; for (let k = 0; k < P.length - (o.kind === 'face' ? 1 : 0); k++) { const a = P[k], b = P[(k + 1) % P.length], ax = a[0] * W, ay = a[1] * H, bx = b[0] * W, by = b[1] * H, px = p[0] * W, py = p[1] * H, l2 = (bx - ax) ** 2 + (by - ay) ** 2; if (!l2) continue; const t = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / l2)); const sx = ax + t * (bx - ax), sy = ay + t * (by - ay), d = Math.hypot(px - sx, py - sy); if (d < tol && d > 1e-9 && (!best || d < best.d)) best = { d, pt: [sx / W, sy / H], zone: o, after: k, t }; } });
        if (!best) return;
        // corners of the group that sat on this one travel with it, so the group stays joined up inside as well
        const old = [p[0], p[1]];
        ids.forEach(jd => { const q = this.zones.find(x => x.id === jd); if (!q || !q.poly) return; q.poly.forEach((r, j) => { if (Math.abs((r[0] - old[0]) * W) < 1 && Math.abs((r[1] - old[1]) * H) < 1) q.poly[j] = [best.pt[0], best.pt[1]]; }); });
        if (best.zone && best.t > 0.02 && best.t < 0.98) best.zone.poly.splice(best.after + 1, 0, [best.pt[0], best.pt[1]]);   // the wall gains a shared corner
        n++; }); });
    if (n) this._drawZones();
    return n;
  }
  groupBox() { let x0 = 9, y0 = 9, x1 = -9, y1 = -9, any = false;
    this.multi.forEach(id => { const z = this.zones.find(q => q.id === id); if (!z || !z.poly) return; any = true; z.poly.forEach(p => { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }); });
    return any ? { x0, y0, x1, y1 } : null; }
  // scale everything in the selection; the handle opposite the one being dragged stays put
  _scaleGroup(d, n) {
    const b = d.box, h = d.h, W = this.plan.w, H = this.plan.h, min = 12 / W;
    const left = [0, 6, 7].includes(h), right = [2, 3, 4].includes(h), top = [0, 1, 2].includes(h), bottom = [4, 5, 6].includes(h);
    let nx0 = b.x0, nx1 = b.x1, ny0 = b.y0, ny1 = b.y1;
    if (left) nx0 = Math.min(n.x, b.x1 - min); if (right) nx1 = Math.max(n.x, b.x0 + min);
    if (top) ny0 = Math.min(n.y, b.y1 - min * H / W); if (bottom) ny1 = Math.max(n.y, b.y0 + min * H / W);
    const sx = (nx1 - nx0) / ((b.x1 - b.x0) || 1), sy = (ny1 - ny0) / ((b.y1 - b.y0) || 1);
    d.origs.forEach((orig, id) => { const z = this.zones.find(q => q.id === id); if (!z || !orig) return; z.poly = orig.map(p => [nx0 + (p[0] - b.x0) * sx, ny0 + (p[1] - b.y0) * sy]); });
  }
  _snapGroup() {
    const W = this.plan.w, H = this.plan.h, ids = this.multi; let best = null;
    ids.forEach(id => { const z = this.zones.find(q => q.id === id); if (!z) return; z.poly.forEach(p => { const sn = this._snapTo({ x: p[0], y: p[1] }, ids); if (sn) { const d = Math.hypot((sn.x - p[0]) * W, (sn.y - p[1]) * H); if (!best || d < best.d) best = { d, dx: sn.x - p[0], dy: sn.y - p[1] }; } }); });
    if (best) ids.forEach(id => { const z = this.zones.find(q => q.id === id); if (z) z.poly = z.poly.map(p => [p[0] + best.dx, p[1] + best.dy]); });
    return !!best;
  }
  // corner/line snap against shapes NOT in the given id set (dry), else the drawing
  _snapTo(n, skipIds) {
    const W = this.plan.w, H = this.plan.h, tol = 13 / this.pv.s; let best = null, bd = tol;
    this.zones.forEach(z => { if (!z.poly || skipIds.has(z.id)) return; z.poly.forEach(q => { const d = Math.hypot((q[0] - n.x) * W, (q[1] - n.y) * H); if (d < bd) { bd = d; best = { x: q[0], y: q[1] }; } }); });
    if (best) return best;
    this.zones.forEach(z => { if (!z.poly || skipIds.has(z.id)) return; const P = z.poly; for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length], ax = a[0] * W, ay = a[1] * H, bx = b[0] * W, by = b[1] * H, px = n.x * W, py = n.y * H, dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1; let t = ((px - ax) * dx + (py - ay) * dy) / l2; if (t < 0.02 || t > 0.98) continue; const fx = ax + t * dx, fy = ay + t * dy, d = Math.hypot(px - fx, py - fy); if (d < bd) { bd = d; best = { x: fx / W, y: fy / H }; } } });
    if (best) return best;
    return this._snapDrawing(n);
  }
  _snapShape(z) {
    const W = this.plan.w, H = this.plan.h; let best = null;
    z.poly.forEach(p => { const sn = this._snap({ x: p[0], y: p[1] }, z, -1, true); if (sn.snapped) { const d = Math.hypot((sn.x - p[0]) * W, (sn.y - p[1]) * H); if (!best || d < best.d) best = { d, dx: sn.x - p[0], dy: sn.y - p[1] }; } });
    if (best) { z.poly = z.poly.map(p => [p[0] + best.dx, p[1] + best.dy]); return true; }
    return false;
  }
  _snap(n, skipZone, skipIdx, dry) {
    if (this.snapOff || this.altDown) return n;
    if (!this.plan) return n; const W = this.plan.w, H = this.plan.h, tol = 13 / this.pv.s; let best = null, bd = tol;
    this.zones.forEach(z => { if (!z.poly) return; z.poly.forEach((q, j) => { if (z === skipZone && j === skipIdx) return; const d = Math.hypot((q[0] - n.x) * W, (q[1] - n.y) * H) / (z.kind === 'unit' ? 1.6 : 1); if (d < bd) { bd = d; best = { x: q[0], y: q[1], snapped: 'corner' }; } }); });
    if (best) return best;
    bd = tol;
    this.zones.forEach(z => { if (!z.poly || z === skipZone) return; const P = z.poly; for (let i = 0; i < P.length - (z.kind === 'face' ? 1 : 0); i++) { const a = P[i], b = P[(i + 1) % P.length]; const ax = a[0] * W, ay = a[1] * H, bx = b[0] * W, by = b[1] * H, px = n.x * W, py = n.y * H; const L = (bx - ax) ** 2 + (by - ay) ** 2; if (!L) continue; const t = ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / L; if (t <= 0.02 || t >= 0.98) continue; const sx = ax + t * (bx - ax), sy = ay + t * (by - ay); const d = Math.hypot(px - sx, py - sy) / (z.kind === 'unit' ? 1.6 : 1); if (d < bd) { bd = d; best = { x: sx / W, y: sy / H, snapped: 'line', zone: z, after: i }; } } });
    if (best && best.zone && !dry && this.join !== false) { best.zone.poly.splice(best.after + 1, 0, [best.x, best.y]); this.o.onZoneEdit && this.o.onZoneEdit(best.zone, 'v'); }
    if (best) return best;
    // guide lines (the elevation face lines on this plan): corners first, then the line itself
    const G = (this.guides || []).map(g => g.path || g); bd = tol * 1.4;
    G.forEach(g => g.forEach(q => { const d = Math.hypot((q[0] - n.x) * W, (q[1] - n.y) * H); if (d < bd) { bd = d; best = { x: q[0], y: q[1], snapped: 'corner' }; } }));
    if (best) return best; bd = tol * 1.4;
    G.forEach(g => { for (let i = 0; i + 1 < g.length; i++) { const ax = g[i][0] * W, ay = g[i][1] * H, bx = g[i + 1][0] * W, by = g[i + 1][1] * H, px = n.x * W, py = n.y * H, L = (bx - ax) ** 2 + (by - ay) ** 2; if (!L) continue; const t = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / L)), sx = ax + t * (bx - ax), sy = ay + t * (by - ay), d = Math.hypot(px - sx, py - sy); if (d < bd) { bd = d; best = { x: sx / W, y: sy / H, snapped: 'guide' }; } } });
    if (best) return best;
    return this._snapDrawing(n) || n;
  }
  // Snap to the lines of the drawing itself (walls, grids extracted from the PDF): a crossing of two lines first, else the nearest line.
  _snapDrawing(n) {
    const L = this.plan && this.plan.lines; if (!L || L.length < 4) return null;
    const W = this.plan.w, H = this.plan.h, tol = 12 / this.pv.s, px = n.x * W, py = n.y * H, near = [];
    for (let i = 0; i < L.length; i += 4) {
      const ax = L[i] * W, ay = L[i + 1] * H, bx = L[i + 2] * W, by = L[i + 3] * H, dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
      let t = ((px - ax) * dx + (py - ay) * dy) / l2; if (t < -0.02 || t > 1.02) continue; t = Math.max(0, Math.min(1, t));
      const fx = ax + t * dx, fy = ay + t * dy, d = Math.hypot(px - fx, py - fy); if (d < tol) near.push({ d, ax, ay, bx, by, fx, fy, ang: Math.atan2(dy, dx) });
    }
    if (!near.length) return null; near.sort((a, b) => a.d - b.d);
    const a = near[0];
    for (const b of near.slice(1, 12)) {   // crossing of two lines at different angles
      const da = Math.abs(((a.ang - b.ang) % Math.PI + Math.PI) % Math.PI); if (da < 0.35 || da > Math.PI - 0.35) continue;
      const x1 = a.ax, y1 = a.ay, x2 = a.bx, y2 = a.by, x3 = b.ax, y3 = b.ay, x4 = b.bx, y4 = b.by, den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4); if (!den) continue;
      const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den, ix = x1 + t * (x2 - x1), iy = y1 + t * (y2 - y1);
      if (Math.hypot(ix - px, iy - py) < tol * 1.6) return { x: ix / W, y: iy / H, snapped: 'drawing corner' };
    }
    return { x: a.fx / W, y: a.fy / H, snapped: 'drawing line' };
  }
  _norm(e) { const r = this.img.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }; }
  _zoneAt(e) { const n = this._norm(e); const hide = this.hideKinds || new Set();
    const W = this.plan.w, H = this.plan.h, tol = 14 / this.pv.s; const near = z => { const P = z.poly; for (let i = 0; i + 1 < P.length; i++) { const ax = P[i][0] * W, ay = P[i][1] * H, bx = P[i + 1][0] * W, by = P[i + 1][1] * H, px = n.x * W, py = n.y * H; const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1; const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)); if (Math.hypot(px - (ax + t * dx), py - (ay + t * dy)) < tol) return true; } return false; };
    const f = this.zones.find(z => z.kind === 'face' && z.poly && z.poly.length > 1 && !hide.has(z.kind) && near(z)); if (f) return f;
    const hits = this.zones.filter(z => z.kind !== 'face' && z.poly && z.poly.length > 2 && !hide.has(z.kind) && inPoly(n.x, n.y, z.poly)); hits.sort((a, b) => area(a.poly) - area(b.poly)); return hits[0] || null; }
  _tap(e, target) {
    if (!this.plan) return;
    const n = this._norm(e); const inside = n.x >= 0 && n.x <= 1 && n.y >= 0 && n.y <= 1;
    const pin = target && target.closest && target.closest('.pin');
    if (this.mode === 'draw') { if (!inside) return; const d = this.draft; if (d.length > 2 && (this.minDraw || 3) > 2) { const f = d[0], r = this.img.getBoundingClientRect(); if (Math.hypot((f[0] - n.x) * r.width, (f[1] - n.y) * r.height) < 14) return this.finishDraw(); } const sn = this._snap(n); if (this.ortho && !this.rect && d.length) { const pv = d[d.length - 1]; if (Math.abs(sn.x - pv[0]) * this.plan.w < Math.abs(sn.y - pv[1]) * this.plan.h) sn.x = pv[0]; else sn.y = pv[1]; } d.push([sn.x, sn.y]); if (this.rect && d.length === 2) { const [a, b] = d; const W = this.plan.w, H = this.plan.h; if (Math.abs(b[0] - a[0]) * W < 6) b[0] = n.x; if (Math.abs(b[1] - a[1]) * H < 6) b[1] = n.y; if (Math.abs(b[0] - a[0]) * W < 6 || Math.abs(b[1] - a[1]) * H < 6) { d.pop(); return; } this.draft = [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]]; return this.finishDraw(); } this._drawZones(); this.o.onDraftChange && this.o.onDraftChange(d); return; }
    if (this.mode === 'place') { if (inside) this.o.onPlace && this.o.onPlace(n.x, n.y); return; }
    if (this.mode === 'zones') {
      const vh = target && target.closest && target.closest('[data-v]');
      if (vh && this.selZone) { const i = +vh.dataset.v; this.selVertex = this.selVertex === i ? null : i; this._drawZones(); this.o.onVertexSelect && this.o.onVertexSelect(this.selVertex); return; }
      // tapping on an edge of the selected shape adds a corner there, so it can be pulled out to fit
      if (this.selZone && this.selZone.poly && this.selZone.kind !== 'band' && !(target && target.closest && target.closest('.zvh'))) { const W = this.plan.w, H = this.plan.h, P = this.selZone.poly, tol = 12 / this.pv.s; let best = null, bd = tol;
        for (let i = 0; i < P.length - (this.selZone.kind === 'face' ? 1 : 0); i++) { const a = P[i], b = P[(i + 1) % P.length]; const ax = a[0] * W, ay = a[1] * H, bx = b[0] * W, by = b[1] * H, px = n.x * W, py = n.y * H; const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1; const t = ((px - ax) * dx + (py - ay) * dy) / l2; if (t < 0.05 || t > 0.95) continue; const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy)); if (d < bd) { bd = d; best = { after: i, x: (ax + t * dx) / W, y: (ay + t * dy) / H }; } }
        if (best) { this.o.onEditStart && this.o.onEditStart(); P.splice(best.after + 1, 0, [best.x, best.y]); this.o.onZoneEdit && this.o.onZoneEdit(this.selZone, 'v'); this._drawZones(); this.o.onVertexAdded && this.o.onVertexAdded(this.selZone); return; } }
      const z = this._zoneAt(e);
      if (this.marquee) { if (z) { this.multi.has(z.id) ? this.multi.delete(z.id) : this.multi.add(z.id); } this.selZone = null; this._drawZones(); this.o.onMultiChange && this.o.onMultiChange([...this.multi]); return; }
      this.selectZone(z); this.o.onZoneSelect && this.o.onZoneSelect(z); return; }
    if (pin) return this.o.onPinTap && this.o.onPinTap(pin.dataset.id);
    if (inside && this.o.onPlanTap) this.o.onPlanTap(n.x, n.y);
  }
  _clamp(s) { return Math.max(this._minS() * 0.7, Math.min(8, s)); }
  _minS() { if (!this.plan) return 1; return Math.min(this.vp.clientWidth / this.plan.w, this.vp.clientHeight / this.plan.h) || 0.2; }
  zoomAt(cx, cy, f) { const ns = this._clamp(this.pv.s * f); this.pv.x = cx - (cx - this.pv.x) * ns / this.pv.s; this.pv.y = cy - (cy - this.pv.y) * ns / this.pv.s; this.pv.s = ns; this.pv.user = 1; this._apply(); }
  _apply() { this.inner.style.transform = `translate(${this.pv.x}px,${this.pv.y}px) scale(${this.pv.s})`; this.inner.style.setProperty('--inv', 1 / this.pv.s); this.svg.style.setProperty('--inv', 1 / this.pv.s); if (this.showZones || this.mode !== 'view') this._drawZones(); }
  fit() { if (!this.plan || !this.vp.clientWidth) return; const s = this._minS(); this.pv = { s, x: (this.vp.clientWidth - this.plan.w * s) / 2, y: (this.vp.clientHeight - this.plan.h * s) / 2 }; this._apply(); }
  zoomTo(x0, y0, x1, y1) { if (!this.plan) return; const W = this.plan.w, H = this.plan.h, s = Math.min(this.vp.clientWidth / ((x1 - x0) * W * 1.08), this.vp.clientHeight / ((y1 - y0) * H * 1.08)); this.pv = { s, x: this.vp.clientWidth / 2 - (x0 + x1) / 2 * W * s, y: this.vp.clientHeight / 2 - (y0 + y1) / 2 * H * s, user: 1 }; this._apply(); }
  setImageFit(fit) { this.img.style.transformOrigin = '0 0'; this.img.style.transform = fit ? `translate(${fit.tx * this.plan.w}px, ${fit.ty * this.plan.h}px) scale(${fit.sx}, ${fit.sy})` : ''; }
  focus(x, y, zoom = 3) { if (!this.plan) return; const s = Math.max(this.pv.s, this._minS() * zoom); this.pv = { s, x: this.vp.clientWidth / 2 - x * this.plan.w * s, y: this.vp.clientHeight / 2 - y * this.plan.h * s, user: 1 }; this._apply(); }
  async setPlan(plan, url) {
    this.plan = plan; this.vp.classList.toggle('noplan', !plan); if (!plan) return;
    this.img.width = plan.w; this.img.height = plan.h; this.inner.style.width = plan.w + 'px'; this.inner.style.height = plan.h + 'px';
    this.svg.setAttribute('viewBox', `0 0 ${plan.w} ${plan.h}`); this.svg.setAttribute('width', plan.w); this.svg.setAttribute('height', plan.h);
    if (this.img.dataset.src !== url) { this.img.dataset.src = url; const im = this.img; if (/^https?:/.test(url) && !url.startsWith(location.origin)) { im.crossOrigin = 'anonymous'; im.onerror = () => { im.onerror = null; im.removeAttribute('crossorigin'); im.src = url; }; } else im.removeAttribute('crossorigin'); im.src = url; }
    const keepView = this.pv.user && this.plan && this._lastSize && this._lastSize[0] === plan.w && this._lastSize[1] === plan.h;   // same sheet size: keep the zoom and position
    this._lastSize = [plan.w, plan.h];
    this.zones = plan.zones || []; this.selZone = null; if (!keepView) { this.pv.user = 0; requestAnimationFrame(() => this.fit()); } else this._apply(); this._drawPins(); this._drawZones();
  }
  setPins(pins) { this.pins = pins; this._drawPins(); }
  _drawPins() {
    if (!this.plan) { this.pinsEl.innerHTML = ''; return; }
    this.pinsEl.innerHTML = this.pins.map(p => `<div class="pin${p.sel ? ' sel' : ''}" data-id="${esc(p.id)}" style="left:${p.x * this.plan.w}px;top:${p.y * this.plan.h}px" title="${esc(p.title || p.id)}">${PIN(p.colour)}<span${String(p.label).length >= 5 ? ' class="l5"' : String(p.label).length === 4 ? ' class="l4"' : ''}>${esc(p.label)}</span></div>`).join('');
  }
  setZonesVisible(v) { this.showZones = v; this._drawZones(); }
  _drawZones(marq) {
    if (!this.plan) return; const W = this.plan.w, H = this.plan.h, inv = 1 / this.pv.s; this.multi = this.multi || new Set();
    const show = this.showZones || this.mode === 'zones' || this.mode === 'draw';
    let h = '', hh = '';   // hh: corner handles of the selected shape, drawn last so nothing covers them
    const hide = this.hideKinds || new Set();
    if ((this.mode === 'zones' || this.mode === 'draw') && this.guides) this.guides.forEach(g => { const pts = g.path || g; if (!pts || pts.length < 2) return;
      h += `<polyline class="zguide" points="${pts.map(p => `${p[0] * W},${p[1] * H}`).join(' ')}" style="stroke-width:${2.5 * inv}px;stroke-dasharray:${8 * inv} ${5 * inv}"/>`;
      if (g.label) { const m = pts[Math.floor(pts.length / 2)]; h += `<text class="zgt" x="${m[0] * W}" y="${m[1] * H - 6 * inv}" style="font-size:${13 * inv}px">${esc(g.label)}</text>`; } });
    if (show) [...this.zones].sort((a, b) => ({ unit: 0, area: 1, room: 2, item: 3 }[a.kind] || 0) - ({ unit: 0, area: 1, room: 2, item: 3 }[b.kind] || 0)).forEach(z => {
      const face = z.kind === 'face';
      if (!z.poly || z.poly.length < (face ? 2 : 3) || hide.has(z.kind)) return; const sel = this.selZone && this.selZone.id === z.id, msel = this.multi.has(z.id);
      const pts = z.poly.map(p => `${p[0] * W},${p[1] * H}`).join(' ');
      const cls = z.kind === 'unit' ? 'zu' : z.kind === 'area' ? 'za' : z.kind === 'item' ? 'zi' : face ? 'zf' : z.kind === 'band' ? 'zb' : z.kind === 'bandro' ? 'zbro' : 'zr';
      if (face) h += `<polyline class="zf${sel ? ' zfsel' : ''}" data-zid="${esc(z.id)}" points="${pts}" style="stroke-width:${(sel ? 5 : 4) * inv}px"/>`;
      else h += `<polygon class="${cls}${sel ? ' zsel' : ''}${msel ? ' zmsel' : ''}" data-zid="${esc(z.id)}" points="${pts}" style="stroke-width:${(z.kind === 'unit' ? 4.5 : msel ? 3 : 2) * inv}px"/>`;
      const c = face ? z.poly[Math.floor(z.poly.length / 2)] : centroidOf(z.poly), lab = z.kind === 'unit' ? 'Unit ' + (z.unit || '') : (z.name || '');
      if (lab && (this.mode !== 'view' || this.pv.s > this._minS() * 1.6)) h += `<text x="${c[0] * W}" y="${c[1] * H}" class="zl ${cls}t" style="font-size:${(z.kind === 'unit' ? 15 : z.kind === 'band' || z.kind === 'bandro' ? 18 : 12) * inv}px">${esc(lab)}</text>`;
      if (sel && this.mode === 'zones') z.poly.forEach((p, i) => { hh += `<circle data-v="${i}" class="zvh" cx="${p[0] * W}" cy="${p[1] * H}" r="${16 * inv}"/><circle data-v="${i}" class="zv ${this.selVertex === i ? 'vsel' : ''}" cx="${p[0] * W}" cy="${p[1] * H}" r="${8 * inv}" style="stroke-width:${2 * inv}px"/>`; });
    });
    if (this.mode === 'draw' && this.draft && this.draft.length) {
      h += `<polyline class="zdraft" points="${this.draft.map(p => `${p[0] * W},${p[1] * H}`).join(' ')}" style="stroke-width:${2.5 * inv}px"/>`;
      this.draft.forEach((p, i) => h += `<circle class="zdv${i === 0 ? ' first' : ''}" cx="${p[0] * W}" cy="${p[1] * H}" r="${(i === 0 ? 9 : 6) * inv}" style="stroke-width:${2 * inv}px"/>`);
    }
    // a group gets a sizing box: drag a handle and everything inside scales, so a copied unit can be stretched to fit the next one
    if (this.mode === 'zones' && this.multi.size && !(this.o && this.o.noGroupBox)) {
      const bb = this.groupBox();
      if (bb) { const x0 = bb.x0 * W, y0 = bb.y0 * H, x1 = bb.x1 * W, y1 = bb.y1 * H;
        hh += `<rect class="gbox" x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" style="stroke-width:${1.5 * inv}px;stroke-dasharray:${7 * inv} ${5 * inv}"/>`;
        const mx = (x0 + x1) / 2, my = (y0 + y1) / 2, pts = [[x0, y0], [mx, y0], [x1, y0], [x1, my], [x1, y1], [mx, y1], [x0, y1], [x0, my]];
        pts.forEach((q, i) => { hh += `<rect data-gh="${i}" class="ghh" x="${q[0] - 17 * inv}" y="${q[1] - 17 * inv}" width="${34 * inv}" height="${34 * inv}"/><rect data-gh="${i}" class="gh" x="${q[0] - 6 * inv}" y="${q[1] - 6 * inv}" width="${12 * inv}" height="${12 * inv}" style="stroke-width:${2 * inv}px"/>`; });
      }
    }
    h += hh;
    if (marq && marq.cur) { const x0 = Math.min(marq.start.x, marq.cur.x) * W, y0 = Math.min(marq.start.y, marq.cur.y) * H, x1 = Math.max(marq.start.x, marq.cur.x) * W, y1 = Math.max(marq.start.y, marq.cur.y) * H; h += `<rect class="marq" x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" style="stroke-width:${1.5 * inv}px;stroke-dasharray:${6 * inv} ${4 * inv}"/>`; }
    this.svg.innerHTML = h;
  }
  setZones(z) { this.zones = z; if (this.selZone && !z.find(x => x.id === this.selZone.id)) this.selZone = null; this._drawZones(); }
  selectZone(z) { this.selZone = z; this.selVertex = null; this._drawZones(); }
  // a band stays a rectangle: moving one corner carries its two neighbours
  _rect(P, i, old) { const o = (i + 2) % 4, n1 = (i + 1) % 4, n2 = (i + 3) % 4; const sharedX = Math.abs(P[n1][0] - old[0]) < Math.abs(P[n1][1] - old[1]); P[n1] = sharedX ? [P[i][0], P[o][1]] : [P[o][0], P[i][1]]; P[n2] = sharedX ? [P[o][0], P[i][1]] : [P[i][0], P[o][1]]; }
  // right angles: a corner within a few pixels of lining up with the corner before or after it is pulled square
  // the edge of the selected shape under a point, if any
  _edgeAt(n) { const z = this.selZone; if (!z || !z.poly) return null; const W = this.plan.w, H = this.plan.h, P = z.poly, tol = 12 / this.pv.s, px = n.x * W, py = n.y * H; let best = null;
    for (let i = 0; i < P.length - (z.kind === 'face' ? 1 : 0); i++) { const a = P[i], b = P[(i + 1) % P.length], ax = a[0] * W, ay = a[1] * H, bx = b[0] * W, by = b[1] * H, dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy; if (l2 < 1) continue; const t = ((px - ax) * dx + (py - ay) * dy) / l2; if (t < 0.08 || t > 0.92) continue; const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy)); if (d < tol && (!best || d < best.d)) best = { i, d }; }
    return best; }
  // corners of other shapes (and of this one) sitting on the same point, so they travel with it
  _sharedAt(p0, zone, i) { if (this.join === false) return []; const tol = 7 / this.pv.s, out = []; this.zones.forEach(z => { if (!z.poly) return; z.poly.forEach((q, j) => { if (z === zone && j === i) return; if (Math.abs((q[0] - p0[0]) * this.plan.w) < tol && Math.abs((q[1] - p0[1]) * this.plan.h) < tol) out.push([z, j]); }); }); return out; }
  // slide a whole wall sideways, keeping its length and direction; it snaps to anything the moved ends come close to
  _slideEdge(d, n) {
    const z = this.selZone, W = this.plan.w, H = this.plan.h, A = d.orig[d.ia], B = d.orig[d.ib];
    let ex = (B[0] - A[0]) * W, ey = (B[1] - A[1]) * H; const el = Math.hypot(ex, ey) || 1; ex /= el; ey /= el;
    const nx = -ey, ny = ex;   // unit normal in pixels
    let off = ((n.x - d.start.x) * W) * nx + ((n.y - d.start.y) * H) * ny;
    const put = o => [[A[0] + nx * o / W, A[1] + ny * o / H], [B[0] + nx * o / W, B[1] + ny * o / H]];
    const tol = 13 / this.pv.s; let bestOff = off, bd = tol;
    [[put(off)[0], d.ia], [put(off)[1], d.ib]].forEach(([pt, idx]) => { const sn = this._snap({ x: pt[0], y: pt[1] }, z, idx, true); if (!sn || !sn.snapped) return; const o2 = ((sn.x - (idx === d.ia ? A[0] : B[0])) * W) * nx + ((sn.y - (idx === d.ia ? A[1] : B[1])) * H) * ny; const miss = Math.hypot((sn.x - pt[0]) * W, (sn.y - pt[1]) * H); if (miss < bd) { bd = miss; bestOff = o2; } });
    const [na, nb] = put(bestOff); z.poly[d.ia] = na; z.poly[d.ib] = nb;
    d.shA.forEach(([q, j]) => { q.poly[j] = [na[0], na[1]]; }); d.shB.forEach(([q, j]) => { q.poly[j] = [nb[0], nb[1]]; });
  }
  _align(z, i, pt) { if (!this.ortho || !z || z.kind === 'band') return pt; const P = z.poly, W = this.plan.w, H = this.plan.h, tol = 10 / this.pv.s, open = z.kind === 'face'; const out = [pt[0], pt[1]];
    const nbs = [P[(i - 1 + P.length) % P.length], P[(i + 1) % P.length]].filter((q, k) => q && !(open && ((k === 0 && i === 0) || (k === 1 && i === P.length - 1))));
    let bx = tol, by = tol; nbs.forEach(q => { const dx = Math.abs(q[0] - pt[0]) * W, dy = Math.abs(q[1] - pt[1]) * H; if (dx < bx) { bx = dx; out[0] = q[0]; } if (dy < by) { by = dy; out[1] = q[1]; } }); return out; }
  // Undo a join at the selected corner: a corner another shape only gained from snapping (it sits on a straight run of that
  // shape's wall) is removed, so the two are no longer tied together. Returns how many were freed.
  disconnectCorner() {
    const z = this.selZone, i = this.selVertex; if (!z || i == null) return 0;
    const W = this.plan.w, H = this.plan.h, p = z.poly[i], tol = 3 / this.pv.s; let n = 0;
    this.zones.forEach(o => { if (o === z || !o.poly || o.poly.length < 4) return;
      for (let j = o.poly.length - 1; j >= 0; j--) { const q = o.poly[j]; if (Math.abs((q[0] - p[0]) * W) > tol || Math.abs((q[1] - p[1]) * H) > tol) continue;
        const a = o.poly[(j - 1 + o.poly.length) % o.poly.length], b = o.poly[(j + 1) % o.poly.length];
        const cross = Math.abs(((b[0] - a[0]) * W) * ((q[1] - a[1]) * H) - ((b[1] - a[1]) * H) * ((q[0] - a[0]) * W)) / (Math.hypot((b[0] - a[0]) * W, (b[1] - a[1]) * H) || 1);
        if (cross < 2.5) { o.poly.splice(j, 1); n++; }   // it sat on a straight run, so the wall keeps its shape without it
      } });
    if (n) { this._drawZones(); this.o.onZoneEdit && this.o.onZoneEdit(z, 'v'); }
    return n;
  }
  deleteVertex() { const z = this.selZone, i = this.selVertex; if (!z || i == null || z.kind === 'band' || z.poly.length <= (z.kind === 'face' ? 2 : 3)) return false; this.o.onEditStart && this.o.onEditStart(); z.poly.splice(i, 1); this.selVertex = null; this._drawZones(); this.o.onZoneEdit && this.o.onZoneEdit(z, 'v'); return true; }
  setMode(m, banner) { this.mode = m; this.vp.classList.toggle('placing', m === 'place' || m === 'draw'); if (m !== 'draw') this.draft = null; if (m !== 'zones') this.moveZone = false; this.banner(banner); this._drawZones(); }
  startDraw(banner, rect, min) { this.setMode('draw', banner); this.draft = []; this.rect = !!rect; this.minDraw = min || 3; }
  undoPoint() { if (this.draft) { this.draft.pop(); this._drawZones(); } }
  finishDraw() { const d = this.draft; if (!d || d.length < (this.minDraw || 3)) return; if (this.ortho && !this.rect && (this.minDraw || 3) > 2) { const f = d[0], l = d[d.length - 1], pv = d[d.length - 2]; if (Math.abs(l[1] - pv[1]) < 1e-9) l[0] = f[0]; else l[1] = f[1]; } this.draft = null; this.o.onDrawn && this.o.onDrawn(d); }
  banner(html) { const b = this.bannerEl; if (!html) { b.classList.remove('show'); return; } b.innerHTML = html; b.classList.add('show'); }
}
function inPoly(x, y, poly) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) c = !c; } return c; }
function area(p) { let a = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j][0] + p[i][0]) * (p[j][1] - p[i][1]); return Math.abs(a / 2); }
function centroidOf(p) { let x = 0, y = 0; p.forEach(q => { x += q[0]; y += q[1]; }); return [x / p.length, y / p.length]; }
