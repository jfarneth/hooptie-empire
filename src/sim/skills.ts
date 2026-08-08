import { BALANCE } from './balance';
import { clamp } from './economy';
import { level } from './upgrades';
import type { ReconMods } from './cars';
import type { HaggleSkill } from './haggle';
import type { GameState, Skill, SkillId } from './types';

/**
 * Player proficiencies: Buying, Closing, Wrenching.
 *
 * The split from upgrades is the point. Upgrades are capacity bought with cash;
 * skills are quality earned by doing the work. Where both touch the same axis
 * they are given different halves of it rather than stacked — `scout` buys how
 * many listings you can hold, Buying earns how fast you turn them up.
 *
 * This module mirrors upgrades.ts: definitions, progression, and derived-stat
 * accessors. It reads BALANCE and never writes it, and it deliberately does not
 * import the engine — level-up *events* are the caller's job, which is what
 * keeps this free of a cycle with engine.ts.
 */

export const SKILL_IDS = ['buy', 'sell', 'repair'] as const;

export interface SkillDef {
  id: SkillId;
  name: string;
  /** What levelling it is meant to feel like. Shown on the card. */
  description: string;
}

export const SKILLS: readonly SkillDef[] = [
  {
    id: 'buy',
    name: 'Buying',
    description: 'Turning up cars, and knowing what you are looking at.',
  },
  {
    id: 'sell',
    name: 'Closing',
    description: 'Reading a buyer, and keeping them in the chair.',
  },
  {
    id: 'repair',
    name: 'Wrenching',
    description: 'Getting more out of the shop for less.',
  },
];

const BY_ID = new Map(SKILLS.map((s) => [s.id, s]));

export function getSkill(id: SkillId): SkillDef {
  const def = BY_ID.get(id);
  if (!def) throw new Error(`Unknown skill: ${id}`);
  return def;
}

/** A fresh set of skills, all at level 1. */
export function blankSkills(): Record<SkillId, Skill> {
  return {
    buy: { level: 1, xp: 0 },
    sell: { level: 1, xp: 0 },
    repair: { level: 1, xp: 0 },
  };
}

/**
 * Clone the skill record entry by entry.
 *
 * Same contract as everything else in cloneState: a shared nested object would
 * let a mutation leak backwards through history and corrupt offline catch-up.
 * The `??` is a guard against a save that predates a skill being added.
 */
export function cloneSkills(skills: Record<SkillId, Skill>): Record<SkillId, Skill> {
  const out = {} as Record<SkillId, Skill>;
  for (const id of SKILL_IDS) {
    const skill = skills?.[id];
    out[id] = skill ? { ...skill } : { level: 1, xp: 0 };
  }
  return out;
}

export function skillLevel(state: Pick<GameState, 'skills'>, id: SkillId): number {
  return state.skills?.[id]?.level ?? 1;
}

export function isMaxed(state: Pick<GameState, 'skills'>, id: SkillId): boolean {
  return skillLevel(state, id) >= BALANCE.skills.maxLevel;
}

/** XP needed to leave `level`. Infinite at the cap so nothing accrues past it. */
export function xpToNext(level: number): number {
  const { xpBase, xpGrowth, maxLevel } = BALANCE.skills;
  if (level >= maxLevel) return Infinity;
  return Math.round(xpBase * Math.pow(xpGrowth, level - 1));
}

/** Progress toward the next level, for the UI. */
export function skillProgress(
  state: Pick<GameState, 'skills'>,
  id: SkillId,
): { level: number; xp: number; needed: number; ratio: number } {
  const level = skillLevel(state, id);
  const xp = state.skills?.[id]?.xp ?? 0;
  const needed = xpToNext(level);
  return {
    level,
    xp,
    needed,
    ratio: Number.isFinite(needed) ? clamp(xp / needed, 0, 1) : 1,
  };
}

/**
 * Add XP and apply any level-ups. Mutates — callers own a cloned state, the
 * same contract the rest of the engine runs on.
 *
 * Returns the number of levels gained so the caller can log an event. This
 * module cannot log one itself without importing the engine, and the engine
 * imports this.
 */
