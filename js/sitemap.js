// Site map: an aerial or street map of the site, marked up with what residents and the facilities team need to find
// (entrances, bin store, bike store, washing lines, gardens, tanks, stormwater, shut-offs). Admins and editors mark it up;
// everyone on the project can view it. A snapshot can be added to the Home guide as a page with numbered pointers.
import { S, can } from './state.js';
import { $, esc, toast, busy, confirmBox, uid, loadScript, deliver, safeName, stamp } from './util.js';

// what can be put on the map; aud 'fm' = facilities team only, left out of the residents' view and the Home guide
export const TYPES = {
  entrance: { label: 'Main entrance', color: '#1F6FB2', sym: '🚪', kind: 'point' },
  door: { label: 'Building door / lobby', color: '#3D8BD6', sym: '🚪', kind: 'point' },
  lift: { label: 'Lift', color: '#3D8BD6', sym: '⇅', kind: 'point' },
  mail: { label: 'Letterboxes', color: '#7A4FB5', sym: '✉', kind: 'point' },
  bins: { label: 'Bin store', color: '#55606E', sym: '🗑', kind: 'point' },
  bikes: { label: 'Bike and scooter store', color: '#00897B', sym: '🚲', kind: 'point' },
  washing: { label: 'Washing lines', color: '#0097A7', sym: '👕', kind: 'point' },
  seat: { label: 'Seating / social space', color: '#8D6E63', sym: '🪑', kind: 'point' },
  community: { label: 'Community room', color: '#AD1457', sym: '★', kind: 'point' },
  parking: { label: 'Visitor / mobility parking', color: '#1565C0', sym: 'P', kind: 'point' },
  assembly: { label: 'Fire assembly point', color: '#2E7D32', sym: '⚑', kind: 'point' },
  bus: { label: 'Bus stop', color: '#E65100', sym: '🚌', kind: 'point' },
  tank: { label: 'Rainwater tank', color: '#0277BD', sym: '💧', kind: 'point' },
  pump: { label: 'Rainwater pump', color: '#0277BD', sym: '⚙', kind: 'point', aud: 'fm' },
  water: { label: 'Water meter / shut-off', color: '#01579B', sym: '🔧', kind: 'point', aud: 'fm' },
  backflow: { label: 'Backflow preventer', color: '#01579B', sym: '⛉', kind: 'point', aud: 'fm' },
  fire: { label: 'Fire panel / sprinkler valve', color: '#C62828', sym: '🔥', kind: 'point', aud: 'fm' },
  power: { label: 'Electrical / meter board', color: '#F9A825', sym: '⚡', kind: 'point', aud: 'fm' },
  note: { label: 'Note', color: '#455A64', sym: 'i', kind: 'point' },
  path: { label: 'Accessible path', color: '#F57C00', kind: 'line' },
  drive: { label: 'Vehicle route', color: '#616161', kind: 'line' },
  stream: { label: 'Stream', color: '#1E88E5', kind: 'line' },
  swpipe: { label: 'Stormwater outlet / overflow', color: '#26A69A', kind: 'line', aud: 'fm' },
  garden: { label: 'Gardens / orchard', color: '#7CB342', kind: 'area' },
  raingarden: { label: 'Rain garden', color: '#26A69A', kind: 'area' },
  native: { label: 'Native planting / stream buffer', color: '#2E7D32', kind: 'area' },
  carpark: { label: 'Car park', color: '#78909C', kind: 'area' },
  building: { label: 'Building', color: '#5C6BC0', kind: 'area' },
  boundary: { label: 'Site boundary', color: '#D81B60', kind: 'area' },
};
const ORDER = Object.keys(TYPES);
const BASES = {
  aerial: { label: 'Aerial', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', max: 20, nat: 19, attr: 'Imagery © Esri, Maxar, Earthstar Geographics' },
  street: { label: 'Street', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', max: 20, nat: 19, attr: '© OpenStreetMap contributors' },
};
const DEF = { center: [-36.9297, 174.6781], zoom: 18 };   // 81A Godley Road, Green Bay; any project can save its own view

let back = null, L = null, map = null, base = null, layer = null, M = null, sel = null, draw = null, tmp = null, timer = null, pid = null, V = { fmView: true, labels: true, ov: true, adj: false }, ovImg = null, hl = null;
const ed = () => can.edit();
const T = f => TYPES[f.t] || TYPES.note;
const pts = f => { const o = []; for (let i = 0; i + 1 < (f.p || []).length; i += 2) o.push([f.p[i], f.p[i + 1]]); return o; };   // Firestore can't hold nested arrays, so points are kept flat
const flat = a => a.flatMap(x => [+x.lat.toFixed(7), +x.lng.toFixed(7)]);
const shown = f => V.fmView || T(f).aud !== 'fm';
const load = () => { const s = S.project.siteMap || {}; return { center: s.center || DEF.center, zoom: s.zoom || DEF.zoom, base: s.base || 'aerial', feats: (s.feats || []).map(f => ({ ...f })), ov: s.ov ? { ...s.ov } : null }; };
function save(now) { clearTimeout(timer); const go = async () => { try { const v = { center: M.center, zoom: M.zoom, base: M.base, feats: M.feats, ov: M.ov || null, updated: new Date().toISOString() }; await S.store.updateProject(pid, { siteMap: v }); S.project.siteMap = v; } catch (e) { toast('The map could not be saved: ' + e.message, 6000); } }; if (now) return go(); timer = setTimeout(go, 700); }

async function leaflet() {
  if (window.L) return (L = window.L);
  if (!document.querySelector('link[data-lf]')) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'lib/leaflet/leaflet.css'; l.dataset.lf = 1; document.head.appendChild(l); }
  await loadScript('lib/leaflet/leaflet.js'); return (L = window.L);
}

export async function view(onBack) {
  if (onBack) back = onBack;
  if (map && pid !== S.project.id) { map.remove(); map = null; }
  pid = S.project.id; M = load(); sel = null; draw = null;
  $('fmView').innerHTML = `<div class="fbar"><button class="btn2" id="smHome">‹ Home guide</button><h2>Site map</h2>
    <span class="seg"><button id="smA" class="${M.base === 'aerial' ? 'on' : ''}">Aerial</button><button id="smS" class="${M.base === 'street' ? 'on' : ''}">Street</button></span>
    <label class="chk small"><input type="checkbox" id="smFm" ${V.fmView ? 'checked' : ''}> Facilities items</label><label class="chk small"><input type="checkbox" id="smLb" ${V.labels ? 'checked' : ''}> Labels</label>
    ${ed() ? `<select id="smOv" title="Lay one of the project drawings over the map, for example the site plan"><option value="">No drawing over the map</option>${(S.plans || []).filter(p => p.kind !== 'elevation').map(p => `<option value="${esc(p.id)}" ${M.ov && M.ov.planId === p.id ? 'selected' : ''}>Drawing: ${esc(p.name)}</option>`).join('')}</select>` : M.ov ? `<label class="chk small"><input type="checkbox" id="smOvS" ${V.ov ? 'checked' : ''}> Site plan</label>` : ''}
    <span id="smOvT" ${M.ov ? '' : 'hidden'}><input type="range" id="smOp" min="15" max="100" value="${Math.round(((M.ov && M.ov.op) || 0.75) * 100)}" title="How solid the drawing is">${ed() ? '<button class="btn2" id="smAdj" title="Move, turn and size the drawing until it sits on the site">✥ Line it up</button>' : ''}</span>
    <span class="sp"></span>${ed() ? '<button class="btn2" id="smView" title="Use the map as it is now framed as the starting view and for the Home guide page">Save this view</button><button class="btn2 go" id="smGuide">📖 Add to Home guide</button>' : ''}<button class="btn2" id="smPng">⬇ Picture</button></div>
    <div id="smWrap"><div id="smMap"></div><aside id="smSide"></aside></div>`;
  $('smHome').onclick = () => { clearTimeout(timer); if (map) { map.remove(); map = null; } back && back(); };
  await leaflet();
  if (map) map.remove();
  map = L.map('smMap', { zoomSnap: 1, maxZoom: 20, doubleClickZoom: false, attributionControl: true }).setView(M.center, M.zoom);
  setBase(M.base);
  map.createPane('plan').style.zIndex = 250; map.getPane('plan').style.pointerEvents = 'none';
  layer = L.layerGroup().addTo(map); tmp = L.layerGroup().addTo(map); hl = L.layerGroup().addTo(map); ovImg = null; V.adj = false;
  map.on('zoomend viewreset', ovPaint);
  map.on('click', onClick); map.on('dblclick', () => draw && finish());
  map.on('moveend', () => { const c = map.getCenter(); M.view = { center: [c.lat, c.lng], zoom: map.getZoom() }; });
  $('smA').onclick = () => { setBase('aerial'); $('smA').classList.add('on'); $('smS').classList.remove('on'); if (ed()) { M.base = 'aerial'; save(); } };
  $('smS').onclick = () => { setBase('street'); $('smS').classList.add('on'); $('smA').classList.remove('on'); if (ed()) { M.base = 'street'; save(); } };
  $('smFm').onchange = e => { V.fmView = e.target.checked; const f = M.feats.find(x => x.id === sel); if (f && !shown(f)) sel = null; paint(); side(); };
  $('smLb').onchange = e => { V.labels = e.target.checked; paint(); };
  if ($('smOv')) $('smOv').onchange = e => { const id = e.target.value; M.ov = id ? { planId: id, op: (M.ov && M.ov.op) || 0.75, p: M.ov && M.ov.planId === id ? M.ov.p : null } : null; V.adj = !!id; $('smOvT').hidden = !id; save(); ovLoad(); };
  if ($('smOvS')) $('smOvS').onchange = e => { V.ov = e.target.checked; ovLoad(); };
  $('smOp').oninput = e => { if (!M.ov) return; M.ov.op = +e.target.value / 100; if (ovImg) ovImg.style.opacity = M.ov.op; if (ed()) save(); };
  if ($('smAdj')) $('smAdj').onclick = () => { V.adj = !V.adj; ovHandles(); };
  ovLoad();
  $('smPng').onclick = async () => { const b = busy('Drawing the map…'); try { const cv = await snapshot(); b.done(); cv.toBlob(bl => deliver(bl, `${safeName(S.project.name)} - site map - ${stamp()}.png`, 'Site map'), 'image/png'); } catch (e) { b.done(); toast(e.message, 6000); } };
  if (ed()) { $('smView').onclick = () => { const c = map.getCenter(); M.center = [+c.lat.toFixed(6), +c.lng.toFixed(6)]; M.zoom = map.getZoom(); save(true); toast('Saved as the starting view'); }; $('smGuide').onclick = toGuide; }
  if (!window.__smKey) { window.__smKey = 1; document.addEventListener('keydown', e => { if (e.key === 'Escape' && draw && $('smMap')) cancelDraw(); }); }
  paint(); side(); setTimeout(() => map && map.invalidateSize(), 150);
}

/* ---------- a project drawing laid over the map: kept as three corners, lined up with a move handle and a turn-and-size handle ---------- */
const ZP = 22, pj = ll => map.project(ll, ZP), un = q => map.unproject(q, ZP);
function ovSet(C, r) {   // C: centre, r: centre to the top right corner, both in map pixels at zoom ZP; the drawing keeps its shape
  const a = ovImg.naturalHeight / ovImg.naturalWidth, ang = Math.atan2(r.y, r.x) - Math.atan2(-a, 1), sz = Math.hypot(r.x, r.y) / Math.hypot(1, a);
  const hx = L.point(sz * Math.cos(ang), sz * Math.sin(ang)), hy = L.point(-sz * a * Math.sin(ang), sz * a * Math.cos(ang));
  M.ov.p = flat([un(C.subtract(hx).subtract(hy)), un(C.add(hx).subtract(hy)), un(C.subtract(hx).add(hy))]);
}
const ovC = () => { const [, tr, bl] = pts(M.ov).map(pj); return tr.add(bl).divideBy(2); };
async function ovLoad() {
  if (ovImg) { ovImg.remove(); ovImg = null; } hl && hl.clearLayers();
  const adj = $('smAdj'); if (adj) adj.classList.toggle('go', V.adj);
  if (!M.ov || !V.ov) return; const pl = (S.plans || []).find(x => x.id === M.ov.planId); if (!pl || !pl.img) return;
  const myMap = map, im = new Image(); im.crossOrigin = 'anonymous'; im.className = 'smov leaflet-zoom-hide';
  try { im.src = await S.store.resolveUrl(pl.img); await im.decode(); } catch (e) { return toast('The drawing could not be loaded'); }
  if (map !== myMap || !M.ov || M.ov.planId !== pl.id) return;
  ovImg = im; im.style.opacity = M.ov.op || 0.75; map.getPane('plan').appendChild(im);
  if (!M.ov.p || M.ov.p.length !== 6) { const sz = map.getSize(), k = 2 ** (ZP - map.getZoom()), w = sz.x * 0.6 * k; ovSet(pj(map.getCenter()), L.point(w / 2, -w / 2 * im.naturalHeight / im.naturalWidth)); if (ed()) save(); }
  ovPaint(); ovHandles();
}
function ovPaint() {
  if (!ovImg || !M.ov || !M.ov.p) return; const [tl, tr, bl] = pts(M.ov).map(ll => map.latLngToLayerPoint(ll)), w = ovImg.naturalWidth, h = ovImg.naturalHeight;
  ovImg.style.transform = `matrix(${(tr.x - tl.x) / w},${(tr.y - tl.y) / w},${(bl.x - tl.x) / h},${(bl.y - tl.y) / h},${tl.x},${tl.y})`;
}
function ovHandles() {
  hl.clearLayers(); const adj = $('smAdj'); if (adj) { adj.classList.toggle('go', V.adj); adj.textContent = V.adj ? '✓ Done lining up' : '✥ Line it up'; }
  if (!V.adj || !ovImg || !M.ov || !ed()) return;
  const hd = (ll, sym, tip) => L.marker(ll, { draggable: true, zIndexOffset: 2000, title: tip, icon: L.divIcon({ className: '', iconSize: [38, 38], iconAnchor: [19, 19], html: `<div class="smoh">${sym}</div>` }) }).addTo(hl);
  const P = pts(M.ov), c = hd(un(ovC()), '✥', 'Drag to move the drawing'), r = hd(P[1], '⟳', 'Drag to turn and size the drawing');
  c.on('drag', () => { const C0 = ovC(), C1 = pj(c.getLatLng()), d = C1.subtract(C0); M.ov.p = flat(pts(M.ov).map(ll => un(pj(ll).add(d)))); ovPaint(); r.setLatLng(pts(M.ov)[1]); });
  r.on('drag', () => { const C = ovC(); ovSet(C, pj(r.getLatLng()).subtract(C)); ovPaint(); });
  c.on('dragend', () => save()); r.on('dragend', () => save());
}

function setBase(k) { if (base) map.removeLayer(base); const b = BASES[k] || BASES.aerial; base = L.tileLayer(b.url, { maxZoom: b.max, maxNativeZoom: b.nat, attribution: b.attr, crossOrigin: 'anonymous' }).addTo(map); }

const icon = (f, n) => { const t = T(f), on = sel === f.id; return L.divIcon({ className: '', iconSize: [30, 30], iconAnchor: [15, 15], html: `<div class="smpin${on ? ' on' : ''}" style="background:${t.color}">${esc(t.sym || '•')}${n ? `<b>${n}</b>` : ''}</div>` }); };
function paint() {
  layer.clearLayers();
  M.feats.filter(shown).forEach(f => {
    const t = T(f), P = pts(f), on = sel === f.id; let g;
    if (!P.length) return;
    if (t.kind === 'point') g = L.marker(P[0], { icon: icon(f), draggable: ed() && on, keyboard: false });
    else if (t.kind === 'line') g = L.polyline(P, { color: t.color, weight: on ? 7 : 5, opacity: 0.95, dashArray: f.t === 'path' ? '1 9' : f.t === 'swpipe' ? '8 6' : null, lineCap: 'round' });
    else g = L.polygon(P, { color: t.color, weight: on ? 4 : 2, fillColor: t.color, fillOpacity: f.t === 'boundary' ? 0 : on ? 0.4 : 0.25, dashArray: f.t === 'boundary' ? '10 6' : null });
    g.on('click', e => { L.DomEvent.stop(e); if (draw) return onClick(e); select(f.id); });
    if (V.labels && (f.label || t.kind !== 'point')) g.bindTooltip(esc(f.label || t.label), { permanent: true, direction: t.kind === 'point' ? 'right' : 'center', className: 'smtip', offset: t.kind === 'point' ? [14, 0] : [0, 0] });
    if (t.kind === 'point' && ed() && on) g.on('dragend', () => { f.p = flat([g.getLatLng()]); save(); side(); });
    g.addTo(layer);
    if (ed() && on && t.kind !== 'point') P.forEach((ll, i) => { const h = L.marker(ll, { draggable: true, icon: L.divIcon({ className: '', iconSize: [16, 16], iconAnchor: [8, 8], html: '<div class="smvx"></div>' }) }).addTo(layer);
      h.on('drag', () => { const q = pts(f); q[i] = [h.getLatLng().lat, h.getLatLng().lng]; g.setLatLngs(q); });
      h.on('dragend', () => { const q = pts(f); q[i] = [h.getLatLng().lat, h.getLatLng().lng]; f.p = q.flat().map(v => +v.toFixed(7)); save(); });
      h.on('contextmenu', () => { const q = pts(f); if (q.length <= (t.kind === 'area' ? 3 : 2)) return; q.splice(i, 1); f.p = q.flat(); save(); paint(); }); });
  });
}

function select(id) { sel = sel === id ? null : id; paint(); side(); const f = M.feats.find(x => x.id === sel); if (f && !map.getBounds().contains(pts(f)[0])) map.panTo(pts(f)[0]); }

function side() {
  const S2 = $('smSide'); if (!S2) return;
  if (draw) { const t = TYPES[draw.t]; S2.innerHTML = `<h3>Adding: ${esc(t.label)}</h3><p class="small">${t.kind === 'point' ? 'Tap the map where it is.' : `Tap the map at each corner${t.kind === 'line' ? ' or bend' : ''}. ${draw.pts.length} so far. Press Finish (or double-tap) when done.`}</p>
    ${t.kind !== 'point' ? `<button class="btn2 go" id="smFin" ${draw.pts.length < (t.kind === 'area' ? 3 : 2) ? 'disabled' : ''}>Finish</button> <button class="btn2" id="smUndo" ${draw.pts.length ? '' : 'disabled'}>Undo last</button> ` : ''}<button class="btn2" id="smCan">Cancel</button>`;
    if ($('smFin')) { $('smFin').onclick = finish; $('smUndo').onclick = () => { draw.pts.pop(); preview(); side(); }; } $('smCan').onclick = cancelDraw; return; }
  const f = M.feats.find(x => x.id === sel);
  if (f) { const t = T(f), ro = !ed();
    S2.innerHTML = `<button class="mini" id="smBack">‹ All items</button><h3><span class="smdot" style="background:${t.color}">${esc(t.sym || '')}</span> ${esc(f.label || t.label)}</h3>
      ${ro ? `<p class="small muted">${esc(t.label)}</p>${f.note ? `<p>${esc(f.note)}</p>` : ''}` : `<label>Type<select id="smT">${ORDER.filter(k => TYPES[k].kind === t.kind).map(k => `<option value="${k}" ${k === f.t ? 'selected' : ''}>${esc(TYPES[k].label)}${TYPES[k].aud === 'fm' ? ' (facilities)' : ''}</option>`).join('')}</select></label>
      <label>Name on the map<input id="smL" value="${esc(f.label || '')}" placeholder="${esc(t.label)}"></label>
      <label>Note (what to do, how to get in, who looks after it)<textarea id="smN" rows="3">${esc(f.note || '')}</textarea></label>
      <p class="small muted">${t.kind === 'point' ? 'Drag the pin to move it.' : 'Drag the white corners to reshape it. Right-click a corner to remove it.'}</p>
      <button class="btn2 danger" id="smDel">Delete</button>`}
      <p><a class="small" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${pts(f)[0].join(',')}">Directions in Google Maps ↗</a></p>`;
    $('smBack').onclick = () => select(f.id);
    if (!ro) { $('smT').onchange = e => { f.t = e.target.value; save(); paint(); side(); }; $('smL').oninput = e => { f.label = e.target.value; save(); paint(); }; $('smN').oninput = e => { f.note = e.target.value; save(); };
      $('smDel').onclick = async () => { if (!(await confirmBox(`Delete “${f.label || t.label}” from the map?`, 'Delete'))) return; M.feats = M.feats.filter(x => x !== f); sel = null; save(); paint(); side(); }; }
    return; }
  const list = M.feats.filter(shown), by = ORDER.filter(k => list.some(f => f.t === k));
  S2.innerHTML = `${ed() ? `<h3>Add to the map</h3><div class="smpal">${ORDER.filter(k => V.fmView || !TYPES[k].aud).map(k => { const t = TYPES[k]; return `<button data-add="${k}" title="${esc(t.label)}"><span class="smdot${t.kind !== 'point' ? ' ' + t.kind : ''}" style="background:${t.color}">${t.kind === 'point' ? esc(t.sym) : ''}</span>${esc(t.label)}</button>`; }).join('')}</div>` : ''}
    <h3>On the map (${list.length})</h3>${by.length ? by.map(k => `<div class="smgrp"><b>${esc(TYPES[k].label)}${TYPES[k].aud === 'fm' ? ' <span class="badge">Facilities</span>' : ''}</b>${list.filter(f => f.t === k).map(f => `<a href="#" data-sel="${f.id}">${esc(f.label || TYPES[k].label)}</a>${f.note ? `<small>${esc(f.note)}</small>` : ''}`).join('')}</div>`).join('') : `<p class="muted small">${ed() ? 'Nothing marked yet. Pick a type above, then tap the map.' : 'Nothing has been marked on the map yet.'}</p>`}`;
  S2.querySelectorAll('[data-add]').forEach(b => b.onclick = () => { draw = { t: b.dataset.add, pts: [] }; sel = null; paint(); side(); $('smMap').classList.add('drawing'); });
  S2.querySelectorAll('[data-sel]').forEach(a => a.onclick = e => { e.preventDefault(); select(a.dataset.sel); });
}

function onClick(e) {
  if (!draw) { if (sel) { sel = null; paint(); side(); } return; }
  const t = TYPES[draw.t]; draw.pts.push(e.latlng);
  if (t.kind === 'point') return finish();
  preview(); side();
}
function preview() { tmp.clearLayers(); if (!draw) return; const t = TYPES[draw.t]; if (draw.pts.length > 1) (t.kind === 'area' ? L.polygon : L.polyline)(draw.pts, { color: t.color, weight: 3, dashArray: '6 6', fillOpacity: 0.15 }).addTo(tmp); draw.pts.forEach(p => L.circleMarker(p, { radius: 5, color: '#fff', weight: 2, fillColor: t.color, fillOpacity: 1 }).addTo(tmp)); }
function finish() {
  const t = TYPES[draw.t], min = t.kind === 'area' ? 3 : t.kind === 'line' ? 2 : 1;
  if (draw.pts.length < min) return toast(`Tap at least ${min} points first`);
  const f = { id: uid(), t: draw.t, label: '', note: '', p: flat(draw.pts) }; M.feats.push(f);
  cancelDraw(); sel = f.id; save(); paint(); side(); setTimeout(() => $('smL') && $('smL').focus(), 50);
}
function cancelDraw() { draw = null; tmp && tmp.clearLayers(); $('smMap') && $('smMap').classList.remove('drawing'); side(); }

/* ---------- a picture of the map: tiles drawn onto a canvas, then the mark-up on top ---------- */
const tileImg = u => new Promise(res => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => res(im); im.onerror = () => res(null); im.src = u; });
export async function snapshot(opt = {}) {
  const sc = 2, sz = map.getSize(), z0 = map.getZoom(), B = BASES[M.base] || BASES.aerial;
  const zt = Math.min(z0 + 1, B.nat), k = 2 ** (z0 + 1 - zt);   // tiles one level deeper for a sharp picture, scaled up past the deepest imagery
  const W = sz.x * sc, H = sz.y * sc, cv = document.createElement('canvas'); cv.width = W; cv.height = H; const c = cv.getContext('2d');
  c.fillStyle = '#e8ecef'; c.fillRect(0, 0, W, H);
  const tl = map.project(map.getBounds().getNorthWest(), z0 + 1), proj = ll => { const p = map.project(ll, z0 + 1); return { x: p.x - tl.x, y: p.y - tl.y }; };
  const ts = 256 * k, x0 = Math.floor(tl.x / ts), y0 = Math.floor(tl.y / ts), x1 = Math.floor((tl.x + W) / ts), y1 = Math.floor((tl.y + H) / ts), jobs = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) jobs.push(tileImg(B.url.replace('{z}', zt).replace('{x}', x).replace('{y}', y)).then(im => im && c.drawImage(im, x * ts - tl.x, y * ts - tl.y, ts, ts)));
  await Promise.all(jobs);
  if (ovImg && M.ov && M.ov.p && V.ov) { const [a, b2, d] = pts(M.ov).map(proj), w = ovImg.naturalWidth, h = ovImg.naturalHeight; c.save(); c.globalAlpha = M.ov.op || 0.75; c.setTransform((b2.x - a.x) / w, (b2.y - a.y) / w, (d.x - a.x) / h, (d.y - a.y) / h, a.x, a.y); c.drawImage(ovImg, 0, 0); c.restore(); }
  const F = M.feats.filter(f => opt.residents ? T(f).aud !== 'fm' : shown(f));
  const lab = (t, x, y, col) => { c.font = '700 26px "Segoe UI", system-ui, Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineWidth = 7; c.strokeStyle = 'rgba(255,255,255,0.92)'; c.strokeText(t, x, y); c.fillStyle = col || '#1a1a1a'; c.fillText(t, x, y); };
  for (const kind of ['area', 'line']) F.filter(f => T(f).kind === kind).forEach(f => { const t = T(f), P = pts(f).map(proj); if (P.length < 2) return;
    c.beginPath(); P.forEach((p, i) => i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)); if (kind === 'area') c.closePath();
    c.setLineDash(f.t === 'boundary' ? [20, 12] : f.t === 'path' ? [2, 16] : f.t === 'swpipe' ? [16, 12] : []); c.lineCap = 'round';
    if (kind === 'area' && f.t !== 'boundary') { c.fillStyle = t.color + '55'; c.fill(); }
    c.strokeStyle = t.color; c.lineWidth = kind === 'line' ? 9 : 5; c.stroke(); c.setLineDash([]);
    if (opt.labels != null ? opt.labels : V.labels) { const m = P.reduce((a, p) => ({ x: a.x + p.x / P.length, y: a.y + p.y / P.length }), { x: 0, y: 0 }); lab(f.label || t.label, m.x, m.y, t.color === '#D81B60' ? '#D81B60' : '#1a1a1a'); } });
  if (!opt.noPins) F.filter(f => T(f).kind === 'point').forEach(f => { const t = T(f), p = proj(pts(f)[0]);
    c.beginPath(); c.arc(p.x, p.y, 25, 0, 7); c.fillStyle = '#fff'; c.fill(); c.beginPath(); c.arc(p.x, p.y, 21, 0, 7); c.fillStyle = t.color; c.fill();
    c.fillStyle = '#fff'; c.font = '24px "Segoe UI Emoji", "Apple Color Emoji", system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(t.sym || '•', p.x, p.y + 1);
    if (opt.pinLabel ? opt.pinLabel(f) : V.labels) { const s2 = f.label || t.label; c.font = '700 26px "Segoe UI", system-ui, Arial'; lab(s2, p.x + 34 + c.measureText(s2).width / 2, p.y); } });
  // north arrow and credit
  c.fillStyle = 'rgba(255,255,255,0.9)'; c.fillRect(W - 80, 20, 56, 76); c.fillStyle = '#172B4D'; c.beginPath(); c.moveTo(W - 52, 30); c.lineTo(W - 66, 70); c.lineTo(W - 52, 60); c.lineTo(W - 38, 70); c.closePath(); c.fill(); c.font = '700 20px system-ui'; c.textAlign = 'center'; c.fillText('N', W - 52, 86);
  c.font = '16px system-ui'; c.textAlign = 'right'; c.fillStyle = 'rgba(255,255,255,0.85)'; const cr = B.attr; c.fillRect(W - c.measureText(cr).width - 20, H - 28, c.measureText(cr).width + 20, 28); c.fillStyle = '#333'; c.fillText(cr, W - 10, H - 13);
  return { canvas: cv, proj: ll => { const p = proj(ll); return { x: p.x / W, y: p.y / H }; }, toBlob: (...a) => cv.toBlob(...a) };
}

