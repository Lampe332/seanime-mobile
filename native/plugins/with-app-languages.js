// 4.3.0: the app's languages in Android's settings ("App languages", Android 13 and later). Writes
// res/xml/locales_config.xml with the app's languages (app.json, the same list as APP_LANGUAGES in lib/app-language.ts,
// android-app-language.test.ts checks it), points the application's android:localeConfig at it, and adds locale and
// layoutDirection to MainActivity's configChanges: a language set from the app (CoreDownloadModule setAppLocales) or in
// Android's settings then changes the configuration without recreating the screen; lib/android-app-language-run.ts
// takes Android's pick when the app is in front again.
const fs = require('fs');
const path = require('path');
const { AndroidConfig, withAndroidManifest, withDangerousMod } = require('expo/config-plugins');

const CHANGES = ['locale', 'layoutDirection'];

function localesConfig(languages) {
  const lines = languages.map((language) => `    <locale android:name="${language}" />`);
  return ['<?xml version="1.0" encoding="utf-8"?>', '<locale-config xmlns:android="http://schemas.android.com/apk/res/android">', ...lines, '</locale-config>', ''].join('\n');
}

module.exports = function withAppLanguages(config, { languages } = {}) {
  if (!Array.isArray(languages) || languages.length === 0) throw new Error('with-app-languages: no languages');

  config = withDangerousMod(config, [
    'android',
    async (mod) => {
      const folder = path.join(mod.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'xml');
      fs.mkdirSync(folder, { recursive: true });
      fs.writeFileSync(path.join(folder, 'locales_config.xml'), localesConfig(languages));
      return mod;
    },
  ]);

  return withAndroidManifest(config, (mod) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults);
    application.$['android:localeConfig'] = '@xml/locales_config';
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(mod.modResults);
    const changes = (activity.$['android:configChanges'] ?? '').split('|').filter(Boolean);
    activity.$['android:configChanges'] = [...changes, ...CHANGES.filter((change) => !changes.includes(change))].join('|');
    return mod;
  });
};
