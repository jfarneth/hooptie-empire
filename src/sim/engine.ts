import { BALANCE, TICK_MS } from './balance';
import {
  applyRepoDamage,
  beginRecon,
  canRecon,
  carLabel,
  finishRecon,
  generateCar,
  reconCost,
} from './cars';
import { generateProspect } from './customers';
import { deskCounter, resolveCounter } from './haggle';
import { arrivalChance, bhphPrice, prospectRate, retailValue, wholesaleValue } from './economy';
import { mintId } from './ids';
import { LISTING_SOURCES, TIERS_BY_STAGE, modelsForTiers } from './models';
import {
  activeNotes,
  applyDuePayment,
  missChance,
  openNote,
  overCapacityFactor,
} from './notes';
import { chance, createRng, pick, range } from './rng';
import {
  blankSkills,
  buyXp,
  cloneSkills,
  getSkill,
  grantXp,
  repairXp,
  sellXp,
  walkawayXp,
} from './skills';
import {
  carCapacity,
  collectionsCapacity,
  level,
  listingIntervalMs,
  listingSlots,
  repoConditionLoss as repoConditionLossFor,
  repoFee as repoFeeFor,
} from './upgrades';
import type { Car, GameState, Millis, SimEvent, SkillId } from './types';

export const SAVE_VERSION = 3;

export function createInitialState(seed: number, wallNow: number): GameState {
  const state = blankState(seed, wallNow);

  // Seed the feed so a brand new player has something to look at immediately.
  // Waiting out the first listing interval on a cold open is the worst possible
  // first twenty seconds for an idle game.
  //
  // The first car is dealt rather than rolled: it is always a beater the player
  // can afford, at a price that leaves a clear margin. Left to chance, roughly
  // one opening in eight had nothing buyable on it at all.
  spawnStarterListing(state);
  for (let i = 1; i < BALANCE.initialListings; i++) spawnListing(state);

  return state;
}

/** The guaranteed opening deal. Affordable, and obviously worth doing. */
function spawnStarterListing(s: GameState): void {
  const models = modelsForTiers(['beater']);
  const model = pick(s.rng, models);
  const car = generateCar(s, s.rng, model, s.t);

  const affordable = BALANCE.startingCash * range(s.rng, 0.5, 0.72);
  const price = Math.round(Math.min(wholesaleValue(car) * 0.95, affordable));

  s.listings.push({
    id: mintId(s, 'lst'),
    car,
    price,
    expiresAt: s.t + BALANCE.listingLifetimeMs * 2,
    source: pick(s.rng, LISTING_SOURCES),
  });
}

function blankState(seed: number, wallNow: number): GameState {
  return {
    version: SAVE_VERSION,
    t: 0,
    accumulatorMs: 0,
    rng: createRng(seed),
    cash: BALANCE.startingCash,
    stage: 'curbstoner',
    cars: [],
    listings: [],
    prospects: [],
    notes: [],
    upgrades: {},
    skills: blankSkills(),
    dealPolicy: 'manual',
    stats: {
      carsSold: 0,
      cashDeals: 0,
      financeDeals: 0,
      notesPaidOff: 0,
      notesDefaulted: 0,
      reposCompleted: 0,
      negotiationsWon: 0,
      walkaways: 0,
      totalCollected: 0,
      lifetimeProfit: 0,
    },
    events: [],
    lastSeenAt: wallNow,
    nextId: 1,
  };
}

/**
 * Advance the simulation by `dtMs`.
 *
 * The engine always steps in fixed TICK_MS slices, carrying the remainder in
 * `accumulatorMs`. That fixed step is what makes offline catch-up trustworthy:
 * advancing 3600 times by 1s and advancing once by 3600s consume the RNG in the
 * exact same order and produce byte-identical state. Returning after eight hours
 * away is not an approximation of what would have happened — it is what would
 * have happened.
 *
 * Cost: 8h of catch-up is 28,800 steps over at most a few hundred entities,
 * which lands in the low hundreds of milliseconds. See tools/simulate.ts.
 *
 * State is cloned once here and then mutated in place by `step`; cloning per
 * step would make catch-up quadratic for no benefit.
 */
export function advance(state: GameState, dtMs: number): GameState {
  const next = cloneState(state);
  if (dtMs <= 0) return next;

  next.accumulatorMs += dtMs;
  let steps = Math.floor(next.accumulatorMs / TICK_MS);
  next.accumulatorMs -= steps * TICK_MS;

  while (steps-- > 0) step(next);
  return next;
}

