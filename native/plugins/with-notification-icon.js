// Small status-bar icon of the app's own notifications (new episodes, updates): the bold "S" of the logo that the
// server module already ships as a vector (modules/seanime-server/android/src/main/res/drawable/ic_stat_seanime.xml,
// the old app's ic_stat_seanime). expo-notifications' own `icon` option only takes a PNG, so the meta-data it reads is
// pointed at the vector here. Listed before expo-notifications in app.json: manifest mods run last-listed first, and
// expo-notifications removes the entry when it has no icon of its own.
const { withAndroidManifest, AndroidConfig } = require('expo/config-plugins');

const ICON = 'expo.modules.notifications.default_notification_icon';

module.exports = function withNotificationIcon(config) {
  return withAndroidManifest(config, (mod) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults);
    AndroidConfig.Manifest.addMetaDataItemToMainApplication(app, ICON, '@drawable/ic_stat_seanime', 'resource');
    return mod;
  });
};
