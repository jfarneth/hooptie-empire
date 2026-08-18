import { adminEnabled } from './adminGate';

/** What a production `eas build --profile production --platform ios` produces. */
const RELEASE = { dev: false, platform: 'ios', envFlag: undefined };

describe('the admin gate', () => {
  it('is CLOSED in a signed iOS release', () => {
    expect(adminEnabled(RELEASE)).toBe(false);
  });

  it('is closed in a signed Android release too', () => {
    expect(adminEnabled({ ...RELEASE, platform: 'android' })).toBe(false);
  });

  // The three doors, each opened on its own so a broken one cannot hide behind
  // a working one — which is exactly what would happen testing them together.
  it('opens under Metro', () => {
    expect(adminEnabled({ ...RELEASE, dev: true })).toBe(true);
  });

  it('opens on the web build', () => {
    expect(adminEnabled({ ...RELEASE, platform: 'web' })).toBe(true);
  });

  it('opens for an internal build that asked for it', () => {
    expect(adminEnabled({ ...RELEASE, envFlag: '1' })).toBe(true);
  });

  // Metro inlines EXPO_PUBLIC_* as strings, so an unset variable arrives as
  // undefined and a `--profile production` build that never set it must not be
  // opened by, say, an empty string or the word "false".
  it.each(['', '0', 'false', 'no', 'undefined'])('stays closed for envFlag %p', (envFlag) => {
    expect(adminEnabled({ ...RELEASE, envFlag })).toBe(false);
  });
});
