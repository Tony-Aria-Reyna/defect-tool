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

// "View as" lets an admin test the app as another role (client-side only; the server rules still apply to the real role).
const R = () => S.viewAs || S.role, SUP = () => !S.viewAs && S.sup;
export const can = {
  admin: () => SUP() || R() === 'admin',
  edit: () => SUP() || R() === 'admin' || R() === 'editor',
  contractor: () => !SUP() && R() === 'contractor',
  write: () => SUP() || ['admin', 'editor', 'contractor'].includes(R()),
  realAdmin: () => S.sup || S.role === 'admin',
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

// Severity / category scheme. A project may rename the field (for example "Category" when a consultant's A-D scheme is adopted),
// say which values count as serious (shown as the headline count and exported as high priority) and which is the default for new items.
export const sevLabel = p => (p && p.sevLabel) || 'Severity';
export const sevMajorList = p => (p && Array.isArray(p.sevMajor) && p.sevMajor.length) ? p.sevMajor : ((p && p.severities) || []).filter(s => /^Major/.test(s));
export const isMajor = (d, p) => sevMajorList(p || S.project).includes(d.severity || '') || /^Major/.test(d.severity || '');
export const sevDefault = p => (p.sevDefault && p.severities.includes(p.sevDefault)) ? p.sevDefault : (p.severities.includes('Minor defect') ? 'Minor defect' : p.severities[0]);
export const sevCode = s => { const m = /^([A-Za-z0-9]{1,2})\s*[-:.]\s/.exec(String(s || '')); return m ? m[1].toUpperCase() : ''; };
// Find the project's value for a severity or category written another way ("C", "C - Rework", "Major - prevents PC").
export function sevMatch(p, v) {
  const t = String(v || '').trim(); if (!t) return ''; const L = p.severities; if (L.includes(t)) return t;
  const lc = t.toLowerCase(), ex = L.find(s => s.toLowerCase() === lc); if (ex) return ex;
  const c = sevCode(t) || (/^[A-Za-z]$/.test(t) ? t.toUpperCase() : ''); if (c) { const h = L.find(s => sevCode(s) === c); if (h) return h; }
  if (/^Major/i.test(t)) return sevMajorList(p)[0] || ''; return '';
}

// Items from the contractor's own registers (sources listed in the project's selfCloseSources) can be closed by the contractor.
// Everything else a contractor finishes goes to Ready for review for the project team to inspect.
export const selfClose = d => !!(S.project && (S.project.selfCloseSources || []).includes(d.source || ''));
