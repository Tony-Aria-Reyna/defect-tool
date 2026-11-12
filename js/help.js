// Site check (pre-flight tests) and Help (guide plus Gemini Q&A about the app).
import { S, can } from './state.js';
import { APP } from './config.js';
import { $, esc, toast, modal, closeModal, dataUrlToBlob } from './util.js';
import { aiCall } from './ai.js';
import { outboxCount } from './photos.js';

export const GUIDE = `
RESERO DEFECTS: HOW TO USE IT ON SITE

Raising a defect
- Tap the round + button (bottom right) and choose Dictate, Take a photo, Pin on the plan, or Type it.
- Dictate: press and hold the microphone, say the defect the way you would to a colleague (where it is, what is wrong, who fixes it, by when), then let go. Gemini fills in the form and clears the note; anything it changed flashes yellow. Check it, then Save.
- Or tap + New (desktop) and type.
- Several defects in one breath is fine: the first fills the form and the others appear under "more defects heard" with a button to add them.
- No coverage on site: hold the mic as usual (or use the keyboard microphone). The note is saved on the phone with its pin and photos; when the phone finds service, Gemini fills in the form and the item shows under "To check" at the top of the list. Open each one, check it, Save.
- Signing in: use your email and a password (first time: tap "Create a password"). Google sign-in also works. Install the app on the phone (menu > Install on this phone) so it stays signed in.
- Room boundaries (menu > Room boundaries): draw unit outlines, rooms, common areas and items (kitchen unit, WC, vanity, shower, supertub). Drawing snaps to existing corners, lines and the walls on the drawing. Tap an edge to add a corner, tap a corner then Delete to remove it. "Select several" lets you tap or box-select a whole unit, then Copy group, drag it into place (it snaps), and the app asks for the new unit number. Mirror east-west or north-south for handed units. Ctrl+Z undoes.
- Surface and item: a pin records Block, Level, Unit, Room, Surface (floor, wall, ceiling, exterior…) and Item. Items drawn as boundaries are recognised automatically. Attach other sheets of the same extent to a plan (menu > Plans > Attach a view): ceiling plan, wall plan or internal elevations, cladding elevations, roof, services. A Floor / Ceiling / Walls switch then sits at the bottom left of the plan; pins dropped while a view shows are recorded with that surface (Ceiling, Wall, Exterior cladding…). Contractors always see the floor plan.
- Snap to walls (tick box in the boundary editor): on, taps and corners jump onto the walls in the drawing and onto other boundaries. Untick it to place something exactly where you tap, such as a WC or a vanity that sits off the wall, or hold Alt for one move on a laptop.
- Clean unit boundaries: unit outlines show as a solid blue line. With Right angles ticked (on by default) every edge you draw is horizontal or vertical and a dragged corner squares itself against its neighbours. A new outline takes in the rooms already inside it; a new room takes the number of the unit around it and is trimmed to the outline, with a message if it reached outside. Select an outline and press Fit rooms to this outline to pull every room onto it, or Square up corners to straighten a shape.
- Setting up repeated units (the main way): draw the outline of every unit, finish one unit completely (rooms and items), tap its outline and press Fill the other units from this one. Tick the units of the same type, on this plan and the other floors. The app works out which way round each one is, lines the rooms up against the walls on the drawing, places each fixture on its own lines, and shows a fit figure for each unit before anything is saved. Under 2 px is a good fit; a unit that does not match is held back. Undo the last fill puts everything back.
- Copying a unit by dragging, step by step: select the unit outline, press Copy this unit to the next one, drag the orange copy over the next apartment and drop it on that unit's outline. The copy is stretched into that outline, joined to what is around it, and given that unit's number, which you confirm in the window that opens. The old outline is replaced. If there is no outline there yet, the copy keeps its shape and you set the number yourself.
- Copying a unit by hand: select it, Copy group (or Copy to another plan), drag it roughly into place, then either drag a blue handle on the box around the selection to stretch it, or press Stretch onto the unit underneath, which sizes it exactly to the outline it is sitting on, takes that unit's number and replaces the old outline. The rooms inside scale with it.
- Elevation lines on a floor plan are shown for that storey only, each labelled, and can be hidden with the Elevation lines tick box under Show. The buttons for them sit in a compass, turned to match the drawings: tap the N rose in the middle to turn it a quarter turn, and the setting is kept for the whole project. The first time, it works the orientation out from the faces already linked.
- Elevation lines from the boundary editor: the faces that sit on this plan are listed as 📐 buttons in the panel. Press one to edit that line here: drag its corners, slide a wall, or press Redraw this line and tap the corners along the outside wall. Save face brings you back to the boundaries, and the pins on that elevation re-map.
- After a new room or common area is saved you are asked whether to draw an item inside it (kitchen unit, vanity, shower); items take the room and unit automatically.
- Join to neighbours (tick box in the boundary editor): on, corners that sit on each other move together and a dropped group joins onto what is around it. Turn it off when you want a shape to move on its own. To undo one join, tap the corner and press Disconnect this corner.
- Every tap flashes the button so you can see it landed, windows opened from another have a Back button in their heading, and tapping outside a window you have typed in asks before discarding it.
- Joining a group to its neighbours: when you drop a moved or pasted group, corners that land close to the boundaries around it are joined onto them. With a group selected you can also press Connect to neighbours, which does the same with a wider reach, so no slivers are left between a copied unit and the ones beside it.
- Sliding a whole wall: with a shape selected, press anywhere along one of its walls and drag. The whole wall slides sideways, keeping its length and its right angles, and snaps to the drawing, to neighbouring boundaries and to the red elevation guides. A tap on a wall (no drag) still adds a corner there.
- Plans list (menu > Plans): sheets are grouped as Floor plans, Site and landscape, and Elevations. Drag ⠿ or use ▲ ▼ to reorder; Sort automatically puts floor plans by building then level. Each floor plan shows its layers (ceiling, framing, walls, services…): press + Add layer or drop the PDF onto the row, type in a layer's name to rename it, and press ↗ on a layer (or the sheet thumbnail) to open it on the plan and work in it. Each elevation shows the floor plans it is linked to. Change Type to move a sheet between groups.
- Moving a pin: drag it (on a phone, hold it for half a second first, then drag). The unit and room follow the pin unless you typed them yourself.
- Elevations: upload the elevation PDF with the floor plans (menu > Plans > Upload). The app reads each sheet's drawing titles ("Block A West Elevation"), the grid bubbles above each drawing and the level markers (34,600 / 37,600…), works out which floor plan and storey each band belongs to, and traces the stepped line of that face along the outside walls of the floor plan (decks, recesses and returns included). Plans > "Show faces" draws those lines so you can check them; "Link elevations automatically" re-runs it for every elevation sheet. A pin dropped on the elevation is recorded as Exterior cladding, lands on the floor plan on the face line at the same point along it, picks up the unit and room behind it, and the PDF report shows both snips. To adjust a face, press Adjust in Show faces: step 1 shows the band on the elevation (a blue box you drag by its corners), step 2 the line on the floor plan (drag corners, tap the line to add one, Delete to remove one). Change a face and every pin already on that elevation moves itself to the new line; a unit or room you typed by hand is kept. On a phone, tap ⛶ on the plan for full screen, and the sheet buttons sit behind one chip at the bottom left. If a sheet has no readable titles or grids, use "This is an elevation…" and either trace the face by tapping its corners on the floor plan, or tap the two ends of the face. Common areas such as stairs and lobbies follow the face more closely when they are drawn as boundaries (kind Area).
- If the mic does not work (common on iPhone when the app is opened from the home screen): tap in the text box and use the microphone key on your keyboard, then tap "Interpret with Gemini".

Pins and rooms
- Plans tab: tap "Add pin", then tap the plan where the defect is. If the spot is inside a drawn room, the unit, room, block and level fill in automatically.
- To move a pin: open the defect, tap "Move pin", tap the new spot. "Remove pin" clears it.
- Choosing a unit number in the form sets the block and level.
- "Rooms" tick box on the Plans tab shows the room boundaries.

Photos
- In the defect, tap "Add photo" to use the camera or choose from the gallery. Tap a photo to mark it up with pen, arrow or circle. Photos taken with no signal wait on the phone and upload when you are back online (the orange bar at the bottom shows how many are waiting).

Status and severity
- Status: Open, In progress, Ready for review, Closed, Disputed. Only editors and admins can close.
- Severity: "Major - prevents PC" stops practical completion. "To triage" means not yet assessed (the Maynard Marks items start this way).
- The chips at the top of the list filter by status; tap to toggle. Filters: block, level, unit, severity, trade, responsible. Sort by ID, last updated, location or severity.

Exports (Export button)
- PDF schedule (for the PC certificate appendix), Excel register, Procore CSV, or everything in a zip. Choose "Current filtered list", "Everything not closed" or "All".

Facility management (tabs under the header)
- Dashboard: what is overdue or due, key dates, warranties expiring, documents outstanding, handover pack.
- Assets & warranties: one entry per building element with warranty periods and document status.
- Maintenance: tasks by due date; "Done" records the date, notes and a report and moves the next due date on. "Schedule undated" sets first due dates.
- Compliance: specified systems, Form 12A each year, BWoF due date.
- Documents: upload files, upload a whole handover folder (filed by system and type), or add SharePoint links.
- Drag and drop: drop files or folders anywhere. Photos onto an open defect; files onto an open asset; a .json import file anywhere; plan PDFs on the Defects tab; anything else goes to Documents.

Menu (☰)
- Project settings, Users and access (invite by email, set roles), Plans, Room boundaries (draw units, rooms, common areas; duplicate a unit with its rooms), Import register, Gemini settings, Site check, Help.
- Roles: Admin (everything), Editor (raise, edit, close), Contractor (update status to In progress or Ready for review, add photos and comments), Viewer (read and export).

Offline
- The register works without signal once it has loaded online. Plans show if viewed online before. Everything syncs when back online.

Problems
- "Could not save": check the orange bar; if offline, it will sync later. If online, sign out and in again.
- Photos not in the PDF: the storage CORS setting is missing (README step 6).
- Gemini errors: ☰ > Gemini > Test.
`;