export function grantXp(state: Pick<GameState, 'skills'>, id: SkillId, amount: number): number {
  const skill = state.skills?.[id];
  if (!skill || !(amount > 0)) return 0;
  if (skill.level >= BALANCE.skills.maxLevel) return 0;

  skill.xp += amount;

  let gained = 0;
  while (skill.level < BALANCE.skills.maxLevel && skill.xp >= xpToNext(skill.level)) {
    skill.xp -= xpToNext(skill.level);
    skill.level += 1;
    gained += 1;
  }

  // At the cap there is nothing left to progress toward; banking XP against a
  // level that will never arrive would just render as a bar stuck at full.
  if (skill.level >= BALANCE.skills.maxLevel) skill.xp = 0;

  return gained;
}

// ------------------------------------------------------------------ XP awards

const XP = BALANCE.skills.xp;

/** Buying a car. Square root so one luxury unit is not a shortcut. */
export function buyXp(price: number): number {
  return Math.max(1, Math.round(XP.buyPerCar * Math.sqrt(Math.max(0, price) / XP.buyPriceRef)));
}

/** Closing a cash deal. Haggling for it is worth more than taking the ask. */
export function sellXp(price: number, countersMade: number): number {
  const base = XP.sellPerDeal * Math.sqrt(Math.max(0, price) / XP.sellPriceRef);
  return Math.max(1, Math.round(base + (countersMade > 0 ? XP.sellCounterBonus : 0)));
}

export function walkawayXp(): number {
  return XP.sellWalkaway;
}

/** Finishing recon. Paid per condition point, not per dollar. */
export function repairXp(conditionLift: number): number {
  return Math.max(1, Math.round(XP.repairPerPoint * Math.max(0, conditionLift)));
}

// --------------------------------------------------------------- derived stats

export interface EffectSpec {
  at1: number;
  atMax: number;
  ease: number;
}

/**
 * Interpolate an effect across the level range.
 *
 * Exact at both ends by construction: `effect(spec, 1) === spec.at1` and
 * `effect(spec, maxLevel) === spec.atMax`. The first of those is the neutrality
 * guarantee the whole phase rests on.
 */
export function effect(spec: EffectSpec, level: number): number {
  const { maxLevel } = BALANCE.skills;
  if (maxLevel <= 1) return spec.at1;

  const p = clamp((level - 1) / (maxLevel - 1), 0, 1);

  // Returned rather than interpolated. `at1 + (atMax - at1) * 1` is not exactly
  // `atMax` in floating point, and a capped skill landing a hair off its stated
  // value is the kind of thing that turns into a confusing balance report later.
  if (p <= 0) return spec.at1;
  if (p >= 1) return spec.atMax;

  return spec.at1 + (spec.atMax - spec.at1) * Math.pow(p, spec.ease);
}

function buyEffect(state: Pick<GameState, 'skills'>, spec: EffectSpec): number {
  return effect(spec, skillLevel(state, 'buy'));
}

function sellEffect(state: Pick<GameState, 'skills'>, spec: EffectSpec): number {
  return effect(spec, skillLevel(state, 'sell'));
}

function repairEffect(state: Pick<GameState, 'skills'>, spec: EffectSpec): number {
  return effect(spec, skillLevel(state, 'repair'));
}

/** 1σ of appraisal error in condition points. 0 means the feed tells the truth. */
export function appraisalSigma(state: Pick<GameState, 'skills'>): number {
  return buyEffect(state, BALANCE.skills.buy.appraisalSigma);
}

/** Multiplier on the gap between new listings. Lower is faster. */
export function listingIntervalMultiplier(state: Pick<GameState, 'skills'>): number {
  return buyEffect(state, BALANCE.skills.buy.listingInterval);
}

/** Extra slots on the sourcing feed, on top of what `scout` bought. */
export function listingSlotBonus(state: Pick<GameState, 'skills'>): number {
  return Math.floor(buyEffect(state, BALANCE.skills.buy.listingSlots));
}

/** Odds a buyer's tell is off by a band. Lower means a read you can trust. */
export function tellJitter(state: Pick<GameState, 'skills'>): number {
  return sellEffect(state, BALANCE.skills.sell.tellJitter);
}

