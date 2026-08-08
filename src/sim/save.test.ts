import { SAVE_VERSION, advance, createInitialState } from './engine';
import { deserialize, migrate, serialize } from './save';

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
    expect(migrated.stage).toBe('bhph');
    // The thing that cannot survive is dropped rather than half-converted.
    expect(migrated.prospects).toEqual([]);
    expect(migrated.stats.negotiationsWon).toBe(0);

    // And it still runs.
    expect(() => advance(migrated, 5 * 60 * 1000)).not.toThrow();
  });

  it('preserves counters a v2 save already had', () => {
    const state = createInitialState(3, 0);
    const withStats: any = JSON.parse(JSON.stringify(state));
    withStats.version = 1;
    withStats.stats.negotiationsWon = 17;
    expect(migrate(withStats, 1).stats.negotiationsWon).toBe(17);
  });
});
