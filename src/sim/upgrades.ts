import { BALANCE } from './balance';
import { repoDamageMultiplier, repoThreshold } from './business';
import { getStage, hasReached } from './stages';
import { MARKET_TIERS } from './market';
import type { GameState, StageId } from './types';

export type UpgradeCategory = 'capacity' | 'speed' | 'automation' | 'finance';

export interface UpgradeDef {
  id: string;
  name: string;
  /** Shown on the card. Flavour is fine; it should still say what it does. */
  description: string;
  category: UpgradeCategory;
  /** Earliest stage this can be bought in. */
  stage: StageId;
  maxLevel: number;
  baseCost: number;
  /** Cost multiplier per level already owned. */
  costGrowth: number;
  /**
   * Is this a person on the payroll?
   *
   * Staff do not move with you. Every one of these resets to zero when you take
   * on a bigger store and costs `staffCostMultiplier` more to hire there — you
   * are staffing a franchise service department, not rehiring the guy with the
   * socket set. Everything else is property, contracts or process, and carries
   * over untouched.
   *
   * The line is "would this person have to be hired again at the new store".
   * `scout` is a book of auction contacts and stays yours. `advertising` is a
   * spend, not a hire. `autoList` is you agreeing to do the listings.
   */
  staff?: boolean;
  /**
   * Does this survive a change of store?
   *
   * Almost nothing does — moving clears the entire upgrade table, and that
   * rebuild is the dominant cost of a rung. The one exception is the collections
   * desk, and it is an exception the loan book forces rather than a discount.
   *
   * THE BOOK MOVES INTACT. That is the oldest rule in the design: the lot is
   * sold, the payroll is released, and the paper comes with you because the
   * paper is the business. But a book that arrives at a store whose desk has
   * reset to eight contracts is not intact — a full 43-note book lands 2.9x over
   * capacity, `overCapacityFactor` pins the miss chance at its 2.2x ceiling, and
   * the entire portfolio defaults inside a game month. Measured on the ladder:
   * a business reached the premium franchise with $71.5M and a full 43/43 book,
   * and two game hours later held zero notes, zero portfolio and was falling
   * $1.7M a week. It never traded again.
   *
   * So this is not "the desk is cheap now". It is that the alternative makes
   * "the book moves intact" false, and quietly converts the last rung of the
   * ladder into a trap that destroys three hundred hours of paper. The
   * over-capacity penalty keeps every job it was built for — a save written
   * before the cap, or a desk the admin console shrank — it simply stops being
   * triggered by the one event that is supposed to preserve the book.
   */
  carriesOnMove?: boolean;
}

/**
 * Automation is unlocked in a deliberate order: list, then recon, then buy.
 * Each one takes a hand off the wheel, and the player should feel the moment
 * the business starts running without them.
 */
