import { BALANCE } from './balance';
import { SAVE_VERSION, advance, createInitialState } from './engine';
import { activeNotes, bookRoom } from './notes';
import { deserialize, migrate, serialize } from './save';
import { SKILL_IDS } from './skills';
import { landedCost, reachLevel } from './market';
import { dealFloorIsOff } from './margins';
import { DEAL_FLOOR_LEVELS, STAGE_ORDER, getStage } from './stages';

/**
 * Save compatibility is not a nice-to-have in this genre. A player can be hours
 * into a note portfolio when a build ships, and "we wiped saves" is the thing
 * that ends an idle game's life.
 */

describe('save round trip', () => {
  it('restores a state that keeps simulating identically', () => {
    const original = advance(createInitialState(2024, 0), 15 * 60 * 1000);

    const restored = deserialize(serialize(original, 1_000), 1_000, 1);
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;

    // The restored save must be a perfect continuation, RNG stream included.
    const fromOriginal = advance(original, 5 * 60 * 1000);
    const fromRestored = advance(restored.state, 5 * 60 * 1000);

    expect(fromRestored.cash).toBeCloseTo(fromOriginal.cash, 6);
    expect(fromRestored.rng.s).toBe(fromOriginal.rng.s);
    expect(fromRestored.nextId).toBe(fromOriginal.nextId);
    expect(fromRestored.cars.map((c) => c.id)).toEqual(fromOriginal.cars.map((c) => c.id));
    expect(fromRestored.notes.map((n) => n.id)).toEqual(fromOriginal.notes.map((n) => n.id));
  });

  it('reports elapsed wall time so the caller can run offline catch-up', () => {
    const state = createInitialState(7, 0);
    const json = serialize(state, 1_000_000);
    const result = deserialize(json, 1_000_000 + 3 * 60 * 60 * 1000, 1);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.elapsedMs).toBe(3 * 60 * 60 * 1000);
  });

  it('treats a backwards clock as no time passing rather than rewinding', () => {
    const state = createInitialState(7, 0);
    const json = serialize(state, 5_000_000);
    const result = deserialize(json, 1_000, 1);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.elapsedMs).toBe(0);
  });
});

describe('corrupt and unknown saves', () => {
  it('falls back to a fresh game instead of throwing', () => {
    const result = deserialize('{ not json at all', 0, 42);
    expect(result.ok).toBe(false);
    expect(result.state.cash).toBeGreaterThan(0);
    expect(result.state.listings.length).toBeGreaterThan(0);
  });

  it('rejects a payload with no state rather than half-loading it', () => {
    const result = deserialize(JSON.stringify({ version: 1 }), 0, 42);
    expect(result.ok).toBe(false);
  });

  it('refuses to guess at a save from a version it has no migration for', () => {
    const state = createInitialState(3, 0);
    expect(() => migrate(state, 999)).toThrow(/migration/i);
  });
});

