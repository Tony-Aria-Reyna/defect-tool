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
    async signOut() { await U.signOut(auth); },
    async isSuper() {
      if (superCache !== null) return superCache;
      try { const s = await F.getDoc(D('system', 'admins')); superCache = !!(s.exists() && (s.data().uids || []).includes(user.uid)); }
      catch (e) { superCache = false; }
      return superCache;
    },
    async listProjects() {
      const sup = await api.isSuper();
      const q = sup ? C('projects') : F.query(C('projects'), F.where('memberUids', 'array-contains', user.uid));
      const s = await F.getDocs(q);
      return s.docs.map(d => ({ id: d.id, ...d.data() })).filter(p => !p.archived || sup);
    },
    async getProject(pid) { const s = await F.getDoc(D('projects', pid)); return s.exists() ? { id: s.id, ...s.data() } : null; },
    async createProject(data) {
      const ref = F.doc(C('projects'));
      const m = me();
      await F.setDoc(ref, { ...data, seq: 0, members: { [m.uid]: 'admin' }, memberUids: [m.uid], memberInfo: { [m.uid]: { name: m.name, email: m.email } }, created: new Date().toISOString(), createdBy: m.email });
      return ref.id;
    },
    async updateProject(pid, patch) { await F.updateDoc(D('projects', pid), patch); },
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
      if (!user.email || !user.emailVerified) return 0;
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
    async listPlans(pid) { const s = await F.getDocs(C('projects', pid, 'plans')); return s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.order || 0) - (b.order || 0)); },
    async savePlan(pid, plan) { const { id, ...rest } = plan; await F.setDoc(D('projects', pid, 'plans', id), rest); },
    async deletePlan(pid, id) { await F.deleteDoc(D('projects', pid, 'plans', id)); },
    async putFile(path, blob) { const r = S.ref(st, path); await S.uploadBytes(r, blob, { contentType: blob.type || 'image/jpeg' }); return await S.getDownloadURL(r); },
    async deleteFile(path) { try { await S.deleteObject(S.ref(st, path)); } catch (e) {} },
    async resolveUrl(u) { return u; },
    watchDefects(pid, cb, onErr) {
      return F.onSnapshot(C('projects', pid, 'defects'), s => cb(s.docs.map(d => ({ ...d.data(), id: d.id })), s.metadata), e => onErr && onErr(e));
    },
    async createDefect(pid, d) { const { id, ...rest } = d; await F.setDoc(D('projects', pid, 'defects', id), rest); },
    // Only the changed fields are written, and history entries are appended, so two people editing
    // the same item do not overwrite each other's comments.
    async updateDefect(pid, id, patch, newHistory) {
      const p = { ...patch }; delete p.id; delete p.history;
      if (newHistory && newHistory.length) p.history = F.arrayUnion(...newHistory);
      await F.updateDoc(D('projects', pid, 'defects', id), p);
    },
    async deleteDefect(pid, id) { await F.deleteDoc(D('projects', pid, 'defects', id)); },
    async nextRef(pid, prefix) {
      try {
        const n = await F.runTransaction(db, async t => { const s = await t.get(D('projects', pid)); const v = (s.data().seq || 0) + 1; t.update(D('projects', pid), { seq: v }); return v; });
        return (prefix || 'D') + '-' + String(n).padStart(3, '0');
      } catch (e) { return (prefix || 'D') + '-' + Date.now().toString(36).slice(-5).toUpperCase(); } // offline: unique temporary reference
    },
    async getPrivate(pid) { try { const s = await F.getDoc(D('projects', pid, 'private', 'ai')); return s.exists() ? s.data() : {}; } catch (e) { return {}; } },
    async setPrivate(pid, data) { await F.setDoc(D('projects', pid, 'private', 'ai'), data, { merge: true }); },
    // generic project collections used by the FM modules (assets, docs, tasks, systems)
    watchColl(pid, coll, cb, onErr) { return F.onSnapshot(C('projects', pid, coll), s => cb(s.docs.map(d => ({ ...d.data(), id: d.id }))), e => onErr && onErr(e)); },
    async saveItem(pid, coll, o) { const { id, ...rest } = o; await F.setDoc(D('projects', pid, coll, id), rest); },
    async patchItem(pid, coll, id, patch, newHistory) { const p = { ...patch }; delete p.id; if (newHistory && newHistory.length) p.history = F.arrayUnion(...newHistory); await F.updateDoc(D('projects', pid, coll, id), p); },
    async deleteItem(pid, coll, id) { await F.deleteDoc(D('projects', pid, coll, id)); },
    async bulkSave(pid, coll, list, onProgress) { for (let i = 0; i < list.length; i += 400) { const b = F.writeBatch(db); list.slice(i, i + 400).forEach(o => { const { id, ...rest } = o; b.set(D('projects', pid, coll, id), rest); }); await b.commit(); onProgress && onProgress(Math.min(i + 400, list.length)); } },
    async bulkCreate(pid, list, onProgress) {
      for (let i = 0; i < list.length; i += 400) {
        const b = F.writeBatch(db);
        list.slice(i, i + 400).forEach(d => { const { id, ...rest } = d; b.set(D('projects', pid, 'defects', id), rest); });
        await b.commit(); onProgress && onProgress(Math.min(i + 400, list.length));
      }
    },
  };
  // finish a redirect sign-in if one is in progress
  try { await U.getRedirectResult(auth); } catch (e) { console.warn(e); }
  return api;
}

/* ------------------------------------------------------------------ Local (demo) */
async function localStore() {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('resero-defects-demo', 1); r.onupgradeneeded = () => { r.result.createObjectStore('docs'); r.result.createObjectStore('files'); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const rq = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const os = (s, m) => db.transaction(s, m || 'readonly').objectStore(s);
  const get = k => rq(os('docs').get(k)), put = (k, v) => rq(os('docs', 'readwrite').put(JSON.parse(JSON.stringify(v)), k)), del = k => rq(os('docs', 'readwrite').delete(k));
  async function list(prefix) { const keys = await rq(os('docs').getAllKeys()); const out = []; for (const k of keys) if (k.startsWith(prefix) && !k.slice(prefix.length).includes('/')) out.push({ id: k.slice(prefix.length), ...(await get(k)) }); return out; }
  const user = { uid: 'local-user', email: 'demo@example.com', name: 'Demo user' };
  let authCb = null; const watchers = {}; const urlCache = {};
  const signed = () => localStorage.getItem('rd-demo-signed') === '1';
  const emitC = async (pid, coll) => { const l = await list(`projects/${pid}/${coll}/`); (watchers[pid + '/' + coll] || []).forEach(cb => cb(l)); };
  const emit = async pid => { const l = await list(`projects/${pid}/defects/`); (watchers[pid] || []).forEach(cb => cb(l, {})); };
  const api = {
    mode: 'demo',
    get user() { return signed() ? user : null; },
    onAuth(cb) { authCb = cb; setTimeout(() => cb(signed() ? user : null), 0); return () => {}; },
    async signInGoogle() { localStorage.setItem('rd-demo-signed', '1'); authCb && authCb(user); },
    async sendLink() { await api.signInGoogle(); },
    async completeLink() { return false; },
    async signOut() { localStorage.removeItem('rd-demo-signed'); authCb && authCb(null); },
    async isSuper() { return true; },
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
