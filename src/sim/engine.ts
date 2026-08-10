import { BALANCE, MS_PER_GAME_WEEK, TICK_MS } from './balance';
import {
  applyRepoDamage,
  beginRecon,
  canRecon,
  carLabel,
  finishRecon,
  generateCar,
  reconCost,
} from './cars';
import { appraisalError, estimatedWholesale, pessimisticWholesale } from './appraisal';
import { businessDefaults, minBuyMargin, minWorkingCapital, repoThreshold } from './business';
import { generateProspect } from './customers';
import { deskCounter, resolveCounter } from './haggle';
import { arrivalChance, bhphPrice, prospectRate, retailValue, wholesaleValue } from './economy';
import { mintId } from './ids';
import { LISTING_SOURCES, makeName, modelsForMake, modelsForTiers } from './models';
import { getStage, typicalCarPrice } from './stages';
import {
  activeNotes,
  applyDuePayment,
  canWriteNote,
  missChance,
  openNote,
  overCapacityFactor,
} from './notes';
import { chance, createRng, normalish, pick, range } from './rng';
import {
  blankSkills,
  buyXp,
  cloneSkills,
  getSkill,
  grantXp,
  appraisalSigma,
  haggleSkillFor,
  reconModsFor,
  sourcingModsFor,
  repairXp,
  sellXp,
  walkawayXp,
} from './skills';
import {
  UPGRADES,
  carCapacity,
  collectionsCapacity,
  level,
  weeklyWage,
  repoConditionLoss as repoConditionLossFor,
  repoFee as repoFeeFor,
} from './upgrades';
import type { StageSourcing } from './stages';
import type { StockProfile } from './cars';
import type { Car, GameState, Listing, Millis, SimEvent, SkillId } from './types';

export const SAVE_VERSION = 8;

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
    appraisalNoise: drawAppraisalNoise(s),
  });
}

