/**
 * A save with an empire in it, for the screenshot pass: standing at an Okabe
 * store with the small used lot kept AND its property owned, so the ladder
 * pages show blue-kept, gray, and here in one sweep.
 *
 * Same rules as dumpsave.ts: real actions only, cash granted rather than state
 * invented, serialized like any other save.
 */
import { writeFileSync } from 'node:fs';
import { buyProperty, moveToStage, purchaseUpgrade, setDealPolicy } from '../../src/sim/actions';
import { advance, createInitialState } from '../../src/sim/engine';
import { serialize } from '../../src/sim/save';
import { canBuyUpgrade } from '../../src/sim/upgrades';

const [, , out = 'save.json'] = process.argv;

let state = createInitialState(20260818, Date.now());
state = { ...state, cash: 500_000_000 };

// Build a small lot worth keeping, buy its ground, and leave it running.
state = moveToStage(state, 'smallUsed');
for (const id of ['autoBuy', 'autoList', 'autoRecon', 'scout', 'salesDesk', 'lot']) {
  if (canBuyUpgrade(state, id)) state = purchaseUpgrade(state, id);
}
state = setDealPolicy(state, 'auto');
state = buyProperty(state);
state = moveToStage(state, 'midsizeFranchise', { keepCurrent: true });

// A representative Okabe store around it.
for (const id of ['autoBuy', 'autoList', 'autoRecon', 'scout', 'salesDesk', 'lot']) {
  if (canBuyUpgrade(state, id)) state = purchaseUpgrade(state, id);
}
state = setDealPolicy(state, 'auto');
state = { ...state, cash: 40_000_000 };
state = advance(state, 10 * 60 * 1000);

writeFileSync(out, serialize(state, Date.now()), 'utf8');
const held = state.cars.filter((c) => c.status !== 'sold').length;
console.log(`empire save: at ${state.stage}, ${held} cars, ${state.empire.length} kept, ${state.properties.length} deeds`);
