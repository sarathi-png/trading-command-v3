/**
 * Metro configuration.
 *
 * The Lightweight Charts build is bundled with the app as a TEXT asset rather
 * than a module: it is browser JavaScript that assigns to `window`, so it must
 * never be executed inside the React Native runtime. It is read as a string
 * and inlined into the WebView page instead.
 *
 * Metro treats `.js` as a source extension, so the file is named `.txt` and
 * `txt` is registered as an asset extension here.
 */
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

if (!config.resolver.assetExts.includes("txt")) {
  config.resolver.assetExts.push("txt");
}

module.exports = config;
