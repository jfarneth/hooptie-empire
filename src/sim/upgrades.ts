import { BALANCE } from './balance';
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
    stage: 'curbstoner',
    maxLevel: 3,
    baseCost: 1_400,
    costGrowth: 2.3,
  },
  {
    id: 'scout',
    name: 'Auction contacts',
    description: 'More listings on the feed, and they show up faster.',
    category: 'speed',
    stage: 'curbstoner',
    maxLevel: 4,
    baseCost: 900,
    costGrowth: 2.6,
  },
  {
    id: 'mechanic',
    name: 'Mechanic',
    description: 'Reconditioning finishes faster.',
    category: 'speed',
    stage: 'curbstoner',
    maxLevel: 4,
    baseCost: 1_100,
    costGrowth: 2.5,
  },
  {
    id: 'advertising',
    name: 'Advertising',
    description: 'More buyers come look at what you have listed.',
    category: 'speed',
    stage: 'curbstoner',
    maxLevel: 5,
    baseCost: 1_600,
    costGrowth: 2.4,
  },
  {
    id: 'autoList',
    name: 'Post them yourself',
    description: 'Cars are listed automatically as soon as they are ready.',
    category: 'automation',
    stage: 'curbstoner',
    maxLevel: 1,
    baseCost: 2_200,
    costGrowth: 1,
  },
  {
    id: 'autoRecon',
    name: 'Standing shop order',
    description: 'Cars go straight into recon when you can afford the work.',
    category: 'automation',
    stage: 'curbstoner',
    maxLevel: 1,
    baseCost: 4_500,
    costGrowth: 1,
  },
  {
    id: 'autoBuy',
    name: 'Buyer on retainer',
    description: 'Any listing priced under wholesale gets bought for you.',
    category: 'automation',
    stage: 'curbstoner',
    maxLevel: 1,
    baseCost: 9_000,
    costGrowth: 1,
  },
  {
    id: 'salesDesk',
    name: 'Sales manager',
    description: 'Closes walk-ups for you according to a standing policy you set.',
    category: 'automation',
    stage: 'curbstoner',
    maxLevel: 1,
    baseCost: 6_000,
    costGrowth: 1,
  },

  // ---- stage 2 -------------------------------------------------------------
  {
    id: 'lot',
    name: 'Pave another row',
    description: '+4 spaces on the lot.',
    category: 'capacity',
    stage: 'bhph',
    maxLevel: 5,
    baseCost: 8_000,
    costGrowth: 2.1,
  },
  {
    id: 'collections',
    name: 'Collections desk',
    description: 'Service more active notes before delinquency starts climbing.',
    category: 'finance',
    stage: 'bhph',
    maxLevel: 5,
    baseCost: 6_500,
    costGrowth: 2.2,
  },
  {
    id: 'underwriting',
    name: 'Underwriting',
    description: 'Screen applicants harder. Fewer D-tier walk-ins, more B and C.',
    category: 'finance',
    stage: 'bhph',
    maxLevel: 3,
    baseCost: 12_000,
    costGrowth: 2.6,
  },
  {
    id: 'repoMan',
    name: 'Recovery agent on call',
    description: 'Repossessions cost less and bring the car back in better shape.',
    category: 'finance',
    stage: 'bhph',
    maxLevel: 3,
    baseCost: 7_500,
    costGrowth: 2.4,
  },
  {
    id: 'nightManager',
    name: 'Night manager',
    description: '+4 hours of business that keeps running while the app is closed.',
    category: 'automation',
    stage: 'bhph',
    maxLevel: 4,
    baseCost: 15_000,
    costGrowth: 2.2,
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

export function upgradeCost(def: UpgradeDef, currentLevel: number): number {
  return Math.round(def.baseCost * Math.pow(def.costGrowth, currentLevel));
}

export function canBuyUpgrade(state: GameState, id: string): boolean {
  const def = getUpgrade(id);
  const lvl = level(state, id);
  if (lvl >= def.maxLevel) return false;
  if (def.stage === 'bhph' && state.stage !== 'bhph') return false;
  return state.cash >= upgradeCost(def, lvl);
}

// ---------------------------------------------------------------- derived stats

/** How many cars the player can hold at once, driveway or lot depending on stage. */
export function carCapacity(state: GameState): number {
  if (state.stage === 'curbstoner') {
    return BALANCE.drivewayCapacity + level(state, 'driveway') * BALANCE.capacityPerDrivewayLevel;
  }
  return BALANCE.lotCapacity + level(state, 'lot') * BALANCE.capacityPerLotLevel;
}

export function listingSlots(state: GameState): number {
  return BALANCE.baseListingSlots + level(state, 'scout') * BALANCE.listingSlotsPerScoutLevel;
}

export function listingIntervalMs(state: GameState): number {
  return BALANCE.listingIntervalMs * Math.pow(BALANCE.listingIntervalPerScoutLevel, level(state, 'scout'));
}

export function collectionsCapacity(state: GameState): number {
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

export function repoConditionLoss(state: GameState): number {
  return BALANCE.repoConditionLoss * Math.pow(0.7, level(state, 'repoMan'));
}
