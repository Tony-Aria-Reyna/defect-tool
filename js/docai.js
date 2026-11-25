// AI document reading: reads a PDF, draws a box around each thing that matters (parties, period, dates, signatures, conditions),
// links each box to the assets it covers and the contract requirement it meets, and flags problems. Every box starts as "to check".
import { S, can } from './state.js';
import { aiCall } from './ai.js';
import { loadPdf, pdfLib, isPdf } from './docview.js';
import { uid } from './util.js';
import { note as noteContacts } from './contacts.js';

const fm = () => S.fm || { assets: [], docs: [] };
const nrm = t => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const KIND_OK = ['Warranty period', 'Parties', 'Execution and signatures', 'Date', 'Condition or exclusion', 'Maintenance requirement', 'Product or finish detail', 'Other'];
export const isWarranty = d => /warrant|deed|guarantee/i.test((d.type || '') + ' ' + (d.title || ''));
export const pendingCount = d => (d.marks || []).filter(m => m.pending).length;
export const needsCheck = d => pendingCount(d) > 0 || (d.aiProblems || []).length > 0;

// the words on a page with where each run sits (fractions of the page)
async function pageRuns(L, pg) {
  const vp = pg.getViewport({ scale: 1 }), W = vp.width, H = vp.height, tc = await pg.getTextContent();
  const runs = tc.items.filter(it => it.str && it.str.trim()).map(it => { const tx = L.Util.transform(vp.transform, it.transform), h = Math.hypot(tx[2], tx[3]) || 8; return { s: it.str, x: tx[4] / W, y: (tx[5] - h) / H, w: (it.width * vp.scale) / W, h: (h * 1.15) / H }; });
  // A fillable form keeps what was typed in its fields, not in the page text: read each filled field in as words where it sits,
  // so a deed completed in a PDF viewer is read the same as a printed one.
  let n = 0; try { for (const an of await pg.getAnnotations()) { const v = an.fieldValue; if (an.subtype !== 'Widget' || typeof v !== 'string' || !v.trim() || v === 'Off' || !an.rect) continue;
      const r = vp.convertToViewportRectangle(an.rect), x0 = Math.min(r[0], r[2]), y0 = Math.min(r[1], r[3]), w = Math.abs(r[2] - r[0]), h = Math.abs(r[3] - r[1]);
      runs.push({ s: v.replace(/\s+/g, ' ').trim(), x: x0 / W, y: y0 / H, w: w / W, h: h / H, field: 1 }); n++; } } catch (e) {}
  if (n) runs.sort((p, q) => Math.abs(p.y - q.y) < 0.008 ? p.x - q.x : p.y - q.y);
  return runs;
}
// find a quoted phrase among the runs of a page and return the box around it
function locate(runs, quote) {
  let all = '', map = []; runs.forEach((r, i) => { const t = nrm(r.s); for (let k = 0; k < t.length; k++) map.push(i); all += t; });
  const q = nrm(quote); if (q.length < 6) return null;
  for (const len of [q.length, 60, 40, 24, 14]) { if (len > q.length) continue; const part = q.slice(0, len), at = all.indexOf(part); if (at < 0) continue;
    const end = Math.min(all.length - 1, at + (len === q.length ? q.length : Math.min(q.length, 160)) - 1), rs = [...new Set(map.slice(at, end + 1))].map(i => runs[i]);
    const x0 = Math.min(...rs.map(r => r.x)), y0 = Math.min(...rs.map(r => r.y)), x1 = Math.max(...rs.map(r => r.x + r.w)), y1 = Math.max(...rs.map(r => r.y + r.h));
    const c = v => Math.max(0, Math.min(1, v)); return { x: c(x0 - 0.008), y: c(y0 - 0.004), w: c(x1 - x0 + 0.016), h: c(y1 - y0 + 0.008) }; }
  return null;
}
async function pageImage(pg) { const b = pg.getViewport({ scale: 1 }), vp = pg.getViewport({ scale: Math.min(2, 1500 / Math.max(b.width, b.height)) }), c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height); await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise; return c.toDataURL('image/jpeg', 0.8); }
const parse = out => { const t = String(out || '').replace(/^```(?:json)?\s*|\s*```$/g, ''); try { return JSON.parse(t); } catch (e) { const m = /\{[\s\S]*\}/.exec(t); if (m) try { return JSON.parse(m[0]); } catch (x) {} } return null; };

