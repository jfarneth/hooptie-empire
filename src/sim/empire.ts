import { BALANCE } from './balance';
import { ownsProperty } from './prestige';
import { getStage } from './stages';
import type { GameState, KeptStore, StageId } from './types';

/**
 * The empire: stores left running under their managers.
 *
 * A kept store is a RECORD AND A WEEKLY CHEQUE, NOT A SECOND SIMULATION. The
 * engine ticks one business — the one the player is standing at — and a kept
 * store's whole economic life is one line on the bill beat. That is the
 * boundary this module exists to hold: the moment a kept store wants its own
 * feed, its own lot or its own book, it stops being a flag and starts being a
 * rewrite of everything `cloneState` and offline catch-up believe.
 *
 * What the cheque is: `STAGES[].managedNetPerWeek`, the store's operating net
 * under a manager, less the rent unless the property is owned. The figure is
 * MEASURED, not asserted — an automation-run store (the same build `dumpsave`
 * makes: automation on, desk on auto, nobody playing) nets $456 / $7.4k /
 * $16.8k / $10.6k / $23.6k / $59.2k a game week at steady state, and the
 * managed figure is ~40% of that operating net: the manager's cut is what
 * pays for a store that runs without you, and it is what keeps attended play
 * strictly better than a cheque. The rent term is why the deed matters to a
 * kept store: green (renting) clears a little, blue (owned) clears the rent
 * too — the property system and the empire are one design.
 *
 * `chequeScale` is the A/B constant. At 0 a kept store pays nothing and
 * consumes nothing, which reproduces the pre-empire economy on an identical
 * stream — keeping a store never draws RNG.
 */

/** The store you left running at this stage, if any. */
export function keptAt(
  state: Pick<GameState, 'empire'>,
  stage: StageId,
): KeptStore | undefined {
  return state.empire.find((k) => k.stage === stage);
}

/**
 * One kept store's weekly cheque: managed net less rent, unless the deed is
 * held. Can go negative only if the admin console pushes a store's managed net
 * under its rent — the shipped table keeps every green store positive, and the
 * guard in stages.test.ts holds that line.
 */
export function keptChequePerWeek(
  state: Pick<GameState, 'properties'>,
  stage: StageId,
): number {
  const def = getStage(stage);
  const rent = ownsProperty(state, stage) ? 0 : def.rentPerWeek;
  return Math.round((def.managedNetPerWeek - rent) * BALANCE.empire.chequeScale);
}

/** Every kept store's cheque, summed — what the group pays per week. */
export function empireChequePerWeek(
  state: Pick<GameState, 'empire' | 'properties'>,
): number {
  return state.empire.reduce((sum, k) => sum + keptChequePerWeek(state, k.stage), 0);
}

/**
 * What selling a kept store off fetches: a modest goodwill figure denominated
 * in its own managed weeks. Deliberately far under what the office cost to
 * build — walking away used to pay zero, so anything here is generosity, and a
 * figure near the entry price would make move-in-and-sell-off a pump.
 */
export function selloffValue(stage: StageId): number {
  return Math.round(getStage(stage).managedNetPerWeek * BALANCE.empire.selloffWeeks);
}
