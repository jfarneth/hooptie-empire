import { BALANCE } from './balance';
import { repoThreshold } from './business';
import { tierWeights } from './customers';
import { weeklyPayment } from './economy';
import { marketTiers } from './market';
import { activeNotes, expectedCollections, overCapacityFactor } from './notes';
import { prestigeEdge } from './prestige';
import { RARITY_ORDER, rarityAskMult, rarityValueMult } from './rarity';
import { typicalRetailPrice, type StageDef } from './stages';
import { collectionsCapacity, level } from './upgrades';
import type { GameState, Rarity } from './types';

/**
 * WHAT A DEAL AT THIS STORE IS WORTH, AS A DISTRIBUTION.
 *
 * This is the YARDSTICK, not the rules. The sales floors themselves are six
 * hard numbers per store, tabulated in `STAGES[].dealFloors` — see the comment
 * there for why they stopped being derived from this distribution and started
 * being written down. What lives here is everything that has to answer "and how
 * good is that, for this store?": the panel quotes a stop against the store's
 * average deal, the buy slider takes its ends from the ladder and its grain
 * from this spread, the harness prints measured against predicted, and the
 * guard test that keeps the tabulated ladder honest measures it against this.
 *
 * A percentage is the wrong unit for a rule on its own: 20% of the gross is a
 * mediocre car at a curbstone lot and more than a Valmont store can produce on
 * any car it will ever sell. That is why the ladder is per store — the mistake
 * a flat percentage makes is the same one a flat car count makes, wrong at both
 * ends of a 1000x ladder and wrong in a way the player only discovers eight
 * hours later.
 *
 * THE DISTRIBUTION IS DERIVED, NOT TABULATED. Everything below comes out of the
 * two constants that actually define a store's economics — its ask band and how
 * much of a trim grade the seller prices in — so a tuning pass on either moves
 * the yardstick with it and there is no second table to keep in agreement. A
 * tabulated mean would be a dead constant the day after the next retune, and
 * this file has paid for that lesson twice already.
 *
 * THE REFERENCE DEAL IS "BOUGHT HERE, SOLD AT RETAIL". Margin is quoted as a
 * share of the gross, the way a dealer quotes it:
 *
 *     margin = (retail - landed cost) / retail
 *
 * With `V` the car's value in stock trim, `R` its trim multiplier, `C` what the
 * seller charges for that trim, `U` the ask as a share of stock wholesale, `w`
 * wholesale as a share of retail, `e` the prestige buy-side edge and `f` the
 * transporter bill as a share of retail:
 *
 *     retail = R·V,  price = U·C·w·V·e,  margin = 1 - w·e·U·(C/R) - f
 *
 * U and the grade are drawn independently, so the mean and variance of the
 * product are the products of theirs, and margin is linear in it. That is the
 * whole derivation; `marginScale` is those two moments and nothing else.
 *
 * WHAT IS DELIBERATELY NOT IN IT: the sale price. The reference sells at retail
 * because retail is the one price every store agrees on — the player's own ask,
 * the haggle and the finance window all move a specific deal off it in both
 * directions. That is what leaves room above +3σ for a genuinely killer deal
 * (a rare trim bought at the bottom of the band, or a car somebody pays over
 * sticker for) rather than making the top of the slider a wall.
 */

export interface MarginScale {
  /** Expected margin on a car sourced here and sold at retail, share of gross. */
  mean: number;
  /** One standard deviation of that, in margin points. */
  sd: number;
  /** Best margin this store's own feed can produce: cheapest ask, rarest trim. */
  best: number;
  /** Worst it can produce: dearest ask, stock trim. Negative on the used stages. */
  worst: number;
  /**
   * What one deal on this scale grosses, as a multiple of cash retail. 1 on the
   * cash scale by definition; the window markup times the collection rate on
   * the finance one.
   *
   * Carried on the scale rather than recomputed by callers so the panel can put
   * a margin into dollars — a percentage of a number the reader has to work out
   * for themselves is most of a readout and none of the point.
   */
  grossOfRetail: number;
}

