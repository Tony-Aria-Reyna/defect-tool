// Admin areas: project settings, users, plans, room boundaries, import, Gemini settings.
import { S, can, saveLocal, withDefaults, unitList } from './state.js';
import { DEFAULTS, ROLES, ROLE_HELP, APP } from './config.js';
import { $, esc, toast, modal, closeModal, busy, confirmBox, opts, uid, compressImage, dataUrlToBlob, natural, todayISO, loadScript, centroid, pointInPoly, polyArea } from './util.js';
import { aiCall } from './ai.js';

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
    <label class="f full">Notes for Gemini (products, systems, site terms)<textarea id="psAi" rows="3">${esc(p.aiContext || '')}</textarea></label>
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
  const rows = await Promise.all(S.plans.map(async (p, i) => `<div class="planrow" data-id="${esc(p.id)}"><img src="${esc(await S.store.resolveUrl(p.img))}" alt=""><div class="pi"><input data-k="name" value="${esc(p.name)}" placeholder="Name"><input data-k="code" value="${esc(p.code || '')}" placeholder="Drawing no. / rev"><input data-k="block" value="${esc(p.block || '')}" placeholder="Block / building"><input data-k="level" value="${esc(p.level || '')}" placeholder="Level"></div><div><button class="btn" data-up="${i}" ${i ? '' : 'disabled'}>↑</button> <button class="btn" data-del="${esc(p.id)}">Delete</button><br><span class="muted small">${(p.zones || []).length} room boundaries</span></div></div>`));
  modal(`<h2>Plans</h2><p class="note">Upload floor plans as PDF (any page size) or images. Each PDF page becomes a plan. Block and level are used to fill in the location when you drop a pin.</p>
  ${rows.join('') || '<p class="muted">No plans yet.</p>'}
  <div class="act" style="justify-content:flex-start"><label class="btn go" style="cursor:pointer">⬆ Upload plans<input type="file" id="plUp" accept="application/pdf,image/*" multiple hidden></label></div>
  <div class="act"><button id="plX">Close</button><button class="go" id="plSave">Save changes</button></div>`, true);
  $('plX').onclick = closeModal;
  $('plUp').onchange = async e => { const fs = [...e.target.files]; e.target.value = ''; await uploadPlans(fs); };
  document.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { const p = S.plans.find(x => x.id === b.dataset.del); const n = S.defects.filter(d => d.plan === p.id).length; if (!(await confirmBox(`Delete the plan "${p.name}"?${n ? ` ${n} pinned defects will lose their pin (the defects are kept).` : ''}`, 'Delete'))) return; await S.store.deletePlan(pid, p.id); if (p.path) S.store.deleteFile(p.path); await X.reloadProject(); plansDialog(); });
  document.querySelectorAll('[data-up]').forEach(b => b.onclick = async () => { const i = +b.dataset.up; const a = S.plans[i - 1], c = S.plans[i]; const t = a.order || i - 1; a.order = c.order || i; c.order = t; if (a.order === c.order) { a.order = i; c.order = i - 1; } await S.store.savePlan(pid, a); await S.store.savePlan(pid, c); await X.reloadProject(); plansDialog(); });
  $('plSave').onclick = async () => { const b = busy('Saving…'); for (const r of document.querySelectorAll('.planrow')) { const p = S.plans.find(x => x.id === r.dataset.id); r.querySelectorAll('[data-k]').forEach(i => p[i.dataset.k] = i.value.trim()); await S.store.savePlan(pid, p); } b.done(); closeModal(); await X.reloadProject(); toast('Plans saved'); };
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
          await pg.render({ canvasContext: x, viewport: vp }).promise; pages.push({ data: c.toDataURL('image/jpeg', 0.72), w: c.width, h: c.height, suffix: want.length > 1 ? ' p' + n : '' });
        }
      } else { const c = await compressImage(f, 3000, 0.75); pages.push({ data: c.dataUrl, w: c.w, h: c.h, suffix: '' }); }
      for (const pg of pages) {
        const id = uid(), path = `projects/${pid}/plans/${id}.jpg`; b.set('Uploading ' + base + pg.suffix + '…');
        const img = await S.store.putFile(path, dataUrlToBlob(pg.data));
        await S.store.savePlan(pid, { id, name: (base + pg.suffix).slice(0, 60), code, block: guessBlock, level: guessLevel, w: pg.w, h: pg.h, img, path, order: order++, zones: [] });
      }
    }
    b.done(); await X.reloadProject(); toast('Plans uploaded. Check the names, block and level, then Save.'); plansDialog();
  } catch (e) { b.done(); console.error(e); toast('Could not upload the plan: ' + e.message, 6000); }
}
function parsePages(s, max) { const o = []; s.split(/[,\s]+/).forEach(t => { const m = /^(\d+)(?:-(\d+))?$/.exec(t); if (!m) return; for (let i = +m[1]; i <= +(m[2] || m[1]); i++) if (i >= 1 && i <= max) o.push(i); }); return [...new Set(o)]; }

