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
    // a single dropped file can also hand over a live link to itself (Chrome and Edge); it has to be asked for before anything else happens
    let hp = null; try { const its = [...(e.dataTransfer.items || [])].filter(i => i.kind === 'file'); if (its.length === 1 && its[0].getAsFileSystemHandle) hp = its[0].getAsFileSystemHandle(); } catch (x) {}
    let files = [], skipped = [];
    try { const r = await collect(e.dataTransfer); files = r.files; skipped = r.skipped; }
    catch (err) { console.error('drop', err); return dropFailed('The dropped files could not be read (' + (err.message || err.name) + ').'); }
    if (skipped.length) toast(`${skipped.length} file${skipped.length === 1 ? '' : 's'} could not be read and ${skipped.length === 1 ? 'was' : 'were'} left out (usually OneDrive online-only files or very long paths): ${skipped.slice(0, 3).join(', ')}${skipped.length > 3 ? '…' : ''}`, 12000);
    if (!files.length) return dropFailed(skipped.length ? 'None of the dropped files could be read.' : 'Nothing came through with the drop.');
    if (hp && files.length === 1) { try { const h = await hp; if (h && h.kind === 'file') files[0]._handle = h; } catch (x) {} }
    if (!S.project) { if (files.length === 1 && ext(files[0]) === 'json' && S.sup) return X.Admin.importJson(files[0]).catch(err => toast(err.message, 6000)); toast(S.sup ? 'Drop a project pack (.json) here, or open a project first' : 'Open a project first, then drop the files'); return; }
    if (!can.write()) { toast('Your role on this project cannot upload files'); return; }
    route(files).catch(err => { console.error(err); toast('Could not process the dropped files: ' + err.message, 6000); });
  });
}
function where() {
  if ($('sheet').classList.contains('show') && X.editorOpen()) return 'defect';
  if (X.FM.assetDropTarget()) return 'asset';
  if ($('modal').classList.contains('show') && $('plUp')) return 'plans';
  const m = X.FM.currentModule();
  if (m === 'defects') return 'defects';
  if (m === 'assets') return 'subs';
  if (m === 'docs') return 'fm';
  return 'none';
}
function hint() {
  return { defect: 'Photos and PDFs will be added to this defect', asset: 'Files will be uploaded and linked to this asset', plans: 'PDFs and images will be added as plans', defects: 'Import files (.json, Excel, CSV) or plan PDFs', fm: 'Files and folders will be filed in Documents by system and type', subs: 'Warranties: each one is matched to its element, then checked', none: 'Files cannot be dropped here. Open Defects, Assets & warranties or Documents first.' }[where()];
}
// When a drop cannot be read (Windows or OneDrive refuses it), offer the folder picker instead of failing silently.
function dropFailed(why) {
  if (!S.project) return toast(why, 8000);
  modal(`<h2>The drop did not work</h2><p>${why}</p><p class="note">Windows sometimes refuses to hand dropped folders to the browser, for example OneDrive online-only files or very long file paths. Choosing the folder instead reads the same files.</p><div class="act"><button id="dfX">Cancel</button><button class="go" id="dfGo">🗂 Choose the folder</button></div>`);
  $('dfX').onclick = closeModal; $('dfGo').onclick = () => { closeModal(); X.FM.setModule('docs'); $('fFolder').click(); };
}
// Read dropped files, including everything inside dropped folders (keeps each file's folder path).
// The entries are taken from the drop straight away: the browser empties the list once the drop handler awaits anything.
// A file that cannot be read is skipped and reported, so one bad file does not stop the rest.
async function collect(dt) {
  const items = [...(dt.items || [])].filter(i => i.kind === 'file').map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
  const plain = [...(dt.files || [])];
  if (!items.length) return { files: plain, skipped: [] };
  const out = [], skipped = [];
  const readAll = r => new Promise(res => { const acc = []; const step = () => r.readEntries(b => { if (!b.length) res(acc); else { acc.push(...b); step(); } }, () => res(acc)); step(); });
  const walk = async (entry, path) => {
    if (entry.isFile) { try { const f = await new Promise((res, rej) => entry.file(res, rej)); try { Object.defineProperty(f, 'relPath', { value: path + f.name }); } catch (e) {} out.push(f); } catch (e) { skipped.push(path + entry.name); } }
    else if (entry.isDirectory) { const kids = await readAll(entry.createReader()); if (!kids.length) return; for (const c of kids) await walk(c, path + entry.name + '/'); }
  };
  for (const it of items) await walk(it, '');
  // a drop of plain files with no entries readable: fall back to the file list
  if (!out.length && plain.length && !items.some(i => i.isDirectory)) return { files: plain, skipped: [] };
  return { files: out, skipped };
}
const ext = f => (/\.([a-z0-9]+)$/i.exec(f.name) || [])[1]?.toLowerCase() || '';
const isImg = f => /^image\//.test(f.type) || ['jpg', 'jpeg', 'png', 'heic', 'webp'].includes(ext(f));
async function route(files) {
  const w = where(), folder = files.some(f => f.relPath && f.relPath.includes('/'));
  if (X.noteDropOpen && X.noteDropOpen()) return X.noteDrop(files);   // a comment or response is being written: the files become its appendix
  if (w === 'defect') { const im = files.filter(isImg), docs = files.filter(f => !isImg(f)); if (im.length) await X.addPhotos(im); if (docs.length) await X.addFiles(docs); return; }
  if (w === 'asset') return X.FM.dropDocs(files, X.FM.assetDropTarget());
  if (w === 'none') return toast('Nothing was uploaded. Drop files on the tab they belong to: Defects (photos, plans, imports), Assets & warranties (warranties to check) or Documents (anything for the library).', 9000);
  if (w === 'subs') { if (folder) return toast('Drop the warranty PDFs themselves here, not a folder. Folders go on the Documents tab.', 8000); return X.Sub.bulk(files); }
  if (w === 'plans') { if (!can.admin()) return toast('Only project admins can add plans'); closeModal(); return X.Admin.uploadPlans(files.filter(f => ext(f) === 'pdf' || isImg(f))); }
  const json = files.filter(f => ext(f) === 'json'), sheets = files.filter(f => ['xlsx', 'xls', 'csv'].includes(ext(f)));
  if (!folder && json.length > 1 && json.length === files.length) return toast('Drop these .json files one at a time, so each one can show you what it will change. Nothing was loaded.', 9000);
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
