import type { CarModel, CarTier } from './types';

/**
 * Fictional makes and models. Deliberately not real marques — this is a game
 * about the retail side of the business, and it does not need a licensing
 * problem to make its point.
 */
export const CAR_MODELS: readonly CarModel[] = [
  // beaters — the curbstoner's bread and butter
  { id: 'comet', name: 'Renwick Comet', tier: 'beater', bodyStyle: 'sedan', baseValue: 9_500 },
  { id: 'pup', name: 'Halvorsen Pup', tier: 'beater', bodyStyle: 'hatch', baseValue: 8_600 },
  { id: 'dart', name: 'Okabe Dart', tier: 'beater', bodyStyle: 'hatch', baseValue: 9_000 },

  // commuters
  { id: 'civet', name: 'Nakato Civet', tier: 'commuter', bodyStyle: 'sedan', baseValue: 15_500 },
  { id: 'larkspur', name: 'Meridian Larkspur', tier: 'commuter', bodyStyle: 'hatch', baseValue: 14_500 },
  { id: 'tessera', name: 'Okabe Tessera', tier: 'commuter', bodyStyle: 'sedan', baseValue: 16_500 },

  // family
  { id: 'estate', name: 'Corvallis Estate', tier: 'family', bodyStyle: 'suv', baseValue: 24_000 },
  { id: 'vantage', name: 'Bergstrom Vantage', tier: 'family', bodyStyle: 'sedan', baseValue: 22_000 },
  { id: 'voyager', name: 'Ainsley Voyager', tier: 'family', bodyStyle: 'van', baseValue: 21_000 },

  // trucks — high demand, high margin, the BHPH customer's first choice
  { id: 'ironmark', name: 'Ironmark 1500', tier: 'truck', bodyStyle: 'truck', baseValue: 32_000 },
  { id: 'workhorse', name: 'Brandt Workhorse', tier: 'truck', bodyStyle: 'truck', baseValue: 36_000 },

  // luxury — slow movers, fat margins
  { id: 'astra', name: 'Valmont Astra', tier: 'luxury', bodyStyle: 'coupe', baseValue: 48_000 },
  { id: 'sovereign', name: 'Kessler Sovereign', tier: 'luxury', bodyStyle: 'sedan', baseValue: 56_000 },
  { id: 'norwood', name: 'Norwood GT', tier: 'luxury', bodyStyle: 'coupe', baseValue: 64_000 },
];

const BY_ID = new Map(CAR_MODELS.map((m) => [m.id, m]));

export function getModel(id: string): CarModel {
  const m = BY_ID.get(id);
  if (!m) throw new Error(`Unknown car model: ${id}`);
  return m;
}

export function modelsForTiers(tiers: readonly CarTier[]): CarModel[] {
  return CAR_MODELS.filter((m) => tiers.includes(m.tier));
}

/** Paint colours, indexed by Car.colorIndex so a car keeps its colour forever. */
export const BODY_COLORS: readonly string[] = [
  '#b23b3b', // oxide red
  '#2f5f8a', // fleet blue
  '#3d6b4f', // forest
  '#8a8f96', // silver
  '#2b2f36', // graphite
  '#c8a24a', // champagne
  '#7d5a8c', // plum
  '#c26b3a', // copper
  '#d8d5cd', // pearl
];

/** Tiers the player can source at each stage of the game. */
export const TIERS_BY_STAGE: Record<string, readonly CarTier[]> = {
  curbstoner: ['beater', 'commuter'],
  bhph: ['beater', 'commuter', 'family', 'truck'],
};

const FIRST_NAMES = [
  'Dwayne', 'Marisol', 'Terrence', 'Kayla', 'Ruben', 'Shanice', 'Curtis', 'Yolanda',
  'Devin', 'Priya', 'Marcus', 'Bethany', 'Otis', 'Lorraine', 'Tuan', 'Angela',
  'Jerome', 'Cassidy', 'Ivan', 'Denise', 'Hector', 'Brandy', 'Malik', 'Rosalie',
];

const LAST_NAMES = [
  'Whitfield', 'Alvarado', 'Boone', 'Nakamura', 'Pruitt', 'Okonkwo', 'Deleon', 'Traylor',
  'Beaumont', 'Suggs', 'Vasquez', 'Hollister', 'Ferrell', 'Adeyemi', 'Mancuso', 'Kirby',
];

export function customerName(a: number, b: number): string {
  return `${FIRST_NAMES[a % FIRST_NAMES.length]} ${LAST_NAMES[b % LAST_NAMES.length]}`;
}

export const LISTING_SOURCES = [
  'Craigslist',
  'Dealer auction',
  'Estate sale',
  'Trade-in walk-up',
  'Repo auction',
  'Marketplace',
  'Tow yard lien',
];
