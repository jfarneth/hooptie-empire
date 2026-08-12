import { Platform } from 'react-native';
import { adminEnabled } from './adminGate';

/**
 * Whether the admin console is reachable at all.
 *
 * It sets cash to any number and edits every constant the economy is built
 * from, which in an idle game is a win button wearing a lab coat. That is
 * exactly what you want while building the thing and exactly what you do not
 * want in a signed App Store build, where the progression curve IS the product.
 *
 * Three ways in, and none of them is a runtime toggle a player could stumble
 * onto:
 *
 * - `__DEV__`, so it is always there under `expo start`. This is the one that
 *   matters day to day.
 * - the web target, which is the shared playable link and the verification
 *   surface rather than the product. CLAUDE.md is emphatic that you should look
 *   at the running game, and this is where you look at it.
 * - `EXPO_PUBLIC_ADMIN=1`, for an internal-distribution build you want to poke
 *   at on a real phone. Metro inlines `EXPO_PUBLIC_*` at bundle time, so the
 *   decision is baked into the binary and cannot be flipped afterwards.
 *
 * A production `eas build` sets none of the three, which is the point.
 *
 * Note this gates the ROUTE, not the actions behind it. `setTuning` and
 * `setCash` remain ordinary sim functions with their own tests — hiding a
 * screen is a product decision, and quietly breaking the functions under it
 * would make the dev build stop testing the thing the release build ships.
 */
export const ADMIN_ENABLED = adminEnabled({
  dev: __DEV__,
  platform: Platform.OS,
  envFlag: process.env.EXPO_PUBLIC_ADMIN,
});
