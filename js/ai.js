// Dictation (Web Speech API, en-NZ) and the Gemini interpreter.
import { S, saveLocal, unitList, sevLabel, sevMajorList } from './state.js';
import { todayISO } from './util.js';
import { typicalList } from './typicals.js';

let REC = null, HOLD = null;
// Hold-to-talk dictation. Each recognition session is a single utterance (continuous=false) and is restarted
// while the button is held: this avoids the Android Chrome bug where continuous mode repeats earlier phrases.
export function dictate(ta, btn, status, onEnd) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { status('Live dictation is not available in this browser. Tap the text box and use the microphone on your keyboard.', true); ta.focus(); return; }
  if (REC) { endDictation(); return; }
  if (!navigator.onLine) { status('No coverage: live dictation needs data. Tap in the note box and use the microphone key on the keyboard instead, then Interpret.', true); ta.focus(); return; }
  const base = ta.value ? ta.value.trim() + ' ' : '';
  REC = { ta, btn, status, onEnd, base, done: '', r: null, stopping: false };
  btn.classList.add('rec'); status('Listening… let go when you have finished');
  spin();
}
function spin() {
  const R = REC; if (!R || R.stopping) return;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const r = new SR(); R.r = r; r.lang = 'en-NZ'; r.continuous = false; r.interimResults = true;
  let cur = '';
  r.onresult = e => { cur = ''; for (let i = 0; i < e.results.length; i++) cur += e.results[i][0].transcript; R.ta.value = (R.base + R.done + cur).replace(/\s+/g, ' '); R.ta.dispatchEvent(new Event('input')); };
  r.onerror = e => { if (e.error === 'network') { R.fatal = 'No coverage: live dictation needs data. Tap in the note box and use the microphone key on the keyboard instead, then Interpret.'; return; } if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'audio-capture') R.fatal = 'Microphone: ' + e.error + (e.error === 'not-allowed' ? ' (allow the microphone for this site)' : ''); else if (e.error !== 'no-speech' && e.error !== 'aborted') R.status('Microphone: ' + e.error, true); };
  r.onend = () => { if (cur.trim()) R.done += cur.trim() + ' '; cur = ''; R.ta.value = (R.base + R.done).trim(); if (R.fatal) { const m = R.fatal; R.stopping = true; finish(); R.status(m, true); R.ta.focus(); } else if (R.stopping) finish(); else spin(); };
  try { r.start(); } catch (e) { R.status('Could not start the microphone', true); finish(); }
}
function finish() { const R = REC; if (!R) return; REC = null; R.btn.classList.remove('rec'); R.status(''); const v = R.ta.value.trim(); if (v && v !== R.base.trim()) R.onEnd && R.onEnd(); }
export function endDictation() { if (!REC) return; REC.stopping = true; try { REC.r && REC.r.stop(); } catch (e) { finish(); } }
export function stopDictation() { if (REC) { const r = REC.r; REC = null; if (r) { r.onend = null; try { r.stop(); } catch (e) {} } } }
// Wire a button for press-and-hold (a short tap toggles instead, for desktop).
export function holdToTalk(btn, start) {
  let t0 = 0, pid = null;
  btn.onclick = null;
  btn.onpointerdown = e => { e.preventDefault(); pid = e.pointerId; try { btn.setPointerCapture(pid); } catch (x) {} t0 = Date.now(); if (!REC) start(); else endDictation(); };
  const up = e => { if (pid === null) return; pid = null; if (Date.now() - t0 > 350 && REC) endDictation(); };
  btn.onpointerup = up; btn.onpointercancel = up;
  btn.oncontextmenu = e => e.preventDefault();
}
// Gemini call: through the project's Apps Script helper if set, otherwise with a personal key kept on this device.
export async function aiCall(prompt, imgDataUrl) {
  const data = imgDataUrl ? imgDataUrl.split(',')[1] : null;
  const h = S.ai || {};
  if (h.helperUrl) {
    let t;
    try { const r = await fetch(h.helperUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ key: h.helperKey || '', action: 'ai', prompt, file: data ? { mime: 'image/jpeg', data } : undefined }), redirect: 'follow' }); t = await r.text(); }
    catch (e) { throw new Error('Could not reach the Gemini helper. Check the internet and try again.'); }
    let j; try { j = JSON.parse(t); } catch (e) { throw new Error('The Gemini helper sent back something unexpected. Check its web address in Project settings.'); }
    if (j.error) throw new Error(j.error === 'nokey' ? 'The Gemini helper has no key yet (Script properties GEMINI_KEY).' : /not allowed/.test(j.error) ? 'Helper key does not match. The script\'s key ends "' + String(j.error).slice(-4) + '", the one you entered ends "' + String(h.helperKey || '').slice(-4) + '".' : 'Gemini said: ' + String(j.error).slice(0, 160));
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