export function helpDialog() {
  modal(`<h2>Help</h2>
  <label class="f">Ask a question about using the app<textarea id="hq" placeholder="e.g. How do I move a pin? What does Ready for review mean? How do I add Miles to the project?"></textarea></label>
  <div class="act" style="justify-content:flex-start"><button class="go" id="hAsk">Ask</button><span class="muted small" id="hSt"></span></div>
  <div id="hA" class="ainote" style="margin-bottom:10px"></div>
  <details><summary style="cursor:pointer;font-weight:600;color:var(--navy2)">Quick guide</summary><pre style="white-space:pre-wrap;font:inherit;font-size:13px;line-height:1.45">${esc(GUIDE.trim())}</pre></details>
  <div class="act"><button id="hX">Close</button></div>`, true);
  $('hX').onclick = closeModal;
  $('hAsk').onclick = async () => {
    const q = $('hq').value.trim(); if (!q) return;
    $('hAsk').disabled = true; $('hSt').textContent = 'Asking Gemini…';
    try {
      const t = await aiCall(`You are the help assistant inside "${APP.name}", a construction defects and facility management web app. Answer the user's question in plain New Zealand English, no em dashes, in at most 6 short sentences or a short numbered list, using ONLY the guide below. If the guide does not cover it, say so and suggest the nearest thing that is covered. Return JSON {"answer":"..."}.\n\nGUIDE:\n${GUIDE}\n\nPROJECT: ${S.project ? S.project.name : 'none open'}. USER ROLE: ${S.role || 'none'}.\n\nQUESTION: ${q}`);
      let a; try { a = JSON.parse(String(t).replace(/^```(?:json)?\s*|\s*```$/g, '')).answer; } catch (e) { a = String(t); }
      $('hA').textContent = String(a || '').replace(/—/g, ', '); $('hA').classList.add('show'); $('hSt').textContent = '';
    } catch (e) { $('hSt').textContent = ''; $('hA').textContent = e.message === 'nokey' ? 'Gemini is not set up yet (☰ > Gemini). The quick guide below still works.' : e.message; $('hA').classList.add('show'); }
    finally { $('hAsk').disabled = false; }
  };
}