/** Moments of `C/R` — the share of a trim premium the DEALER keeps. */
function trimMoments(capture: number): { mean: number; meanSq: number; min: number } {
  let mean = 0;
  let meanSq = 0;
  let min = Infinity;
  for (const rarity of RARITY_ORDER) {
    const share = rarityAskMult(rarity, capture) / rarityValueMult(rarity);
    const p = rarityChance(rarity);
    mean += p * share;
    meanSq += p * share * share;
    min = Math.min(min, share);
  }
  return { mean, meanSq, min };
}

/**
 * Population share of each grade. Common is the remainder, exactly as
 * `rollRarity` computes it — one definition of the distribution, read two ways.
 */
function rarityChance(rarity: Rarity): number {
  const { rareChance, epicChance, legendaryChance } = BALANCE.rarity;
  switch (rarity) {
    case 'legendary':
      return legendaryChance;
    case 'epic':
      return epicChance;
    case 'rare':
      return rareChance;
    default:
      return Math.max(0, 1 - rareChance - epicChance - legendaryChance);
  }
}

export interface MarginInputs {
  /** Buy-side discount in force, 1 for a first career. See `prestigeEdge`. */
  edge?: number;
  /**
   * The transporter bill as a share of retail — mean AND spread, because
   * freight is drawn per listing rather than averaged. On a $10,000 big-lot car
   * the haul is anything from nothing to a tenth of the car, which measured as
   * a third of the store's whole margin variance; folding in only the mean read
   * ±8.8 points against a measured ±9.9.
   */
  freight?: { mean: number; sd: number };
}

/** The store's deal-margin distribution. Pure in the stage and the two inputs. */
export function marginScale(stage: StageDef, inputs: MarginInputs = {}): MarginScale {
  const edge = inputs.edge ?? 1;
  const freight = inputs.freight ?? { mean: 0, sd: 0 };
  const { askMin, askMax, raritySellerCapture } = stage.sourcing;
  const w = BALANCE.wholesaleOfRetail * edge;

  // Ask: uniform over the stage's band.
  const uMean = (askMin + askMax) / 2;
  const uVar = (askMax - askMin) ** 2 / 12;
  const uMeanSq = uMean * uMean + uVar;

  const trim = trimMoments(raritySellerCapture);

  const xMean = uMean * trim.mean;
  const xVar = uMeanSq * trim.meanSq - xMean * xMean;

  const mean = 1 - w * xMean - freight.mean;
  // Independent draws — which market a car comes from says nothing about where
  // the seller pitched the ask — so the variances simply add.
  const sd = Math.sqrt(w * w * Math.max(0, xVar) + freight.sd * freight.sd);

  return {
    mean,
    sd,
    // The extremes of the band itself. `C/R` is never above 1 — a seller cannot
    // charge more than the trim is worth — so the worst car is a stock one at
    // the top of the ask band. Quoted against average freight: the best car on
    // the feed is not reliably the one that drove itself here.
    best: 1 - w * askMin * trim.min - freight.mean,
    worst: 1 - w * askMax - freight.mean,
    grossOfRetail: 1,
  };
}

/**
 * The scale for the store this save is standing in, with its prestige edge and
 * its transporter bill folded in.
 *
 * Both terms are real money on a real deal, so leaving them out would quote an
 * average the business cannot actually hit — freight in particular is over half
 * a standard deviation at a franchise, which is enough to make "average" read as
 * "picky".
 */
export function stateMarginScale(
  s: Pick<GameState, 'upgrades' | 'prestige'>,
  stage: StageDef,
): MarginScale {
  return marginScale(stage, {
    edge: 1 - prestigeEdge(s),
    freight: freightMoments(s, stage),
  });
}

