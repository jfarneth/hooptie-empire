/**
 * Core simulation types.
 *
 * RULE: nothing in `src/sim` may import from `react-native`, `react`, or any
 * UI package. The simulation is a pure headless module so that offline
 * progress, balance tooling, and tests all drive the exact same code path.
 */

/** Milliseconds on the simulation clock (not wall clock). */
export type Millis = number;

export type BodyStyle = 'sedan' | 'hatch' | 'suv' | 'truck' | 'coupe' | 'van';

export type CarTier = 'beater' | 'commuter' | 'family' | 'truck' | 'luxury';

export interface CarModel {
  id: string;
  /** Marque. On the franchise stages the whole feed is one of these. */
  makeId: string;
  /** Full display name, make included: "Renwick Comet". */
  name: string;
  tier: CarTier;
  bodyStyle: BodyStyle;
  /** Clean retail value of a low-mileage example, in dollars. */
  baseValue: number;
}

export type CarStatus = 'recon' | 'ready' | 'listed' | 'sold';

export interface Car {
  id: string;
  modelId: string;
  /** Paint colour index into BODY_COLORS, kept in state so it is stable across renders. */
  colorIndex: number;
  mileage: number;
  /** 0 = rough, 1 = showroom. */
  condition: number;
  /** Everything sunk into this car: purchase price + recon spend. */
  costBasis: number;
  acquiredAt: Millis;
  status: CarStatus;
  /** Remaining reconditioning work, in sim ms. Only meaningful while status === 'recon'. */
  reconRemainingMs: number;
  /** Duration of the current recon job, so progress is derivable for the UI. */
  reconTotalMs: number;
  /** Condition this car will reach when the current recon job finishes. */
  reconTargetCondition: number;
  askPrice: number;
  listedAt: Millis | null;
  /** Set when the car has been repossessed at least once — affects resale. */
  repoCount: number;
}

/** A car offered to the player on the sourcing feed. */
export interface Listing {
  id: string;
  car: Car;
  /** What the seller wants. May be under or over wholesale. */
  price: number;
  /** Sim time at which this listing disappears. */
  expiresAt: Millis;
  /** Cosmetic label for the UI: where the car came from. */
  source: string;
  /**
   * How wrong this car looks, as a z-score drawn once at spawn.
   *
   * Stored rather than the estimate itself, so the displayed appraisal is a
   * pure function of this draw and the current Buying level — levelling up
   * sharpens the whole feed at once without re-rolling anything. See
   * appraisal.ts.
   */
  appraisalNoise: number;
}

/**
 * Credit tiers. Better credit defaults less but will not tolerate a large down
 * payment or a punitive rate; deep subprime pays a fat down and may vanish.
 */
export type CreditTier = 'A' | 'B' | 'C' | 'D';

export type NoteStatus = 'current' | 'delinquent' | 'defaulted' | 'paid';

/**
 * A buy-here-pay-here retail installment contract. This is the central asset of
 * the game: the player sells the car once for the down payment and again as paper.
 */
export interface Note {
  id: string;
  carId: string;
  /** Display label so the ledger can name the car after it leaves inventory. */
  carLabel: string;
  customerName: string;
  customerTier: CreditTier;
  /** Amount financed at origination. */
  originalPrincipal: number;
  /** Outstanding principal right now. */
  principal: number;
  /** Annual percentage rate, e.g. 0.229 for 22.9%. */
  apr: number;
  /** Level weekly payment. */
  paymentAmount: number;
  paymentsTotal: number;
  paymentsRemaining: number;
  nextDueAt: Millis;
  /** Consecutive missed payments. Repo triggers at the player's repo threshold. */
  missedPayments: number;
  /** Cash actually collected so far, down payment excluded. */
  collected: number;
  status: NoteStatus;
  openedAt: Millis;
}

export type NegotiationStatus = 'open' | 'accepted' | 'walked';

/**
 * A live haggle over a cash price.
 *
 * `reservation`, `room` and `aggression` are hidden from the player — they are
 * what the buyer privately knows. Everything here lives in GameState rather than
 * React so a negotiation resolves identically offline, in a replay, and on screen.
 */
export interface Negotiation {
  /** The asking price this negotiation is anchored to. */
  anchor: number;
  /** What they first said. Re-counters never go below it. */
  openingOffer: number;
  /** What they are offering right now — the price a sale would close at. */
  currentOffer: number;
  /** Hidden: the most they would actually pay. */
  reservation: number;
  /** Hidden: where the reservation sits between offer and anchor, 0–1. */
  room: number;
  /** Hidden: how hard they opened, 0–1. */
  aggression: number;
  countersMade: number;
  lastCounter: number | null;
  status: NegotiationStatus;
  /** Index into the tell table, fixed at open so it does not flicker. */
  tellIndex: number;
}

