// Admin areas: project settings, users, plans, room boundaries, import, Gemini settings.
import { S, can, saveLocal, withDefaults, unitList } from './state.js';
import { DEFAULTS, ROLES, ROLE_HELP, APP } from './config.js';
import { $, esc, toast, modal, closeModal, busy, confirmBox, opts, uid, compressImage, dataUrlToBlob, natural, todayISO, loadScript, centroid, pointInPoly, polyArea } from './util.js';
import { aiCall } from './ai.js';
import * as Nav from './nav.js';

let X = {};   // callbacks from app.js
export function init(ctx) { X = ctx; }
const lines = a => (a || []).join('\n');
const fromLines = s => String(s || '').split('\n').map(x => x.trim()).filter(Boolean);
const appUrl = () => location.origin + location.pathname;

/* ================================================================ project settings */
export function projectSettings(p) {
  const isNew = !p; p = withDefaults(p || {});
  modal(`<h2>${isNew ? 'New project' : 'Project settings'}</h2>
  <div class="grid">
    <label class="f full">Project name<input id="psName" value="${esc(p.name || '')}" placeholder="e.g. 81a Godley Road"></label>
    <label class="f full">Address<input id="psAddr" value="${esc(p.address || '')}"></label>
    <label class="f">Client<input id="psClient" value="${esc(p.client || '')}" placeholder="e.g. Haumaru Housing"></label>
    <label class="f">Client logo (for exports)<input type="file" id="psLogo" accept="image/*"></label>
    <div class="full" id="psLogoPrev">${p.clientLogo ? `<img src="${esc(p.clientLogo)}" style="max-height:40px">` : ''}</div>
    <label class="f full">Short description (helps Gemini)<input id="psDesc" value="${esc(p.description || '')}" placeholder="e.g. 42 one-bedroom units for older people in two blocks"></label>
    <label class="f">Contract<input id="psContract" value="${esc(p.contract || '')}" placeholder="e.g. NZS 3916:2013"></label>
    <label class="f">Main contractor<input id="psCon" value="${esc(p.contractor || '')}"></label>
    <label class="f">Engineer to the Contract<input id="psEng" value="${esc(p.engineer || '')}"></label>
    <label class="f">Building consent<input id="psBc" value="${esc(p.consent || '')}"></label>
    <label class="f">Units (e.g. 1-42, or G01, G02)<input id="psUnits" value="${esc(p.units || '')}"></label>
    <label class="f">Defect ID prefix<input id="psPre" value="${esc(p.idPrefix || 'D')}" maxlength="4"></label>
  </div>
  <h3 class="sec">Lists (one per line)</h3>
  <div class="grid">
    <label class="f">Responsible parties<textarea id="psResp" rows="5">${esc(lines(p.responsible.map(r => r === 'Main contractor' && p.contractor ? p.contractor : r)))}</textarea></label>
    <label class="f">Sources<textarea id="psSrc" rows="5">${esc(lines(p.sources))}</textarea></label>
    <label class="f">Severities (first is the default for imports)<textarea id="psSev" rows="5">${esc(lines(p.severities))}</textarea></label>
    <label class="f">Types<textarea id="psTyp" rows="5">${esc(lines(p.types))}</textarea></label>
    <label class="f">Trades<textarea id="psTr" rows="5">${esc(lines(p.trades))}</textarea></label>
    <label class="f">Room names<textarea id="psRooms" rows="5">${esc(lines(p.rooms))}</textarea></label>
    <label class="f full">Project knowledge for Gemini (products, parties, site terms, how to classify)<textarea id="psAi" rows="6">${esc(p.aiContext || '')}</textarea></label>
  </div>
  <h3 class="sec">PDF schedule</h3>
  <div class="grid">
    <label class="f">Title<input id="psPt" value="${esc(p.pdfTitle || 'Schedule of Defects and Omissions')}"></label>
    <label class="f">Subtitle<input id="psPs" value="${esc(p.pdfSub || 'Appendix to the Certificate of Practical Completion')}"></label>
    <label class="f full">Introduction paragraph (leave blank for the standard text)<textarea id="psPi" rows="3">${esc(p.pdfIntro || '')}</textarea></label>
  </div>
  ${!isNew && S.sup ? `<div class="opt"><input type="checkbox" id="psArch" ${p.archived ? 'checked' : ''}><label for="psArch">Archived (hidden from everyone except system administrators)</label></div>` : ''}
  <p class="note">Statuses are fixed: Open, In progress, Ready for review, Closed, Disputed.</p>
  <div class="act"><button id="psX">Cancel</button><button class="go" id="psOk">${isNew ? 'Create project' : 'Save'}</button></div>`, true);
  let logo = p.clientLogo || '';
  $('psLogo').onchange = async e => { const f = e.target.files[0]; if (!f) return; const c = await compressImage(f, 600, 0.9); logo = await pngIfTransparent(f, c.dataUrl); $('psLogoPrev').innerHTML = `<img src="${logo}" style="max-height:40px">`; };
  $('psX').onclick = closeModal;
  $('psOk').onclick = async () => {
    const name = $('psName').value.trim(); if (!name) return toast('Enter the project name');
    const data = { name, address: $('psAddr').value.trim(), client: $('psClient').value.trim(), clientLogo: logo, description: $('psDesc').value.trim(), contract: $('psContract').value.trim(), contractor: $('psCon').value.trim(), engineer: $('psEng').value.trim(), consent: $('psBc').value.trim(), units: $('psUnits').value.trim(), idPrefix: ($('psPre').value.trim() || 'D').toUpperCase().replace(/[^A-Z]/g, '') || 'D',
      responsible: fromLines($('psResp').value), sources: fromLines($('psSrc').value), severities: fromLines($('psSev').value), types: fromLines($('psTyp').value), trades: fromLines($('psTr').value), rooms: fromLines($('psRooms').value), aiContext: $('psAi').value.trim(), pdfTitle: $('psPt').value.trim(), pdfSub: $('psPs').value.trim(), pdfIntro: $('psPi').value.trim() };
    if ($('psArch')) data.archived = $('psArch').checked;
    const b = busy('Saving…');
    try {
      if (isNew) { const id = await S.store.createProject(data); b.done(); closeModal(); toast('Project created. Next: upload the plans.'); await X.openProject(id); plansDialog(); }
      else { await S.store.updateProject(S.project.id, data); b.done(); closeModal(); await X.reloadProject(); toast('Saved'); }
    } catch (e) { b.done(); toast('Could not save: ' + e.message, 6000); }
  };
}
async function pngIfTransparent(file, jpg) { if (!/png|svg|gif|webp/.test(file.type)) return jpg; const im = await new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = URL.createObjectURL(file); }); const s = Math.min(1, 600 / Math.max(im.width, im.height)); const c = document.createElement('canvas'); c.width = im.width * s; c.height = im.height * s; c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); return c.toDataURL('image/png'); }

