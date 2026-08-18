import { resetTuning, setTuning, reconcileTuning } from './actions';
import { BALANCE } from './balance';
import { advance, cloneState, createInitialState } from './engine';
import { getStage } from './stages';
import {
  TUNABLES,
  TUNABLE_GROUPS,
  applyTuning,
  coerceTunable,
  currentValue,
  defaultValue,
  getTunable,
  pruneTuning,
} from './tuning';
import { carCapacity } from './upgrades';
import type { GameState } from './types';

/**
 * The admin console.
 *
 * This is the one place the simulation writes a global, so the tests carry more
 * weight than usual: they have to prove a change actually reaches the engine,
 * that reset genuinely restores the shipped value rather than approximately,
 * and — most importantly — that nothing leaks between tests, because a leaked
 * override would silently retune every other suite in the repo.
 */

// Every test must leave the world exactly as it found it.
afterEach(() => applyTuning({}));

function fresh(): GameState {
  return cloneState(createInitialState(2468, 0));
}

// ------------------------------------------------------------- the registry

describe('the tunable registry', () => {
  it('resolves every declared path to a real number', () => {
    for (const def of TUNABLES) {
      expect(typeof currentValue(def.path)).toBe('number');
      expect(typeof defaultValue(def.path)).toBe('number');
    }
  });

  it('has no duplicate paths and puts every knob in a known group', () => {
    const paths = TUNABLES.map((t) => t.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const def of TUNABLES) expect(TUNABLE_GROUPS).toContain(def.group as never);
  });

  it('ships every default inside its own declared range', () => {
    for (const def of TUNABLES) {
      const d = defaultValue(def.path)!;
      expect(d).toBeGreaterThanOrEqual(def.min);
      expect(d).toBeLessThanOrEqual(def.max);
    }
  });

  it('covers the levers the balance notes call out by name', () => {
    for (const path of [
      'stages.curbstone.sourcing.askMin',
      'balance.listingIntervalMs',
      'balance.negotiation.acceptanceAtReservation',
      'balance.negotiation.baseWalkChance',
      'balance.baseCollectionsCapacity',
      'balance.creditTiers.C.missChance',
      'stages.largeUsed.entryCost',
    ]) {
      expect(getTunable(path)).toBeDefined();
    }
  });
});

// ------------------------------------------------------------ apply / reset

describe('applying overrides', () => {
  it('reaches the live constants the engine reads', () => {
    expect(BALANCE.startingCash).toBe(defaultValue('balance.startingCash'));
    applyTuning({ 'balance.startingCash': 99_000 });
    expect(BALANCE.startingCash).toBe(99_000);
  });

  it('reaches the stage table too, not just BALANCE', () => {
    applyTuning({ 'stages.largeUsed.entryCost': 1_234 });
    expect(getStage('largeUsed').entryCost).toBe(1_234);
  });

  /**
   * Mutation-sensitive on purpose. `applyTuning` resets to defaults before
   * laying overrides on top; applying diffs onto a dirty global was the obvious
   * shortcut and would make removing an override silently do nothing.
   */
  it('restores anything dropped from the override set', () => {
    const shipped = defaultValue('balance.repoFee')!;
    applyTuning({ 'balance.repoFee': 9_999 });
    expect(BALANCE.repoFee).toBe(9_999);

    applyTuning({ 'balance.startingCash': 1 });
    expect(BALANCE.repoFee).toBe(shipped);
  });

  it('restores everything when the set is emptied', () => {
    const before = TUNABLES.map((t) => currentValue(t.path));
    applyTuning({
      'balance.startingCash': 50_000,
      'balance.priceElasticity': 1,
      'stages.smallUsed.entryCost': 1,
    });
    applyTuning({});
    expect(TUNABLES.map((t) => currentValue(t.path))).toEqual(before);
  });

  it('ignores a knob this build no longer has rather than throwing', () => {
    expect(() => applyTuning({ 'balance.thisWasRemovedInV9': 5 })).not.toThrow();
    expect(pruneTuning({ 'balance.thisWasRemovedInV9': 5 })).toEqual({});
  });

  it('clamps and rounds to what the sim can actually run on', () => {
    const int = getTunable('balance.baseListingSlots')!;
    expect(coerceTunable(int, 3.7)).toBe(4);
    expect(coerceTunable(int, -5)).toBe(int.min);
    expect(coerceTunable(int, 10_000)).toBe(int.max);
    // Garbage falls back to the shipped value rather than poisoning the engine.
    expect(coerceTunable(int, NaN)).toBe(defaultValue(int.path));
  });
});

// -------------------------------------------------------------- the actions

