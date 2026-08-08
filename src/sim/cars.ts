import { BALANCE } from './balance';
import { clamp01 } from './economy';
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

export function generateCar(
  state: Pick<GameState, 'nextId'>,
  rng: RngState,
  model: CarModel,
  now: Millis,
): Car {
  const profile = TIER_PROFILE[model.tier];
  const [mMin, mMax] = profile.mileage;
  const [cMin, cMax] = profile.condition;

  const mileage = Math.round(normalish(rng, (mMin + mMax) / 2, (mMax - mMin) / 2, mMin, mMax) / 500) * 500;
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
    reconTargetCondition: condition,
    askPrice: 0,
    listedAt: null,
    repoCount: 0,
  };
}

/** How much condition one recon job can add to this car. */
export function reconLift(car: Car): number {
  return Math.max(0, Math.min(BALANCE.reconMaxLift, 1 - car.condition));
}

export function reconCost(car: Car): number {
  const model = getModel(car.modelId);
  return Math.round(reconLift(car) * model.baseValue * BALANCE.reconCostPerPoint);
}

export function reconDurationMs(car: Car, mechanicLevel: number): Millis {
  const speed = Math.pow(BALANCE.reconMsPerMechanicLevel, mechanicLevel);
  return Math.round(reconLift(car) * BALANCE.reconMsPerPoint * speed);
}

/** True when there is meaningful work left to do on this car. */
export function canRecon(car: Car): boolean {
  return car.status === 'ready' && reconLift(car) > 0.02;
}

/** Puts the car in the shop. Caller is responsible for debiting `reconCost`. */
export function beginRecon(car: Car, mechanicLevel: number): void {
  const lift = reconLift(car);
  car.status = 'recon';
  car.reconRemainingMs = reconDurationMs(car, mechanicLevel);
  car.reconTargetCondition = clamp01(car.condition + lift);
}

export function finishRecon(car: Car): void {
  car.condition = car.reconTargetCondition;
  car.reconRemainingMs = 0;
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
  car.reconTargetCondition = car.condition;
}

export function carLabel(car: Car): string {
  const model = getModel(car.modelId);
  return `${model.name} · ${Math.round(car.mileage / 1000)}k`;
}
