import { BALANCE } from './balance';
import { SAVE_VERSION, advance, createInitialState } from './engine';
import { activeNotes, bookRoom } from './notes';
import { deserialize, migrate, serialize } from './save';
import { SKILL_IDS } from './skills';
import { STAGE_ORDER, getStage } from './stages';

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

  it('preserves counters a v2 save already had', () => {
    const state = createInitialState(3, 0);
    const withStats: any = JSON.parse(JSON.stringify(state));
    withStats.version = 1;
    withStats.stats.negotiationsWon = 17;
    expect(migrate(withStats, 1).stats.negotiationsWon).toBe(17);
  });
});
