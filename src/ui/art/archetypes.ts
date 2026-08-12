import { getModel } from '../../sim/models';
import type { BodyStyle, CarModel } from '../../sim/types';

/**
 * The twelve shapes the whole catalogue is drawn as.
 *
 * Thirty models, six body styles, and until now exactly six drawings — which
 * means a Kessler Sovereign and a Renwick Comet are the same picture in
 * different paint. That is the one place the art actively misrepresents the
 * game: the entire ladder is about moving upmarket, and the cars never look it.
 *
 * Twelve is the deliberate middle. Per-model art multiplies an art commission by
 * five and buys a difference nobody will notice — nobody clocks that the Nakato
 * Civet and the Bergstrom Vantage share a shell, because today they already do.
 * Splitting each body style economy/premium buys the thing they *will* notice.
 *
 * This mapping is not save data. `Car.modelId` is, and it never appears here as
 * anything but a lookup key, so the split can be re-cut — or grown to thirty —
 * without a migration and without touching a call site.
 */

export type Archetype =
  | 'sedanEconomy'
  | 'sedanPremium'
  | 'coupeEconomy'
  | 'coupePremium'
  | 'hatchEconomy'
  | 'hatchPremium'
  | 'suvEconomy'
  | 'suvPremium'
  | 'vanEconomy'
  | 'vanPremium'
  | 'truckEconomy'
  | 'truckPremium';

export const ARCHETYPES: readonly Archetype[] = [
  'sedanEconomy', 'sedanPremium',
  'coupeEconomy', 'coupePremium',
  'hatchEconomy', 'hatchPremium',
  'suvEconomy', 'suvPremium',
  'vanEconomy', 'vanPremium',
  'truckEconomy', 'truckPremium',
];

/**
 * Where the economy/premium line falls, in new-car money.
 *
 * One number rather than a tier check, because `tier` is about what a car is
 * *for* and this is about what it looks like. An Ironmark 1500 is a `truck` and
 * a Valmont Summit is a `truck`; at $32k and $94k they are not the same object.
 * Every `luxury` model clears this comfortably, so the tiers still land where
 * you would expect — the threshold just also catches the top of the Okabe
 * lineup, which is right.
 */
export const PREMIUM_VALUE_THRESHOLD = 40_000;

const SUFFIX = { economy: 'Economy', premium: 'Premium' } as const;

export function archetypeForModel(model: CarModel): Archetype {
  const grade = model.baseValue >= PREMIUM_VALUE_THRESHOLD ? 'premium' : 'economy';
  return `${model.bodyStyle}${SUFFIX[grade]}` as Archetype;
}

export function archetypeFor(modelId: string): Archetype {
  return archetypeForModel(getModel(modelId));
}

/** The body style an archetype is a flavour of, for anything still drawn by shape. */
export function bodyStyleOf(archetype: Archetype): BodyStyle {
  return archetype.replace(/(Economy|Premium)$/, '') as BodyStyle;
}

export function isPremium(archetype: Archetype): boolean {
  return archetype.endsWith('Premium');
}
