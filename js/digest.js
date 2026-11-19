// Digest emails and invitations, sent by the project's Google helper (version 3 and above).
// Who gets which digest is kept in the helper (Script properties), so the emails go out each morning without anyone opening the app.
import { S, can, domainOf } from './state.js';
import { APP, ROLES, ROLE_HELP } from './config.js';
import { $, esc, toast, modal, closeModal, busy } from './util.js';
import { gsCall, helperVersion } from './sheetsync.js';

const KINDS = { inspector: 'Inspector: items newly ready for review', contractor: 'Contractor: sent back, new, overdue', admin: 'Project admin: the week in numbers', client: 'Client: overdue, this month, next 3 months' };
const FREQ = { daily: 'Daily (weekdays, 7am)', weekly: 'Weekly (Mondays)', monthly: 'Monthly (first weekday)', off: 'Off' };
const appUrl = () => location.origin + location.pathname;
// A sensible starting list from the people on the project
function defaults() {
  const p = S.project, info = p.memberInfo || {}, src = p.sources || [];
  return Object.entries(p.members || {}).map(([u, role]) => { const i = info[u] || {}, email = String(i.email || '').toLowerCase(), dom = domainOf(email); if (!email) return null;
    const own = src.filter(x => x.toLowerCase().replace(/[^a-z0-9]/g, '').includes(dom.split('.')[0]) && dom.split('.')[0].length >= 4);
    const client = (p.restrictedTo || []).includes(dom) && role !== 'admin';
    const kind = role === 'admin' ? 'admin' : role === 'contractor' ? 'contractor' : role === 'client' || client ? 'client' : 'inspector';
    return { email, name: i.name || '', kind, freq: kind === 'admin' ? 'weekly' : kind === 'client' ? 'monthly' : 'daily', registers: kind === 'inspector' ? own : [] }; }).filter(Boolean);
}
export async function digestDialog() {
  if (!can.admin()) return;
  const b = busy('Checking the helper…'); const v = await helperVersion(); let cfg = null;
  if (v >= 3) { try { cfg = (await gsCall('digestGet', { pid: S.project.id })).cfg; } catch (e) { b.done(); return toast(e.message, 8000); } }
  b.done();
  let R = (cfg && cfg.recipients && cfg.recipients.length) ? cfg.recipients : defaults();
  const src = S.project.sources || [];
  const row = (r, i) => `<tr data-i="${i}"><td><input data-k="email" value="${esc(r.email)}" placeholder="name@company.co.nz" style="width:100%"><br><input data-k="name" value="${esc(r.name || '')}" placeholder="Name" style="width:100%;margin-top:4px"></td>
    <td><select data-k="kind">${Object.entries(KINDS).map(([k, l]) => `<option value="${k}" ${r.kind === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>${src.length ? `<div class="small" style="margin-top:4px">${src.map(x => `<label style="display:inline-flex;gap:4px;margin-right:8px"><input type="checkbox" data-reg="${esc(x)}" ${(r.registers || []).includes(x) ? 'checked' : ''}>${esc(x)}</label>`).join('')}<br><span class="muted">No register ticked = all registers</span></div>` : ''}</td>
    <td><select data-k="freq">${Object.entries(FREQ).map(([k, l]) => `<option value="${k}" ${r.freq === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select><br><button class="btn2 sm" data-test="${i}" style="margin-top:6px">Send me a test</button></td><td><button class="btn2 sm warn" data-rm="${i}">✕</button></td></tr>`;
  const read = () => [...document.querySelectorAll('#dgT tr[data-i]')].map(tr => ({ email: tr.querySelector('[data-k=email]').value.trim().toLowerCase(), name: tr.querySelector('[data-k=name]').value.trim(), kind: tr.querySelector('[data-k=kind]').value, freq: tr.querySelector('[data-k=freq]').value, registers: [...tr.querySelectorAll('[data-reg]:checked')].map(c => c.dataset.reg) })).filter(r => r.email);
  const draw = () => {
    modal(`<h2>✉ Email digests</h2><p class="note">Short, numbers-first emails with a link to each item, built from the project's own data and sent each morning by the project's Google helper. Nobody has to open the app for them to go.</p>
    ${v < 3 ? '<p class="fmwarn"><b>The helper needs its update before digests can be switched on.</b> Steps: paste the new helper/Code.gs and appsscript.json into the Apps Script project, add the ADMIN_KEY script property, run authoriseHelper, then deploy a new version. The list below is kept on this screen until then.</p>' : ''}
    <table class="t small" id="dgT"><tr><th>Who</th><th>What they get</th><th>How often</th><th></th></tr>${R.map(row).join('')}</table>
    <div class="act" style="justify-content:flex-start"><button class="btn2" id="dgAdd">＋ Add someone</button></div>
    <div class="act"><button id="dgX">Close</button><button class="go" id="dgGo" ${v < 3 ? 'disabled' : ''}>Save</button></div>`, true);
    $('dgX').onclick = closeModal; $('dgAdd').onclick = () => { R = read(); R.push({ email: '', name: '', kind: 'inspector', freq: 'daily', registers: [] }); draw(); };
    document.querySelectorAll('[data-rm]').forEach(x => x.onclick = () => { R = read(); R.splice(+x.dataset.rm, 1); draw(); });
    document.querySelectorAll('[data-test]').forEach(x => x.onclick = async () => { if (v < 3) return toast('The helper needs its update first'); R = read(); const r = R[+x.dataset.test]; if (!r) return;
      const bb = busy('Saving and sending a test…'); try { await save(R); await gsCall('digestTest', { pid: S.project.id, email: r.email, to: S.user.email }); bb.done(); toast('Test for ' + r.email + ' sent to ' + S.user.email, 6000); } catch (e) { bb.done(); toast(e.message, 9000); } });
    $('dgGo').onclick = async () => { const bb = busy('Saving…'); try { await save(read()); bb.done(); closeModal(); toast('Saved. Digests go out each weekday at 7am.', 5000); } catch (e) { bb.done(); toast(e.message, 9000); } };
  };
  const save = L => gsCall('digestSet', { pid: S.project.id, name: S.project.name, app: appUrl(), recipients: L });
  draw();
}
// An invitation email from the app (the helper sends it, so it comes from the project, not your own mailbox)
export async function sendInvite(email, role, projectName, link) {
  if ((await helperVersion()) < 3) throw new Error('needs updating');
  const url = appUrl(), html = `<div style="font:14px Arial;color:#1d2733;max-width:600px"><p>Kia ora,</p><p>${esc(S.user.name)} has given you <b>${esc(ROLES[role] || role)}</b> access to <b>${esc(projectName)}</b> on Resero Site.</p><p>${esc(ROLE_HELP[role] || '')}</p>
    <p><a href="${esc(link || url)}" style="display:inline-block;background:#011c35;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Open your invitation</a></p>
    <p>Then sign in with Google, or choose "First time? Create a password", using this email address (${esc(email)}). You are added straight away; there is no confirmation email to wait for. After that, the app is at ${esc(url)}. On a phone you can add it to your home screen.</p><p style="color:#556;font-size:12px">Sent by Resero Site for ${esc(projectName)}. Questions: reply to this email.</p></div>`;
  await gsCall('mail', { to: [email], subject: 'Your access to ' + projectName + ' on ' + APP.name, html, replyTo: S.user.email });
}
