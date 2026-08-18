import { BALANCE } from './balance';
import { clamp } from './economy';
import { chance, normalish, range, type RngState } from './rng';
import type { Negotiation } from './types';

/**
 * Deal negotiation.
 *
 * A walk-up used to be one number and a yes/no. Now they open below your ask and
 * you either take it or push back.
 *
 * The whole thing hangs on a **hidden reservation price** — the most this buyer
 * would actually pay, drawn somewhere between their opening offer and your ask.
 * Acceptance odds fall as your counter climbs toward it and fall off a cliff past
 * it. A plain distance-from-their-offer formula would produce a similar curve,
 * but every buyer would behave identically; a reservation price means some people
 * genuinely have room and some genuinely do not, which is what makes this read as
 * a person rather than a dice roll.
 *
 * NOTE: nothing here knows about cars, asking prices or the game state. It works
 * in abstract (anchor, offer) money so the same model can drive down-payment
 * haggling later without a rewrite.
 */

const CFG = BALANCE.negotiation;

/**
 * How good the person doing the talking is.
 *
 * Plain numbers rather than a GameState, for the same reason everything else
 * here works in abstract money: this module must stay reusable for the
 * down-payment haggle later. `skills.ts` resolves these from the Closing level.
 *
 * Note when each one bites. `roomMean` and `tellJitter` are consumed at open and
 * baked into the buyer, because a reservation price and a tell are things about
 * *them* that were true before you started talking. `walkChanceMult` and
 * `maxCounters` are read live, because those are about how you are handling the
 * conversation right now.
 */
export interface HaggleSkill {
  /** Where the hidden reservation sits between their offer and your ask. */
  roomMean: number;
  /** Odds a tell reads one band off the truth. Lower is a read you can trust. */
  tellJitter: number;
  /** Multiplier on the odds a rejected counter loses them. */
  walkChanceMult: number;
  /** Counters available before they stop talking. */
  maxCounters: number;
  /** Where the sales desk pitches its one standing counter, offer→ask. */
  deskCounterFraction: number;
}

/** The level-1 negotiator: exactly the constants this module used to hard-code. */
export const BASE_HAGGLE_SKILL: HaggleSkill = {
  roomMean: CFG.roomMean,
  tellJitter: 0.3,
  walkChanceMult: 1,
  maxCounters: CFG.maxPlayerCounters,
  deskCounterFraction: CFG.deskCounterFraction,
};

/** Money lands on human numbers, and the increment grows with the price. */
export function roundingIncrement(price: number): number {
  if (price < 10_000) return 100;
  if (price < 30_000) return 500;
  return 1_000;
}

/**
 * Snap a raw price to something a person would actually say out loud.
 * Floored rather than rounded to nearest — people lowball *to* a round number,
 * they do not round up to one.
 */
export function humanizePrice(rng: RngState, price: number, increment: number): number {
  // Both branches floor. Rounding to nearest on the odd path would let an offer
  // land *above* the price it was derived from, which quietly breaks the
  // guarantee that a buyer never bids more than they meant to.
  if (chance(rng, CFG.oddNumberChance)) {
    return Math.max(0, Math.floor(price / 25) * 25);
  }
  return Math.max(0, Math.floor(price / increment) * increment);
}

/**
 * Open a negotiation against `anchor` (your asking price).
 *
 * `overpricing` is ask ÷ market value. Asking well over market invites a harder
 * lowball, which reinforces the same pricing pressure that `prospectRate`
 * already applies to how much traffic an overpriced car gets.
 */
/**
 * `depth` scales how far below the ask this store's buyers open — the one
 * per-stage term negotiation has. 1 is the used-lot fight; the franchises run
 * under it, because a new-car buyer opens near the sticker where a Tuesday
 * auction buyer opens at a number meant to insult you. It multiplies the
 * opening discount and nothing else: the overpricing lowball still bites at
 * full strength (a greedy sticker draws red buyers at any store), the room and
 * aggression draws are untouched so the RNG stream is identical at any value,
 * and 1 reproduces the build before the term existed.
 */
export function openNegotiation(
  rng: RngState,
  anchor: number,
  overpricing: number,
  skill: HaggleSkill,
  depth = 1,
): Negotiation {
  // Some shoppers simply pay the asking price. This is an explicit roll rather
  // than a tail of the discount curve: left to the curve, reaching full price
  // required an aggression draw so extreme it never actually happened, and the
  // brief is that offers range *from list* down.
  const paysFullPrice = chance(rng, CFG.fullPriceChance);

  // Independent draws, deliberately. If aggression predicted room, the opening
  // offer would leak the answer and countering would become mechanical.
  const aggression = normalish(rng, 0.5, 0.45, 0, 1);
  const room = normalish(rng, skill.roomMean, CFG.roomSpread, 0, 1);

  const push = clamp((overpricing - 1) * CFG.overpricingLowballFactor, 0, CFG.maxOverpricingPush);
  const discount = CFG.maxOpeningDiscount * depth * aggression * (1 + push);

  const increment = roundingIncrement(anchor);
  const raw = anchor * (1 - discount);

  // A buyer whose haggle instinct is smaller than one increment just pays the
  // asking price rather than quibbling over pocket change.
  const offer =
    paysFullPrice || anchor - raw < increment / 2
      ? anchor
      : Math.min(anchor, humanizePrice(rng, raw, increment));

  const reservation = offer + (anchor - offer) * room;

  // Tells correlate with room but are not a readout: adjacent bands overlap, so
  // reading a customer is a skill with a real error rate rather than arithmetic.
  let tellIndex = Math.round(room * (TELLS.length - 1));
  if (chance(rng, skill.tellJitter)) tellIndex += chance(rng, 0.5) ? 1 : -1;
  tellIndex = clamp(tellIndex, 0, TELLS.length - 1);

  return {
    anchor,
    openingOffer: offer,
    currentOffer: offer,
    reservation,
    room,
    aggression,
    countersMade: 0,
    lastCounter: null,
    status: 'open',
    tellIndex,
  };
}