export const UPGRADES: readonly UpgradeDef[] = [
  {
    id: 'driveway',
    name: 'Driveway space',
    description: '+1 car you can hold at once.',
    category: 'capacity',
    stage: 'curbstone',
    maxLevel: 3,
    baseCost: 1_400,
    costGrowth: 2.3,
  },
  {
    id: 'scout',
    name: 'Auction contacts',
    description: 'More cars on the feed, and they turn up faster.',
    category: 'speed',
    stage: 'curbstone',
    maxLevel: 4,
    baseCost: 900,
    costGrowth: 2.6,
  },
  {
    id: 'mechanic',
    name: 'Mechanic',
    description: 'Reconditioning finishes faster.',
    category: 'speed',
    stage: 'curbstone',
    maxLevel: 4,
    baseCost: 1_100,
    costGrowth: 2.5,
    staff: true,
  },
  {
    id: 'advertising',
    name: 'Advertising',
    description: 'More buyers come look at what you have listed.',
    category: 'speed',
    stage: 'curbstone',
    maxLevel: 5,
    baseCost: 1_600,
    costGrowth: 2.4,
  },
  {
    id: 'autoList',
    name: 'Post them yourself',
    description: 'Cars are listed automatically as soon as they are ready.',
    category: 'automation',
    stage: 'curbstone',
    maxLevel: 1,
    baseCost: 2_200,
    costGrowth: 1,
  },
  {
    id: 'autoRecon',
    name: 'Standing shop order',
    description: 'Cars go straight into recon when you can afford the work.',
    category: 'automation',
    stage: 'curbstone',
    maxLevel: 1,
    baseCost: 4_500,
    costGrowth: 1,
  },
  {
    id: 'autoBuy',
    name: 'Buyer on retainer',
    description: 'Buys anything that still looks cheap at the worst it could be.',
    category: 'automation',
    stage: 'curbstone',
    maxLevel: 1,
    baseCost: 9_000,
    costGrowth: 1,
    staff: true,
  },
  {
    id: 'salesDesk',
    name: 'Sales manager',
    description: 'Closes walk-ups for you according to a standing policy you set.',
    category: 'automation',
    stage: 'curbstone',
    maxLevel: 1,
    baseCost: 6_000,
    costGrowth: 1,
    staff: true,
  },

  // ---- stage 2 -------------------------------------------------------------
  {
    id: 'lot',
    name: 'Pave another row',
    description: '+4 spaces on the lot.',
    category: 'capacity',
    stage: 'smallUsed',
    maxLevel: 5,
    baseCost: 8_000,
    costGrowth: 2.1,
  },
  {
    id: 'reach',
    name: 'Market reach',
    description:
      'Buy further afield. More cars than one town can supply, on a transporter you pay for.',
    category: 'capacity',
    // The large lot is where the feed first stops being able to fill the stalls:
    // a driveway and a small lot run 93-97% full on local stock alone, and a big
    // lot runs 75% with the feed dry three quarters of the time. Below here this
    // would be an answer to a question nobody has.
    stage: 'largeUsed',
    maxLevel: 2,
    baseCost: 40_000,
    costGrowth: 3.4,
  },
  {
    id: 'collections',
    name: 'Collections desk',
    description: 'Raises the hard limit on how many contracts you can carry at once.',
    category: 'finance',
    stage: 'smallUsed',
    maxLevel: 5,
    baseCost: 6_500,
    costGrowth: 2.2,
    staff: true,
    // The one line on the table that follows the paper rather than the premises.
    // See `carriesOnMove` — without it, "the book moves intact" is a sentence
    // the game does not honour.
    carriesOnMove: true,
  },
  {
    id: 'underwriting',
    name: 'Underwriting',
    description: 'Screen applicants harder. Fewer D-tier walk-ins, more B and C.',
    category: 'finance',
    stage: 'smallUsed',
    maxLevel: 3,
    baseCost: 12_000,
    costGrowth: 2.6,
    staff: true,
  },
  {
    id: 'repoMan',
    name: 'Recovery agent on call',
    description: 'Repossessions cost less and bring the car back in better shape.',
    category: 'finance',
    stage: 'smallUsed',
    maxLevel: 3,
    baseCost: 7_500,
    costGrowth: 2.4,
    staff: true,
  },
  // ---- the franchise stages -------------------------------------------------
  {
    id: 'serviceBays',
    name: 'Service bay',
    description: 'A ramp, and room for one technician to work a car at a time.',
    category: 'capacity',
    // A franchise store, and only a franchise store. Bays behind the showroom
    // are what a manufacturer's contract requires and a used lot has never had.
    stage: 'lowCostFranchise',
    maxLevel: 6,
    baseCost: 9_000,
    costGrowth: 2,
    // NOT staff, deliberately. The bay is a building; the person in it is hired
    // separately and is on the roster in `shop.techs`, because the upgrade table
    // has no way to say "this one has been here six weeks and is nearly
    // certified". The techs still follow the payroll rule — see `closeTheShop`.
  },
  {
    id: 'nightManager',
    name: 'Night manager',
    description: '+4 hours of business that keeps running while the app is closed.',
    category: 'automation',
    stage: 'smallUsed',
    maxLevel: 4,
    baseCost: 15_000,
    costGrowth: 2.2,
    staff: true,
  },
];

const BY_ID = new Map(UPGRADES.map((u) => [u.id, u]));

export function getUpgrade(id: string): UpgradeDef {
  const u = BY_ID.get(id);
  if (!u) throw new Error(`Unknown upgrade: ${id}`);
  return u;
}

/** Current level of an upgrade, 0 if never bought. */
export function level(state: Pick<GameState, 'upgrades'>, id: string): number {
  return state.upgrades[id] ?? 0;
}

export function has(state: Pick<GameState, 'upgrades'>, id: string): boolean {
  return level(state, id) > 0;
}

/**
 * What the next level costs.
 *
 * `stage` is optional so the pure cost curve stays callable without a game
 * state, but every player-facing caller should pass it: at a franchise store a
 * mechanic is an order of magnitude dearer than the same line item was on the
 * driveway, and a cost quoted without the stage is a lie on five stages out of
 * six.
 */
/**
 * What the next level of an upgrade costs here.
 *
 * Scaled by the store, and by ALL of it rather than only the payroll. Moving
 * clears the whole upgrade table — the office you built belonged to that store —
 * so everything on it is bought again at the new store's prices. That is the
 * main thing standing between two rungs of the ladder.
 */
export function upgradeCost(def: UpgradeDef, currentLevel: number, stage?: StageId): number {
  const storeScale = stage ? getStage(stage).upgradeCostMultiplier : 1;
  return Math.round(def.baseCost * Math.pow(def.costGrowth, currentLevel) * storeScale);
}

/** True once the store is big enough for this line item to exist at all. */
/**
 * What one level of this upgrade costs to keep, per game week.
 *
 * Derived from the hire's own price rather than a flat per-level figure, so a
 * sales manager costs more to keep than a lot mechanic without anybody
 * maintaining a second table. Non-staff lines return 0: paving does not eat.
 *
 * Scaled by the store for the same reason the purchase price is — the wage bill
 * at a Valmont franchise is not the wage bill at a corner lot.
 */
