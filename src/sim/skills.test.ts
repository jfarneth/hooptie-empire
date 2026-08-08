import { buyListing } from './actions';
import { BALANCE } from './balance';
import { reconCost, reconDurationMs, reconLift } from './cars';
import { advance, cloneState, createInitialState } from './engine';
import {
  SKILL_IDS,
  appraisalSigma,
  blankSkills,
  buyXp,
  deskCounterFraction,
  effect,
  grantXp,
  listingIntervalMultiplier,
  listingSlotBonus,
  maxPlayerCounters,
  negotiationRoomMean,
  reconCostMultiplier,
  reconMaxLift,
  reconModsFor,
  reconSpeedMultiplier,
  repairXp,
  sellXp,
  skillLevel,
  skillProgress,
  tellJitter,
  walkChanceMultiplier,
  xpToNext,
} from './skills';
import type { Car, GameState, SkillId } from './types';

function stateAt(levels: Partial<Record<SkillId, number>>): Pick<GameState, 'skills'> {
  const skills = blankSkills();
  for (const id of SKILL_IDS) skills[id].level = levels[id] ?? 1;
  return { skills };
}

/**
 * The gate this whole phase rests on.
 *
 * Skills ship before the systems that read them, which is only safe if a
 * level-1 player is playing precisely the game that existed before. Every
 * accessor is checked against the constant it will eventually replace.
 */
describe('level 1 reproduces the pre-skills build', () => {
  const s = stateAt({});

  it('leaves the sourcing feed untouched', () => {
    expect(appraisalSigma(s)).toBe(0);
    expect(listingIntervalMultiplier(s)).toBe(1);
    expect(listingSlotBonus(s)).toBe(0);
  });

  it('leaves negotiation untouched', () => {
    expect(tellJitter(s)).toBe(0.3);
    expect(walkChanceMultiplier(s)).toBe(1);
    expect(negotiationRoomMean(s)).toBe(BALANCE.negotiation.roomMean);
    expect(deskCounterFraction(s)).toBe(BALANCE.negotiation.deskCounterFraction);
    expect(maxPlayerCounters(s)).toBe(BALANCE.negotiation.maxPlayerCounters);
  });

  it('leaves the shop untouched', () => {
    expect(reconCostMultiplier(s)).toBe(1);
    expect(reconSpeedMultiplier(s)).toBe(1);
    expect(reconMaxLift(s)).toBe(BALANCE.reconMaxLift);
  });

  it('holds at every level for the skills not yet wired up', () => {
    // Buying and Closing are still inert: until their phase gives them a
    // different atMax, no level may change any number they own.
    for (let lvl = 1; lvl <= BALANCE.skills.maxLevel; lvl++) {
      const at = stateAt({ buy: lvl, sell: lvl });
      expect(appraisalSigma(at)).toBe(appraisalSigma(s));
      expect(listingIntervalMultiplier(at)).toBe(listingIntervalMultiplier(s));
      expect(listingSlotBonus(at)).toBe(listingSlotBonus(s));
      expect(tellJitter(at)).toBe(tellJitter(s));
      expect(walkChanceMultiplier(at)).toBe(walkChanceMultiplier(s));
      expect(maxPlayerCounters(at)).toBe(maxPlayerCounters(s));
    }
  });
});