/**
 * HOW AN OFFER READS AT A GLANCE: a lowball, an ordinary offer, or as close to
 * the sticker as this business gets.
 *
 * This exists because the lot is a scene rather than a list. At a franchise
 * there can be thirty buyers on screen at once, every one of them a figure
 * beside a car, and the only way to tell a $91,000 offer from a $78,000 one was
 * to open thirty deal sheets. A colour on the shopper turns that into a glance,
 * which is what the lot screen is for.
 *
 * MEASURED AGAINST THE ASK, not against retail or cost, for two reasons. It is
 * the number the player set and the number on the windscreen, so the comparison
 * is one they can make standing there — the "what a real operator could know"
 * line, and this side of it by a mile, because the customer said the number out
 * loud. And it stays honest under a repriced car: overpricing already pushes
 * opening offers down as a share of the ask (see `openNegotiation`), so a car
 * with an optimistic sticker really does draw redder buyers.
 *
 * Deliberately NOT a function of profit. A read denominated in margin would go
 * green on a car you stole and red on one you overpaid for, whatever the buyer
 * in front of you was doing — which is a fact about the purchase, is already on
 * the deal sheet in dollars, and is not what "is this a good offer" means with
 * somebody standing at the bonnet.
 */
export type OfferRead = 'lowball' | 'fair' | 'strong';

export function readOffer(offer: number, anchor: number): OfferRead {
  // A car with no ask cannot be lowballed. Reads as ordinary rather than
  // dividing by zero and painting the whole lot one colour.
  if (!(anchor > 0)) return 'fair';
  const ratio = offer / anchor;
  if (ratio >= CFG.offerRead.strong) return 'strong';
  return ratio >= CFG.offerRead.fair ? 'fair' : 'lowball';
}

/**
 * Odds this buyer accepts a counter at `counter`.
 *
 * Monotonically non-increasing in `counter` — asking for more can never make
 * them likelier to say yes. There is a test for that.
 */
export function acceptanceChance(neg: Negotiation, counter: number): number {
  if (counter <= neg.currentOffer) return 1;

  const toReservation = neg.reservation - neg.currentOffer;

  if (toReservation > 0 && counter <= neg.reservation) {
    // Inside their room: decays linearly from certain to `acceptanceAtReservation`.
    const x = (counter - neg.currentOffer) / toReservation;
    return 1 - (1 - CFG.acceptanceAtReservation) * x;
  }

  // Past what they meant to spend. People do stretch, but not far.
  const scale = Math.max(1, neg.anchor - neg.currentOffer);
  const over = (counter - neg.reservation) / scale;
  return CFG.acceptanceAtReservation * Math.exp(-CFG.stretchDecay * over);
}

export type CounterOutcome =
  | { kind: 'accepted'; price: number }
  | { kind: 'countered'; offer: number }
  | { kind: 'walked' };

/**
 * Resolve a player counter. Mutates `neg` — callers own a cloned state, the same
 * contract the rest of the engine runs on.
 */
export function resolveCounter(
  rng: RngState,
  neg: Negotiation,
  counter: number,
  skill: HaggleSkill,
): CounterOutcome {
  neg.countersMade += 1;
  neg.lastCounter = counter;

  if (chance(rng, acceptanceChance(neg, counter))) {
    neg.status = 'accepted';
    neg.currentOffer = counter;
    return { kind: 'accepted', price: counter };
  }

  // Out of rounds: they are done talking.
  if (neg.countersMade >= skill.maxCounters) {
    neg.status = 'walked';
    return { kind: 'walked' };
  }

  const scale = Math.max(1, neg.anchor - neg.currentOffer);
  const overreach = Math.max(0, (counter - neg.reservation) / scale);
  const walkChance = clamp(
    (CFG.baseWalkChance + overreach * CFG.walkPerExcess + (neg.countersMade - 1) * CFG.walkPerRound) *
      skill.walkChanceMult,
    0,
    1,
  );

  if (chance(rng, walkChance)) {
    neg.status = 'walked';
    return { kind: 'walked' };
  }

  // They come back up — toward you, but never past what they'd actually pay,
  // and never below what they already offered.
  const ceiling = Math.max(neg.currentOffer, Math.min(counter, neg.reservation));
  const increment = roundingIncrement(neg.anchor);
  const raw = range(rng, neg.currentOffer, ceiling);
  const improved = Math.max(neg.currentOffer, Math.min(ceiling, humanizePrice(rng, raw, increment)));

  neg.currentOffer = improved;
  return { kind: 'countered', offer: improved };
}