/**
 * The transporter bill per car, as a share of retail: what it averages and how
 * much it varies.
 *
 * Weighted by each open tier's share of the feed — the same weights `drawOrigin`
 * draws against — so this is the freight the business actually pays rather than
 * the worst haul it is capable of. The spread is real and it is not small:
 * within one store, one car drove itself here for nothing and the next came
 * across the country on a truck.
 */
export function freightMoments(
  s: Pick<GameState, 'upgrades'>,
  stage: StageDef,
): { mean: number; sd: number } {
  const tiers = marketTiers(s);
  const retail = typicalRetailPrice(stage);
  if (tiers.length === 1 || retail <= 0) return { mean: 0, sd: 0 };

  let weight = 0;
  let bill = 0;
  let billSq = 0;
  for (const tier of tiers) {
    const share =
      tier.origin === 'local' ? 1 : tier.supplyShare * BALANCE.market.supplyScale;
    const cost = (tier.freight * BALANCE.market.freightScale) / retail;
    weight += share;
    bill += share * cost;
    billSq += share * cost * cost;
  }
  if (weight <= 0) return { mean: 0, sd: 0 };
  const mean = bill / weight;
  return { mean, sd: Math.sqrt(Math.max(0, billSq / weight - mean * mean)) };
}

/**
 * WHAT A CONTRACT GROSSES, as a multiple of what the same car brings in cash.
 *
 * The finance floor needs its own yardstick and this is the whole of the
 * difference between the two. A financed car leaves at the window price rather
 * than at cash retail, and then only some of the paper is actually collected —
 * so the average contract at a small lot grosses 1.21x what the cash sale
 * would have, and its margin distribution is the cash one squeezed and shifted
 * up: 32.7% against 18.7%.
 *
 * Judging paper on the cash scale instead would have made the finance slider a
 * control whose bottom half does nothing. An ordinary contract sits +1.2σ up
 * the cash scale at a small lot and **+3.3σ at a Halvorsen store** — off the top
 * of the range entirely — so every stop below that would take everything and
 * the panel would describe routine subprime as a steal.
 *
 * The multiple is not always above 1, and that is the game rather than a bug:
 * at a premium franchise the window markup is 1.15 and collections eat more
 * than that, so paper grosses 0.997 of cash. The finance premium thins as the
 * store moves upmarket, exactly as `bhphMultiplier` says it should.
 *
 * SCALE-FREE, which is what makes it one number rather than a table. Every term
 * of a contract is proportional to the window price, so the ratio is a property
 * of the credit mix, the term options and the player's own repo trigger — not
 * of the car. It moves with underwriting and with a buried collections desk,
 * both of which genuinely change what paper is worth.
 */
export function financeGrossMultiple(
  stage: StageDef,
  opts: { underwritingLevel?: number; capacityFactor?: number; repoTrigger?: number } = {},
): number {
  if (!stage.financing) return 1;
  const capacityFactor = opts.capacityFactor ?? 1;
  const repoTrigger = opts.repoTrigger ?? BALANCE.repoAfterMissedPayments;

  const tiers = ['A', 'B', 'C', 'D'] as const;
  const weights = tierWeights((opts.underwritingLevel ?? 0) + stage.creditShift);
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const terms = BALANCE.termWeeks;

  // Per dollar of window price: the down payment, plus what the paper behind it
  // is expected to collect. `buildTerms` is not called because the jitter on the
  // down share is symmetric and averages out, so a reference contract is the
  // same arithmetic without one.
  //
  // Priced on a NOTIONAL MILLION rather than on one dollar, and that is not
  // decoration: `expectedCollections` rounds to whole dollars, so a unit
  // contract collects either $0 or $1 and the whole credit ladder collapses
  // into two values. Measured against the contracts the engine writes, the
  // dollarless version read 1.33 where the game delivers 1.21.
  const unit = 1_000_000;
  let value = 0;
  for (let i = 0; i < tiers.length; i++) {
    const cfg = BALANCE.creditTiers[tiers[i]];
    const share = weights[i] / totalWeight;
    const down = cfg.downShare * unit;
    const financed = unit - down;
    let collected = 0;
    for (const weeks of terms) {
      collected +=
        expectedCollections(
          weeks,
          weeklyPayment(financed, cfg.apr, weeks),
          cfg.missChance * capacityFactor,
          repoTrigger,
        ).expectedCollected / terms.length;
    }
    value += (share * (down + collected)) / unit;
  }

  return stage.bhphMultiplier * value;
}