describe('Wrenching', () => {
  const maxLevel = BALANCE.skills.maxLevel;

  it('makes the work cheaper, faster and deeper as it levels', () => {
    const novice = stateAt({ repair: 1 });
    const expert = stateAt({ repair: maxLevel });

    expect(reconCostMultiplier(expert)).toBeLessThan(reconCostMultiplier(novice));
    expect(reconSpeedMultiplier(expert)).toBeLessThan(reconSpeedMultiplier(novice));
    expect(reconMaxLift(expert)).toBeGreaterThan(reconMaxLift(novice));
  });

  it('moves in one direction the whole way up', () => {
    let cost = reconCostMultiplier(stateAt({ repair: 1 }));
    let lift = reconMaxLift(stateAt({ repair: 1 }));
    for (let lvl = 2; lvl <= maxLevel; lvl++) {
      const at = stateAt({ repair: lvl });
      expect(reconCostMultiplier(at)).toBeLessThanOrEqual(cost);
      expect(reconMaxLift(at)).toBeGreaterThanOrEqual(lift);
      cost = reconCostMultiplier(at);
      lift = reconMaxLift(at);
    }
  });

  /**
   * The effects have to actually reach the shop. Asserting on the multipliers
   * alone would pass just as happily if cars.ts ignored the mods entirely.
   */
  it('reaches the actual recon job', () => {
    const car: Car = {
      ...createInitialState(9, 0).listings[0].car,
      condition: 0.3,
      status: 'ready',
    };

    const novice = reconModsFor({ skills: stateAt({ repair: 1 }).skills, upgrades: {} });
    const expert = reconModsFor({ skills: stateAt({ repair: maxLevel }).skills, upgrades: {} });

    expect(reconLift(car, expert)).toBeGreaterThan(reconLift(car, novice));
    expect(reconDurationMs(car, expert)).toBeLessThan(reconDurationMs(car, novice));
    // A bigger job on the same car, and still cheaper per point of condition.
    expect(reconCost(car, expert) / reconLift(car, expert)).toBeLessThan(
      reconCost(car, novice) / reconLift(car, novice),
    );
  });

  it('stacks with the mechanic upgrade rather than replacing it', () => {
    const skills = stateAt({ repair: maxLevel }).skills;
    const unstaffed = reconModsFor({ skills, upgrades: {} });
    const staffed = reconModsFor({ skills, upgrades: { mechanic: 3 } });

    expect(staffed.speedMult).toBeLessThan(unstaffed.speedMult);
    // Cash bought the bay, practice made the work quicker; both terms survive.
    expect(staffed.speedMult).toBeCloseTo(
      unstaffed.speedMult * Math.pow(BALANCE.reconMsPerMechanicLevel, 3),
      10,
    );
  });
});

describe('effect()', () => {
  const spec = { at1: 0.2, atMax: 0.05, ease: 0.7 };

  it('is exact at both ends regardless of easing', () => {
    expect(effect(spec, 1)).toBe(spec.at1);
    expect(effect(spec, BALANCE.skills.maxLevel)).toBe(spec.atMax);
  });

  it('moves monotonically between them', () => {
    let previous = effect(spec, 1);
    for (let lvl = 2; lvl <= BALANCE.skills.maxLevel; lvl++) {
      const value = effect(spec, lvl);
      expect(value).toBeLessThanOrEqual(previous);
      previous = value;
    }
  });

  it('clamps rather than extrapolating past the cap', () => {
    expect(effect(spec, BALANCE.skills.maxLevel + 5)).toBe(spec.atMax);
    expect(effect(spec, 0)).toBe(spec.at1);
  });

  it('front-loads the gain when ease is below 1', () => {
    const midpoint = Math.ceil((1 + BALANCE.skills.maxLevel) / 2);
    const halfway = spec.at1 + (spec.atMax - spec.at1) * 0.5;
    // Lower is better for this spec, so front-loaded means already past halfway.
    expect(effect(spec, midpoint)).toBeLessThan(halfway);
  });
});

