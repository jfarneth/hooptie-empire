import { BALANCE } from './balance';
import { clamp01, conditionFreeValue, valuePerConditionPoint } from './economy';
import { mintId } from './ids';
import { BODY_COLORS, getModel } from './models';
import { intRange, normalish } from './rng';
import type { RngState } from './types';
import type { Car, CarModel, CarTier, GameState, Millis } from './types';

/**
 * Per-tier condition and mileage profiles. Beaters arrive tired and cheap;
 * luxury arrives clean and expensive and sits on the lot forever.
 */
const TIER_PROFILE: Record<
  CarTier,
  { mileage: [number, number]; condition: [number, number] }
> = {
  beater: { mileage: [118_000, 255_000], condition: [0.18, 0.58] },
  commuter: { mileage: [62_000, 168_000], condition: [0.32, 0.74] },
  family: { mileage: [41_000, 138_000], condition: [0.38, 0.8] },
  truck: { mileage: [48_000, 172_000], condition: [0.36, 0.82] },
  luxury: { mileage: [26_000, 112_000], condition: [0.44, 0.88] },
};

/**
 * Overrides the tier profile when the car did not come off the open market.
 *
 * A franchise stage takes delivery of new cars, so mileage and condition come
 * from the manufacturer rather than from what tier of used metal this is. See
 * `STAGES[].sourcing` in stages.ts.
 */
export interface StockProfile {
  mileage: [number, number];
  condition: [number, number];
}

export function generateCar(
  state: Pick<GameState, 'nextId'>,
  rng: RngState,
  model: CarModel,
  now: Millis,
  override?: StockProfile,
): Car {
  const profile = override ?? TIER_PROFILE[model.tier];
  const [mMin, mMax] = profile.mileage;
  const [cMin, cMax] = profile.condition;

  // Used metal lands on a 500-mile grid, the way an odometer gets quoted. That
  // grid would round every delivery mileage to a flat zero, so a narrow range
  // gets a correspondingly fine one.
  const grain = mMax - mMin >= 5_000 ? 500 : 5;
  const mileage =
    Math.round(normalish(rng, (mMin + mMax) / 2, (mMax - mMin) / 2, mMin, mMax) / grain) * grain;
  const condition = Math.round(normalish(rng, (cMin + cMax) / 2, (cMax - cMin) / 2, cMin, cMax) * 100) / 100;

  return {
    id: mintId(state, 'car'),
    modelId: model.id,
    colorIndex: intRange(rng, 0, BODY_COLORS.length - 1),
    mileage,
    condition,
    costBasis: 0,
    acquiredAt: now,
    status: 'ready',
    reconRemainingMs: 0,
    reconTotalMs: 0,
    reconTargetCondition: condition,
    askPrice: 0,
    listedAt: null,
    repoCount: 0,
  };
}

/**
 * What the shop is currently capable of.
 *
 * Passed in rather than read from state, so this module stays free of any
 * knowledge of upgrades and skills — the same reason `haggle.ts` works in
 * abstract money. The mechanic upgrade and the Wrenching skill both land in
 * `speedMult`, already multiplied together by the caller; see
 * `reconModsFor()` in skills.ts.
 */
export interface ReconMods {
  /** Ceiling on the condition one job can add. */
  maxLift: number;
  /** Multiplier on the dollar cost of the work. */
  costMult: number;
  /** Multiplier on how long it takes. Lower is faster. */
  speedMult: number;
}

/** How much condition one recon job can add to this car. */
export function reconLift(car: Car, mods: ReconMods): number {
  return Math.max(0, Math.min(mods.maxLift, 1 - car.condition));
}

/**
 * Cost of the recon job. Priced against what this specific car is worth, not
 * against the model's showroom value — see conditionFreeValue().
 */
export function reconCost(car: Car, mods: ReconMods): number {
  return Math.round(
    reconLift(car, mods) * conditionFreeValue(car) * BALANCE.reconCostPerPoint * mods.costMult,
  );
}

/** Retail value this recon job will add. Always the number the UI should quote. */
export function reconValueGain(car: Car, mods: ReconMods): number {
  return Math.round(reconLift(car, mods) * valuePerConditionPoint(car));
}

export function reconDurationMs(car: Car, mods: ReconMods): Millis {
  return Math.round(reconLift(car, mods) * BALANCE.reconMsPerPoint * mods.speedMult);
}

/** True when there is meaningful work left to do on this car. */
export function canRecon(car: Car, mods: ReconMods): boolean {
  return car.status === 'ready' && reconLift(car, mods) > 0.02;
}

/** Puts the car in the shop. Caller is responsible for debiting `reconCost`. */
export function beginRecon(car: Car, mods: ReconMods): void {
  const lift = reconLift(car, mods);
  const total = reconDurationMs(car, mods);
  car.status = 'recon';
  car.reconRemainingMs = total;
  car.reconTotalMs = total;
  car.reconTargetCondition = clamp01(car.condition + lift);
}

export function finishRecon(car: Car): void {
  car.condition = car.reconTargetCondition;
  car.reconRemainingMs = 0;
  car.reconTotalMs = 0;
  car.status = 'ready';
}

/** A repossessed car comes back rougher than it left, and carries the history. */
export function applyRepoDamage(car: Car, conditionLoss: number): void {
  car.condition = clamp01(car.condition - conditionLoss);
  car.repoCount += 1;
  car.status = 'ready';
  car.askPrice = 0;
  car.listedAt = null;
  car.reconRemainingMs = 0;
  car.reconTotalMs = 0;
  car.reconTargetCondition = car.condition;
}

export function carLabel(car: Car): string {
  const model = getModel(car.modelId);
  // A car off the transporter reads "· new", not "· 0k", which looks like a
  // rendering bug rather than a fact about the car.
  const odometer = car.mileage < 1_000 ? 'new' : `${Math.round(car.mileage / 1000)}k`;
  return `${model.name} · ${odometer}`;
}
