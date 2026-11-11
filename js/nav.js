// Back-button handling (Android and browser back): overlays close one at a time, and leaving the app asks first.
const stack = [];          // {name, close}
let ignore = 0, armed = false;
export function open(name, close) { stack.push({ name, close }); history.pushState({ ov: name, n: stack.length }, ''); }
// Called by an overlay's own close function; if that overlay is on top, step the history back without re-closing.
export function closed(name) { const i = stack.map(s => s.name).lastIndexOf(name); if (i < 0) return; stack.splice(i); if (history.state && history.state.ov) { ignore++; history.back(); } }
export function isOpen(name) { return stack.some(s => s.name === name); }
export function init(onLeave) {
  if (!history.state || !history.state.guard) history.replaceState({ guard: 1 }, '');
  history.pushState({ root: 1 }, '');   // the app's main screen sits one step above the guard
  armed = true;
  addEventListener('popstate', e => {
    const atGuard = !e.state || !!e.state.guard;      // never rest on the guard entry: one more back would leave the app silently
    if (atGuard) history.pushState({ root: 1 }, '');
    if (ignore > 0) { ignore--; return; }
    if (stack.length) { const o = stack.pop(); try { o.close(); } catch (x) {} return; }
    if (e.state && e.state.ov) { history.back(); return; }   // stale overlay entry left by a race: step past it
    if (atGuard) onLeave();
  });
}
export function leave() { ignore++; history.go(-2); setTimeout(() => { try { window.close(); } catch (e) {} }, 300); }
// Textareas grow with their content
export function refit(root) { (root || document).querySelectorAll('textarea').forEach(t => { t.style.height = 'auto'; t.style.height = Math.min(600, t.scrollHeight + 2) + 'px'; }); }
export function autosize(root) { (root || document).querySelectorAll('textarea').forEach(t => { if (t.dataset.auto) return; t.dataset.auto = '1'; const fit = () => { t.style.height = 'auto'; t.style.height = Math.min(600, t.scrollHeight + 2) + 'px'; }; t.addEventListener('input', fit); requestAnimationFrame(fit); }); }
new MutationObserver(() => autosize()).observe(document.documentElement, { childList: true, subtree: true });
