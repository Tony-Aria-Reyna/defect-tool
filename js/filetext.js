// Read the words out of a dropped or stored file so the AI can summarise it or suggest where it is filed:
// PDFs (text layer), emails (.eml, and Outlook .msg by pulling its readable text), plain text; photos as a small JPEG.
import * as DV from './docview.js';

const ext = n => String(n || '').split('.').pop().toLowerCase();
export const isImage = n => /^(jpe?g|png|webp|gif|heic|bmp)$/.test(ext(n));
export const isEmail = n => /^(eml|msg)$/.test(ext(n));

// quoted-printable and simple HTML to plain text
const unQP = s => s.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
const unHtml = s => s.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<br\s*\/?>|<\/p>|<\/div>|<\/tr>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&rsquo;/g, "'").replace(/[ \t]+/g, ' ');
function emlText(raw) {
  const head = raw.split(/\r?\n\r?\n/)[0], h = k => ((new RegExp('^' + k + ':\\s*(.*)$', 'im').exec(head) || [])[1] || '').trim();
  let body = raw.slice(head.length);
  const plain = /Content-Type:\s*text\/plain[\s\S]*?\r?\n\r?\n([\s\S]*?)(\r?\n--|$)/i.exec(body), html = /Content-Type:\s*text\/html[\s\S]*?\r?\n\r?\n([\s\S]*?)(\r?\n--|$)/i.exec(body);
  body = plain ? plain[1] : html ? unHtml(html[1]) : body; if (/quoted-printable/i.test(raw)) body = unQP(body);
  return `From: ${h('From')}\nTo: ${h('To')}\nDate: ${h('Date')}\nSubject: ${h('Subject')}\n\n${body.replace(/\n{3,}/g, '\n\n').trim()}`;
}
// Outlook .msg is a compound file; its subject, people and body are stored as UTF-16 text. Pull out the readable runs.
function msgText(buf) {
  const u8 = new Uint8Array(buf), out = [], seen = new Set();
  let run = '';
  const push = () => { const t = run.trim(); if (t.length >= 12 && !seen.has(t) && /[a-z]{3}/i.test(t) && !/^[\x20-\x2f\d]+$/.test(t)) { seen.add(t); out.push(t); } run = ''; };
  for (let i = 0; i + 1 < u8.length; i += 2) { const c = u8[i] | (u8[i + 1] << 8); if ((c >= 32 && c < 0xd800 && c !== 0xfffd) || c === 10 || c === 13 || c === 9) run += String.fromCharCode(c); else push(); }
  push();
  // drop RTF and header noise, keep the longest pieces (the body) first, in their original order
  // keep sentences (several words), not property names or encoded data; the longest (the body) first
  // keep sentences (several words), not property names, JSON or encoded data; long tracking links are trimmed out
  return out.map(t => t.replace(/<https?:\/\/[^>\s]{60,}>|https?:\/\/\S{80,}/g, '')).filter(t => t.split(/\s+/).length >= 6 && !/^\{\\rtf|^\s*[\[{"]|__substg|x-ms-|schema\.|spf=|IDXHEAD|Microsoft Exchange|antispam/i.test(t)).join('\n\n').replace(/[ \t\u00a0]+\n/g, '\n').replace(/\n\s*\n(\s*\n)+/g, '\n\n');
}
export async function textOf(bytes, name, max = 12000) {
  const e = ext(name);
  try {
    if (e === 'pdf') { const lib = await DV.pdfLib(), pdf = await lib.getDocument({ data: new Uint8Array(bytes) }).promise; let t = '';
      for (let p = 1; p <= Math.min(pdf.numPages, 15) && t.length < max; p++) { const c = await (await pdf.getPage(p)).getTextContent(); t += c.items.map(i => i.str).join(' ') + '\n'; }
      return t.replace(/[ \t]+/g, ' ').slice(0, max); }
    if (e === 'eml') return emlText(new TextDecoder().decode(bytes)).slice(0, max);
    if (e === 'msg') { // newer Outlook keeps the body as HTML (8-bit), older as UTF-16 text: use the HTML when it is there
      const raw = new TextDecoder('utf-8', { fatal: false }).decode(bytes), i = raw.search(/<html/i), j = raw.search(/<\/html>/i);
      const html = i >= 0 && j > i ? unHtml(raw.slice(i, j)).replace(/\n\s*\n\s*\n+/g, '\n\n').trim() : '';
      const subj = (/Subject:\s*([^\r\n]+)/.exec(raw) || [])[1] || '';
      return ((subj ? 'Subject: ' + subj + '\n\n' : '') + (html.length > 200 ? html : msgText(bytes))).slice(0, max); }
    if (/^(txt|csv|md|htm|html)$/.test(e)) { const s = new TextDecoder().decode(bytes); return (/htm/.test(e) ? unHtml(s) : s).slice(0, max); }
  } catch (x) { console.warn('textOf', name, x); }
  return '';
}
// a photo as a JPEG data URL no wider than 1600 px, for the AI to look at
export async function imageData(blob) {
  const url = URL.createObjectURL(blob);
  try { const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = url; });
    const k = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); return c.toDataURL('image/jpeg', 0.82); }
  catch (e) { return ''; } finally { URL.revokeObjectURL(url); }
}
