// Starting a new project without help: a short wizard, a template that carries one project's set-up to the next, and a checklist.
import { S, can, withDefaults } from './state.js';
import { $, esc, toast, modal, closeModal, busy, deliver, safeName, stamp } from './util.js';
import * as Admin from './admin.js';

let X = {};
export function init(ctx) { X = ctx; }

// What a template carries: the way a project is run, never its people, plans or defects.
const KEYS = ['severities', 'sevLabel', 'sevDefault', 'sevMajor', 'types', 'trades', 'rooms', 'items', 'sources', 'selfCloseSources', 'responsible', 'typicals', 'placeRules', 'pdfTitle', 'pdfSub', 'pdfIntro', 'aiContext'];
const pick = p => { const o = {}; KEYS.forEach(k => { if (p[k] != null && !(Array.isArray(p[k]) && !p[k].length) && p[k] !== '') o[k] = JSON.parse(JSON.stringify(p[k])); }); return o; };

export function saveTemplate() {
  const p = S.project; if (!p) return;
  const t = { type: 'template', v: 1, title: p.name + ' set-up', from: p.name, made: new Date().toISOString(), contractor: p.contractor || '', project: pick(p), subcontractors: p.subcontractors || [] };
  deliver(new Blob([JSON.stringify(t, null, 1)], { type: 'application/json' }), `${safeName(p.name)} - PROJECT TEMPLATE (drop into Resero Defects) - ${stamp()}.json`, 'Project template');
  toast('Template saved. On the projects page choose + New project, or drop this file there, to start the next job with the same set-up.', 7000);
}

export async function newProjectWizard(tpl) {
  let list = []; try { list = (await S.store.listProjects()).filter(p => !p.archived); } catch (e) {}
  modal(`<h2>New project</h2><p class="note">Four questions, then a checklist walks you through plans, people and the rest. Everything can be changed later in Project settings.</p>
  <div class="grid">
    <label class="f full">Project name<input id="nwName" placeholder="e.g. 12 Example Street apartments"></label>
    <label class="f full">Address<input id="nwAddr"></label>
    <label class="f">Client<input id="nwClient"></label>
    <label class="f">Main contractor<input id="nwCon" value="${esc(tpl && tpl.contractor || '')}"></label>
    <label class="f">Units (e.g. 1-42, or G01, G02)<input id="nwUnits" placeholder="leave blank if none"></label>
    <label class="f">Defect number prefix<input id="nwPre" value="D" maxlength="4"></label>
    <label class="f full">Set-up to start from<select id="nwFrom">${tpl ? `<option value="tpl">Template file: ${esc(tpl.title || tpl.from || 'template')}</option>` : ''}<option value="">Standard set-up (severity Minor / Major, standard trades and rooms)</option>${list.map(p => `<option value="${esc(p.id)}">Same as ${esc(p.name)}</option>`).join('')}</select></label>
  </div>
  <div id="nwInfo" class="note"></div>
  <label class="chk" id="nwSubsL" style="display:none"><input type="checkbox" id="nwSubs"> Also bring the subcontractor list</label>
  <p class="note small"><a href="#" id="nwAdv">Use the full settings form instead</a></p>
  <div class="act"><button id="nwX">Cancel</button><button class="go" id="nwGo">Create project</button></div>`, true);
  const src = () => { const v = $('nwFrom').value; return v === 'tpl' ? { project: tpl.project || {}, subcontractors: tpl.subcontractors || [], contractor: tpl.contractor || '' } : v ? (p => ({ project: pick(p), subcontractors: p.subcontractors || [], contractor: p.contractor || '' }))(list.find(q => q.id === v)) : null; };
  const info = () => { const s = src(); $('nwSubsL').style.display = s && s.subcontractors.length ? '' : 'none';
    if (!s) { $('nwInfo').innerHTML = 'Standard lists. Change the category system later if the project uses its own (for example A to D).'; return; }
    const P = withDefaults(s.project); $('nwInfo').innerHTML = `Brings across: <b>${esc(P.sevLabel || 'Severity')}</b> list (${esc(P.severities.join(', '))}), ${P.trades.length} trades, ${P.rooms.length} room names, ${P.sources.length} sources${(P.selfCloseSources || []).length ? ', which registers the contractor closes themselves' : ''}${P.typicals ? ', typical defects' : ''}${P.placeRules ? ', pin placement rules' : ''}${P.aiContext ? ' and the Gemini project knowledge (<b>review it</b>: it names the old project\'s products and parties)' : ''}. Does not bring: people, plans, defects or the linked spreadsheet.`; };
  $('nwFrom').onchange = info; info();
  $('nwX').onclick = closeModal; $('nwAdv').onclick = e => { e.preventDefault(); closeModal(); Admin.projectSettings(null); };
  $('nwGo').onclick = async () => {
    const name = $('nwName').value.trim(); if (!name) { toast('Enter the project name'); $('nwName').focus(); return; }
    if (list.some(p => p.name.toLowerCase() === name.toLowerCase())) { toast('A project with that name already exists'); return; }
    const s = src(), con = $('nwCon').value.trim();
    const data = withDefaults({ ...(s ? s.project : {}), name, address: $('nwAddr').value.trim(), client: $('nwClient').value.trim(), contractor: con, units: $('nwUnits').value.trim(), idPrefix: ($('nwPre').value.trim() || 'D').toUpperCase().replace(/[^A-Z]/g, '') || 'D', subcontractors: s && $('nwSubs').checked ? s.subcontractors.slice() : [], clientLogo: '', setupFrom: s ? ($('nwFrom').value === 'tpl' ? (tpl.from || 'template') : (list.find(q => q.id === $('nwFrom').value) || {}).name || '') : '' });
    if (s && s.contractor && con && s.contractor !== con) data.responsible = data.responsible.map(r => r === s.contractor ? con : r);   // the old builder's name does not follow the set-up
    const b = busy('Creating the project…');
    try { const id = await S.store.createProject(data); b.done(); closeModal(); await X.openProject(id); checklist(true); }
    catch (e) { b.done(); toast('Could not create the project: ' + e.message, 6000); }
  };
  setTimeout(() => $('nwName') && $('nwName').focus(), 50);
}

