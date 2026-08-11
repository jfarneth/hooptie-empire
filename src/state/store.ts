import { create } from 'zustand';
import { reconcileTuning } from '../sim/actions';
import { advance, createInitialState } from '../sim/engine';
import { getStage } from '../sim/stages';
import { offlineCapMs } from '../sim/upgrades';
import { specialFinds, type SpecialFind } from './finds';
import type { GameState, Stats } from '../sim/types';
import { makeSeed, readSave, writeSave } from './persistence';

export type { SpecialFind };

/**
 * The store owns the clock and nothing else. Every rule lives in `src/sim`;
 * this layer only decides *when* to call it and how to get the result on screen.
 */

export interface AwaySummary {
  elapsedMs: number;
  simulatedMs: number;
  /** True when the player was away longer than the offline cap allows. */
  capped: boolean;
  cashDelta: number;
  carsSold: number;
  payments: number;
  collected: number;
  notesPaid: number;
  repos: number;
  /** Levels gained while the app was closed, e.g. ['Buying reached level 4']. */
  skillUps: string[];
  /** What the sales staff took off the deals they closed while you were away. */
  commissionPaid: number;
  /** What that staff member is called at this store — partner or manager. */
  deskTitle: string;
  /**
   * Special-edition and unicorn cars the retainer buyer picked up while nobody
   * was watching, with the deal it got.
   *
   * The feed churns whether or not the app is open, so a graded car is one the
   * player is very unlikely to be there to see — at the base feed the odds one
   * is on screen when you open the game are about a third of a percent. The
   * buyer already values them correctly and buys them; this is what tells you it
   * happened, and it is the whole reason the carousel exists rather than a
   * longer shelf life on the feed, which would have taxed throughput for every
   * ordinary car in the game.
   */
  specialFinds: SpecialFind[];
}


interface GameStore {
  state: GameState | null;
  ready: boolean;
  awaySummary: AwaySummary | null;
  /** Real wall-clock ms at the last tick, for computing true elapsed time. */
  lastTickAt: number;

  load: () => Promise<void>;
  tick: () => void;
  /** Run a pure sim action and adopt the result. */
  apply: (fn: (s: GameState) => GameState) => void;
  dismissAwaySummary: () => void;
  save: () => Promise<void>;
  hardReset: () => Promise<void>;
}

function diffStats(before: Stats, after: Stats) {
  return {
    carsSold: after.carsSold - before.carsSold,
    commissionPaid: after.commissionPaid - before.commissionPaid,
    collected: after.totalCollected - before.totalCollected,
    notesPaid: after.notesPaidOff - before.notesPaidOff,
    repos: after.reposCompleted - before.reposCompleted,
  };
}

export const useGame = create<GameStore>((set, get) => ({
  state: null,
  ready: false,
  awaySummary: null,
  lastTickAt: Date.now(),

  load: async () => {
    const { state: loaded, elapsedMs } = await readSave();

    if (!loaded) {
      set({ state: createInitialState(makeSeed(), Date.now()), ready: true, lastTickAt: Date.now() });
      return;
    }

    // Admin overrides are written into the tuning globals, and this has to
    // happen BEFORE offline catch-up: those hours are simulated against the
    // constants, so applying them afterwards would replay the absence at the
    // player's settings and produce a summary of a run that never happened.
    const saved = reconcileTuning(loaded);

    // Offline catch-up: exactly the same engine, just more of it.
    const cap = offlineCapMs(saved);
    const simulatedMs = Math.min(elapsedMs, cap);

    let next = saved;
    let summary: AwaySummary | null = null;

    if (simulatedMs > 60_000) {
      const before = { ...saved.stats };
      const cashBefore = saved.cash;
      const eventsBefore = saved.events.length;
      next = advance(saved, simulatedMs);
      const delta = diffStats(before, next.stats);

      summary = {
        elapsedMs,
        simulatedMs,
        capped: elapsedMs > cap,
        cashDelta: next.cash - cashBefore,
        payments: next.events.filter((e) => e.kind === 'payment').length,
        // Read from the events the catch-up actually logged, so the summary
        // cannot claim a level the sim did not award. The log is a ring buffer,
        // so a very long absence reports only the tail — under-reporting beats
        // inventing.
        skillUps: next.events
          .slice(next.events.length > eventsBefore ? -(next.events.length - eventsBefore) : 0)
          .filter((e) => e.kind === 'skill-up')
          .map((e) => e.label),
        specialFinds: specialFinds(saved, next),
        deskTitle: getStage(next.stage).desk.title,
        ...delta,
      };
    }

    set({ state: next, ready: true, awaySummary: summary, lastTickAt: Date.now() });
  },

  tick: () => {
    const { state, lastTickAt } = get();
    if (!state) return;

    const now = Date.now();
    const dt = now - lastTickAt;
    if (dt <= 0) return;

    // Drive the sim from real elapsed time, not from the interval period, so a
    // throttled or backgrounded timer cannot make the game run slow.
    set({ state: advance(state, dt), lastTickAt: now });
  },

  apply: (fn) => {
    const { state } = get();
    if (!state) return;
    set({ state: fn(state) });
  },

  dismissAwaySummary: () => set({ awaySummary: null }),

  save: async () => {
    const { state } = get();
    if (state) await writeSave(state);
  },

  hardReset: async () => {
    // Admin overrides survive a wipe. They are a tuning setting rather than
    // progress, and someone restarting to watch their new numbers play out from
    // hour zero is the main reason to press this. Carrying them also keeps the
    // save and the globals in step: the globals are already overridden, so a
    // fresh state with an empty override map would disagree with the world it
    // was just generated in — `createInitialState` reads the tuned constants.
    const tuning = { ...(get().state?.tuning ?? {}) };
    const fresh = { ...createInitialState(makeSeed(), Date.now()), tuning };
    set({ state: fresh, awaySummary: null, lastTickAt: Date.now() });
    await writeSave(fresh);
  },
}));
