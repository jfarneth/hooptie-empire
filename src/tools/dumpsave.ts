/**
 * Dump a mid-game save, for looking at a stage in the browser without playing to
 * it.
 *
 *   npx tsx src/tools/dumpsave.ts smallUsed save.json
 *
 * Buys the store outright, turns on the automation upgrades and lets the real
 * engine run until the lot has cars on it. Inject the result into `localStorage`
 * under `hooptie.save` before the page loads — and stamp `lastSeenAt`, or the
 * away-summary modal covers the screen you wanted to look at.
 *
 * Not part of the build or the test suite. The one thing it must never become is
 * a second definition of what a save is: it goes through `serialize` and the
 * ordinary actions like everything else, and it grants cash rather than
 * inventing state.
 */
import { writeFileSync } from 'node:fs';
import { moveToStage, purchaseUpgrade, setDealPolicy } from '../sim/actions';
import { advance, createInitialState } from '../sim/engine';
import { serialize } from '../sim/save';
import type { StageId } from '../sim/types';
import { canBuyUpgrade } from '../sim/upgrades';

const [, , wanted = 'smallUsed', out = 'save.json', minutesArg = '45'] = process.argv;

let state = createInitialState(20260810, Date.now());
state = { ...state, cash: 400_000_000 };
state = moveToStage(state, wanted as StageId);

// Everything that fills a lot without a player tapping. Bought once, not maxed:
// the point is a representative store, not an endgame one.
for (const id of ['autoBuy', 'autoList', 'autoRecon', 'scout', 'mechanic', 'salesDesk', 'lot']) {
  if (canBuyUpgrade(state, id)) state = purchaseUpgrade(state, id);
}
// A hired desk on 'manual' is a desk that is not turned on — and with the
// grace window it is also a lot where every walk-up waits for a player who is
// not there. The whole point of this tool is automation running.
state = setDealPolicy(state, 'auto');
state = { ...state, cash: 3_000_000 };

const STEP_MS = 5_000;
const steps = Math.round((Number(minutesArg) * 60_000) / STEP_MS);
for (let i = 0; i < steps; i++) state = advance(state, STEP_MS);

writeFileSync(out, serialize(state, Date.now()));
console.log(
  `${state.stage}: ${state.cars.filter((c) => c.status !== 'sold').length} cars held, ` +
    `$${Math.round(state.cash).toLocaleString()} cash`,
);