describe('setting a knob from the console', () => {
  it('records the override and moves the live constant', () => {
    const after = setTuning(fresh(), 'balance.repoFee', 750);
    expect(after.tuning['balance.repoFee']).toBe(750);
    expect(BALANCE.repoFee).toBe(750);
  });

  it('keeps the override map sparse — back to default means gone', () => {
    let s = setTuning(fresh(), 'balance.repoFee', 750);
    expect(Object.keys(s.tuning)).toEqual(['balance.repoFee']);

    s = setTuning(s, 'balance.repoFee', defaultValue('balance.repoFee')!);
    expect(s.tuning).toEqual({});
    expect(BALANCE.repoFee).toBe(defaultValue('balance.repoFee'));
  });

  it('clamps rather than accepting a value that would break the sim', () => {
    const def = getTunable('balance.negotiation.maxPlayerCounters')!;
    const after = setTuning(fresh(), def.path, 0);
    expect(after.tuning[def.path]).toBe(def.min);
    expect(BALANCE.negotiation.maxPlayerCounters).toBe(def.min);
  });

  it('rejects a path it does not know, leaving state identity intact', () => {
    const s = fresh();
    expect(setTuning(s, 'balance.notAThing', 5)).toBe(s);
  });

  it('keeps state identity when nothing actually changed', () => {
    const s = fresh();
    expect(setTuning(s, 'balance.repoFee', defaultValue('balance.repoFee')!)).toBe(s);
    const set = setTuning(s, 'balance.repoFee', 750);
    expect(setTuning(set, 'balance.repoFee', 750)).toBe(set);
  });

  it('puts everything back, in the save and in the world', () => {
    let s = setTuning(fresh(), 'balance.repoFee', 750);
    s = setTuning(s, 'stages.largeUsed.entryCost', 42);
    expect(getStage('largeUsed').entryCost).toBe(42);

    s = resetTuning(s);
    expect(s.tuning).toEqual({});
    expect(BALANCE.repoFee).toBe(defaultValue('balance.repoFee'));
    expect(getStage('largeUsed').entryCost).toBe(defaultValue('stages.largeUsed.entryCost'));
  });
});

// ----------------------------------------------------------- does it bite?

describe('a change the engine actually feels', () => {
  it('changes what the feed asks for a car', () => {
    const cheap = advance(
      (() => {
        applyTuning({ 'stages.curbstone.sourcing.askMin': 0.3, 'stages.curbstone.sourcing.askMax': 0.32 });
        return createInitialState(99, 0);
      })(),
      10 * 60 * 1000,
    );
    const dear = advance(
      (() => {
        applyTuning({ 'stages.curbstone.sourcing.askMin': 1.9, 'stages.curbstone.sourcing.askMax': 2 });
        return createInitialState(99, 0);
      })(),
      10 * 60 * 1000,
    );

    const avg = (s: GameState) =>
      s.listings.reduce((n, l) => n + l.price, 0) / Math.max(1, s.listings.length);
    expect(avg(dear)).toBeGreaterThan(avg(cheap) * 2);
  });

  it('changes capacity through the stage table', () => {
    const s = fresh();
    const before = carCapacity(s);
    applyTuning({ 'stages.curbstone.baseCarCapacity': 17 });
    expect(carCapacity(s)).toBe(17);
    expect(carCapacity(s)).toBeGreaterThan(before);
  });

  /**
   * The reason overrides live on the save rather than in a side channel: the
   * hours simulated while the app was closed have to run under the player's
   * constants, so the load path applies them before catch-up. `reconcileTuning`
   * is what the store calls to do it.
   */
  it('is re-applied from a save before anything is simulated', () => {
    const saved = { ...fresh(), tuning: { 'balance.repoFee': 4_321 } };
    applyTuning({}); // simulate a cold start: globals at shipped values
    expect(BALANCE.repoFee).not.toBe(4_321);

    reconcileTuning(saved);
    expect(BALANCE.repoFee).toBe(4_321);
  });

  it('drops a stale knob out of the save when reconciling', () => {
    const saved = {
      ...fresh(),
      tuning: { 'balance.repoFee': 4_321, 'balance.longGone': 1 },
    };
    const reconciled = reconcileTuning(saved);
    expect(reconciled.tuning).toEqual({ 'balance.repoFee': 4_321 });
  });

  it('survives a run without being disturbed by it', () => {
    const s = setTuning(fresh(), 'balance.repoFee', 750);
    expect(advance(s, 10 * 60 * 1000).tuning).toEqual({ 'balance.repoFee': 750 });
  });

  it('does not share the override map between a state and its clone', () => {
    const s = setTuning(fresh(), 'balance.repoFee', 750);
    const copy = cloneState(s);
    copy.tuning['balance.repoFee'] = 1;
    expect(s.tuning['balance.repoFee']).toBe(750);
  });
});
