import { create } from 'zustand';
import { advance, createInitialState } from '../sim/engine';
import { offlineCapMs } from '../sim/upgrades';
import type { GameState, Stats } from '../sim/types';
import { makeSeed, readSave, writeSave } from './persistence';

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
    const { state: saved, elapsedMs } = await readSave();

    if (!saved) {
      set({ state: createInitialState(makeSeed(), Date.now()), ready: true, lastTickAt: Date.now() });
      return;
    }

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
    const fresh = createInitialState(makeSeed(), Date.now());
    set({ state: fresh, awaySummary: null, lastTickAt: Date.now() });
    await writeSave(fresh);
  },
}));
