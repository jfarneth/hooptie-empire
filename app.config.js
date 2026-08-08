/**
 * Dynamic Expo config, layered on top of app.json.
 *
 * Its only job is the web base path. GitHub Pages serves a project site from a
 * subpath (`/<repo>/`), but `expo export` writes absolute asset URLs by
 * default — so without a base URL the deployed page requests `/_expo/...`,
 * misses, and renders blank.
 *
 * It is read from the environment rather than hard-coded so the local dev server
 * and native builds, which are served from the root, are unaffected. The deploy
 * workflow sets EXPO_WEB_BASE_URL; nothing else does.
 */
module.exports = ({ config }) => ({
  ...config,
  experiments: {
    ...config.experiments,
    ...(process.env.EXPO_WEB_BASE_URL ? { baseUrl: process.env.EXPO_WEB_BASE_URL } : {}),
  },
});
