// Expo uses android.package for both applicationId and the Gradle namespace. The test package
// com.seanime.app.native cannot be a namespace ("native" is a Java keyword), so android.package keeps a valid
// namespace (com.seanime.app.nativeapp, also the Kotlin package of MainActivity) and only the installed
// applicationId is replaced here. E6 drops this plugin when the app becomes com.seanime.app.local.
const { withAppBuildGradle } = require('expo/config-plugins');

module.exports = function withApplicationId(config, { applicationId }) {
  return withAppBuildGradle(config, (mod) => {
    const pattern = /applicationId ['"][^'"]+['"]/;
    if (!pattern.test(mod.modResults.contents)) throw new Error('with-application-id: applicationId line not found');
    mod.modResults.contents = mod.modResults.contents.replace(pattern, `applicationId '${applicationId}'`);
    return mod;
  });
};
