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