/** Counters left before they stop talking. */
export function countersRemaining(neg: Negotiation, skill: HaggleSkill): number {
  return Math.max(0, skill.maxCounters - neg.countersMade);
}

/** Where the sales desk pitches its one standing counter. */
export function deskCounter(neg: Negotiation, skill: HaggleSkill): number {
  const increment = roundingIncrement(neg.anchor);
  const target = neg.currentOffer + (neg.anchor - neg.currentOffer) * skill.deskCounterFraction;
  return Math.max(neg.currentOffer, Math.floor(target / increment) * increment);
}

/**
 * What the buyer is giving away. Correlated with how much room they have, but
 * deliberately noisy — see openNegotiation.
 */
const TELLS: readonly string[] = [
  'Arms folded. Says the number is the number.',
  'Keeps glancing at the lot across the street.',
  'Walked around it twice before saying anything.',
  'Already asked how soon they could drive it home.',
  'Mentioned their kid needs something by Friday.',
];

export function tellFor(neg: Negotiation): string {
  return TELLS[clamp(neg.tellIndex, 0, TELLS.length - 1)];
}

/**
 * A read on the counter, not a number.
 *
 * The deal sheet shows exact expected value and exact default odds for financing,
 * because those are long-run properties a dealer genuinely learns. One buyer's
 * private walk-away price is not something anyone on that lot could know, so it
 * stays a judgement call.
 */
export function readCounter(neg: Negotiation, counter: number): string {
  const p = acceptanceChance(neg, counter);
  if (p >= 0.999) return 'They will take that.';
  if (p >= 0.8) return 'Comfortable. They will probably say yes.';
  if (p >= 0.55) return 'Fair ask. Could go either way.';
  if (p >= 0.3) return 'That is a stretch for them.';
  // Deliberately blunter than it was. These bands describe acceptance odds, but
  // what the player feels is the *consequence*, and a refused counter now loses
  // the buyer roughly nine times in ten. "You may lose them" was written when a
  // refusal usually just meant another round, and it undersold the risk by a
  // long way once `baseWalkChance` went to 0.9.
  if (p >= 0.12) return 'Pushing it. Turn that down and they are probably gone.';
  return 'They are going to walk.';
}

// ------------------------------------------------------------ the paper side

/**
 * FINANCING IS A NEGOTIATION, and this is the whole of it.
 *
 * A cash buyer argues about the price of a car. A financed buyer argues about
 * nothing — they tell you what they can pay a week, and the only question is how
 * far past that you can push them before they are priced out. So this is
 * deliberately simpler than `resolveCounter`: one push, one answer, no coming
 * back with a better number. There is no better number; there is what they earn.
 *
 * It lives here, in the module that "works in abstract money and knows about
 * neither cars nor GameState", because that is exactly what CLAUDE.md reserved
 * this seam for.
 */
export type PaymentOutcome = 'signed' | 'balked' | 'walked';

/**
 * Odds they sign at a given weekly payment.
 *
 * 1 at or below the payment they walked in with, easing down to
 * `acceptanceAtCeiling` at the most they can carry, and falling away fast past
 * it. The same shape the cash haggle uses at the reservation price, for the same
 * reason: being asked for exactly your maximum is uncomfortable, and most people
 * balk rather than shrug.
 */
export function paymentAcceptance(payment: number, theirs: number, ceiling: number): number {
  if (payment <= theirs) return 1;
  const { acceptanceAtCeiling, stretchDecay } = BALANCE.negotiation.payment;
  const room = Math.max(1e-6, ceiling - theirs);
  const stretch = (payment - theirs) / room;
  if (stretch <= 1) return 1 + (acceptanceAtCeiling - 1) * stretch;
  return acceptanceAtCeiling * Math.exp(-stretchDecay * (stretch - 1));
}

/**
 * Push the payment and find out.
 *
 * A buyer who will not sign either BALKS — no deal on paper, but they are still
 * standing there and the cash option is still open — or WALKS out entirely.
 * Both had to exist: a push that always ended the visit would make the slider
 * pure downside and nobody would touch it, and a push that never cost anything
 * would make "all they can carry" the only correct setting.
 */
export function resolvePaymentPush(
  rng: RngState,
  payment: number,
  theirs: number,
  ceiling: number,
  skill: HaggleSkill,
): PaymentOutcome {
  if (chance(rng, paymentAcceptance(payment, theirs, ceiling))) return 'signed';
  // Closing protects the deal here exactly as it does on a cash counter: the
  // same multiplier, so levelling one skill improves both sides of the desk.
  const walk = BALANCE.negotiation.payment.walkChance * skill.walkChanceMult;
  return chance(rng, walk) ? 'walked' : 'balked';
}
