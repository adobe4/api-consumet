// The Android app wraps this site in a WebView and adds a small bridge, window.FlowMapAndroid. These helpers use
// it when it is there and fall back to the browser's own way when it is not (desktop, mobile browsers).
// Keep this file free of imports: util.js depends on it.
const bridge = typeof window !== 'undefined' ? window.FlowMapAndroid : null;
export const inApp = !!bridge;
if (inApp) {
  document.documentElement.classList.add('in-app');
  // a WebView's clipboard and print can fail quietly; send every caller through the app instead
  try { if (bridge.copy && navigator.clipboard) navigator.clipboard.writeText = (t) => { bridge.copy(String(t)); return Promise.resolve(); }; } catch { /* read-only */ }
  if (bridge.print) window.print = () => bridge.print(document.title || 'FlowMap');
}

// save a file the person asked for (exports, invoices as CSV, attached files)
export async function saveFile(name, blob) {
  if (bridge?.saveFile) {
    const b64 = await new Promise((ok, bad) => {
      const r = new FileReader();
      r.onload = () => ok(String(r.result).split(',')[1] || '');
      r.onerror = () => bad(r.error);
      r.readAsDataURL(blob);
    });
    const err = bridge.saveFile(name, blob.type || 'application/octet-stream', b64);
    if (err) throw new Error(err);
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.hidden = true;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// print what is on screen (the page's print CSS decides what that is); resolves when printing is over
export function printPage(title = 'FlowMap') {
  if (bridge?.print) {
    return new Promise((done) => {
      const t = setTimeout(finish, 120000);
      function finish() { clearTimeout(t); window.__fmPrinted = null; done(); }
      window.__fmPrinted = finish;
      bridge.print(title);
    });
  }
  return new Promise((done) => {
    let over = false;
    const finish = () => { if (over) return; over = true; window.removeEventListener('afterprint', finish); done(); };
    window.addEventListener('afterprint', finish);
    window.print();
    setTimeout(finish, 1500); // some browsers never send afterprint
  });
}

// the phone's share sheet (WhatsApp, SMS…). Returns false when there is none, so the caller can copy instead.
export const canShare = () => !!(bridge?.share || navigator.share);
export async function shareText({ title = '', text = '', url = '' }) {
  if (bridge?.share) { bridge.share(title, text, url); return true; }
  if (navigator.share) { try { await navigator.share({ title, text, url }); } catch { /* closed */ } return true; }
  return false;
}

export async function copyText(text) {
  if (bridge?.copy) { bridge.copy(text); return; }
  await navigator.clipboard.writeText(text);
}

// a light tick under the finger (long press, snapping)
export function haptic(kind = 'tick') {
  if (bridge?.haptic) bridge.haptic(kind);
  else navigator.vibrate?.(kind === 'heavy' ? 18 : 8);
}

export function appReady() { bridge?.ready?.(); }

// Android back button / back gesture. Handlers are asked newest first; the first one that returns true used it.
// When nobody does, the app goes back a page or closes.
const backs = [];
export function onBack(fn) { backs.push(fn); return () => { const i = backs.indexOf(fn); if (i >= 0) backs.splice(i, 1); }; }
if (typeof window !== 'undefined') {
  window.__fmBack = () => {
    for (let i = backs.length - 1; i >= 0; i--) { try { if (backs[i]()) return true; } catch (e) { console.warn(e); } }
    return false;
  };
}