/* ---------- the Home guide page: the map picture, with the residents' places as numbered pointers ---------- */
async function toGuide() {
  const F = M.feats.filter(f => T(f).aud !== 'fm' && T(f).kind === 'point');
  if (!M.feats.some(f => T(f).aud !== 'fm')) return toast('Mark some places on the map first');
  const have = ((S.fm && S.fm.guide) || []).find(p => p.siteMap);
  if (!(await confirmBox(`${have ? 'Update the “' + esc(have.title) + '” page' : 'Add a “Your site map” page'} in the Home guide with the map as it is framed now?${F.length > 8 ? ' The first 8 places become numbered pointers; the rest show as labels on the map.' : ''} Facilities-only items are left off.`, have ? 'Update the page' : 'Add the page'))) return;
  const b = busy('Drawing the map…');
  try {
    const pins = F.slice(0, 8), snap = await snapshot({ residents: true, labels: true, pinLabel: f => !pins.includes(f) });   // places without a pointer are labelled on the picture
    const blob = await new Promise(r => snap.canvas.toBlob(r, 'image/jpeg', 0.88));
    const id = have ? have.id : uid();
    const url = await S.store.putFile(`projects/${pid}/docs/guide-${id}/photo-${Date.now()}.jpg`, blob, true);
    const marks = pins.map(f => { const q = snap.proj(pts(f)[0]), nx = Math.min(0.96, Math.max(0.04, q.x + (q.x > 0.5 ? -0.07 : 0.07))), ny = Math.min(0.95, Math.max(0.05, q.y - 0.06)); return { tx: q.x, ty: q.y, nx, ny, label: f.label || T(f).label, sub: f.note ? f.note.split(/[.\n]/)[0].slice(0, 60) : '' }; });
    const base = have ? { ...have } : { id, order: Math.max(0, ...(((S.fm && S.fm.guide) || []).map(p => p.order || 0))) + 1, title: 'Your site map', aud: 'both', lines: `Your home is at ${S.project.address || S.project.name}.\n` + 'Use this map to find the places you need around the site.\n!Please keep paths and doorways clear for walkers and mobility scooters.', zooms: [], steps: [], docIds: [] };
    await S.store.saveItem(pid, 'guide', { ...base, siteMap: true, wide: true, photo: url, marks, updated: new Date().toISOString() });
    b.done(); toast(have ? 'Map page updated in the guide' : 'Map page added to the end of the guide. Press ‹ Home guide to see it and move it into place.', 6000);
  } catch (e) { b.done(); toast('Could not make the page: ' + e.message, 7000); }
}
