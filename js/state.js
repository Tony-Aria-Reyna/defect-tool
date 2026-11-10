// Shared application state.
import { DEFAULTS } from './config.js';

export const S = {
  store: null, user: null, sup: false,
  project: null, role: '', plans: [], defects: [], unsub: null,
  curPlan: null, sel: null, ai: {},
  F: { q: '', block: '', level: '', unit: '', sev: '', trade: '', resp: '', sort: 'id', status: new Set(['Open', 'In progress', 'Ready for review', 'Disputed']) },
  local: (() => { try { return JSON.parse(localStorage.getItem('rd-local') || '{}'); } catch (e) { return {}; } })(),
};
export function saveLocal() { try { localStorage.setItem('rd-local', JSON.stringify(S.local)); } catch (e) {} }

export const can = {
  admin: () => S.sup || S.role === 'admin',
  edit: () => S.sup || S.role === 'admin' || S.role === 'editor',
  contractor: () => !S.sup && S.role === 'contractor',
  write: () => S.sup || ['admin', 'editor', 'contractor'].includes(S.role),
};

// Fill any list a project has not customised with the defaults.
export function withDefaults(p) {
  const o = { ...p };
  ['statuses', 'severities', 'types', 'trades', 'sources', 'responsible', 'rooms'].forEach(k => { if (!Array.isArray(o[k]) || !o[k].length) o[k] = DEFAULTS[k].slice(); });
  o.statuses = DEFAULTS.statuses.slice();   // statuses are fixed: the security rules and colours depend on them
  o.idPrefix = o.idPrefix || 'D';
  return o;
}

// Units listed in project settings, e.g. "1-42" or "G01, G02, 101-110"
export function unitList(p) {
  const out = [];
  String(p.units || '').split(/[,\n;]+/).map(s => s.trim()).filter(Boolean).forEach(t => {
    const m = /^(\D*)(\d+)\s*-\s*(\D*)(\d+)$/.exec(t);
    if (m && m[1] === m[3] && +m[4] >= +m[2] && +m[4] - +m[2] < 2000) { const w = m[2].length; for (let i = +m[2]; i <= +m[4]; i++) out.push(m[1] + (m[2].startsWith('0') ? String(i).padStart(w, '0') : i)); }
    else out.push(t);
  });
  return out;
}