/** One fixed 1s slice. Mutates. */
function step(s: GameState): void {
  s.t += TICK_MS;
  stepRecon(s);
  stepListings(s);
  stepProspects(s);
  stepNotes(s);
  stepAutomation(s);
}

// ------------------------------------------------------------------ recon

function stepRecon(s: GameState): void {
  for (const car of s.cars) {
    if (car.status !== 'recon') continue;
    car.reconRemainingMs -= TICK_MS;
    if (car.reconRemainingMs <= 0) {
      // Captured before finishing, because finishRecon() is what closes the gap.
      const lift = car.reconTargetCondition - car.condition;
      finishRecon(car);
      awardXp(s, 'repair', repairXp(lift));
      logEvent(s, { t: s.t, kind: 'recon-done', label: `${carLabel(car)} out of the shop` });
    }
  }
}

// --------------------------------------------------------------- sourcing

function stepListings(s: GameState): void {
  // Expire stale listings.
  if (s.listings.length > 0) {
    s.listings = s.listings.filter((l) => l.expiresAt > s.t);
  }

  const slots = listingSlots(s);
  if (s.listings.length >= slots) return;

  const ratePerSec = 1000 / listingIntervalMs(s);
  if (!chance(s.rng, arrivalChance(ratePerSec, TICK_MS))) return;

  spawnListing(s);
}

/** Put one car on the sourcing feed. */
function spawnListing(s: GameState): void {
  const tiers = TIERS_BY_STAGE[s.stage] ?? TIERS_BY_STAGE.curbstoner;
  const models = modelsForTiers(tiers);
  const model = pick(s.rng, models);
  const car = generateCar(s, s.rng, model, s.t);
  const ask = Math.round(
    wholesaleValue(car) * range(s.rng, BALANCE.listingAskMin, BALANCE.listingAskMax),
  );

  s.listings.push({
    id: mintId(s, 'lst'),
    car,
    price: ask,
    expiresAt: s.t + BALANCE.listingLifetimeMs,
    source: pick(s.rng, LISTING_SOURCES),
  });
}

// ------------------------------------------------------------------ sales

function stepProspects(s: GameState): void {
  if (s.prospects.length > 0) {
    // A buyer leaves when they run out of patience or when they walked away
    // from a negotiation. Either way the car goes back to waiting for traffic.
    s.prospects = s.prospects.filter((p) => p.expiresAt > s.t && p.negotiation.status !== 'walked');
  }

  const advertising = level(s, 'advertising');
  const underwriting = level(s, 'underwriting');

  for (const car of s.cars) {
    if (car.status !== 'listed') continue;
    // One shopper at a time per car keeps the decision surface small.
    if (s.prospects.some((p) => p.carId === car.id)) continue;

    // Cars are shopped against what the buyer could pay for them: cash retail in
    // stage 1, the marked-up window price once there is a finance desk.
    const reference = s.stage === 'bhph' ? bhphPrice(car) : retailValue(car);
    const rate = prospectRate(car.askPrice, reference, advertising);
    if (!chance(s.rng, arrivalChance(rate, TICK_MS))) continue;

    s.prospects.push(generateProspect(s, s.rng, car, underwriting, s.t));
  }
}

// ------------------------------------------------------------------ notes

function stepNotes(s: GameState): void {
  if (s.notes.length === 0) return;

  const active = activeNotes(s.notes);
  if (active.length === 0) return;

  const capFactor = overCapacityFactor(active.length, collectionsCapacity(s));

  for (const note of active) {
    // A step is 1s and a payment period is a game week, so at most one payment
    // can come due per step. A while-loop would still be correct; this is not.
    if (note.nextDueAt > s.t) continue;

    const made = !chance(s.rng, missChance(note, capFactor));
    const result = applyDuePayment(note, made);

    if (result.paid) {
      s.cash += result.amount;
      s.stats.totalCollected += result.amount;
      s.stats.lifetimeProfit += result.amount;
      logEvent(s, {
        t: s.t,
        kind: 'payment',
        label: `${note.customerName} paid`,
        amount: result.amount,
      });
    }

    if (result.closed) {
      s.stats.notesPaidOff += 1;
      // Paid in full: the customer owns it outright and it leaves the books.
      removeCar(s, note.carId);
      logEvent(s, { t: s.t, kind: 'note-paid', label: `${note.customerName} paid off ${note.carLabel}` });
    } else if (result.defaulted) {
      s.stats.notesDefaulted += 1;
      repossess(s, note.carId, note.customerName, note.carLabel);
    }
  }

  pruneClosedNotes(s);
}