// The steps a project needs before a builder can pick it up, each with a button that goes straight to the right place.
export function steps() {
  const p = S.project || {}, ai = S.ai || {}, mem = Object.keys(p.members || {}).length, zones = S.plans.reduce((a, q) => a + (q.zones || []).length, 0);
  return [
    { key: 'details', name: 'Project details', why: 'Name, main contractor and the unit numbers. The unit list drives the filters and the pins.', done: !!(p.name && p.contractor && (p.units || p.noUnits)), state: p.units ? 'Units: ' + p.units : 'No unit numbers yet', btn: 'Open project settings', run: () => Admin.projectSettings(S.project) },
    { key: 'plans', name: 'Upload the plans', why: 'PDF or image floor plans, one per block and level. Elevations and wall or ceiling plans can follow.', done: S.plans.length > 0, state: S.plans.length ? S.plans.length + ' sheet' + (S.plans.length > 1 ? 's' : '') + ' loaded' : 'None yet', btn: 'Upload plans', run: () => Admin.plansDialog() },
    { key: 'zones', name: 'Draw the room boundaries', why: 'Outline units and rooms once and every pin fills in its own unit, room, block and level.', done: zones > 0, state: zones ? zones + ' boundaries drawn' : 'None yet', btn: 'Open room boundaries', run: () => X.zones(), need: S.plans.length ? '' : 'Upload a plan first' },
    { key: 'lists', name: 'Check the categories and lists', why: 'The severity or category system (for example A to D), trades, sources, and which registers the contractor can close themselves.', done: !!p.setupLists || !!p.setupFrom, state: (p.sevLabel || 'Severity') + ': ' + (p.severities || []).join(', '), btn: 'Review the lists', run: () => Admin.projectSettings(S.project), confirm: 'setupLists' },
    { key: 'people', name: 'Invite the team', why: 'Admins and editors raise and review; the contractor responds and marks items ready; viewers read only.', done: mem > 1, state: mem > 1 ? mem + ' people have access' : 'Only you so far', btn: 'Users and access', run: () => Admin.usersDialog() },
    { key: 'ai', name: 'Connect Gemini', why: 'Turns a spoken note and a photo into a filled-in defect, and reads printed tick sheets.', done: !!(ai.helperUrl || (S.local || {}).geminiKey), state: ai.helperUrl ? 'Project helper connected' : (S.local || {}).geminiKey ? 'Personal key on this device' : 'Not connected', btn: 'Gemini settings', run: () => Admin.aiSettings() },
    { key: 'register', opt: 1, name: "Link the contractor's register", why: 'Optional. A Google Sheet the builder keeps: completed rows close items here and new rows come in.', done: !!p.registerSheet, state: p.registerSheet ? 'Linked: ' + (p.registerSheet.name || 'Google Sheet') : 'Not linked', btn: 'Link a spreadsheet', run: () => X.sync() },
    { key: 'import', opt: 1, name: 'Bring in an existing register', why: 'Optional. Excel, CSV or a prepared file dropped onto the page.', done: S.defects.length > 0, state: S.defects.length ? S.defects.length + ' items in the project' : 'Nothing imported', btn: 'Import a register', run: () => Admin.importDialog() },
    { key: 'check', opt: 1, name: 'Run the site check and install on your phone', why: 'Tests sign-in, storage, camera, microphone and Gemini before the first walk-through.', done: !!(S.local || {}).siteChecked, state: '', btn: 'Run the site check', run: () => { S.local.siteChecked = true; X.saveLocal && X.saveLocal(); X.siteCheck(); } },
  ];
}
export const progress = () => { const L = steps().filter(s => !s.opt); return [L.filter(s => s.done).length, L.length]; };