export function walkChanceMultiplier(state: Pick<GameState, 'skills'>): number {
  return sellEffect(state, BALANCE.skills.sell.walkChanceMult);
}

/** Where a buyer's hidden reservation sits between their offer and the ask. */
export function negotiationRoomMean(state: Pick<GameState, 'skills'>): number {
  return sellEffect(state, BALANCE.skills.sell.roomMean);
}

export function deskCounterFraction(state: Pick<GameState, 'skills'>): number {
  return sellEffect(state, BALANCE.skills.sell.deskCounterFrac);
}

/** Counters the player gets before a buyer stops talking. */
export function maxPlayerCounters(state: Pick<GameState, 'skills'>): number {
  const { extraCounterAt } = BALANCE.skills.sell;
  const earned = extraCounterAt > 0 && skillLevel(state, 'sell') >= extraCounterAt ? 1 : 0;
  return BALANCE.negotiation.maxPlayerCounters + earned;
}

export function reconCostMultiplier(state: Pick<GameState, 'skills'>): number {
  return repairEffect(state, BALANCE.skills.repair.costMult);
}

export function reconSpeedMultiplier(state: Pick<GameState, 'skills'>): number {
  return repairEffect(state, BALANCE.skills.repair.speedMult);
}

/** Ceiling on how much condition one recon job can add. */
export function reconMaxLift(state: Pick<GameState, 'skills'>): number {
  return repairEffect(state, BALANCE.skills.repair.maxLift);
}

/**
 * Everything the shop's capability depends on, resolved into the plain numbers
 * `cars.ts` works in.
 *
 * The mechanic upgrade and the Wrenching skill are separate multiplicative
 * terms on the same axis — cash buys a faster bay, practice makes the work
 * itself quicker — and they are combined here so no call site has to remember
 * to apply both.
 */
/** How the sourcing feed behaves for this player. */
export interface SourcingMods {
  /** Listings that can sit on the feed at once. */
  slots: number;
  /** Mean gap between new listings appearing. */
  intervalMs: number;
  /** 1σ of appraisal error, in condition points. */
  sigma: number;
}

/**
 * The feed, resolved from both what was bought and what was learned.
 *
 * `scout` and Buying stack on both throughput axes, the same way the mechanic
 * upgrade and Wrenching stack on recon speed: cash buys contacts, practice buys
 * an eye and a faster turn of the feed. An earlier cut gave them one axis each
 * on the theory that sharing one was a double dip — but scout's interval term
 * is worth 2.7x at max level and the skill's is worth 1.3x, so "no double dip"
 * amounted to a silent 2.7x nerf to an upgrade players had already bought.
 * Multiplicative terms on a shared axis are fine; unannounced nerfs are not.
 */
export function sourcingModsFor(state: Pick<GameState, 'skills' | 'upgrades'>): SourcingMods {
  const scout = level(state, 'scout');
  return {
    slots: BALANCE.baseListingSlots + scout * BALANCE.listingSlotsPerScoutLevel + listingSlotBonus(state),
    intervalMs:
      BALANCE.listingIntervalMs *
      Math.pow(BALANCE.listingIntervalPerScoutLevel, scout) *
      listingIntervalMultiplier(state),
    sigma: appraisalSigma(state),
  };
}

/**
 * Everything the person at the desk brings to a negotiation, in the plain
 * numbers `haggle.ts` works in.
 */
export function haggleSkillFor(state: Pick<GameState, 'skills'>): HaggleSkill {
  return {
    roomMean: negotiationRoomMean(state),
    tellJitter: tellJitter(state),
    walkChanceMult: walkChanceMultiplier(state),
    maxCounters: maxPlayerCounters(state),
    deskCounterFraction: deskCounterFraction(state),
  };
}

export function reconModsFor(state: Pick<GameState, 'skills' | 'upgrades'>): ReconMods {
  const mechanic = Math.pow(BALANCE.reconMsPerMechanicLevel, level(state, 'mechanic'));
  return {
    maxLift: reconMaxLift(state),
    costMult: reconCostMultiplier(state),
    speedMult: mechanic * reconSpeedMultiplier(state),
  };
}
