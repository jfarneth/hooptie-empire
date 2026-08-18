import { BALANCE } from './balance';
import { TIER_PROFILE } from './cars';
import { conditionFactor, mileageFactor } from './economy';
import { modelsForMake, modelsForTiers } from './models';
import type { CarTier, StageId } from './types';

/**
 * The six dealerships, and what changes when you move between them.
 *
 * The arc is one business getting bigger, not six businesses. Two things move
 * every time you step up, and they are the whole tension of the progression:
 *
 *  - **Cars get more expensive.** Better inventory, bigger margins in absolute
 *    dollars, and a much bigger cheque to write before you own any of it.
 *  - **Your staff does not come with you.** Every employee resets to nothing and
 *    costs more to hire at the new store, because you are hiring into a bigger
 *    operation. Property carries; people do not. That is what makes moving up a
 *    decision rather than a button — see `advanceStage` in actions.ts, and the
 *    warning the UI puts in front of it.
 *
 * Skills deliberately do NOT reset. CLAUDE.md has called skill levels the
 * natural carry-over currency since before this existed: what the work taught
 * you is the one thing a new store cannot take away.
 *
 * The other axis is where inventory comes from. The three used stages buy on the
 * open market, where condition is a judgement call and the ask swings +/-20%.
 * The three franchise stages buy from a manufacturer, which changes the game's
 * character on purpose: one make, standardised invoice pricing, and no
 * ambiguity about what you are buying, because nobody appraises a new car. The
 * question stops being "is this a good car" and becomes "can you move volume and
 * write paper", which is the real difference between an independent lot and a
 * franchise store.
 *
 * NOTE ON NUMBERS: entry costs and staff multipliers live here rather than in
 * balance.ts, following the precedent upgrades.ts already sets for a definition
 * table that carries its own costs. balance.ts points here.
 */

export interface StageSourcing {
  /** Open-market stages: what turns up on the feed. Mutually exclusive with `makeId`. */
  tiers?: readonly CarTier[];
  /** Franchise stages: the one make you are contracted to sell. */
  makeId?: string;
  /**
   * Seller ask as a share of wholesale.
   *
   * On the used stages this is the wide, load-bearing band from balance.ts —
   * width is what stops a sharp player back-solving condition from price.
   * Franchise invoice pricing is nearly flat by comparison and sits *above*
   * wholesale, near retail: a new car is bought at invoice and sold at sticker,
   * so per-unit margin is thin. That is not a nerf, it is the business. A
   * franchise store makes its money on volume and on the finance desk, which is
   * exactly where this game already says the money is.
   */
  /**
   * Seller ask, as a share of the car's true wholesale value. THE SHARPEST KNOB
   * IN THE GAME, and now the thing that gives each rung its character.
   *
   * Margin as a share of retail is `1 - wholesaleOfRetail x ask`, so break-even
   * sits at an ask of about 1.35 and anything above it is a car bought for more
   * than it can be sold for. The ladder is deliberately shaped along that line:
   *
   *   used stages       WIDE, straddling break-even. A curbstoner can clear 50%
   *                     on a car or lose money on it, and which one it turns out
   *                     to be is decided by whether they read the condition
   *                     right — the band only sets the stakes, the appraisal
   *                     decides the outcome. This is what makes Buying the skill
   *                     that matters early.
   *   franchise stages  NARROW and thin. Single digits to low teens, no
   *                     judgement involved (`appraisalSigmaMult: 0` means the
   *                     feed tells the truth), and the money comes from the cars
   *                     being worth six figures rather than from the percentage.
   *
   * The percentage falls as you climb and the dollars rise, which is how a real
   * dealership ladder works and is the reason the top of the game is a volume
   * business rather than a bargain-hunting one.
   */
  askMin: number;
  askMax: number;
  /** Condition of what arrives. Franchise cars are new. */
  conditionMin: number;
  conditionMax: number;
  /** Odometer at delivery. Franchise cars have transporter miles and nothing else. */
  mileageMin: number;
  mileageMax: number;
  /**
   * Multiplier on appraisal error. Zero on the franchise stages: you are reading
   * an invoice, not guessing at a stranger's Corolla, and the feed says so.
   */
  appraisalSigmaMult: number;
  /**
   * How much of a car's trim premium the seller prices into the ask, 0 to 1.
   *
   * At 0 the seller is blind to the grade and the whole premium is the dealer's
   * — which is the truth of a Tuesday auction, where nobody pays extra for a
   * spoiler and the book has no column for one. At 1 the trim is fully priced in
   * and rarity is worth exactly nothing but paint.
   *
   * The franchise stages sit high, and that is not a nerf bolted on to protect
   * the pacing: a manufacturer absolutely does charge for a trim package, and an
   * allocation is priced off an invoice that lists it. Measured, leaving them at
   * 0 pulled the premium franchise in by 31% (318h to 218h) and doubled lifetime
   * profit, which is a different game rather than a feature.
   */
  raritySellerCapture: number;
}

