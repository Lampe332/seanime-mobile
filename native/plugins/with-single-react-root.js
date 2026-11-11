// One React tree per process. Android can create a new MainActivity while the old one still holds its React surface:
// Android 16's package update relaunch (SystemUI PackageUpdateActivity) and every launch with FLAG_ACTIVITY_CLEAR_TASK
// start the new Activity first and destroy the old one afterwards. React Native then mounts the new tree and only
// unmounts the old one when the old Activity is destroyed. Both trees run in the same JS runtime and share module state:
// expo-router's global navigationRef, the default jotai store (websocket, player, playlist atoms). The old tree's late
// unmount empties that state under the new tree, e.g. navigationRef.current = null → router.setParams throws
// "Attempted to navigate before mounting the Root Layout component" (docs/NATIVE-UMBAU.md §9 09.11.2026).
// The new Activity therefore stops the old Activity's React surface before it loads its own: both go through React
// Native's single background executor and then the JS thread in order, so the old tree is gone before the new one mounts.
// The old Activity's own onDestroy later finds no surface and does nothing more.
const { withMainActivity } = require('expo/config-plugins');

const MARK = '// with-single-react-root';

function addSingleReactRoot(src) {
  if (src.includes(MARK)) return src;
  if (!/super\.onCreate\(/.test(src) || !/class MainActivity\s*:\s*ReactActivity\(\)\s*\{/.test(src)) {
    throw new Error('with-single-react-root: unexpected MainActivity.kt (no ReactActivity class or super.onCreate)');
  }
  return src
    .replace(/^(package [^\n]+\n)/, `$1import java.lang.ref.WeakReference ${MARK}\n`)
    .replace(
      /class MainActivity\s*:\s*ReactActivity\(\)\s*\{/,
      (m) => `${m}\n  ${MARK}: the Activity whose React surface is live\n  companion object {\n    private var liveActivity: WeakReference<MainActivity>? = null\n  }\n`,
    )
    .replace(
      /^(\s*)super\.onCreate\(/m,
      (_m, indent) =>
        `${indent}${MARK}: stop an older Activity's React surface before this one loads its own\n` +
        `${indent}liveActivity?.get()?.takeIf { it !== this }?.reactDelegate?.unloadApp()\n` +
        `${indent}liveActivity = WeakReference(this)\n` +
        `${indent}super.onCreate(`,
    );
}

module.exports = function withSingleReactRoot(config) {
  return withMainActivity(config, (mod) => {
    if (mod.modResults.language !== 'kt') throw new Error('with-single-react-root: MainActivity must be Kotlin');
    mod.modResults.contents = addSingleReactRoot(mod.modResults.contents);
    return mod;
  });
};
module.exports.addSingleReactRoot = addSingleReactRoot;