// True when a description is still the speaker's own words: mostly the same word pairs as the note, or spoken-style phrasing.
export function tooVerbatim(note, desc) {
  const w = s => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean), n = w(note), d = w(desc); if (d.length < 5) return false;
  if (/\b(i|i'm|im|we|we've|you know|um+|uh+|gonna|kind of|sort of|i think|i guess|can you|please (add|log|record|note)|so yeah|basically|okay so)\b/i.test(String(desc))) return true;
  if (n.length < 6) return false;
  const pairs = a => new Set(a.slice(1).map((x, i) => a[i] + ' ' + x)), pn = pairs(n), pd = pairs(d); let hit = 0; pd.forEach(p => { if (pn.has(p)) hit++; });
  return hit / pd.size > 0.6;
}
export function aiPrompt(text, cur, strict) {
  const p = S.project, zones = [];
  S.plans.forEach(pl => (pl.zones || []).forEach(z => { if (z.kind === 'unit') zones.push(`Unit ${z.unit} = ${[z.block && 'Block ' + z.block, z.level].filter(Boolean).join(', ')}`); }));
  const roomNames = [...new Set(S.plans.flatMap(pl => (pl.zones || []).filter(z => z.kind !== 'unit' && z.name).map(z => z.name)))];
  const units = unitList(p);
  return `You help a construction Client Project Manager in New Zealand record building defects during practical completion inspections and the defects notification period. Turn the site note below into structured defect records.

PROJECT: ${p.name}${p.address ? ', ' + p.address : ''}. ${p.description || ''}
${units.length ? 'Units: ' + (units.length > 60 ? units.slice(0, 60).join(', ') + '…' : units.join(', ')) + '.' : ''}
${[...new Set(zones)].slice(0, 120).join('; ')}
Rooms and areas on the plans: ${[...new Set([...roomNames, ...p.rooms])].join(', ')}.
Main contractor: ${p.contractor || 'not stated'}.
${p.aiContext ? 'PROJECT KNOWLEDGE:\n' + p.aiContext + '\n' : ''}
TYPICAL DEFECT TITLES (reuse one of these as the title when the note matches it, so the register stays consistent): ${typicalList(p).map(x => x.t).join('; ')}.
${((S.fm || {}).systems || []).length ? 'SPECIFIED SYSTEMS: ' + S.fm.systems.map(x => x.name).join('; ') + '.' : ''}
${((S.fm || {}).assets || []).length ? 'BUILDING ELEMENTS AND PRODUCTS (use these names for "element"): ' + [...new Set(S.fm.assets.map(x => x.element).filter(Boolean))].slice(0, 120).join('; ') + '.' : ''}

HOW TO WRITE IT. The note is someone talking naturally while walking the site. It is raw material, never the wording. Readers are the contractor, subcontractors and consultants, and they must see a register entry, not a transcript.
- "description": what is wrong, on which element, and the extent (how much, how many, which side). Third person, present tense, complete sentences. No "I", "we" or "you". No filler or conversational words (um, so, basically, I think, I guess, kind of, you know). Nothing addressed to you or to the app ("can you add", "log this", "make a note"). Do not open with the unit or room: the location has its own fields.
- "action": the instruction to the contractor, starting with a verb (Remove, Replace, Reseal, Make good, Investigate). Move anything the speaker says should be done into "action", not "description".
- "title": the defect in a few words, as it would appear in a schedule (for example "Shower tray silicone incomplete").
- Use correct trade and product terms, and the element and product names listed above where they fit. Keep every fact that was said (measurements, counts, product names, dates, who is to do it). Add nothing that was not said or is not visible in the photo.
EXAMPLE. Spoken: "okay so in here the um the silicone round the shower tray is pretty rough, there's a gap down the left side by the wall, about 200 long, and I think the painter's got overspray on the glass as well, they'll need to redo that before handover". One defect is written as: title "Shower tray silicone incomplete", description "Silicone seal to the shower tray is uneven, with an unsealed gap of approximately 200 mm on the left-hand side at the wall junction.", action "Remove and reapply the silicone seal to the full perimeter of the shower tray before handover." The overspray is a second defect: title "Paint overspray on shower glass", description "Paint overspray is present on the shower glass.", action "Remove overspray from the shower glass without scratching the surface."
${strict ? 'IMPORTANT: your previous answer repeated the speaker\'s own words in the description. Rewrite every description and action from scratch in the register style above.\n' : ''}
THE SITE NOTE (dictated, may contain speech-to-text errors; fix obvious mishearings such as "gyp" for GIB or "unit to" for unit 2):
"""${text}"""

CURRENT FORM VALUES (keep anything the note does not change): ${JSON.stringify({ unit: cur.unit, room: cur.room, surface: cur.surface, item: cur.item, block: cur.block, level: cur.level, element: cur.element, title: cur.title, status: cur.status })}

Return JSON only, in this shape:
{"defects":[{"title":"short name, max 8 words","description":"register-style description written as set out above, 1-3 sentences, New Zealand English, no em dashes; never the speaker's own wording","action":"what must be done to fix it, imperative","unit":"unit number or empty","room":"room or area","surface":"one of Floor, Wall, Ceiling, Exterior cladding, Roof, Joinery, Services, or empty","item":"the fixture or fitting the defect is on, e.g. Kitchen unit, Vanity, Shower, WC, Supertub, Heat pump, Window, Door, or empty","block":"block or empty","level":"level or empty","element":"building element or product","type":"one of ${JSON.stringify(p.types)}","severity":"one of ${JSON.stringify(p.severities.filter(s => s !== 'To triage'))}","trade":"one of ${JSON.stringify(p.trades)}","responsible":"one of ${JSON.stringify(p.responsible)}","status":"one of ${JSON.stringify(p.statuses)} (default Open)","targetDate":"YYYY-MM-DD if a date or timeframe is said (today is ${todayISO()}), else empty"}],"questions":["anything unclear the user should check, max 2, else empty"]}
Rules: one record per separate defect mentioned. ${p.sevLabel ? `The "severity" field is this project's ${sevLabel(p)}: choose it using the definitions in the project knowledge above${p.sevDefault ? `, and use "${p.sevDefault}" when the note gives no indication` : ''}.` : `Use a "Major" severity only if it stops the building being used for its intended purpose, is a safety or compliance issue, or the user says it is major.`} Do not invent details that were not said.`;
}
