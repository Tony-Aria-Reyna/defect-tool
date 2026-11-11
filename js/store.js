const flat = pts => (pts || []).flatMap(q => Array.isArray(q) ? [+q[0], +q[1]] : [q]);
const unflat = a => Array.isArray(a) && a.length && !Array.isArray(a[0]) ? a.reduce((o, v, i) => (i % 2 ? o[o.length - 1].push(v) : o.push([v]), o), []) : a;
// Data layer. Two implementations with the same API:
//  - FirebaseStore: Google / email-link sign-in, Firestore (offline cache), Firebase Storage for plans and photos.
//  - LocalStore:    ?demo mode. Everything in this browser's IndexedDB, one local admin user. Used for testing and training.
import { firebaseConfig } from './config.js';

const lower = s => String(s || '').trim().toLowerCase();
const emailKey = e => lower(e).replace(/[^a-z0-9@._+-]/g, '');
export const isDemo = () => /[?&]demo\b/.test(location.search) || !firebaseConfig || !firebaseConfig.apiKey;

/* ------------------------------------------------------------------ Firebase */
async function firebaseStore() {
  const A = await import('../lib/firebase/firebase-app.js');
  const U = await import('../lib/firebase/firebase-auth.js');
  const F = await import('../lib/firebase/firebase-firestore.js');
  const S = await import('../lib/firebase/firebase-storage.js');
  const app = A.initializeApp(firebaseConfig);
  const auth = U.getAuth(app);
  try { await U.setPersistence(auth, U.browserLocalPersistence); } catch (e) {}
  let db;
  try { db = F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) }); }
  catch (e) { db = F.getFirestore(app); }
  const st = S.getStorage(app);
  const D = (...p) => F.doc(db, ...p), C = (...p) => F.collection(db, ...p);
  let user = null, superCache = null;
  const me = () => ({ uid: user.uid, email: lower(user.email), name: user.displayName || (user.email || '').split('@')[0] });
  // Offline-first helpers. Firestore applies writes to the local cache at once but only resolves the promise when the
  // server acknowledges; in poor coverage that can take minutes. We treat "written locally" as saved and report any
  // later rejection (for example a permission problem) as a sync warning.
  const delay = ms => new Promise(r => setTimeout(r, ms));
  const syncWarn = e => { console.warn('sync', e); try { dispatchEvent(new CustomEvent('rd-sync-error', { detail: e })); } catch (x) {} };
  const localWrite = async p => { p.catch(syncWarn); await Promise.race([p, delay(navigator.onLine ? 2500 : 50)]); };
  // Reads: server if it answers quickly, else the local cache (and the cache straight away when offline).
  const readDoc = async ref => { if (!navigator.onLine) { try { return await F.getDocFromCache(ref); } catch (e) { return await F.getDoc(ref); } } const r = await Promise.race([F.getDoc(ref), delay(4000).then(() => 'slow')]); if (r !== 'slow') return r; try { return await F.getDocFromCache(ref); } catch (e) { return await F.getDoc(ref); } };
  const readDocs = async q => { if (!navigator.onLine) { try { const s = await F.getDocsFromCache(q); if (s.size) return s; } catch (e) {} return await F.getDocs(q); } const r = await Promise.race([F.getDocs(q), delay(4000).then(() => 'slow')]); if (r !== 'slow') return r; try { const s = await F.getDocsFromCache(q); if (s.size) return s; } catch (e) {} return await F.getDocs(q); };

  const api = {
    mode: 'firebase',
    get user() { return user ? me() : null; },
    onAuth(cb) { return U.onAuthStateChanged(auth, u => { user = u; superCache = null; cb(u ? me() : null); }); },
    async signInGoogle() {
      const p = new U.GoogleAuthProvider(); p.setCustomParameters({ prompt: 'select_account' });
      try { await U.signInWithPopup(auth, p); }
      catch (e) { if (/popup-blocked|operation-not-supported|cancelled-popup/.test(e.code || '')) await U.signInWithRedirect(auth, p); else throw e; }
    },
    async sendLink(email) {
      await U.sendSignInLinkToEmail(auth, email, { url: location.origin + location.pathname, handleCodeInApp: true });
      localStorage.setItem('rd-link-email', email);
    },
    async completeLink() {
      if (!U.isSignInWithEmailLink(auth, location.href)) return false;
      let email = localStorage.getItem('rd-link-email');
      if (!email) email = prompt('Please confirm the email address you used to sign in');
      if (!email) return false;
      await U.signInWithEmailLink(auth, email, location.href);
      localStorage.removeItem('rd-link-email');
      history.replaceState(null, '', location.pathname);
      return true;
    },
    async signInPassword(email, pw) { await U.signInWithEmailAndPassword(auth, email, pw); },
    async createPassword(email, pw) { try { await U.createUserWithEmailAndPassword(auth, email, pw); } catch (e) { if ((e.code || '') === 'auth/email-already-in-use') { await U.signInWithEmailAndPassword(auth, email, pw); } else throw e; } },
    async resetPassword(email) { await U.sendPasswordResetEmail(auth, email, { url: location.origin + location.pathname }); },
    async getLibrary(name) { try { const s = await readDoc(D('library', name)); return s.exists() ? (s.data().items || []) : []; } catch (e) { return []; } },
    async addToLibrary(name, item) { await localWrite(F.setDoc(D('library', name), { items: F.arrayUnion(JSON.parse(JSON.stringify(item))), updated: new Date().toISOString() }, { merge: true })); },
    async signOut() { await U.signOut(auth); },
    async isSuper() {
      if (superCache !== null) return superCache;
      try { const s = await readDoc(D('system', 'admins')); superCache = !!(s.exists() && (s.data().uids || []).includes(user.uid)); }
      catch (e) { superCache = false; }
      return superCache;
    },
    async listProjects() {
      const sup = await api.isSuper();
      const q = sup ? C('projects') : F.query(C('projects'), F.where('memberUids', 'array-contains', user.uid));
      const s = await readDocs(q);
      return s.docs.map(d => ({ id: d.id, ...d.data() })).filter(p => !p.archived || sup);
    },
    async getProject(pid) { const s = await readDoc(D('projects', pid)); return s.exists() ? { id: s.id, ...s.data() } : null; },
    async createProject(data) {
      const ref = F.doc(C('projects'));
      const m = me();
      await F.setDoc(ref, { ...data, seq: 0, members: { [m.uid]: 'admin' }, memberUids: [m.uid], memberInfo: { [m.uid]: { name: m.name, email: m.email } }, created: new Date().toISOString(), createdBy: m.email });
      return ref.id;
    },
    async updateProject(pid, patch) { await localWrite(F.updateDoc(D('projects', pid), patch)); },
    async setMember(pid, uid, role) {
      const p = await api.getProject(pid);
      const members = { ...(p.members || {}) }, info = { ...(p.memberInfo || {}) };
      if (role) members[uid] = role; else { delete members[uid]; delete info[uid]; }
      await F.updateDoc(D('projects', pid), { members, memberInfo: info, memberUids: Object.keys(members) });
    },
    // Invitations live in a top-level collection, id = <projectId>_<email>, so a new user can find theirs.
    async listInvites(pid) { const s = await F.getDocs(F.query(C('invites'), F.where('pid', '==', pid))); return s.docs.map(d => ({ id: d.id, ...d.data() })); },
    async invite(pid, email, role, projectName) { const e = emailKey(email); await F.setDoc(D('invites', pid + '_' + e), { pid, email: e, role, projectName: projectName || '', by: me().email, at: new Date().toISOString() }); },
    async cancelInvite(pid, email) { await F.deleteDoc(D('invites', pid + '_' + emailKey(email))); },
    // A signed-in user accepts every invitation addressed to their verified email address.
    async claimInvites() {
      if (!user.email || !user.emailVerified || !navigator.onLine) return 0;
      const m = me();
      const s = await F.getDocs(F.query(C('invites'), F.where('email', '==', m.email)));
      let n = 0;
      for (const d of s.docs) {
        const { pid, role } = d.data();
        try {
          await F.updateDoc(D('projects', pid), { [`members.${m.uid}`]: role, memberUids: F.arrayUnion(m.uid), [`memberInfo.${m.uid}`]: { name: m.name, email: m.email } });
          await F.deleteDoc(d.ref); n++;
        } catch (e) { console.warn('invite claim failed', pid, e); }
      }
      return n;
    },
    // Firestore does not allow arrays inside arrays, so boundary polygons, face paths and grid maps are stored flat [x0,y0,x1,y1,...]
    async listPlans(pid) { const s = await readDocs(C('projects', pid, 'plans')); return s.docs.map(d => { const p = { id: d.id, ...d.data() }; p.zones = (p.zones || []).map(z => ({ ...z, poly: unflat(z.poly) })); if (Array.isArray(p.links)) p.links = p.links.map(l => ({ ...l, path: l.path ? unflat(l.path) : l.path, gmap: l.gmap ? unflat(l.gmap) : l.gmap })); return p; }); },
    async savePlan(pid, plan) { const { id, ...rest } = plan; rest.zones = (rest.zones || []).map(z => ({ ...Object.fromEntries(Object.entries(z).filter(([k]) => !k.startsWith('_'))), poly: flat(z.poly) })); if (Array.isArray(rest.links)) rest.links = rest.links.map(l => ({ ...l, path: l.path ? flat(l.path) : null, gmap: l.gmap ? flat(l.gmap) : null })); await localWrite(F.setDoc(D('projects', pid, 'plans', id), JSON.parse(JSON.stringify(rest)))); },
    async deletePlan(pid, id) { await F.deleteDoc(D('projects', pid, 'plans', id)); },
    async putFile(path, blob, patient) { if (!navigator.onLine && !patient) throw new Error('offline'); const r = S.ref(st, path); const up = S.uploadBytesResumable(r, blob, { contentType: blob.type || 'image/jpeg' }); const done = new Promise((res, rej) => up.on('state_changed', null, rej, res)); if (!patient) { const w = await Promise.race([done, delay(15000).then(() => 'slow')]); if (w === 'slow') { try { up.cancel(); } catch (e) {} throw new Error('slow'); } } else await done; return await S.getDownloadURL(r); },
    async deleteFile(path) { try { await S.deleteObject(S.ref(st, path)); } catch (e) {} },
    async resolveUrl(u) { return u; },
    watchDefects(pid, cb, onErr) {
      return F.onSnapshot(C('projects', pid, 'defects'), s => cb(s.docs.map(d => ({ ...d.data(), id: d.id })), s.metadata), e => onErr && onErr(e));
    },
    async createDefect(pid, d) { const { id, ...rest } = d; await localWrite(F.setDoc(D('projects', pid, 'defects', id), JSON.parse(JSON.stringify(rest)))); },
    // Only the changed fields are written, and history entries are appended, so two people editing
    // the same item do not overwrite each other's comments.
    async updateDefect(pid, id, patch, newHistory) {
      const p = { ...patch }; delete p.id; delete p.history;
      if (newHistory && newHistory.length) p.history = F.arrayUnion(...newHistory);
      await localWrite(F.updateDoc(D('projects', pid, 'defects', id), p));
    },
    async deleteDefect(pid, id) { await localWrite(F.deleteDoc(D('projects', pid, 'defects', id))); },
    // a deleted defect that was the latest number hands that number back, so the next one does not leave a gap
    async releaseRef(pid, n, highestLeft) { try { await Promise.race([F.runTransaction(db, async t => { const s = await t.get(D('projects', pid)); if ((s.data().seq || 0) === n) t.update(D('projects', pid), { seq: highestLeft }); }), delay(5000)]); } catch (e) {} },
    async nextRef(pid, prefix, localNext) {
      const offline = async () => { const n = localNext ? localNext() : 0; if (n) { localWrite(F.updateDoc(D('projects', pid), { seq: F.increment(1) })); return (prefix || 'D') + '-' + String(n).padStart(3, '0'); } return (prefix || 'D') + '-' + Date.now().toString(36).slice(-5).toUpperCase(); };
      if (!navigator.onLine) return offline();
      try {
        const n = await Promise.race([F.runTransaction(db, async t => { const s = await t.get(D('projects', pid)); const v = (s.data().seq || 0) + 1; t.update(D('projects', pid), { seq: v }); return v; }), delay(5000).then(() => 0)]);
        return n ? (prefix || 'D') + '-' + String(n).padStart(3, '0') : offline();
      } catch (e) { return offline(); }
    },
    async getPrivate(pid) { try { const s = await readDoc(D('projects', pid, 'private', 'ai')); return s.exists() ? s.data() : {}; } catch (e) { return {}; } },
    async setPrivate(pid, data) { await F.setDoc(D('projects', pid, 'private', 'ai'), data, { merge: true }); },
    // generic project collections used by the FM modules (assets, docs, tasks, systems)
    watchColl(pid, coll, cb, onErr) { return F.onSnapshot(C('projects', pid, coll), s => cb(s.docs.map(d => ({ ...d.data(), id: d.id }))), e => onErr && onErr(e)); },
    async saveItem(pid, coll, o) { const { id, ...rest } = o; await localWrite(F.setDoc(D('projects', pid, coll, id), JSON.parse(JSON.stringify(rest)))); },
    async patchItem(pid, coll, id, patch, newHistory) { const p = { ...patch }; delete p.id; if (newHistory && newHistory.length) p.history = F.arrayUnion(...newHistory); await localWrite(F.updateDoc(D('projects', pid, coll, id), p)); },
    async deleteItem(pid, coll, id) { await localWrite(F.deleteDoc(D('projects', pid, coll, id))); },
    async bulkSave(pid, coll, list, onProgress) { for (let i = 0; i < list.length; i += 400) { const b = F.writeBatch(db); list.slice(i, i + 400).forEach(o => { const { id, ...rest } = o; b.set(D('projects', pid, coll, id), JSON.parse(JSON.stringify(rest))); }); await b.commit(); onProgress && onProgress(Math.min(i + 400, list.length)); } },
    async bulkCreate(pid, list, onProgress) {
      for (let i = 0; i < list.length; i += 400) {
        const b = F.writeBatch(db);
        list.slice(i, i + 400).forEach(d => { const { id, ...rest } = d; b.set(D('projects', pid, 'defects', id), JSON.parse(JSON.stringify(rest))); });
        await b.commit(); onProgress && onProgress(Math.min(i + 400, list.length));
      }
    },
  };
  // finish a redirect sign-in if one is in progress
  try { await U.getRedirectResult(auth); } catch (e) { console.warn(e); }
  return api;
}