/**
 * Closed notes are kept for the ledger's history tab, but only recently. Without
 * this the notes array grows forever and every step pays to walk it.
 */
function pruneClosedNotes(s: GameState): void {
  const closed = s.notes.filter((n) => n.status === 'paid' || n.status === 'defaulted');
  if (closed.length <= BALANCE.closedNoteHistory) return;
  const cutoff = closed.length - BALANCE.closedNoteHistory;
  let dropped = 0;
  s.notes = s.notes.filter((n) => {
    if (n.status !== 'paid' && n.status !== 'defaulted') return true;
    if (dropped < cutoff) {
      dropped += 1;
      return false;
    }
    return true;
  });
}

/**
 * Take the car back. The player keeps every dollar already collected and gets
 * the unit back to sell again — which is why a defaulted note is frequently
 * worth more than the cash sale the player passed on.
 */
function repossess(s: GameState, carId: string, customer: string, label: string): void {
  const fee = repoFeeFor(s);
  s.cash -= fee;
  s.stats.lifetimeProfit -= fee;
  s.stats.reposCompleted += 1;

  const car = s.cars.find((c) => c.id === carId);
  if (car) {
    // The car was marked sold at delivery; bring it back to inventory.
    applyRepoDamage(car, repoConditionLossFor(s));
    logEvent(s, { t: s.t, kind: 'repo', label: `Repo: ${label} back from ${customer}`, amount: -fee });
  } else {
    logEvent(s, { t: s.t, kind: 'repo', label: `Repo: ${label} (${customer})`, amount: -fee });
  }
}

// ------------------------------------------------------------- automation

function stepAutomation(s: GameState): void {
  if (level(s, 'autoRecon') > 0) {
    for (const car of s.cars) {
      if (!canRecon(car)) continue;
      const cost = reconCost(car);
      if (cost > s.cash) continue;
      s.cash -= cost;
      car.costBasis += cost;
      beginRecon(car, level(s, 'mechanic'));
    }
  }

  if (level(s, 'autoList') > 0) {
    for (const car of s.cars) {
      if (car.status !== 'ready') continue;
      // Leave cars alone if the shop still has work to do on them and the
      // standing shop order is going to pick them up next step.
      if (level(s, 'autoRecon') > 0 && canRecon(car) && reconCost(car) <= s.cash) continue;
      listCar(s, car);
    }
  }

  if (level(s, 'autoBuy') > 0) {
    const capacity = carCapacity(s);
    for (const listing of [...s.listings]) {
      if (s.cars.filter((c) => c.status !== 'sold').length >= capacity) break;
      if (listing.price > wholesaleValue(listing.car)) continue;
      // Keep a working reserve so automation cannot spend the player broke.
      if (s.cash - listing.price < 500) continue;
      buyListingInternal(s, listing.id);
    }
  }

  if (level(s, 'salesDesk') > 0 && s.dealPolicy !== 'manual' && s.prospects.length > 0) {
    for (const prospect of [...s.prospects]) {
      const choice = chooseDeal(s, prospect.id);
      if (choice === 'finance') {
        acceptFinance(s, prospect.id);
      } else if (choice === 'cash') {
        runDeskNegotiation(s, prospect.id);
      }
    }
  }
}

/**
 * The sales desk's standing play: counter exactly once, then take whatever comes
 * back. It resolves the whole haggle inside a single step because the desk has
 * no reason to deliberate — which also keeps offline catch-up cheap.
 *
 * It uses the same pure functions the player's taps go through, so an automated
 * lot and a hand-played one are running identical rules.
 */
function runDeskNegotiation(s: GameState, prospectId: string): void {
  const prospect = s.prospects.find((p) => p.id === prospectId);
  if (!prospect) return;

  const neg = prospect.negotiation;

  // Already at the asking price, or the desk has had its turn: just close.
  if (neg.countersMade > 0 || neg.currentOffer >= neg.anchor) {
    acceptCash(s, prospectId);
    return;
  }

  const counter = deskCounter(neg);
  if (counter <= neg.currentOffer) {
    acceptCash(s, prospectId);
    return;
  }

  const outcome = resolveCounter(s.rng, neg, counter);
  if (outcome.kind === 'walked') {
    registerWalkaway(s, prospect.name);
    return; // stepProspects sweeps them out.
  }

  // Accepted, or they came back with a better number — either way, take it.
  acceptCash(s, prospectId);
}

