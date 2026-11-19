// Restore a project from its handover pack: the "Resero Site data" file kept in every pack holds every record.
// The records come back as a new project (nothing existing is touched). Plans, photos and documents are copied
// from the original storage while it can still be reached; anything that cannot be copied keeps its original link,
// and documents can be re-attached afterwards from the pack's Documents and Restricted folders.
import { S } from './state.js';
import { $, esc, toast, modal, closeModal, nzDate, safeName, dataUrlToBlob } from './util.js';
import { basePath } from './pack.js';

// fields that belong to the original project and its people, not to the restored copy
const LEAVE = ['id', 'members', 'memberUids', 'memberInfo', 'access', 'archived', 'archivedAt', 'archivedBy', 'handoverExported', 'handoverRecord', 'seq', 'created', 'createdBy', 'restoredFrom'];
const TYPES = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xls: 'application/vnd.ms-excel', msg: 'application/octet-stream', txt: 'text/plain', csv: 'text/csv' };
const mimeOf = (name, fb) => TYPES[String(name || '').split('.').pop().toLowerCase()] || fb || 'application/octet-stream';
const pl = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;
const extOf = (name, fb) => { const m = /\.([a-z0-9]{2,5})$/i.exec(name || ''); return m ? m[1].toLowerCase() : fb; };

