import AsyncStorage from '@react-native-async-storage/async-storage';

const SEEN_KEY = 'hooptie.onboarded';

/**
 * Whether the player has been shown the opening coach marks.
 *
 * **This deliberately does NOT live in `GameState`.** Everything in the save
 * file is there because the simulation needs it with the app closed — a
 * negotiation, a timer, a note. Nothing about a coach mark resolves overnight,
 * so putting it there would buy a `SAVE_VERSION` bump, a migration and a line
 * in `cloneState()` in exchange for nothing at all.
 *
 * Keeping it out has a second, better property: it survives `hardReset`. Wiping
 * the save to watch a tuning change play out from hour zero should not make the
 * game start explaining itself again.
 */
export async function hasSeenOnboarding(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(SEEN_KEY)) !== null;
  } catch {
    // Never block the game on this. Worst case a returning player sees three
    // cards they can dismiss in two taps.
    return false;
  }
}

export async function markOnboardingSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(SEEN_KEY, '1');
  } catch {
    // Best effort, same reasoning.
  }
}
