// Dictation (Web Speech API, en-NZ) and the Gemini interpreter.
import { S, saveLocal, unitList } from './state.js';
import { todayISO } from './util.js';

let REC = null;
export function dictate(ta, btn, status, onEnd) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (REC) { REC.stop(); return; }
  if (!SR) { status('Live dictation is not available in this browser. Tap the text box and use the microphone on your keyboard.', true); ta.focus(); return; }
  const r = new SR(); REC = r; r.lang = 'en-NZ'; r.continuous = true; r.interimResults = true;
  const base = ta.value ? ta.value.trim() + ' ' : ''; let fin = '';
  r.onresult = e => { let im = ''; for (let i = e.resultIndex; i < e.results.length; i++) { const t = e.results[i][0].transcript; if (e.results[i].isFinal) fin += t.trim() + ' '; else im += t; } ta.value = base + fin + im; };
  r.onerror = e => { if (e.error !== 'no-speech' && e.error !== 'aborted') status('Microphone: ' + e.error + (e.error === 'not-allowed' ? ' (allow the microphone for this site)' : ''), true); };
  r.onend = () => { REC = null; btn.classList.remove('rec'); status(''); if (ta.value.trim() && ta.value.trim() !== base.trim()) onEnd && onEnd(); };
  try { r.start(); btn.classList.add('rec'); status('Listening… tap the mic again to finish'); } catch (e) { REC = null; status('Could not start the microphone', true); }
}
export function stopDictation() { if (REC) { REC.onend = null; try { REC.stop(); } catch (e) {} REC = null; } }

// Gemini call: through the project's Apps Script helper if set, otherwise with a personal key kept on this device.
export async function aiCall(prompt, imgDataUrl) {
  const data = imgDataUrl ? imgDataUrl.split(',')[1] : null;
  const h = S.ai || {};
  if (h.helperUrl) {
    let t;
    try { const r = await fetch(h.helperUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ key: h.helperKey || '', action: 'ai', prompt, file: data ? { mime: 'image/jpeg', data } : undefined }), redirect: 'follow' }); t = await r.text(); }
    catch (e) { throw new Error('Could not reach the Gemini helper. Check the internet and try again.'); }
    let j; try { j = JSON.parse(t); } catch (e) { throw new Error('The Gemini helper sent back something unexpected. Check its web address in Project settings.'); }
    if (j.error) throw new Error(j.error === 'nokey' ? 'The Gemini helper has no key yet (Script properties GEMINI_KEY).' : /not allowed/.test(j.error) ? 'The Gemini helper key does not match (Project settings).' : 'Gemini said: ' + String(j.error).slice(0, 160));
    return j.text;
  }
  const key = S.local.geminiKey; if (!key) throw new Error('nokey');
  const parts = [{ text: prompt }]; if (data) parts.push({ inline_data: { mime_type: 'image/jpeg', data } });
  const model = S.local.geminiModel || 'gemini-3.6-flash';
  const call = m => fetch('https://generativelanguage.googleapis.com/v1beta/models/' + m + ':generateContent', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseMimeType: 'application/json', temperature: 0.2 } }) });
  let r = await call(model);
  if (r.status === 404) { // model retired: use the newest Flash model this key can use
    const l = await (await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': key } })).json();
    const ok = (l.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent') && /gemini-[\d.]+-flash$/.test(m.name)).map(m => m.name.replace('models/', '')).sort((a, b) => parseFloat(b.split('-')[1]) - parseFloat(a.split('-')[1]));
    if (ok.length) { S.local.geminiModel = ok[0]; saveLocal(); r = await call(ok[0]); }
  }
  const j = await r.json(); if (!r.ok) throw new Error('Gemini said: ' + ((j.error && j.error.message) || r.status));
  return ((((j.candidates || [])[0] || {}).content || {}).parts || []).map(p => p.text || '').join('');
}

export function aiPrompt(text, cur) {
  const p = S.project, zones = [];
  S.plans.forEach(pl => (pl.zones || []).forEach(z => { if (z.kind === 'unit') zones.push(`Unit ${z.unit} = ${[z.block && 'Block ' + z.block, z.level].filter(Boolean).join(', ')}`); }));
  const roomNames = [...new Set(S.plans.flatMap(pl => (pl.zones || []).filter(z => z.kind !== 'unit' && z.name).map(z => z.name)))];
  const units = unitList(p);
  return `You help a construction Client Project Manager in New Zealand record building defects during practical completion inspections and the defects notification period. Turn the site note below into structured defect records.

PROJECT: ${p.name}${p.address ? ', ' + p.address : ''}. ${p.description || ''}
${units.length ? 'Units: ' + (units.length > 60 ? units.slice(0, 60).join(', ') + '…' : units.join(', ')) + '.' : ''}
${[...new Set(zones)].slice(0, 120).join('; ')}
Rooms and areas on the plans: ${[...new Set([...roomNames, ...p.rooms])].join(', ')}.
Main contractor: ${p.contractor || 'not stated'}. ${p.aiContext || ''}

THE SITE NOTE (dictated, may contain speech-to-text errors; fix obvious mishearings such as "gyp" for GIB or "unit to" for unit 2):
"""${text}"""

CURRENT FORM VALUES (keep anything the note does not change): ${JSON.stringify({ unit: cur.unit, room: cur.room, block: cur.block, level: cur.level, element: cur.element, title: cur.title, status: cur.status })}

Return JSON only, in this shape:
{"defects":[{"title":"short name, max 8 words","description":"clear professional description, 1-3 sentences, New Zealand English, no em dashes, what is wrong and where","action":"what must be done to fix it, imperative","unit":"unit number or empty","room":"room or area","block":"block or empty","level":"level or empty","element":"building element or product","type":"one of ${JSON.stringify(p.types)}","severity":"one of ${JSON.stringify(p.severities.filter(s => s !== 'To triage'))}","trade":"one of ${JSON.stringify(p.trades)}","responsible":"one of ${JSON.stringify(p.responsible)}","status":"one of ${JSON.stringify(p.statuses)} (default Open)","targetDate":"YYYY-MM-DD if a date or timeframe is said (today is ${todayISO()}), else empty"}],"questions":["anything unclear the user should check, max 2, else empty"]}
Rules: one record per separate defect mentioned. Use a "Major" severity only if it stops the building being used for its intended purpose, is a safety or compliance issue, or the user says it is major. Do not invent details that were not said.`;
}