export function weeklyWage(def: UpgradeDef, stage?: StageId): number {
  if (!def.staff) return 0;
  // The curbstone business partner draws NO wage — he works for a cut of every
  // deal he closes instead (`STAGES[].desk`), which is both the fiction the
  // stage's blurb promises ("nobody to pay but yourself") and the reason the
  // overnight can no longer print money at full margin. Salaried desks at the
  // dealership stages pay wages AND a smaller cut.
  if (def.id === 'salesDesk' && stage && !getStage(stage).desk.salaried) return 0;
  const storeScale = stage ? getStage(stage).upgradeCostMultiplier : 1;
  return Math.round(def.baseCost * BALANCE.expenses.wageOfCost * storeScale);
}

/**
 * What this hire is called at this store. One upgrade id climbs the whole
 * ladder, but a curbstone business partner and a Valmont sales manager are not
 * the same person, and the upgrades screen should not pretend they are.
 */
export function upgradeDisplayName(def: UpgradeDef, stage: StageId): string {
  if (def.id === 'salesDesk') return getStage(stage).desk.title;
  return def.name;
}

/** Same idea for the one-liner under the name. */
export function upgradeDisplayDescription(def: UpgradeDef, stage: StageId, lvl = 0): string {
  // Market reach is a named ladder rather than a repeated bonus, so the card
  // should say which market the next cheque actually opens, and what the truck
  // costs once it is open. "Level 2 of 2" tells a player nothing.
  if (def.id === 'reach') {
    const next = MARKET_TIERS[Math.min(MARKET_TIERS.length - 1, lvl + 1)];
    const now = MARKET_TIERS[Math.min(MARKET_TIERS.length - 1, lvl)];
    if (lvl >= def.maxLevel) {
      return `Buying nationally. Freight runs about ${moneyish(now.freight)} a car on anything shipped in.`;
    }
    return `Open the ${next.name.toLowerCase()} market: more cars on the feed than one town can supply, at about ${moneyish(next.freight)} a car in freight.`;
  }
  // Capacity is per stage now, so the static "+4 spaces" would lie at the
  // small lot. Say what this store's paving actually buys.
  if (def.id === 'lot' || def.id === 'driveway') {
    const per = getStage(stage).capacityPerLevel;
    return `+${per} ${per === 1 ? 'space' : 'spaces'} on the lot.`;
  }
  if (def.id !== 'salesDesk') return def.description;
  const desk = getStage(stage).desk;
  const cut = Math.round(desk.commission * 100);
  return desk.salaried
    ? `Closes walk-ups you don't grab in time. Salaried, plus ${cut}% of the profit on deals they close.`
    : `Closes walk-ups you don't grab in time. No salary — he takes ${cut}% of the profit on every deal he closes.`;
}

/** Whole dollars with a thousands separator. The upgrade card has no room for cents. */
function moneyish(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

export function upgradeUnlocked(state: Pick<GameState, 'stage'>, def: UpgradeDef): boolean {
  return hasReached(state.stage, def.stage);
}

export function canBuyUpgrade(state: GameState, id: string): boolean {
  const def = getUpgrade(id);
  const lvl = level(state, id);
  if (lvl >= def.maxLevel) return false;
  if (!upgradeUnlocked(state, def)) return false;
  return state.cash >= upgradeCost(def, lvl, state.stage);
}

// ---------------------------------------------------------------- derived stats

/**
 * How many cars the player can hold at once.
 *
 * Base comes from the store, extra rows come from the capacity upgrade that
 * store uses. Property carries across a move, so a maxed-out `lot` keeps paying
 * at every stage above the one it was bought at — which is the intended reward
 * for buying space early.
 */
export function carCapacity(state: GameState): number {
  const stage = getStage(state.stage);
  return stage.baseCarCapacity + level(state, stage.capacityUpgradeId) * stage.capacityPerLevel;
}

// Sourcing throughput moved to `sourcingModsFor` in skills.ts, where the scout
// upgrade and the Buying skill are combined. Resolving it here would need this
// module to import skills.ts, which already imports this one.

/**
 * Active notes the desk will carry. A hard ceiling on the book — see
 * `bookRoom()` in notes.ts, which is what the finance desk actually asks.
 */
export function collectionsCapacity(state: Pick<GameState, 'upgrades'>): number {
  return (
    BALANCE.baseCollectionsCapacity + level(state, 'collections') * BALANCE.collectionsCapacityPerLevel
  );
}

export function offlineCapMs(state: GameState): number {
  return BALANCE.offlineCapMs + level(state, 'nightManager') * BALANCE.offlineCapPerNightManagerMs;
}

export function repoFee(state: GameState): number {
  return Math.round(BALANCE.repoFee * Math.pow(0.75, level(state, 'repoMan')));
}

/**
 * Condition a repossessed car loses.
 *
 * Two independent terms: the recovery agent you pay for, and how long you let
 * the borrower ride before pulling the trigger. Same shape as everywhere else
 * that upgrades and player decisions touch one axis — they multiply rather than
 * split it.
 */
export function repoConditionLoss(state: GameState): number {
  return (
    BALANCE.repoConditionLoss *
    repoDamageMultiplier(repoThreshold(state)) *
    Math.pow(0.7, level(state, 'repoMan'))
  );
}
