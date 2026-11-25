const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');
const { withUniwindConfig } = require('uniwind/metro');
const { current } = require('./app-variants.json');

const config = getDefaultConfig(__dirname);

// Anime4K's mpv shaders (assets/shaders/anime4k) are bundled as assets; the player hands their paths to mpv
// (src/main/_features/player/player-anime4k-files.ts).
config.resolver.assetExts.push('glsl');

// Developer checks that only the test and scratch apps run: the release bundle (app-variants.json "release", set by
// scripts/build-android.ps1 -Release in its staged copy) gets an empty module in their place.
const DEVELOPER_ONLY = new Set([path.join(__dirname, 'src', 'lib', 'account-sodium-selftest.ts')]);
if (current === 'release') {
  const base = config.resolver.resolveRequest;
  config.resolver.resolveRequest = (context, moduleName, platform) => {
    const resolved = (base ?? context.resolveRequest)(context, moduleName, platform);
    return resolved.type === 'sourceFile' && DEVELOPER_ONLY.has(path.normalize(resolved.filePath)) ? { type: 'empty' } : resolved;
  };
}

// withUniwindConfig must stay the outermost wrapper.
module.exports = withUniwindConfig(config, {
  cssEntryFile: './src/global.css',
  dtsFile: './src/uniwind-types.d.ts',
});