export interface StageDef {
  id: StageId;
  /** Full name, for the stage card. */
  name: string;
  /** Short form for the HUD, which has very little room. */
  shortName: string;
  /** What being here means. Shown on the card that sells the next step up. */
  blurb: string;
  /** Cash to move in. Zero for the stage everyone starts on. */
  entryCost: number;
  /** Cars you can hold here before upgrades. */
  baseCarCapacity: number;
  /** Which capacity upgrade adds space at this stage. */
  capacityUpgradeId: 'driveway' | 'lot';
  /**
   * Spaces each level of that upgrade adds AT THIS STORE. Per stage rather than
   * one global constant, because "small" is a claim the maxed-out number has to
   * back up: the small lot used to top out at 26 cars, which is not a small
   * lot, it is a mid-sized one wearing the wrong sign. It now tops out at 13.
   * The stages above keep their +4 rows — capacity was measured as a nearly
   * dead pacing lever up there (lot full 5% of turns), so this is theme, not
   * balance.
   */
  capacityPerLevel: number;
  /** Whether you can carry your own paper here. */
  financing: boolean;
  /**
   * Multiplier on what every employee costs to hire at this store. Staffing a
   * franchise service department is not staffing a guy with a socket set.
   */
  /**
   * What every upgrade costs at this store, as a multiple of its base price.
   *
   * Applies to ALL of them, not just the payroll. Moving stores now clears the
   * whole upgrade table — the office you built was that store's office — so
   * every line on it is bought again here, at this store's prices. That is the
   * single biggest thing standing between rungs, and it is why a bigger store is
   * a bigger commitment rather than just a bigger number.
   */
  upgradeCostMultiplier: number;
  /**
   * Rent, rates and the standing overheads of the premises, per game week.
   *
   * Charged whether or not a single car sells. This is what stops a franchise
   * being pure upside the moment its entry cost clears, and it is the reason
   * the working-capital floor in the business suite means anything.
   */
  rentPerWeek: number;
  /**
   * Walk-up traffic per LISTED CAR, as a multiple of the base arrival rate.
   *
   * DWELL TIME IS THE CHARACTER OF A STORE, and this is the knob that sets it.
   * Below 1 means a car here waits longer before anybody comes to look at it.
   *
   * It falls as you climb, which is the opposite of what the game did before it
   * existed. Traffic used to be a flat per-car rate, so a forty-car franchise
   * ran forty arrival processes in parallel and turned its stock over in three
   * and a half game days — one car in seven gone inside a single day. A driveway
   * with two cars on it turning them in a week is a curbstoner; a franchise lot
   * doing the same thing is a vending machine.
   *
   * THIS IS BOUGHT WITH THROUGHPUT AND PAID BACK WITH MARGIN, and the two halves
   * must move together. Inventory on the lot is the sale rate times the dwell
   * time — Little's law, and the lot is capacity-bound or cash-bound at all
   * times — so there is no way to make cars sit longer that does not sell fewer
   * of them. Holding more instead was measured and does not work: doubling
   * capacity at the first two stages took "broke, lot empty" from 18% of turns
   * to 40% and dwell went DOWN, because the constraint is the till and not the
   * tarmac. The franchise ask bands were widened in the same commit to pay for
   * this, and moving one without the other is how you get either a dead store or
   * an infinite one.
   *
   * Consumes no extra RNG draw, so setting every stage back to 1 reproduces the
   * pre-change build on an identical stream — which is how the numbers in
   * CLAUDE.md were measured.
   */
  trafficPerCar: number;
  /**
   * Markup the finance desk can put on the window price, as a multiple of cash
   * retail. It falls as you move upmarket: a buy-here-pay-here lot sells
   * approval and charges for it, a premium franchise sells a car to someone who
   * could have gone to a bank. Absolute dollars still rise, because the cars do.
   */
  bhphMultiplier: number;
  /**
   * Improvement to the walk-in credit mix, in equivalent `underwriting` levels.
   * Upmarket stores draw better credit before you screen anyone.
   */
  creditShift: number;
  /**
   * How much paper this store's collections desk can carry, as a multiple of
   * what the `collections` upgrade buys.
   *
   * THE ONLY PROFITABLE PRODUCT USED TO BE THE RATIONED ONE. The desk maxes at
   * 43 contracts and the table did not touch it, so a premium franchise carried
   * exactly as much paper as a small lot — while `chooseDeal` takes finance
   * whenever its expected value beats the cash offer, which up there is always.
   * Measured over 350h at 8 seeds, the shipped build wrote 13,725 contracts
   * against 323,534 cash deals: 96% of the business was the side the game calls
   * the tutorial, and it was cash by RATIONING rather than by choice. The books
   * said so in one line — metal turning $45.8M for −$264k while a book capped at
   * 43 notes kept $1.58M and carried the entire operation.
   *
   * A bigger store genuinely runs a bigger collections department, so the fix is
   * the same shape as every other thing that varies by rung. It is deliberately
   * NOT a new `collections` level: the upgrade ladder is what the player buys,
   * and this is what the premises are worth.
   *
   * Consumes no RNG draw, so setting every stage back to 1 reproduces the
   * previous build on an identical stream — the same A/B property
   * `trafficPerCar` and `market.supplyScale` carry.
   */
  collectionsCapacityMult: number;
  /**
   * How far below the ask this store's buyers open, as a multiplier on
   * `BALANCE.negotiation.maxOpeningDiscount`. THE HAGGLE'S ONE PER-STAGE TERM.
   *
   * It exists because listing margin thins 18.7% → 7.0% up the ladder while
   * the haggle used to take a flat ~6% off the ask at every rung, which left a
   * Valmont cash deal keeping 0.9% of retail — under water once floorplan and
   * the desk's cut land. A new-car buyer genuinely opens near the sticker
   * where a Tuesday auction buyer opens at a number meant to insult you, so
   * the term is per stage and falls as the store moves upmarket.
   *
   * 1 on the used stages — the fight IS the game down there and nothing about
   * it moved. Measured through the real desk play (open, one counter, take
   * what comes back), the franchise ladder lands per-deal cash keep at ~6.6% /
   * 4.6% / 3.1% against 5.4% / 2.8% / 1.0% at a flat 1. Walk rates barely
   * move above 0.6; push it toward 0.3 and counters stop losing buyers at
   * all, which retires the gamble countering is meant to be — that is the
   * floor to respect if this is ever retuned.
   *
   * Scales the depth of a draw the negotiation already makes, so it consumes
   * no RNG and 1 everywhere reproduces the previous build on an identical
   * stream.
   */
  haggleDepth: number;
  /**
   * What the land under this store costs, and the prestige it mints.
   *
   * THE PROPERTY IS THE ENDGAME SINK. Bought only while STANDING at the store
   * — which is what makes walking back down the ladder a real play for the
   * first time: the curbstone house is priced past anything a curbstone
   * bankroll can reach, so you climb, bank, and come back for it. The guard in
   * stages.test.ts states the design in one line: every property costs more
   * than the NEXT store's keys, so at every rung "own this land" is a bigger
   * decision than "move up".
   *
   * Owning ends the rent line for good, mints `propertyPoints` of prestige
   * (once ever per stage, across careers — see PrestigeState.propertyStages),
   * and is sold only by retirement. The top two are priced in careers rather
   * than in months deliberately; the deflation pass measured that time cannot
   * be bought with margins at realistic entry prices, so the property is where
   * the long clock lives.
   */
  propertyCost: number;
  /**
   * Prestige points minted the first time this store's land is ever bought.
   * The six sum to 75 — exactly the edge cap at `edgePerPoint` — so a full
   * collection IS a maxed edge, and the board can say so.
   */
  propertyPoints: number;
  /**
   * What this store nets per game week under a MANAGER — the cheque a kept
   * store pays, before the rent term (see empire.ts).
   *
   * MEASURED, then discounted: an automation-run store at this rung (the
   * dumpsave build — automation on, desk on auto, nobody playing) nets
   * $456 / $7.4k / $16.8k / $10.6k / $23.6k / $59.2k a week at steady state,
   * and this figure is ~40% of that operating net. The manager keeps the
   * rest, which is both the fiction and the balance: a store that runs
   * without you must never out-earn one you are standing at. Note the ladder
   * is deliberately NOT monotonic — the big lot out-earns the first franchise
   * under a manager, because fat used margins survive automation better than
   * thin franchise ones, and that is the measured truth rather than a typo.
   */
  managedNetPerWeek: number;
  /**
   * Who runs the sales side when you are not standing there, and what they
   * charge for it.
   *
   * The `salesDesk` upgrade is one id all the way up the ladder, but WHO you
   * hire changes with the store, and the pay structure is the progression
   * story: the curbstone **business partner** draws no salary and takes half
   * the profit on every deal he closes — his labour, your capital, the classic
   * split. The dealership **sales managers** are salaried professionals on a
   * far smaller cut, and the cut keeps thinning as you move upmarket. Getting
   * better terms IS moving up in the world.
   *
   * The cut applies only to deals the STAFF closes. Close a walk-up yourself —
   * the tap, the slider, the counter — and every dollar is yours, which is what
   * makes attended play worth sitting down for. It is a share of PROFIT, not of
   * price: curbstone margin runs about a quarter of the sale price, so a cut of
   * price would be four times sharper than it reads.
   */
  desk: {
    /** What the hire is called at this store. The upgrades screen shows this. */
    title: string;
    /** Share of the profit on deals the desk closes, 0-1. */
    commission: number;
    /** Whether they draw a weekly wage on top. The partner does not. */
    salaried: boolean;
  };
  /**
   * Whether the finance office can sell service contracts here.
   *
   * A capability, asked of the stage and never inferred from its id — same rule
   * `financing` follows. It starts at the big lot: a curbstoner selling a
   * warranty on a driveway beater is not a business, it is a fraud, and the
   * small lot is still hand-to-mouth enough that owing somebody a gearbox for
   * eight months is a way to die rather than a product.
   */
  serviceContracts: boolean;
  /**
   * The service department, where there is one. Undefined below the franchises,
   * which is the capability check — `stage.shop !== undefined`.
   */
  shop?: StageShop;
  sourcing: StageSourcing;
}

