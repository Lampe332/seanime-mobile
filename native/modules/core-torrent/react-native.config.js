// geschrieben nach: öffentlicher Doku der React-Native-Autoverlinkung (react-native.config.js einer Bibliothek); keine Vorlage

// Found by the app's autolinking in modules/ (Expo: nativeModulesDir) as a React Native library: Android from android/.
// iOS is left out on purpose: there is no podspec yet (docs/EIGENER-KERN.md §4q, libtorrent for iOS is not built).
module.exports = {
    dependency: {
        platforms: {
            android: {},
        },
    },
}
