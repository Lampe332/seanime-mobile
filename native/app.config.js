// The parts of the app config that differ between the test app and the release that replaces Seanime Mobile 2.0.33
// (E6, docs/NATIVE-UMBAU.md §2.4/§9). app-variants.json `current` stays "test" in the repository;
// scripts/build-android.ps1 -Release sets it to "release" in its staged copy only, so the checkout never changes.
const { current, variants } = require('./app-variants.json');

module.exports = ({ config }) => {
  const variant = variants[current];
  if (!variant) throw new Error(`app-variants.json: unknown variant "${current}"`);
  const plugins = (config.plugins ?? []).map((plugin) => {
    // the widget picker shows the launcher icon of the build
    if (Array.isArray(plugin) && plugin[0] === 'react-native-android-widget') {
      return [plugin[0], { ...plugin[1], widgets: plugin[1].widgets.map((widget) => ({ ...widget, previewImage: variant.icon })) }];
    }
    return plugin;
  });
  return {
    ...config,
    name: variant.name,
    scheme: variant.scheme,
    icon: variant.icon,
    android: {
      ...config.android,
      versionCode: variant.versionCode,
      adaptiveIcon: { ...config.android.adaptiveIcon, backgroundImage: variant.adaptiveIconBackground },
    },
    plugins: [
      ...plugins,
      ['./plugins/with-application-id', { applicationId: variant.applicationId }],
      ['./plugins/with-server-port', { port: variant.serverPort }],
    ],
  };
};