/* ------------------------------------------------------------------ Local (demo) */
async function localStore(dbName, asUser) {
  const db = await new Promise((res, rej) => { const r = indexedDB.open(dbName || 'resero-defects-demo', 1); r.onupgradeneeded = () => { r.result.createObjectStore('docs'); r.result.createObjectStore('files'); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const rq = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const os = (s, m) => db.transaction(s, m || 'readonly').objectStore(s);
  const get = k => rq(os('docs').get(k)), put = (k, v) => rq(os('docs', 'readwrite').put(JSON.parse(JSON.stringify(v)), k)), del = k => rq(os('docs', 'readwrite').delete(k));
  async function list(prefix) { const keys = await rq(os('docs').getAllKeys()); const out = []; for (const k of keys) if (k.startsWith(prefix) && !k.slice(prefix.length).includes('/')) out.push({ id: k.slice(prefix.length), ...(await get(k)) }); return out; }
  const user = asUser || { uid: 'local-user', email: 'demo@example.com', name: 'Demo user' };
  let authCb = null; const watchers = {}; const urlCache = {};
  const signed = () => localStorage.getItem('rd-demo-signed') === '1';
  const emitC = async (pid, coll) => { const l = await list(`projects/${pid}/${coll}/`); (watchers[pid + '/' + coll] || []).forEach(cb => cb(l)); };
  const emit = async pid => { const l = await list(`projects/${pid}/defects/`); (watchers[pid] || []).forEach(cb => cb(l, {})); };
  const api = {
    mode: asUser ? 'test' : 'demo',
    get user() { return asUser ? user : (signed() ? user : null); },
    async wipe() { db.close(); await new Promise(res => { const r = indexedDB.deleteDatabase(dbName || 'resero-defects-demo'); r.onsuccess = r.onerror = r.onblocked = () => res(); }); },
    async seed(k, v) { await put(k, v); },
    onAuth(cb) { authCb = cb; setTimeout(() => cb(signed() ? user : null), 0); return () => {}; },
    async signInGoogle() { localStorage.setItem('rd-demo-signed', '1'); authCb && authCb(user); },
    async getLibrary(name) { return (await get('library/' + name)) || []; }, async addToLibrary(name, item) { const L = (await get('library/' + name)) || []; L.push(item); await put('library/' + name, L); },
    async sendLink() { await api.signInGoogle(); }, async signInPassword() { await api.signInGoogle(); }, async createPassword() { await api.signInGoogle(); }, async resetPassword() {},
    async completeLink() { return false; },
    async signOut() { localStorage.removeItem('rd-demo-signed'); authCb && authCb(null); },
    async isSuper() { return !asUser; },
    async listProjects() { return list('projects/'); },
    async getProject(pid) { const p = await get('projects/' + pid); return p ? { id: pid, ...p } : null; },
    async createProject(data) { const id = 'p' + Date.now().toString(36); await put('projects/' + id, { ...data, seq: 0, members: { [user.uid]: 'admin' }, memberUids: [user.uid], memberInfo: { [user.uid]: { name: user.name, email: user.email } }, created: new Date().toISOString() }); return id; },
    async updateProject(pid, patch) { const p = await get('projects/' + pid); await put('projects/' + pid, { ...p, ...patch }); },
    async setMember(pid, uid, role) { const p = await get('projects/' + pid); if (role) p.members[uid] = role; else { delete p.members[uid]; delete (p.memberInfo || {})[uid]; } p.memberUids = Object.keys(p.members); await put('projects/' + pid, p); },
    async listInvites(pid) { return list(`projects/${pid}/invites/`); },
    async invite(pid, email, role, projectName) { const e = emailKey(email); await put(`projects/${pid}/invites/${e}`, { email: e, role, projectName, by: user.email, at: new Date().toISOString() }); },
    async cancelInvite(pid, email) { await del(`projects/${pid}/invites/${emailKey(email)}`); },
    async claimInvites() { return 0; },
    async listPlans(pid) { return (await list(`projects/${pid}/plans/`)).sort((a, b) => (a.order || 0) - (b.order || 0)); },
    async savePlan(pid, plan) { const { id, ...rest } = plan; await put(`projects/${pid}/plans/${id}`, rest); },
    async deletePlan(pid, id) { await del(`projects/${pid}/plans/${id}`); },
    async putFile(path, blob) { await rq(os('files', 'readwrite').put(blob, path)); delete urlCache[path]; return 'local:' + path; },
    async deleteFile(path) { await rq(os('files', 'readwrite').delete(path)); },
    async resolveUrl(u) {
      if (!u || !u.startsWith('local:')) return u;
      const p = u.slice(6); if (urlCache[p]) return urlCache[p];
      const b = await rq(os('files').get(p)); return (urlCache[p] = b ? URL.createObjectURL(b) : '');
    },
    watchDefects(pid, cb) { (watchers[pid] = watchers[pid] || []).push(cb); emit(pid); return () => { watchers[pid] = (watchers[pid] || []).filter(x => x !== cb); }; },
    async createDefect(pid, d) { const { id, ...rest } = d; await put(`projects/${pid}/defects/${id}`, rest); emit(pid); },
    async updateDefect(pid, id, patch, newHistory) { const k = `projects/${pid}/defects/${id}`; const d = (await get(k)) || {}; const p = { ...patch }; delete p.id; delete p.history; const h = (d.history || []).concat(newHistory || []); await put(k, { ...d, ...p, history: h }); emit(pid); },
    async deleteDefect(pid, id) { await del(`projects/${pid}/defects/${id}`); emit(pid); },
    async releaseRef(pid, n, highestLeft) { const p = await get('projects/' + pid); if ((p.seq || 0) === n) { p.seq = highestLeft; await put('projects/' + pid, p); } },
    async nextRef(pid, prefix) { const p = await get('projects/' + pid); p.seq = (p.seq || 0) + 1; await put('projects/' + pid, p); return (prefix || 'D') + '-' + String(p.seq).padStart(3, '0'); },
    async getPrivate(pid) { return (await get(`projects/${pid}/private/ai`)) || {}; },
    async setPrivate(pid, data) { const k = `projects/${pid}/private/ai`; await put(k, { ...((await get(k)) || {}), ...data }); },
    watchColl(pid, coll, cb) { const k = pid + '/' + coll; (watchers[k] = watchers[k] || []).push(cb); emitC(pid, coll); return () => { watchers[k] = (watchers[k] || []).filter(x => x !== cb); }; },
    async saveItem(pid, coll, o) { const { id, ...rest } = o; await put(`projects/${pid}/${coll}/${id}`, rest); emitC(pid, coll); },
    async patchItem(pid, coll, id, patch, newHistory) { const k = `projects/${pid}/${coll}/${id}`; const d = (await get(k)) || {}; const p = { ...patch }; delete p.id; if (newHistory && newHistory.length) p.history = (d.history || []).concat(newHistory); await put(k, { ...d, ...p }); emitC(pid, coll); },
    async deleteItem(pid, coll, id) { await del(`projects/${pid}/${coll}/${id}`); emitC(pid, coll); },
    async bulkSave(pid, coll, list, onProgress) { for (let i = 0; i < list.length; i++) { const { id, ...rest } = list[i]; await put(`projects/${pid}/${coll}/${id}`, rest); if (i % 20 === 0) onProgress && onProgress(i); } emitC(pid, coll); },
    async bulkCreate(pid, list, onProgress) { for (let i = 0; i < list.length; i++) { const { id, ...rest } = list[i]; await put(`projects/${pid}/defects/${id}`, rest); if (i % 20 === 0) onProgress && onProgress(i); } emit(pid); },
  };
  return api;
}

export async function createStore() { return isDemo() ? localStore() : firebaseStore(); }
// Test mode: a throwaway copy of one project in a local sandbox store. Nothing written here reaches the cloud.
export async function createSandbox(real, pid, role, onProgress) {
  const user = { ...real.user, uid: 'test-' + real.user.uid };
  const sb = await localStore('resero-defects-test', user); await sb.wipe();
  const sb2 = await localStore('resero-defects-test', user);
  const p = await real.getProject(pid); onProgress && onProgress('project');
  await sb2.seed('projects/' + pid, { ...p, members: { ...(p.members || {}), [user.uid]: role }, memberUids: [...(p.memberUids || []), user.uid], memberInfo: { ...(p.memberInfo || {}), [user.uid]: { name: user.name + ' (test)', email: user.email } } });
  for (const pl of await real.listPlans(pid)) { const { id, ...rest } = pl; await sb2.seed(`projects/${pid}/plans/${id}`, rest); } onProgress && onProgress('plans');
  const defs = await new Promise(res => { let off = null; off = real.watchDefects(pid, L => { off && off(); res(L); }, () => res([])); });
  for (const d of defs) { const { id, ...rest } = d; await sb2.seed(`projects/${pid}/defects/${id}`, rest); } onProgress && onProgress('defects');
  for (const coll of ['assets', 'systems', 'docs', 'tasks', 'contacts']) { const L = await new Promise(res => { let off = null; off = real.watchColl(pid, coll, x => { off && off(); res(x); }, () => res([])); }); for (const d of L) { const { id, ...rest } = d; await sb2.seed(`projects/${pid}/${coll}/${id}`, rest); } }
  try { await sb2.seed(`projects/${pid}/private/ai`, await real.getPrivate(pid)); } catch (e) {}
  onProgress && onProgress('done');
  sb2.resolveUrl = async u => (u && u.startsWith('local:')) ? '' : u;   // photos and plans are read from the cloud as usual
  return sb2;
}