/* ------------------------------------------------------------ Site check */
export async function siteCheck() {
  modal(`<h2>Site check</h2><p class="note">Tests the things the walk-through depends on. Run it on the phone you will use, in the browser you will use, while you still have signal.</p><table class="t" id="scT"></table><div class="act"><button id="scX">Close</button><button class="go" id="scR">Run again</button></div>`, true);
  $('scX').onclick = closeModal; $('scR').onclick = siteCheck;
  const rows = []; const T = $('scT');
  const row = (name, status, note) => { rows.push([name, status, note]); T.innerHTML = rows.map(([n, s, o]) => `<tr><td style="width:34%"><b>${esc(n)}</b></td><td style="width:14%"><span class="st ${s === 'ok' ? 'st-ok' : s === 'warn' ? 'st-warn' : s === 'wait' ? 'st-grey' : 'st-bad'}">${s === 'ok' ? 'Pass' : s === 'warn' ? 'Check' : s === 'wait' ? 'Testing…' : 'Fail'}</span></td><td class="small">${esc(o || '')}</td></tr>`).join(''); };
  const upd = (name, status, note) => { const r = rows.find(x => x[0] === name); if (r) { r[1] = status; r[2] = note; row('__', 'ok', ''); rows.pop(); T.innerHTML = rows.map(([n, s, o]) => `<tr><td style="width:34%"><b>${esc(n)}</b></td><td style="width:14%"><span class="st ${s === 'ok' ? 'st-ok' : s === 'warn' ? 'st-warn' : s === 'wait' ? 'st-grey' : 'st-bad'}">${s === 'ok' ? 'Pass' : s === 'warn' ? 'Check' : s === 'wait' ? 'Testing…' : 'Fail'}</span></td><td class="small">${esc(o || '')}</td></tr>`).join(''); } };
  const pid = S.project && S.project.id;
  row('Signed in', S.user ? 'ok' : 'bad', S.user ? S.user.email : 'Sign in first');
  row('Project open', pid ? 'ok' : 'bad', pid ? S.project.name + ' · role ' + (S.role || 'none') : 'Open the project first');
  row('Can raise defects', can.edit() ? 'ok' : 'bad', can.edit() ? '' : 'Your role is ' + (S.role || 'none') + '. Ask an admin for Editor or Admin.');
  row('Online', navigator.onLine ? 'ok' : 'warn', navigator.onLine ? '' : 'Offline now: saves will sync later');
  row('Plans loaded', S.plans.length ? 'ok' : 'warn', S.plans.length ? S.plans.length + ' plans, ' + S.plans.reduce((a, p) => a + (p.zones || []).length, 0) + ' room boundaries' : 'No plans: pins and room recognition will not work');
  row('Installed as an app', matchMedia('(display-mode: standalone)').matches ? 'warn' : 'ok', matchMedia('(display-mode: standalone)').matches ? (/iPhone|iPad/.test(navigator.userAgent) ? 'On iPhone, live dictation is unreliable in the home-screen app. Use the Safari tab, or the keyboard microphone.' : 'OK on Android') : 'Running in a browser tab (fine)');
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  row('Live dictation available', SR ? 'ok' : 'warn', SR ? '' : 'Not in this browser. Use the keyboard microphone in the text box instead.');
  row('Dictation out of coverage', 'warn', 'Live dictation needs data. For sites with no signal: Android Settings > General management > Keyboard > Google voice typing (or Samsung voice input) > Offline speech recognition > download English (New Zealand). Then use the keyboard microphone in the note box. Notes are kept on the phone and Gemini fills them in when you are back in service.');
  row('Microphone permission', 'wait', '');
  try { const st = await navigator.mediaDevices.getUserMedia({ audio: true }); st.getTracks().forEach(t => t.stop()); upd('Microphone permission', 'ok', 'Allowed'); } catch (e) { upd('Microphone permission', 'warn', 'Not allowed yet: tap the mic once and choose Allow'); }
  const ob = await outboxCount(); row('Photos waiting to upload', ob ? 'warn' : 'ok', ob ? ob + ' waiting; they upload when online' : 'None');
  if (!pid) return;
  row('Gemini interpreter', 'wait', '');
  try { const t = await aiCall('Reply with JSON {"ok":true}'); upd('Gemini interpreter', /ok/.test(t) ? 'ok' : 'warn', /ok/.test(t) ? (S.ai.helperUrl ? 'Project helper' : 'Personal key on this device') : 'Unexpected reply'); } catch (e) { upd('Gemini interpreter', 'bad', e.message === 'nokey' ? 'No key on this device: ☰ > Gemini > paste key > Test' : e.message); }
  if (S.store.mode === 'demo') { row('Database and photo storage', 'warn', 'Demo mode: data stays in this browser only'); return; }
  row('Save to the database', 'wait', '');
  try {
    const id = '_check_' + S.user.uid.slice(0, 6); const t = new Date().toISOString();
    await S.store.createDefect(pid, { id, title: 'Site check (deleted automatically)', desc: '', status: 'Open', severity: 'Observation only', source: 'Other', photos: [], history: [], created: t, updated: t, createdBy: S.user.email, updatedBy: S.user.email });
    try { await S.store.deleteDefect(pid, id); } catch (e) { await S.store.updateDefect(pid, id, { status: 'Closed', title: 'Site check (please delete)' }); }
    upd('Save to the database', 'ok', 'A test record was written and removed');
  } catch (e) { upd('Save to the database', 'bad', 'Firestore rules may not be published, or your role is wrong: ' + (e.message || e)); }
  row('Upload a photo', 'wait', '');
  let url = '';
  try {
    const c = document.createElement('canvas'); c.width = c.height = 8; c.getContext('2d').fillStyle = '#3bafbe'; c.getContext('2d').fillRect(0, 0, 8, 8);
    const path = `projects/${pid}/photos/_check/${S.user.uid.slice(0, 6)}.jpg`;
    url = await S.store.putFile(path, dataUrlToBlob(c.toDataURL('image/jpeg')));
    upd('Upload a photo', 'ok', 'Storage rules allow uploads');
    row('Photos readable for PDF export (CORS)', 'wait', '');
    try { const r = await fetch(url, { mode: 'cors' }); if (!r.ok) throw new Error(r.status); upd('Photos readable for PDF export (CORS)', 'ok', 'Exports can include photos'); }
    catch (e) { upd('Photos readable for PDF export (CORS)', 'warn', 'Photos will save and show, but will not appear in PDF exports until the Cloud Shell CORS command is run (README step 6)'); }
    S.store.deleteFile(path);
  } catch (e) { upd('Upload a photo', 'bad', 'Storage rules may not be published or the grant was declined: ' + (e.message || e)); }
}
