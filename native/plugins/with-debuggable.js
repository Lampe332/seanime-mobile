// Makes the release build debuggable, so `adb shell run-as <package>` can read the app's own files (seanime.db).
// Only for the throw-away variant "scratch" (app-variants.json "debuggable": true) and for a one-off test build
// (scripts/build-android.ps1 -Debuggable). Never for "release": build-android.ps1 refuses -Debuggable with -Release.
// Set in the Gradle build type, not in the manifest: a hard-coded android:debuggable fails the release lint check.
const { withAppBuildGradle } = require('expo/config-plugins');

module.exports = function withDebuggable(config) {
  return withAppBuildGradle(config, (mod) => {
    const pattern = /(buildTypes\s*\{[\s\S]*?\n\s*release\s*\{)/;
    if (!pattern.test(mod.modResults.contents)) throw new Error('with-debuggable: release build type not found');
    mod.modResults.contents = mod.modResults.contents.replace(pattern, '$1\n            debuggable true');
    return mod;
  });
};