/* ================================================================ room boundaries */
let ZE = null;
export async function zoneEditor(PV) {
  if (!S.plans.length) { toast('Upload a plan first'); return plansDialog(); }
  X.setTab('plan');
  const plan = S.plans.find(p => p.id === S.curPlan) || S.plans[0]; if (plan.id !== S.curPlan) await X.showPlan(plan.id);
  ZE = { PV, plan, zones: JSON.parse(JSON.stringify(plan.zones || [])), dirty: false, members: null };
  PV.setZones(ZE.zones); PV.setMode('zones');
  Object.assign(PV.o, {
    onDrawn: poly => { PV.setMode('zones'); zoneDetails({ id: uid(), kind: ZE.drawKind, poly, block: plan.block || '', level: plan.level || '' }, true); },
    onZoneSelect: () => panel(), onDraftChange: () => panel(),
    onZoneDragStart: z => { ZE.members = z.kind === 'unit' ? membersOf(z).map(m => ({ m, orig: m.poly.map(p => p.slice()) })) : null; },
    onZoneEdit: (z, kind, dx, dy) => { ZE.dirty = true; if (kind === 'z' && ZE.members) ZE.members.forEach(({ m, orig }) => m.poly = orig.map(p => [p[0] + dx, p[1] + dy])); },
  });
  panel();
}
function membersOf(unitZone) { return ZE.zones.filter(z => z !== unitZone && z.kind !== 'unit' && pointInPoly(...centroid(z.poly), unitZone.poly)); }
function panel() {
  const el = $('zonePanel'), PV = ZE.PV, z = PV.selZone, drawing = PV.mode === 'draw';
  const kindName = { unit: 'Unit outline', room: 'Room', area: 'Common area' };
  el.innerHTML = `<h3>Room boundaries</h3>
  <label class="f">Plan<select id="zPlan">${S.plans.map(p => `<option value="${esc(p.id)}" ${p.id === ZE.plan.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
  ${drawing ? `<div class="zsel"><b>Drawing a ${kindName[ZE.drawKind].toLowerCase()}</b><p class="hint">Tap each corner in turn. Tap the first point (white) or press Finish to close it. Zoom in for accuracy.</p>
     <div class="zb"><button id="zUndo">↶ Undo last point</button><button class="go" id="zFin" ${(PV.draft || []).length < 3 ? 'disabled' : ''}>Finish</button><button id="zCan">Cancel</button></div></div>` : `
  <p class="hint">Draw each unit outline first, then the rooms inside it. Then use "Duplicate unit" to copy a finished unit, with all its rooms, to the next one and drag it into place.</p>
  <div class="zb"><button id="zU">⬚ Draw unit outline</button><button id="zR">⬠ Draw room</button><button id="zA">⬡ Draw common area</button></div>
  ${z ? `<div class="zsel"><b>${esc(z.kind === 'unit' ? 'Unit ' + (z.unit || '?') : z.name || '(no name)')}</b> <span class="muted small">${esc(kindName[z.kind] || '')}${z.kind !== 'unit' && z.unit ? ', unit ' + esc(z.unit) : ''}</span>
     <p class="hint">Drag the red dots to adjust corners.</p>
     <div class="zb"><button id="zEd">✎ Edit details</button><button id="zMv" class="${PV.moveZone ? 'go' : ''}">${PV.moveZone ? '✓ Move mode on (drag inside the shape)' : '✥ Move'}</button>
     ${z.kind === 'unit' ? '<button id="zDupU">⧉ Duplicate unit with its rooms</button>' : '<button id="zDup">⧉ Duplicate</button>'}<button class="warn" id="zDel">🗑 Delete${z.kind === 'unit' ? ' outline' : ''}</button></div></div>` : '<p class="hint">Tap a shape to select it.</p>'}`}
  <p class="muted small">${ZE.zones.filter(q => q.kind === 'unit').length} units, ${ZE.zones.filter(q => q.kind === 'room').length} rooms, ${ZE.zones.filter(q => q.kind === 'area').length} common areas on this plan${ZE.dirty ? ' · <b>unsaved changes</b>' : ''}</p>
  <div class="zb"><button class="go" id="zSave">Save boundaries</button><button id="zClose">Close</button></div>`;
  el.classList.add('show');
  const on = (id, fn) => { if ($(id)) $(id).onclick = fn; };
  on('zU', () => draw('unit')); on('zR', () => draw('room')); on('zA', () => draw('area'));
  on('zUndo', () => { PV.undoPoint(); panel(); }); on('zFin', () => PV.finishDraw()); on('zCan', () => { PV.setMode('zones'); panel(); });
  on('zEd', () => zoneDetails(z, false)); on('zMv', () => { PV.moveZone = !PV.moveZone; panel(); });
  on('zDel', async () => { if (!(await confirmBox('Delete this boundary?', 'Delete'))) return; ZE.zones.splice(ZE.zones.indexOf(z), 1); PV.selectZone(null); PV.setZones(ZE.zones); ZE.dirty = true; panel(); });
  on('zDup', () => { const c = copyZone(z, 0.02, 0.02, null); ZE.zones.push(c); after(c); });
  on('zDupU', () => { const nu = nextUnit(z.unit); const dx = Math.min(0.05, (Math.max(...z.poly.map(p => p[0])) - Math.min(...z.poly.map(p => p[0]))) * 1.05); const mem = membersOf(z); const cu = copyZone(z, dx, 0, nu); ZE.zones.push(cu); mem.forEach(m => ZE.zones.push(copyZone(m, dx, 0, m.unit ? nu : null))); after(cu, true); toast(`Copied as Unit ${nu}. Drag it into place (Move is on).`, 4000); });
  on('zSave', save); on('zClose', close);
  $('zPlan').onchange = async e => { if (ZE.dirty && (await confirmBox('Save the boundaries on this plan first?', 'Save'))) await save(); else if (ZE.dirty) ZE.dirty = false; await X.showPlan(e.target.value); zoneEditor(ZE.PV); };
  function after(c, move) { PV.setZones(ZE.zones); PV.selectZone(c); PV.moveZone = !!move || true; ZE.dirty = true; panel(); }
}
function draw(kind) { ZE.drawKind = kind; ZE.PV.selectZone(null); ZE.PV.startDraw(); panel(); }
function copyZone(z, dx, dy, unit) { const c = JSON.parse(JSON.stringify(z)); c.id = uid(); c.poly = c.poly.map(p => [p[0] + dx, p[1] + dy]); if (unit != null && (z.kind === 'unit' || z.unit)) c.unit = unit; return c; }
function nextUnit(u) { const m = /^(.*?)(\d+)$/.exec(String(u || '')); if (!m) return (u || '') + '-copy'; const n = String(+m[2] + 1); return m[1] + (m[2].startsWith('0') ? n.padStart(m[2].length, '0') : n); }
function zoneDetails(z, isNew) {
  const kinds = { unit: 'Unit outline', room: 'Room', area: 'Common area' };
  modal(`<h2>${isNew ? 'New boundary' : 'Boundary details'}</h2>
  <div class="grid">
    <label class="f">Type<select id="zdK">${Object.entries(kinds).map(([k, l]) => `<option value="${k}" ${k === z.kind ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="f">Unit number<input id="zdU" value="${esc(z.unit || '')}" list="zdUl"></label>
    <label class="f full" id="zdNl">Room / area name<input id="zdN" value="${esc(z.name || '')}" list="zdRl"></label>
    <label class="f">Block / building<input id="zdB" value="${esc(z.block || '')}"></label>
    <label class="f">Level<input id="zdL" value="${esc(z.level || '')}"></label>
  </div>
  <datalist id="zdRl">${S.project.rooms.map(r => `<option>${esc(r)}</option>`).join('')}</datalist><datalist id="zdUl">${unitList(S.project).map(u => `<option>${esc(u)}</option>`).join('')}</datalist>
  <p class="note">A room inside a unit outline takes its unit number automatically, so you can leave Unit blank for rooms.</p>
  <div class="act"><button id="zdX">${isNew ? 'Discard' : 'Cancel'}</button><button class="go" id="zdOk">OK</button></div>`);
  const sync = () => { $('zdNl').style.display = $('zdK').value === 'unit' ? 'none' : ''; }; $('zdK').onchange = sync; sync();
  if (isNew && z.kind === 'unit') setTimeout(() => $('zdU').focus(), 50); else if (isNew) setTimeout(() => $('zdN').focus(), 50);
  $('zdX').onclick = () => { closeModal(); panel(); };
  $('zdOk').onclick = () => { z.kind = $('zdK').value; z.unit = $('zdU').value.trim(); z.name = z.kind === 'unit' ? '' : $('zdN').value.trim(); z.block = $('zdB').value.trim(); z.level = $('zdL').value.trim();
    if (z.kind === 'unit' && !z.unit) return toast('Enter the unit number'); if (z.kind !== 'unit' && !z.name) return toast('Enter the room or area name');
    if (isNew) ZE.zones.push(z); ZE.dirty = true; closeModal(); ZE.PV.setZones(ZE.zones); ZE.PV.selectZone(z); panel(); };
}
async function save() {
  const p = ZE.plan; p.zones = ZE.zones.map(z => ({ id: z.id, kind: z.kind, name: z.name || '', unit: z.unit || '', block: z.block || '', level: z.level || '', poly: z.poly.map(q => [+q[0].toFixed(5), +q[1].toFixed(5)]) }));
  try { await S.store.savePlan(S.project.id, p); ZE.dirty = false; toast('Boundaries saved'); panel(); } catch (e) { toast('Could not save: ' + e.message, 5000); }
}
async function close() {
  if (ZE.dirty && !(await confirmBox('Close without saving your boundary changes?', 'Close without saving'))) return;
  const PV = ZE.PV; ['onDrawn', 'onZoneSelect', 'onDraftChange', 'onZoneDragStart', 'onZoneEdit'].forEach(k => delete PV.o[k]);
  PV.selectZone(null); PV.setMode('view'); $('zonePanel').classList.remove('show'); ZE = null; await X.reloadProject();
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
