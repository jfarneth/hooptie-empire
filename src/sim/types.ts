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
  /** Consecutive missed payments. Repo triggers at BALANCE.repoAfterMissedPayments. */
  missedPayments: number;
  /** Cash actually collected so far, down payment excluded. */
  collected: number;
  status: NoteStatus;
  openedAt: Millis;
}

/** A customer standing on the lot with an offer for a specific listed car. */
export interface Prospect {
  id: string;
  carId: string;
  name: string;
  tier: CreditTier;
  /** What they will pay in cash, today. */
  cashOffer: number;
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

export type StageId = 'curbstoner' | 'bhph';

/**
 * Standing instruction for the sales desk once it is staffed.
 * 'auto' compares the cash offer against the expected value of the paper,
 * which is the same calculation the deal sheet shows the player.
 */
export type DealPolicy = 'manual' | 'cash' | 'finance' | 'auto';

export interface Stats {
  carsSold: number;
  cashDeals: number;
  financeDeals: number;
  notesPaidOff: number;
  notesDefaulted: number;
  reposCompleted: number;
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
    | 'recon-done'
    | 'stage-up';
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
  /** Standing order for the sales desk. Only acted on once 'salesDesk' is owned. */
  dealPolicy: DealPolicy;
  stats: Stats;
  /** Ring buffer of recent events; trimmed to BALANCE.eventLogSize. */
  events: SimEvent[];
  /** Wall-clock ms at last save, used to compute offline elapsed time. */
  lastSeenAt: number;
  /** Monotonic counter for entity ids, so ids are deterministic given a seed. */
  nextId: number;
}
