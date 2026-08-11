import { MS_PER_GAME_WEEK } from './balance';
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

  /**
   * v4 -> v5: house rules, and a book limit that is actually a limit.
   *
   * A v4 save has no `business` key and the engine reads it every tick, so it is
   * backfilled with the exact numbers that reproduce v4 behaviour: the $500
   * reserve the retainer buyer used to hard-code, the repo trigger the whole
   * game was balanced on, and no margin floor at all. A returning player's lot
   * runs identically until they go and change something.
   *
   * Their book is a different matter, and deliberately left alone. Notes written
   * over the new cap are not torn up — that would delete a portfolio someone
   * spent hours building, which is precisely the thing migrations exist to
   * prevent. An over-capacity book simply writes no new paper until it shrinks
   * back under the line, and `overCapacityFactor` keeps degrading it in the
   * meantime, exactly as it did before.
   *
   * Written out longhand rather than calling businessDefaults(): a migration has
   * to keep meaning what it meant when it shipped, and a shared helper is free
   * to change underneath it.
   */
  4: (s) => ({
    ...s,
    business: {
      minWorkingCapital: 500,
      repoAfterMissedPayments: 3,
      minBuyMargin: 0,
      ...(s.business ?? {}),
    },
  }),

  /**
   * v5 -> v6: two stages became six.
   *
   * Pure rename. 'curbstoner' is the same driveway it always was and 'bhph' is
   * the same small lot with the same finance desk — the new stage table gives
   * the small lot exactly the capacity, markup and sourcing the old `bhph`
   * constants did, so a returning player's business behaves identically and the
   * only thing that changed is that there is now somewhere to go next.
   *
   * An unrecognised value is mapped to the opening stage rather than left alone.
   * `getStage` throws on an unknown id and it is called on the first tick, so a
   * save carrying anything else would take the game down on load; starting such
   * a player at the bottom of a ladder they can climb again beats a crash, and
   * their cash, inventory, book and skills all survive regardless.
   */
  5: (s) => ({
    ...s,
    stage: s.stage === 'bhph' ? 'smallUsed' : s.stage === 'curbstoner' ? 'curbstone' : 'curbstone',
  }),

  /**
   * v6 -> v7: the admin console.
   *
   * An empty override map is exactly the shipped game, so every existing save
   * carries forward untouched. `cloneState` spreads this key on every tick, so
   * it has to exist rather than be left undefined.
   */
  6: (s) => ({ ...s, tuning: s.tuning ?? {} }),

  /**
   * v7 → v8: the business started paying rent.
   *
   * Weekly overheads need a clock to fall due on. An existing save has none, so
   * it gets one a week out from wherever it currently is — the alternative is
   * `nextBillAt: 0`, which bills on the first tick after the update and charges
   * somebody for a week they already played for free.
   *
   * Deliberately does not touch upgrades. Moving stores now clears the whole
   * upgrade table rather than only the payroll, but that is a rule about what
   * happens when you move, not a debt the save already owes — a v7 player keeps
   * every level they bought until they choose to move.
   */
  7: (s) => ({ ...s, nextBillAt: (s.t ?? 0) + MS_PER_GAME_WEEK }),

  /**
   * v8 → v9: retirement and the shark.
   *
   * An existing career simply has not retired yet and has not borrowed. Nothing
   * about the run itself changes.
   */
  8: (s) => ({ ...s, prestige: { count: 0, points: 0, history: [] }, loan: null }),

  /**
   * v9 → v10: promotions, and a skill ladder five times as long.
   *
   * TWO CHANGES, ONE MIGRATION, because they shipped together.
   *
   * Promotions backfill to nothing. A promotion is something that ran at a
   * moment, and a save written before the feature existed never had one — the
   * grand opening belongs to a business opening its doors, and back-dating one
   * onto a lot that has been trading for six hours would just be free traffic.
   * `cloneState` maps this key every tick, so it has to exist rather than be
   * left undefined.
   *
   * Skills are the delicate half. The cap went from 10 to 50 and the XP curve
   * came down to match (60 × 1.12^n, from 100 × 1.55^n), which means a level
   * number written under the old curve means something quite different under
   * the new one — a maxed v9 player would reload as 10/50 and watch every
   * effect they had earned drop to a third of its value. So the level is not
   * carried across: the XP behind it is. Every level the save had bought is
   * added back up at the OLD prices and re-spent at the NEW ones, which lands a
   * maxed v9 skill at level 27 of 50 with the whole of their play preserved and
   * something left to climb.
   *
   * Both curves are written out longhand here, and that is not duplication to
   * be tidied away: a migration has to keep meaning what it meant on the day it
   * shipped, and `BALANCE` is free to move underneath it. Reading the live
   * constants would silently re-grade every old save differently after the next
   * balance pass.
   */
  9: (s) => {
    const OLD = { xpBase: 100, xpGrowth: 1.55, maxLevel: 10 };
    const NEW = { xpBase: 60, xpGrowth: 1.12, maxLevel: 50 };
    const costOf = (c: typeof OLD, lvl: number) =>
      Math.round(c.xpBase * Math.pow(c.xpGrowth, lvl - 1));

    const regrade = (skill: any) => {
      const from = Math.max(1, Math.min(OLD.maxLevel, Math.round(Number(skill?.level) || 1)));
      // Everything they ever earned in this skill: what each level below them
      // cost, plus whatever is banked toward the next one.
      let earned = Math.max(0, Number(skill?.xp) || 0);
      for (let lvl = 1; lvl < from; lvl++) earned += costOf(OLD, lvl);

      let level = 1;
      while (level < NEW.maxLevel && earned >= costOf(NEW, level)) {
        earned -= costOf(NEW, level);
        level += 1;
      }
      // Nothing banks against a level that will never arrive, same as grantXp.
      return { level, xp: level >= NEW.maxLevel ? 0 : Math.round(earned) };
    };

    return {
      ...s,
      promotions: [],
      skills: {
        buy: regrade(s.skills?.buy),
        sell: regrade(s.skills?.sell),
        repair: regrade(s.skills?.repair),
      },
    };
  },

  /**
   * v10 -> v11: cars carry a trim grade.
   *
   * Every existing car becomes 'common', which reproduces the pre-rarity game
   * exactly — `rarityValueMult('common')` is 1, so not a dollar of anyone's
   * inventory or book moves. Rolling real grades here would be worse in both
   * directions: a save that had been sitting on ordinary metal would either
   * inflate overnight for no reason a player could point at, or hand them a
   * neon car they never bought.
   *
   * Listings are covered too. They rotate off within ~150 s, but the engine
   * reads `listing.car.rarity` on the very next tick to price the ask, and an
   * undefined grade would fall through `rarityRank` to stock — right answer,
   * arrived at by accident. Backfilling says it on purpose.
   *
   * Written out longhand rather than calling into rarity.ts: a migration has to
   * keep meaning what it meant the day it shipped, and a shared default is free
   * to change underneath it.
   */
  10: (s) => ({
    ...s,
    cars: (s.cars ?? []).map((c: any) => ({ ...c, rarity: 'common' })),
    listings: (s.listings ?? []).map((l: any) => ({
      ...l,
      car: { ...l.car, rarity: 'common' },
    })),
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
