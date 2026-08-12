/**
 * Whether a build may reach the admin console — the decision, with nothing
 * imported.
 *
 * Split out from `devTools.ts` purely so it can be tested. That file touches
 * `Platform`, which drags react-native into a suite that runs in plain node,
 * and the one thing about this rule worth guarding is the case no human will
 * ever look at: a signed iOS release. Every other combination is visible the
 * moment you run the app, and that one is only visible after review.
 *
 * Getting it backwards ships a cash field to the App Store.
 */
export function adminEnabled(opts: {
  /** React Native's `__DEV__` — true under Metro, false in any release bundle. */
  dev: boolean;
  /** `Platform.OS`. */
  platform: string;
  /** `process.env.EXPO_PUBLIC_ADMIN`, inlined by Metro at bundle time. */
  envFlag?: string;
}): boolean {
  return opts.dev || opts.platform === 'web' || opts.envFlag === '1';
}
