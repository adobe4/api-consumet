// Applies the saved theme before the page paints. "system" follows the device's light/dark setting.
// Loaded as a classic script in <head>; the app talks to it through window.flowmapTheme.
(function () {
  var KEY = 'flowmap.theme';
  var pref = 'system';
  try { pref = JSON.parse(localStorage.getItem(KEY)) || 'system'; } catch (e) { /* storage blocked */ }
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
  function resolved() { return pref === 'system' ? (mq && mq.matches ? 'light' : 'dark') : pref; }
  function apply() {
    var t = resolved();
    document.documentElement.setAttribute('data-theme', t);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'light' ? '#f3eee7' : '#0a0a0b');
    try { window.dispatchEvent(new CustomEvent('flowmap-theme', { detail: t })); } catch (e) { /* very old browser */ }
  }
  window.flowmapTheme = {
    get pref() { return pref; },
    get current() { return resolved(); },
    set: function (p) {
      pref = p === 'light' || p === 'dark' ? p : 'system';
      try { localStorage.setItem(KEY, JSON.stringify(pref)); } catch (e) { /* storage blocked */ }
      apply();
    },
  };
  if (mq) { if (mq.addEventListener) mq.addEventListener('change', apply); else if (mq.addListener) mq.addListener(apply); }
  apply();
})();