/** Which side of the deal the standing policy takes. */
function chooseDeal(s: GameState, prospectId: string): 'cash' | 'finance' | 'none' {
  const prospect = s.prospects.find((p) => p.id === prospectId);
  if (!prospect) return 'none';
  if (s.stage !== 'bhph') return 'cash';

  switch (s.dealPolicy) {
    case 'cash':
      return 'cash';
    case 'finance':
      return 'finance';
    case 'auto': {
      const capFactor = overCapacityFactor(activeNotes(s.notes).length, collectionsCapacity(s));
      const ev = expectedFinanceValue(s, prospect.id, capFactor);
      return ev > prospect.negotiation.currentOffer ? 'finance' : 'cash';
    }
    default:
      return 'none';
  }
}

// ------------------------------------------------------------------- utils

export function listCar(s: GameState, car: Car, askPrice?: number): void {
  const reference = s.stage === 'bhph' ? bhphPrice(car) : retailValue(car);
  car.askPrice = Math.round(askPrice ?? reference * BALANCE.defaultAskRatio);
  car.status = 'listed';
  car.listedAt = s.t;
}

/**
 * Award skill XP and announce any level-up.
 *
 * This lives on the shared path rather than in actions.ts on purpose. The
 * standing shop order, the retainer buyer and the sales desk all call the
 * engine internals directly, so XP granted in the player-facing wrapper would
 * quietly stop accruing the moment someone automated — exactly backwards for an
 * idle game.
 */
export function awardXp(s: GameState, id: SkillId, amount: number): void {
  const gained = grantXp(s, id, amount);
  if (gained === 0) return;

  const name = getSkill(id).name;
  const finalLevel = s.skills[id].level;
  for (let i = gained; i > 0; i--) {
    logEvent(s, {
      t: s.t,
      kind: 'skill-up',
      label: `${name} reached level ${finalLevel - i + 1}`,
    });
  }
}

/**
 * A buyer walking is bookkeeping in three places at once, and it happens on
 * both the hand-played and the automated path. One helper so a fourth caller
 * cannot forget one of them.
 */
export function registerWalkaway(s: GameState, customerName: string): void {
  s.stats.walkaways += 1;
  awardXp(s, 'sell', walkawayXp());
  logEvent(s, { t: s.t, kind: 'walkaway', label: `${customerName} walked` });
}

export function logEvent(s: GameState, event: SimEvent): void {
  s.events.push(event);
  if (s.events.length > BALANCE.eventLogSize) {
    s.events.splice(0, s.events.length - BALANCE.eventLogSize);
  }
}

/** Deep clone of the mutable game state. Hand-written to avoid relying on
 *  structuredClone, which Hermes does not reliably provide. */
export function cloneState(s: GameState): GameState {
  return {
    ...s,
    rng: { s: s.rng.s },
    cars: s.cars.map((c) => ({ ...c })),
    listings: s.listings.map((l) => ({ ...l, car: { ...l.car } })),
    // Every nested object on a prospect must be cloned explicitly. A shared
    // negotiation would mutate backwards through history and quietly corrupt
    // offline catch-up, which the tick-invariance test exists to catch.
    prospects: s.prospects.map((p) => ({
      ...p,
      financeTerms: { ...p.financeTerms },
      negotiation: { ...p.negotiation },
    })),
    notes: s.notes.map((n) => ({ ...n })),
    upgrades: { ...s.upgrades },
    // Each skill is a nested object, so the record needs cloning entry by entry
    // for the same reason prospects do.
    skills: cloneSkills(s.skills),
    stats: { ...s.stats },
    events: s.events.map((e) => ({ ...e })),
  };
}

// Actions live in actions.ts but automation needs a few of them; importing there
// would be circular, so the shared implementations sit here and actions.ts wraps
// them with the player-facing validation.
export { buyListingInternal, acceptCash, acceptFinance, expectedFinanceValue };

function buyListingInternal(s: GameState, listingId: string): boolean {
  const idx = s.listings.findIndex((l) => l.id === listingId);
  if (idx < 0) return false;
  const listing = s.listings[idx];
  if (s.cash < listing.price) return false;
  if (s.cars.filter((c) => c.status !== 'sold').length >= carCapacity(s)) return false;

  s.cash -= listing.price;
  const car = { ...listing.car, costBasis: listing.price, acquiredAt: s.t };
  s.cars.push(car);
  s.listings.splice(idx, 1);
  awardXp(s, 'buy', buyXp(listing.price));
  return true;
}

