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
  /**
   * v1 → v2: walk-ups became negotiations.
   *
   * A v1 prospect carries a flat `cashOffer` and no negotiation, which the
   * engine would dereference on the very next tick. Prospects are ephemeral by
   * design — someone standing on the lot when you closed the app is not worth
   * preserving — so the migration drops them rather than inventing a haggle
   * they never had. Inventory, notes, cash and upgrades are untouched.
   */
  1: (s) => ({
    ...s,
    prospects: [],
    stats: {
      negotiationsWon: 0,
      walkaways: 0,
      ...s.stats,
    },
  }),

  /**
   * v2 → v3: player skills.
   *
   * Everyone who was already playing starts at level 1 across the board, which
   * is exactly the behaviour their save had before skills existed — level 1
   * reproduces every pre-skills constant. Nothing else about the save changes.
   *
   * Written out longhand rather than calling blankSkills(): a migration has to
   * keep meaning what it meant when it shipped, and a shared helper is free to
   * change underneath it.
   */
  2: (s) => ({
    ...s,
    skills: {
      buy: { level: 1, xp: 0 },
      sell: { level: 1, xp: 0 },
      repair: { level: 1, xp: 0 },
    },
  }),

  /**
   * v3 -> v4: cars on the feed stopped advertising their true condition.
   *
   * A v3 listing has no noise draw, and the engine reads it on the next render.
   * Backfilling zero means listings already on the feed appraise honestly —
   * generous rather than punitive, and they rotate off within ~150s anyway.
   * Rolling a real draw here would be worse: a player who had been looking at
   * an exact condition all session would watch the number move for no reason.
   */
  3: (s) => ({
    ...s,
    listings: (s.listings ?? []).map((l: any) => ({ ...l, appraisalNoise: 0 })),
  }),
};

export function migrate(raw: any, fromVersion: number): GameState {
  // A save from a newer build than this one cannot be understood. Loading it
  // anyway would either crash on missing fields or quietly corrupt a portfolio,
  // so refuse and let the caller start clean.
  if (fromVersion > SAVE_VERSION) {
    throw new Error(
      `Save is from a newer version (${fromVersion} > ${SAVE_VERSION}); no downgrade migration exists`,
    );
  }

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
