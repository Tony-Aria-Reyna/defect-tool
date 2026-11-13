// Resero Defects - Gemini helper (Google Apps Script). Same pattern as Family Screen:
// the Gemini key lives in Script properties, never in the app or on GitHub.
// Setup: script.google.com > New project > paste this > change KEY below to any long random code >
// Project Settings > Script properties > add GEMINI_KEY = your key from aistudio.google.com >
// Deploy > New deployment > Web app > Execute as: Me, Who has access: Anyone > copy the /exec address.
// In the app: menu > Gemini > Helper web address = that address, Helper key = the KEY below.
const KEY = 'change-me-to-a-long-random-code';
function doPost(e) {
  const out = o => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
  let b; try { b = JSON.parse(e.postData.contents); } catch (x) { return out({ error: 'bad request' }); }
  if (b.key !== KEY) return out({ error: 'not allowed · helper key ends ' + KEY.slice(-4) });
  const props = PropertiesService.getScriptProperties();
  if (b.action === 'ping') return out({ ok: true, hasKey: !!props.getProperty('GEMINI_KEY') });
  // ---- contractor's register kept as a Google Sheet (columns Unit | Description | Contractor | Interior/Exterior? | Completed) ----
  // The sheet is fixed by the first link (Script property REGISTER_SHEET); to point at another sheet, change that property here.
  if (b.action === 'sheetLink') {
    const m = /\/d\/([a-zA-Z0-9_-]{20,})/.exec(String(b.url || '')), id = m ? m[1] : String(b.url || '').trim(), cur = props.getProperty('REGISTER_SHEET');
    if (cur && cur !== id) return out({ error: 'This helper is already linked to another sheet. Change REGISTER_SHEET in the script properties to move it.' });
    try { const ss = SpreadsheetApp.openById(id); props.setProperty('REGISTER_SHEET', id); return out({ ok: true, name: ss.getName(), rows: ss.getSheets()[0].getLastRow(), url: ss.getUrl() }); }
    catch (x) { return out({ error: 'Cannot open that sheet: ' + x.message }); }
  }
  if (b.action === 'sheetRead' || b.action === 'sheetWrite') {
    const id = props.getProperty('REGISTER_SHEET'); if (!id) return out({ error: 'nosheet' });
    let sh; try { sh = SpreadsheetApp.openById(id).getSheets()[0]; } catch (x) { return out({ error: 'Cannot open the register sheet: ' + x.message }); }
    if (b.action === 'sheetRead') { const n = sh.getLastRow(); return out({ ok: true, name: sh.getParent().getName(), rows: n ? sh.getRange(1, 1, n, 5).getDisplayValues() : [] }); }
    const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
    const lock = LockService.getScriptLock(); lock.waitLock(20000); let set = 0, skipped = 0, added = 0;
    try {
      (b.set || []).forEach(c => { if (norm(sh.getRange(c.row, 2).getDisplayValue()) !== norm(c.desc)) { skipped++; return; } sh.getRange(c.row, 5).setValue(c.value); set++; });   // only if the row is still the same item
      const rows = (b.append || []).map(r => r.slice(0, 5));
      if (rows.length) { const start = sh.getLastRow() + 1; sh.getRange(start, 1, rows.length, 5).setValues(rows); try { sh.getRange(b.styleRow || start - 1, 1, 1, 5).copyTo(sh.getRange(start, 1, rows.length, 5), { formatOnly: true }); } catch (x) {} added = rows.length; }
    } finally { lock.releaseLock(); }
    return out({ ok: true, set, skipped, added });
  }
  // ---- daily summary email: who gets it and when is set from the app ----
  if (b.action === 'summaryGet') { try { return out({ ok: true, cfg: summaryConfig_() }); } catch (x) { return out({ error: 'Summary needs authorising: run authoriseHelper in the script editor (' + x.message + ')' }); } }
  if (b.action === 'summarySet') { try { return out({ ok: true, cfg: summarySet_(b) }); } catch (x) { return out({ error: 'Could not save the summary settings: ' + x.message }); } }
  if (b.action === 'summaryTest') { try { const to = (b.to || []).map(x => String(x).trim()).filter(x => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)).slice(0, 5); return out({ ok: true, stats: summaryRun_(to, true), to: to }); } catch (x) { return out({ error: 'Could not send the test: ' + x.message }); } }
  const gk = props.getProperty('GEMINI_KEY'); if (!gk) return out({ error: 'nokey' });
  const parts = [{ text: String(b.prompt || '').slice(0, 60000) }];
  if (b.file && b.file.data) parts.push({ inline_data: { mime_type: b.file.mime || 'image/jpeg', data: b.file.data } });
  const call = model => UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', { method: 'post', contentType: 'application/json', headers: { 'x-goog-api-key': gk }, muteHttpExceptions: true,
    payload: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseMimeType: 'application/json', temperature: 0.2 } }) });
  let model = props.getProperty('GEMINI_MODEL') || 'gemini-3.6-flash', r = call(model);
  if (r.getResponseCode() === 404) {   // model retired: pick the newest Flash model this key can use
    const list = JSON.parse(UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': gk }, muteHttpExceptions: true }).getContentText()).models || [];
    const ok = list.filter(m => (m.supportedGenerationMethods || []).indexOf('generateContent') >= 0 && /gemini-[\d.]+-flash$/.test(m.name)).map(m => m.name.replace('models/', '')).sort((a, b) => parseFloat(b.split('-')[1]) - parseFloat(a.split('-')[1]));
    if (ok.length) { model = ok[0]; props.setProperty('GEMINI_MODEL', model); r = call(model); }
  }
  const j = JSON.parse(r.getContentText() || '{}');
  if (r.getResponseCode() !== 200) return out({ error: (j.error && j.error.message) || ('Gemini ' + r.getResponseCode()) });
  const t = (((j.candidates || [])[0] || {}).content || {}).parts || [];
  return out({ ok: true, model, text: t.map(p => p.text || '').join('') });
}

