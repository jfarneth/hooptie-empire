/**
 * Every tuning constant in the game lives here.
 *
 * Nothing else should hard-code a number that affects pacing. When the balance
 * harness (`npm run sim`) says the curve is wrong, this is the only file that
 * should need to change.
 */

/** The engine always steps in fixed 1s slices. See engine.ts for why. */
export const TICK_MS = 1000;

/**
 * Time compression. A game day is 20 real seconds, so a game week — the beat
 * that note payments land on — is 140 real seconds. A 24-week contract runs
 * ~56 real minutes, which is long enough to feel like an investment and short
 * enough that a player sees notes pay off in one sitting.
 */
export const MS_PER_GAME_DAY = 20_000;
export const MS_PER_GAME_WEEK = MS_PER_GAME_DAY * 7;

export const BALANCE = {
  startingCash: 3_000,
  eventLogSize: 60,
  /** Paid-off and defaulted notes kept for the ledger history tab. */
  closedNoteHistory: 30,

  /** Offline catch-up cap, extended by the night-manager upgrade. */
  offlineCapMs: 8 * 60 * 60 * 1000,
  offlineCapPerNightManagerMs: 4 * 60 * 60 * 1000,

  // ---------------------------------------------------------------- valuation
  /** Retail falls off with miles; never below this floor share of base value. */
  mileageFloor: 0.18,
  /** Miles at which value has decayed by 1/e. Larger = gentler depreciation. */
  mileageDecayScale: 220_000,
  /** A rough car is worth this share of an identical clean one. */
  conditionFloorFactor: 0.45,
  /** Wholesale (what you pay) as a share of retail (what you get). */
  wholesaleOfRetail: 0.74,
  /** Each prior repossession knocks this much off retail. */
  repoValuePenalty: 0.06,

  // ------------------------------------------------------------------ sourcing
  /** How many listings can sit on the feed at once (before upgrades). */
  baseListingSlots: 4,
  listingSlotsPerScoutLevel: 2,
  /** Mean gap between new listings appearing. */
  listingIntervalMs: 22_000,
  listingIntervalPerScoutLevel: 0.78,
  listingLifetimeMs: 150_000,
  /** Seller ask relative to wholesale. Below 1.0 is a genuine deal. */
  listingAskMin: 0.86,
  listingAskMax: 1.14,

  // --------------------------------------------------------------------- recon
  /** Sim ms to raise condition by a full 1.0 point. */
  reconMsPerPoint: 150_000,
  reconMsPerMechanicLevel: 0.7,
  /** Dollars to raise condition by a full 1.0 point, as a share of base value. */
  reconCostPerPoint: 0.36,
  /** One recon job lifts condition by at most this much. */
  reconMaxLift: 0.35,

  // --------------------------------------------------------------------- sales
  /** Prospect arrival rate per second for a car listed exactly at retail. */
  baseProspectRatePerSec: 1 / 110,
  ratePerAdvertisingLevel: 1.15,
  /** Price elasticity. Higher = buyers punish overpricing harder. */
  priceElasticity: 5.0,
  /** Prospects lose interest after this long. */
  prospectLifetimeMs: 45_000,
  /** Cars priced above this multiple of retail get essentially no traffic. */
  maxViablePriceRatio: 1.6,

  /** Default ask price when a car is listed, as a multiple of retail value. */
  defaultAskRatio: 1.0,

  // ---------------------------------------------------------------- capacities
  /** Cars you can hold at once. */
  drivewayCapacity: 2,
  capacityPerDrivewayLevel: 1,
  lotCapacity: 6,
  capacityPerLotLevel: 4,

  // ---------------------------------------------------------------------- BHPH
  /** Lot price on a buy-here-pay-here deal, as a multiple of cash retail. */
  bhphPriceMultiplier: 1.5,
  /** Contract length options, in game weeks. */
  termWeeks: [18, 24, 30, 36] as const,

  /** Per-tier: down payment share, APR, per-payment miss chance, arrival weight. */
  creditTiers: {
    A: { downShare: 0.14, apr: 0.149, missChance: 0.03, weight: 0.14 },
    B: { downShare: 0.18, apr: 0.199, missChance: 0.08, weight: 0.26 },
    C: { downShare: 0.24, apr: 0.239, missChance: 0.16, weight: 0.34 },
    D: { downShare: 0.31, apr: 0.289, missChance: 0.27, weight: 0.26 },
  },

  /**
   * A borrower who is already behind is likelier to miss again. This is what
   * turns a single missed payment into a repo, and it is the main reason a
   * portfolio needs watching rather than just growing.
   */
  delinquencyMissMultiplier: 1.5,
  repoAfterMissedPayments: 3,
  repoFee: 250,
  /** Condition lost when a car comes back on the hook. */
  repoConditionLoss: 0.18,

  /** Active notes you can service before collections quality degrades. */
  baseCollectionsCapacity: 8,
  collectionsCapacityPerLevel: 7,
  /** Miss chance multiplier applied per 100% over collections capacity. */
  overCapacityMissPenalty: 0.9,

  // -------------------------------------------------------------- progression
  /** Cash required to buy the lot and enter stage 2. */
  lotPurchaseCost: 18_000,
} as const;

export type BalanceConfig = typeof BALANCE;