function acceptCash(s: GameState, prospectId: string): boolean {
  const idx = s.prospects.findIndex((p) => p.id === prospectId);
  if (idx < 0) return false;
  const prospect = s.prospects[idx];
  if (prospect.negotiation.status === 'walked') return false;
  const car = s.cars.find((c) => c.id === prospect.carId);
  if (!car || car.status !== 'listed') return false;

  // Whatever is on the table right now — their opening number, or whatever the
  // haggle settled on.
  const price = prospect.negotiation.currentOffer;
  const profit = price - car.costBasis;
  s.cash += price;
  s.stats.carsSold += 1;
  s.stats.cashDeals += 1;
  s.stats.lifetimeProfit += profit;

  if (prospect.negotiation.countersMade > 0) s.stats.negotiationsWon += 1;
  awardXp(s, 'sell', sellXp(price, prospect.negotiation.countersMade));

  logEvent(s, {
    t: s.t,
    kind: 'sale-cash',
    label: `Cash sale: ${carLabel(car)}`,
    amount: price,
  });

  removeCar(s, car.id);
  s.prospects.splice(idx, 1);
  return true;
}

function acceptFinance(s: GameState, prospectId: string): boolean {
  const idx = s.prospects.findIndex((p) => p.id === prospectId);
  if (idx < 0) return false;
  const prospect = s.prospects[idx];
  if (s.stage !== 'bhph') return false;

  const car = s.cars.find((c) => c.id === prospect.carId);
  if (!car || car.status !== 'listed') return false;

  const label = carLabel(car);
  const note = openNote(s, prospect, label, s.t);
  s.notes.push(note);

  s.cash += prospect.downPayment;
  s.stats.carsSold += 1;
  s.stats.financeDeals += 1;
  s.stats.lifetimeProfit += prospect.downPayment - car.costBasis;

  logEvent(s, {
    t: s.t,
    kind: 'sale-finance',
    label: `Financed: ${label} to ${prospect.name} (${prospect.tier})`,
    amount: prospect.downPayment,
  });

  // The car leaves the lot but stays in state so a repo can bring it back.
  car.status = 'sold';
  car.askPrice = 0;
  car.listedAt = null;
  s.prospects.splice(idx, 1);
  return true;
}

/** Drop a car that is gone for good (cash sale). */
function removeCar(s: GameState, carId: string): void {
  const i = s.cars.findIndex((c) => c.id === carId);
  if (i >= 0) s.cars.splice(i, 1);
}

/**
 * Expected cash from financing this prospect, accounting for the chance the
 * contract dies early.
 *
 * Modelled exactly rather than guessed: consecutive-missed-payments is a small
 * Markov chain (0, 1, 2, defaulted), so rolling it forward `weeks` steps gives
 * the true expected number of payments collected under the same rules the
 * engine uses. The deal sheet shows this number, which turns the cash-versus-
 * finance choice into a judgement instead of a coin flip.
 */
function expectedFinanceValue(s: GameState, prospectId: string, capacityFactor: number): number {
  const prospect = s.prospects.find((p) => p.id === prospectId);
  if (!prospect) return 0;
  return (
    prospect.downPayment +
    expectedCollections(
      prospect.financeTerms.weeks,
      prospect.financeTerms.weeklyPayment,
      BALANCE.creditTiers[prospect.tier].missChance * capacityFactor,
    ).expectedCollected
  );
}

export function expectedCollections(
  weeks: number,
  paymentAmount: number,
  baseMissChance: number,
): { expectedCollected: number; defaultProbability: number } {
  const pFresh = Math.min(0.95, baseMissChance);
  const pBehind = Math.min(0.95, baseMissChance * BALANCE.delinquencyMissMultiplier);

  // states[k] = probability of being alive with k consecutive missed payments
  let states = [1, 0, 0];
  let dead = 0;
  let expectedPayments = 0;

  for (let week = 0; week < weeks; week++) {
    const next = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      const mass = states[k];
      if (mass === 0) continue;
      const p = k === 0 ? pFresh : pBehind;
      // Paid: collect and reset to zero consecutive misses.
      next[0] += mass * (1 - p);
      expectedPayments += mass * (1 - p);
      // Missed: advance, or die at the repo threshold.
      if (k + 1 >= BALANCE.repoAfterMissedPayments) dead += mass * p;
      else next[k + 1] += mass * p;
    }
    states = next;
  }

  return {
    expectedCollected: Math.round(expectedPayments * paymentAmount),
    defaultProbability: dead,
  };
}

export { step as __stepForTests };
export type { Millis };
