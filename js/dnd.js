// Drag and drop: drop files or whole folders from File Explorer anywhere in the app.
import { S, can } from './state.js';
import { $, toast, modal, closeModal } from './util.js';

let X = {};
export function initDrop(ctx) {
  X = ctx;
  const ov = document.createElement('div'); ov.id = 'dropov'; ov.innerHTML = '<div><b>Drop to upload</b><span></span></div>'; document.body.appendChild(ov);
  let depth = 0;
  const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
  addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); depth++; if (S.project || $('scrProjects').classList.contains('on')) { ov.querySelector('span').textContent = S.project ? hint() : 'Drop a project pack (.json) to set up a whole project'; ov.classList.add('show'); } });
  addEventListener('dragover', e => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  addEventListener('dragleave', e => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) ov.classList.remove('show'); });
  addEventListener('drop', async e => {
    if (!hasFiles(e)) return; e.preventDefault(); depth = 0; ov.classList.remove('show');
    const files = await collect(e.dataTransfer);
    if (!files.length) return;
    if (!S.project) { if (files.length === 1 && ext(files[0]) === 'json' && S.sup) return X.Admin.importJson(files[0]).catch(err => toast(err.message, 6000)); toast(S.sup ? 'Drop a project pack (.json) here, or open a project first' : 'Open a project first, then drop the files'); return; }
    if (!can.write()) { toast('Your role on this project cannot upload files'); return; }
    route(files).catch(err => { console.error(err); toast('Could not process the dropped files: ' + err.message, 6000); });
  });
}
function where() {
  if ($('sheet').classList.contains('show') && X.editorOpen()) return 'defect';
  if (X.FM.assetDropTarget()) return 'asset';
  if ($('modal').classList.contains('show') && $('plUp')) return 'plans';
  return X.FM.currentModule() === 'defects' ? 'defects' : 'fm';
}
function hint() {
  return { defect: 'Photos and PDFs will be added to this defect', asset: 'Files will be uploaded and linked to this asset', plans: 'PDFs and images will be added as plans', defects: 'Import files (.json, Excel, CSV) or plan PDFs', fm: 'Files and folders will be filed in Documents by system and type' }[where()];
}
// Read dropped files, including everything inside dropped folders (keeps each file's folder path).
async function collect(dt) {
  const items = [...(dt.items || [])].map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
  if (!items.length) return [...dt.files];
  const out = [];
  const readAll = r => new Promise((res, rej) => { const acc = []; const step = () => r.readEntries(b => { if (!b.length) res(acc); else { acc.push(...b); step(); } }, rej); step(); });
  const walk = async (entry, path) => {
    if (entry.isFile) { const f = await new Promise((res, rej) => entry.file(res, rej)); try { Object.defineProperty(f, 'relPath', { value: path + f.name }); } catch (e) {} out.push(f); }
    else if (entry.isDirectory) { for (const c of await readAll(entry.createReader())) await walk(c, path + entry.name + '/'); }
  };
  for (const it of items) await walk(it, '');
  return out;
}
const ext = f => (/\.([a-z0-9]+)$/i.exec(f.name) || [])[1]?.toLowerCase() || '';
const isImg = f => /^image\//.test(f.type) || ['jpg', 'jpeg', 'png', 'heic', 'webp'].includes(ext(f));
async function route(files) {
  const w = where(), folder = files.some(f => f.relPath && f.relPath.includes('/'));
  if (w === 'defect') { const im = files.filter(isImg), docs = files.filter(f => !isImg(f)); if (im.length) await X.addPhotos(im); if (docs.length) await X.addFiles(docs); return; }
  if (w === 'asset') return X.FM.dropDocs(files, X.FM.assetDropTarget());
  if (w === 'plans') { if (!can.admin()) return toast('Only project admins can add plans'); closeModal(); return X.Admin.uploadPlans(files.filter(f => ext(f) === 'pdf' || isImg(f))); }
  const json = files.filter(f => ext(f) === 'json'), sheets = files.filter(f => ['xlsx', 'xls', 'csv'].includes(ext(f)));
  if (!folder && files.length === 1 && json.length === 1) { if (!can.edit()) return toast('Your role cannot import'); return X.Admin.importJson(json[0]); }
  if (w === 'defects' && !folder) {
    if (files.length === 1 && sheets.length === 1) { if (!can.edit()) return toast('Your role cannot import'); return X.Admin.importSheet(sheets[0]); }
    const pdfs = files.filter(f => ext(f) === 'pdf' || isImg(f));
    if (pdfs.length === files.length) return ask(files, can.admin());
  }
  X.FM.setModule('docs'); return X.FM.uploadFolder(files);
}
function ask(files, admin) {
  modal(`<h2>${files.length} file${files.length > 1 ? 's' : ''} dropped</h2><p>What are they?</p><div class="btnlist">${admin ? '<button id="dqP">▦ Floor plans<small>Add as plans you can pin defects on</small></button>' : ''}<button id="dqD">🗀 Documents<small>File them in the document library</small></button></div><div class="act"><button id="dqX">Cancel</button></div>`);
  $('dqX').onclick = closeModal;
  if ($('dqP')) $('dqP').onclick = () => { closeModal(); X.Admin.uploadPlans(files); };
  $('dqD').onclick = () => { closeModal(); X.FM.setModule('docs'); X.FM.uploadFolder(files); };
}