/* ================================================================ users */
export async function usersDialog() {
  const p = await S.store.getProject(S.project.id); const inv = await S.store.listInvites(p.id).catch(() => []);
  const info = p.memberInfo || {};
  const roleSel = (v, attr) => `<select ${attr}>${Object.entries(ROLES).map(([k, l]) => `<option value="${k}" ${k === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  modal(`<h2>Users and access</h2>
  <table class="t"><tr><th>Person</th><th>Role</th><th></th></tr>
  ${Object.entries(p.members || {}).map(([u, r]) => `<tr><td><b>${esc((info[u] || {}).name || '')}</b><br><span class="muted small">${esc((info[u] || {}).email || u)}</span></td><td>${roleSel(r, `data-u="${esc(u)}" ${u === S.user.uid ? 'disabled' : ''}`)}</td><td>${u === S.user.uid ? '<span class="muted small">you</span>' : `<button class="btn" data-rm="${esc(u)}">Remove</button>`}</td></tr>`).join('')}
  ${inv.map(i => `<tr><td>${esc(i.email)}<br><span class="muted small">Invited ${esc(i.at ? i.at.slice(0, 10) : '')}, not signed in yet</span></td><td>${esc(ROLES[i.role] || i.role)}</td><td><button class="btn" data-ci="${esc(i.email)}">Cancel</button></td></tr>`).join('')}
  </table>
  <h3 class="sec">Invite someone</h3>
  <div class="grid"><label class="f">Email address<input id="uEmail" type="email" placeholder="name@company.co.nz"></label><label class="f">Role${roleSel('editor', 'id="uRole"')}</label></div>
  <p class="note" id="uHelp"></p>
  <div class="act" style="justify-content:flex-start"><button class="go" id="uInv">Send invitation</button></div>
  <p class="note">They sign in at <b>${esc(appUrl())}</b> with Google, or with an email link, <b>using this same email address</b>. They are added to the project automatically when they first sign in.</p>
  <div class="act"><button id="uX">Close</button></div>`, true);
  const help = () => $('uHelp').textContent = ROLE_HELP[$('uRole').value]; $('uRole').onchange = help; help();
  $('uX').onclick = closeModal;
  document.querySelectorAll('[data-u]').forEach(s => s.onchange = async () => { try { await S.store.setMember(p.id, s.dataset.u, s.value); toast('Role updated'); } catch (e) { toast(e.message); } });
  document.querySelectorAll('[data-rm]').forEach(b => b.onclick = async () => { if (await confirmBox('Remove this person from the project?', 'Remove')) { await S.store.setMember(p.id, b.dataset.rm, null); usersDialog(); } });
  document.querySelectorAll('[data-ci]').forEach(b => b.onclick = async () => { await S.store.cancelInvite(p.id, b.dataset.ci); usersDialog(); });
  $('uInv').onclick = async () => {
    const e = $('uEmail').value.trim().toLowerCase(), r = $('uRole').value; if (!/^\S+@\S+\.\S+$/.test(e)) return toast('Enter a valid email address');
    try { await S.store.invite(p.id, e, r, p.name); } catch (x) { return toast('Could not invite: ' + x.message, 5000); }
    const msg = `Hi,\n\nYou have been given ${ROLES[r]} access to the ${p.name} defects register.\n\nOpen ${appUrl()} and sign in with Google, or choose "Email me a sign-in link", using this email address (${e}). On a phone you can add it to your home screen.\n\nRegards,\n${S.user.name}\n${APP.company}`;
    modal(`<h2>Invitation saved</h2><p>${esc(e)} is invited as <b>${esc(ROLES[r])}</b>. Send them this message (Outlook or text):</p><textarea class="codebox" style="width:100%;min-height:180px">${esc(msg)}</textarea>
      <div class="act"><button id="cpy">Copy message</button><a class="btn go" href="mailto:${encodeURIComponent(e)}?subject=${encodeURIComponent('Access to the ' + p.name + ' defects register')}&body=${encodeURIComponent(msg)}">Open in email</a><button id="bk">Back to users</button></div>`);
    $('cpy').onclick = () => { navigator.clipboard.writeText(msg).then(() => toast('Copied')); }; $('bk').onclick = usersDialog;
  };
}

/* ================================================================ plans */
export async function plansDialog() {
  const pid = S.project.id;
  const rows = await Promise.all(S.plans.map(async (p, i) => `<div class="planrow" data-id="${esc(p.id)}"><img src="${esc(await S.store.resolveUrl(p.img))}" alt=""><div class="pi"><input data-k="name" value="${esc(p.name)}" placeholder="Name"><input data-k="code" value="${esc(p.code || '')}" placeholder="Drawing no. / rev"><input data-k="block" value="${esc(p.block || '')}" placeholder="Block / building"><input data-k="level" value="${esc(p.level || '')}" placeholder="Level"></div><div><button class="btn" data-up="${i}" ${i ? '' : 'disabled'}>↑</button> <button class="btn" data-del="${esc(p.id)}">Delete</button><br><span class="muted small">${(p.zones || []).length} room boundaries</span><br><span class="muted small">${p.kind === 'elevation' ? (((p.links && p.links.length) || p.link) ? '📐 Elevation (' + esc(p.face || 'linked') + '), linked to ' + esc((S.plans.find(q => q.id === ((p.links && p.links[0]) || p.link).planId) || {}).name || '?') : '📐 Elevation, not linked yet') : 'Floor plan'}</span> <button class="btn small" data-elev="${esc(p.id)}">${p.kind === 'elevation' ? 'Link another face / re-link' : 'This is an elevation…'}</button>${p.kind === 'elevation' ? ` <button class="btn small" data-elevx="${esc(p.id)}">make it a floor plan</button>` : ''}<br><span class="muted small">Views: ${X.planViews(p).filter(v => v.key !== 'floor').map(v => esc(v.name) + ` <button class="btn small" data-rcpx="${esc(p.id)}" data-vk="${esc(v.key)}" title="Remove this view">✕</button>`).join(' · ') || 'floor only'}</span><br><label class="btn small" style="cursor:pointer">+ Attach a view (ceiling, walls, cladding…)<input type="file" data-rcp="${esc(p.id)}" accept="application/pdf,image/*" hidden></label></div></div>`));
  modal(`<h2>Plans</h2><p class="note">Upload floor plans as PDF (any page size) or images. Each PDF page becomes a plan. Block and level are used to fill in the location when you drop a pin.</p>
  ${rows.join('') || '<p class="muted">No plans yet.</p>'}
  <div class="act" style="justify-content:flex-start"><label class="btn go" style="cursor:pointer">⬆ Upload plans<input type="file" id="plUp" accept="application/pdf,image/*" multiple hidden></label></div>
  <div class="act"><button id="plX">Close</button><button class="go" id="plSave">Save changes</button></div>`, true);
  $('plX').onclick = closeModal;
  $('plUp').onchange = async e => { const fs = [...e.target.files]; e.target.value = ''; await uploadPlans(fs); };
  document.querySelectorAll('[data-rcp]').forEach(i => i.onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; const p = S.plans.find(x => x.id === i.dataset.rcp);
    const guess = /ceiling|rcp/i.test(f.name) ? 'ceiling' : /elev/i.test(f.name) ? 'elevation' : /wall/i.test(f.name) ? 'walls' : /clad|exterior|external/i.test(f.name) ? 'cladding' : /roof/i.test(f.name) ? 'roof' : /service|elec|plumb|mech/i.test(f.name) ? 'services' : 'ceiling';
    modal(`<h2>Attach a view to ${esc(p.name)}</h2><p>The sheet must cover the same extent as the floor plan so pins line up. Pins dropped while this view is showing are recorded with its surface.</p><label class="f">What is this sheet?<select id="avT">${X.VIEW_TYPES.map(t => `<option value="${t[0]}" ${t[0] === guess ? 'selected' : ''}>${esc(t[1])}</option>`).join('')}<option value="elevation" ${guess === 'elevation' ? 'selected' : ''}>Elevation (a different drawing: add it as its own plan and link it by face)</option></select></label><p class="note" id="avNote">${guess === 'elevation' ? 'An elevation is not the same extent as the floor plan, so it is added as a separate plan and linked by tapping the two ends of the face. Pins then land on both.' : 'Only for sheets that cover exactly the same extent as this floor plan (same frame, same scale).'}</p><label class="f">Shown as<input id="avN" value="${esc((X.VIEW_TYPES.find(t => t[0] === guess) || [])[1] || '').split(' (')[0].split(' /')[0]}"></label><div class="act"><button id="avX">Cancel</button><button class="go" id="avGo">Attach</button></div>`);
    $('avX').onclick = closeModal; $('avT').onchange = () => { const t = $('avT').value; $('avNote').textContent = t === 'elevation' ? 'An elevation is not the same extent as the floor plan, so it is added as a separate plan and linked by tapping the two ends of the face. Pins then land on both.' : 'Only for sheets that cover exactly the same extent as this floor plan (same frame, same scale).'; if (t !== 'elevation') $('avN').value = (X.VIEW_TYPES.find(x => x[0] === t) || [])[1].split(' (')[0].split(' /')[0]; };
    $('avGo').onclick = async () => { if ($('avT').value === 'elevation') { closeModal(); const before = new Set(S.plans.map(q => q.id)); await uploadPlans([f]); const np = S.plans.find(q => !before.has(q.id)); if (np) { closeModal(); linkElevation(np); } return; } const key = $('avT').value, name = $('avN').value.trim() || key, surface = (X.VIEW_TYPES.find(t => t[0] === key) || [])[2] || 'Floor'; closeModal(); const b = busy('Attaching ' + name + '…'); try { const pg = (await renderPlanFile(f, [1]))[0]; if (!pg) throw new Error('Could not read the file'); const path = `projects/${pid}/plans/${p.id}-${key}.jpg`; const url = await S.store.putFile(path, dataUrlToBlob(pg.data), true); const views = (p.views || []).filter(v => v.key !== key); views.push({ key, name, surface, img: url, path }); const { rcpImg, rcpPath, ...rest } = p; if (rcpImg && key !== 'ceiling' && !views.some(v => v.key === 'ceiling')) views.push({ key: 'ceiling', name: 'Ceiling', surface: 'Ceiling', img: rcpImg, path: rcpPath }); await S.store.savePlan(pid, { ...rest, views }); await X.reloadProject(); b.done(); toast(name + ' view attached'); plansDialog(); } catch (x) { b.done(); toast('Could not attach: ' + x.message, 6000); } }; });
  document.querySelectorAll('[data-elev]').forEach(bt => bt.onclick = () => linkElevation(S.plans.find(x => x.id === bt.dataset.elev)));
  document.querySelectorAll('[data-elevx]').forEach(bt => bt.onclick = async () => { const p = S.plans.find(x => x.id === bt.dataset.elevx); const { kind, link, links, face, ...rest } = p; await S.store.savePlan(pid, rest); await X.reloadProject(); plansDialog(); });
  document.querySelectorAll('[data-rcpx]').forEach(bt => bt.onclick = async () => { const p = S.plans.find(x => x.id === bt.dataset.rcpx), key = bt.dataset.vk; if (!(await confirmBox('Remove this view?', 'Remove'))) return; const { rcpImg, rcpPath, ...rest } = p; let views = X.planViews(p).filter(v => v.key !== 'floor' && v.key !== key); const gone = X.planViews(p).find(v => v.key === key); await S.store.savePlan(pid, { ...rest, views }); if (gone && gone.path) S.store.deleteFile(gone.path); await X.reloadProject(); plansDialog(); });
  document.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { const p = S.plans.find(x => x.id === b.dataset.del); const n = S.defects.filter(d => d.plan === p.id).length; if (!(await confirmBox(`Delete the plan "${p.name}"?${n ? ` ${n} pinned defects will lose their pin (the defects are kept).` : ''}`, 'Delete'))) return; await S.store.deletePlan(pid, p.id); if (p.path) S.store.deleteFile(p.path); await X.reloadProject(); plansDialog(); });
  document.querySelectorAll('[data-up]').forEach(b => b.onclick = async () => { const i = +b.dataset.up; const a = S.plans[i - 1], c = S.plans[i]; const t = a.order || i - 1; a.order = c.order || i; c.order = t; if (a.order === c.order) { a.order = i; c.order = i - 1; } await S.store.savePlan(pid, a); await S.store.savePlan(pid, c); await X.reloadProject(); plansDialog(); });
  $('plSave').onclick = async () => { const b = busy('Saving…'); for (const r of document.querySelectorAll('.planrow')) { const p = S.plans.find(x => x.id === r.dataset.id); r.querySelectorAll('[data-k]').forEach(i => p[i.dataset.k] = i.value.trim()); await S.store.savePlan(pid, p); } b.done(); closeModal(); await X.reloadProject(); toast('Plans saved'); };
}
// Render a PDF page (or image) to a plan-sized JPEG. Used for ceiling plans and other single-sheet attachments.
export async function renderPlanFile(f, pagesWanted) {
  const out = [];
  if (/pdf/.test(f.type) || /\.pdf$/i.test(f.name)) {
    const pdfjs = await import('../lib/pdfjs/pdf.min.mjs'); pdfjs.GlobalWorkerOptions.workerSrc = new URL('../lib/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
    const doc = await pdfjs.getDocument({ data: await f.arrayBuffer() }).promise;
    for (const n of (pagesWanted || [1])) { if (n > doc.numPages) continue; const pg = await doc.getPage(n); const v1 = pg.getViewport({ scale: 1 }); const scale = Math.min(4, 3000 / Math.max(v1.width, v1.height)); const vp = pg.getViewport({ scale }); const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height); const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); await pg.render({ canvasContext: x, viewport: vp }).promise; out.push({ data: c.toDataURL('image/jpeg', 0.72), w: c.width, h: c.height }); }
  } else { const c = await compressImage(f, 3000, 0.75); out.push({ data: c.dataUrl, w: c.w, h: c.h }); }
  return out;
}
// Wizard: mark a plan as an elevation and link it to a floor plan by tapping the two ends of the building face on each.
export async function linkElevation(ep) {
  const floors = S.plans.filter(q => q.id !== ep.id && q.kind !== 'elevation'); if (!floors.length) return toast('Upload the floor plan first');
  const existing = (ep.links && ep.links.length) ? ep.links : (ep.link ? [ep.link] : []);
  modal(`<h2>Link elevation: ${esc(ep.name)}</h2><p>Pins dropped on this elevation will also appear on the floor plan, and the report will show both. Link one <b>face and storey</b> at a time: for a two-storey building, link the ground floor band of the east elevation to the ground floor plan, then the first floor band to the first floor plan, and so on for each face. You will tap the top-left and bottom-right of that storey's band on the elevation, then the two ends of the face on the floor plan, then the same two ends on the elevation.</p>${existing.length ? '<p class="note">Linked so far: ' + existing.map(l => esc(l.face || 'face') + ' → ' + esc((S.plans.find(q => q.id === l.planId) || {}).name || '?')).join('; ') + '. Adding another keeps those.</p>' : ''}
    <label class="f">Floor plan this elevation belongs to<select id="leF">${floors.map(f => `<option value="${esc(f.id)}" ${ep.link && ep.link.planId === f.id ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></label>
    <label class="f">Face and storey<input id="leN" value="" placeholder="e.g. East, ground floor"></label>
    <div class="act"><button id="leX">Cancel</button><button class="go" id="leGo">Start tapping</button></div>`);
  $('leX').onclick = closeModal;
  $('leGo').onclick = async () => {
    const fid = $('leF').value, face = $('leN').value.trim(); closeModal(); if (ZE) await close(true);
    const t1 = await X.pickPoint(ep.id, 'Elevation: tap the TOP-LEFT of the ' + (face || 'storey') + ' band (top of that storey, left end of the face)'); if (!t1) return;
    const t2 = await X.pickPoint(ep.id, 'Elevation: now tap the BOTTOM-RIGHT of the same band (floor level of that storey, right end of the face)'); if (!t2) return;
    const a = await X.pickPoint(fid, 'Floor plan: tap the LEFT end of the ' + (face || 'elevation') + ' face (as seen on the elevation)'); if (!a) return;
    const b = await X.pickPoint(fid, 'Floor plan: now tap the RIGHT end of the same face'); if (!b) return;
    const ea = await X.pickPoint(ep.id, 'Elevation: tap the LEFT end of the building face'); if (!ea) return;
    const eb = await X.pickPoint(ep.id, 'Elevation: tap the RIGHT end of the building face'); if (!eb) return;
    if (Math.abs(eb.x - ea.x) < 0.02) return toast('The two elevation points are too close together; try again');
    const link = { planId: fid, face, band: [Math.min(t1.y, t2.y), Math.max(t1.y, t2.y)], a: [a.x, a.y], b: [b.x, b.y], ea: ea.x, eb: eb.x };
    const { link: _old, ...rest } = ep; const links = existing.filter(l => !(l.face === face && l.planId === fid) && !(l.planId === fid && Math.abs((l.band ? (l.band[0] + l.band[1]) / 2 : -1) - (link.band[0] + link.band[1]) / 2) < 0.02)); links.push(link);
    await S.store.savePlan(S.project.id, { ...rest, kind: 'elevation', face: links.map(l => l.face).filter(Boolean).join(' / '), links, zones: ep.zones || [] }); await X.reloadProject(); await X.showPlan(ep.id);
    toast('Linked. Pins on this elevation now land on ' + (floors.find(f => f.id === fid) || {}).name + ' as well.', 6000);
  };
}
export async function uploadPlans(files) {
  const pid = S.project.id, b = busy('Reading plans…'); let order = S.plans.length;
  try {
    for (const f of files) {
      const base0 = f.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ');
      const code0 = (/([A-Z]{1,3}[- ]?\d{3,4}[A-Z]?)/.exec(base0) || [])[1] || '';
      const rev = (/rev[\s.-]*([A-Z0-9]+)/i.exec(base0) || [])[1] || '';
      const code = code0 + (rev ? ' Rev ' + rev : '');
      const base = base0.replace(code0, '').replace(/[\s.-]*rev[\s.-]*[A-Z0-9]+$/i, '').replace(/-{2,}/g, ' - ').replace(/(\w)-(\w)/g, '$1 $2').replace(/^[\s-]+|[\s-]+$/g, '').replace(/\s+/g, ' ') || base0;
      const guessLevel = /ground/i.test(base) ? 'Ground' : /first/i.test(base) ? 'First' : /second/i.test(base) ? 'Second' : /roof/i.test(base) ? 'Roof' : /basement/i.test(base) ? 'Basement' : '';
      const guessBlock = (/block[\s-]*([A-Z0-9]+)/i.exec(base) || [])[1] || '';
      let pages = [];
      if (/pdf/.test(f.type) || /\.pdf$/i.test(f.name)) {
        const pdfjs = await import('../lib/pdfjs/pdf.min.mjs'); pdfjs.GlobalWorkerOptions.workerSrc = new URL('../lib/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
        const doc = await pdfjs.getDocument({ data: await f.arrayBuffer() }).promise;
        let want = Array.from({ length: doc.numPages }, (_, i) => i + 1);
        if (doc.numPages > 6) { b.done(); const r = prompt(`${f.name} has ${doc.numPages} pages. Which pages are floor plans? (e.g. 16-19, 22)`, ''); if (!r) continue; want = parsePages(r, doc.numPages); b.set('Reading plans…'); document.getElementById('busy').classList.add('show'); }
        for (const n of want) {
          b.set(`Rendering ${f.name} page ${n}…`); const pg = await doc.getPage(n); const v1 = pg.getViewport({ scale: 1 }); const scale = Math.min(4, 3000 / Math.max(v1.width, v1.height));
          const vp = pg.getViewport({ scale }); const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height); const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
          await pg.render({ canvasContext: x, viewport: vp }).promise; let lines = []; try { lines = await extractPdfLines(pg, pdfjs, v1); } catch (e) { console.warn('lines', e); } pages.push({ data: c.toDataURL('image/jpeg', 0.72), w: c.width, h: c.height, suffix: want.length > 1 ? ' p' + n : '', lines });
        }
      } else { const c = await compressImage(f, 3000, 0.75); pages.push({ data: c.dataUrl, w: c.w, h: c.h, suffix: '' }); }
      for (const pg of pages) {
        const id = uid(), path = `projects/${pid}/plans/${id}.jpg`; b.set('Uploading ' + base + pg.suffix + '…');
        const img = await S.store.putFile(path, dataUrlToBlob(pg.data));
        await S.store.savePlan(pid, { id, name: (base + pg.suffix).slice(0, 60), code, block: guessBlock, level: guessLevel, w: pg.w, h: pg.h, img, path, order: order++, zones: [], lines: pg.lines || [] });
      }
    }
    b.done(); await X.reloadProject(); toast('Plans uploaded. Check the names, block and level, then Save.'); plansDialog();
  } catch (e) { b.done(); console.error(e); toast('Could not upload the plan: ' + e.message, 6000); }
}
function parsePages(s, max) { const o = []; s.split(/[,\s]+/).forEach(t => { const m = /^(\d+)(?:-(\d+))?$/.exec(t); if (!m) return; for (let i = +m[1]; i <= +(m[2] || m[1]); i++) if (i >= 1 && i <= max) o.push(i); }); return [...new Set(o)]; }

/* ================================================================ room boundaries */
let ZE = null;
export const zoneActive = () => !!ZE;
// The plan is changing under the editor: offer to save, then re-open the editor on the new plan. Returns false to cancel the change.
export async function zoneSwitch(newPlanId) {
  if (!ZE) return true;
  if (ZE.dirty) { const r = await confirmBox('Save the boundaries on ' + ZE.plan.name + ' before switching plans?', 'Save'); if (r) await save(); }
  ZE.pendingPlan = newPlanId; return true;
}
export async function zoneEditor(PV) {
  if (!S.plans.length) { toast('Upload a plan first'); return plansDialog(); }
  X.setTab('plan');
  const plan = S.plans.find(p => p.id === S.curPlan) || S.plans[0]; if (plan.id !== S.curPlan) await X.showPlan(plan.id);
  if (!ZE) { Nav.open('zones', () => { if (ZE) close(true); }); document.addEventListener('keydown', zoneKeys); }
  ZE = { PV, plan, zones: JSON.parse(JSON.stringify(plan.zones || [])), dirty: false, members: null, collapsed: ZE ? ZE.collapsed : false, rect: ZE ? ZE.rect : !!S.local.zoneRect };
  PV.selectZone(null);
  PV.setZones(ZE.zones); PV.setMode('zones');
  Object.assign(PV.o, {
    onDrawn: poly => { PV.setMode('zones'); zoneDetails({ id: uid(), kind: ZE.drawKind, poly, block: plan.block || '', level: plan.level || '' }, true); },
    onZoneSelect: () => panel(), onDraftChange: () => panel(),
    onEditStart: () => snap(),
    onZoneDragStart: z => { ZE.members = z.kind === 'unit' ? membersOf(z).map(m => ({ m, orig: m.poly.map(p => p.slice()) })) : null; },
    onVertexAdded: z => { toast('Corner added. Drag it to fit.', 1800); },
    onVertexSelect: i => { panel(); },
    onMultiChange: ids => { panel(); },
    onGroupMoved: ids => { ZE.dirty = true; if (ZE.pendingGroup && ids.length && ids.every(id => ZE.pendingGroup.includes(id))) { const g = ZE.pendingGroup; ZE.pendingGroup = null; groupDetails(g, true); } else panel(); },
    onZoneEdit: (z, kind, dx, dy) => { ZE.dirty = true; if (kind === 'z' && ZE.members) ZE.members.forEach(({ m, orig }) => m.poly = orig.map(p => [p[0] + dx, p[1] + dy])); },
  });
  panel();
}
function membersOf(unitZone) { return ZE.zones.filter(z => z !== unitZone && z.kind !== 'unit' && pointInPoly(...centroid(z.poly), unitZone.poly)); }
// Undo / redo for the boundary editor: snapshots of all shapes on this plan before each change (Ctrl+Z, Ctrl+Y).
function snap() { if (!ZE) return; ZE.undo = ZE.undo || []; ZE.undo.push(JSON.stringify(ZE.zones)); if (ZE.undo.length > 60) ZE.undo.shift(); ZE.redo = []; }
function restore(json) { const PV = ZE.PV, selId = PV.selZone && PV.selZone.id; ZE.zones = JSON.parse(json); PV.setZones(ZE.zones); PV.selectZone(ZE.zones.find(z => z.id === selId) || null); ZE.dirty = true; panel(); }
function undo() { if (!ZE || !(ZE.undo || []).length) { toast('Nothing to undo'); return; } (ZE.redo = ZE.redo || []).push(JSON.stringify(ZE.zones)); restore(ZE.undo.pop()); }
function redo() { if (!ZE || !(ZE.redo || []).length) return; (ZE.undo = ZE.undo || []).push(JSON.stringify(ZE.zones)); restore(ZE.redo.pop()); }
function zoneKeys(e) {
  if (ZE && (e.ctrlKey || e.metaKey) && !/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) { if (e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; } if (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey)) { e.preventDefault(); redo(); return; } }
  if (!ZE || $('modal').classList.contains('show') || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); const PV = ZE.PV; if (PV.multi && PV.multi.size) { snap(); ZE.zones = ZE.zones.filter(q => !PV.multi.has(q.id)); PV.setMulti([]); PV.setZones(ZE.zones); ZE.dirty = true; panel(); toast('Group deleted. Ctrl+Z to undo.'); return; } if (PV.selVertex != null) { if (PV.deleteVertex()) { ZE.dirty = true; panel(); } } else if (PV.selZone) { snap(); const z = PV.selZone; ZE.zones.splice(ZE.zones.indexOf(z), 1); PV.selectZone(null); PV.setZones(ZE.zones); ZE.dirty = true; panel(); toast('Deleted ' + (z.kind === 'unit' ? 'Unit ' + z.unit + ' outline' : z.name || 'boundary') + '. Ctrl+Z to undo.', 3000); } }
  if (e.key === 'Escape') { const PV = ZE.PV; if (PV.mode === 'draw') { PV.setMode('zones'); panel(); } else if (PV.selVertex != null) { PV.selVertex = null; PV._drawZones(); panel(); } }
}
function panel() {
  const el = $('zonePanel'), PV = ZE.PV, z = PV.selZone, drawing = PV.mode === 'draw';
  const kindName = { unit: 'Unit outline', room: 'Room', area: 'Common area', item: 'Item (fixture or fitting)' };
  if (ZE.pendingPlan && ZE.pendingPlan !== ZE.plan.id) { ZE.pendingPlan = null; return zoneEditor(PV); }
  el.classList.toggle('collapsed', !!ZE.collapsed);
  el.innerHTML = `<div class="zhead"><h3>Room boundaries: ${esc(ZE.plan.name)}</h3><button id="zMin" title="${ZE.collapsed ? 'Expand' : 'Minimise'}">${ZE.collapsed ? '▴' : '▾'}</button><button id="zDone" class="go">Done</button></div><div class="zbody">
  <label class="f">Plan<select id="zPlan">${S.plans.map(p => `<option value="${esc(p.id)}" ${p.id === ZE.plan.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
  ${drawing ? `<div class="zsel"><b>Drawing a ${kindName[ZE.drawKind].toLowerCase()}${ZE.rect ? ' (rectangle)' : ''}</b><p class="hint">${ZE.rect ? 'Tap two opposite corners. Tapping near an existing corner or line snaps to it.' : 'Tap each corner in turn. Tapping near an existing corner or line snaps to it and joins the two, so they move together later. Tap the first point (white) or press Finish to close.'}</p>
     <div class="zb">${ZE.rect ? '' : `<button id="zUndo">↶ Undo last point</button><button class="go" id="zFin" ${(PV.draft || []).length < 3 ? 'disabled' : ''}>Finish</button>`}<button id="zCan">Cancel</button></div></div>` : `
  <p class="hint">Draw each unit outline first, then the rooms inside it. Each boundary saves as soon as you name it, and drawing continues with the next one. To reshape: tap a shape, drag its corners, or tap on one of its edges to add a corner there. Use "Duplicate unit" to copy a finished unit, with all its rooms, to the next one and drag it into place.</p>
  <div class="zb"><label class="opt" style="margin-right:8px"><input type="checkbox" id="zRect" ${ZE.rect ? 'checked' : ''}> <span>Rectangles (two taps)</span></label></div>
  <div class="zb"><button id="zU">⬚ Draw unit outline</button><button id="zR">⬠ Draw room</button><button id="zA">⬡ Draw common area</button><button id="zI">▣ Draw item (kitchen unit, WC, vanity…)</button></div>
  <div class="zb"><button id="zMulti" class="${PV.marquee ? 'go' : ''}">${PV.marquee ? '✓ Selecting several (tap shapes or drag a box)' : '☐ Select several…'}</button></div>
  ${(PV.multi && PV.multi.size) ? `<div class="zsel"><b>${PV.multi.size} shapes selected</b><p class="hint">Drag any selected shape to move the group; it snaps to neighbours and walls on drop. Tap a shape to add or remove it.</p>
     <div class="zb"><button class="go" id="zgCopy">⧉ Copy group</button><button id="zgMirH">⇄ Mirror east-west</button><button id="zgMirV">⇅ Mirror north-south</button></div>
     <div class="zb"><button id="zgUnit">Set unit number…</button><button class="warn" id="zgDel">🗑 Delete group</button><button id="zgClear">Clear selection</button></div></div>` : ''}
  ${z ? `<div class="zsel"><b>${esc(z.kind === 'unit' ? 'Unit ' + (z.unit || '?') : z.name || '(no name)')}</b> <span class="muted small">${esc(kindName[z.kind] || '')}${z.kind !== 'unit' && z.unit ? ', unit ' + esc(z.unit) : ''}</span>
     <p class="hint">Drag a red dot to move that corner; tap a dot to select it${PV.selVertex != null ? ' (corner selected: press Delete or the button below)' : ''}. Tap an edge to add a corner. Corners shared with neighbouring rooms move together.</p>${PV.selVertex != null ? '<div class="zb"><button class="warn" id="zDelV">✂ Delete this corner</button></div>' : ''}
     <div class="zb"><button id="zEd">✎ Edit details</button><button id="zMv" class="${PV.moveZone ? 'go' : ''}">${PV.moveZone ? '✓ Move mode on (drag inside the shape)' : '✥ Move'}</button>
     ${z.kind === 'unit' ? '<button id="zDupU">⧉ Duplicate unit with its rooms</button>' : '<button id="zDup">⧉ Duplicate</button>'}<button class="warn" id="zDel">🗑 Delete${z.kind === 'unit' ? ' outline' : ''}</button></div></div>` : '<p class="hint">Tap a shape to select it.</p>'}`}
  <div class="zb layers"><span class="muted small">Show:</span>${['unit', 'room', 'area', 'item'].map(k => `<label class="opt"><input type="checkbox" data-layer="${k}" ${(PV.hideKinds || new Set()).has(k) ? '' : 'checked'}> <span>${{ unit: 'Units', room: 'Rooms', area: 'Common areas', item: 'Items' }[k]}</span></label>`).join('')}</div>
  <select id="zPick" style="width:100%;margin:4px 0"><option value="">Select a boundary by name…</option>${[...ZE.zones].sort((a, b) => (a.kind === 'unit' ? 'Unit ' + a.unit : (a.unit ? 'Unit ' + a.unit + ' › ' : '') + (a.name || '')).localeCompare(b.kind === 'unit' ? 'Unit ' + b.unit : (b.unit ? 'Unit ' + b.unit + ' › ' : '') + (b.name || ''), undefined, { numeric: true })).map(q => `<option value="${esc(q.id)}" ${z && z.id === q.id ? 'selected' : ''}>${esc(q.kind === 'unit' ? 'Unit ' + (q.unit || '?') + ' (outline)' : (q.unit ? 'Unit ' + q.unit + ' › ' : '') + (q.name || '(no name)'))}</option>`).join('')}</select>
  <p class="muted small">${ZE.zones.filter(q => q.kind === 'unit').length} units, ${ZE.zones.filter(q => q.kind === 'room').length} rooms, ${ZE.zones.filter(q => q.kind === 'area').length} common areas on this plan${ZE.dirty ? ' · <b>unsaved changes</b>' : ''}</p>
  <div class="zb"><button id="zUndo2" ${(ZE.undo || []).length ? '' : 'disabled'}>↶ Undo</button><button id="zRedo2" ${(ZE.redo || []).length ? '' : 'disabled'}>↷ Redo</button></div>
  <div class="zb"><button class="go" id="zSave">Save boundaries</button><button id="zClose">Close without saving</button></div></div>`;
  el.classList.add('show');
  const on = (id, fn) => { if ($(id)) $(id).onclick = fn; };
  on('zMin', () => { ZE.collapsed = !ZE.collapsed; panel(); });
  el.querySelectorAll('[data-layer]').forEach(cb => cb.onchange = () => { PV.hideKinds = PV.hideKinds || new Set(); cb.checked ? PV.hideKinds.delete(cb.dataset.layer) : PV.hideKinds.add(cb.dataset.layer); if (PV.selZone && PV.hideKinds.has(PV.selZone.kind)) PV.selectZone(null); PV._drawZones(); panel(); });
  if ($('zPick')) $('zPick').onchange = e => { const q = ZE.zones.find(x => x.id === e.target.value); if (q) { PV.setMode('zones'); PV.selectZone(q); panel(); } };
  on('zDone', async () => { if (ZE.dirty) await save(); close(); });
  if ($('zRect')) $('zRect').onchange = e => { ZE.rect = e.target.checked; S.local.zoneRect = ZE.rect; saveLocal(); };
  on('zU', () => draw('unit'));
  on('zI', () => draw('item')); on('zR', () => draw('room')); on('zA', () => draw('area'));
  on('zUndo', () => { PV.undoPoint(); panel(); }); on('zFin', () => PV.finishDraw()); on('zCan', () => { PV.setMode('zones'); panel(); });
  on('zEd', () => zoneDetails(z, false)); on('zMv', () => { PV.moveZone = !PV.moveZone; panel(); });
  on('zUndo2', undo); on('zRedo2', redo);
  on('zMulti', () => { PV.marquee = !PV.marquee; if (!PV.marquee) PV.setMulti([]); PV.setMode('zones'); PV.selectZone(null); panel(); if (PV.marquee) toast('Tap shapes to select them, or drag a box around them on empty plan. Tap again to deselect.', 4000); });
  on('zgClear', () => { PV.setMulti([]); panel(); });
  on('zgDel', async () => { if (!(await confirmBox(`Delete ${PV.multi.size} shapes?`, 'Delete'))) return; snap(); ZE.zones = ZE.zones.filter(q => !PV.multi.has(q.id)); PV.setMulti([]); PV.setZones(ZE.zones); ZE.dirty = true; panel(); });
  on('zgCopy', () => { snap(); const ids = [...PV.multi], copies = []; ZE.zones.forEach(q => { if (ids.includes(q.id)) copies.push(copyZone(q, 0.015, 0.015, null)); });   // array order kept, so layers stay in order
    copies.forEach(c => { c._srcUnit = c.unit; ZE.zones.push(c); }); ZE.pendingGroup = copies.map(c => c.id); PV.setZones(ZE.zones); PV.setMulti(ZE.pendingGroup); ZE.dirty = true; panel(); toast('Copy made. Drag it into place; when you drop it you will be asked for the unit number.', 5000); });
  const mirror = axis => { snap(); const zs = ZE.zones.filter(q => PV.multi.has(q.id)); const xs = zs.flatMap(q => q.poly.map(p => p[0])), ys = zs.flatMap(q => q.poly.map(p => p[1])); const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    zs.forEach(q => { q.poly = q.poly.map(p => axis === 'h' ? [2 * cx - p[0], p[1]] : [p[0], 2 * cy - p[1]]).reverse(); }); PV.setZones(ZE.zones); PV.setMulti([...PV.multi]); ZE.dirty = true; };
  on('zgMirH', () => mirror('h')); on('zgMirV', () => mirror('v'));
  on('zgUnit', () => groupDetails([...PV.multi]));
  on('zDelV', () => { if (!PV.deleteVertex()) toast('A shape needs at least three corners'); else { ZE.dirty = true; panel(); } });
  on('zDel', async () => { if (!(await confirmBox('Delete this boundary?', 'Delete'))) return; snap(); ZE.zones.splice(ZE.zones.indexOf(z), 1); PV.selectZone(null); PV.setZones(ZE.zones); ZE.dirty = true; panel(); });
  on('zDup', () => { snap(); const c = copyZone(z, 0.02, 0.02, null); ZE.zones.push(c); after(c); });
  on('zDupU', () => { snap(); const nu = nextUnit(z.unit); const dx = Math.min(0.05, (Math.max(...z.poly.map(p => p[0])) - Math.min(...z.poly.map(p => p[0]))) * 1.05); const mem = membersOf(z); const cu = copyZone(z, dx, 0, nu); ZE.zones.push(cu); mem.forEach(m => ZE.zones.push(copyZone(m, dx, 0, m.unit ? nu : null))); after(cu, true); toast(`Copied as Unit ${nu}. Drag it into place (Move is on).`, 4000); });
  on('zSave', save); on('zClose', close);
  $('zPlan').onchange = async e => { await X.showPlan(e.target.value); };
  function after(c, move) { PV.setZones(ZE.zones); PV.selectZone(c); PV.moveZone = !!move; ZE.dirty = true; panel(); }
}
function draw(kind) { ZE.drawKind = kind; ZE.PV.selectZone(null); ZE.PV.startDraw('', ZE.rect); panel(); }
// After a copied group is dropped (or on demand): set the unit number, block and level for every shape in the group.
function groupDetails(ids, isDrop) {
  const PV = ZE.PV, zs = ZE.zones.filter(q => ids.includes(q.id)); if (!zs.length) return;
  const cur = zs.find(q => q.unit) || {}, guess = isDrop ? nextUnit(cur._srcUnit || cur.unit) : (cur.unit || '');
  const names = [...new Set(zs.filter(q => q.kind !== 'unit').map(q => q.name).filter(Boolean))];
  modal(`<h2>${isDrop ? 'Copy placed' : 'Group details'}</h2><p>${zs.length} shapes${names.length ? ': ' + esc(names.slice(0, 8).join(', ')) + (names.length > 8 ? '…' : '') : ''}. Room and item names are kept; set what applies to the whole group.</p>
    <label class="f">Unit number<input id="gdU" value="${esc(guess)}" list="zdUl"></label>
    <div class="row2"><label class="f">Block<input id="gdB" value="${esc(cur.block || '')}" list="blocks"></label><label class="f">Level<input id="gdL" value="${esc(cur.level || '')}" list="levels"></label></div>
    <div class="act"><button id="gdX">${isDrop ? 'Leave as is' : 'Cancel'}</button><button class="go" id="gdOk">Apply to ${zs.length} shapes</button></div>`);
  $('gdX').onclick = () => { closeModal(); zs.forEach(q => delete q._srcUnit); };
  $('gdOk').onclick = () => { snap(); const u = $('gdU').value.trim(), b = $('gdB').value.trim(), l = $('gdL').value.trim(); zs.forEach(q => { if (u && (q.kind === 'unit' || q.unit || q.kind === 'room' || q.kind === 'item')) q.unit = u; if (b) q.block = b; if (l) q.level = l; delete q._srcUnit; }); closeModal(); PV.setZones(ZE.zones); PV.setMulti(ids); ZE.dirty = true; panel(); save(); };
}
function copyZone(z, dx, dy, unit) { const c = JSON.parse(JSON.stringify(z)); c.id = uid(); c.poly = c.poly.map(p => [p[0] + dx, p[1] + dy]); if (unit != null && (z.kind === 'unit' || z.unit)) c.unit = unit; return c; }
function nextUnit(u) { const m = /^(.*?)(\d+)$/.exec(String(u || '')); if (!m) return (u || '') + '-copy'; const n = String(+m[2] + 1); return m[1] + (m[2].startsWith('0') ? n.padStart(m[2].length, '0') : n); }
function zoneDetails(z, isNew) {
  if (isNew && z.kind !== 'unit' && z.poly && z.poly.length > 2) {   // a room drawn inside a unit outline belongs to that unit
    const c = centroid(z.poly), host = ZE.zones.filter(q => q.kind === 'unit' && q.poly && q.poly.length > 2 && pointInPoly(c[0], c[1], q.poly)).sort((a, b) => polyArea(a.poly) - polyArea(b.poly))[0];
    if (host) { if (!z.unit) z.unit = host.unit || ''; if (!z.block) z.block = host.block || ''; if (!z.level) z.level = host.level || ''; }
    if (z.kind === 'item') { const room = ZE.zones.filter(q => (q.kind === 'room' || q.kind === 'area') && q.poly && q.poly.length > 2 && pointInPoly(c[0], c[1], q.poly)).sort((a, b) => polyArea(a.poly) - polyArea(b.poly))[0]; if (room) { z.room = room.name; if (!z.unit) z.unit = room.unit || ''; } }
  }
  const kinds = { unit: 'Unit outline', room: 'Room', area: 'Common area', item: 'Item (fixture or fitting)' };
  modal(`<h2>${isNew ? 'New boundary' : 'Boundary details'}</h2>
  <div class="grid">
    <label class="f">Type<select id="zdK">${Object.entries(kinds).map(([k, l]) => `<option value="${k}" ${k === z.kind ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="f">Unit number${isNew && z.kind !== 'unit' && z.unit ? ' <span class="muted small">(inside Unit ' + esc(z.unit) + ')</span>' : ''}<input id="zdU" value="${esc(z.unit || '')}" list="zdUl"></label>
    <label class="f full" id="zdNl">Room / area name<input id="zdN" value="${esc(z.name || '')}" list="zdRl" placeholder="Choose an existing name or type a new one"></label>
    <label class="f">Block / building<input id="zdB" value="${esc(z.block || '')}"></label>
    <label class="f">Level<input id="zdL" value="${esc(z.level || '')}"></label>
  </div>
  <datalist id="zdRl">${[...new Set([...S.plans.flatMap(pl => (pl.zones || []).filter(q => q.kind !== 'unit' && q.name).map(q => q.name)), ...(ZE ? ZE.zones.filter(q => q.kind !== 'unit' && q.name).map(q => q.name) : []), ...S.project.rooms])].sort().map(r => `<option>${esc(r)}</option>`).join('')}</datalist><datalist id="zdUl">${unitList(S.project).map(u => `<option>${esc(u)}</option>`).join('')}</datalist>
  <p class="note">A room inside a unit outline takes its unit number automatically, so you can leave Unit blank for rooms.</p>
  <div class="act"><button id="zdX">${isNew ? 'Discard' : 'Cancel'}</button><button class="go" id="zdOk">OK</button></div>`);
  const sync = () => { $('zdNl').style.display = $('zdK').value === 'unit' ? 'none' : ''; }; $('zdK').onchange = sync; sync();
  if (isNew && z.kind === 'unit') setTimeout(() => $('zdU').focus(), 50); else if (isNew) setTimeout(() => $('zdN').focus(), 50);
  $('zdX').onclick = () => { closeModal(); panel(); };
  $('zdOk').onclick = () => { z.kind = $('zdK').value; z.unit = $('zdU').value.trim(); z.name = z.kind === 'unit' ? '' : $('zdN').value.trim(); z.block = $('zdB').value.trim(); z.level = $('zdL').value.trim();
    if (z.kind === 'unit' && !z.unit) return toast('Enter the unit number'); if (z.kind !== 'unit' && !z.name) return toast('Enter the room or area name');
    snap(); if (isNew) ZE.zones.push(z); ZE.dirty = true; closeModal(); ZE.PV.setZones(ZE.zones); ZE.PV.selectZone(z);
    if (isNew && z.kind === 'unit') { save().then(() => { modal(`<h2>Unit ${esc(z.unit || '')} outline saved</h2><p>Break it up into rooms now? Each room you draw inside it takes the unit number automatically.</p><div class="btnlist"><button id="zuRooms">⬠ Draw the rooms in this unit</button><button id="zuNext">⬚ Draw the next unit outline</button><button id="zuDup">⧉ Duplicate a finished unit onto this one</button><button id="zuStop">Stop drawing</button></div>`); $('zuRooms').onclick = () => { closeModal(); ZE.rect = true; S.local.zoneRect = true; saveLocal(); toast('Rectangles on: tap two opposite corners of each room. Untick Rectangles for an L-shape.', 4000); draw('room'); }; $('zuNext').onclick = () => { closeModal(); draw('unit'); }; $('zuDup').onclick = () => { closeModal(); ZE.PV.setMode('zones'); ZE.PV.selectZone(z); panel(); toast('Select a finished unit, tap Duplicate unit, then drag the copy over this outline.', 5000); }; $('zuStop').onclick = () => { closeModal(); ZE.PV.setMode('zones'); panel(); }; }); }
    else if (isNew) { save().then(() => { const next = { room: 'room', area: 'common area', item: 'item' }[z.kind]; toast(`Saved. Draw the next ${next}, or tap Cancel to stop.`, 3500); draw(z.kind); }); } else panel(); };
}
async function save() {
  const p = ZE.plan; p.zones = ZE.zones.map(z => ({ id: z.id, kind: z.kind, name: z.name || '', unit: z.unit || '', block: z.block || '', level: z.level || '', poly: z.poly.map(q => [+q[0].toFixed(5), +q[1].toFixed(5)]) }));
  try { await S.store.savePlan(S.project.id, p); ZE.dirty = false; toast('Boundaries saved'); panel(); } catch (e) { toast('Could not save: ' + e.message, 5000); }
}
async function close(fromBack) {
  if (!ZE) return;
  if (ZE.dirty && !fromBack && !(await confirmBox('Close without saving your boundary changes?', 'Close without saving'))) return;
  if (ZE.dirty && fromBack) { await save(); }
  document.removeEventListener('keydown', zoneKeys);
  const PV = ZE.PV; ['onDrawn', 'onZoneSelect', 'onDraftChange', 'onZoneDragStart', 'onZoneEdit', 'onVertexAdded', 'onVertexSelect', 'onMultiChange', 'onGroupMoved', 'onEditStart'].forEach(k => delete PV.o[k]); PV.marquee = false; PV.setMulti([]);
  PV.selectZone(null); PV.setMode('view'); $('zonePanel').classList.remove('show'); ZE = null; if (!fromBack) Nav.closed('zones'); await X.reloadProject();
}

/* ================================================================ import */
export function importDialog() {
  modal(`<h2>Import a register</h2>
  <div class="btnlist"><button id="imX">📊 Excel or CSV<small>e.g. a consultant's observation schedule. You match the columns.</small></button><button id="imJ">🗂 Defects backup (.json)<small>From the v1 Godley tool (Settings > Backup), with photos</small></button></div>
  <input type="file" id="imF" hidden><div class="act"><button id="imC">Close</button></div>`);
  $('imC').onclick = closeModal;
  $('imX').onclick = () => { $('imF').accept = '.xlsx,.xls,.csv'; $('imF').onchange = e => e.target.files[0] && importSheet(e.target.files[0]); $('imF').click(); };
  $('imJ').onclick = () => { $('imF').accept = '.json,application/json'; $('imF').onchange = e => e.target.files[0] && importJson(e.target.files[0]); $('imF').click(); };
}
const MAP_FIELDS = [['extRef', 'Reference / number', /^(obs|no|ref|item|#|id)/i], ['title', 'Title / element', /element|title|item desc|subject/i], ['desc', 'Description', /desc|remark|observ|comment|issue|defect/i], ['action', 'Action required', /action|resolution|required/i], ['status', 'Status', /status/i], ['severity', 'Severity / category', /categ|sever|priority|class/i], ['location', 'Location (free text)', /space|location|area|room|level|unit/i], ['unit', 'Unit', /^unit$/i], ['room', 'Room', /^room$/i], ['elevation', 'Elevation', /elev/i], ['trade', 'Trade', /trade/i], ['responsible', 'Responsible', /respons|assign|contractor$/i], ['dateRaised', 'Date raised', /date/i], ['contractor', 'Contractor response', /miles|contractor resp|response/i], ['notes', 'Other notes', /consultant|maynard|note|qa/i]];
export async function importSheet(file) {
  const b = busy('Reading the file…');
  try {
    if (!window.XLSX) await loadScript('lib/xlsx.bundle.js');
    const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true }); b.done();
    const pickSheet = name => { const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: false }); let hi = 0, best = 0; rows.slice(0, 15).forEach((r, i) => { const n = r.filter(c => String(c).trim() && isNaN(c)).length; if (n > best) { best = n; hi = i; } }); return { rows, hi }; };
    let sheet = wb.SheetNames.find(n => !/dash|summary|closed/i.test(n)) || wb.SheetNames[0], cur = pickSheet(sheet);
    const ui = () => {
      const hdr = cur.rows[cur.hi] || [], colOpts = v => '<option value="">(none)</option>' + hdr.map((h, i) => `<option value="${i}" ${String(v) === String(i) ? 'selected' : ''}>${esc(h || 'Column ' + (i + 1))}</option>`).join('');
      const guess = {}; MAP_FIELDS.forEach(([k, , re]) => { const i = hdr.findIndex((h, j) => re.test(String(h)) && !Object.values(guess).includes(j)); if (i >= 0) guess[k] = i; });
      const data = cur.rows.slice(cur.hi + 1).filter(r => r.some(c => String(c).trim()));
      modal(`<h2>Import ${esc(file.name)}</h2>
      <div class="grid"><label class="f">Sheet<select id="isS">${wb.SheetNames.map(n => `<option ${n === sheet ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label><label class="f">Header row<input id="isH" type="number" min="1" value="${cur.hi + 1}"></label></div>
      <p class="note">${data.length} rows found. Match the columns (best guesses are filled in):</p>
      <table class="t">${MAP_FIELDS.map(([k, l]) => `<tr><td>${esc(l)}</td><td><select data-m="${k}">${colOpts(guess[k])}</select></td></tr>`).join('')}</table>
      <h3 class="sec">Options</h3>
      <div class="grid"><label class="f">ID prefix for these items<input id="isP" value="${esc((file.name.match(/maynard|mm/i) ? 'MM' : 'EXT'))}" maxlength="4"></label><label class="f">Source<input id="isSrc" value="${esc(/maynard/i.test(file.name) ? 'Maynard Marks' : 'Consultant inspection')}" list="isSrcL"></label></div>
      <datalist id="isSrcL">${S.project.sources.map(s => `<option>${esc(s)}</option>`).join('')}</datalist>
      <div class="opt"><input type="checkbox" id="isSkip" checked><label for="isSkip">Skip rows whose status is Closed</label></div>
      <div class="opt"><input type="checkbox" id="isTri" checked><label for="isTri">Set severity to "To triage" (keep their category in the notes)</label></div>
      <p class="note">Photos embedded in Excel are not imported. Add them to the items afterwards, or ask for a converted file with photos.</p>
      <div class="act"><button id="isX">Cancel</button><button class="go" id="isGo">Import</button></div>`, true);
      $('isX').onclick = closeModal;
      $('isS').onchange = e => { sheet = e.target.value; cur = pickSheet(sheet); ui(); };
      $('isH').onchange = e => { cur.hi = Math.max(0, +e.target.value - 1); ui(); };
      $('isGo').onclick = async () => {
        const m = {}; document.querySelectorAll('[data-m]').forEach(s => { if (s.value !== '') m[s.dataset.m] = +s.value; });
        const g = (r, k) => m[k] != null ? String(r[m[k]] ?? '').trim() : '';
        const pre = ($('isP').value.trim() || 'EXT').toUpperCase(), src = $('isSrc').value.trim(), skip = $('isSkip').checked, tri = $('isTri').checked, t = new Date().toISOString(), out = [];
        data.forEach((r, i) => {
          const st = mapStatus(g(r, 'status')); if (skip && st === 'Closed') return;
          const ref = g(r, 'extRef') || String(i + 1); const loc = parseLoc(g(r, 'location'));
          const ext = {}; MAP_FIELDS.forEach(([k, l]) => { const v = g(r, k); if (v && !['title', 'desc', 'extRef'].includes(k)) ext[l] = v; });
          const desc = g(r, 'desc'), title = g(r, 'title') || desc.split(/[.,;]/)[0].slice(0, 60);
          out.push({ id: pre + '-' + (/^\d+$/.test(ref) ? ref.padStart(3, '0') : ref.replace(/[^\w-]/g, '')), extRef: ref, source: src, dateRaised: toISO(g(r, 'dateRaised')) || todayISO(), title, desc, action: '', element: g(r, 'title'), unit: g(r, 'unit') || loc.unit, room: g(r, 'room') || [loc.room, g(r, 'elevation') && g(r, 'elevation') + ' elevation'].filter(Boolean).join(', '), block: loc.block, level: '', type: S.project.types[0], severity: tri ? 'To triage' : (S.project.severities.find(s => s.toLowerCase() === g(r, 'severity').toLowerCase()) || S.project.severities[0]), trade: S.project.trades.find(x => x.toLowerCase() === g(r, 'trade').toLowerCase()) || guessTrade(title + ' ' + desc), responsible: g(r, 'responsible') || S.project.responsible[0], targetDate: '', status: st, plan: '', x: null, y: null, photos: [], ext, history: [{ t, who: S.user.name, txt: `Imported from ${file.name} (${sheet}, row ${cur.hi + 2 + i}).` }].concat(g(r, 'action') ? [{ t, who: src || 'Import', txt: 'Resolution note: ' + g(r, 'action') }] : []), created: t, updated: t, createdBy: S.user.email, updatedBy: S.user.email });
        });
        await saveImported(out);
      };
    };
    ui();
  } catch (e) { b.done(); toast('Could not read that file: ' + e.message, 6000); }
}
export async function importJson(file) {
  let j; try { j = JSON.parse(await file.text()); } catch (e) { return toast('That is not a backup file'); }
  if (j.type === 'aicontext' && (j.text || j.typicals)) { if (!S.project) return toast('Open the project first'); if (!can.admin()) return toast('Only a project admin can change the Gemini knowledge'); const patch = {}; if (j.text) patch.aiContext = j.text; if (Array.isArray(j.typicals)) patch.typicals = j.typicals; await S.store.updateProject(S.project.id, patch); Object.assign(S.project, patch); toast('Gemini project knowledge updated' + (j.typicals ? ' with ' + j.typicals.length + ' typical defects' : ''), 5000); return; }
  if (j.type === 'history' && Array.isArray(j.items)) {
    if (!S.project) return toast('Open the project first'); if (!can.edit()) return toast('Your role cannot import');
    const done = (S.project.historyPacks || []).includes(j.id);
    const have = j.items.filter(x => S.defects.some(d => d.id === x.id)), lines = have.reduce((a, x) => a + x.history.length, 0);
    modal(`<h2>${esc(j.title || 'Import history')}</h2>${done ? '<p class="note"><b>Already applied to this project.</b> Applying again adds nothing new (identical lines are not duplicated).</p>' : ''}<p>${have.length} of ${j.items.length} items match defects in this project; ${lines} dated history lines will be added to their comment trails, oldest first. Existing history is kept.</p><p class="note" id="hiSt"></p><div class="act"><button id="hiX">Cancel</button><button class="go" id="hiGo">Add history</button></div>`);
    $('hiX').onclick = closeModal;
    $('hiGo').onclick = async () => { $('hiGo').disabled = true; let n = 0; try { for (const x of have) { $('hiSt').textContent = `Updating ${++n} of ${have.length}…`; const d = S.defects.find(q => q.id === x.id); const old = JSON.stringify((d.history || []).map(h => [h.t, h.who, h.txt])); const add = x.history.filter(h => !old.includes(JSON.stringify([h.t, h.who, h.txt]))); if (add.length) await S.store.updateDefect(S.project.id, x.id, { historyImported: j.id }, add); } await S.store.updateProject(S.project.id, { historyPacks: [...(S.project.historyPacks || []), j.id] }); S.project.historyPacks = [...(S.project.historyPacks || []), j.id]; closeModal(); toast('History added to ' + have.length + ' defects', 5000); } catch (e) { $('hiSt').textContent = ''; toast('Stopped: ' + e.message, 7000); $('hiGo').disabled = false; } };
    return;
  }
  if (j.type === 'zones' && Array.isArray(j.plans)) {
    if (!S.project) return toast('Open the project first'); if (!can.admin()) return toast('Only a project admin can change boundaries');
    const findPlan = p => S.plans.find(x => x.id === p.key) || S.plans.find(x => p.key && ((p.key === 'AG' && /Block A/i.test(x.name) && /Ground/i.test(x.name)) || (p.key === 'AF' && /Block A/i.test(x.name) && /First/i.test(x.name)) || (p.key === 'BG' && /Block B/i.test(x.name) && /Ground/i.test(x.name)) || (p.key === 'BF' && /Block B/i.test(x.name) && /First/i.test(x.name)))) || S.plans.find(x => x.name === p.name || x.code === p.code);
    const map = j.numbering === 'new' ? null : (S.project.renumberMap || null), rows = j.plans.map(p => ({ p, t: findPlan(p) }));
    modal(`<h2>${esc(j.title || 'Room boundaries')}</h2><p>${esc(j.note || '')}</p><table class="t"><tr><th>Plan</th><th>Now</th><th>Replace with</th></tr>${rows.map(r => `<tr><td>${esc(r.t ? r.t.name : (r.p.name || r.p.key) + ' (not found)')}</td><td>${r.t ? (r.t.zones || []).length : '-'}</td><td>${r.p.zones.length}</td></tr>`).join('')}</table>${map ? '<p class="note">Unit renumbering has been applied to this project, so unit numbers in the file will be mapped to the new numbers.</p>' : ''}<p class="note"><b>This replaces every boundary on those plans</b>, including any you drew by hand on them. Other plans are untouched.</p><div class="act"><button id="zpX">Cancel</button><button class="go" id="zpGo">Replace boundaries</button></div>`);
    $('zpX').onclick = closeModal;
    $('zpGo').onclick = async () => { $('zpGo').disabled = true; let n = 0; try { for (const r of rows) { if (!r.t) continue; const zones = r.p.zones.map(z => ({ ...z, id: z.id || uid(), unit: (map && z.unit && map[z.unit]) ? map[z.unit] : (z.unit || ''), block: z.block || r.t.block || '', level: z.level || r.t.level || '' })); await S.store.savePlan(S.project.id, { ...r.t, zones }); n++; } closeModal(); await X.reloadProject(); toast(`Boundaries replaced on ${n} plan${n === 1 ? '' : 's'}`, 5000); } catch (e) { toast('Stopped: ' + e.message, 6000); $('zpGo').disabled = false; } };
    return;
  }
  if (j.type === 'planlines' && Array.isArray(j.plans)) {
    if (!S.project) return toast('Open the project first'); if (!can.admin()) return toast('Only a project admin can change plans');
    const findPlan = p => S.plans.find(x => x.id === p.key) || S.plans.find(x => p.key && ((p.key === 'AG' && /Block A/i.test(x.name) && /Ground/i.test(x.name)) || (p.key === 'AF' && /Block A/i.test(x.name) && /First/i.test(x.name)) || (p.key === 'BG' && /Block B/i.test(x.name) && /Ground/i.test(x.name)) || (p.key === 'BF' && /Block B/i.test(x.name) && /First/i.test(x.name)))) || S.plans.find(x => x.name === p.name || x.code === p.code);
    let n = 0; for (const p of j.plans) { const t = findPlan(p); if (!t) continue; await S.store.savePlan(S.project.id, { ...t, lines: p.lines }); n++; }
    await X.reloadProject(); toast(`Drawing lines added to ${n} plan${n === 1 ? '' : 's'}; boundaries now snap to the walls on those plans`, 6000); return;
  }
  if (j.type === 'renumber' && j.map) return importRenumber(j);
  if (j.project && Array.isArray(j.plans) && j.plans.length && j.plans[0].img) return importProjectPack(j);
  const list = (Array.isArray(j) ? j : (j.defects || [])).filter(d => d && d.id);
  const fmN = ['assets', 'tasks', 'systems'].reduce((a, k) => a + ((j[k] || []).length), 0);
  if (!list.length && !fmN && !j.zones) return toast('Nothing to import in that file');
  const planIds = [...new Set(list.map(d => d.plan).filter(Boolean))];
  const guess = id => { const code = (j.plans || {})[id] || id; const p = S.plans.find(p => (p.name + ' ' + (p.code || '')).toLowerCase().includes(String(code).toLowerCase().replace(/ rev.*$/, ''))); return p ? p.id : ''; };
  modal(`<h2>Import${list.length ? ' ' + list.length + ' defects' : ''}${fmN ? ' and facility data' : ''}</h2>
  ${fmN && can.edit() ? `<div class="opt"><input type="checkbox" id="ijF" checked><label for="ijF">Facility data: ${(j.assets || []).length} assets and warranties, ${(j.tasks || []).length} maintenance tasks, ${(j.systems || []).length} specified systems (items already in the project with the same ID are replaced)</label></div>` : ''}
  ${planIds.length ? `<p class="note">Match the plans in the file to this project's plans so the pins land in the right place:</p><table class="t">${planIds.map(id => `<tr><td>${esc((j.plans || {})[id] || id)}</td><td><select data-pm="${esc(id)}"><option value="">(drop the pin)</option>${S.plans.map(p => `<option value="${esc(p.id)}" ${guess(id) === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></td></tr>`).join('')}</table>` : ''}
  <div class="opt"><input type="checkbox" id="ijUp" checked><label for="ijUp">Update items that already exist if the file's copy is newer</label></div>
  ${j.zones && can.admin() ? `<div class="opt"><input type="checkbox" id="ijZ" checked><label for="ijZ">Add the room boundaries in this file (${Object.values(j.zones).reduce((a, z) => a + z.length, 0)} boundaries for ${Object.keys(j.zones).length} plans). Plans that already have boundaries are left alone.</label></div>` : ''}
  <div class="act"><button id="ijX">Cancel</button><button class="go" id="ijGo">Import</button></div>`, true);
  $('ijX').onclick = closeModal;
  $('ijGo').onclick = async () => {
    const pm = {}; document.querySelectorAll('[data-pm]').forEach(s => pm[s.dataset.pm] = s.value); const upd = $('ijUp').checked;
    if ($('ijF') && $('ijF').checked) { const bb = busy('Importing facility data…'); try { for (const k of ['assets', 'tasks', 'systems']) if ((j[k] || []).length) await S.store.bulkSave(S.project.id, k, j[k]); if (j.project && can.admin()) { const keep = {}; ['pcDate', 'dnpMonths', 'cccDate', 'bwofDue', 'csNumber', 'iqp'].forEach(k => { if (j.project[k] && !S.project[k]) keep[k] = j.project[k]; }); if (Object.keys(keep).length) { await S.store.updateProject(S.project.id, keep); Object.assign(S.project, keep); } } bb.done(); toast('Facility data imported'); } catch (e) { bb.done(); toast('Facility import failed: ' + e.message, 6000); } }
    if ($('ijZ') && $('ijZ').checked) { let n = 0; for (const [code, zs] of Object.entries(j.zones)) { const p = S.plans.find(p => (p.name + ' ' + (p.code || '')).toLowerCase().includes(code.toLowerCase())); if (p && !(p.zones || []).length) { p.zones = zs.map(z => ({ ...z, id: uid() })); await S.store.savePlan(S.project.id, p); n++; } } if (n) toast(`Room boundaries added to ${n} plan${n > 1 ? 's' : ''}`); }
    const out = [];
    for (const d0 of list) {
      const ex = S.defects.find(x => x.id === d0.id); if (ex && (!upd || (d0.updated || '') <= (ex.updated || ''))) continue;
      const d = { ...d0 }; delete d.mm; delete d.transcript;
      if (d0.mm) { d.extRef = 'MM ' + d0.mm.ref; d.ext = { 'Report': d0.mm.report, 'Category': d0.mm.category, 'Location as recorded': d0.mm.space, 'Consultant status': d0.mm.mmStatus, 'Contractor response': d0.mm.contractor, 'Consultant comment': d0.mm.mmComment, 'QA': d0.mm.qa }; }
      d.plan = d0.plan ? (pm[d0.plan] || '') : ''; if (!d.plan) { d.x = null; d.y = null; }
      if (d.responsible === 'Miles Construction' && !S.project.responsible.includes('Miles Construction') && S.project.contractor) d.responsible = S.project.contractor;
      out.push(d);
    }
    await saveImported(out);
  };
}
async function saveImported(out) {
  if (!out.length) { closeModal(); return; }
  closeModal(); const b = busy(`Importing ${out.length} items…`); const pid = S.project.id;
  try {
    let n = 0;
    for (const d of out) { if (d.photos && d.photos.some(p => p.data)) { b.set(`Uploading photos for ${d.id} (${++n} of ${out.length})…`); const ph = []; for (const p of d.photos) { if (!p.data) { ph.push(p); continue; } const id = p.id || uid(), path = `projects/${pid}/photos/${d.id}/${id}.jpg`; ph.push({ id, path, url: await S.store.putFile(path, dataUrlToBlob(p.data)), t: p.t || new Date().toISOString(), by: p.src || 'Import' }); } d.photos = ph; } }
    b.set('Saving…'); await S.store.bulkCreate(pid, out, k => b.set(`Saving ${k} of ${out.length}…`));
    if (can.admin()) { const pre = S.project.idPrefix + '-'; const mx = Math.max(0, ...out.filter(d => d.id.startsWith(pre)).map(d => +d.id.slice(pre.length) || 0)); const cur = (await S.store.getProject(pid)).seq || 0; if (mx > cur) await S.store.updateProject(pid, { seq: mx }); }
    b.done(); toast(`Imported ${out.length} items`, 4000);
  } catch (e) { b.done(); console.error(e); toast('Import stopped: ' + e.message, 6000); }
}
function mapStatus(s) { s = String(s || '').toLowerCase(); if (/closed|complete|resolved|done/.test(s)) return 'Closed'; if (/ready|review/.test(s)) return 'Ready for review'; if (/progress|rectif|underway/.test(s)) return 'In progress'; if (/disput/.test(s)) return 'Disputed'; return 'Open'; }
function parseLoc(s) { const o = { block: '', unit: '', room: '' }; if (!s) return o; const b = /block\s*([A-Z0-9]+)/i.exec(s); if (b) o.block = b[1].toUpperCase(); const u = /unit\s*([A-Z]?\d+[A-Z]?)/i.exec(s); if (u) o.unit = u[1]; const rest = s.replace(/block\s*[A-Z0-9]+/ig, '').replace(/unit\s*[A-Z]?\d+[A-Z]?/ig, '').replace(/^[\s,-]+|[\s,-]+$/g, '').replace(/\s*-\s*/g, ' '); if (rest && !/^block/i.test(rest)) o.room = rest.trim(); return o; }
function toISO(v) { if (!v) return ''; const d = new Date(v); if (!isNaN(d) && /\d{4}/.test(v)) return d.toISOString().slice(0, 10); const m = /(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/.exec(v); if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; return ''; }
const TRADE_RX = [[/liqui|membrane|wrap|flashing|cavity|cladding|soffit/i, 'Cladding & envelope'], [/brick/i, 'Brick veneer'], [/joinery|window|glaz|sill/i, 'Windows & glazing'], [/roof|gutter|spouting|downpipe|butyl/i, 'Roofing & rainwater'], [/fire|passive|penetration|intumescent|sprinkler/i, 'Fire protection'], [/balustrade|handrail|stair/i, 'Balustrades & stairs'], [/electric|light|switch|power/i, 'Electrical'], [/plumb|drain|pipe|waste|shower|tap/i, 'Plumbing & drainage'], [/paint|stopping/i, 'Painting & finishes'], [/door|hardware|lock/i, 'Doors & hardware'], [/floor|vinyl|carpet|tile/i, 'Floor coverings'], [/gib|plasterboard|lining|ceiling/i, 'Linings & ceilings'], [/deck|concrete|slab|steel|timber|framing|structural|bracing/i, 'Structure'], [/landscap|paving|fence|retaining/i, 'External works'], [/vent|fan|heat pump|mechanical/i, 'Mechanical & ventilation']];
function guessTrade(s) { for (const [re, t] of TRADE_RX) if (re.test(s) && S.project.trades.includes(t)) return t; return S.project.trades[0]; }

/* ================================================================ Gemini settings */
export function aiSettings(msg) {
  const a = can.admin(), h = S.ai || {};
  modal(`<h2>Gemini interpreter</h2>${msg ? `<p class="note" style="color:#b00000">${esc(msg)}</p>` : ''}
  <h3 class="sec">For everyone on this project${a ? '' : ' (set by the project admin)'}</h3>
  <p class="note">Recommended: a Google Apps Script helper holds the Gemini key, so it is never on anyone's device (see helper/Code.gs in the GitHub repo). Only project members can read these two values.</p>
  <div class="grid"><label class="f">Helper web address<input id="aiU" value="${esc(h.helperUrl || '')}" ${a ? '' : 'disabled'} placeholder="https://script.google.com/macros/s/…/exec"></label><label class="f">Helper key<input id="aiK" type="password" value="${esc(h.helperKey || '')}" ${a ? '' : 'disabled'}></label></div>
  <h3 class="sec">Just for me, on this device</h3>
  <div class="grid"><label class="f">Personal Gemini API key (used only if no helper is set)<input id="aiP" type="password" value="${esc(S.local.geminiKey || '')}" placeholder="AIza…"></label><label class="f">Model<input id="aiM" value="${esc(S.local.geminiModel || 'gemini-3.6-flash')}"></label></div>
  <div class="opt"><input type="checkbox" id="aiA" ${S.local.autoAI === false ? '' : 'checked'}><label for="aiA">Interpret automatically when I stop dictating</label></div>
  <div class="act"><button id="aiT">Test</button><button id="aiX">Close</button><button class="go" id="aiOk">Save</button></div>`);
  const grab = async () => { S.local.geminiKey = $('aiP').value.trim(); S.local.geminiModel = $('aiM').value.trim() || 'gemini-3.6-flash'; S.local.autoAI = $('aiA').checked; saveLocal(); if (a) { const v = { helperUrl: $('aiU').value.trim(), helperKey: $('aiK').value.trim() }; await S.store.setPrivate(S.project.id, v); S.ai = v; } };
  $('aiX').onclick = closeModal;
  $('aiOk').onclick = async () => { try { await grab(); closeModal(); toast('Saved'); } catch (e) { toast(e.message); } };
  $('aiT').onclick = async () => { try { await grab(); toast('Testing…'); const t = await aiCall('Reply with JSON {"ok":true}'); toast(/ok/.test(t) ? 'Gemini is working' : 'Unexpected reply: ' + String(t).slice(0, 80), 4000); } catch (e) { toast(e.message === 'nokey' ? 'Add a helper or a personal key first' : e.message, 5000); } };
}

/* ================================================================ one-drop project pack */
// A project pack holds everything: settings and logo, plans with images and room boundaries, defects with photos, FM data.
// One-off unit renumbering pack: { type:'renumber', id, title, map:{old:new}, project:{address…}, plans:[{key|code|name, img}] }
export async function importRenumber(j) {
  if (!S.project) return toast('Open the project first, then drop the renumbering file');
  if (!can.admin()) return toast('Only a project admin can renumber units');
  const done = (S.project.renumbered || []).includes(j.id);
  const map = j.map, keys = Object.keys(map), changed = keys.filter(k => map[k] !== k);
  const findPlan = p => S.plans.find(x => x.id === p.key || (p.key && (x.code || '').startsWith(p.key)) || x.code === p.code || x.name === p.name) || S.plans.find(x => p.key && ((p.key === 'AG' && /Block A/i.test(x.name) && /Ground/i.test(x.name)) || (p.key === 'AF' && /Block A/i.test(x.name) && /First/i.test(x.name)) || (p.key === 'BG' && /Block B/i.test(x.name) && /Ground/i.test(x.name)) || (p.key === 'BF' && /Block B/i.test(x.name) && /First/i.test(x.name))));
  const plans = (j.plans || []).map(p => ({ p, target: findPlan(p) }));
  const cnt = (list, f) => list.filter(f).length;
  const nDef = cnt(S.defects, d => d.unit && map[d.unit] && map[d.unit] !== d.unit);
  const nZone = S.plans.reduce((a, pl) => a + cnt(pl.zones || [], z => z.unit && map[z.unit] && map[z.unit] !== z.unit), 0);
  modal(`<h2>${esc(j.title || 'Renumber units')}</h2>
  ${done ? '<p class="note"><b>This renumbering has already been applied to this project.</b> Applying it again would swap the numbers back, so it is blocked.</p>' : ''}
  <p>${changed.length} unit numbers change (${keys.length - changed.length} stay the same). ${j.note ? esc(j.note) : ''}</p>
  <details><summary>Show the mapping</summary><table class="t"><tr><th>Was</th><th>Becomes</th></tr>${changed.sort((a, b) => +a - +b).map(k => `<tr><td>Unit ${esc(k)}</td><td>Unit ${esc(map[k])}</td></tr>`).join('')}</table></details>
  <p>This will update: ${nZone} room boundaries, ${nDef} defects${plans.length ? `, ${plans.filter(x => x.target).length} of ${plans.length} plan images` : ''}, plus assets, tasks and documents that name a unit${j.project && j.project.address ? `, and the project address (${esc(j.project.address)})` : ''}. Each changed defect gets a history line and keeps its old number for reference.</p>
  ${plans.filter(x => !x.target).length ? `<p class="note">Could not match plan(s): ${plans.filter(x => !x.target).map(x => esc(x.p.name || x.p.key)).join(', ')}. Their images will be skipped.</p>` : ''}
  <p class="note" id="rnSt"></p><div class="act"><button id="rnX">Cancel</button>${done ? '' : '<button class="go" id="rnGo">Apply renumbering</button>'}</div>`);
  $('rnX').onclick = closeModal;
  if ($('rnGo')) $('rnGo').onclick = async () => {
    $('rnGo').disabled = true; const st = t => $('rnSt').textContent = t; const pid = S.project.id, when = new Date().toISOString();
    const hist = (o, n) => ({ t: when, who: S.user.name || S.user.email, txt: `Unit renumbered ${o} → ${n} (${j.title || 'renumbering'})` });
    try {
      // 1. plans: zones and images
      for (const pl of S.plans) {
        const z = (pl.zones || []).map(x => (x.unit && map[x.unit]) ? { ...x, unit: map[x.unit], unitOld: x.unit } : x);
        const patch = { ...pl, zones: z }; const src = plans.find(x => x.target === pl);
        if (src && src.p.img) { st(`Uploading new image for ${pl.name}…`); const path = `projects/${pid}/plans/${uid()}.jpg`; patch.img = await S.store.putFile(path, dataUrlToBlob(src.p.img)); patch.path = path; patch.imgOld = pl.img; }
        st(`Saving ${pl.name}…`); await S.store.savePlan(pid, patch);
      }
      // 2. defects
      let n = 0; const todo = S.defects.filter(d => d.unit && map[d.unit] && map[d.unit] !== d.unit);
      for (const d of todo) { st(`Updating defects ${++n} of ${todo.length}…`); await S.store.updateDefect(pid, d.id, { unit: map[d.unit], unitOld: d.unit, updated: when }, [hist(d.unit, map[d.unit])]); }
      // 3. FM collections
      for (const coll of ['assets', 'tasks', 'docs', 'systems']) {
        let off = null; const items = await new Promise(res => { off = S.store.watchColl(pid, coll, L => res(L), () => res([])); }); if (off) off();
        const t2 = items.filter(x => x.unit && map[x.unit] && map[x.unit] !== x.unit); let m = 0;
        for (const x of t2) { st(`Updating ${coll} ${++m} of ${t2.length}…`); await S.store.patchItem(pid, coll, x.id, { unit: map[x.unit], unitOld: x.unit }); }
      }
      // 4. project
      const pp = { renumbered: [...(S.project.renumbered || []), j.id], renumberMap: map, ...(j.project || {}) };
      await S.store.updateProject(pid, pp);
      st('Done'); closeModal(); toast('Units renumbered', 5000); await X.reloadProject();
    } catch (e) { console.error(e); st(''); toast('Stopped: ' + e.message + '. Drop the file again to continue; it will not double-apply what is already done.', 9000); $('rnGo').disabled = false; }
  };
}
// Pull the straight lines out of a vector PDF page (walls, grids) so boundaries can snap to them. Returns a flat
// normalised array [x0,y0,x1,y1,…] of the longest segments. Scanned PDFs have no vectors and return [].
export async function extractPdfLines(pg, pdfjs, v1) {
  const ops = await pg.getOperatorList(), OPS = pdfjs.OPS, W = v1.width, H = v1.height, vb = pg.view;
  const segs = []; let m = [1, 0, 0, 1, 0, 0]; const stack = [];
  const mul = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
  const tp = (x, y) => { const px = m[0] * x + m[2] * y + m[4], py = m[1] * x + m[3] * y + m[5]; return [(px - vb[0]) / W, 1 - (py - vb[1]) / H]; };
  const add = (a, b) => { const d = Math.hypot((a[0] - b[0]) * W, (a[1] - b[1]) * H); if (d > 6) segs.push({ d, s: [a[0], a[1], b[0], b[1]] }); };
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i], ar = ops.argsArray[i];
    if (fn === OPS.save) stack.push(m); else if (fn === OPS.restore) m = stack.pop() || m; else if (fn === OPS.transform) m = mul(m, ar);
    else if (fn === OPS.constructPath) {
      const [subOps, coords] = ar; let k = 0, cur = null, start = null;
      for (const o of subOps) {
        if (o === OPS.moveTo) { cur = start = tp(coords[k], coords[k + 1]); k += 2; }
        else if (o === OPS.lineTo) { const q = tp(coords[k], coords[k + 1]); k += 2; if (cur) add(cur, q); cur = q; }
        else if (o === OPS.rectangle) { const x = coords[k], y = coords[k + 1], w = coords[k + 2], h = coords[k + 3]; k += 4; const a = tp(x, y), b = tp(x + w, y), c = tp(x + w, y + h), d = tp(x, y + h); add(a, b); add(b, c); add(c, d); add(d, a); cur = start = a; }
        else if (o === OPS.curveTo) k += 6; else if (o === OPS.curveTo2 || o === OPS.curveTo3) k += 4; else if (o === OPS.closePath) { if (cur && start) add(cur, start); cur = start; }
      }
    }
  }
  segs.sort((a, b) => b.d - a.d);
  return segs.slice(0, 4000).flatMap(x => x.s.map(v => +v.toFixed(4)));
}
export async function importProjectPack(j) {
  if (!S.sup && !S.project) return toast('Only a system administrator can create a project from a pack');
  const pr = j.project; let existing = S.project && S.project.name === pr.name ? S.project : null;
  if (!existing) { try { existing = (await S.store.listProjects()).find(p => p.name === pr.name) || null; } catch (e) {} }
  modal(`<h2>Set up ${esc(pr.name)}</h2><p>This pack contains: project settings${pr.clientLogo ? ' and client logo' : ''}, ${j.plans.length} plans with ${j.plans.reduce((a, p) => a + (p.zones || []).length, 0)} room boundaries, ${(j.defects || []).length} defects${(j.defects || []).some(d => (d.photos || []).length) ? ' with photos' : ''}, ${(j.assets || []).length} assets, ${(j.tasks || []).length} maintenance tasks and ${(j.systems || []).length} specified systems.</p>
  <p class="note">${existing ? 'A project with this name already exists, so the pack will be loaded into it (plans and items already there with the same IDs are replaced).' : 'A new project will be created and you will be its admin.'} Allow a few minutes: the plans and photos are uploaded to storage.</p>
  <p class="note" id="ppSt"></p><div class="act"><button id="ppX">Cancel</button><button class="go" id="ppGo">Set up project</button></div>`);
  $('ppX').onclick = closeModal;
  $('ppGo').onclick = async () => {
    $('ppGo').disabled = true; const st = t => $('ppSt').textContent = t;
    try {
      let pid;
      if (existing) { pid = existing.id; const { contacts, ...rest } = pr; await S.store.updateProject(pid, rest); }
      else { st('Creating the project…'); pid = await S.store.createProject(pr); }
      const planMap = {};
      for (const [i, p] of j.plans.entries()) {
        st(`Uploading plan ${i + 1} of ${j.plans.length}: ${p.name}…`);
        const id = uid(), path = `projects/${pid}/plans/${id}.jpg`; const img = await S.store.putFile(path, dataUrlToBlob(p.img));
        await S.store.savePlan(pid, { id, name: p.name, code: p.code || '', block: p.block || '', level: p.level || '', w: p.w, h: p.h, img, path, order: i, zones: (p.zones || []).map(z => ({ ...z, id: uid() })) });
        planMap[p.key || p.code || p.name] = id;
      }
      for (const k of ['assets', 'tasks', 'systems']) if ((j[k] || []).length) { st(`Saving ${k}…`); await S.store.bulkSave(pid, k, j[k]); }
      const defs = (j.defects || []).map(d0 => { const d = { ...d0 }; delete d.mm; delete d.transcript; if (d0.mm) { d.extRef = 'MM ' + d0.mm.ref; d.ext = { 'Report': d0.mm.report, 'Category': d0.mm.category, 'Location as recorded': d0.mm.space, 'Consultant status': d0.mm.mmStatus, 'Contractor response': d0.mm.contractor, 'Consultant comment': d0.mm.mmComment, 'QA': d0.mm.qa }; } d.plan = d0.plan ? (planMap[d0.plan] || '') : ''; if (!d.plan) { d.x = null; d.y = null; } return d; });
      let n = 0;
      for (const d of defs) { if ((d.photos || []).some(p => p.data)) { st(`Uploading photos for ${d.id} (${++n} of ${defs.length})…`); const ph = []; for (const p of d.photos) { if (!p.data) { ph.push(p); continue; } const id = p.id || uid(), path = `projects/${pid}/photos/${d.id}/${id}.jpg`; ph.push({ id, path, url: await S.store.putFile(path, dataUrlToBlob(p.data)), t: p.t || new Date().toISOString(), by: p.src || 'Import' }); } d.photos = ph; } }
      if (defs.length) { st('Saving defects…'); await S.store.bulkCreate(pid, defs, k => st(`Saving defects ${k} of ${defs.length}…`)); }
      st('Done'); closeModal(); toast(`${pr.name} is set up`, 5000);
      await X.openProject(pid);
    } catch (e) { console.error(e); st(''); toast('Set-up stopped: ' + e.message + '. Drop the file again to continue; items already saved are replaced, not duplicated.', 9000); $('ppGo').disabled = false; }
  };
}
