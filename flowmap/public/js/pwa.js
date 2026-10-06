// Installs the service worker (sw.js) and, when a new version of FlowMap has been downloaded in the
// background, offers a one-tap switch to it.
const local = ['localhost', '127.0.0.1'].includes(location.hostname);

export function initPwa() {
  if (!('serviceWorker' in navigator)) return;
  if (local && localStorage.getItem('flowmap.sw') !== '1') return; // development: always the files on disk
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('/sw.js').then((reg) => {
    // a phone app can stay open for days: look for a new version whenever it comes back to the front
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
  }).catch(() => {});
  let shown = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || shown) return; // the very first install changes nothing on screen
    shown = true;
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'update-pill';
    pill.textContent = '✨ FlowMap was updated. Tap to reload';
    pill.onclick = () => location.reload();
    document.body.append(pill);
  });
}
