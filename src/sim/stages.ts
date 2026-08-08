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
  staffCostMultiplier: number;
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
  askMin: 1.05,
  askMax: 1.15,
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
    staffCostMultiplier: 1,
    bhphMultiplier: 1,
    creditShift: 0,
    sourcing: { ...OPEN_MARKET, tiers: ['beater', 'commuter'], askMin: 0.8, askMax: 1.2 },
  },
  {
    id: 'smallUsed',
    name: 'Small used dealership',
    shortName: 'Small lot',
    blurb:
      'A real lot and a finance desk. Instead of selling a car once, you sell it once for the down payment and again as paper.',
    entryCost: 18_000,
    baseCarCapacity: 6,
    capacityUpgradeId: 'lot',
    financing: true,
    staffCostMultiplier: 1,
    bhphMultiplier: 1.5,
    creditShift: 0,
    sourcing: {
      ...OPEN_MARKET,
      tiers: ['beater', 'commuter', 'family', 'truck'],
      askMin: 0.8,
      askMax: 1.2,
    },
  },
  {
    id: 'largeUsed',
    name: 'Large used dealership',
    shortName: 'Big lot',
    blurb:
      'Rows instead of a row. The beaters go to the wholesaler now — you are buying cars people finance on purpose rather than out of desperation.',
    entryCost: 220_000,
    baseCarCapacity: 14,
    capacityUpgradeId: 'lot',
    financing: true,
    staffCostMultiplier: 2.4,
    bhphMultiplier: 1.42,
    creditShift: 0.4,
    sourcing: {
      ...OPEN_MARKET,
      tiers: ['commuter', 'family', 'truck', 'luxury'],
      askMin: 0.8,
      askMax: 1.2,
    },
  },
  {
    id: 'lowCostFranchise',
    name: 'Low-cost franchise',
    shortName: 'Halvorsen',
    blurb:
      'A sign with somebody else’s name on it. Every car is new, every car is a Halvorsen, and every price comes off an invoice — the guesswork is over and the volume starts.',
    entryCost: 1_600_000,
    baseCarCapacity: 22,
    capacityUpgradeId: 'lot',
    financing: true,
    staffCostMultiplier: 5,
    bhphMultiplier: 1.3,
    creditShift: 0.9,
    sourcing: { ...FROM_THE_MANUFACTURER, makeId: 'halvorsen' },
  },
  {
    id: 'midsizeFranchise',
    name: 'Midsize franchise',
    shortName: 'Okabe',
    blurb:
      'The full Okabe lineup, trucks included. Thinner margin on every unit and a great many more units.',
    entryCost: 7_500_000,
    baseCarCapacity: 32,
    capacityUpgradeId: 'lot',
    financing: true,
    staffCostMultiplier: 10,
    bhphMultiplier: 1.22,
    creditShift: 1.6,
    sourcing: { ...FROM_THE_MANUFACTURER, makeId: 'okabe' },
  },
  {
    id: 'premiumFranchise',
    name: 'Premium franchise',
    shortName: 'Valmont',
    blurb:
      'Valmont. Six figures a car, customers with real credit, and a finance desk that finally has nothing to apologise for.',
    entryCost: 32_000_000,
    baseCarCapacity: 42,
    capacityUpgradeId: 'lot',
    financing: true,
    staffCostMultiplier: 18,
    bhphMultiplier: 1.15,
    creditShift: 2.6,
    sourcing: { ...FROM_THE_MANUFACTURER, makeId: 'valmont' },
  },
];

const BY_ID = new Map(STAGES.map((s) => [s.id, s]));

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
