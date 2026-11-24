// Companies Register check for a deed's warrantor. No AI: a button opens the register's own search for the company, the person
// copies the company's Directors page and pastes it here, and the names are read from that text and kept with the company in
// Contacts. The signers named on the deed are then compared with the directors on record.
import { S, can } from './state.js';
import { $, esc, toast, uid, nzDate } from './util.js';

const REG = 'https://app.companiesoffice.govt.nz';
const coKey = s => String(s || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/\b(limited|ltd|nz|new zealand|the)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
const full = s => String(s || '').toLowerCase().replace(/\bltd\b\.?/g, 'limited').replace(/[^a-z0-9]+/g, ' ').trim();
export const searchUrl = name => `${REG}/companies/app/ui/pages/companies/search?q=${encodeURIComponent(String(name || '').replace(/\b(limited|ltd)\b\.?/ig, '').replace(/\s+/g, ' ').trim())}&entityTypes=ALL&entityStatusGroups=ALL&mode=standard`;
const entry = name => (S.project.directory || []).find(x => coKey(x.company) === coKey(name) || (x.legal && coKey(x.legal) === coKey(name)) || (x.reg && coKey(x.reg.name) === coKey(name)));

// Read a pasted Directors page (or the single-page view) of the register
export function parse(text) {
  const t = String(text || '').replace(/\r/g, ''), head = /^\s*(.+?)\s*\((\d{3,9})\)\s*(Registered|Removed|In Liquidation|In Receivership|Voluntary Administration|External Administration|Struck Off)?/mi.exec(t);
  const directors = []; const re = /Full legal name:\s*\n?\s*(.+)/gi; let m;
  while ((m = re.exec(t))) { const name = m[1].trim(), rest = t.slice(m.index, m.index + 400), ap = /Appointment Date:\s*\n?\s*(\d{1,2} \w{3,9} \d{4})/i.exec(rest); if (name && !directors.some(d => d.name === name)) directors.push({ name, appointed: ap ? ap[1] : '' }); }
  const gen = /Generated on \w+,? (\d{1,2} \w+ \d{4})/i.exec(t), nzbn = /NZBN:?\s*(\d{13})/i.exec(t);
  return { name: head ? head[1].trim() : '', number: head ? head[2] : '', status: head && head[3] ? head[3] : '', nzbn: nzbn ? nzbn[1] : '', directors, generated: gen ? gen[1] : '' };
}
// does this director appear among the words naming the signers? (first given name and surname both present)
const signed = (dir, hay) => { const p = full(dir).split(' ').filter(Boolean); if (p.length < 2) return false; const h = ' ' + full(hay) + ' '; return h.includes(' ' + p[0] + ' ') && h.includes(' ' + p[p.length - 1] + ' '); };

export function html(d) {
  const c = d.sub && d.sub.check; if (!c || !c.warrantor || !['deed', 'sch19', 'sch18'].includes(d.sub.kind) && !String(d.sub.kind).startsWith('c:')) return '';
  const w = c.warrantor, e = entry(w), r = e && e.reg, ex = (c.items || []).find(i => i.k === 'exec'), hay = ex ? ex.found : '';
  let body = '';
  if (r) { const same = full(r.name) === full(w), by = r.directors.filter(x => signed(x.name, hay)), n = r.directors.length;
    const verdict = !n ? ['unk', 'No directors were read from what was pasted. Paste the Directors page again.']
      : r.status && !/^registered$/i.test(r.status) ? ['bad', `The register shows this company as ${r.status}.`]
      : n === 1 ? (by.length ? ['ok', 'Sole director, and that director signed. With a witness, this is a valid way to sign a deed.'] : ['bad', 'The sole director on the register is not named among the signers.'])
      : by.length >= 2 ? ['ok', `${by.length} of ${n} directors signed.`]
      : by.length === 1 ? ['bad', `The company has ${n} directors and only one is named among the signers. A deed needs two directors, unless the company's constitution allows one director with a witness. Ask for the second director, or the clause.`]
      : ['bad', 'None of the directors on the register is named among the signers.'];
    body = `<div class="ck ${same ? 'ok' : 'bad'}"><i>${same ? '✓' : '✗'}</i><div><b>${esc(r.name)} (${esc(r.number)})${r.status ? ' · ' + esc(r.status) : ''}</b><small>${same ? 'Matches the Warrantor named on the deed.' : `The deed names the Warrantor as “${esc(w)}”. The registered name is different: the deed should use the registered name.`}</small></div></div>
    <div class="ck ${verdict[0]}"><i>${verdict[0] === 'ok' ? '✓' : verdict[0] === 'bad' ? '✗' : '?'}</i><div><b>Directors on the register (${n})</b>${r.directors.map(x => `<small>${signed(x.name, hay) ? '✓ signed' : '· not among the signers'}: ${esc(x.name)}${x.appointed ? ', appointed ' + esc(x.appointed) : ''}</small>`).join('')}<small class="${verdict[0] === 'bad' ? 'fix' : ''}">${esc(verdict[1])}</small></div></div>
    <p class="muted small">Checked ${nzDate(r.checked)} by ${esc(r.by || '')}${r.generated ? ', register page dated ' + esc(r.generated) : ''}. <a href="${REG}/co/${esc(r.number)}" target="_blank" rel="noopener">Open on the register</a>. Signers are matched by name from the check's reading of the signature page: confirm by eye.</p>`; }
  return `<div class="creg"><p class="lbl2">Companies Register: ${esc(w)}</p>${body}
    <div class="sbact"><a class="btn2" href="${searchUrl(w)}" target="_blank" rel="noopener">🔎 Search the register</a>${can.edit() ? `<button class="btn2" id="crPaste">${r ? 'Update from the register' : 'Paste the Directors page'}</button>` : ''}</div>
    <div id="crBox" hidden><p class="muted small">On the register, open the company, click <b>Directors</b>, press Ctrl+A then Ctrl+C, and paste here.</p><textarea id="crT" rows="4" placeholder="Paste the Directors page here"></textarea><div class="sbact"><button class="btn2 go" id="crSave">Read and save</button></div></div></div>`;
}
export function wire(d, redraw) {
  if (!$('crPaste')) return; $('crPaste').onclick = () => { $('crBox').hidden = false; $('crT').focus(); };
  $('crSave').onclick = async () => { const r = parse($('crT').value); if (!r.number || !r.directors.length) return toast('That does not read as a Directors page from the Companies Register. Open the company, click Directors, then copy the whole page.', 9000);
    const w = d.sub.check.warrantor, dir = (S.project.directory || []).slice(), e = entry(w), i = e ? dir.indexOf(e) : -1, reg = { ...r, checked: new Date().toISOString(), by: S.user.email };
    const o = { ...(e || { id: uid(), company: w, role: 'Subcontractor', audience: 'FM' }), reg, nzbn: r.nzbn || (e && e.nzbn) || '', updated: reg.checked }; if (i > -1) dir[i] = o; else dir.push(o);
    try { await S.store.updateProject(S.project.id, { directory: dir }); S.project.directory = dir; toast(`${r.name}: ${r.directors.length} director${r.directors.length === 1 ? '' : 's'} saved to Contacts`, 5000); redraw && redraw(); } catch (err) { toast('Could not save: ' + (err.code || err.message), 8000); } };
}
