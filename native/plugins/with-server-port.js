// Port of the local Go server for the native side: android/gradle.properties gets seanime.serverPort, which the
// server module's build.gradle turns into BuildConfig.SERVER_PORT (SeanimeServerService.PORT). app.config.js passes the
// port of the variant in native/app-variants.json, the same file the JS side reads (src/lib/app-variant.ts).
const { withGradleProperties } = require('expo/config-plugins');

const KEY = 'seanime.serverPort';

module.exports = function withServerPort(config, { port }) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error(`with-server-port: invalid port ${port}`);
  return withGradleProperties(config, (mod) => {
    mod.modResults = mod.modResults.filter((item) => !(item.type === 'property' && item.key === KEY));
    mod.modResults.push({ type: 'property', key: KEY, value: String(port) });
    return mod;
  });
};
