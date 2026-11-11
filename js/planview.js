// Plan viewer: pan / pinch / wheel zoom, defect pins, and room boundaries (view, draw, edit, move).
import { esc } from './util.js';

const PIN = c => `<svg viewBox="0 0 28 36"><path d="M14 0C6.3 0 0 6.1 0 13.7 0 24 14 36 14 36s14-12 14-22.3C28 6.1 21.7 0 14 0z" fill="${c}" stroke="#fff" stroke-width="1.5"/></svg>`;
const NS = 'http://www.w3.org/2000/svg';

export class PlanView {
  constructor(vp, o = {}) {
    this.vp = vp; this.o = o; this.pv = { s: 1, x: 0, y: 0 }; this.plan = null; this.pins = []; this.zones = []; this.showZones = false;
    this.mode = 'view'; this.draft = null; this.selZone = null; this.moveZone = false;
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
        if (this.mode === 'zones' && v && this.selZone) { const i = +v.dataset.v, p0 = this.selZone.poly[i], tol = 7 / this.pv.s; const shared = []; this.zones.forEach(z => { if (!z.poly) return; z.poly.forEach((q, j) => { if (z === this.selZone && j === i) return; if (Math.abs((q[0] - p0[0]) * this.plan.w) < tol && Math.abs((q[1] - p0[1]) * this.plan.h) < tol) shared.push([z, j]); }); }); drag = { kind: 'v', i, shared }; }
        else if (this.mode === 'zones' && this.moveZone && this.selZone && this._zoneAt(e)?.id === this.selZone.id) { drag = { kind: 'z', start: this._norm(e), orig: this.selZone.poly.map(p => p.slice()) }; this.o.onZoneDragStart && this.o.onZoneDragStart(this.selZone); }
      } else if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: this.pv.s, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, px: this.pv.x, py: this.pv.y }; moved = 99; drag = null; }
    });
    vp.addEventListener('pointermove', e => {
      if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2 && pinch) { const [a, b] = [...pts.values()], r = vp.getBoundingClientRect(), ns = this._clamp(pinch.s * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d), cx = pinch.cx - r.left, cy = pinch.cy - r.top; this.pv.x = cx - (cx - pinch.px) * ns / pinch.s; this.pv.y = cy - (cy - pinch.py) * ns / pinch.s; this.pv.s = ns; this.pv.user = 1; this._apply(); return; }
      if (pts.size !== 1 || !st) return;
      const dx = e.clientX - st.x, dy = e.clientY - st.y; moved = Math.max(moved, Math.hypot(dx, dy));
      if (moved <= st.tol) return;
      if (drag && drag.kind === 'v') { const n = this._norm(e); this.selZone.poly[drag.i] = [n.x, n.y]; drag.shared.forEach(([z, j]) => { z.poly[j] = [n.x, n.y]; }); this._drawZones(); this.o.onZoneEdit && this.o.onZoneEdit(this.selZone, 'v'); }
      else if (drag && drag.kind === 'z') { const n = this._norm(e), ddx = n.x - drag.start.x, ddy = n.y - drag.start.y; this.selZone.poly = drag.orig.map(p => [p[0] + ddx, p[1] + ddy]); this.o.onZoneEdit && this.o.onZoneEdit(this.selZone, 'z', ddx, ddy); this._drawZones(); }
      else { this.pv.x = st.px + dx; this.pv.y = st.py + dy; this.pv.user = 1; this._apply(); }
    });
    const up = e => { if (!pts.has(e.pointerId)) return; pts.delete(e.pointerId); if (pts.size < 2) pinch = null;
      if (pts.size === 1) { const r = [...pts.values()][0]; st = { x: r.x, y: r.y, px: this.pv.x, py: this.pv.y, t: 0, target: null, tol: 12 }; moved = 99; drag = null; }
      if (pts.size === 0 && st) { if (moved <= st.tol && Date.now() - st.t < 1200) this._tap(e, st.target);
        else if (drag && drag.kind === 'v' && this.selZone) { const n = this._norm(e), sn = this._snap(n, this.selZone, drag.i); if (sn.snapped) { this.selZone.poly[drag.i] = [sn.x, sn.y]; drag.shared.forEach(([z, j]) => { z.poly[j] = [sn.x, sn.y]; }); this._drawZones(); this.o.onZoneEdit && this.o.onZoneEdit(this.selZone, 'v'); } }
        st = null; drag = null; } };
    vp.addEventListener('pointerup', up); vp.addEventListener('pointercancel', up);
    vp.addEventListener('wheel', e => { e.preventDefault(); const r = vp.getBoundingClientRect(); this.zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
  }
  // Snap a plan-normalised point to an existing corner, or onto an existing boundary line (a new shared corner is added to that line).
  _snap(n, skipZone, skipIdx) {
    if (!this.plan) return n; const W = this.plan.w, H = this.plan.h, tol = 10 / this.pv.s; let best = null, bd = tol;
    this.zones.forEach(z => { if (!z.poly) return; z.poly.forEach((q, j) => { if (z === skipZone && j === skipIdx) return; const d = Math.hypot((q[0] - n.x) * W, (q[1] - n.y) * H); if (d < bd) { bd = d; best = { x: q[0], y: q[1], snapped: 'corner' }; } }); });
    if (best) return best;
    bd = tol;
    this.zones.forEach(z => { if (!z.poly || z === skipZone) return; const P = z.poly; for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; const ax = a[0] * W, ay = a[1] * H, bx = b[0] * W, by = b[1] * H, px = n.x * W, py = n.y * H; const L = (bx - ax) ** 2 + (by - ay) ** 2; if (!L) continue; const t = ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / L; if (t <= 0.02 || t >= 0.98) continue; const sx = ax + t * (bx - ax), sy = ay + t * (by - ay); const d = Math.hypot(px - sx, py - sy); if (d < bd) { bd = d; best = { x: sx / W, y: sy / H, snapped: 'line', zone: z, after: i }; } } });
    if (best && best.zone) { best.zone.poly.splice(best.after + 1, 0, [best.x, best.y]); this.o.onZoneEdit && this.o.onZoneEdit(best.zone, 'v'); }
    if (best) return best;
    return this._snapDrawing(n) || n;
  }
  // Snap to the lines of the drawing itself (walls, grids extracted from the PDF): a crossing of two lines first, else the nearest line.
  _snapDrawing(n) {
    const L = this.plan && this.plan.lines; if (!L || L.length < 4) return null;
    const W = this.plan.w, H = this.plan.h, tol = 9 / this.pv.s, px = n.x * W, py = n.y * H, near = [];
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
  _zoneAt(e) { const n = this._norm(e); const hide = this.hideKinds || new Set(); const hits = this.zones.filter(z => z.poly && z.poly.length > 2 && !hide.has(z.kind) && inPoly(n.x, n.y, z.poly)); hits.sort((a, b) => area(a.poly) - area(b.poly)); return hits[0] || null; }
  _tap(e, target) {
    if (!this.plan) return;
    const n = this._norm(e); const inside = n.x >= 0 && n.x <= 1 && n.y >= 0 && n.y <= 1;
    const pin = target && target.closest && target.closest('.pin');
    if (this.mode === 'draw') { if (!inside) return; const d = this.draft; if (d.length > 2) { const f = d[0], r = this.img.getBoundingClientRect(); if (Math.hypot((f[0] - n.x) * r.width, (f[1] - n.y) * r.height) < 14) return this.finishDraw(); } const sn = this._snap(n); d.push([sn.x, sn.y]); if (this.rect && d.length === 2) { const [a, b] = d; this.draft = [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]]; return this.finishDraw(); } this._drawZones(); this.o.onDraftChange && this.o.onDraftChange(d); return; }
    if (this.mode === 'place') { if (inside) this.o.onPlace && this.o.onPlace(n.x, n.y); return; }
    if (this.mode === 'zones') {
      // tapping on an edge of the selected shape adds a corner there, so it can be pulled out to fit
      if (this.selZone && this.selZone.poly && !(target && target.closest && target.closest('.zvh'))) { const W = this.plan.w, H = this.plan.h, P = this.selZone.poly, tol = 12 / this.pv.s; let best = null, bd = tol;
        for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; const ax = a[0] * W, ay = a[1] * H, bx = b[0] * W, by = b[1] * H, px = n.x * W, py = n.y * H; const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1; const t = ((px - ax) * dx + (py - ay) * dy) / l2; if (t < 0.05 || t > 0.95) continue; const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy)); if (d < bd) { bd = d; best = { after: i, x: (ax + t * dx) / W, y: (ay + t * dy) / H }; } }
        if (best) { P.splice(best.after + 1, 0, [best.x, best.y]); this.o.onZoneEdit && this.o.onZoneEdit(this.selZone, 'v'); this._drawZones(); this.o.onVertexAdded && this.o.onVertexAdded(this.selZone); return; } }
      const z = this._zoneAt(e); this.selectZone(z); this.o.onZoneSelect && this.o.onZoneSelect(z); return; }
    if (pin) return this.o.onPinTap && this.o.onPinTap(pin.dataset.id);
    if (inside && this.o.onPlanTap) this.o.onPlanTap(n.x, n.y);
  }
  _clamp(s) { return Math.max(this._minS() * 0.7, Math.min(8, s)); }
  _minS() { if (!this.plan) return 1; return Math.min(this.vp.clientWidth / this.plan.w, this.vp.clientHeight / this.plan.h) || 0.2; }
  zoomAt(cx, cy, f) { const ns = this._clamp(this.pv.s * f); this.pv.x = cx - (cx - this.pv.x) * ns / this.pv.s; this.pv.y = cy - (cy - this.pv.y) * ns / this.pv.s; this.pv.s = ns; this.pv.user = 1; this._apply(); }
  _apply() { this.inner.style.transform = `translate(${this.pv.x}px,${this.pv.y}px) scale(${this.pv.s})`; this.inner.style.setProperty('--inv', 1 / this.pv.s); this.svg.style.setProperty('--inv', 1 / this.pv.s); if (this.showZones || this.mode !== 'view') this._drawZones(); }
  fit() { if (!this.plan || !this.vp.clientWidth) return; const s = this._minS(); this.pv = { s, x: (this.vp.clientWidth - this.plan.w * s) / 2, y: (this.vp.clientHeight - this.plan.h * s) / 2 }; this._apply(); }
  focus(x, y, zoom = 3) { if (!this.plan) return; const s = Math.max(this.pv.s, this._minS() * zoom); this.pv = { s, x: this.vp.clientWidth / 2 - x * this.plan.w * s, y: this.vp.clientHeight / 2 - y * this.plan.h * s, user: 1 }; this._apply(); }
  async setPlan(plan, url) {
    this.plan = plan; this.vp.classList.toggle('noplan', !plan); if (!plan) return;
    this.img.width = plan.w; this.img.height = plan.h; this.inner.style.width = plan.w + 'px'; this.inner.style.height = plan.h + 'px';
    this.svg.setAttribute('viewBox', `0 0 ${plan.w} ${plan.h}`); this.svg.setAttribute('width', plan.w); this.svg.setAttribute('height', plan.h);
    if (this.img.dataset.src !== url) { this.img.dataset.src = url; const im = this.img; if (/^https?:/.test(url) && !url.startsWith(location.origin)) { im.crossOrigin = 'anonymous'; im.onerror = () => { im.onerror = null; im.removeAttribute('crossorigin'); im.src = url; }; } else im.removeAttribute('crossorigin'); im.src = url; }
    this.zones = plan.zones || []; this.selZone = null; this.pv.user = 0; requestAnimationFrame(() => this.fit()); this._drawPins(); this._drawZones();
  }
  setPins(pins) { this.pins = pins; this._drawPins(); }
  _drawPins() {
    if (!this.plan) { this.pinsEl.innerHTML = ''; return; }
    this.pinsEl.innerHTML = this.pins.map(p => `<div class="pin${p.sel ? ' sel' : ''}" data-id="${esc(p.id)}" style="left:${p.x * this.plan.w}px;top:${p.y * this.plan.h}px" title="${esc(p.title || p.id)}">${PIN(p.colour)}<span>${esc(p.label)}</span></div>`).join('');
  }
  setZonesVisible(v) { this.showZones = v; this._drawZones(); }
  _drawZones() {
    if (!this.plan) return; const W = this.plan.w, H = this.plan.h, inv = 1 / this.pv.s;
    const show = this.showZones || this.mode === 'zones' || this.mode === 'draw';
    let h = '';
    const hide = this.hideKinds || new Set();
    if (show) [...this.zones].sort((a, b) => ({ unit: 0, area: 1, room: 2 }[a.kind] || 0) - ({ unit: 0, area: 1, room: 2 }[b.kind] || 0)).forEach(z => {
      if (!z.poly || z.poly.length < 3 || hide.has(z.kind)) return; const sel = this.selZone && this.selZone.id === z.id;
      const pts = z.poly.map(p => `${p[0] * W},${p[1] * H}`).join(' ');
      const cls = z.kind === 'unit' ? 'zu' : z.kind === 'area' ? 'za' : 'zr';
      h += `<polygon class="${cls}${sel ? ' zsel' : ''}" data-zid="${esc(z.id)}" points="${pts}" style="stroke-width:${2 * inv}px"/>`;
      const c = centroidOf(z.poly), lab = z.kind === 'unit' ? 'Unit ' + (z.unit || '') : (z.name || '');
      if (lab && (this.mode !== 'view' || this.pv.s > this._minS() * 1.6)) h += `<text x="${c[0] * W}" y="${c[1] * H}" class="zl ${cls}t" style="font-size:${(z.kind === 'unit' ? 15 : 12) * inv}px">${esc(lab)}</text>`;
      if (sel && this.mode === 'zones') z.poly.forEach((p, i) => { h += `<circle data-v="${i}" class="zvh" cx="${p[0] * W}" cy="${p[1] * H}" r="${16 * inv}"/><circle data-v="${i}" class="zv" cx="${p[0] * W}" cy="${p[1] * H}" r="${8 * inv}" style="stroke-width:${2 * inv}px"/>`; });
    });
    if (this.mode === 'draw' && this.draft && this.draft.length) {
      h += `<polyline class="zdraft" points="${this.draft.map(p => `${p[0] * W},${p[1] * H}`).join(' ')}" style="stroke-width:${2.5 * inv}px"/>`;
      this.draft.forEach((p, i) => h += `<circle class="zdv${i === 0 ? ' first' : ''}" cx="${p[0] * W}" cy="${p[1] * H}" r="${(i === 0 ? 9 : 6) * inv}" style="stroke-width:${2 * inv}px"/>`);
    }
    this.svg.innerHTML = h;
  }
  setZones(z) { this.zones = z; if (this.selZone && !z.find(x => x.id === this.selZone.id)) this.selZone = null; this._drawZones(); }
  selectZone(z) { this.selZone = z; this._drawZones(); }
  setMode(m, banner) { this.mode = m; this.vp.classList.toggle('placing', m === 'place' || m === 'draw'); if (m !== 'draw') this.draft = null; if (m !== 'zones') this.moveZone = false; this.banner(banner); this._drawZones(); }
  startDraw(banner, rect) { this.setMode('draw', banner); this.draft = []; this.rect = !!rect; }
  undoPoint() { if (this.draft) { this.draft.pop(); this._drawZones(); } }
  finishDraw() { const d = this.draft; if (!d || d.length < 3) return; this.draft = null; this.o.onDrawn && this.o.onDrawn(d); }
  banner(html) { const b = this.bannerEl; if (!html) { b.classList.remove('show'); return; } b.innerHTML = html; b.classList.add('show'); }
}
function inPoly(x, y, poly) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) c = !c; } return c; }
function area(p) { let a = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j][0] + p[i][0]) * (p[j][1] - p[i][1]); return Math.abs(a / 2); }
function centroidOf(p) { let x = 0, y = 0; p.forEach(q => { x += q[0]; y += q[1]; }); return [x / p.length, y / p.length]; }
