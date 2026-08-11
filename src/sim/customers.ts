import { BALANCE } from './balance';
import { bhphPrice, retailValue } from './economy';
import { openNegotiation, type HaggleSkill } from './haggle';
import { getStage } from './stages';
import { mintId } from './ids';
import { customerName } from './models';
import { buildTerms } from './notes';
import { intRange, nextFloat, pickWeighted, range } from './rng';
import type { Car, CreditTier, GameState, Millis, Prospect, RngState } from './types';

const TIERS: readonly CreditTier[] = ['A', 'B', 'C', 'D'];

/**
 * Walk-in credit mix. Underwriting shifts the distribution away from D and
 * toward B/C — fewer defaults, but also fewer of the fat down payments that
 * make the subprime end of the book profitable in the first place.
 */
export function tierWeights(underwritingLevel: number): number[] {
  const shift = underwritingLevel * 0.3;
  return TIERS.map((tier) => {
    const base = BALANCE.creditTiers[tier].weight;
    if (tier === 'D') return Math.max(0.02, base * (1 - shift));
    if (tier === 'A') return base * (1 + shift * 0.35);
    return base * (1 + shift * 0.5);
  });
}

/**
 * A buyer walks up to a listed car. In stage 1 they can only pay cash; in
 * stage 2 the same walk-up carries a finance package too, and choosing between
 * the two is the whole decision the game is built around.
 */
export function generateProspect(
  state: Pick<GameState, 'nextId' | 'stage'>,
  rng: RngState,
  car: Car,
  underwritingLevel: number,
  haggle: HaggleSkill,
  now: Millis,
): Prospect {
  const stage = getStage(state.stage);
  // An upmarket store draws better credit through the door before anyone
  // screens anybody, so the stage's shift stacks onto whatever underwriting
  // buys. Expressed in equivalent underwriting levels so there is one curve
  // rather than two that have to be kept in agreement.
  const weights = tierWeights(underwritingLevel + stage.creditShift);
  const tier = pickWeighted(rng, TIERS, weights);
  const name = customerName(intRange(rng, 0, 999), intRange(rng, 0, 999));

  // A cash buyer will not pay the buy-here-pay-here markup — that markup is the
  // price of getting approved, and this customer does not need approval. They
  // pay cash retail even when the window sticker says more, which is exactly
  // why the lot would rather write paper than take their money.
  const retail = retailValue(car);
  const cashCeiling = Math.min(car.askPrice, retail);

  // Overpricing is measured against cash retail, so asking over market makes
  // cash buyers open harder — the same pressure that thins out foot traffic.
  const overpricing = retail > 0 ? car.askPrice / retail : 1;
  const negotiation = openNegotiation(rng, cashCeiling, overpricing, haggle);

  const price = bhphPrice(car, stage.bhphMultiplier);
  const weeks = BALANCE.termWeeks[intRange(rng, 0, BALANCE.termWeeks.length - 1)];
  const terms = buildTerms(tier, price, weeks, range(rng, 0.85, 1.15));
  const downPayment = price - terms.amountFinanced;

  return {
    id: mintId(state, 'pros'),
    carId: car.id,
    name,
    tier,
    negotiation,
    downPayment,
    financeTerms: terms,
    // Stamped, never derived from expiresAt and the live patience constant —
    // the desk's grace window counts from this.
    arrivedAt: now,
    claimed: false,
    expiresAt: now + BALANCE.prospectLifetimeMs * (0.7 + nextFloat(rng) * 0.6),
  };
}

/** Human-readable summary of what a tier means, for the deal sheet. */
export const TIER_BLURB: Record<CreditTier, string> = {
  A: 'Good credit. Small down, low rate, almost always pays.',
  B: 'Bruised credit. Reasonable down, pays most weeks.',
  C: 'Subprime. Solid down payment, misses more often than not lately.',
  D: 'Deep subprime. Big money down, and you will probably see the car again.',
};