function brief(d, assets) {
  const p = S.project;
  return `You are checking a handover document on a New Zealand construction project for the client's project manager.
PROJECT: ${p.name || ''}, ${p.address || ''}. Principal (client): ${p.client || ''}. Contractor: ${p.contractor || ''}. Contract: ${p.contract || 'NZS 3916:2013'}.
${p.aiContext ? 'PROJECT KNOWLEDGE: ' + String(p.aiContext).slice(0, 16000) + '\n' : ''}DOCUMENT: "${d.title}" (filed as ${d.type || 'unknown type'}, building system ${d.system || 'not set'}).
ASSET REGISTER (ref | element | installer | warranty required):
${assets.map(a => `${a.ref} | ${a.element} | ${a.installer || ''} | ${[a.instWarranty, a.mfrWarranty].filter(x => x && x !== '-').join('; ')}`).join('\n')}

Find each of these where present: the parties named (is the Principal named correctly?), what works or product are covered, the warranty or guarantee period and when it starts, every date (flag blanks and placeholders such as "[insert date]"), the execution or signature block (who signed, in what capacity, is there a witness, which signature blocks are blank), maintenance conditions the warranty depends on, and significant exclusions.
A "problem" is something the project manager must get corrected: wrong or missing party, wrong entity signing, blank date or placeholder, unsigned or unwitnessed deed, period shorter than required, document for the wrong project. Do not invent problems; leave problem empty when the item is in order.
Return JSON only:
{"summary":"one or two sentences: what this is, who gave it, period","party":"company giving the warranty or issuing the document","period":"e.g. 10 years from practical completion, or empty","assetRefs":["refs from the register this document covers, at most 4"],"problems":["problems about the document as a whole that have no single location"],"findings":[{"page":1,"quote":"QUOTE","kind":"one of: ${KIND_OK.join(', ')}","label":"short label, e.g. Warranty period","value":"what it says, short","clause":"contract requirement this meets, e.g. Schedule 13, SC 11.5, or empty","problem":"empty, or what is wrong"}]}
At most 12 findings. New Zealand English. No em dashes.`;
}

