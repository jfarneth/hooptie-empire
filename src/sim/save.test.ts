import { advance, createInitialState } from './engine';
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
});
