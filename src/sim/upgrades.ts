import { BALANCE } from './balance';
import { repoDamageMultiplier, repoThreshold } from './business';
import { getStage, hasReached } from './stages';
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
    id: 'collections',
    name: 'Collections desk',
    description: 'Raises the hard limit on how many contracts you can carry at once.',
    category: 'finance',
    stage: 'smallUsed',
    maxLevel: 5,
    baseCost: 6_500,
    costGrowth: 2.2,
    staff: true,
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
export function upgradeDisplayDescription(def: UpgradeDef, stage: StageId): string {
  if (def.id !== 'salesDesk') return def.description;
  const desk = getStage(stage).desk;
  const cut = Math.round(desk.commission * 100);
  return desk.salaried
    ? `Closes walk-ups you don't grab in time. Salaried, plus ${cut}% of the profit on deals they close.`
    : `Closes walk-ups you don't grab in time. No salary — he takes ${cut}% of the profit on every deal he closes.`;
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
  const perLevel =
    stage.capacityUpgradeId === 'driveway'
      ? BALANCE.capacityPerDrivewayLevel
      : BALANCE.capacityPerLotLevel;
  return stage.baseCarCapacity + level(state, stage.capacityUpgradeId) * perLevel;
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