// ================= Daily register summary (email) =================
// Reads the register Google Sheet each afternoon, compares it with the previous day's snapshot and emails a summary:
// what was added, what was completed, what each subcontractor still has open, and a suggested way to tackle it.
// Run sendSummaryTest once (goes to SUMMARY_TEST_TO only), then setupDailySummary to switch on the daily email.
const SUMMARY_TZ = 'Pacific/Auckland';
const APP_URL = 'https://tony-aria-reyna.github.io/defect-tool/';
const ALL_SCOPES = ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/script.send_mail', 'https://www.googleapis.com/auth/script.scriptapp', 'https://www.googleapis.com/auth/script.external_request'];
// Who gets the summary and when is set from the app (menu > Update the contractor's spreadsheet > Daily summary email) and kept in Script properties.
function summaryConfig_() { const p = PropertiesService.getScriptProperties(); let to = []; try { to = JSON.parse(p.getProperty('SUMMARY_TO') || '[]'); } catch (e) {} return { to: to, hour: parseInt(p.getProperty('SUMMARY_HOUR') || '16', 10), on: ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'dailySummary') }; }
function summarySet_(b) { const p = PropertiesService.getScriptProperties(); const to = (b.to || []).map(x => String(x).trim().toLowerCase()).filter(x => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)).slice(0, 20); const hour = Math.max(0, Math.min(23, parseInt(b.hour == null ? 16 : b.hour, 10) || 0)); p.setProperty('SUMMARY_TO', JSON.stringify(to)); p.setProperty('SUMMARY_HOUR', String(hour)); ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'dailySummary').forEach(t => ScriptApp.deleteTrigger(t)); if (b.on && to.length) ScriptApp.newTrigger('dailySummary').timeBased().everyDays(1).atHour(hour).nearMinute(0).inTimezone(SUMMARY_TZ).create(); return summaryConfig_(); }