/**
 * What a service department is worth at this store.
 *
 * HARD NUMBERS PER STORE, for the reason the sales floors are: a labour rate is
 * a rule the business runs on for hours at a time, and one denominated in a
 * share of something that moves would quietly mean a different thing after
 * every retune. The stops were derived once against each store's measured
 * weekly gross — see docs/service-plan.md — and rounded to figures a shop would
 * actually put on the wall.
 */
export interface StageShop {
  /**
   * Labour rate stops, ascending, in dollars an hour. The MIDDLE stop is the
   * reference: demand is quoted at it, and every other stop is a departure
   * from it.
   */
  hourlyRates: readonly number[];
  /**
   * Repair orders arriving per second at the reference rate, before the
   * player's rate moves it.
   *
   * Sized so a fully built shop at the middle rate is roughly at capacity —
   * which is what makes the rate slider a decision rather than a dial. A small
   * shop should charge more and turn nobody away; a maxed one can cut the rate
   * and fill six benches.
   *
   * KNOW THE CEILING BEFORE TOUCHING IT: arrivals are one Bernoulli draw per
   * 1s tick, so the realised rate is `1 − e^−demand` and saturates at one job
   * a second whatever this is set to. Valmont's 1/sec really delivers 0.63 —
   * about 88 jobs a game week — and no value here can push past 140. Demand
   * above ~1 buys almost nothing; the dial for a bigger shop is `jobScale`.
   */
  demandPerSec: number;
  /**
   * How big this store's repair orders are, as a multiplier on the global
   * `jobHoursMin`/`jobHoursSpan` draw.
   *
   * THE JOB IS THE UNIT THAT SCALES UP THE LADDER, NOT THE QUEUE — see the
   * arrival ceiling above; more demand cannot feed a big shop, bigger tickets
   * can. It is also the honest shape: a premium car's repair order genuinely
   * is a bigger invoice, not more visits.
   *
   * Sized from the design requirement that THE TOP STORE PROFITABLY STAFFS
   * EVERY BAY AT MAX CERT. At 3.0 a Valmont order averages ~7.3 labour-hours
   * and six Certified IIIs bill ~$103k a week against ~$50k of wages — and
   * both the sixth bench and the certification are genuinely optimal (five
   * certs or six entries each net less). Okabe at 1.4 stays an entry-tech
   * shop — a full cert bench LOSES money there, which is the flip over the
   * life of a store the roster design wants. Halvorsen at 1 anchors the A/B:
   * scales a draw the shop already makes, no RNG consumed, 1 everywhere
   * reproduces the previous build on an identical stream.
   */
  jobScale: number;
}

