import { BALANCE, MS_PER_GAME_WEEK, TICK_MS } from './balance';
import {
  applyRepoDamage,
  beginRecon,
  canRecon,
  carLabel,
  chargeRecon,
  finishRecon,
  generateCar,
  reconCost,
} from './cars';
import { appraisalError, estimatedBook, pessimisticBook } from './appraisal';
import {
  businessDefaults,
  minBuyMargin,
  minWorkingCapital,
  repoThreshold,
  servicePlanBand,
  shopRateLevel,
  listMarkup,
  offerFloor as offerFloorHere,
  paymentPush as paymentPushHere,
} from './business';
import {
  claimCostMultiplier,
  maybeSellPlan,
  pruneClosedPlans,
  stepDuePlans,
  voidPlansForCar,
} from './service';
import { bayCount, shopPayroll, shopRate, stepShop } from './shop';
import { generateProspect } from './customers';
import { deskCounter, resolveCounter, resolvePaymentPush } from './haggle';
import {
  arrivalChance,
  bhphPrice,
  bookValue,
  prospectRate,
  retailValue,
  wholesaleValue,
} from './economy';
import { mintId } from './ids';
import { drawOrigin, freightCost, getMarketTier, landedCost } from './market';
import { LISTING_SOURCES, makeName, modelsForMake, modelsForTiers } from './models';
import { getStage } from './stages';
import {
  activeNotes,
  applyDuePayment,
  canWriteNote,
  expectedCollections,
  missChance,
  openNote,
  overCapacityFactor,
  repoCarryingValue,
} from './notes';
import { prestigeEdge } from './prestige';
import { baseTrim, rarityAskMult } from './rarity';
import {
  expirePromotions,
  getPromotion,
  promotionDuration,
  promotionTrafficMultiplier,
  startPromotion,
} from './promotions';
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
import type {
  BookLine,
  Car,
  GameState,
  Listing,
  Millis,
  Note,
  Prospect,
  SimEvent,
  SkillId,
  WeekLines,
} from './types';

export const SAVE_VERSION = 21;