function registerRows_(values) {
  const rows = [];
  for (let i = 0; i < values.length; i++) {
    const a = String(values[i][0] || '').trim(), b = String(values[i][1] || '').trim();
    if (!a || !b || /^(unit|project:?|job no\.?|access:?|date:?)$/i.test(a) || /pre-settlement inspection/i.test(b)) continue;
    const e = String(values[i][4] || '').trim();
    rows.push({ row: i + 1, unit: a, desc: b, sub: String(values[i][2] || '').trim(), ie: String(values[i][3] || '').trim(), done: /^(y|yes|completed?|done|x)$/i.test(e) });
  }
  return rows;
}
function rowKey_(r) { const s = (r.unit + '|' + r.desc).toLowerCase().replace(/[^a-z0-9|]+/g, ' ').replace(/\s+/g, ' ').trim(); let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36); }
// prev = { key: 1 (done) | 0 (open) } from the last summary, or null the first time. Returns { subject, html, snapshot, stats }.
function buildSummary_(rows, prev, opt) {
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const unitLabel = u => /^\d+$/.test(u) ? 'Unit ' + u : u, natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });
  const snapshot = {}, seen = {}; rows.forEach(r => { let k = rowKey_(r); seen[k] = (seen[k] || 0) + 1; if (seen[k] > 1) k += '~' + seen[k]; r.key = k; snapshot[k] = r.done ? 1 : 0; });
  const open = rows.filter(r => !r.done), done = rows.filter(r => r.done);
  const added = prev ? rows.filter(r => !(r.key in prev)) : [], closed = prev ? rows.filter(r => r.done && prev[r.key] === 0) : [], reopened = prev ? rows.filter(r => !r.done && prev[r.key] === 1) : [];
  // subcontractors: merge spelling by lower case, split "A / B" so each firm sees its share
  const subs = {}; const subName = {};
  open.forEach(r => { const parts = (r.sub || 'Not assigned').split('/').map(x => x.trim()).filter(Boolean); (parts.length ? parts : ['Not assigned']).forEach(n => { const k = n.toLowerCase(), caps = x => (x.match(/[A-Z]/g) || []).length; if (!subName[k] || caps(n) > caps(subName[k])) subName[k] = n; const o = subs[k] = subs[k] || { n: 0, units: {}, int: 0, ext: 0 }; o.n++; o.units[r.unit] = (o.units[r.unit] || 0) + 1; if (/^ext/i.test(r.ie)) o.ext++; else o.int++; }); });
  const subList = Object.keys(subs).map(k => ({ name: subName[k], n: subs[k].n, units: Object.keys(subs[k].units).sort(natural), unitCount: subs[k].units, int: subs[k].int, ext: subs[k].ext })).sort((a, b) => b.n - a.n);
  const byUnit = {}; rows.forEach(r => { const o = byUnit[r.unit] = byUnit[r.unit] || { open: 0, total: 0 }; o.total++; if (!r.done) o.open++; });
  const units = Object.keys(byUnit).filter(u => /^\d+$/.test(u)), unitsDone = units.filter(u => byUnit[u].open === 0), nearly = units.filter(u => byUnit[u].open > 0 && byUnit[u].open <= 2).sort(natural), heavy = units.filter(u => byUnit[u].open > 0).sort((a, b) => byUnit[b].open - byUnit[a].open).slice(0, 6);
  const whereText = U => { const nums = U.filter(u => /^\d+$/.test(u)), other = U.filter(u => !/^\d+$/.test(u)); return [nums.length ? (nums.length === 1 ? 'Unit ' : 'Units ') + nums.slice(0, 24).join(', ') + (nums.length > 24 ? ' +' + (nums.length - 24) + ' more' : '') : '', other.join(', ')].filter(Boolean).join('; '); };
  const pct = rows.length ? Math.round(100 * done.length / rows.length) : 0;
  const link = (href, text) => '<a href="' + esc(href) + '" style="color:#0b63c5;text-decoration:none">' + text + '</a>';
  const appSub = n => (opt.app || '') + '#sub=' + encodeURIComponent(n), appUnit = u => (opt.app || '') + '#unit=' + encodeURIComponent(u), rowLink = r => (opt.url || '').replace(/[#?].*$/, '') + '#gid=' + (opt.gid || 0) + '&range=A' + r.row + ':E' + r.row;
  // three short pointers, from the numbers only
  const plan = [], named = subList.filter(s => s.name !== 'Not assigned'), top = named[0], quick = named.filter(s => s.n <= 3);
  if (top) plan.push('<b>' + esc(top.name) + '</b> holds ' + top.n + ' of ' + open.length + ' open (' + Math.round(100 * top.n / Math.max(1, open.length)) + '%). Start there.');
  if (quick.length) plan.push(quick.length + ' subcontractor' + (quick.length === 1 ? '' : 's') + ' with 3 or fewer: ' + quick.reduce((a, s) => a + s.n, 0) + ' items, one visit each.');
  if (nearly.length) plan.push(nearly.length + ' unit' + (nearly.length === 1 ? '' : 's') + ' within 2 items of finished: ' + nearly.slice(0, 10).map(u => link(appUnit(u), u)).join(', ') + (nearly.length > 10 ? ' +' + (nearly.length - 10) : '') + '.');
  if (subs['not assigned']) plan.push(subs['not assigned'].n + ' open with no subcontractor assigned.');
  if (reopened.length) plan.push(reopened.length + ' reopened after being marked complete.');
  const th = 'style="text-align:left;padding:6px 10px;background:#0b1f33;color:#fff;font-size:12px"', thr = 'style="text-align:right;padding:6px 10px;background:#0b1f33;color:#fff;font-size:12px"', td = 'style="padding:6px 10px;border-bottom:1px solid #e3e7ec;font-size:14px"', tdr = 'style="padding:6px 10px;border-bottom:1px solid #e3e7ec;font-size:14px;text-align:right"';
  const bar = n => '<div style="background:#e9eef4;border-radius:4px;height:8px;width:120px"><div style="background:#d64545;border-radius:4px;height:8px;width:' + Math.max(3, Math.round(120 * n / Math.max(1, subList[0] ? subList[0].n : 1))) + 'px"></div></div>';
  const list = (L, max) => L.length ? '<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%">' + L.slice(0, max).map(r => '<tr><td ' + td + ' nowrap>' + esc(unitLabel(r.unit)) + '</td><td ' + td + '>' + link(rowLink(r), esc(r.desc.length > 70 ? r.desc.slice(0, 67) + '…' : r.desc)) + '</td><td ' + td + ' nowrap>' + esc(r.sub || '-') + '</td></tr>').join('') + '</table>' + (L.length > max ? '<p style="font-size:12px;color:#667;margin:4px 0 0">+ ' + (L.length - max) + ' more in the ' + link(opt.url || '#', 'register') + '</p>' : '') : '';
  const box = (n, label, col) => '<td style="padding:12px 8px;background:' + col + ';border-radius:10px;text-align:center;width:25%"><div style="font-size:26px;font-weight:700;color:#0b1f33">' + n + '</div><div style="font-size:12px;color:#445">' + label + '</div></td>';
  const h2 = t => '<h2 style="font-size:15px;color:#0b1f33;margin:20px 0 8px">' + t + '</h2>';
  const html = '<div style="font-family:Arial,Helvetica,sans-serif;color:#1c2733;max-width:640px">'
    + '<h1 style="font-size:19px;color:#0b1f33;margin:0 0 2px">' + esc(opt.title || 'Register summary') + '</h1><p style="margin:0 0 12px;color:#667;font-size:13px">' + esc(opt.dateText || '') + (opt.test ? ' · TEST' : '') + '</p>'
    + '<table cellspacing="6" cellpadding="0" style="width:100%"><tr>' + box(open.length, 'open', '#fde8e8') + box(prev ? closed.length : '–', 'completed today', '#e6f6ec') + box(prev ? added.length : '–', 'added today', '#fff3c4') + box(pct + '%', 'complete', '#e8f1fb') + '</tr></table>'
    + '<p style="margin:10px 0 0;font-size:13px;color:#445">' + unitsDone.length + ' of ' + units.length + ' units complete' + (heavy.length ? ' · most left: ' + heavy.slice(0, 5).map(u => link(appUnit(u), 'Unit ' + u) + ' (' + byUnit[u].open + ')').join(', ') : '') + '</p>'
    + (plan.length ? h2('Where to start') + '<ul style="margin:0;padding-left:18px;line-height:1.5;font-size:14px">' + plan.slice(0, 4).map(p => '<li>' + p + '</li>').join('') + '</ul>' : '')
    + h2('Open by subcontractor') + '<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%"><tr><th ' + th + '>Subcontractor</th><th ' + thr + '>Open</th><th ' + th + '></th><th ' + thr + '>Inside</th><th ' + thr + '>Outside</th><th ' + thr + '>Units</th></tr>' + subList.map(s => '<tr><td ' + td + '>' + (s.name === 'Not assigned' ? '<i>Not assigned</i>' : link(appSub(s.name), '<b>' + esc(s.name) + '</b>')) + '</td><td ' + tdr + '><b>' + s.n + '</b></td><td ' + td + '>' + bar(s.n) + '</td><td ' + tdr + '>' + s.int + '</td><td ' + tdr + '>' + s.ext + '</td><td ' + tdr + '>' + s.units.length + '</td></tr>').join('') + '</table>'
    + (prev && closed.length ? h2('Completed today · ' + closed.length) + list(closed, 8) : '') + (prev && added.length ? h2('Added today · ' + added.length) + list(added, 8) : '') + (prev && reopened.length ? h2('Reopened · ' + reopened.length) + list(reopened, 8) : '')
    + '<p style="margin-top:20px;font-size:13px">' + link(opt.app || '#', 'Open Resero Defects') + ' &nbsp;·&nbsp; ' + link(opt.url || '#', 'Open the register') + '</p>'
    + '<p style="font-size:11px;color:#889;margin:6px 0 0">A subcontractor name opens their open items in the app. An item opens its row in the register. Shared items (for example "MCL / TGW") count under both firms.' + (prev ? '' : ' Today counts start from the next summary.') + '</p></div>';
  return { subject: (opt.test ? 'TEST: ' : '') + (opt.title || 'Register summary') + ': ' + open.length + ' open' + (prev ? ', ' + closed.length + ' completed today, ' + added.length + ' added' : ''), html: html, snapshot: snapshot, stats: { open: open.length, done: done.length, added: added.length, closed: closed.length, reopened: reopened.length, subs: subList.length } };
}
function summaryRun_(to, test) {
  const props = PropertiesService.getScriptProperties(), id = props.getProperty('REGISTER_SHEET'); if (!id) throw new Error('No register sheet is linked yet. Link it from the app first.');
  const ss = SpreadsheetApp.openById(id), sh = ss.getSheets()[0], n = sh.getLastRow(), rows = registerRows_(n ? sh.getRange(1, 1, n, 5).getDisplayValues() : []);
  let prev = null; try { const parts = []; for (let i = 0; i < 20; i++) { const p = props.getProperty('SNAP_' + i); if (p == null) break; parts.push(p); } if (parts.length) prev = JSON.parse(parts.join('')); } catch (e) { prev = null; }
  const out = buildSummary_(rows, prev, { title: (props.getProperty('SUMMARY_TITLE') || 'Miles register') + ': daily summary', dateText: Utilities.formatDate(new Date(), SUMMARY_TZ, 'EEEE d MMMM yyyy'), url: ss.getUrl(), gid: sh.getSheetId(), name: ss.getName(), app: APP_URL, test: test });
  if (!to || !to.length) throw new Error('No one is set to receive the summary yet.');
  MailApp.sendEmail({ to: to.join(','), subject: out.subject, htmlBody: out.html, name: 'Resero Defects' });
  if (!test) { const s = JSON.stringify(out.snapshot); for (let i = 0; i < 20; i++) props.deleteProperty('SNAP_' + i); for (let i = 0, k = 0; i < s.length; i += 8000, k++) props.setProperty('SNAP_' + k, s.slice(i, i + 8000)); }
  return out.stats;
}
function dailySummary() { summaryRun_(summaryConfig_().to, false); }
// Run this once from the editor after any update to this script, so Google asks for every permission the helper needs.
function authoriseHelper() { ScriptApp.requireScopes(ScriptApp.AuthMode.FULL, ALL_SCOPES); Logger.log('All permissions are in place. Daily summary: ' + JSON.stringify(summaryConfig_())); }