export function checklist(fresh) {
  const L = steps(), [n, m] = progress();
  modal(`<h2>Set-up checklist</h2><p class="note">${fresh ? '<b>' + esc(S.project.name) + ' is created.</b> ' : ''}${n === m ? 'The essentials are done. The project is ready to hand to the team.' : `${n} of ${m} essential steps done. Work down the list; each button goes straight to the right place, and this checklist is always under ☰ Menu.`}</p>
  <div class="ckbar"><i style="width:${Math.round(n / m * 100)}%"></i></div>
  <div class="cklist">${L.map((s, i) => `<div class="ck ${s.done ? 'done' : ''} ${s.opt ? 'opt' : ''}"><span class="ckn">${s.done ? '✓' : s.opt ? '+' : i + 1}</span><div class="ckm"><b>${esc(s.name)}</b>${s.opt ? ' <small class="muted">optional</small>' : ''}<small>${esc(s.why)}</small>${s.state ? `<small class="ckst">${esc(s.state)}</small>` : ''}</div><div class="ckb">${s.need ? `<small class="muted">${esc(s.need)}</small>` : `<button data-ck="${i}" class="${!s.done && !s.opt ? 'go' : ''}">${esc(s.done ? 'Open' : s.btn)}</button>`}${s.confirm && !s.done ? `<button data-ok="${esc(s.confirm)}" class="mini">Looks right</button>` : ''}</div></div>`).join('')}</div>
  ${can.admin() ? '<p class="note small">Finished with this project and starting another? <a href="#" id="ckTpl">Save this set-up as a template</a> and the next project starts with the same categories, lists and rules.</p>' : ''}
  <div class="act"><button id="ckX">Close</button></div>`, true);
  $('ckX').onclick = closeModal;
  $('mbox').querySelectorAll('[data-ck]').forEach(b => b.onclick = () => { closeModal(); L[+b.dataset.ck].run(); });
  $('mbox').querySelectorAll('[data-ok]').forEach(b => b.onclick = async () => { const patch = { [b.dataset.ok]: true }; try { await S.store.updateProject(S.project.id, patch); Object.assign(S.project, patch); } catch (e) { toast('Could not save: ' + e.message); } checklist(); });
  if ($('ckTpl')) $('ckTpl').onclick = e => { e.preventDefault(); saveTemplate(); };
}