/**
 * What each labour rate stop is called. Middle stop is the going rate; the ends
 * are a deliberate posture. Unlike a sales floor there is no "off" — a shop
 * without a rate is not a shop, it is a closed shop, which is what having no
 * bays already means.
 */
export const SHOP_RATE_NAMES: readonly string[] = [
  'Cut-price',
  'Under the going rate',
  'Going rate',
  'Dealer rate',
  'Main dealer rate',
];

/** How many stops a labour rate has. Levels are 1-indexed, like a sales floor. */
export const SHOP_RATE_LEVELS = SHOP_RATE_NAMES.length;

export const STAGE_ORDER: readonly StageId[] = [
  'curbstone',
  'smallUsed',
  'largeUsed',
  'lowCostFranchise',
  'midsizeFranchise',
  'premiumFranchise',
];

/** Used-market condition and mileage, matching what cars.ts generates by tier. */
const OPEN_MARKET = {
  conditionMin: 0,
  conditionMax: 0,
  mileageMin: 0,
  mileageMax: 0,
  appraisalSigmaMult: 1,
  // An auction seller does not charge for a spoiler.
  raritySellerCapture: 0,
} as const;

/**
 * A car off the truck. Effectively new, and effectively identical to the next
 * one — which is the point of a franchise.
 */
