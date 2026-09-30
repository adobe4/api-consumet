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
  // motion: "calm" stops every animation; flowing lights become still arrows (per device)
  var MKEY = 'flowmap.motion';
  var motion = 'full';
  try { motion = JSON.parse(localStorage.getItem(MKEY)) === 'calm' ? 'calm' : 'full'; } catch (e) { /* storage blocked */ }
  function applyMotion() { document.documentElement.setAttribute('data-motion', motion); }
  window.flowmapMotion = {
    get calm() { return motion === 'calm'; },
    set: function (v) {
      motion = v === 'calm' ? 'calm' : 'full';
      try { localStorage.setItem(MKEY, JSON.stringify(motion)); } catch (e) { /* storage blocked */ }
      applyMotion();
      try { window.dispatchEvent(new CustomEvent('flowmap-motion', { detail: motion })); } catch (e) { /* very old browser */ }
    },
  };
  applyMotion();
  if (mq) { if (mq.addEventListener) mq.addEventListener('change', apply); else if (mq.addListener) mq.addListener(apply); }
  apply();
})();