function blankState(seed: number, wallNow: number): GameState {
  return {
    version: SAVE_VERSION,
    t: 0,
    accumulatorMs: 0,
    rng: createRng(seed),
    cash: BALANCE.startingCash,
    stage: 'curbstone',
    cars: [],
    listings: [],
    prospects: [],
    notes: [],
    upgrades: {},
    skills: blankSkills(),
    dealPolicy: 'manual',
    business: businessDefaults(),
    tuning: {},
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
    // The first bill lands a week in, not on the opening tick: a new game should
    // not owe rent before it has seen a car.
    nextBillAt: MS_PER_GAME_WEEK,
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
  stepBills(s);
  stepAutomation(s);
}

// ------------------------------------------------------------------- expenses

/**
 * The weekly bill: rent, wages and floorplan interest.
 *
 * Charged on the same beat note payments land on, and for the same reason it is
 * on the clock rather than on a render: the business runs while the app is
 * closed, and an overhead that only accrued while somebody was watching would
 * make closing the app a way to avoid it.
 *
 * A week can only come due once per 1s step, so this is an `if` and not a
 * `while` — the same argument `stepNotes` makes about payments.
 */
function stepBills(s: GameState): void {
  if (s.nextBillAt > s.t) return;
  s.nextBillAt += MS_PER_GAME_WEEK;

  const bill = weeklyExpenses(s);
  if (bill.total <= 0) return;

  // Paid out of cash, and cash does not go negative. A business that cannot
  // make rent is a real situation and deserves a real mechanic, but a silent
  // negative balance is not it — every buying gate in the game reads `cash >=
  // price` and none of them expect to be handed a debt. The shortfall is logged
  // so it is visible rather than swallowed.
  const paid = Math.min(s.cash, bill.total);
  const short = bill.total - paid;
  s.cash -= paid;
  s.stats.lifetimeProfit -= paid;

  logEvent(s, {
    t: s.t,
    kind: 'expense',
    label: short > 0 ? 'Weekly costs — could not cover them all' : 'Weekly costs',
    amount: -paid,
  });
}

export interface WeeklyExpenses {
  rent: number;
  payroll: number;
  floorplan: number;
  total: number;
}

/**
 * What running the place costs per game week, itemised.
 *
 * Exported because three places need exactly this number and none of them may
 * compute their own: the tick that charges it, the business screen that shows
 * it, and the harness that measures it.
 */
export function weeklyExpenses(s: GameState): WeeklyExpenses {
  const stage = getStage(s.stage);
  const rent = stage.rentPerWeek;

  let payroll = 0;
  for (const def of UPGRADES) payroll += level(s, def.id) * weeklyWage(def, s.stage);

  // Only cars still on the lot. A financed car is out with the customer and is
  // the book's problem, not the floorplan's.
  const tiedUp = s.cars.reduce((sum, c) => (c.status === 'sold' ? sum : sum + c.costBasis), 0);
  const floorplan = Math.round(tiedUp * BALANCE.expenses.floorplanWeeklyRate);

  return { rent, payroll, floorplan, total: rent + payroll + floorplan };
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

  const sourcing = sourcingModsFor(s);
  if (s.listings.length >= sourcing.slots) return;

  const ratePerSec = 1000 / sourcing.intervalMs;
  if (!chance(s.rng, arrivalChance(ratePerSec, TICK_MS))) return;

  spawnListing(s);
}

/**
 * Put one car on the sourcing feed.
 *
 * Both halves of this — what turns up and what it costs — come from the stage,
 * because on a franchise stage they change together: one make, delivery miles,
 * and an invoice price with almost no spread.
 */
function spawnListing(s: GameState): void {
  const stage = getStage(s.stage);
  const { sourcing } = stage;

  const models = sourcing.makeId
    ? modelsForMake(sourcing.makeId)
    : modelsForTiers(sourcing.tiers ?? []);
  const model = pick(s.rng, models);

  const car = generateCar(s, s.rng, model, s.t, stockProfile(sourcing));
  const ask = Math.round(wholesaleValue(car) * range(s.rng, sourcing.askMin, sourcing.askMax));

  s.listings.push({
    id: mintId(s, 'lst'),
    car,
    price: ask,
    expiresAt: s.t + BALANCE.listingLifetimeMs,
    // A franchise consumes one fewer draw per listing than the open market
    // does, which is fine: determinism needs the same state to consume the same
    // stream, not every stage to consume the same amount.
    source: sourcing.makeId
      ? `${makeName(sourcing.makeId)} allocation`
      : pick(s.rng, LISTING_SOURCES),
    appraisalNoise: drawAppraisalNoise(s),
  });
}

/**
 * Mileage and condition overrides for stock that did not come off the open
 * market. Undefined on the used stages, where the car's tier decides.
 */
function stockProfile(sourcing: StageSourcing): StockProfile | undefined {
  if (!sourcing.makeId) return undefined;
  return {
    mileage: [sourcing.mileageMin, sourcing.mileageMax],
    condition: [sourcing.conditionMin, sourcing.conditionMax],
  };
}

/**
 * How wrong this car will look, as a z-score with unit standard deviation.
 *
 * `normalish` spreads over ±spread with sd = spread/3, so spread 3 is what
 * makes this a real z: multiplying it by σ then yields an error whose sd is σ,
 * which is what lets the UI quote an honest ±1σ band.
 */
function drawAppraisalNoise(s: GameState): number {
  return normalish(s.rng, 0, 3, -3, 3);
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
  const haggle = haggleSkillFor(s);

  for (const car of s.cars) {
    if (car.status !== 'listed') continue;
    // One shopper at a time per car keeps the decision surface small.
    if (s.prospects.some((p) => p.carId === car.id)) continue;

    // Shopped against cash retail, which is what the sticker is now denominated
    // in. Judging the ask against the finance window instead made a car priced
    // at what it is worth look like a 30% discount to the traffic model.
    const reference = retailValue(car);
    const rate = prospectRate(car.askPrice, reference, advertising);
    if (!chance(s.rng, arrivalChance(rate, TICK_MS))) continue;

    s.prospects.push(generateProspect(s, s.rng, car, underwriting, haggle, s.t));
  }
}

// ------------------------------------------------------------------ notes

function stepNotes(s: GameState): void {
  if (s.notes.length === 0) return;

  const active = activeNotes(s.notes);
  if (active.length === 0) return;

  const capFactor = overCapacityFactor(active.length, collectionsCapacity(s));
  const repoAfter = repoThreshold(s);

  for (const note of active) {
    // A step is 1s and a payment period is a game week, so at most one payment
    // can come due per step. A while-loop would still be correct; this is not.
    if (note.nextDueAt > s.t) continue;

    const made = !chance(s.rng, missChance(note, capFactor));
    const result = applyDuePayment(note, made, repoAfter);

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
  if (!car) {
    logEvent(s, { t: s.t, kind: 'repo', label: `Repo: ${label} (${customer})`, amount: -fee });
    return;
  }

  // The car was marked sold at delivery; this brings it back to inventory,
  // damaged by however hard it had to be taken.
  applyRepoDamage(car, repoConditionLossFor(s));

  // ...but only if there is a stall for it. THE LOT IS A HARD LIMIT: every
  // buying path is gated on capacity, and a repo is the one event that can add
  // to inventory without anybody choosing to. Left ungated it was the only way
  // to hold more cars than the lot has room for, which reads as a bug because
  // it is one — the HUD says 18/18 and there are twenty cars on the tarmac.
  //
  // A full lot does not cancel the repossession. Same shape as the collections
  // desk, which sells the customer the car instead of the payment rather than
  // sending them away: the car is still taken, it just never comes home. It goes
  // from the tow truck straight to the auction at `forcedSaleRate`, which is
  // less than it is worth, so a full lot costs you the difference. That is the
  // right pressure — it is a reason to keep a stall free, not a wall.
  if (overLotCapacity(s)) {
    const dumped = Math.round(wholesaleValue(car) * BALANCE.forcedSaleRate);
    s.cash += dumped;
    s.stats.lifetimeProfit += dumped - car.costBasis;
    removeCar(s, car.id);
    logEvent(s, {
      t: s.t,
      kind: 'repo',
      label: `Repo: ${label} straight to auction — no room on the lot`,
      amount: dumped - fee,
    });
    return;
  }

  logEvent(s, { t: s.t, kind: 'repo', label: `Repo: ${label} back from ${customer}`, amount: -fee });
}

/**
 * Is the lot holding more than it has room for?
 *
 * Counted AFTER the car in question has been put back, so this is "did that one
 * tip us over", not "were we already full". An existing save can legitimately be
 * over the line — the admin console can shrink a stage's capacity under a lot
 * that is already full — and the rule there is the same one the loan book
 * follows: a new limit never retroactively destroys what a save already holds.
 * It drains by attrition, and nothing new is allowed to arrive.
 */
function overLotCapacity(s: GameState): boolean {
  return s.cars.filter((c) => c.status !== 'sold').length > carCapacity(s);
}

// ------------------------------------------------------------- automation

function stepAutomation(s: GameState): void {
  // Nothing unattended spends below the working capital floor. It is one number
  // read once here so the shop order and the buyer cannot disagree about it —
  // an automated business that runs its own float to zero is the failure mode
  // this setting exists to prevent.
  // The player's floor, or enough to make rent for a few weeks, whichever is
  // higher. An automated business that spends down to its last dollar cannot
  // pay its overheads, and cash at zero is a state it never gets back out of —
  // see `BALANCE.expenses.reserveWeeks`.
  const reserve = Math.max(
    minWorkingCapital(s),
    weeklyExpenses(s).total * BALANCE.expenses.reserveWeeks,
    // Always enough left to replace stock. Denominated in cars because that is
    // the unit that matters: at a franchise a single car is more than three
    // weeks of rent, and a lot that empties out has no way to earn its way back.
    typicalCarPrice(getStage(s.stage)) * BALANCE.expenses.reserveCars,
  );

  if (level(s, 'autoRecon') > 0) {
    const mods = reconModsFor(s);
    for (const car of s.cars) {
      if (!canRecon(car, mods)) continue;
      const cost = reconCost(car, mods);
      // `s.cash` falls as jobs are booked, so the reserve holds across the loop.
      if (cost > s.cash - reserve) continue;
      s.cash -= cost;
      car.costBasis += cost;
      beginRecon(car, mods);
    }
  }

  if (level(s, 'autoList') > 0) {
    for (const car of s.cars) {
      if (car.status !== 'ready') continue;
      // Leave cars alone if the shop still has work to do on them and the
      // standing shop order is going to pick them up next step.
      const mods = reconModsFor(s);
      if (
        level(s, 'autoRecon') > 0 &&
        canRecon(car, mods) &&
        reconCost(car, mods) <= s.cash - reserve
      ) {
        continue;
      }
      listCar(s, car);
    }
  }

  if (level(s, 'autoBuy') > 0) {
    const capacity = carCapacity(s);
    for (const listing of [...s.listings]) {
      if (s.cars.filter((c) => c.status !== 'sold').length >= capacity) break;
      // The retainer buyer sees exactly what the player sees, and works from the
      // bad end of it. Left on ground truth it was omniscient, which made
      // automating strictly better than looking at the feed yourself.
      if (listing.price > acquisitionCeiling(s, listing)) continue;
      if (s.cash - listing.price < reserve) continue;
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

  const haggle = haggleSkillFor(s);
  const counter = deskCounter(neg, haggle);
  if (counter <= neg.currentOffer) {
    acceptCash(s, prospectId);
    return;
  }

  const outcome = resolveCounter(s.rng, neg, counter, haggle);
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
  if (!getStage(s.stage).financing) return 'cash';
  // A full book is not a reason to send a buyer away — it is a reason to sell
  // them the car instead of the payment. Without this the desk would keep
  // choosing paper it cannot write and then close nothing at all.
  if (!canWriteNote(s)) return 'cash';

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

/**
 * What this car is shopped against at this store.
 *
 * Cash retail where there is no finance desk; the marked-up window price where
 * there is, using the store's own markup. One helper because pricing, traffic
 * and the default ask all have to agree on the same number — they got out of
 * step once already and the symptom was cars nobody looked at.
 */
export function windowPrice(s: Pick<GameState, 'stage'>, car: Car): number {
  const stage = getStage(s.stage);
  return stage.financing ? bhphPrice(car, stage.bhphMultiplier) : retailValue(car);
}

/**
 * How confident the buyer is being about a car it cannot see inside.
 *
 * 'worstCase' is what anything spending money unattended must use — it only
 * takes deals that survive the appraisal being wrong. 'estimate' is what a
 * person does: buy on the number in front of them. The harness bot uses
 * 'estimate' deliberately, because a bot working from the floor is a more
 * cautious buyer than any player and would measure a game nobody plays.
 */
export type AppraisalStance = 'worstCase' | 'estimate';

/**
 * The most a buyer should pay for a listing.
 *
 * The two branches are genuinely different questions, and collapsing them is
 * what broke the franchise stages on their first run: both buyers asked "is this
 * under wholesale?", a factory allocation is priced *above* wholesale by
 * construction, and so neither ever bought a single car at a franchise. The feed
 * sat there for ten hours and the economy flatlined.
 *
 *  - **Open market.** Wholesale is what the car is worth to a dealer, so paying
 *    over it is overpaying — and you are guessing at condition besides, which is
 *    what `stance` is about.
 *  - **Franchise.** There is no wholesale market for an allocation and nothing to
 *    appraise; sigma is zero, so both stances agree. Invoice is the price, every
 *    unit is saleable, and the only question is whether the sticker leaves the
 *    margin you asked for. That is the point of the franchise stages: judgement
 *    stops being the game and throughput starts.
 */
export function acquisitionCeiling(
  s: GameState,
  listing: Listing,
  stance: AppraisalStance = 'worstCase',
): number {
  const keepBack = 1 - minBuyMargin(s);
  if (getStage(s.stage).sourcing.makeId) return windowPrice(s, listing.car) * keepBack;

  const sigma = appraisalSigma(s);
  const basis =
    stance === 'worstCase'
      ? pessimisticWholesale(listing, sigma)
      : estimatedWholesale(listing, sigma);
  return basis * keepBack;
}

/**
 * Put a car on the lot.
 *
 * THE DEFAULT ASK IS CASH RETAIL, not the finance window. It used to be the
 * window — retail x `bhphMultiplier` — which was incoherent in two ways at once:
 * a cash offer is capped at `min(askPrice, retail)` so nine buyers in ten would
 * never pay it, and `askPrice / retail` feeds the overpricing model, so the
 * default price was simultaneously unreachable and read by the game as greedy,
 * inviting harder lowballs.
 *
 * The subprime premium belongs on the deal, not on the windscreen: someone
 * paying cash pays what the car is worth, and someone who needs financing pays
 * more for the approval. That is what `bhphPrice` is for, and it is applied
 * where the contract is written.
 */
export function listCar(s: GameState, car: Car, askPrice?: number): void {
  const reference = retailValue(car);
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
    // Nested and mutable: a shared policy object would let a rule change made
    // now rewrite the rules a historical state was running under.
    business: { ...s.business },
    tuning: { ...s.tuning },
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

  // You own it now, so you can put it on a lift. This is where the appraisal
  // gets marked, and where the skill teaches itself — the number was a guess
  // and now it is not.
  reportAppraisal(s, listing, car);

  s.listings.splice(idx, 1);
  awardXp(s, 'buy', buyXp(listing.price));
  return true;
}

/**
 * Say something when a car turns out materially different from how it looked.
 *
 * Only when it is worth saying: a miss inside the threshold is the appraisal
 * working as advertised, and narrating every one of those would train players
 * to ignore the line that matters.
 */
function reportAppraisal(s: GameState, listing: Listing, car: Car): void {
  const error = appraisalError(listing, appraisalSigma(s));
  if (Math.abs(error) < BALANCE.appraisalSurpriseThreshold) return;

  const label = carLabel(car);
  logEvent(s, {
    t: s.t,
    kind: 'appraisal',
    label:
      error > 0
        ? `${label} is rougher than it looked on the feed`
        : `${label} cleaned up better than it looked`,
  });
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
  if (!getStage(s.stage).financing) return false;
  // The book limit is enforced here, on the one path every contract goes
  // through — the sales desk, the harness bot and the player's tap all land on
  // this function, and a limit checked anywhere else would be a limit with a
  // way around it.
  if (!canWriteNote(s)) return false;

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
      repoThreshold(s),
    ).expectedCollected
  );
}

/**
 * `repoAfter` widens the chain rather than being a constant, because the player
 * sets it. The deal sheet quotes this number as exact, so it has to be the
 * player's rule and not the house default the moment those differ.
 */
export function expectedCollections(
  weeks: number,
  paymentAmount: number,
  baseMissChance: number,
  repoAfter: number = BALANCE.repoAfterMissedPayments,
): { expectedCollected: number; defaultProbability: number } {
  const threshold = Math.max(1, Math.round(repoAfter));
  const pFresh = Math.min(0.95, baseMissChance);
  const pBehind = Math.min(0.95, baseMissChance * BALANCE.delinquencyMissMultiplier);

  // states[k] = probability of being alive with k consecutive missed payments.
  // The chain is `threshold` wide: the miss that takes k to `threshold` is the
  // one that takes the car back, so there is no live state at that index.
  let states = new Array<number>(threshold).fill(0);
  states[0] = 1;
  let dead = 0;
  let expectedPayments = 0;

  for (let week = 0; week < weeks; week++) {
    const next = new Array<number>(threshold).fill(0);
    for (let k = 0; k < threshold; k++) {
      const mass = states[k];
      if (mass === 0) continue;
      const p = k === 0 ? pFresh : pBehind;
      // Paid: collect and reset to zero consecutive misses.
      next[0] += mass * (1 - p);
      expectedPayments += mass * (1 - p);
      // Missed: advance, or die at the repo threshold.
      if (k + 1 >= threshold) dead += mass * p;
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
