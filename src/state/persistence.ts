import AsyncStorage from '@react-native-async-storage/async-storage';
import { deserialize, serialize } from '../sim/save';
import type { GameState } from '../sim/types';

const SAVE_KEY = 'hooptie.save';

/**
 * Storage keys this game has used before, newest first. A rename must not cost
 * anyone their portfolio — the same reason the save format carries migrations.
 * Reads fall through to these, and the next write lands on the current key.
 *
 * Safe to delete once no install could still be on an older key.
 */
const LEGACY_SAVE_KEYS = ['curbstone.save'];

export async function writeSave(state: GameState): Promise<void> {
  try {
    await AsyncStorage.setItem(SAVE_KEY, serialize(state, Date.now()));
  } catch (err) {
    // A failed autosave must never take the game down with it.
    console.warn('[save] write failed', err);
    return;
  }

  // Retire old keys only after the current one is safely on disk. Left behind,
  // a stale copy under a previous key is a trap: clear the live save for any
  // reason and the game would silently resume from a much older one.
  await retireLegacyKeys();
}

async function retireLegacyKeys(): Promise<void> {
  for (const key of LEGACY_SAVE_KEYS) {
    try {
      if ((await AsyncStorage.getItem(key)) !== null) await AsyncStorage.removeItem(key);
    } catch {
      // Best effort. A leftover key costs nothing until the next write retries.
    }
  }
}

export interface ReadResult {
  state: GameState | null;
  elapsedMs: number;
  /** Set when a save existed but could not be used, so the UI can say so. */
  problem?: string;
}

export async function readSave(): Promise<ReadResult> {
  let json: string | null = null;
  try {
    json = await AsyncStorage.getItem(SAVE_KEY);
    for (const key of LEGACY_SAVE_KEYS) {
      if (json) break;
      json = await AsyncStorage.getItem(key);
    }
  } catch (err) {
    console.warn('[save] read failed', err);
    return { state: null, elapsedMs: 0, problem: 'could not read save' };
  }

  if (!json) return { state: null, elapsedMs: 0 };

  const result = deserialize(json, Date.now(), makeSeed());
  if (!result.ok) {
    return { state: null, elapsedMs: 0, problem: result.reason };
  }
  return { state: result.state, elapsedMs: result.elapsedMs };
}

export async function clearSave(): Promise<void> {
  try {
    for (const key of [SAVE_KEY, ...LEGACY_SAVE_KEYS]) {
      await AsyncStorage.removeItem(key);
    }
  } catch (err) {
    console.warn('[save] clear failed', err);
  }
}

/** Seed for a brand new game. Only used once per save, then it lives in state. */
export function makeSeed(): number {
  return (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
}
