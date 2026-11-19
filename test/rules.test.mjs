// Security rules tests. Run on GitHub before every rules deploy (see .github/workflows/rules-test.yml):
//   firebase emulators:exec --only firestore,storage --project demo-resero "node test/rules.test.mjs"
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, arrayUnion, serverTimestamp, collection, addDoc, getDocs, query, where } from 'firebase/firestore';
import { ref, getBytes, uploadBytes } from 'firebase/storage';

const env = await initializeTestEnvironment({ projectId: 'demo-resero', firestore: { rules: readFileSync('firestore.rules', 'utf8') }, storage: { rules: readFileSync('storage.rules', 'utf8') } });
const P = 'p1';
const seed = async () => env.withSecurityRulesDisabled(async ctx => {
  const db = ctx.firestore();
  await setDoc(doc(db, 'system/admins'), { uids: ['super'] });
  await setDoc(doc(db, 'projects', P), { name: 'T', memberUids: ['adm', 'ed', 'con', 'mm', 'cli', 'vm', 'lim'], members: { adm: 'admin', ed: 'editor', con: 'contractor', mm: 'editor', cli: 'viewer', vm: 'editor', lim: 'editor' },
    access: { orgs: { 'mm.co.nz': { sections: ['dash', 'defects'], sources: ['MM'] } }, people: { 'vm@client.co.nz': { sections: ['defects', 'guide'], sources: ['Residents'] }, 'lim@resero.co.nz': { sections: ['defects'] } } },
    restrictedTo: ['client.co.nz'], selfCloseSources: ['Miles list'], seq: 3 });
  await setDoc(doc(db, `projects/${P}/defects/D-1`), { source: 'PC', status: 'Open', history: [{ t: '1', who: 'a', txt: 'Raised' }], createdBy: 'adm@resero.co.nz', updatedBy: 'adm@resero.co.nz' });
  await setDoc(doc(db, `projects/${P}/defects/MM-1`), { source: 'MM', status: 'Ready for review', history: [{ t: '1', who: 'b', txt: 'Imported' }] });
  await setDoc(doc(db, `projects/${P}/docs/doc1`), { title: 'Deed' });
  await setDoc(doc(db, `projects/${P}/rdocs/r1`), { title: 'Bond' });
  await setDoc(doc(db, `projects/${P}/tasks/t1`), { title: 'Gutters', history: [{ t: '1', who: 'x', notes: 'done' }] });
  await setDoc(doc(db, `projects/${P}/private/ai`), { helperKey: 'k' });
  await setDoc(doc(db, `projects/${P}/private/admin`), { adminKey: 'a' });
  await setDoc(doc(db, `projects/${P}/assets/a1`), { element: 'Roof' });
  await setDoc(doc(db, `projects/${P}/log/l1`), { email: 'x' });
  await setDoc(doc(db, 'library/typicals'), { items: [{ t: 'A' }, { t: 'B' }] });
  const st = ctx.storage();
  await uploadBytes(ref(st, `projects/${P}/restricted/r1/bond.pdf`), new Uint8Array([1, 2, 3]));
  await uploadBytes(ref(st, `projects/${P}/docs/doc1/deed.pdf`), new Uint8Array([1]));
});
await seed();
const who = (uid, email) => env.authenticatedContext(uid, { email, email_verified: true });
const U = { adm: who('adm', 'adm@resero.co.nz'), ed: who('ed', 'ed@resero.co.nz'), con: who('con', 'con@gmail.com'), mm: who('mm', 'insp@mm.co.nz'), cli: who('cli', 'pl@client.co.nz'), vm: who('vm', 'vm@client.co.nz'), lim: who('lim', 'lim@resero.co.nz'), sup: who('super', 's@resero.co.nz'), rnd: who('rnd', 'x@random.com') };
const db = u => U[u].firestore(), st = u => U[u].storage(), D = (u, p) => doc(db(u), p);
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log('ok    ' + name); } catch (e) { fail++; console.log('FAIL  ' + name + ' :: ' + String(e && e.message || e).split('\n')[0]); } };
const ok = p => assertSucceeds(p), no = p => assertFails(p);
const pp = s => `projects/${P}/${s}`;

