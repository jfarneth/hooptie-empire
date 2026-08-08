import type { GameState } from './types';

/**
 * Ids come from a counter in the save state rather than Math.random or Date.now,
 * so a given seed replays to a byte-identical state. The balance harness and the
 * tick-invariance test both depend on that.
 */
export function mintId(state: Pick<GameState, 'nextId'>, prefix: string): string {
  const id = `${prefix}_${state.nextId}`;
  state.nextId += 1;
  return id;
}
