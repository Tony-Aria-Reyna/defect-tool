// Site map: an aerial or street map of the site, marked up with what residents and the facilities team need to find
// (entrances, bin store, bike store, washing lines, gardens, tanks, stormwater, shut-offs). Admins and editors mark it up;
// everyone on the project can view it. A snapshot can be added to the Home guide as a page with numbered pointers.
import { S, can } from './state.js';
import { $, esc, toast, busy, confirmBox, uid, loadScript, deliver, safeName, stamp, compressImage, dataUrlToBlob } from './util.js';

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

let crop = null, pinMode = false, EM = null, keepAdj = false, back = null, L = null, map = null, base = null, layer = null, M = null, sel = null, draw = null, tmp = null, timer = null, pid = null, V = { fmView: true, labels: true, ov: true, adj: false }, ovImg = null, hl = null;
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
    ${ed() ? `<select id="smOv" title="Lay one of the project drawings over the map, for example the site plan"><option value="">No drawing over the map</option>${M.ov && M.ov.img ? '<option value="__own" selected>Drawing: uploaded picture</option>' : ''}<option value="__up">⬆ Upload a picture of a drawing…</option>${(S.plans || []).filter(p => p.kind !== 'elevation').map(p => `<option value="${esc(p.id)}" ${M.ov && M.ov.planId === p.id ? 'selected' : ''}>Drawing: ${esc(p.name)}</option>`).join('')}</select>` : M.ov ? `<label class="chk small"><input type="checkbox" id="smOvS" ${V.ov ? 'checked' : ''}> Site plan</label>` : ''}
    <span id="smOvT" ${M.ov ? '' : 'hidden'}><input type="range" id="smOp" min="15" max="100" value="${Math.round(((M.ov && M.ov.op) || 0.75) * 100)}" title="How solid the drawing is">${ed() ? '<button class="btn2" id="smAdj" title="Move, turn and size the drawing until it sits on the site">✥ Line it up</button>' : ''}</span>
    <span class="sp"></span>${ed() ? '<button class="btn2" id="smView" title="Use the map as it is now framed as the starting view and for the Home guide page">Save this view</button><button class="btn2 go" id="smGuide">📖 Add to Home guide</button>' : ''}<button class="btn2" id="smPng">⬇ Picture</button></div>
    <div id="smWrap"><div id="smMap"></div><aside id="smSide"></aside></div>`;
  $('smHome').onclick = () => { clearTimeout(timer); if (map) { map.remove(); map = null; } back && back(); };
  await leaflet();
  if (map) map.remove();
  map = L.map('smMap', { zoomSnap: 1, maxZoom: 20, doubleClickZoom: false, attributionControl: true }).setView(M.center, M.zoom);
  setBase(M.base);
  map.createPane('plan').style.zIndex = 250; map.getPane('plan').style.pointerEvents = 'none';
  layer = L.layerGroup().addTo(map); tmp = L.layerGroup().addTo(map); hl = L.layerGroup().addTo(map); ovImg = null; V.adj = keepAdj; keepAdj = false; crop = null; pinMode = false;
  map.on('zoomend viewreset', ovPaint);
  map.on('click', onClick); map.on('dblclick', () => { if (crop) return cropFinish(); draw && finish(); });
  map.on('moveend', () => { const c = map.getCenter(); M.view = { center: [c.lat, c.lng], zoom: map.getZoom() }; });
  $('smA').onclick = () => { setBase('aerial'); $('smA').classList.add('on'); $('smS').classList.remove('on'); if (ed()) { M.base = 'aerial'; save(); } };
  $('smS').onclick = () => { setBase('street'); $('smS').classList.add('on'); $('smA').classList.remove('on'); if (ed()) { M.base = 'street'; save(); } };
  $('smFm').onchange = e => { V.fmView = e.target.checked; const f = M.feats.find(x => x.id === sel); if (f && !shown(f)) sel = null; paint(); side(); };
  $('smLb').onchange = e => { V.labels = e.target.checked; paint(); };
  if ($('smOv')) $('smOv').onchange = e => { const id = e.target.value; if (id === '__own') return; if (id === '__up') { e.target.value = M.ov ? (M.ov.img ? '__own' : M.ov.planId) : ''; return ovUpload(); } M.ov = id ? (M.ov && M.ov.planId === id ? M.ov : { planId: id, op: (M.ov && M.ov.op) || 0.75, p: null }) : null; V.adj = !!id; $('smOvT').hidden = !id; save(); ovLoad(); };
  if ($('smOvS')) $('smOvS').onchange = e => { V.ov = e.target.checked; ovLoad(); };
  $('smOp').oninput = e => { if (!M.ov) return; M.ov.op = +e.target.value / 100; if (ovImg) ovImg.style.opacity = M.ov.op; if (ed()) save(); };
  if ($('smAdj')) $('smAdj').onclick = () => { V.adj = !V.adj; ovHandles(); };
  ovLoad();
  $('smPng').onclick = async () => { const b = busy('Drawing the map…'); try { const cv = await snapshot(); b.done(); cv.toBlob(bl => deliver(bl, `${safeName(S.project.name)} - site map - ${stamp()}.png`, 'Site map'), 'image/png'); } catch (e) { b.done(); toast(e.message, 6000); } };
  if (ed()) { $('smView').onclick = () => { const c = map.getCenter(); M.center = [+c.lat.toFixed(6), +c.lng.toFixed(6)]; M.zoom = map.getZoom(); save(true); toast('Saved as the starting view'); }; $('smGuide').onclick = toGuide; }
  if (!window.__smKey) { window.__smKey = 1; document.addEventListener('keydown', e => { if (e.key !== 'Escape' || !$('smMap')) return; if (crop) return cropEnd(); if (pinMode) { pinMode = false; $('smMap').classList.remove('drawing'); return side(); } if (draw) cancelDraw(); }); }
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
  if (!M.ov || !V.ov) return; const pl = M.ov.img ? { id: M.ov.img, img: M.ov.img } : (S.plans || []).find(x => x.id === M.ov.planId); if (!pl || !pl.img) return;
  const myMap = map, im = new Image(); im.crossOrigin = 'anonymous'; im.className = 'smov leaflet-zoom-hide';
  try { im.src = await S.store.resolveUrl(pl.img); await im.decode(); } catch (e) { return toast('The drawing could not be loaded'); }
  if (map !== myMap || !M.ov || (M.ov.img || M.ov.planId) !== pl.id) return;
  ovImg = im; im.style.opacity = M.ov.op || 0.75; map.getPane('plan').appendChild(im);
  if (!M.ov.p || M.ov.p.length !== 6) { const sz = map.getSize(), k = 2 ** (ZP - map.getZoom()), w = sz.x * 0.6 * k; ovSet(pj(map.getCenter()), L.point(w / 2, -w / 2 * im.naturalHeight / im.naturalWidth)); if (ed()) save(); }
  ovPaint(); ovHandles();
}
function ovUpload() {
  const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*';
  i.onchange = async () => { const f = i.files[0]; if (!f) return; const b = busy('Loading the drawing…');
    try { const url = await S.store.putFile(`projects/${pid}/docs/sitemap/drawing-${Date.now()}.jpg`, dataUrlToBlob((await compressImage(f, 3000, 0.86)).dataUrl), true);
      M.ov = { img: url, op: (M.ov && M.ov.op) || 0.75, p: null }; keepAdj = true; b.done(); await save(true); view(); } catch (e) { b.done(); toast('The drawing could not be loaded: ' + e.message, 7000); } };
  i.click();
}
function ovPaint() {
  if (!ovImg || !M.ov || !M.ov.p) return; const [tl, tr, bl] = pts(M.ov).map(ll => map.latLngToLayerPoint(ll)), w = ovImg.naturalWidth, h = ovImg.naturalHeight;
  ovImg.style.clipPath = M.ov.crop && M.ov.crop.length >= 6 && !crop ? `polygon(${pts({ p: M.ov.crop }).map(q => (q[0] * 100).toFixed(2) + '% ' + (q[1] * 100).toFixed(2) + '%').join(',')})` : '';
  ovImg.style.transform = `matrix(${(tr.x - tl.x) / w},${(tr.y - tl.y) / w},${(bl.x - tl.x) / h},${(bl.y - tl.y) / h},${tl.x},${tl.y})`;
}
// where a point on the map falls on the drawing (0 to 1 across and down), and back again
const ovGeo = () => { const [tl, tr, bl] = pts(M.ov).map(pj); return { tl, ex: tr.subtract(tl), ey: bl.subtract(tl) }; };
function toUV(ll) { const g = ovGeo(), q = pj(ll).subtract(g.tl), det = g.ex.x * g.ey.y - g.ey.x * g.ex.y; return [(q.x * g.ey.y - g.ey.x * q.y) / det, (g.ex.x * q.y - q.x * g.ex.y) / det]; }
function fromUV(u, v) { const g = ovGeo(); return un(L.point(g.tl.x + g.ex.x * u + g.ey.x * v, g.tl.y + g.ex.y * u + g.ey.y * v)); }
function ovHandles() {
  hl.clearLayers(); const adj = $('smAdj'); if (adj) { adj.classList.toggle('go', V.adj); adj.textContent = V.adj ? '✓ Done lining up' : '✥ Line it up'; }
  if (!V.adj) { crop = null; pinMode = false; tmp && tmp.clearLayers(); ovPaint(); }
  side(); if (!V.adj || !ovImg || !M.ov || !ed() || crop) return;
  const hd = (ll, sym, tip, cls) => L.marker(ll, { draggable: true, zIndexOffset: 2000, title: tip, icon: L.divIcon({ className: '', iconSize: [38, 38], iconAnchor: [19, 19], html: `<div class="smoh ${cls || ''}">${sym}</div>` }) }).addTo(hl);
  const pin = M.ov.pin, P = pts(M.ov), c = hd(un(ovC()), '✥', 'Drag to move the drawing'), r = hd(P[1], '⟳', pin ? 'Drag to turn and size the drawing around the fixed point' : 'Drag to turn and size the drawing'), k = pin ? hd(fromUV(pin[0], pin[1]), '📌', 'The fixed point: the drawing turns and sizes around it. Drag it to another spot on the drawing.', 'pin') : null;
  const sync = () => { c.setLatLng(un(ovC())); if (k) k.setLatLng(fromUV(M.ov.pin[0], M.ov.pin[1])); };
  c.on('drag', () => { const d = pj(c.getLatLng()).subtract(ovC()); M.ov.p = flat(pts(M.ov).map(ll => un(pj(ll).add(d)))); ovPaint(); r.setLatLng(pts(M.ov)[1]); if (k) k.setLatLng(fromUV(M.ov.pin[0], M.ov.pin[1])); });
  let prev = null; r.on('dragstart', () => { prev = pj(pts(M.ov)[1]); });
  r.on('drag', () => { const A = M.ov.pin ? pj(fromUV(M.ov.pin[0], M.ov.pin[1])) : ovC(), cur = pj(r.getLatLng()), v0 = prev.subtract(A), v1 = cur.subtract(A), l0 = Math.hypot(v0.x, v0.y), l1 = Math.hypot(v1.x, v1.y); if (l0 < 2 || l1 < 2) return;
    const sc = l1 / l0, da = Math.atan2(v1.y, v1.x) - Math.atan2(v0.y, v0.x), cs = Math.cos(da) * sc, sn = Math.sin(da) * sc;
    M.ov.p = flat(pts(M.ov).map(ll => { const q = pj(ll).subtract(A); return un(L.point(A.x + q.x * cs - q.y * sn, A.y + q.x * sn + q.y * cs)); })); prev = cur; ovPaint(); sync(); });
  if (k) { k.on('drag', () => { M.ov.pin = toUV(k.getLatLng()).map(v => +v.toFixed(5)); }); k.on('dragend', () => save()); }
  c.on('dragend', () => save()); r.on('dragend', () => { r.setLatLng(pts(M.ov)[1]); save(); });
}
function adjSide(S2) {
  if (pinMode) { S2.innerHTML = `<h3>📌 Fixed point</h3><p class="small">Tap the spot on the drawing that is already sitting in the right place on the photo, for example a boundary corner.</p><button class="btn2" id="smPinC">Cancel</button>`; $('smPinC').onclick = () => { pinMode = false; $('smMap').classList.remove('drawing'); side(); }; return; }
  const has = !!M.ov.pin, cr = M.ov.crop && M.ov.crop.length >= 6;
  S2.innerHTML = `<h3>Lining up the drawing</h3><ol class="small smsteps"><li>Drag the <b>move</b> handle (the cross) until one point you can recognise (a boundary corner) sits exactly on the photo.</li><li>Press <b>Set a fixed point</b> and tap that point. It will not move again.</li><li>Drag the <b>turn</b> handle (the round arrow). The drawing turns and changes size around the fixed point until a second point lines up.</li></ol>
    <p><button class="btn2 ${has ? '' : 'go'}" id="smPin">${has ? '📌 Remove the fixed point' : '📌 Set a fixed point'}</button></p>
    <h3>Crop the drawing</h3><p class="small">Keep only the part inside an outline you trace, so the photo shows around the site.</p>
    <p><button class="btn2" id="smCrop">✂ ${cr ? 'Trace a new outline' : 'Crop to an outline'}</button> ${cr ? '<button class="btn2" id="smCropX">Remove the crop</button>' : ''}</p>
    <p><button class="btn2 go" id="smAdjD">✓ Done lining up</button></p>`;
  $('smPin').onclick = () => { if (M.ov.pin) { delete M.ov.pin; save(); return ovHandles(); } pinMode = true; $('smMap').classList.add('drawing'); side(); };
  $('smCrop').onclick = () => { crop = { pts: [], segs: [], follow: true }; hl.clearLayers(); $('smMap').classList.add('drawing'); ovPaint(); side(); edges(); };
  if ($('smCropX')) $('smCropX').onclick = () => { delete M.ov.crop; save(); ovPaint(); side(); };
  $('smAdjD').onclick = () => { V.adj = false; ovHandles(); };
}

/* ---------- cropping: tap around the part to keep; with "Follow edges" on, each stretch runs along the drawn line between the taps ---------- */
function edges() {
  if (EM && EM.src === ovImg.src) return EM;
  try { const k = Math.min(1, 1100 / Math.max(ovImg.naturalWidth, ovImg.naturalHeight)), w = Math.round(ovImg.naturalWidth * k), h = Math.round(ovImg.naturalHeight * k), cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const c = cv.getContext('2d', { willReadFrequently: true }); c.drawImage(ovImg, 0, 0, w, h); const d = c.getImageData(0, 0, w, h).data, gr = new Float32Array(w * h), g = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) gr[i] = d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11;
    let mx = 1; for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x, gx = gr[i - w + 1] + 2 * gr[i + 1] + gr[i + w + 1] - gr[i - w - 1] - 2 * gr[i - 1] - gr[i + w - 1], gy = gr[i + w - 1] + 2 * gr[i + w] + gr[i + w + 1] - gr[i - w - 1] - 2 * gr[i - w] - gr[i - w + 1]; const m = Math.hypot(gx, gy); g[i] = m; if (m > mx) mx = m; }
    const nm = mx * 0.45; for (let i = 0; i < g.length; i++) g[i] = Math.min(1, g[i] / nm);
    return (EM = { src: ovImg.src, w, h, g }); } catch (e) { console.warn('edges', e); return (EM = { src: ovImg.src, w: 0, h: 0, g: null }); }
}
function snapPx(E, x, y, rad) { let bx = x, by = y, bg = 0.3; for (let yy = Math.max(1, y - rad); yy <= Math.min(E.h - 2, y + rad); yy++) for (let xx = Math.max(1, x - rad); xx <= Math.min(E.w - 2, x + rad); xx++) { const d = Math.hypot(xx - x, yy - y); if (d > rad) continue; const v = E.g[yy * E.w + xx] - d / rad * 0.25; if (v > bg) { bg = v; bx = xx; by = yy; } } return [bx, by]; }
function tracePx(E, a, b) {   // cheapest path from a to b where walking along a drawn line is cheap
  const pad = 36, x0 = Math.max(0, Math.min(a[0], b[0]) - pad), y0 = Math.max(0, Math.min(a[1], b[1]) - pad), x1 = Math.min(E.w - 1, Math.max(a[0], b[0]) + pad), y1 = Math.min(E.h - 1, Math.max(a[1], b[1]) + pad), bw = x1 - x0 + 1, bh = y1 - y0 + 1, n = bw * bh;
  if (n > 700000) return [a, b];
  const dist = new Float32Array(n).fill(Infinity), from = new Int32Array(n).fill(-1), done = new Uint8Array(n), heap = [], idx = (x, y) => (y - y0) * bw + (x - x0), s = idx(a[0], a[1]), t = idx(b[0], b[1]);
  const push = (i, d) => { heap.push([d, i]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
  dist[s] = 0; push(s, 0);
  while (heap.length) { const [d, i] = pop(); if (done[i]) continue; done[i] = 1; if (i === t) break; const x = i % bw, y = (i - x) / bw;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue; const j = ny * bw + nx; if (done[j]) continue; const gv = E.g[(ny + y0) * E.w + nx + x0], nd = d + (dx && dy ? 1.414 : 1) * (0.04 + (1 - gv) * (1 - gv)); if (nd < dist[j]) { dist[j] = nd; from[j] = i; push(j, nd); } } }
  const out = []; for (let i = t; i !== -1; i = from[i]) { out.push([i % bw + x0, ((i - i % bw) / bw) + y0]); if (i === s) break; } out.reverse();
  return out.length > 1 && out[0][0] === a[0] && out[0][1] === a[1] ? thin(out, 1.1) : [a, b];
}
function thin(P, tol) { if (P.length < 3) return P; const keep = new Uint8Array(P.length); keep[0] = keep[P.length - 1] = 1; const st = [[0, P.length - 1]];
  while (st.length) { const [i, j] = st.pop(), [ax, ay] = P[i], [bx, by] = P[j], len = Math.hypot(bx - ax, by - ay) || 1; let md = 0, mk = -1; for (let k = i + 1; k < j; k++) { const d = Math.abs((bx - ax) * (ay - P[k][1]) - (ax - P[k][0]) * (by - ay)) / len; if (d > md) { md = d; mk = k; } } if (md > tol) { keep[mk] = 1; st.push([i, mk], [mk, j]); } }
  return P.filter((_, k) => keep[k]); }
function cropClick(ll) {
  let [u, v] = toUV(ll); u = Math.min(1, Math.max(0, u)); v = Math.min(1, Math.max(0, v)); const E = crop.follow ? edges() : null;
  if (E && E.g) { const g = ovGeo(), pxPer = Math.hypot(g.ex.x, g.ex.y) / 2 ** (ZP - map.getZoom()) / E.w, rad = Math.round(Math.min(40, Math.max(2, 14 / pxPer)));
    const q = snapPx(E, Math.round(u * (E.w - 1)), Math.round(v * (E.h - 1)), rad), last = crop.px;
    const seg = last ? tracePx(E, last, q).slice(1) : [q]; crop.px = q; crop.segs.push(seg.length); seg.forEach(s2 => crop.pts.push([s2[0] / (E.w - 1), s2[1] / (E.h - 1)])); }
  else { crop.pts.push([u, v]); crop.segs.push(1); crop.px = null; }
  cropPreview(); side();
}
function cropPreview() { tmp.clearLayers(); if (!crop || !crop.pts.length) return; const LL = crop.pts.map(q => fromUV(q[0], q[1])); if (LL.length > 1) L.polyline(LL, { color: '#FFC400', weight: 3 }).addTo(tmp); if (LL.length > 2) L.polyline([LL[LL.length - 1], LL[0]], { color: '#FFC400', weight: 2, dashArray: '5 6' }).addTo(tmp);
  let k = 0; crop.segs.forEach(n => { k += n; L.circleMarker(LL[k - 1], { radius: 5, color: '#172B4D', weight: 2, fillColor: '#FFC400', fillOpacity: 1 }).addTo(tmp); }); }
function cropSide(S2) {
  S2.innerHTML = `<h3>✂ Crop the drawing</h3><p class="small">Tap around the part to keep, a point at each corner or every so often along a curve. ${crop.segs.length} point${crop.segs.length === 1 ? '' : 's'} so far.</p>
    <label class="chk small"><input type="checkbox" id="smFol" ${crop.follow ? 'checked' : ''}> Follow edges: each tap snaps to the nearest drawn line, and the outline runs along that line from the tap before</label>
    <p><button class="btn2 go" id="smCrF" ${crop.pts.length < 3 ? 'disabled' : ''}>Finish</button> <button class="btn2" id="smCrU" ${crop.segs.length ? '' : 'disabled'}>Undo last</button> <button class="btn2" id="smCrC">Cancel</button></p>`;
  $('smFol').onchange = e => { crop.follow = e.target.checked; if (crop.follow && crop.pts.length) { const E = edges(), q = crop.pts[crop.pts.length - 1]; crop.px = E.g ? [Math.round(q[0] * (E.w - 1)), Math.round(q[1] * (E.h - 1))] : null; } };
  $('smCrF').onclick = cropFinish; $('smCrC').onclick = cropEnd;
  $('smCrU').onclick = () => { const n = crop.segs.pop(); crop.pts.splice(crop.pts.length - n, n); const q = crop.pts[crop.pts.length - 1], E = EM; crop.px = q && E && E.g ? [Math.round(q[0] * (E.w - 1)), Math.round(q[1] * (E.h - 1))] : null; cropPreview(); side(); };
}
function cropFinish() {
  if (!crop || crop.pts.length < 3) return toast('Tap at least 3 points first');
  let P = crop.pts; if (crop.follow && crop.px && EM && EM.g) { const f = P[0], back = tracePx(EM, crop.px, [Math.round(f[0] * (EM.w - 1)), Math.round(f[1] * (EM.h - 1))]).slice(1, -1); P = P.concat(back.map(q => [q[0] / (EM.w - 1), q[1] / (EM.h - 1)])); }
  if (P.length > 900) P = thin(P.map(q => [q[0] * 2000, q[1] * 2000]), 2.5).map(q => [q[0] / 2000, q[1] / 2000]);
  M.ov.crop = P.flatMap(q => [+q[0].toFixed(4), +q[1].toFixed(4)]); save(); cropEnd();
}
function cropEnd() { crop = null; tmp.clearLayers(); $('smMap') && $('smMap').classList.remove('drawing'); ovPaint(); ovHandles(); }

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
    g.on('click', e => { L.DomEvent.stop(e); if (draw || crop || pinMode) return onClick(e); select(f.id); });
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
  if (crop) return cropSide(S2); if (V.adj && M.ov && ovImg && ed()) return adjSide(S2);
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
  if (pinMode) { M.ov.pin = toUV(e.latlng).map(v => +v.toFixed(5)); pinMode = false; $('smMap').classList.remove('drawing'); save(); return ovHandles(); }
  if (crop) return cropClick(e.latlng);
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
  if (ovImg && M.ov && M.ov.p && V.ov) { const [a, b2, d] = pts(M.ov).map(proj), w = ovImg.naturalWidth, h = ovImg.naturalHeight; c.save(); c.globalAlpha = M.ov.op || 0.75; c.setTransform((b2.x - a.x) / w, (b2.y - a.y) / w, (d.x - a.x) / h, (d.y - a.y) / h, a.x, a.y); if (M.ov.crop && M.ov.crop.length >= 6) { c.beginPath(); pts({ p: M.ov.crop }).forEach((q, i) => i ? c.lineTo(q[0] * w, q[1] * h) : c.moveTo(q[0] * w, q[1] * h)); c.closePath(); c.clip(); } c.drawImage(ovImg, 0, 0); c.restore(); }
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