export function createInitialState(seed: number, wallNow: number): GameState {
  const state = blankState(seed, wallNow);

  // Every business opens with a grand opening, including the one you start
  // after retiring. It costs no RNG draws, so a run's stream is identical with
  // or without it and every seeded comparison still lines up.
  openTheDoors(state);

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

/**
 * The opening promotion, and the ledger line that tells the player it is on.
 *
 * The first twenty minutes are the thinnest part of the game — one car, one
 * buyer every couple of minutes — and this is the cheapest honest way to give
 * them a pulse: it moves the arrival rate and nothing else, so no price, margin
 * or credit number the rest of the economy is balanced on has to move with it.
 */
function openTheDoors(s: GameState): void {
  const active = startPromotion(s, 'grandOpening');
  const def = getPromotion(active.id);
  if (!def) return;
  logEvent(s, {
    t: s.t,
    kind: 'promotion',
    label: `${def.name} — ${def.effect.toLowerCase()} for ${Math.round(promotionDuration(active.id) / 60_000)} minutes.`,
  });
}

/** The guaranteed opening deal. Affordable, and obviously worth doing. */
function spawnStarterListing(s: GameState): void {
  const models = modelsForTiers(['beater']);
  const model = pick(s.rng, models);
  const car = generateCar(s, s.rng, model, s.t);

  // Stock trim, same rule the rotating feed follows — if the dealt car happens
  // to roll a grade, the opening deal is quietly a very good one rather than a
  // more expensive one.
  const affordable = BALANCE.startingCash * range(s.rng, 0.5, 0.72);
  const price = Math.round(Math.min(wholesaleValue(baseTrim(car)) * 0.95, affordable));

  s.listings.push({
    id: mintId(s, 'lst'),
    car,
    price,
    expiresAt: s.t + BALANCE.listingLifetimeMs * 2,
    // The opening deal is always the car down the road. A new game has no reach
    // and nothing to truck anything with.
    origin: 'local',
    freight: 0,
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
    serviceContracts: [],
    shop: { techs: [], jobs: [], weekRevenue: 0, weekJobs: 0 },
    upgrades: {},
    skills: blankSkills(),
    dealPolicy: 'manual',
    business: businessDefaults(),
    promotions: [],
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
      commissionPaid: 0,
      plansSold: 0,
      planIncome: 0,
      planPayouts: 0,
      shopRevenue: 0,
      shopJobsDone: 0,
      shopReworks: 0,
      shopTurnedAway: 0,
    },
    weeks: [],
    weekRevenue: 0,
    weekLines: emptyWeekLines(),
    weekProfitAt: 0,
    events: [],
    prestige: { count: 0, points: 0, history: [] },
    loan: null,
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
  stepPromotions(s);
  stepRecon(s);
  stepListings(s);
  stepProspects(s);
  stepNotes(s);
  // The other side of the book, on the same weekly beat and with the opposite
  // sign. Placed straight after the notes for that reason, and before the bill
  // so a week's claims and a week's rent land in the order the week happened.
  stepServicePlans(s);
  stepServiceDept(s);
  stepBills(s);
  stepAutomation(s);
}

// ----------------------------------------------------------------- promotions

/**
 * Retire anything that has run out.
 *
 * This is bookkeeping and a ledger line, NOT what makes the boost stop. The
 * clock filter is inside `livePromotions`, so the traffic multiplier is already
 * back to 1 on the tick a promotion is due whether this has swept it yet or
 * not — which is deliberate, because the UI and the harness both read that
 * accessor between ticks and neither of them runs the sweep. Moving this call
 * to the end of `step` changes nothing; the belt and the braces are both real.
 *
 * Consumes no RNG, which is what lets promotions be added to an existing save
 * without shifting a single draw in the stream.
 */
function stepPromotions(s: GameState): void {
  if (s.promotions.length === 0) return;
  for (const def of expirePromotions(s)) {
    logEvent(s, { t: s.t, kind: 'promotion', label: `${def.name} is over.` });
  }
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

  // Split the floorplan line across the cars that incurred it, before anything
  // is charged. `weeklyExpenses` is a pure read — the UI and the harness both
  // call it between ticks — so the accrual has to happen here, on the beat that
  // actually bills for it.
  //
  // Unrounded on purpose. Each car's share is its own basis times the rate, so
  // the shares sum to `tiedUp × rate`, which is exactly the number rounded into
  // `bill.floorplan`. Rounding per car instead would leave the report's total a
  // few dollars off the ledger's, on a screen whose entire job is reconciling
  // the two.
  for (const car of s.cars) {
    if (car.status === 'sold') continue;
    car.carryingCost += car.costBasis * BALANCE.expenses.floorplanWeeklyRate;
  }

  // The shop's week, in one line. Its money already landed, job by job, as the
  // cars went out — see `stepServiceDept` for why none of that is logged
  // individually. This is the ledger's honest account of it, and it is written
  // before the bill so the takings read above the wages that produced them.
  if (s.shop.weekJobs > 0) {
    logEvent(s, {
      t: s.t,
      kind: 'shop',
      label: `Service department — ${s.shop.weekJobs} job${s.shop.weekJobs > 1 ? 's' : ''} billed`,
      amount: s.shop.weekRevenue,
    });
    s.shop.weekRevenue = 0;
    s.shop.weekJobs = 0;
  }

  // Rent, wages and floorplan are paid out of cash, and cash does not go
  // Charged IN FULL, whatever the balance says afterwards. Rent and wages used
  // to floor at zero, which produced the game's sneakiest failure state: a
  // business pinned at $0 paid nothing, so two different expense settings
  // reported identical lifetime profit and the books quietly stopped meaning
  // anything. A landlord does not floor at zero and neither do wages owed —
  // the honest ledger goes negative, the buying gates (`cash >= price`) shut
  // themselves off, and digging out is selling stock and collecting payments,
  // which are both still possible at any balance. Recovery stays reachable;
  // only the number stops lying.
  const overheads = bill.total - bill.debtService;
  if (overheads > 0) {
    s.cash -= overheads;
    // ONE CHEQUE, THREE DEPARTMENTS. Floorplan is interest on unsold stock, so
    // it belongs to the cars — it is the same money the ageing report charges
    // car by car, and putting it in overhead would let a lot full of metal
    // nobody wants read as a healthy sales line. The technicians belong to the
    // bays for the sharper reason: a shop that bills $163M and quietly loses
    // $10k a week is the trap this whole split exists to make visible, and it
    // is invisible the moment their wages land anywhere else. Rent and the
    // sales-side payroll are the cost of having a business at all.
    bookProfit(s, 'metal', -bill.floorplan);
    bookProfit(s, 'shop', -bill.shopPayroll);
    bookProfit(s, 'overhead', -(overheads - bill.floorplan - bill.shopPayroll));
    logEvent(s, {
      t: s.t,
      kind: 'expense',
      label: s.cash < 0 ? 'Weekly costs — the account is overdrawn' : 'Weekly costs',
      amount: -overheads,
    });
  }

  // THE SHARK ALWAYS COLLECTS. Every bill drives the balance below zero now,
  // but his is still different in kind: rent stops when you move and wages stop
  // when staff reset, while his schedule survives everything short of
  // retirement, which settles him off the top of the sale. There is no
  // missed-payment state and no compounding shortfall — the schedule simply
  // runs until the player recovers or quits.
  if (s.loan) {
    s.cash -= s.loan.paymentAmount;
    bookProfit(s, 'overhead', -s.loan.paymentAmount);
    s.loan.paymentsRemaining -= 1;
    logEvent(s, {
      t: s.t,
      kind: 'loan',
      label:
        s.loan.paymentsRemaining > 0
          ? `The shark's cut — ${s.loan.paymentsRemaining} to go`
          : 'The shark is paid off',
      amount: -s.loan.paymentAmount,
    });
    if (s.loan.paymentsRemaining <= 0) s.loan = null;
  }

  // Last, so the week owns every cost it incurred.
  closeTheWeek(s);
}

export interface WeeklyExpenses {
  rent: number;
  payroll: number;
  floorplan: number;
  /**
   * The technicians. Kept apart from `payroll` because the two answer different
   * questions: the sales side is overhead against the cars, and this is the
   * direct cost of a department that bills for its own time. A shop losing money
   * and a lot losing money need opposite fixes, and one merged number hides
   * which one is happening.
   */
  shopPayroll: number;
  /** The shark's weekly payment, when a loan is out. */
  debtService: number;
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

  // In the total so the reserve floor and the harness hold money back for it —
  // an automated business that budgets for rent but not for the shark walks
  // straight into the hole the reserve exists to prevent.
  const debtService = s.loan ? s.loan.paymentAmount : 0;

  // The benches. In the total for the same reason everything else is: the
  // working-capital floor and the harness both have to see the whole bill, and a
  // department whose wages were invisible to the reserve would be a way to walk
  // into exactly the hole the reserve exists to prevent.
  const shopWages = shopPayroll(s);

  return {
    rent,
    payroll,
    floorplan,
    shopPayroll: shopWages,
    debtService,
    total: rent + payroll + floorplan + shopWages + debtService,
  };
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
  // A retired-and-returned dealer buys cheaper everywhere — auction or invoice.
  // Applied after the draw so the RNG stream is identical with or without an
  // edge; the discount is deterministic from the save's prestige points.
  const edge = 1 - prestigeEdge(s);
  // THE ASK IS PRICED IN STOCK TRIM, or nearly so. This is one half of the
  // rarity feature and the whole of its economics: a dealer auction does not pay
  // extra for a spoiler and a wholesale book has no column for one, so the
  // seller quotes the base car and the premium is left on the table for whoever
  // spots it. Pricing the fully trimmed car instead would scale ask and retail
  // together and make rarity worth exactly nothing.
  //
  // `raritySellerCapture` is how much of the premium this particular seller is
  // wise to — zero at auction, high at a factory, which does list the trim
  // package on the invoice.
  const ask = Math.round(
    wholesaleValue(baseTrim(car)) *
      rarityAskMult(car.rarity, sourcing.raritySellerCapture) *
      range(s.rng, sourcing.askMin, sourcing.askMax) *
      edge,
  );

  // Where this one is, and what the truck costs. Drawn before the source label
  // because the label depends on it; consumes no draw at all while the business
  // is local-only, which is what keeps a pre-reach save replaying identically.
  const origin = drawOrigin(s.rng, s);
  const tier = getMarketTier(origin);

  s.listings.push({
    id: mintId(s, 'lst'),
    car,
    price: ask,
    origin,
    freight: freightCost(origin, ask),
    expiresAt: s.t + BALANCE.listingLifetimeMs,
    // A franchise consumes one fewer draw per listing than the open market
    // does, which is fine: determinism needs the same state to consume the same
    // stream, not every stage to consume the same amount.
    source: sourcing.makeId
      ? `${makeName(sourcing.makeId)} ${tier.allocation}`
      : pick(s.rng, tier.sources),
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
  // Applied to the rate rather than inside `prospectRate`, which stays a pure
  // function of price and advertising. A promotion cannot rescue an overpriced
  // car either way: the rate is already zero above `maxViablePriceRatio`, and
  // twice nothing is nothing.
  const promotion = promotionTrafficMultiplier(s);
  // How busy this store is per car on the lot. Hoisted because it is the same
  // for every car and this loop runs once per listed car per second.
  const storeTraffic = getStage(s.stage).trafficPerCar;

  for (const car of s.cars) {
    if (car.status !== 'listed') continue;
    // One shopper at a time per car keeps the decision surface small.
    if (s.prospects.some((p) => p.carId === car.id)) continue;

    // Shopped against cash retail, which is what the sticker is now denominated
    // in. Judging the ask against the finance window instead made a car priced
    // at what it is worth look like a 30% discount to the traffic model.
    const reference = retailValue(car);
    // Store traffic multiplies the same way a promotion does, and for the same
    // reason: `prospectRate` stays a pure function of price and advertising, and
    // neither term can rescue an overpriced car, because the rate is already
    // zero above `maxViablePriceRatio` and any multiple of nothing is nothing.
    const rate = prospectRate(car.askPrice, reference, advertising) * promotion * storeTraffic;
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
      bookRevenue(s, 'paper', result.amount);
      s.stats.totalCollected += result.amount;
      bookProfit(s, 'paper', result.amount);
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
      repossess(s, note.carId, note.customerName, note, note.carLabel);
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
function repossess(s: GameState, carId: string, customer: string, note: Note, label: string): void {
  const car = s.cars.find((c) => c.id === carId);
  // Priced off the car where there is one to price — see `repoFee`. A contract
  // whose car has already left the books still costs something to chase.
  const fee = repoFeeFor(s, car);
  s.cash -= fee;
  bookProfit(s, 'paper', -fee);
  s.stats.reposCompleted += 1;

  // The cover goes with the customer. They are not driving it any more and the
  // house has no reason to go on paying to repair a car sitting on its own lot
  // for somebody who stopped paying for it two months ago. It also means the
  // worst borrowers are the cheapest to cover, which is a genuinely nice thing
  // to find on the ledger.
  for (const voided of voidPlansForCar(s.serviceContracts, carId)) {
    logEvent(s, {
      t: s.t,
      kind: 'plan-claim',
      label: `Cover on ${voided.carLabel} torn up with the repo — kept ${
        '$' + Math.max(0, voided.price - voided.paidOut).toLocaleString()
      }`,
    });
  }

  if (!car) {
    logEvent(s, { t: s.t, kind: 'repo', label: `Repo: ${label} (${customer})`, amount: -fee });
    return;
  }

  // The car was marked sold at delivery; this brings it back to inventory,
  // damaged by however hard it had to be taken.
  applyRepoDamage(car, repoConditionLossFor(s));

  // The two halves of the round trip, recorded where the report can find them.
  // `repoCarryingValue` nets them off into one basis below — correctly, because
  // a basis is one number — and in doing so destroys the only interesting thing
  // about a car that has been round twice: that it cost this much and gave back
  // that much. Both accumulate, because a car can go round more than once.
  car.recoveryCost += fee;
  car.returned += (note.downPayment ?? 0) + (note.collected ?? 0);

  // AND IT COMES BACK ON THE BOOKS AT WHAT IS LEFT IN IT, not at what it
  // originally cost. See `repoCarryingValue`: the customer's down payment and
  // every weekly payment they made have already come back, and the recovery fee
  // has just gone out. Carrying the original basis made a car that had paid for
  // itself twice still read as a thin deal on the sheet.
  //
  // The write-back on the same line is what keeps the books straight rather than
  // merely less wrong. `acceptFinance` expensed the WHOLE basis against
  // lifetimeProfit at signing, so an asset returning to inventory has to reverse
  // that expense to the extent of what it is worth — otherwise the resale
  // charges the basis a second time. Measured before this: 25 repossessions over
  // three game hours understated profit by $200,678.
  const carrying = repoCarryingValue(car.costBasis, fee, note);
  car.costBasis = carrying;
  // Against METAL, not paper. The write-back reverses the expense `acceptFinance`
  // charged the car out at, and the asset it puts back on the lot is the sales
  // side's to resell. What the finance desk pays for a repossession is the
  // recovery fee above.
  bookProfit(s, 'metal', carrying);

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
    bookRevenue(s, 'metal', dumped);
    bookProfit(s, 'metal', dumped - car.costBasis);
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

// -------------------------------------------------- service contracts

/**
 * A week of cover, on every plan in force.
 *
 * The mirror image of `stepNotes`: same clock, same beat, money going the other
 * way. Most weeks nothing happens on most plans, which is the product working —
 * roughly a quarter of contracts run their whole term and never cost a penny,
 * and the ones that do cost are lumpy on purpose.
 *
 * Claims are charged IN FULL whatever the balance says, like every other bill.
 * A house that stopped honouring its own paper when the till ran low would be
 * the floored-expenses bug again in a different costume.
 */
function stepServicePlans(s: GameState): void {
  if (s.serviceContracts.length === 0) return;

  const claims = stepDuePlans(s.serviceContracts, s.t, s.rng, claimCostMultiplier(s));
  if (claims.length === 0) return;

  for (const claim of claims) {
    if (claim.cost <= 0) continue;
    s.cash -= claim.cost;
    bookProfit(s, 'plans', -claim.cost);
    s.stats.planPayouts += claim.cost;
    logEvent(s, {
      t: s.t,
      kind: 'plan-claim',
      label: `Claim on ${claim.contract.carLabel} — ${claim.contract.customerName}`,
      amount: -claim.cost,
    });
  }

  s.serviceContracts = pruneClosedPlans(s.serviceContracts);
}

// -------------------------------------------------- service department

/**
 * One second of the bays.
 *
 * The money lands here silently, per job, and the ledger line for it is written
 * once a week by `stepBills`. That is a deliberate exception to "a balance that
 * moves with no line in the ledger is a bug waiting to be misdiagnosed": a busy
 * Valmont shop turns over a hundred and thirty repair orders a game week, which
 * against a sixty-entry ring buffer would mean the ledger showed nothing else
 * ever again. One honest weekly total says the same thing and leaves the log
 * readable.
 */
function stepServiceDept(s: GameState): void {
  const stage = getStage(s.stage);
  if (!stage.shop || bayCount(s) === 0) return;

  const rate = shopRate(stage, shopRateLevel(s));
  const result = stepShop(s, rate);

  for (const { job } of result.billed) {
    s.cash += job.price;
    bookRevenue(s, 'shop', job.price);
    bookProfit(s, 'shop', job.price);
    s.stats.shopRevenue += job.price;
    s.stats.shopJobsDone += 1;
    s.shop.weekRevenue += job.price;
    s.shop.weekJobs += 1;
  }
  s.stats.shopReworks += result.reworked.length;
  s.stats.shopTurnedAway += result.turnedAway;
}

// ------------------------------------------------------------- automation

function stepAutomation(s: GameState): void {
  // Nothing unattended spends below the working capital floor — the player's
  // floor, and ONLY the player's floor. There used to be two hidden terms
  // underneath it (weeks of expenses, the price of two cars) added when bills
  // floored at zero and a business at $0 froze silently forever. Bills charge
  // in full now, so the failure mode is a visible negative balance instead of
  // a silent freeze — and a safety rail the player cannot see is exactly what
  // made "why isn't my buyer buying" unanswerable from inside the game. The
  // Business panel quotes the weekly bill right above the floor selector; what
  // to keep back is the player's call, informed and theirs to get wrong.
  const reserve = minWorkingCapital(s);

  if (level(s, 'autoRecon') > 0) {
    const mods = reconModsFor(s);
    for (const car of s.cars) {
      if (!canRecon(car, mods)) continue;
      const cost = reconCost(car, mods);
      // `s.cash` falls as jobs are booked, so the reserve holds across the loop.
      if (cost > s.cash - reserve) continue;
      s.cash -= cost;
      chargeRecon(car, cost);
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
      // Judged on what the car costs to get here, not on the sticker. A buyer
      // that compares the ask against its margin rule and then pays the ask plus
      // freight is the same class of bug as one that gates on wholesale at a
      // store pricing in retail — it quietly buys at a loss it can't see.
      const landed = landedCost(listing);
      if (landed > acquisitionCeiling(s, listing)) continue;
      if (s.cash - landed < reserve) continue;
      buyListingInternal(s, listing.id);
    }
  }

  if (level(s, 'salesDesk') > 0 && s.dealPolicy !== 'manual' && s.prospects.length > 0) {
    const rules = dealRules(s);
    for (const prospect of [...s.prospects]) {
      // The player's window. Staff leave a walk-up alone until it has aged the
      // grace period — that is the standing chance to close the deal yourself
      // and keep their cut — and they never touch a deal the player has open
      // in front of them, however stale it gets. Offline, nobody grabs
      // anything, so every sale is a staff sale and the cut applies to the
      // whole night. That asymmetry IS the offline brake, and it needs no
      // knowledge of whether anyone is watching.
      if (prospect.claimed) continue;
      if (s.t - prospect.arrivedAt < BALANCE.desk.graceMs) continue;
      const choice = chooseDeal(s, prospect.id, rules);
      if (choice === 'finance') {
        // A push they balk at is not a reason to lose the customer — they are
        // still standing there and the cash offer is untouched. Same spirit as
        // the old rule that fell back to cash when the underwriting floor
        // refused the paper: the desk tries the deal it wanted, then the deal
        // it can get. A buyer who WALKED is gone and `stepProspects` will sweep
        // them, so the fallback simply finds nobody.
        if (!acceptFinance(s, prospect.id, 'desk', rules.paymentPush)) {
          runDeskNegotiation(s, prospect.id, rules.offerFloor);
        }
      } else if (choice === 'cash') {
        runDeskNegotiation(s, prospect.id, rules.offerFloor);
      }
    }
  }
}

/**
 * WHAT THE DESK WILL AND WILL NOT SIGN, in margin points.
 *
 * The player's two house rules, resolved against the store they are standing
 * in. `-Infinity` is the "any deal" stop and is the default on both, which is
 * what makes this whole feature inert until somebody moves a slider.
 *
 * Two table lookups. It used to derive the store's whole margin distribution
 * here — walking the model list on every tick of a 350-hour catch-up, with an
 * early-out for the common case where both rules were off to keep it
 * affordable. The floors being tabulated per store retires that cost along with
 * the drift it was paying for.
 *
 * Paper reads its own ladder, for the reason `financeGrossMultiple` gives: a
 * contract grosses the window price and then collects only part of it, so the
 * same LEVEL is a different margin on the two sides of the desk.
 */
interface DealRules {
  /** Least the desk will take on cash, as a share of the ask. */
  offerFloor: number;
  /** How far past their own payment it pushes a financed buyer. */
  paymentPush: number;
}

function dealRules(s: GameState): DealRules {
  return { offerFloor: offerFloorHere(s), paymentPush: paymentPushHere(s) };
}

/**
 * How good an offer is, as a share of the ask.
 *
 * The unit both sales rules and the lot's red/amber/green now share. An ask of
 * zero reads as a total lowball rather than dividing by zero.
 */
function offerShare(offer: number, ask: number): number {
  return ask > 0 ? offer / ask : 0;
}

/**
 * The sales desk's standing play: counter exactly once, then take whatever comes
 * back. It resolves the whole haggle inside a single step because the desk has
 * no reason to deliberate — which also keeps offline catch-up cheap.
 *
 * It uses the same pure functions the player's taps go through, so an automated
 * lot and a hand-played one are running identical rules.
 *
 * `floor` is the house minimum, and it is checked at the moment of signing
 * rather than up front, because the counter is the desk's one chance to lift a
 * thin deal over the line. A deal that still falls short is simply not closed:
 * the buyer stands there, the offer does not improve, and they leave when their
 * patience runs out. That is what "the manager ignored them" looks like from
 * the tarmac, and it is deliberately not a walk-away — nobody stormed off, the
 * business just would not take the money.
 */
function runDeskNegotiation(s: GameState, prospectId: string, floor: number): void {
  const prospect = s.prospects.find((p) => p.id === prospectId);
  if (!prospect) return;

  const car = s.cars.find((c) => c.id === prospect.carId);
  if (!car) return;
  // Judged against the ASK, not against what the car cost. The desk's job is to
  // hold out for the sticker, and whether the sticker is above cost is the
  // pricing desk's business — see `defaultAsk`. A lot priced under cost will be
  // sold under cost, deliberately.
  const clears = (price: number) => offerShare(price, prospect.negotiation.anchor) >= floor;

  const neg = prospect.negotiation;

  // Already at the asking price, or the desk has had its turn: close it if the
  // house rules allow, and otherwise leave it alone.
  if (neg.countersMade > 0 || neg.currentOffer >= neg.anchor) {
    if (clears(neg.currentOffer)) acceptCash(s, prospectId, 'desk');
    return;
  }

  const haggle = haggleSkillFor(s);
  const counter = deskCounter(neg, haggle);
  if (counter <= neg.currentOffer) {
    if (clears(neg.currentOffer)) acceptCash(s, prospectId, 'desk');
    return;
  }

  const outcome = resolveCounter(s.rng, neg, counter, haggle);
  if (outcome.kind === 'walked') {
    registerWalkaway(s, prospect.name);
    return; // stepProspects sweeps them out.
  }

  // Accepted, or they came back with a better number — either way, take it if
  // it clears.
  if (clears(prospect.negotiation.currentOffer)) acceptCash(s, prospectId, 'desk');
}

/**
 * Which side of the deal the standing policy takes — and whether there is a
 * deal here at all.
 *
 * The house floors are applied to the BEST each side could realistically do:
 * the asking price for cash (nobody pays over it, and the desk's counter climbs
 * towards it), and the expected value of the contract for paper. Judging cash
 * on the opening lowball instead would have the desk refuse to even counter on
 * deals it could have talked up over the line, and judging paper on the sticker
 * would make the finance floor a second cash floor rather than the underwriting
 * rule it is.
 */
function chooseDeal(
  s: GameState,
  prospectId: string,
  rules: DealRules,
): 'cash' | 'finance' | 'none' {
  const prospect = s.prospects.find((p) => p.id === prospectId);
  if (!prospect) return 'none';
  const car = s.cars.find((c) => c.id === prospect.carId);
  if (!car) return 'none';

  // The best cash could ever do is the asking price itself, so a floor at or
  // under 100% of the ask is always worth trying for. Only "sticker or near it"
  // can refuse outright, and only when the buyer will not get there.
  const cashOk = rules.offerFloor <= 1;

  if (!getStage(s.stage).financing) return cashOk ? 'cash' : 'none';
  // A full book is not a reason to send a buyer away — it is a reason to sell
  // them the car instead of the payment. Without this the desk would keep
  // choosing paper it cannot write and then close nothing at all.
  if (!canWriteNote(s)) return cashOk ? 'cash' : 'none';

  const capFactor = overCapacityFactor(activeNotes(s.notes).length, collectionsCapacity(s));
  // Valued at the payment the desk will actually ask for, not at the one the
  // customer offered — pushing is the whole point of the rule, and a policy that
  // compared cash against an un-pushed contract would under-sell paper at every
  // setting above "take their number".
  const ev = expectedFinanceValue(s, prospect.id, capFactor, rules.paymentPush);

  switch (s.dealPolicy) {
    case 'cash':
      return cashOk ? 'cash' : 'none';
    case 'finance':
      return 'finance';
    case 'auto': {
      if (ev > prospect.negotiation.currentOffer) return 'finance';
      return cashOk ? 'cash' : 'none';
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
 *  - **Open market: margin against RETAIL, because retail is where the cars
 *    go.** This branch gated on wholesale for a long time, and that was the
 *    same bug as the franchise one in a milder key. The used stages price the
 *    feed at 0.84-1.38x wholesale ON PURPOSE — the band straddling retail
 *    break-even is the whole judgement game — so a buyer that refuses to pay
 *    over wholesale rejects ~90% of a feed the store's own economy calls
 *    profitable. The player found it with a screenshot: eight listings, every
 *    one showing a green margin, none bought. The buyer now asks the question
 *    the sticker asks — "does the worst case still clear the price by the
 *    margin the house rules demand?" — with `stance` deciding whether "worst
 *    case" means the bottom of the band (anything spending money unattended)
 *    or the estimate (the harness bot, because that is what a person does).
 *  - **Franchise.** There is no wholesale market for an allocation and nothing to
 *    appraise; sigma is zero, so both stances agree and the same formula answers
 *    it. Invoice is the price and every unit is saleable, so the only question
 *    is still whether the sticker leaves the margin you asked for.
 *
 * THE BASIS IS CASH RETAIL AT EVERY STAGE, and the franchise branch used to have
 * its own line reading `windowPrice` — retail x the store's subprime markup —
 * which let the buyer pay up to 22% ABOVE what the car sells for. It never bit
 * while an invoice asked ~0.9x retail and there was nothing else to add, so it
 * sat there as a latent version of the exact bug this function has now paid for
 * three times: judging a purchase against a number the car is not sold at. It
 * bit the moment freight went on top, because landed cost could clear retail
 * while still passing a ceiling set 22% over it — the retainer buyer filled a
 * franchise lot with two points of margin and the business lost $145M with a
 * full lot the whole way down. One basis now, and freight is inside the
 * comparison rather than outside it.
 */
export function acquisitionCeiling(
  s: GameState,
  listing: Listing,
  stance: AppraisalStance = 'worstCase',
): number {
  const keepBack = 1 - minBuyMargin(s);
  const sigma = appraisalSigma(s);
  // THE BASIS IS WHAT THIS CAR WILL LIST FOR, as best the buyer can tell from
  // the feed. Not retail — retail stopped being the sticker the moment pricing
  // became a markup the player sets, and a buyer still judging against retail
  // would cheerfully pay $7,254 for a car the desk then lists at $5,905. That is
  // the same bug this function has now paid for three times, arriving through a
  // new door: judge a purchase against the number the car SELLS at.
  //
  // At the default markup this is `pessimisticRetail` to the dollar — the two
  // are algebraically identical, because book x (1 + retailMarkup()) IS retail —
  // so the buyer that shipped yesterday is the buyer that ships today until
  // somebody moves the pricing slider.
  //
  // The uncertainty is preserved and is the point: the buyer estimates what the
  // car will list for, the pricing desk finds out. The gap between them is the
  // surprise of buying, and it is now denominated in the price the car actually
  // wears rather than in a valuation nobody quotes.
  const book =
    stance === 'worstCase' ? pessimisticBook(listing, sigma) : estimatedBook(listing, sigma);
  return book * (1 + listMarkup(s)) * keepBack;
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
  car.askPrice = Math.round(askPrice ?? defaultAsk(s, car));
  car.status = 'listed';
  car.listedAt = s.t;
}

/**
 * WHAT THE PRICING DESK ASKS FOR A CAR IT NOW KNOWS EVERYTHING ABOUT.
 *
 * Book value plus the house markup, and the two halves of that sentence are the
 * whole design. The BUYER works on an appraisal and is regularly wrong; by the
 * time a car is standing on the lot there is nothing left to guess — the
 * condition is known, the recon is done, the trim is on it — so pricing is done
 * on the full picture rather than on what anybody hoped they were buying. A car
 * that cleaned up better than it looked simply lists for more, and one that did
 * not lists for less, which is where the surprise of buying finally shows up in
 * dollars.
 *
 * The default markup is `1/wholesaleOfRetail - 1`, so out of the box this is
 * cash retail to the dollar and nothing about pricing, traffic or the buyer's
 * ceiling moves. `bookValue` is unrounded for exactly that reason.
 *
 * Note what this is NOT gated on: cost. Price the lot under what it owes and the
 * lot lists under what it owes — that is a real way to clear stock, and the only
 * thing standing between a player and it is the number they chose.
 */
export function defaultAsk(s: Pick<GameState, 'business'>, car: Car): number {
  return bookValue(car) * (1 + listMarkup(s));
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

/**
 * Money in, for the week's books.
 *
 * ONE SEAM, called wherever cash arrives from a customer. It is deliberately
 * separate from `s.cash += ...` rather than folded into it: the shark's money
 * and the admin console's are not revenue, and a helper that could not tell the
 * difference would report a business as having a spectacular week every time it
 * borrowed. Everything that goes through here is somebody paying for something.
 */
export function bookRevenue(s: GameState, line: BookLine, amount: number): void {
  if (amount <= 0) return;
  s.weekRevenue += amount;
  s.weekLines[line].revenue += amount;
}

/**
 * Money kept — or lost — for the week's books, against the line that earned it.
 *
 * THE ONLY WAY `lifetimeProfit` MOVES, and that is what makes the departmental
 * split trustworthy rather than decorative. The week's headline profit is a
 * subtraction off `lifetimeProfit` (see `closeTheWeek`) and the five lines are
 * running totals; the only thing that stops those two disagreeing is that there
 * is no other door. A `s.stats.lifetimeProfit += x` written anywhere else would
 * leave the tiles quietly short by exactly that much, on a screen whose entire
 * job is saying which part of the business the money came from.
 *
 * `books.test.ts` measures the sum against the subtraction, which is the only
 * way that failure could ever show up.
 */
export function bookProfit(s: GameState, line: BookLine, amount: number): void {
  s.stats.lifetimeProfit += amount;
  s.weekLines[line].profit += amount;
}

/** A week's five lines, all at zero. */
export function emptyWeekLines(): WeekLines {
  return {
    metal: { revenue: 0, profit: 0 },
    paper: { revenue: 0, profit: 0 },
    plans: { revenue: 0, profit: 0 },
    shop: { revenue: 0, profit: 0 },
    overhead: { revenue: 0, profit: 0 },
  };
}

/**
 * Round a week's lines to whole dollars, so the five of them add to the
 * headline exactly.
 *
 * The lines accrue in cents — a note payment is a level payment on a
 * simple-interest contract and lands at two decimal places — while the week's
 * revenue and profit are filed as whole dollars. Round the two sides
 * independently and they can land either side of a half-dollar and differ by
 * one, which on a screen that says "together they come to X, which is exactly
 * what the week made" is a visible lie about arithmetic.
 *
 * THE RESIDUAL IS ONLY EVER ABSORBED WHEN IT IS ROUNDING. Five roundings cannot
 * be more than $2.50 out; anything larger is not rounding, it is profit that
 * moved without going through `bookProfit`, and quietly folding that into the
 * biggest tile would hide exactly the bug the reconciliation test exists to
 * catch. Past the threshold it is left alone and the test says so.
 */
function fileWeekLines(lines: WeekLines, profit: number, revenue: number): WeekLines {
  const out = emptyWeekLines();
  const ids = Object.keys(out) as BookLine[];
  for (const id of ids) {
    out[id].profit = Math.round(lines[id].profit);
    out[id].revenue = Math.round(lines[id].revenue);
  }

  // On the biggest line, where a dollar is proportionally invisible — and never
  // on a line that did nothing, which would conjure a department out of a
  // rounding error.
  const settle = (key: 'profit' | 'revenue', target: number) => {
    const residual = target - ids.reduce((n, id) => n + out[id][key], 0);
    if (residual === 0 || Math.abs(residual) > 3) return;
    let biggest: BookLine | null = null;
    for (const id of ids) {
      if (out[id][key] === 0) continue;
      if (!biggest || Math.abs(out[id][key]) > Math.abs(out[biggest][key])) biggest = id;
    }
    if (biggest) out[biggest][key] += residual;
  };
  settle('profit', profit);
  settle('revenue', revenue);

  return out;
}

export function cloneWeekLines(lines: WeekLines): WeekLines {
  return {
    metal: { ...lines.metal },
    paper: { ...lines.paper },
    plans: { ...lines.plans },
    shop: { ...lines.shop },
    overhead: { ...lines.overhead },
  };
}

/**
 * Close the week out and file it.
 *
 * Called at the END of `stepBills`, so the week that just ended carries its own
 * rent, wages and floorplan rather than handing them to the next one. Profit is
 * the change in `lifetimeProfit` rather than a second running total, which is
 * what stops the two ever disagreeing.
 */
function closeTheWeek(s: GameState): void {
  const revenue = Math.round(s.weekRevenue);
  const profit = Math.round(s.stats.lifetimeProfit - s.weekProfitAt);
  s.weeks.push({
    endedAt: s.t,
    revenue,
    profit,
    // Rounded to add up to those two exactly — see `fileWeekLines`. The headline
    // stays the subtraction off `lifetimeProfit` it has always been; what gets
    // adjusted is the split, by at most the cents it was carrying.
    lines: fileWeekLines(s.weekLines, profit, revenue),
  });
  if (s.weeks.length > BALANCE.weekHistory) {
    s.weeks.splice(0, s.weeks.length - BALANCE.weekHistory);
  }
  s.weekRevenue = 0;
  s.weekLines = emptyWeekLines();
  s.weekProfitAt = s.stats.lifetimeProfit;
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
    // The tick writes to both of these every week, so a shared array or a shared
    // entry would leak backwards through history and corrupt offline catch-up —
    // the same failure `prospects` and `promotions` are spelled out for. The
    // shop needs its two arrays copied as well as the block itself. The `??`
    // covers a fixture written before either existed.
    serviceContracts: (s.serviceContracts ?? []).map((c) => ({ ...c })),
    shop: {
      ...(s.shop ?? { weekRevenue: 0, weekJobs: 0 }),
      techs: (s.shop?.techs ?? []).map((t) => ({ ...t })),
      jobs: (s.shop?.jobs ?? []).map((j) => ({ ...j })),
    },
    upgrades: { ...s.upgrades },
    // Each skill is a nested object, so the record needs cloning entry by entry
    // for the same reason prospects do.
    skills: cloneSkills(s.skills),
    // Nested and mutable: a shared policy object would let a rule change made
    // now rewrite the rules a historical state was running under.
    business: { ...s.business },
    // The tick expires these and `startPromotion` extends one in place, so a
    // shared array or a shared entry would leak backwards through history. The
    // `??` covers a fixture written before promotions existed.
    promotions: (s.promotions ?? []).map((p) => ({ ...p })),
    // The history is an array of records and the loan is written by the tick,
    // so both need real copies or mutations leak backwards through history.
    prestige: { ...s.prestige, history: s.prestige.history.map((r) => ({ ...r })) },
    loan: s.loan ? { ...s.loan } : null,
    tuning: { ...s.tuning },
    stats: { ...s.stats },
    // Written by the tick every game week, so a shared array would leak
    // backwards through history exactly as a shared prospect would — and each
    // filed week now carries a nested block of five lines, which needs the same
    // treatment for the same reason. `weekLines` is the live one, written on
    // every sale, and is the one that would actually bite.
    weeks: (s.weeks ?? []).map((w) => ({
      ...w,
      lines: w.lines ? cloneWeekLines(w.lines) : null,
    })),
    weekLines: cloneWeekLines(s.weekLines ?? emptyWeekLines()),
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
  // The truck is part of the price. Everything downstream — floorplan, profit,
  // the forced-sale haircut, the buyer's own ceiling — reads `costBasis`, so
  // putting freight here is what makes distance cost real money exactly once.
  const landed = landedCost(listing);
  if (s.cash < landed) return false;
  if (s.cars.filter((c) => c.status !== 'sold').length >= carCapacity(s)) return false;

  s.cash -= landed;
  // The basis is what the deal cost, all in. The two figures beside it are the
  // deal itself, split the way the player made it — a seller's price and a
  // transporter's bill — because once they are added together nothing can pull
  // them apart again, and "what did the truck cost me" is the whole question
  // the reach upgrade asks. See the note on `purchasePrice` in types.ts.
  const car = {
    ...listing.car,
    costBasis: landed,
    purchasePrice: listing.price,
    freightPaid: listing.freight,
    acquiredAt: s.t,
  };
  s.cars.push(car);

  // You own it now, so you can put it on a lift. This is where the appraisal
  // gets marked, and where the skill teaches itself — the number was a guess
  // and now it is not.
  reportAppraisal(s, listing, car);

  s.listings.splice(idx, 1);
  awardXp(s, 'buy', buyXp(landed));
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

/**
 * Who closed the deal. The player's tap keeps every dollar; the staff's close
 * pays the stage's commission. This is the whole attended-play incentive and
 * the whole offline brake in one parameter — offline, there is nobody to tap,
 * so every deal is a 'desk' deal and the cut applies to the entire absence.
 */
type DealCloser = 'player' | 'desk';

/**
 * The staff's cut of a deal they closed: the stage's commission rate on the
 * PROFIT at signing, never on the price — curbstone margin is about a quarter
 * of the sale price, so a cut of price would be four times sharper than it
 * reads. Floored at zero (nobody pays the staff for selling at a loss, and the
 * staff do not eat the loss either) and capped at the cash the deal actually
 * put in the till, so a commission can never be the thing that takes the
 * business below where it stood — only the shark gets to do that.
 */
function commissionOn(s: GameState, profitAtSigning: number, cashReceived: number): number {
  const cut = Math.round(getStage(s.stage).desk.commission * Math.max(0, profitAtSigning));
  return Math.min(cut, Math.max(0, cashReceived));
}

function payCommission(s: GameState, cut: number, dealLabel: string): void {
  if (cut <= 0) return;
  s.cash -= cut;
  bookProfit(s, 'metal', -cut);
  s.stats.commissionPaid += cut;
  logEvent(s, {
    t: s.t,
    kind: 'expense',
    label: `${getStage(s.stage).desk.title}'s cut on ${dealLabel}`,
    amount: -cut,
  });
}

function acceptCash(s: GameState, prospectId: string, closer: DealCloser = 'player'): boolean {
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
  bookRevenue(s, 'metal', price);
  s.stats.carsSold += 1;
  s.stats.cashDeals += 1;
  bookProfit(s, 'metal', profit);

  if (prospect.negotiation.countersMade > 0) s.stats.negotiationsWon += 1;
  awardXp(s, 'sell', sellXp(price, prospect.negotiation.countersMade));

  logEvent(s, {
    t: s.t,
    kind: 'sale-cash',
    label:
      closer === 'desk'
        ? `${getStage(s.stage).desk.title} sold ${carLabel(car)}`
        : `Cash sale: ${carLabel(car)}`,
    amount: price,
  });
  if (closer === 'desk') {
    payCommission(s, commissionOn(s, profit, price), carLabel(car));
  }

  sellServicePlan(s, prospect, car);

  removeCar(s, car.id);
  s.prospects.splice(idx, 1);
  return true;
}

/**
 * Write the paper, at a payment the house has chosen.
 *
 * `push` is a multiple of the payment this buyer walked in able to make. At 1
 * they sign on their own terms and nothing can go wrong, which is what financing
 * did before it was a negotiation. Above it the contract collects more and they
 * may balk — no deal on paper, cash still on the table — or walk out entirely.
 *
 * The pushed contract is a bigger one, not a shorter one: the same term at a
 * higher weekly payment is simply more car sold to the same customer, so the
 * amount financed and everything downstream of it scale together. That is what
 * makes "for them it is the payment, for us it is total collected" arithmetically
 * true rather than just a slogan.
 */
function acceptFinance(
  s: GameState,
  prospectId: string,
  closer: DealCloser = 'player',
  push = 1,
): boolean {
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

  const asked = pushedTerms(prospect, push);
  if (asked.payment > prospect.financeTerms.weeklyPayment) {
    const outcome = resolvePaymentPush(
      s.rng,
      asked.payment,
      prospect.financeTerms.weeklyPayment,
      prospect.paymentCeiling,
      haggleSkillFor(s),
    );
    if (outcome === 'walked') {
      registerWalkaway(s, prospect.name);
      prospect.negotiation.status = 'walked';
      return false;
    }
    // Balked: priced out of the paper, but still standing on the lot. The cash
    // side is untouched and the desk gets to try it on the next tick.
    if (outcome !== 'signed') return false;
  }

  const label = carLabel(car);
  const note = openNote(s, { ...prospect, financeTerms: asked.terms }, label, s.t);
  s.notes.push(note);

  s.cash += prospect.downPayment;
  bookRevenue(s, 'metal', prospect.downPayment);
  s.stats.carsSold += 1;
  s.stats.financeDeals += 1;
  bookProfit(s, 'metal', prospect.downPayment - car.costBasis);

  logEvent(s, {
    t: s.t,
    kind: 'sale-finance',
    label:
      closer === 'desk'
        ? `${getStage(s.stage).desk.title} financed ${label} to ${prospect.name} (${prospect.tier})`
        : `Financed: ${label} to ${prospect.name} (${prospect.tier})`,
    amount: prospect.downPayment,
  });
  if (closer === 'desk') {
    // Profit at signing is the whole contract's edge — down payment plus paper
    // minus the metal — because that is the deal the staff actually closed. The
    // cap in commissionOn keeps the cut inside the down payment, the only cash
    // this deal has produced so far.
    const profitAtSigning = prospect.downPayment + asked.terms.amountFinanced - car.costBasis;
    payCommission(s, commissionOn(s, profitAtSigning, prospect.downPayment), label);
  }

  sellServicePlan(s, prospect, car);

  // The car leaves the lot but stays in state so a repo can bring it back.
  car.status = 'sold';
  car.askPrice = 0;
  car.listedAt = null;
  s.prospects.splice(idx, 1);
  return true;
}

/**
 * Offer this buyer a service contract, and book it if they take it.
 *
 * Called from both `acceptCash` and `acceptFinance` — the two functions every
 * sale goes through — so cover is as likely to be sold at four in the morning by
 * the sales manager as by the player at the sheet.
 *
 * THE COMMISSION DOES NOT SEE THIS MONEY, deliberately. The desk's cut is a
 * share of the profit on the CAR at signing, and a plan's profit is not made at
 * signing: it is made over eight months of not being claimed on, and it can turn
 * out to be a loss. Paying a percentage of it on the day would be paying a
 * commission on a liability.
 */
function sellServicePlan(s: GameState, prospect: Prospect, car: Car): void {
  const contract = maybeSellPlan(s, prospect, car, carLabel(car), servicePlanBand(s));
  if (!contract) return;

  s.cash += contract.price;
  bookRevenue(s, 'plans', contract.price);
  bookProfit(s, 'plans', contract.price);
  s.stats.planIncome += contract.price;
  s.stats.plansSold += 1;
  logEvent(s, {
    t: s.t,
    kind: 'plan-sold',
    label: `${contract.customerName} took the ${contract.weeksTotal}-week cover on ${contract.carLabel}`,
    amount: contract.price,
  });
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
function expectedFinanceValue(
  s: GameState,
  prospectId: string,
  capacityFactor: number,
  push = 1,
): number {
  const prospect = s.prospects.find((p) => p.id === prospectId);
  if (!prospect) return 0;
  const asked = pushedTerms(prospect, push);
  return (
    prospect.downPayment +
    expectedCollections(
      asked.terms.weeks,
      asked.payment,
      BALANCE.creditTiers[prospect.tier].missChance * capacityFactor,
      repoThreshold(s),
    ).expectedCollected
  );
}

/**
 * The contract as the house would like to write it.
 *
 * One multiply, applied to the payment and to the principal behind it, so the
 * APR and the term stay the customer's and only the size of the deal moves.
 * Exported through actions.ts so the deal sheet quotes the exact contract the
 * button will write — a slider whose readout and outcome are computed
 * separately is a slider that will eventually lie.
 */
export function pushedTerms(
  prospect: Prospect,
  push: number,
): { payment: number; terms: Prospect['financeTerms'] } {
  const factor = Math.max(1, push);
  const payment = Math.round(prospect.financeTerms.weeklyPayment * factor * 100) / 100;
  return {
    payment,
    terms: {
      ...prospect.financeTerms,
      weeklyPayment: payment,
      amountFinanced: Math.round(prospect.financeTerms.amountFinanced * factor),
    },
  };
}

/**
 * Re-exported from notes.ts, where the note lifecycle lives.
 *
 * It sat here for as long as the engine was its only caller. `margins.ts`
 * needs it to price the average contract a store writes, and the engine
 * imports margins — so leaving it here would have closed a cycle to save a
 * line. Every existing caller still reaches it through this module.
 */
export { expectedCollections };

export { step as __stepForTests };
export type { Millis };