const FROM_THE_MANUFACTURER = {
  conditionMin: 0.95,
  conditionMax: 1,
  mileageMin: 4,
  mileageMax: 90,
  appraisalSigmaMult: 0,
  // A factory does. Every franchise overrides this alongside its invoice band.
  raritySellerCapture: 0.7,
  // Every franchise overrides these — the invoice thins as the marque moves
  // upmarket. Kept as a fallback so the shape is defined if a stage forgets.
  askMin: 1.16,
  askMax: 1.24,
} as const;

export const STAGES: readonly StageDef[] = [
  {
    id: 'curbstone',
    name: 'Curbstoning',
    shortName: 'Curbstone',
    blurb: 'Cars on the driveway, cash in hand, nobody to pay but yourself.',
    entryCost: 0,
    baseCarCapacity: 2,
    capacityUpgradeId: 'driveway',
    capacityPerLevel: 1,
    financing: false,
    upgradeCostMultiplier: 1,
    rentPerWeek: 0,
    trafficPerCar: 1,
    bhphMultiplier: 1,
    creditShift: 0,
    collectionsCapacityMult: 1,
    haggleDepth: 1,
    propertyCost: 500_000,
    propertyPoints: 3,
    managedNetPerWeek: 180,
    desk: { title: 'Business partner', commission: 0.5, salaried: false },
    // Average deal 19%, and the band reaches 55% on a rare trim bought cheap.
    // Level 1 is break-even because a curbstone ask band genuinely straddles it:
    // "nothing at a loss" is a real rule here and is a no-op anywhere above the
    // big lot. No finance ladder — no finance desk.
    serviceContracts: false,
    sourcing: { ...OPEN_MARKET, tiers: ['beater', 'commuter'], askMin: 0.8, askMax: 1.42 },
  },
  {
    id: 'smallUsed',
    name: 'Small used dealership',
    shortName: 'Small lot',
    blurb:
      'A real lot and a finance desk. Instead of selling a car once, you sell it once for the down payment and again as paper.',
    entryCost: 70_000,
    baseCarCapacity: 8,
    capacityUpgradeId: 'lot',
    capacityPerLevel: 1,
    financing: true,
    upgradeCostMultiplier: 1,
    rentPerWeek: 400,
    trafficPerCar: 0.6,
    bhphMultiplier: 1.5,
    creditShift: 0,
    collectionsCapacityMult: 1,
    haggleDepth: 1,
    propertyCost: 1_200_000,
    propertyPoints: 5,
    managedNetPerWeek: 3_000,
    desk: { title: 'Sales manager', commission: 0.25, salaried: true },
    // Cash averages 19% here as well; paper averages 33%, because the window
    // markup is at its highest at the store that sells approval for a living.
    serviceContracts: false,
    sourcing: {
      ...OPEN_MARKET,
      tiers: ['beater', 'commuter', 'family', 'truck'],
      askMin: 0.84,
      askMax: 1.38,
    },
  },
  {
    id: 'largeUsed',
    name: 'Large used dealership',
    shortName: 'Big lot',
    blurb:
      'Rows instead of a row. The beaters go to the wholesaler now — you are buying cars people finance on purpose rather than out of desperation.',
    entryCost: 900_000,
    baseCarCapacity: 14,
    capacityUpgradeId: 'lot',
    capacityPerLevel: 4,
    financing: true,
    upgradeCostMultiplier: 2.4,
    rentPerWeek: 2000,
    trafficPerCar: 0.5,
    bhphMultiplier: 1.42,
    creditShift: 0.4,
    collectionsCapacityMult: 1,
    haggleDepth: 1,
    propertyCost: 4_000_000,
    propertyPoints: 8,
    managedNetPerWeek: 7_500,
    desk: { title: 'Sales manager', commission: 0.2, salaried: true },
    // The band no longer reaches a loss (worst case 4%), so the bottom stop
    // stops being break-even and starts being a thin deal. This is also the
    // first store that pays freight, which takes 2-5 points off the average
    // once the transporters are running — the ladder is set against the store
    // rather than against any one reach level, and the panel quotes both.
    // The first store with a finance office worth the name, and the first one
    // big enough that owing somebody a gearbox is a product rather than a
    // catastrophe. No service department yet: you sell the cover and pay an
    // independent garage retail to honour it, which is exactly why the loss
    // ratio is 65% here and 50% once you have your own bays.
    serviceContracts: true,
    sourcing: {
      ...OPEN_MARKET,
      tiers: ['commuter', 'family', 'truck', 'luxury'],
      askMin: 0.9,
      askMax: 1.3,
    },
  },
  {
    id: 'lowCostFranchise',
    name: 'Low-cost franchise',
    shortName: 'Halvorsen',
    blurb:
      'A sign with somebody else’s name on it. Every car is new, every car is a Halvorsen, and every price comes off an invoice — the guesswork is over and the volume starts.',
    entryCost: 3_000_000,
    baseCarCapacity: 22,
    capacityUpgradeId: 'lot',
    capacityPerLevel: 4,
    financing: true,
    upgradeCostMultiplier: 6,
    rentPerWeek: 3500,
    trafficPerCar: 0.5,
    bhphMultiplier: 1.3,
    creditShift: 0.9,
    collectionsCapacityMult: 1,
    haggleDepth: 0.8,
    propertyCost: 12_000_000,
    propertyPoints: 12,
    managedNetPerWeek: 5_500,
    desk: { title: 'Sales manager', commission: 0.12, salaried: true },
    // An invoice is nearly flat, so the whole ladder lives inside thirteen
    // points. This is the store where a percentage-based rule set at a used lot
    // would have meant "sell nothing, ever" — 22% is above anything a Halvorsen
    // allocation can produce.
    serviceContracts: true,
    // The first store with bays behind the showroom. Rates are a real
    // franchise's: under a hundred an hour, and the volume comes from being the
    // only Halvorsen dealer in town.
    shop: { hourlyRates: [45, 58, 72, 90, 115], demandPerSec: 0.5, jobScale: 1 },
    sourcing: { ...FROM_THE_MANUFACTURER, askMin: 1.18, askMax: 1.26, makeId: 'halvorsen' },
  },
  {
    id: 'midsizeFranchise',
    name: 'Midsize franchise',
    shortName: 'Okabe',
    blurb:
      'The full Okabe lineup, trucks included. Thinner margin on every unit and a great many more units.',
    entryCost: 6_000_000,
    baseCarCapacity: 32,
    capacityUpgradeId: 'lot',
    capacityPerLevel: 4,
    financing: true,
    upgradeCostMultiplier: 12,
    rentPerWeek: 6000,
    trafficPerCar: 0.5,
    bhphMultiplier: 1.22,
    creditShift: 1.6,
    collectionsCapacityMult: 75 / 43, // a maxed desk carries 75 contracts here
    haggleDepth: 0.7,
    propertyCost: 50_000_000,
    propertyPoints: 19,
    managedNetPerWeek: 12_000,
    desk: { title: 'Sales manager', commission: 0.1, salaried: true },
    serviceContracts: true,
    shop: { hourlyRates: [55, 72, 92, 118, 150], demandPerSec: 0.65, jobScale: 1.4 },
    sourcing: { ...FROM_THE_MANUFACTURER, askMin: 1.22, askMax: 1.29, makeId: 'okabe' },
  },
  {
    id: 'premiumFranchise',
    name: 'Premium franchise',
    shortName: 'Valmont',
    blurb:
      'Valmont. Six figures a car, customers with real credit, and a finance desk that finally has nothing to apologise for.',
    entryCost: 24_000_000,
    baseCarCapacity: 42,
    capacityUpgradeId: 'lot',
    capacityPerLevel: 4,
    financing: true,
    upgradeCostMultiplier: 22,
    rentPerWeek: 12000,
    trafficPerCar: 0.5,
    bhphMultiplier: 1.15,
    creditShift: 2.6,
    collectionsCapacityMult: 100 / 43, // a maxed desk carries 100 contracts here
    haggleDepth: 0.6,
    propertyCost: 400_000_000,
    propertyPoints: 28,
    managedNetPerWeek: 28_000,
    desk: { title: 'Sales manager', commission: 0.08, salaried: true },
    // The two ladders finally converge, which is `bhphMultiplier` telling the
    // truth: at 1.15 the window markup no longer covers what collections eat,
    // so a contract here grosses 0.997 of the cash deal. Paper stops being a
    // premium at the top of the ladder, and the sliders say so.
    serviceContracts: true,
    // Main dealer rates, and the busiest bays on the ladder. This is the store
    // where the shop matters most, and not because it is biggest: unit margin
    // here is 6.8% against the big lot's 18.6%, so a dollar of labour is worth
    // nearly three times as much of a car as it is further down.
    shop: { hourlyRates: [95, 125, 160, 205, 265], demandPerSec: 1, jobScale: 3 },
    sourcing: { ...FROM_THE_MANUFACTURER, askMin: 1.25, askMax: 1.31, makeId: 'valmont' },
  },
];

