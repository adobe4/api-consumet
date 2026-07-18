// Expo config plugin: set android:largeHeap="true" on the application tag.
// Media-heavy sessions (dozens of photos + Skia preview) need the headroom on
// low-RAM devices; without it bulk imports can OOM-crash the app.
const { withAndroidManifest } = require('expo/config-plugins');

module.exports = function withLargeHeap(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    if (app) {
      app.$ = app.$ || {};
      app.$['android:largeHeap'] = 'true';
    }
    return cfg;
  });
};
