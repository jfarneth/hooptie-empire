import { SAVE_VERSION, createInitialState } from './engine';
import type { GameState } from './types';

/**
 * Save serialization, versioning, and migrations.
 *
 * Idle games live or die on save compatibility — a player can be two weeks into
 * a portfolio when a build ships. Migrations exist from version 1 so there is
 * never a temptation to "just wipe saves this once".
 */

export interface SaveEnvelope {
  version: number;
  state: GameState;
}

export function serialize(state: GameState, wallNow: number): string {
  const envelope: SaveEnvelope = {
    version: SAVE_VERSION,
    state: { ...state, lastSeenAt: wallNow },
  };
  return JSON.stringify(envelope);
}

/**
 * Migration steps, applied in order. Each takes the state as it existed at
 * version N and returns state at version N+1.
 *
 * Add a new entry here whenever GameState changes shape; never edit an existing
 * one, because saves in the wild have already been through it.
 */
const MIGRATIONS: Record<number, (state: any) => any> = {
  // Example shape for the next schema change:
  // 1: (s) => ({ ...s, newField: defaultValue }),
};

export function migrate(raw: any, fromVersion: number): GameState {
  let state = raw;
  let version = fromVersion;
  while (version < SAVE_VERSION) {
    const migration = MIGRATIONS[version];
    if (!migration) {
      throw new Error(`No migration from save version ${version} to ${version + 1}`);
    }
    state = migration(state);
    version += 1;
  }
  state.version = SAVE_VERSION;
  return state as GameState;
}

export type LoadResult =
  | { ok: true; state: GameState; elapsedMs: number }
  | { ok: false; reason: string; state: GameState };

/**
 * Parse a save and report how much wall-clock time passed while it was closed.
 * The caller decides how much of that elapsed time to actually simulate — the
 * offline cap is a game rule, not a serialization concern.
 */
export function deserialize(json: string, wallNow: number, fallbackSeed: number): LoadResult {
  let parsed: SaveEnvelope;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, reason: 'corrupt', state: createInitialState(fallbackSeed, wallNow) };
  }

  if (!parsed || typeof parsed !== 'object' || !parsed.state) {
    return { ok: false, reason: 'malformed', state: createInitialState(fallbackSeed, wallNow) };
  }

  let state: GameState;
  try {
    state = migrate(parsed.state, parsed.version ?? 1);
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : 'migration failed',
      state: createInitialState(fallbackSeed, wallNow),
    };
  }

  // A clock that moved backwards (timezone change, manual clock set) must not
  // rewind or explode the sim; treat it as no time having passed.
  const elapsedMs = Math.max(0, wallNow - (state.lastSeenAt ?? wallNow));
  return { ok: true, state, elapsedMs };
}