const BY_ID = new Map(STAGES.map((s) => [s.id, s]));

/**
 * Roughly what one car costs to buy at this store.
 *
 * Median list price of what the store actually sources, so it tracks the ladder
 * without anybody maintaining a second table. Three things read it and all three
 * are gates on spending: the automation reserve in `stepAutomation`, the
 * reopening float on a stage move, and the size of the shark's offer.
 *
 * IT MUST PRICE THE CAR THAT ACTUALLY TURNS UP, NOT THE MODEL. `baseValue` is a
 * clean low-mileage example, and the first cut of this used it raw — so a
 * curbstone car was valued at $11,910 when the feed was showing $1,577 beaters
 * with 200,000 miles on them. The reserve is two of these, which put a $23,820
 * floor under a business that starts with $3,000: the retainer buyer could
 * never buy anything, at any price, however cheap, and a player who had set
 * their working-capital floor to $500 watched `max()` silently override it by a
 * factor of forty-seven.
 *
 * So mileage and condition come from the same profile `generateCar` rolls
 * against, taken at the midpoint — which for a symmetric draw IS the median car,
 * and this function's job is the median. Composed from `mileageFactor` and
 * `conditionFactor` rather than re-deriving a curve; it is `retailValue` for a
 * car that has never been repossessed.
 *
 * Nothing caught this because nothing measures it. The harness bot gates its own
 * buying on `cash - price < 400 + float` and never consults this number, so it
 * bought happily all the way up a ladder the retainer buyer could not move on.
 */