export function restoreDialog(j, X) {
  if (!S.sup) return toast('Only a system administrator can create a project from a handover pack');
  const pr = j.project || {}, D = j.defects || [], docs = j.docs || [], nPh = D.reduce((a, d) => a + (d.photos || []).length + (d.files || []).length, 0);
  modal(`<h2>Restore ${esc(pr.name || 'project')} from its handover pack</h2>
  <p>This data file was made on <b>${esc(nzDate(String(j.exported || '').slice(0, 10)) || 'an unknown date')}</b>. It holds ${pl(D.length, 'defect')} with their full history, ${pl((j.assets || []).length, 'asset')} with warranties, ${pl((j.tasks || []).length, 'maintenance task')}, ${pl((j.systems || []).length, 'specified system')}, ${pl(docs.length, 'document record')}, ${pl((j.guide || []).length, 'home guide page')}, ${pl((j.actions || []).length, 'action')} and ${pl((j.plans || []).length, 'plan')}.</p>
  <label class="f">Name of the new project<input id="rsN" value="${esc(pr.name || '')}"></label>
  <div class="opt"><input type="checkbox" id="rsC" checked><label for="rsC">Copy the plans, ${nPh} defect photos and files, and the documents from the original storage where it can still be reached (slower, but the restored project then stands on its own)</label></div>
  <p class="note">A new project is created and you are its admin. Nobody else is added: invite people again from Users and access. Nothing in any existing project changes. Documents that cannot be copied (restricted ones always) are re-attached afterwards from the pack's folder: Documents, then "Re-attach files from the pack".</p>
  <p class="note" id="rsSt"></p><div class="act"><button id="rsX">Cancel</button><button class="go" id="rsGo">Restore</button></div>`);
  $('rsX').onclick = closeModal;
  $('rsGo').onclick = async () => {
    $('rsGo').disabled = true; $('rsX').disabled = true;
    const st = t => { if ($('rsSt')) $('rsSt').textContent = t; }, copy = $('rsC').checked, miss = { plans: 0, files: 0, docs: 0 }, done = { files: 0, docs: 0 };
    // copy one stored file into the new project; on failure the original link is kept
    const grab = async (src, name, fb) => { if (!src) throw new Error('no file'); if (String(src).startsWith('data:')) return dataUrlToBlob(src); return new Blob([await X.getBytes(src)], { type: mimeOf(name, fb) }); };
    try {
      const p0 = { ...pr }; LEAVE.forEach(k => delete p0[k]); p0.name = ($('rsN').value || '').trim() || pr.name || 'Restored project';
      p0.restoredFrom = { name: pr.name || '', id: pr.id || '', exported: j.exported || '', at: new Date().toISOString(), by: S.user.email };
      st('Creating the project…'); const pid = await S.store.createProject(p0);
      // the next defect number carries on from the highest one in the file, so no number is used twice
      const pre = (pr.idPrefix || 'D') + '-', hi = D.reduce((m, d) => { const s = String(d.id || ''), n = s.startsWith(pre) ? parseInt(s.slice(pre.length), 10) : NaN; return isNaN(n) ? m : Math.max(m, n); }, 0);
      await S.store.updateProject(pid, { seq: Math.max(+pr.seq || 0, hi) });
      // plans keep their ids, so the pins on the defects still point at them
      const plans = j.plans || [];
      for (const [i, p] of plans.entries()) { st(`Plan ${i + 1} of ${plans.length}: ${p.name || ''}`);
        const o = { ...p };
        if (copy && (p.img || p.path)) { try { const path = `projects/${pid}/plans/${p.id}.jpg`; o.img = await S.store.putFile(path, await grab(p.img || p.path, 'plan.jpg', 'image/jpeg'), true); o.path = path; } catch (e) { console.warn('plan', p.name, e); miss.plans++; } }
        await S.store.savePlan(pid, o); }
      // defects, with their photos, attachments and the photos on comments
      const defs = D.map(d => JSON.parse(JSON.stringify(d)));
      if (copy) { let n = 0, next = 0; const jobs = [];
        defs.forEach(d => { (d.photos || []).forEach(x => jobs.push([d, x, 'jpg'])); (d.files || []).forEach(x => jobs.push([d, x, 'bin'])); (d.history || []).forEach(h => (h.photos || []).forEach(x => jobs.push([d, x, 'jpg']))); });
        const one = async ([d, x, fb]) => { st(`Copying photos and files ${++n} of ${jobs.length} (${d.id})…`); if (!x.url && !x.path) return;
          try { const nm = x.name || x.fileName || x.path || '', path = `projects/${pid}/photos/${d.id}/${x.id || Math.random().toString(36).slice(2)}.${extOf(nm, fb === 'jpg' ? 'jpg' : 'bin')}`;
            x.url = await S.store.putFile(path, await grab(x.url || x.path, nm, fb === 'jpg' ? 'image/jpeg' : ''), true); x.path = path; done.files++; }
          catch (e) { miss.files++; } };
        await Promise.all([0, 1, 2].map(async () => { while (next < jobs.length) await one(jobs[next++]); })); }
      if (defs.length) { st('Saving defects…'); await S.store.bulkCreate(pid, defs, k => st(`Saving defects ${k} of ${defs.length}…`)); }
      for (const k of ['assets', 'tasks', 'systems', 'guide', 'actions']) if ((j[k] || []).length) { st(`Saving ${k}…`); await S.store.bulkSave(pid, k, j[k]); }
      // documents: copied where possible; otherwise they wait for their file from the pack's folder
      const out = { docs: [], rdocs: [] }; let n = 0, next = 0;
      const one = async d0 => { const d = { ...d0 }; st(`Documents ${++n} of ${docs.length}: ${d.title || ''}`); const hadFile = !!(d.url || d.path || d.packPath);
        if (hadFile) d.restoreSrc = d.packPath || basePath(d0);   // older packs: the place every document had before names were made unique
        if (copy && d.url && !d.restricted) { try { const path = `projects/${pid}/docs/${d.id}/${safeName(d.fileName || 'file')}`; d.url = await S.store.putFile(path, await grab(d.url, d.fileName, d.mime), true); d.path = path; delete d.restoreSrc; done.docs++; } catch (e) { miss.docs++; } }
        if (d.restricted) { delete d.url; delete d.path; }   // restricted files come back only from the pack's Restricted folder
        delete d.packPath; delete d.textIdx; const r = !!d.restricted; delete d.restricted; (r ? out.rdocs : out.docs).push(d); };
      await Promise.all([0, 1, 2].map(async () => { while (next < docs.length) await one(docs[next++]); }));
      if (out.docs.length) await S.store.bulkSave(pid, 'docs', out.docs); if (out.rdocs.length) await S.store.bulkSave(pid, 'rdocs', out.rdocs);
      const waiting = [...out.docs, ...out.rdocs].filter(d => d.restoreSrc).length;
      await S.store.updateProject(pid, { restoredFrom: { ...p0.restoredFrom, copied: copy, filesCopied: done.files, docsCopied: done.docs, filesKeptOriginal: miss.files, plansKeptOriginal: miss.plans, docsWaiting: waiting } });
      st(''); closeModal();
      modal(`<h2>✔ ${esc(p0.name)} restored</h2><p>${pl(defs.length, 'defect')}, ${pl((j.assets || []).length, 'asset')}, ${pl((j.tasks || []).length, 'maintenance task')} and ${pl(docs.length, 'document record')} are in the new project.${copy ? ` Copied: ${pl(done.files, 'photo or file', 'photos and files')} and ${pl(done.docs, 'document')}.` : ''}</p>
        ${miss.plans || miss.files ? `<p class="note">${miss.plans ? pl(miss.plans, 'plan') : ''}${miss.plans && miss.files ? ' and ' : ''}${miss.files ? pl(miss.files, 'photo or file', 'photos or files') : ''} could not be copied and still link to the original storage. They show while the original project's files exist.</p>` : ''}
        ${waiting ? `<p class="note"><b>${pl(waiting, 'document is', 'documents are')} waiting for ${waiting === 1 ? 'its file' : 'their files'}.</b> Open Documents and choose "Re-attach files from the pack", then pick the pack's main folder (the one with "Open me first.html" in it).</p>` : ''}
        <p class="note">Next: invite people from Users and access, and check the key dates.</p><div class="act"><button class="go" id="rsOk">Open the project</button></div>`);
      $('rsOk').onclick = async () => { closeModal(); await X.openProject(pid); };
    } catch (e) { console.error(e); st(''); toast('The restore stopped: ' + e.message + '. Nothing in any existing project was changed; delete the part-made project from the project list before trying again.', 12000); if ($('rsGo')) { $('rsGo').disabled = false; $('rsX').disabled = false; } }
  };
}

// Documents restored from a pack wait for their files. Pick the pack's main folder: each file is matched to its
// record by its place in the pack (Documents/<system>/<type>/<title>), uploaded, and the record keeps everything else.
export async function reattach(files, ctx) {
  const want = ctx.docs().filter(d => d.restoreSrc), byPath = new Map(want.map(d => [String(d.restoreSrc).toLowerCase(), d]));
  const tail = f => { const p = String(f.webkitRelativePath || f.relPath || f.name).replace(/\\/g, '/'); const m = /(?:^|\/)((?:Documents|Restricted)\/.*)$/.exec(p); return (m ? m[1] : p).toLowerCase(); };
  const todo = files.map(f => ({ f, d: byPath.get(tail(f)) })).filter(x => x.d && x.f.size);
  if (!todo.length) return toast(`None of the ${files.length} files match the ${want.length} documents waiting. Pick the pack's main folder, the one with "Open me first.html" in it.`, 10000);
  if (!(await ctx.confirm(`Re-attach ${todo.length} of the ${want.length} documents waiting for their files? Each one keeps its details and links.${todo.length < want.length ? ` ${want.length - todo.length} have no matching file in that folder and stay waiting.` : ''}`, 'Re-attach'))) return;
  const b = ctx.busy('Re-attaching…'); let n = 0, next = 0; const fail = [];
  const one = async ({ f, d }) => { b.set(`Re-attaching ${++n} of ${todo.length}: ${d.title || f.name}`); const path = `projects/${S.project.id}/${d.restricted ? 'restricted' : 'docs'}/${d.id}/${safeName(f.name)}`;
    try { const url = await S.store.putFile(path, f, true); await S.store.patchItem(S.project.id, 'docs', d.id, { url, path, size: f.size, mime: f.type || mimeOf(f.name), fileName: d.fileName || f.name, restoreSrc: null }); } catch (e) { fail.push((d.title || f.name) + ': ' + e.message); } };
  await Promise.all([0, 1, 2].map(async () => { while (next < todo.length) await one(todo[next++]); }));
  b.done(); toast(`Re-attached ${todo.length - fail.length} documents${fail.length ? `; ${fail.length} failed (${fail.slice(0, 2).join('; ')}). Run it again to retry.` : ''}`, fail.length ? 12000 : 5000);
}