/**
 * The same store's margin distribution, seen from the finance desk.
 *
 * One transform, because a financed deal is the same car and the same cost
 * against a bigger gross: `margin = 1 - cost/(g·retail)`. So the mean shifts up
 * and the spread narrows by exactly the same factor, and everything else about
 * the scale — the σ positions, the "any deal" stop, the readouts — carries over
 * untouched.
 */
export function financeMarginScale(cash: MarginScale, grossMultiple: number): MarginScale {
  const g = grossMultiple > 0 ? grossMultiple : 1;
  const lift = (margin: number) => 1 - (1 - margin) / g;
  const mean = lift(cash.mean);
  const sd = cash.sd / g;
  return {
    mean,
    sd,
    best: lift(cash.best),
    worst: lift(cash.worst),
    grossOfRetail: cash.grossOfRetail * g,
  };
}

/**
 * The finance scale for the store this save is standing in.
 *
 * Reads the three things that actually change what a contract is worth here:
 * the underwriting level (which shifts the walk-in credit mix), how far over
 * capacity the collections desk is running, and the player's own repo trigger.
 * All three are already the inputs the deal sheet quotes expected value from,
 * so the yardstick and the number on the sheet cannot disagree.
 */
export function stateFinanceScale(s: GameState, stage: StageDef, cash: MarginScale): MarginScale {
  return financeMarginScale(
    cash,
    financeGrossMultiple(stage, {
      underwritingLevel: level(s, 'underwriting'),
      capacityFactor: overCapacityFactor(activeNotes(s.notes).length, collectionsCapacity(s)),
      repoTrigger: repoThreshold(s),
    }),
  );
}

/**
 * How far off an ordinary deal a margin is, in standard deviations.
 *
 * The one thing the derived distribution is still asked for at runtime: it is
 * what lets the panel say whether a fixed 15% is a shrug or a wall AT THIS
 * STORE, without putting a statistic in front of the player. Zero sd (an
 * invoice with no band at all) reads as 0 rather than dividing by zero.
 */
export function zOfMargin(scale: MarginScale, margin: number): number {
  return scale.sd > 0 ? (margin - scale.mean) / scale.sd : 0;
}

/**
 * What the buyer's slider spans.
 *
 * The buy rule is stored as a PLAIN MARGIN rather than as a level on a ladder,
 * and the reason survived the ladder replacing the σ scale: a buyer's rule is a
 * PRICE ("do not pay more than it is worth") where a manager's floor is a
 * STANDARD ("better than average for this lot"). The default has always been
 * break-even against the worst case, which is a specific number and not a
 * position — so it stores as one, and it keeps meaning the same thing when the
 * player moves store.
 *
 * The ends still come from the store's own ladder, so the range means something
 * at every rung, and the bottom is pulled below cost because at a franchise
 * every car the store can source is profitable and "pay a little over the odds
 * to keep the stalls full" would otherwise be unsayable.
 */
export function buyMarginRange(stage: StageDef): { min: number; max: number } {
  // The top used to be the last stop on the store's cash floor ladder, which no
  // longer exists — the desk's rule is a share of the ask now, and a share of
  // the ask says nothing about what a purchase should keep back. The best margin
  // the store's own feed can actually produce is the honest ceiling, and it is
  // already derived right here.
  const scale = marginScale(stage);
  return {
    min: -BALANCE.business.buyMarginBelowCost,
    max: Math.max(0.05, Math.round(scale.best * 100) / 100),
  };
}