export function typicalCarPrice(stage: StageDef): number {
  const askMid = (stage.sourcing.askMin + stage.sourcing.askMax) / 2;
  return Math.round(typicalRetailPrice(stage) * BALANCE.wholesaleOfRetail * askMid);
}

/**
 * What the median car this store sources is WORTH at retail, before anybody
 * haggles over what it costs.
 *
 * The other half of `typicalCarPrice`, split out because two callers ask
 * genuinely different questions of the same median: a spending gate wants the
 * cheque, and anything denominating a cost as a share of the deal — freight
 * against margin, a house rule quoted in dollars — wants the gross. Sharing the
 * median rather than re-deriving it is the point: this number has been wrong
 * once already (see above), and once is enough for it to be wrong in one place.
 */
export function typicalRetailPrice(stage: StageDef): number {
  const models = stage.sourcing.makeId
    ? modelsForMake(stage.sourcing.makeId)
    : modelsForTiers(stage.sourcing.tiers ?? []);
  if (models.length === 0) return 0;

  // A franchise takes delivery from the manufacturer, so its stock profile
  // overrides the tier's — exactly the branch `stockProfile` takes in engine.ts.
  const delivered = stage.sourcing.makeId
    ? {
        mileage: [stage.sourcing.mileageMin, stage.sourcing.mileageMax] as const,
        condition: [stage.sourcing.conditionMin, stage.sourcing.conditionMax] as const,
      }
    : null;

  const values = models
    .map((m) => {
      const profile = delivered ?? TIER_PROFILE[m.tier];
      const mileage = (profile.mileage[0] + profile.mileage[1]) / 2;
      const condition = (profile.condition[0] + profile.condition[1]) / 2;
      return m.baseValue * mileageFactor(mileage) * conditionFactor(condition);
    })
    .sort((a, b) => a - b);

  return median(values);
}