// Read one document. Returns { marks, problems }.
export async function readDoc(d, onProg = () => {}) {
  if (!isPdf(d)) throw new Error('Only PDF documents can be read');
  const L = await pdfLib(), pdf = await loadPdf(d), n = pdf.numPages;
  try {
    const want = n <= 12 ? [...Array(n)].map((_, i) => i + 1) : [1, 2, 3, 4, 5, 6, 7, 8, n - 3, n - 2, n - 1, n];
    const pages = []; let chars = 0;
    for (const p of want) { onProg(`reading page ${p} of ${n}`); const pg = await pdf.getPage(p), runs = await pageRuns(L, pg), t = runs.map(r => r.s).join(' ').replace(/\s+/g, ' ').trim(); chars += t.length; pages.push({ p, pg, runs, t }); }
    noteContacts(d, pages.map(x => x.t).join(' \n '));
    const sysA = fm().assets.filter(a => !d.system || a.system === d.system || /^00/.test(a.system || '')), assets = (sysA.length >= 3 ? sysA : fm().assets).slice(0, 120), base = brief(d, assets);
    let J = { findings: [], problems: [] };
    const scanned = chars < 60 * pages.length;
    if (!scanned) {
      onProg('asking the AI');
      const txt = pages.map(x => `--- PAGE ${x.p} ---\n${x.t.slice(0, 2600)}`).join('\n').slice(0, 26000);
      const j = parse(await aiCall(base.replace('"QUOTE"', '"8 to 20 words copied exactly from the page so the place can be found"') + '\n\nTHE DOCUMENT TEXT\n' + txt));
      if (!j) throw new Error('The AI answer could not be read'); J = j;
    } else {   // a scan: the AI looks at pictures of the first two and last two pages and gives each box as fractions of the page
      const pick = [...new Set([1, 2, n - 1, n].filter(p => p >= 1 && p <= n))];
      for (const p of pick) { onProg(`asking the AI about page ${p} (scanned)`); const pg = pages.find(x => x.p === p)?.pg || await pdf.getPage(p);
        const j = parse(await aiCall(base.replace('"quote":"QUOTE"', '"box":[x,y,w,h] as fractions 0 to 1 of the page width and height, measured from the top left, drawn tightly around the text,"quote":"the words inside the box"') + `\n\nThis is a scanned document. The picture is page ${p} of ${n}. Report only what is on this page, with "page":${p}.`, await pageImage(pg)));
        if (!j) continue; J.summary = J.summary || j.summary; J.party = J.party || j.party; J.period = J.period || j.period; J.assetRefs = [...new Set([...(J.assetRefs || []), ...(j.assetRefs || [])])]; J.problems.push(...(j.problems || [])); J.findings.push(...(j.findings || [])); }
      if (!J.findings.length && !J.summary) throw new Error('The AI could not read the scan');
    }
    const byRef = r => fm().assets.find(a => nrm(a.ref) === nrm(r)), docAssets = [...new Set((J.assetRefs || []).map(byRef).filter(Boolean).map(a => a.id))].slice(0, 4);
    const now = new Date().toISOString(), marks = [];
    for (const f of (J.findings || []).slice(0, 14)) {
      const pn = Math.max(1, Math.min(n, +f.page || 1)), pgx = pages.find(x => x.p === pn); let box = null;
      if (Array.isArray(f.box) && f.box.length === 4 && f.box.every(v => typeof v === 'number')) { const [x, y, w, h] = f.box.map(v => Math.max(0, Math.min(1, v))); if (w > 0.01 && h > 0.005) box = { x, y, w: Math.min(w, 1 - x), h: Math.min(h, 1 - y) }; }
      if (!box && pgx) box = locate(pgx.runs, f.quote);
      const lost = !box; if (!box) box = { x: 0.04, y: 0.02 + 0.045 * marks.filter(m => m.page === pn && m.lost).length, w: 0.92, h: 0.04 };
      marks.push({ id: uid(), page: pn, ...box, kind: KIND_OK.includes(f.kind) ? f.kind : 'Other', period: [f.label, f.value].filter(Boolean).join(': ').slice(0, 160), clause: String(f.clause || '').slice(0, 40), text: String(f.quote || '').slice(0, 600), note: lost ? 'The AI could not pin this to an exact place on the page. Move the box when you check it.' : '', flag: String(f.problem || '').slice(0, 300), assetIds: docAssets, taskIds: [], ai: true, pending: true, lost: lost || undefined, updated: now, by: 'AI' });
    }
    const problems = [...new Set([...(J.problems || []), ...marks.filter(m => m.flag).map(m => m.flag)].map(x => String(x).trim()).filter(Boolean))].slice(0, 10);
    const keep = (d.marks || []).filter(m => !(m.ai && m.pending));   // boxes a person drew or accepted are never replaced
    const patch = { marks: [...keep, ...marks].map(m => JSON.parse(JSON.stringify(m))), aiRead: now, aiSummary: String(J.summary || '').slice(0, 400), aiProblems: problems, aiVia: (aiCall.last && aiCall.last.via) || '' };
    if (J.party && !d.party) patch.party = String(J.party).slice(0, 80);
    if (docAssets.length) patch.assetIds = [...new Set([...(d.assetIds || []), ...docAssets])];
    await S.store.patchItem(S.project.id, 'docs', d.id, patch);
    // the asset follows the document: problems make it "Revision required"; a clean warranty lifts "Not received" to "Partial" until a person confirms it
    if (isWarranty(d)) for (const id of docAssets) { const a = fm().assets.find(x => x.id === id); if (!a || !['Not received', 'Partial'].includes(a.status)) continue;
      const st = problems.length ? 'Revision required' : 'Partial', note = `AI read ${now.slice(0, 10)} of "${d.title}": ${problems.length ? problems.join(' ') : 'no problems found; to be confirmed.'}`;
      if (st !== a.status || !String(a.notes || '').includes(d.title)) await S.store.patchItem(S.project.id, 'assets', id, { status: st, notes: ((a.notes ? a.notes + ' | ' : '') + note).slice(0, 1500) }); }
    return { marks, problems };
  } finally { try { pdf.destroy(); } catch (e) {} }
}

export { pageRuns, locate, pageImage, parse };
