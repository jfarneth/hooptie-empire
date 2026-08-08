import AsyncStorage from '@react-native-async-storage/async-storage';
import { deserialize, serialize } from '../sim/save';
import type { GameState } from '../sim/types';

const SAVE_KEY = 'curbstone.save';

export async function writeSave(state: GameState): Promise<void> {
  try {
    await AsyncStorage.setItem(SAVE_KEY, serialize(state, Date.now()));
  } catch (err) {
    // A failed autosave must never take the game down with it.
    console.warn('[save] write failed', err);
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
    await AsyncStorage.removeItem(SAVE_KEY);
  } catch (err) {
    console.warn('[save] clear failed', err);
  }
}

/** Seed for a brand new game. Only used once per save, then it lives in state. */
export function makeSeed(): number {
  return (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
}