// restricted documents
await t('admin reads a restricted document', () => ok(getDoc(D('adm', pp('rdocs/r1')))));
await t('contractor cannot read a restricted document', () => no(getDoc(D('con', pp('rdocs/r1')))));
await t('editor outside the allowed list cannot read a restricted document', () => no(getDoc(D('ed', pp('rdocs/r1')))));
await t('client domain on the allowed list reads a restricted document', () => ok(getDoc(D('cli', pp('rdocs/r1')))));
await t('contractor cannot list restricted documents', () => no(getDocs(collection(db('con'), pp('rdocs')))));
await t('admin writes a restricted document', () => ok(setDoc(D('adm', pp('rdocs/r2')), { title: 'Insurance' })));
await t('client cannot write a restricted document', () => no(setDoc(D('cli', pp('rdocs/r3')), { title: 'x' })));
await t('contractor still reads the open library', () => ok(getDocs(collection(db('con'), pp('docs')))));
// defect history only grows
await t('contractor moves an item on and adds to its history', () => ok(updateDoc(D('con', pp('defects/D-1')), { status: 'In progress', history: arrayUnion({ t: '2', who: 'c', txt: 'In progress' }), updatedBy: 'con@gmail.com' })));
await t('contractor cannot wipe the history', () => no(updateDoc(D('con', pp('defects/D-1')), { history: [] })));
await t('editor cannot rewrite an earlier history entry', () => no(updateDoc(D('ed', pp('defects/D-1')), { history: [{ t: '1', who: 'a', txt: 'Changed' }, { t: '2', who: 'c', txt: 'In progress' }] })));
await t('editor adds a comment', () => ok(updateDoc(D('ed', pp('defects/D-1')), { history: arrayUnion({ t: '3', who: 'e', txt: 'Comment' }), updatedBy: 'ed@resero.co.nz' })));
await t('editor cannot sign a change in someone else\'s name', () => no(updateDoc(D('ed', pp('defects/D-1')), { desc: 'x', updatedBy: 'adm@resero.co.nz' })));
await t('contractor cannot close an item that is not on its own list', () => no(updateDoc(D('con', pp('defects/D-1')), { status: 'Closed' })));
// shared library
await t('a signed-in user adds one typical defect', () => ok(updateDoc(D('rnd', 'library/typicals'), { items: arrayUnion({ t: 'C' }) })));
await t('nobody but a system admin removes typical defects', () => no(setDoc(D('rnd', 'library/typicals'), { items: [{ t: 'A' }] })));
await t('two at once is refused', () => no(updateDoc(D('rnd', 'library/typicals'), { items: arrayUnion({ t: 'D' }, { t: 'E' }) })));
await t('a user cannot delete the library', () => no(deleteDoc(D('rnd', 'library/typicals'))));
await t('a system admin can tidy the library', () => ok(setDoc(D('sup', 'library/typicals'), { items: [{ t: 'A' }] })));
// change log
await t('a member writes a log entry stamped with server time', () => ok(addDoc(collection(db('ed'), pp('log')), { uid: 'ed', email: 'ed@resero.co.nz', at: serverTimestamp(), coll: 'defects', id: 'D-1' })));
await t('a log entry in someone else\'s name is refused', () => no(addDoc(collection(db('ed'), pp('log')), { uid: 'ed', email: 'adm@resero.co.nz', at: serverTimestamp() })));
await t('a log entry with the device clock is refused', () => no(addDoc(collection(db('ed'), pp('log')), { uid: 'ed', email: 'ed@resero.co.nz', at: new Date() })));
await t('a log entry cannot be changed', () => no(updateDoc(D('adm', pp('log/l1')), { email: 'y' })));
await t('a log entry cannot be deleted', () => no(deleteDoc(D('adm', pp('log/l1')))));
await t('only admins read the log', () => no(getDoc(D('ed', pp('log/l1')))));
await t('admins read the log', () => ok(getDoc(D('adm', pp('log/l1')))));
// register limits: a person's own limit wins over the company's
await t('village manager raises a residents\' issue', () => ok(setDoc(D('vm', pp('defects/R-1')), { source: 'Residents', status: 'Open', history: [], createdBy: 'vm@client.co.nz' })));
await t('village manager cannot raise into another register', () => no(setDoc(D('vm', pp('defects/R-2')), { source: 'PC', status: 'Open', history: [] })));
await t('village manager cannot read construction defects', () => no(getDoc(D('vm', pp('defects/D-1')))));
await t('inspector reads its own register', () => ok(getDoc(D('mm', pp('defects/MM-1')))));
await t('inspector cannot read another register', () => no(getDoc(D('mm', pp('defects/D-1')))));
await t('inspector accepts an item in its register', () => ok(updateDoc(D('mm', pp('defects/MM-1')), { status: 'Closed', history: arrayUnion({ t: '2', who: 'm', txt: 'Accepted and closed.' }), updatedBy: 'insp@mm.co.nz' })));
// section limits apply to writes
await t('an editor limited to defects cannot change an element', () => no(updateDoc(D('lim', pp('assets/a1')), { element: 'x' })));
await t('a full editor changes an element', () => ok(updateDoc(D('ed', pp('assets/a1')), { element: 'Roof cladding' })));
// maintenance tasks
await t('contractor marks maintenance done', () => ok(updateDoc(D('con', pp('tasks/t1')), { lastDone: '2026-11-20', nextDue: '2027-11-20', history: arrayUnion({ t: '2', who: 'c', notes: 'done' }) })));
await t('contractor cannot wipe a task history', () => no(updateDoc(D('con', pp('tasks/t1')), { history: [] })));
// helper keys
await t('contractor reads the AI helper settings', () => ok(getDoc(D('con', pp('private/ai')))));
await t('contractor cannot read the admin key', () => no(getDoc(D('con', pp('private/admin')))));
await t('editor cannot read the admin key', () => no(getDoc(D('ed', pp('private/admin')))));
await t('admin reads the admin key', () => ok(getDoc(D('adm', pp('private/admin')))));
// storage
await t('admin opens a restricted file', () => ok(getBytes(ref(st('adm'), pp('restricted/r1/bond.pdf')))));
await t('contractor cannot open a restricted file', () => no(getBytes(ref(st('con'), pp('restricted/r1/bond.pdf')))));
await t('client domain opens a restricted file', () => ok(getBytes(ref(st('cli'), pp('restricted/r1/bond.pdf')))));
await t('contractor opens an ordinary document file', () => ok(getBytes(ref(st('con'), pp('docs/doc1/deed.pdf')))));
await t('a stranger cannot open a document file', () => no(getBytes(ref(st('rnd'), pp('docs/doc1/deed.pdf')))));
await t('editor cannot upload into the restricted folder', () => no(uploadBytes(ref(st('ed'), pp('restricted/r9/x.pdf')), new Uint8Array([1]))));

await env.cleanup();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