/**
 * True median: the mean of the two central values when the list is even.
 *
 * Not pedantry. Curbstone sources exactly six models — three beaters around
 * $2,000 and three commuters around $5,500 — so the list is bimodal with an even
 * split and there is no middle element to pick. Taking `values[n / 2]` returned
 * the cheapest commuter and pretended the beater half of the feed did not
 * exist, which on its own overstated a curbstone car by 60%.
 */
function median(sorted: readonly number[]): number {
  if (sorted.length === 0) return 0;
  const mid = sorted.length / 2;
  return sorted.length % 2 === 1
    ? sorted[Math.floor(mid)]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function getStage(id: StageId): StageDef {
  const def = BY_ID.get(id);
  if (!def) throw new Error(`Unknown stage: ${id}`);
  return def;
}

/** Rank in the progression. -1 for an id this build does not know. */
export function stageRank(id: StageId): number {
  return STAGE_ORDER.indexOf(id);
}

/** The stage after this one, or null at the top of the ladder. */
export function nextStage(id: StageId): StageDef | null {
  const next = STAGE_ORDER[stageRank(id) + 1];
  return next ? getStage(next) : null;
}

/** True when `state` has reached at least `required`. Used to gate upgrades. */
export function hasReached(current: StageId, required: StageId): boolean {
  return stageRank(current) >= stageRank(required);
}

/** Whether this stage buys from a manufacturer rather than the open market. */
export function isFranchise(id: StageId): boolean {
  return getStage(id).sourcing.makeId !== undefined;
}