describe('migration chain', () => {
  it('is a no-op at the current version', () => {
    const state = createInitialState(11, 0);
    const migrated = migrate(JSON.parse(JSON.stringify(state)), state.version);
    expect(migrated.version).toBe(state.version);
    expect(migrated.cash).toBe(state.cash);
  });

  /**
   * A v1 save has prospects carrying a flat `cashOffer` and no negotiation. The
   * engine dereferences `negotiation` on the next tick, so without this
   * migration every save in the wild would crash on load.
   */
  it('carries a v1 save forward and leaves it simulatable', () => {
    const v1: any = JSON.parse(JSON.stringify(createInitialState(21, 0)));
    v1.version = 1;
    v1.cash = 41_234;
    v1.stage = 'bhph';
    delete v1.stats.negotiationsWon;
    delete v1.stats.walkaways;
    v1.prospects = [
      { id: 'pros_1', carId: 'car_1', name: 'Old Save', tier: 'C', cashOffer: 3_100 },
    ];

    const migrated = migrate(v1, 1);

    expect(migrated.version).toBe(SAVE_VERSION);
    // The things a player would be upset to lose survive.
    expect(migrated.cash).toBe(41_234);
    // 'bhph' is 'smallUsed' now — same lot, same finance desk, new name. The
    // player's position on the ladder survives; only the id changed.
    expect(migrated.stage).toBe('smallUsed');
    // The thing that cannot survive is dropped rather than half-converted.
    expect(migrated.prospects).toEqual([]);
    expect(migrated.stats.negotiationsWon).toBe(0);

    // And it still runs.
    expect(() => advance(migrated, 5 * 60 * 1000)).not.toThrow();
  });

  /**
   * A real v2 save has no `skills` key at all. The engine dereferences it on
   * the first tick, so this is the migration that decides whether an existing
   * portfolio survives the update.
   */
  it('gives a v2 save a fresh set of skills without disturbing anything else', () => {
    const v2: any = JSON.parse(JSON.stringify(createInitialState(88, 0)));
    v2.version = 2;
    v2.cash = 96_500;
    v2.stage = 'bhph';
    v2.upgrades = { lot: 2, collections: 1 };
    delete v2.skills;

    const migrated = migrate(v2, 2);

    expect(migrated.version).toBe(SAVE_VERSION);
    for (const id of SKILL_IDS) {
      expect(migrated.skills[id]).toEqual({ level: 1, xp: 0 });
    }
    // Everything a player would notice is untouched.
    expect(migrated.cash).toBe(96_500);
    expect(migrated.stage).toBe('smallUsed');
    expect(migrated.upgrades).toEqual({ lot: 2, collections: 1 });

    expect(() => advance(migrated, 5 * 60 * 1000)).not.toThrow();
  });

  /**
   * A v4 save has no `business` key, and the engine reads the repo trigger and
   * the working capital floor on every tick. The values backfilled here are the
   * ones that reproduce v4 exactly — a returning player's lot has to behave the
   * same on load as it did on save, or the suite ships as a stealth nerf.
   */
  it('gives a v4 save the house rules it was already running under', () => {
    const v4: any = JSON.parse(JSON.stringify(createInitialState(64, 0)));
    v4.version = 4;
    v4.cash = 412_000;
    v4.stage = 'bhph';
    v4.upgrades = { lot: 3, collections: 2 };
    delete v4.business;

    const migrated = migrate(v4, 4);

    expect(migrated.version).toBe(SAVE_VERSION);
    expect(migrated.business).toEqual({
      minWorkingCapital: 500,
      repoAfterMissedPayments: BALANCE.repoAfterMissedPayments,
      minBuyMargin: 0,
      // Both sales floors land on the "any deal" stop, which is what a v4 desk
      // did: it signed whatever was in front of it. Stated in the literal
      // number rather than read off BALANCE, because the requirement is "the
      // rule is off", not "the rule matches today's default".
      cashFloorLevel: 0,
      financeFloorLevel: 0,
    });
    expect(migrated.cash).toBe(412_000);
    expect(migrated.upgrades).toEqual({ lot: 3, collections: 2 });

    expect(() => advance(migrated, 5 * 60 * 1000)).not.toThrow();
  });

  /**
   * The book cap arrives with v5, and a v4 book can be well over it. Migrating
   * must not settle the difference by deleting contracts — that is somebody's
   * portfolio. It stops growing and shrinks back by attrition instead.
   */
  it('carries an over-capacity v4 book across intact rather than trimming it', () => {
    const v4: any = JSON.parse(JSON.stringify(createInitialState(65, 0)));
    v4.version = 4;
    v4.stage = 'bhph';
    delete v4.business;
    v4.notes = Array.from({ length: 120 }, (_, i) => ({
      id: `note_${i}`,
      carId: `car_${i}`,
      carLabel: 'Renwick Comet · 180k',
      customerName: `Customer ${i}`,
      customerTier: 'C',
      originalPrincipal: 5_000,
      principal: 5_000,
      apr: 0.239,
      paymentAmount: 260,
      paymentsTotal: 24,
      paymentsRemaining: 24,
      nextDueAt: 10 * 60 * 1000,
      missedPayments: 0,
      collected: 0,
      status: 'current',
      openedAt: 0,
    }));

    const migrated = migrate(v4, 4);

    expect(migrated.notes.length).toBe(120);
    expect(activeNotes(migrated.notes).length).toBe(120);
    expect(bookRoom(migrated)).toBe(0);
  });

  /**
   * v5 -> v6: two stages became six, and both old ids were renamed. `getStage`
   * throws on an id it does not know and runs on the first tick, so getting this
   * wrong is not a subtle bug — it is every existing save failing to load.
   */
  it('renames a v5 stage onto the new ladder without moving the player', () => {
    const build = (stage: string) => {
      const v5: any = JSON.parse(JSON.stringify(createInitialState(66, 0)));
      v5.version = 5;
      v5.stage = stage;
      v5.cash = 55_500;
      v5.upgrades = { lot: 2, mechanic: 3 };
      return migrate(v5, 5);
    };

    expect(build('curbstoner').stage).toBe('curbstone');
    expect(build('bhph').stage).toBe('smallUsed');

    // The small lot they were running is the same business on the new ladder.
    const moved = build('bhph');
    expect(getStage(moved.stage).financing).toBe(true);
    expect(moved.cash).toBe(55_500);
    // Nothing is treated as a stage move, so the payroll survives the update.
    expect(moved.upgrades).toEqual({ lot: 2, mechanic: 3 });
    expect(() => advance(moved, 5 * 60 * 1000)).not.toThrow();
  });

  /**
   * A stage id this build has never heard of would take the game down on the
   * first tick. Landing such a save at the bottom of a ladder it can climb again
   * beats a crash, and everything the player earned survives regardless.
   */
  it('lands a save with an unrecognised stage somewhere the engine can run', () => {
    const weird: any = JSON.parse(JSON.stringify(createInitialState(67, 0)));
    weird.version = 5;
    weird.stage = 'dealerGroup';
    weird.cash = 900_000;

    const migrated = migrate(weird, 5);
    expect(STAGE_ORDER).toContain(migrated.stage);
    expect(migrated.cash).toBe(900_000);
    expect(() => advance(migrated, 60_000)).not.toThrow();
  });

  /**
   * v9 -> v10: the skill ladder went from ten levels to fifty and the XP curve
   * came down to match, which means a v9 level number does not mean what it
   * used to. Carrying it across verbatim would take a maxed player from every
   * effect at full strength to a third of it, in one reload, with no way back —
   * the loud version of the thing migrations exist to prevent.
   *
   * So the XP is carried and the level is re-derived. This is the test that
   * bites if someone "simplifies" that back to copying the number over.
   */
  it('re-grades v9 skills onto the longer ladder instead of keeping the number', () => {
    const v9: any = JSON.parse(JSON.stringify(createInitialState(91, 0)));
    v9.version = 9;
    delete v9.promotions;
    v9.skills = {
      buy: { level: 10, xp: 0 }, // maxed under the old cap
      sell: { level: 4, xp: 60 },
      repair: { level: 1, xp: 0 }, // never used
    };

    const migrated = migrate(v9, 9);
    expect(migrated.version).toBe(SAVE_VERSION);

    // A maxed v9 skill had bought ~9.2k XP. Re-spent at the new prices that is
    // well up the fifty-level ladder, not level 10 of it.
    expect(migrated.skills.buy.level).toBeGreaterThan(20);
    expect(migrated.skills.buy.level).toBeLessThan(BALANCE.skills.maxLevel);
    // Time invested is ordered the same way it was, and nobody loses ground.
    expect(migrated.skills.sell.level).toBeGreaterThan(4);
    expect(migrated.skills.buy.level).toBeGreaterThan(migrated.skills.sell.level);
    expect(migrated.skills.repair).toEqual({ level: 1, xp: 0 });

    for (const id of SKILL_IDS) {
      expect(migrated.skills[id].level).toBeGreaterThanOrEqual(1);
      expect(migrated.skills[id].xp).toBeGreaterThanOrEqual(0);
      expect(migrated.skills[id].xp).toBeLessThan(BALANCE.skills.xpBase * 1_000_000);
    }
    expect(() => advance(migrated, 5 * 60 * 1000)).not.toThrow();
  });

  /**
   * v12 -> v13: market reach.
   *
   * A listing written before this existed came out of the only market there
   * was, so it is local and free. Backfilled rather than left undefined for a
   * concrete reason: `landedCost` adds `freight` to the ask, and `undefined`
   * would price every pre-migration listing at NaN — which is not a crash, it is
   * worse, because `NaN > ceiling` is false and `cash < NaN` is false, so the
   * car would silently become both un-buyable and free depending on which gate
   * looked at it.
   */
  it('lands a v12 feed as local stock with nothing to pay the truck', () => {
    const v12: any = JSON.parse(JSON.stringify(createInitialState(93, 0)));
    v12.version = 12;
    expect(v12.listings.length).toBeGreaterThan(0);
    for (const l of v12.listings) {
      delete l.origin;
      delete l.freight;
    }

    const migrated = migrate(v12, 12);
    expect(migrated.version).toBe(SAVE_VERSION);
    for (const l of migrated.listings) {
      expect(l.origin).toBe('local');
      expect(l.freight).toBe(0);
      expect(Number.isFinite(landedCost(l))).toBe(true);
      expect(landedCost(l)).toBe(l.price);
    }
    // The upgrade itself needs no backfill: a missing key reads as zero, which
    // is local-only, which is exactly what the old build did.
    expect(reachLevel(migrated)).toBe(0);
    expect(() => advance(migrated, 5 * 60 * 1000)).not.toThrow();
  });

  /**
   * THE MIGRATION THAT DECIDES WHETHER A RETURNING PLAYER'S DESK CHANGES ITS
   * MIND. A v14 save carries its sales floors as σ positions off a distribution
   * that no longer sets any rule; v15 reads them as levels on a hard ladder.
   * Two properties matter and they pull in opposite directions: a save that had
   * no floor must still have none (the overwhelming majority — it is the
   * shipped default), and a save that had a real one must land on a comparable
   * rung rather than silently opening the desk up.
   */
  it('re-reads a v14 save\'s sales floors onto the hard ladder', () => {
    const from = (cash: number, finance: number) => {
      const v14: any = JSON.parse(JSON.stringify(createInitialState(77, 0)));
      v14.version = 14;
      v14.business = {
        minWorkingCapital: 2_500,
        repoAfterMissedPayments: 4,
        minBuyMargin: 0.05,
        minCashMarginZ: cash,
        minFinanceMarginZ: finance,
      };
      const migrated = migrate(v14, 14);
      expect(migrated.version).toBe(SAVE_VERSION);
      return migrated.business as any;
    };

    // The shipped default: off stays off. Anything else would hand a lot that
    // has been signing whatever walks up a floor it never agreed to.
    const untouched = from(-4, -4);
    expect(untouched.cashFloorLevel).toBe(0);
    expect(untouched.financeFloorLevel).toBe(0);
    expect(dealFloorIsOff(untouched.cashFloorLevel)).toBe(true);
    // The rules the player DID set come across unharmed.
    expect(untouched.minWorkingCapital).toBe(2_500);
    expect(untouched.repoAfterMissedPayments).toBe(4);
    expect(untouched.minBuyMargin).toBe(0.05);
    // And the dead fields do not ride along as a second, silent copy.
    expect('minCashMarginZ' in untouched).toBe(false);
    expect('minFinanceMarginZ' in untouched).toBe(false);

    // The ends and the middle of the old scale, in order. 0σ was the store's
    // average deal and level 4 is the store's average deal, which is the one
    // correspondence this mapping has to get right.
    expect(from(-3, -3).cashFloorLevel).toBe(1);
    expect(from(0, 0).cashFloorLevel).toBe(4);
    expect(from(3, 3).cashFloorLevel).toBe(6);
    expect(from(3, -4).financeFloorLevel).toBe(0);

    // A hand-edited save cannot produce a level the ladder does not have.
    for (const z of [NaN, -99, 99, undefined as any]) {
      const level = from(z, z).cashFloorLevel;
      expect(Number.isInteger(level)).toBe(true);
      expect(level).toBeGreaterThanOrEqual(0);
      expect(level).toBeLessThanOrEqual(DEAL_FLOOR_LEVELS);
    }

    const live: any = JSON.parse(JSON.stringify(createInitialState(77, 0)));
    live.version = 14;
    live.business = { ...live.business, minCashMarginZ: 1, minFinanceMarginZ: -4 };
    expect(() => advance(migrate(live, 14), 5 * 60 * 1000)).not.toThrow();
  });

  /**
   * A promotion is something that ran at a moment. A save written before they
   * existed never had one, and back-dating a grand opening onto a business that
   * has been trading for hours would just be free traffic.
   */
  it('gives a v9 save no promotions rather than a back-dated one', () => {
    const v9: any = JSON.parse(JSON.stringify(createInitialState(92, 0)));
    v9.version = 9;
    v9.t = 6 * 60 * 60 * 1000;
    delete v9.promotions;

    const migrated = migrate(v9, 9);
    expect(migrated.promotions).toEqual([]);
    // And the tick that reads it every slice does not care.
    expect(() => advance(migrated, 60_000)).not.toThrow();
  });

  it('preserves counters a v2 save already had', () => {
    const state = createInitialState(3, 0);
    const withStats: any = JSON.parse(JSON.stringify(state));
    withStats.version = 1;
    withStats.stats.negotiationsWon = 17;
    expect(migrate(withStats, 1).stats.negotiationsWon).toBe(17);
  });
});