describe('xp and levelling', () => {
  it('costs more per level', () => {
    for (let lvl = 1; lvl < BALANCE.skills.maxLevel - 1; lvl++) {
      expect(xpToNext(lvl + 1)).toBeGreaterThan(xpToNext(lvl));
    }
  });

  it('levels up and carries the remainder forward', () => {
    const s = stateAt({});
    const needed = xpToNext(1);
    expect(grantXp(s, 'buy', needed + 10)).toBe(1);
    expect(skillLevel(s, 'buy')).toBe(2);
    expect(s.skills.buy.xp).toBe(10);
  });

  it('handles several levels from one award', () => {
    const s = stateAt({});
    const gained = grantXp(s, 'buy', xpToNext(1) + xpToNext(2) + xpToNext(3));
    expect(gained).toBe(3);
    expect(skillLevel(s, 'buy')).toBe(4);
  });

  it('stops at the cap and banks nothing against a level that will not come', () => {
    const s = stateAt({ sell: BALANCE.skills.maxLevel });
    expect(grantXp(s, 'sell', 100_000)).toBe(0);
    expect(skillLevel(s, 'sell')).toBe(BALANCE.skills.maxLevel);
    expect(s.skills.sell.xp).toBe(0);
    expect(skillProgress(s, 'sell').ratio).toBe(1);
  });

  it('ignores non-positive awards', () => {
    const s = stateAt({});
    expect(grantXp(s, 'buy', 0)).toBe(0);
    expect(grantXp(s, 'buy', -50)).toBe(0);
    expect(s.skills.buy.xp).toBe(0);
  });

  it('only touches the skill it was given', () => {
    const s = stateAt({});
    grantXp(s, 'repair', xpToNext(1));
    expect(skillLevel(s, 'repair')).toBe(2);
    expect(skillLevel(s, 'buy')).toBe(1);
    expect(skillLevel(s, 'sell')).toBe(1);
  });
});

describe('xp awards', () => {
  it('scales sub-linearly with price, so one expensive car is no shortcut', () => {
    const cheap = buyXp(1_500);
    const tenfold = buyXp(15_000);
    expect(tenfold).toBeGreaterThan(cheap);
    expect(tenfold).toBeLessThan(cheap * 10);
  });

  it('always pays something, even on a giveaway', () => {
    expect(buyXp(0)).toBeGreaterThan(0);
    expect(sellXp(0, 0)).toBeGreaterThan(0);
    expect(repairXp(0)).toBeGreaterThan(0);
  });

  it('pays more for a deal that was actually haggled', () => {
    expect(sellXp(4_000, 1)).toBeGreaterThan(sellXp(4_000, 0));
  });

  it('pays the shop per condition point, not per dollar', () => {
    expect(repairXp(0.3)).toBeGreaterThan(repairXp(0.1));
  });
});

describe('skills in game state', () => {
  it('starts a new game at level 1 across the board', () => {
    const s = createInitialState(1, 0);
    for (const id of SKILL_IDS) {
      expect(s.skills[id].level).toBe(1);
      expect(s.skills[id].xp).toBe(0);
    }
  });

  it('is deep-cloned, so history cannot be mutated backwards', () => {
    const s = createInitialState(2, 0);
    const copy = cloneState(s);
    copy.skills.buy.xp += 500;
    copy.skills.buy.level = 7;
    expect(s.skills.buy.xp).toBe(0);
    expect(s.skills.buy.level).toBe(1);
    expect(copy.skills).not.toBe(s.skills);
    expect(copy.skills.buy).not.toBe(s.skills.buy);
  });

  it('grants buying XP the moment a car is bought', () => {
    const s0 = createInitialState(4242, 0);
    const listing = s0.listings[0];
    const s = buyListing(s0, listing.id);
    expect(s.skills.buy.xp).toBe(buyXp(listing.price));
  });

  /**
   * The regression this whole placement decision exists to prevent.
   *
   * Nothing below goes through actions.ts: the standing shop order, the
   * retainer buyer and the sales desk all call engine internals directly. Award
   * XP in the player-facing wrappers instead and this lot runs for forty-five
   * minutes, sells a few dozen cars, and learns nothing.
   */
  it('earns XP on the automated path, where the wrappers are never called', () => {
    const s0 = createInitialState(4242, 0);
    s0.upgrades = { autoBuy: 1, autoRecon: 1, autoList: 1, salesDesk: 1, advertising: 2 };
    s0.dealPolicy = 'cash';
    s0.cash = 40_000;

    const s = advance(s0, 45 * 60 * 1000);

    expect(s.stats.carsSold).toBeGreaterThan(0);
    for (const id of SKILL_IDS) expect(s.skills[id].level).toBeGreaterThan(1);
    expect(s.events.some((e) => e.kind === 'skill-up')).toBe(true);
  });
});
