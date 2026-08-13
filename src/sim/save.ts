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

  /**
   * v11 -> v12: the commission desk.
   *
   * Prospects gain `arrivedAt` and `claimed`. Any prospect in flight when the
   * save migrates gets `arrivedAt: 0` — an age far past the grace window, so
   * the desk treats them exactly as the old build did (closes immediately)
   * rather than granting a fresh window to a buyer who has already been
   * standing there. They will all resolve within the minute either way.
   *
   * Stats gain `commissionPaid: 0` — nothing has been paid yet, and the desks
   * on existing saves start charging their stage's cut from here forward. That
   * is a change to the terms of an upgrade already bought, deliberately and
   * with a ledger line the first time it bites; nothing a save holds is
   * destroyed.
   */
  11: (s) => ({
    ...s,
    prospects: (s.prospects ?? []).map((p: any) => ({ ...p, arrivedAt: 0, claimed: false })),
    stats: { ...s.stats, commissionPaid: 0 },
  }),

  /**
   * v12 -> v13: market reach.
   *
   * Listings gain `origin` and `freight`. Everything already on an old feed came
   * from the only market that existed when it was written, so it is local and it
   * is free — and that is the honest answer rather than a convenient one: those
   * cars were sourced under the old rules and nobody is going to truck them
   * anywhere. Backfilled rather than left undefined because `landedCost` adds
   * `freight` to the ask, and `undefined` would make every pre-migration listing
   * cost NaN and quietly un-buyable.
   *
   * The `reach` upgrade itself needs no backfill: `level()` reads a missing key
   * as zero, which is local-only, which is exactly what an old save was doing.
   * Written out longhand for the usual reason — a migration has to keep meaning
   * what it meant the day it shipped.
   */
  12: (s) => ({
    ...s,
    listings: (s.listings ?? []).map((l: any) => ({ ...l, origin: 'local', freight: 0 })),
  }),

  /**
   * v13 -> v14: the sales desk gets house minimums.
   *
   * Both floors are backfilled to the "any deal" stop, which is what the desk
   * did before they existed: it closed whatever was in front of it, at whatever
   * margin, and a save that has been running under that rule must go on running
   * under it until somebody moves a slider.
   *
   * -4 rather than -3 matters and is not a spare digit. The scale bottoms at
   * -3σ, and σ shrinks as the ladder climbs — at a premium franchise -3σ is
   * still a 2.4% margin, so backfilling to the bottom of the scale would hand
   * every existing franchise save a real floor overnight and stop it selling
   * its ordinary bad days. Anything under the scale means no floor at all; see
   * `dealFloorIsOff`.
   *
   * Written out longhand for the usual reason: a migration has to keep meaning
   * what it meant the day it shipped, and reading `BALANCE.business.defaults`
   * here would silently re-stamp every old save after the next balance pass.
   */
  13: (s) => ({
    ...s,
    business: {
      ...(s.business ?? {}),
      minCashMarginZ: -4,
      minFinanceMarginZ: -4,
    },
  }),

  /**
   * v14 -> v15: the sales floors stop being standard deviations.
   *
   * A σ position was a rule whose meaning moved every time the economy did —
   * the whole argument is on `dealFloors` in stages.ts. The floors are now a
   * level from 0 to 6 indexing a hard number per store, so every old save has
   * to be re-read onto the new ladder.
   *
   * The mapping is written out longhand, and it does not consult a single live
   * constant, for the usual reason: a migration has to keep meaning what it
   * meant the day it shipped, and one that read today's scale would re-grade
   * every old save after the next balance pass — which is the exact failure
   * this change exists to end.
   *
   * The v14 scale ran -3σ to +3σ with anything below it meaning NO FLOOR, so
   * that band maps linearly onto levels 1 to 6 and everything under it lands on
   * level 0. Two properties are worth stating because they are what makes this
   * safe: the shipped default (-4, off) lands on 0, off, which is the vast
   * majority of saves in existence; and the middle of the old scale (0σ, the
   * store's average deal) lands on level 4, which is the store's average deal
   * on the new ladder as well.
   */
  14: (s) => {
    const level = (z: any): number => {
      if (typeof z !== 'number' || !Number.isFinite(z) || z < -3) return 0;
      const span = Math.min(1, (z + 3) / 6);
      return Math.min(6, Math.max(1, Math.round(span * 5) + 1));
    };
    const { minCashMarginZ, minFinanceMarginZ, ...rest } = s.business ?? {};
    return {
      ...s,
      business: {
        ...rest,
        cashFloorLevel: level(minCashMarginZ),
        financeFloorLevel: level(minFinanceMarginZ),
      },
    };
  },

  /**
   * v15 -> v16: service contracts and the service department.
   *
   * Both blocks backfill EMPTY, which is the honest answer rather than a
   * convenient one. A plan is a contract somebody signed on a specific Tuesday,
   * and back-dating cover onto cars sold six hours ago would be inventing
   * liabilities the player never took on and — worse — income they never
   * received. The bays are the same: `serviceBays` is an upgrade, and `level()`
   * already reads a missing key as zero, so a returning save arrives at a
   * franchise with a closed shop and the price of the first bench in front of
   * it. Both keys still have to EXIST rather than be left undefined, because
   * `cloneState` maps them on every tick.
   *
   * The stats gain seven zeroes for the same reason: the away summary and the
   * harness both read them, and `undefined + 1` is NaN for the rest of the run.
   *
   * The two new house rules are backfilled to the SHIPPED DEFAULTS rather than
   * to off, and that is a deliberate departure from how the sales floors were
   * migrated. A floor defaulting to off reproduced what the desk did before it
   * existed; there is no "what the plan desk did before it existed", because it
   * did not exist. A returning player at the big lot starts selling cover on the
   * next car they sell, at the standard price, which is the feature arriving —
   * and one slider says so. Written out longhand for the usual reason: a
   * migration has to keep meaning what it meant the day it shipped.
   */
  15: (s) => ({
    ...s,
    serviceContracts: [],
    shop: { techs: [], jobs: [], weekRevenue: 0, weekJobs: 0 },
    business: {
      ...(s.business ?? {}),
      servicePlanBand: 3,
      shopRateLevel: 3,
    },
    stats: {
      ...s.stats,
      plansSold: 0,
      planIncome: 0,
      planPayouts: 0,
      shopRevenue: 0,
      shopJobsDone: 0,
      shopReworks: 0,
      shopTurnedAway: 0,
    },
  }),

  /**
   * v16 -> v17: a repossessed car comes back at what is left in it.
   *
   * The carrying value needs to know what the customer has already handed over,
   * and half of that — the down payment — was never stored: `openNote` kept the
   * amount financed and nothing else. So every existing contract gets one
   * backfilled from the tier's shipped down share.
   *
   * That is an ESTIMATE and it is worth being honest about which way it errs.
   * The real figure carried a +/-15% jitter that is gone for good, so an old
   * note's backfill is within about a sixth of the truth. Reconstructing it is
   * strictly better than the alternatives: zero would credit the customer with
   * nothing they paid at signing and put every old repo back on the books too
   * dear, and dropping the notes to avoid guessing would delete the portfolio.
   *
   * The tier table is written out longhand and reads no live constant, for the
   * reason every migration here does: `BALANCE.creditTiers` is free to move in
   * the next balance pass, and a migration that followed it would re-grade every
   * old contract differently each time.
   */
  16: (s) => {
    const DOWN_SHARE: Record<string, number> = { A: 0.14, B: 0.18, C: 0.24, D: 0.31 };
    return {
      ...s,
      notes: (s.notes ?? []).map((n: any) => {
        if (typeof n.downPayment === 'number') return n;
        const share = DOWN_SHARE[n.customerTier] ?? 0.24;
        // financed = price x (1 - share), so down = financed x share/(1 - share).
        const financed = Math.max(0, Number(n.originalPrincipal) || 0);
        return { ...n, downPayment: Math.round((financed * share) / (1 - share)) };
      }),
    };
  },

  /**
   * v17 -> v18: the two sales rules change units, and pricing becomes a rule.
   *
   * THE CASH FLOOR STOPS BEING A MARGIN. It was a position on a hand-tabulated
   * per-store ladder of minimum margins; it is now a position on one scale-free
   * ladder of "how close to the ask will you take". Those are different
   * questions, and there is no honest arithmetic converting one to the other —
   * a 15% margin floor at a curbstone and at a Valmont store let through
   * completely different offers. So every save lands on **level 0, no floor**,
   * which is what the overwhelming majority of them were already set to and is
   * the position that changes nothing about what the desk signs. A player who
   * had tightened it will find it loose and one slider away, which is a great
   * deal better than being handed a rule they never chose in a unit they have
   * never seen.
   *
   * The finance floor goes the same way and for the same reason, onto "take
   * their number" — financing was not a negotiation before this, so there is no
   * earlier push level to preserve.
   *
   * `listMarkup` is the one that matters for continuity, and it is written as a
   * LITERAL: `1/0.74 - 1` expanded, at the wholesale ratio this build shipped
   * with, which prices every car at cash retail exactly as it always was. It
   * does not read the live constant, for the usual reason — a later retune of
   * `wholesaleOfRetail` must not silently re-price every returning player's lot.
   *
   * The digits are not decoration. Rounded to 0.351 the markup is 0.026% light,
   * which is two dollars on a seven-thousand-dollar car — small, and still a
   * returning player's whole lot silently re-priced by a rounding error. There
   * is a test that lists a real car and compares the sticker against
   * `retailValue`, which is the only way that class of drift ever shows up.
   */
  17: (s) => {
    const { cashFloorLevel, financeFloorLevel, ...rest } = s.business ?? {};
    return {
      ...s,
      business: {
        ...rest,
        offerFloorLevel: 0,
        paymentPushLevel: 0,
        listMarkup: 0.35135135135135137,
      },
      // Prospects gain a hidden payment ceiling. Anyone mid-visit is dropped
      // rather than given one: a walk-up is ephemeral by design (the v1 -> v2
      // migration made the same call), and inventing a private number for a
      // customer already standing on the lot is worse than letting them leave.
      prospects: [],
    };
  },

  /**
   * v18 -> v19: the business started keeping weekly books.
   *
   * No history is invented. A returning save has never closed a week, so it
   * starts with an empty chart that fills a week at a time — which is the honest
   * thing and also the only possible one: the ledger is a sixty-entry ring
   * buffer and `lifetimeProfit` is a single cumulative number, so there is
   * nothing in an old save to reconstruct a trend from.
   *
   * `weekProfitAt` is stamped at the save's CURRENT lifetime profit rather than
   * at zero. Zero would make the first week the business closes report every
   * dollar it has ever earned as that week's profit, which on a mature save is a
   * margin in the thousands of percent.
   */
  18: (s) => ({
    ...s,
    weeks: [],
    weekRevenue: 0,
    weekProfitAt: Number(s.stats?.lifetimeProfit) || 0,
  }),

  /**
   * v19 -> v20: every car starts keeping its own cost ledger.
   *
   * `costBasis` was the only figure a car carried, and it is a net: recon is
   * added to it and a repossession rewrites it to what is left in the unit. So
   * there is nothing in an old save to reconstruct a split from, and inventing
   * one — guessing at a recon share, back-deriving freight from the origin —
   * would put fabricated dollars on a screen whose entire job is telling the
   * player where their money went.
   *
   * Everything a returning save cannot know reads ZERO, and the whole basis
   * lands on `purchasePrice`, which is what it was on the day the car was
   * bought and is the honest floor under the rest. The ageing report says so on
   * its face rather than quietly showing a lot with no repairs and no carrying
   * cost: `freightPaid`, `reconSpend`, `carryingCost`, `recoveryCost` and
   * `returned` are all things that started being recorded today, and the totals
   * fill in from here. Nothing is destroyed and nothing is invented.
   *
   * Cars on the sourcing feed get the same treatment. A listing is a car nobody
   * has bought yet, so all six are zero anyway — but the field has to exist, or
   * buying one produces a car with `undefined` where its ledger should be and
   * every figure downstream reads NaN.
   */
  19: (s) => {
    // Defaults first, the saved car second: anything the car already carries
    // wins, which is what makes this safe to run over a state that has been
    // through it before.
    const ledger = (car: any) => ({
      purchasePrice: Number(car.costBasis) || 0,
      freightPaid: 0,
      reconSpend: 0,
      carryingCost: 0,
      recoveryCost: 0,
      returned: 0,
      ...car,
    });
    return {
      ...s,
      cars: (s.cars ?? []).map(ledger),
      listings: (s.listings ?? []).map((l: any) => ({ ...l, car: ledger(l.car) })),
    };
  },
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
