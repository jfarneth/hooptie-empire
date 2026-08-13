import { BALANCE } from './balance';
import type { ActivePromotion, GameState, Millis, PromotionId } from './types';

/**
 * Promotions: temporary boosts the business runs under.
 *
 * This mirrors upgrades.ts and skills.ts — a definition table, the plumbing to
 * start and expire one, and derived-stat accessors — and it is deliberately
 * built wider than the one promotion that exists. `promotions` is an array and
 * the traffic multiplier is a product, so a second promotion needs a row in
 * `PROMOTIONS`, a block in `BALANCE.promotions`, and nothing else.
 *
 * WHAT IT IS NOT is a modifier system. Every promotion here boosts walk-up
 * traffic and only that; the day one needs to touch prices or the feed, the
 * honest move is another accessor next to `promotionTrafficMultiplier`, read at
 * the one call site that cares, rather than a generic effect bag that every
 * system has to consult.
 *
 * The state lives on the save, like everything else a timer depends on: a
 * promotion has to keep running while the app is closed, or the eight hours a
 * player was away would be the eight hours their promotion did nothing.
 */

/**
 * Which drawing the tray puts next to a promotion.
 *
 * A string the UI resolves, not a component: `src/sim` never imports anything
 * that can draw, and this is the same seam `CarArt` uses for archetypes.
 */
export type PromotionIcon = 'pennant';

export interface PromotionDef {
  id: PromotionId;
  name: string;
  /** What it does, in the player's words. Goes in the tray, so keep it short. */
  effect: string;
  /** Why it is happening. Goes in the ledger when it starts. */
  blurb: string;
  icon: PromotionIcon;
}

export const PROMOTIONS: readonly PromotionDef[] = [
  {
    id: 'grandOpening',
    name: 'Grand opening',
    effect: 'Double the walk-ups',
    blurb: 'Bunting on the fence, a sign by the road, and everyone slowing down to look.',
    icon: 'pennant',
  },
];

const BY_ID = new Map(PROMOTIONS.map((p) => [p.id, p]));

/**
 * Tolerant on purpose. A save can carry a promotion this build has since
 * dropped, and the rule there is the one every migration follows: an unknown
 * entry is ignored, never fatal.
 */
export function getPromotion(id: PromotionId): PromotionDef | undefined {
  return BY_ID.get(id);
}

/** How long this promotion runs for, at the constants in force right now. */
export function promotionDuration(id: PromotionId): Millis {
  return BALANCE.promotions[id].durationMs;
}

/** What this promotion multiplies walk-up traffic by while it runs. */
export function promotionTraffic(id: PromotionId): number {
  return BALANCE.promotions[id].trafficMultiplier;
}

/**
 * Start a promotion. Mutates, like everything else the engine calls.
 *
 * Re-starting one already running extends it rather than stacking a second
 * copy: two grand openings would double the traffic twice, which is not what
 * "run the promotion again" means to anybody.
 */
export function startPromotion(
  state: Pick<GameState, 'promotions' | 't'>,
  id: PromotionId,
): ActivePromotion {
  const endsAt = state.t + promotionDuration(id);
  const running = state.promotions.find((p) => p.id === id);
  if (running) {
    running.endsAt = Math.max(running.endsAt, endsAt);
    return running;
  }

  const started: ActivePromotion = { id, startedAt: state.t, endsAt };
  state.promotions.push(started);
  return started;
}

/**
 * What is running right now.
 *
 * Filters on the clock as well as on the array. The tick sweeps expired entries
 * out, but the UI reads state between ticks and the harness reads it mid-turn,
 * and a promotion that has visibly run out should not still be advertised for
 * the fraction of a second before the sweep catches up.
 */
export function livePromotions(
  state: Pick<GameState, 'promotions' | 't'>,
): ActivePromotion[] {
  return (state.promotions ?? []).filter((p) => p.endsAt > state.t);
}

/**
 * Multiplier on walk-up arrival rate from every promotion running.
 *
 * A product rather than a sum, so promotions compose the way the mechanic
 * upgrade and Wrenching do — and so the neutral value is 1 with nothing
 * running, which is what makes this safe to drop into the traffic path.
 */
export function promotionTrafficMultiplier(
  state: Pick<GameState, 'promotions' | 't'>,
): number {
  let multiplier = 1;
  for (const active of livePromotions(state)) {
    if (BY_ID.has(active.id)) multiplier *= promotionTraffic(active.id);
  }
  return multiplier;
}

/** Sim ms until this one is over. Never negative. */
export function promotionRemaining(
  state: Pick<GameState, 't'>,
  active: ActivePromotion,
): Millis {
  return Math.max(0, active.endsAt - state.t);
}

/**
 * Drop everything that has run out, and report what went, so the caller can log
 * it. Same contract `grantXp` follows: this module cannot log an event without
 * importing the engine, and the engine imports this.
 */
export function expirePromotions(state: Pick<GameState, 'promotions' | 't'>): PromotionDef[] {
  const ended: PromotionDef[] = [];
  state.promotions = state.promotions.filter((p) => {
    if (p.endsAt > state.t) return true;
    const def = BY_ID.get(p.id);
    if (def) ended.push(def);
    return false;
  });
  return ended;
}
