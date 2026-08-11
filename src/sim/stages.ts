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
  sourcing: StageSourcing;
}

/** Progression order. Index in this array is the stage's rank. */
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
    financing: false,
    upgradeCostMultiplier: 1,
    rentPerWeek: 0,
    bhphMultiplier: 1,
    creditShift: 0,
    desk: { title: 'Business partner', commission: 0.5, salaried: false },
    sourcing: { ...OPEN_MARKET, tiers: ['beater', 'commuter'], askMin: 0.8, askMax: 1.42 },
  },
  {
    id: 'smallUsed',
    name: 'Small used dealership',
    shortName: 'Small lot',
    blurb:
      'A real lot and a finance desk. Instead of selling a car once, you sell it once for the down payment and again as paper.',
    entryCost: 70_000,
    baseCarCapacity: 6,
    capacityUpgradeId: 'lot',
    financing: true,
    upgradeCostMultiplier: 1,
    rentPerWeek: 400,
    bhphMultiplier: 1.5,
    creditShift: 0,
    desk: { title: 'Sales manager', commission: 0.25, salaried: true },
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
    financing: true,
    upgradeCostMultiplier: 2.4,
    rentPerWeek: 2000,
    bhphMultiplier: 1.42,
    creditShift: 0.4,
    desk: { title: 'Sales manager', commission: 0.2, salaried: true },
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
    entryCost: 5_400_000,
    baseCarCapacity: 22,
    capacityUpgradeId: 'lot',
    financing: true,
    upgradeCostMultiplier: 5,
    rentPerWeek: 4000,
    bhphMultiplier: 1.3,
    creditShift: 0.9,
    desk: { title: 'Sales manager', commission: 0.12, salaried: true },
    sourcing: { ...FROM_THE_MANUFACTURER, askMin: 1.16, askMax: 1.24, makeId: 'halvorsen' },
  },
  {
    id: 'midsizeFranchise',
    name: 'Midsize franchise',
    shortName: 'Okabe',
    blurb:
      'The full Okabe lineup, trucks included. Thinner margin on every unit and a great many more units.',
    entryCost: 20_000_000,
    baseCarCapacity: 32,
    capacityUpgradeId: 'lot',
    financing: true,
    upgradeCostMultiplier: 10,
    rentPerWeek: 9000,
    bhphMultiplier: 1.22,
    creditShift: 1.6,
    desk: { title: 'Sales manager', commission: 0.1, salaried: true },
    sourcing: { ...FROM_THE_MANUFACTURER, askMin: 1.2, askMax: 1.27, makeId: 'okabe' },
  },
  {
    id: 'premiumFranchise',
    name: 'Premium franchise',
    shortName: 'Valmont',
    blurb:
      'Valmont. Six figures a car, customers with real credit, and a finance desk that finally has nothing to apologise for.',
    entryCost: 70_000_000,
    baseCarCapacity: 42,
    capacityUpgradeId: 'lot',
    financing: true,
    upgradeCostMultiplier: 18,
    rentPerWeek: 20000,
    bhphMultiplier: 1.15,
    creditShift: 2.6,
    desk: { title: 'Sales manager', commission: 0.08, salaried: true },
    sourcing: { ...FROM_THE_MANUFACTURER, askMin: 1.23, askMax: 1.29, makeId: 'valmont' },
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

  const askMid = (stage.sourcing.askMin + stage.sourcing.askMax) / 2;
  return Math.round(median(values) * BALANCE.wholesaleOfRetail * askMid);
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
