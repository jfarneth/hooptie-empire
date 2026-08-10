import { buyListing } from './actions';
import { BALANCE } from './balance';
import { reconCost, reconDurationMs, reconLift } from './cars';
import {
  appraisalBand,
  estimatedCondition,
  estimatedRetail,
  estimatedWholesale,
  pessimisticWholesale,
} from './appraisal';
import { retailValue, wholesaleValue } from './economy';
import { deskCounter, resolveCounter } from './haggle';
import { createRng } from './rng';
import { advance, cloneState, createInitialState } from './engine';
import {
  SKILL_IDS,
  appraisalSigma,
  blankSkills,
  buyXp,
  deskCounterFraction,
  haggleSkillFor,
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
  sourcingModsFor,
  repairXp,
  sellXp,
  skillLevel,
  skillProgress,
  tellJitter,
  walkChanceMultiplier,
  xpToNext,
} from './skills';
import type { Car, GameState, Listing, Negotiation, SkillId } from './types';

/**
 * Carries a stage as well as skills. `appraisalSigma` multiplies the skill's
 * error by the stage's, and 'curbstone' is the 1.0 case — the franchise stages
 * zero it out entirely, which is a stage fact rather than a skill fact and is
 * tested in stages.test.ts.
 */
function stateAt(levels: Partial<Record<SkillId, number>>): Pick<GameState, 'skills' | 'stage'> {
  const skills = blankSkills();
  for (const id of SKILL_IDS) skills[id].level = levels[id] ?? 1;
  return { skills, stage: 'curbstone' };
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

  it('leaves sourcing throughput untouched', () => {
    expect(listingIntervalMultiplier(s)).toBe(1);
    expect(listingSlotBonus(s)).toBe(0);
  });

  /**
   * Appraisal is the one deliberate exception to the neutrality rule.
   *
   * Every other effect starts at the constant the pre-skills game used. Buying
   * cannot: before this there was no error at all, because the feed printed
   * exact condition. Level 1 is a rookie who misjudges cars, and that is the
   * point of the whole phase rather than a regression.
   */
  it('does NOT leave appraisal untouched, on purpose', () => {
    expect(appraisalSigma(s)).toBe(BALANCE.skills.buy.appraisalSigma.at1);
    expect(appraisalSigma(s)).toBeGreaterThan(0);
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

});

describe('Buying', () => {
  const maxLevel = BALANCE.skills.maxLevel;

  it('sharpens the eye as it levels', () => {
    const novice = stateAt({ buy: 1 });
    const expert = stateAt({ buy: maxLevel });
    expect(appraisalSigma(expert)).toBeLessThan(appraisalSigma(novice));
  });

  /**
   * Buying buys judgement, not throughput. An interval term was measured at
   * +15% end cash on its own and cut; `scout` is how a player buys a faster
   * feed. If this starts failing, someone has quietly re-added an economy-wide
   * multiplier to a skill that is supposed to sharpen a decision.
   */
  it('does not accelerate the feed at any level', () => {
    for (let lvl = 1; lvl <= maxLevel; lvl++) {
      expect(listingIntervalMultiplier(stateAt({ buy: lvl }))).toBe(1);
    }
  });

  it('hands out whole slots, never a fraction of one', () => {
    for (let lvl = 1; lvl <= maxLevel; lvl++) {
      expect(Number.isInteger(listingSlotBonus(stateAt({ buy: lvl })))).toBe(true);
    }
  });

  /**
   * Buying grants no throughput at all right now — see balance.ts. One extra
   * feed slot measured +21% end cash, which is too much for a small perk on an
   * economy already running hot. If this starts failing, someone re-enabled it;
   * re-run the harness before believing it is free.
   */
  it('grants no feed throughput at any level', () => {
    for (let lvl = 1; lvl <= maxLevel; lvl++) {
      expect(listingSlotBonus(stateAt({ buy: lvl }))).toBe(0);
      expect(listingIntervalMultiplier(stateAt({ buy: lvl }))).toBe(1);
    }
  });

  /**
   * The rounding still has to be right for when it is switched back on. Floored,
   * a 0→1 curve only reaches 1 at exactly max level — dead for nine of the ten
   * levels it spans, which is the bug this replaced.
   */
  it('would step the slot bonus partway up rather than only at the cap', () => {
    const spec = { at1: 0, atMax: 1, ease: 0.7 };
    expect(Math.round(effect(spec, 4))).toBe(0);
    expect(Math.round(effect(spec, 5))).toBe(1);
    expect(Math.floor(effect(spec, 9))).toBe(0); // the old behaviour, for contrast
  });

  it('stacks with the scout upgrade rather than replacing it', () => {
    const skills = stateAt({ buy: maxLevel }).skills;
    const bare = sourcingModsFor({ skills, upgrades: {}, stage: 'curbstone' });
    const scouted = sourcingModsFor({ skills, upgrades: { scout: 2 }, stage: 'curbstone' });

    expect(scouted.slots).toBe(bare.slots + 2 * BALANCE.listingSlotsPerScoutLevel);
    // Contacts and practice stack on the interval, the same way the mechanic
    // upgrade stacks with Wrenching. Dropping either term is a silent nerf.
    expect(scouted.intervalMs).toBeLessThan(bare.intervalMs);
    expect(scouted.intervalMs).toBeCloseTo(
      bare.intervalMs * Math.pow(BALANCE.listingIntervalPerScoutLevel, 2),
      6,
    );
  });
});

describe('appraisal', () => {
  const listingWith = (condition: number, noise: number): Listing => {
    const base = createInitialState(11, 0).listings[0];
    return { ...base, car: { ...base.car, condition }, appraisalNoise: noise };
  };

  it('tells the exact truth when there is no error left', () => {
    const l = listingWith(0.5, 2.4);
    expect(estimatedCondition(l, 0)).toBeCloseTo(0.5, 10);
    expect(estimatedRetail(l, 0)).toBe(retailValue(l.car));
  });

  it('moves the estimate in the direction of the draw', () => {
    const flattering = listingWith(0.5, 1.5);
    const damning = listingWith(0.5, -1.5);
    expect(estimatedCondition(flattering, 0.18)).toBeGreaterThan(0.5);
    expect(estimatedCondition(damning, 0.18)).toBeLessThan(0.5);
  });

  it('never reports a condition outside the possible range', () => {
    for (const noise of [-3, -1, 0, 1, 3]) {
      for (const condition of [0.02, 0.5, 0.99]) {
        const est = estimatedCondition(listingWith(condition, noise), 0.4);
        expect(est).toBeGreaterThanOrEqual(0);
        expect(est).toBeLessThanOrEqual(1);
      }
    }
  });

  /**
   * The band the UI quotes has to be the real error distribution, or the game
   * is lying about how much it does not know. The noise draw is what carries
   * that: `normalish(0, 3)` has sd 1, so error sd lands on σ.
   */
  it('draws noise with unit standard deviation', () => {
    let s = createInitialState(4242, 0);
    const draws: number[] = [];
    for (let i = 0; i < 60; i++) {
      s = advance(s, 60_000);
      for (const l of s.listings) draws.push(l.appraisalNoise);
    }
    expect(draws.length).toBeGreaterThan(50);

    const mean = draws.reduce((a, b) => a + b, 0) / draws.length;
    const sd = Math.sqrt(draws.reduce((a, b) => a + (b - mean) ** 2, 0) / draws.length);
    expect(Math.abs(mean)).toBeLessThan(0.3);
    expect(sd).toBeGreaterThan(0.7);
    expect(sd).toBeLessThan(1.3);
  });

  it('brackets the estimate with a band that collapses as the eye sharpens', () => {
    const l = listingWith(0.5, 0.8);
    const wide = appraisalBand(l, 0.18);
    const tight = appraisalBand(l, 0.03);

    expect(wide.low).toBeLessThan(wide.high);
    expect(wide.high - wide.low).toBeGreaterThan(tight.high - tight.low);
    expect(appraisalBand(l, 0).exact).toBe(true);
    expect(wide.exact).toBe(false);
  });

  /**
   * The retainer buyer must not be omniscient.
   *
   * It used to compare against `wholesaleValue(listing.car)` — ground truth —
   * which after this phase would make automating strictly better than looking
   * at the feed yourself, because the hired help could see what the owner
   * could not.
   */
  it('will not let the retainer buyer take a deal the player cannot see', () => {
    const base = createInitialState(77, 0);
    const car = { ...base.listings[0].car, condition: 0.5 };
    const truth = wholesaleValue(car);

    const s: GameState = {
      ...cloneState(base),
      cash: 500_000,
      upgrades: { autoBuy: 1 },
      // Priced exactly at what it is really worth: a bargain to someone who
      // knows the truth, a coin flip to someone appraising it.
      listings: [{ ...base.listings[0], car, price: truth, appraisalNoise: 0 }],
      cars: [],
    };

    const after = advance(s, 2_000);
    expect(after.cars.length).toBe(0);
    expect(after.listings.length).toBe(1);

    // Cheap enough to survive being wrong, and it takes it.
    const obvious: GameState = {
      ...s,
      listings: [{ ...s.listings[0], price: Math.round(truth * 0.5) }],
    };
    expect(advance(obvious, 2_000).cars.length).toBe(1);
  });

  it('prices the pessimistic read at or below the midpoint', () => {
    for (const noise of [-2, 0, 2]) {
      const l = listingWith(0.5, noise);
      expect(pessimisticWholesale(l, 0.18)).toBeLessThanOrEqual(estimatedWholesale(l, 0.18));
    }
  });
});

describe('Closing', () => {
  const maxLevel = BALANCE.skills.maxLevel;

  it('sharpens the read and softens the walk as it levels', () => {
    const novice = stateAt({ sell: 1 });
    const expert = stateAt({ sell: maxLevel });

    expect(tellJitter(expert)).toBeLessThan(tellJitter(novice));
    expect(walkChanceMultiplier(expert)).toBeLessThan(walkChanceMultiplier(novice));
    expect(negotiationRoomMean(expert)).toBeGreaterThan(negotiationRoomMean(novice));
    expect(deskCounterFraction(expert)).toBeGreaterThan(deskCounterFraction(novice));
  });

  it('hands over the third counter exactly at its level, not before', () => {
    const at = BALANCE.skills.sell.extraCounterAt;
    expect(at).toBeGreaterThan(1);
    expect(maxPlayerCounters(stateAt({ sell: at - 1 }))).toBe(BALANCE.negotiation.maxPlayerCounters);
    expect(maxPlayerCounters(stateAt({ sell: at }))).toBe(BALANCE.negotiation.maxPlayerCounters + 1);
    expect(maxPlayerCounters(stateAt({ sell: maxLevel }))).toBe(
      BALANCE.negotiation.maxPlayerCounters + 1,
    );
  });

  /**
   * The effects have to reach the negotiation itself. Asserting on the
   * accessors alone would pass just as happily if haggle.ts ignored the skill.
   */
  it('reaches the desk and the buyer', () => {
    const novice = haggleSkillFor(stateAt({ sell: 1 }));
    const expert = haggleSkillFor(stateAt({ sell: maxLevel }));

    const neg: Negotiation = {
      anchor: 8_000,
      openingOffer: 6_000,
      currentOffer: 6_000,
      reservation: 7_000,
      room: 0.5,
      aggression: 0.5,
      countersMade: 0,
      lastCounter: null,
      status: 'open',
      tellIndex: 2,
    };

    // A better closer opens higher.
    expect(deskCounter(neg, expert)).toBeGreaterThan(deskCounter(neg, novice));

    // And loses fewer of them to an identical overreach.
    const walks = (skill: typeof novice) => {
      let lost = 0;
      for (let seed = 0; seed < 400; seed++) {
        const rng = createRng(seed);
        const live = { ...neg };
        if (resolveCounter(rng, live, 7_600, skill).kind === 'walked') lost += 1;
      }
      return lost;
    };
    expect(walks(expert)).toBeLessThan(walks(novice));
  });

  it('leaves the counter budget alone below the unlock level', () => {
    const early = haggleSkillFor(stateAt({ sell: 1 }));
    expect(early.maxCounters).toBe(BALANCE.negotiation.maxPlayerCounters);
    expect(early.roomMean).toBe(BALANCE.negotiation.roomMean);
    expect(early.deskCounterFraction).toBe(BALANCE.negotiation.deskCounterFraction);
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