/** A customer standing on the lot with an offer for a specific listed car. */
export interface Prospect {
  id: string;
  carId: string;
  name: string;
  tier: CreditTier;
  /** Live cash haggle. `negotiation.currentOffer` is the price on the table. */
  negotiation: Negotiation;
  /** What they can put down if financed. */
  downPayment: number;
  /** Terms they will accept if financed. */
  financeTerms: {
    amountFinanced: number;
    apr: number;
    weeklyPayment: number;
    weeks: number;
  };
  /** Sim time at which this prospect walks. */
  expiresAt: Millis;
}

/**
 * The dealership you are currently running. Ordered; see `STAGE_ORDER` and the
 * stage table in stages.ts, which is where everything that varies by stage lives.
 *
 * Never test a capability by comparing stage ids — ask the stage. `financing`
 * is true for five of the six, and a `=== 'smallUsed'` check would silently mean
 * "no finance desk at a Valmont store".
 */
export type StageId =
  | 'curbstone'
  | 'smallUsed'
  | 'largeUsed'
  | 'lowCostFranchise'
  | 'midsizeFranchise'
  | 'premiumFranchise';

/**
 * Player proficiencies. These level from doing the thing rather than from
 * spending money — upgrades buy capacity, skills earn quality.
 *
 * Kept as a `Record` rather than three named fields so the paper side of the
 * business can get its own skill later without another save migration.
 */
export type SkillId = 'buy' | 'sell' | 'repair';

export interface Skill {
  /** 1..BALANCE.skills.maxLevel. */
  level: number;
  /** Progress toward the next level. Reset on level-up, pinned at 0 once maxed. */
  xp: number;
}

/**
 * Standing instruction for the sales desk once it is staffed.
 * 'auto' compares the cash offer against the expected value of the paper,
 * which is the same calculation the deal sheet shows the player.
 */
export type DealPolicy = 'manual' | 'cash' | 'finance' | 'auto';

/**
 * The house rules: standing constraints the player sets once and the business
 * then runs under, whether or not anyone is watching.
 *
 * These live in GameState rather than in React for the same reason a negotiation
 * does — they have to hold while the app is closed, or a policy would silently
 * stop applying exactly when it matters most. Every default reproduces the
 * behaviour the game had before the suite existed.
 */
export interface BusinessPolicy {
  /**
   * Cash the automation will not spend below. The retainer buyer and the
   * standing shop order both stop here rather than running the float to zero.
   */
  minWorkingCapital: number;
  /**
   * Consecutive missed payments before the car comes back. Lower recovers the
   * unit sooner and in better shape; higher gives a borrower rope to cure and
   * collects more, at the cost of a rougher car whenever it does go bad.
   */
  repoAfterMissedPayments: number;
  /**
   * What the retainer buyer insists on: a discount to the worst-case wholesale
   * it can see, as a share of that value. 0 is "anything that looks cheap at
   * the bad end", which is what the buyer did before this existed.
   */
  minBuyMargin: number;
}

export interface Stats {
  carsSold: number;
  cashDeals: number;
  financeDeals: number;
  notesPaidOff: number;
  notesDefaulted: number;
  reposCompleted: number;
  /** Cash deals closed after at least one counter. */
  negotiationsWon: number;
  /** Buyers lost to a counter that pushed too hard. */
  walkaways: number;
  totalCollected: number;
  lifetimeProfit: number;
}

/** Things that happened during a slice of simulation, for the away summary. */
export interface SimEvent {
  t: Millis;
  kind:
    | 'sale-cash'
    | 'sale-finance'
    | 'payment'
    | 'note-paid'
    | 'note-default'
    | 'repo'
    | 'walkaway'
    | 'recon-done'
    | 'stage-up'
    | 'skill-up'
    | 'appraisal';
  label: string;
  amount?: number;
}

export interface RngState {
  s: number;
}

export interface GameState {
  version: number;
  /** Simulation clock. Monotonic, advanced only by the engine. */
  t: Millis;
  /** Sub-tick remainder carried between advance() calls. */
  accumulatorMs: number;
  rng: RngState;
  cash: number;
  stage: StageId;
  cars: Car[];
  listings: Listing[];
  prospects: Prospect[];
  notes: Note[];
  /** Upgrade id -> level owned. */
  upgrades: Record<string, number>;
  /** Proficiencies earned by playing. See skills.ts. */
  skills: Record<SkillId, Skill>;
  /** Standing order for the sales desk. Only acted on once 'salesDesk' is owned. */
  dealPolicy: DealPolicy;
  /** House rules the whole business runs under. See BusinessPolicy. */
  business: BusinessPolicy;
  /**
   * Admin console overrides on the tuning constants, keyed by dotted path.
   * Sparse — only knobs that differ from the shipped value. Lives on the save so
   * a run still replays identically; see tuning.ts for why this is the one place
   * the simulation is allowed to write a global.
   */
  tuning: Record<string, number>;
  stats: Stats;
  /** Ring buffer of recent events; trimmed to BALANCE.eventLogSize. */
  events: SimEvent[];
  /** Wall-clock ms at last save, used to compute offline elapsed time. */
  lastSeenAt: number;
  /** Monotonic counter for entity ids, so ids are deterministic given a seed. */
  nextId: number;
}
