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
