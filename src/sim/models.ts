import type { CarModel, CarTier } from './types';

/**
 * Fictional makes and models. Deliberately not real marques — this is a game
 * about the retail side of the business, and it does not need a licensing
 * problem to make its point.
 *
 * Three of these makes have a second life as franchise lineups, and the overlap
 * is on purpose: the Halvorsen Pup you flipped off a driveway in the first ten
 * minutes is the same badge you eventually sign a franchise agreement with. The
 * used entries and the new ones are separate models with separate ids, because
 * a used Pup and a new Pup GT are different cars at very different money.
 *
 * MODEL IDS ARE SAVE DATA. `Car.modelId` is stored, so an id here can be added
 * but never renamed or removed without a migration.
 */

/** Marques. Franchise stages name one of these; see stages.ts. */
export const MAKES: Record<string, string> = {
  renwick: 'Renwick',
  halvorsen: 'Halvorsen',
  okabe: 'Okabe',
  nakato: 'Nakato',
  meridian: 'Meridian',
  corvallis: 'Corvallis',
  bergstrom: 'Bergstrom',
  ainsley: 'Ainsley',
  ironmark: 'Ironmark',
  brandt: 'Brandt',
  valmont: 'Valmont',
  kessler: 'Kessler',
  norwood: 'Norwood',
};

export const CAR_MODELS: readonly CarModel[] = [
  // ---------------------------------------------------------- the open market
  // beaters — the curbstoner's bread and butter
  { id: 'comet', makeId: 'renwick', name: 'Renwick Comet', tier: 'beater', bodyStyle: 'sedan', baseValue: 9_500 },
  { id: 'pup', makeId: 'halvorsen', name: 'Halvorsen Pup', tier: 'beater', bodyStyle: 'hatch', baseValue: 8_600 },
  { id: 'dart', makeId: 'okabe', name: 'Okabe Dart', tier: 'beater', bodyStyle: 'hatch', baseValue: 9_000 },

  // commuters
  { id: 'civet', makeId: 'nakato', name: 'Nakato Civet', tier: 'commuter', bodyStyle: 'sedan', baseValue: 15_500 },
  { id: 'larkspur', makeId: 'meridian', name: 'Meridian Larkspur', tier: 'commuter', bodyStyle: 'hatch', baseValue: 14_500 },
  { id: 'tessera', makeId: 'okabe', name: 'Okabe Tessera', tier: 'commuter', bodyStyle: 'sedan', baseValue: 16_500 },

  // family
  { id: 'estate', makeId: 'corvallis', name: 'Corvallis Estate', tier: 'family', bodyStyle: 'suv', baseValue: 24_000 },
  { id: 'vantage', makeId: 'bergstrom', name: 'Bergstrom Vantage', tier: 'family', bodyStyle: 'sedan', baseValue: 22_000 },
  { id: 'voyager', makeId: 'ainsley', name: 'Ainsley Voyager', tier: 'family', bodyStyle: 'van', baseValue: 21_000 },

  // trucks — high demand, high margin, the BHPH customer's first choice
  { id: 'ironmark', makeId: 'ironmark', name: 'Ironmark 1500', tier: 'truck', bodyStyle: 'truck', baseValue: 32_000 },
  { id: 'workhorse', makeId: 'brandt', name: 'Brandt Workhorse', tier: 'truck', bodyStyle: 'truck', baseValue: 36_000 },

  // luxury — slow movers, fat margins
  { id: 'astra', makeId: 'valmont', name: 'Valmont Astra', tier: 'luxury', bodyStyle: 'coupe', baseValue: 48_000 },
  { id: 'sovereign', makeId: 'kessler', name: 'Kessler Sovereign', tier: 'luxury', bodyStyle: 'sedan', baseValue: 56_000 },
  { id: 'norwood', makeId: 'norwood', name: 'Norwood GT', tier: 'luxury', bodyStyle: 'coupe', baseValue: 64_000 },

  // ------------------------------------------------------- Halvorsen new cars
  // The low-cost franchise. Cheap, sensible, sells itself on the payment.
  { id: 'hv_pup_gt', makeId: 'halvorsen', name: 'Halvorsen Pup GT', tier: 'commuter', bodyStyle: 'hatch', baseValue: 21_000 },
  { id: 'hv_kestrel', makeId: 'halvorsen', name: 'Halvorsen Kestrel', tier: 'commuter', bodyStyle: 'sedan', baseValue: 24_500 },
  { id: 'hv_ridge', makeId: 'halvorsen', name: 'Halvorsen Ridge', tier: 'family', bodyStyle: 'suv', baseValue: 29_000 },
  { id: 'hv_drover', makeId: 'halvorsen', name: 'Halvorsen Drover', tier: 'truck', bodyStyle: 'truck', baseValue: 33_500 },
  { id: 'hv_pilot', makeId: 'halvorsen', name: 'Halvorsen Pilot', tier: 'family', bodyStyle: 'van', baseValue: 27_500 },

  // ----------------------------------------------------------- Okabe new cars
  // The midsize franchise. A full lineup, and the truck is the volume seller.
  { id: 'ok_dart_se', makeId: 'okabe', name: 'Okabe Dart SE', tier: 'commuter', bodyStyle: 'hatch', baseValue: 28_000 },
  { id: 'ok_tessera_x', makeId: 'okabe', name: 'Okabe Tessera X', tier: 'family', bodyStyle: 'sedan', baseValue: 34_000 },
  { id: 'ok_solstice', makeId: 'okabe', name: 'Okabe Solstice', tier: 'family', bodyStyle: 'suv', baseValue: 42_000 },
  { id: 'ok_anvil', makeId: 'okabe', name: 'Okabe Anvil', tier: 'truck', bodyStyle: 'truck', baseValue: 49_000 },
  { id: 'ok_meridian_gt', makeId: 'okabe', name: 'Okabe Meridian GT', tier: 'luxury', bodyStyle: 'coupe', baseValue: 45_000 },
  { id: 'ok_caravel', makeId: 'okabe', name: 'Okabe Caravel', tier: 'family', bodyStyle: 'van', baseValue: 38_000 },

  // --------------------------------------------------------- Valmont new cars
  // The premium franchise. Six figures a car and a customer with real credit.
  { id: 'vm_astra_s', makeId: 'valmont', name: 'Valmont Astra S', tier: 'luxury', bodyStyle: 'coupe', baseValue: 82_000 },
  { id: 'vm_sovereign', makeId: 'valmont', name: 'Valmont Sovereign', tier: 'luxury', bodyStyle: 'sedan', baseValue: 96_000 },
  { id: 'vm_cascade', makeId: 'valmont', name: 'Valmont Cascade', tier: 'luxury', bodyStyle: 'suv', baseValue: 112_000 },
  { id: 'vm_summit', makeId: 'valmont', name: 'Valmont Summit', tier: 'truck', bodyStyle: 'truck', baseValue: 94_000 },
  { id: 'vm_verona', makeId: 'valmont', name: 'Valmont Verona', tier: 'luxury', bodyStyle: 'sedan', baseValue: 74_000 },
];

const BY_ID = new Map(CAR_MODELS.map((m) => [m.id, m]));

export function getModel(id: string): CarModel {
  const m = BY_ID.get(id);
  if (!m) throw new Error(`Unknown car model: ${id}`);
  return m;
}

/**
 * Open-market sourcing: anything in these tiers.
 *
 * Excluded by model id, never by make. Halvorsen, Okabe and Valmont all sell on
 * both sides of the line, so filtering the *makes* out of the used market would
 * quietly delete the Pup, the Dart, the Tessera and the Astra — four of the
 * fourteen cars the first two stages are built on.
 */
export function modelsForTiers(tiers: readonly CarTier[]): CarModel[] {
  return CAR_MODELS.filter((m) => !FRANCHISE_MODEL_IDS.has(m.id) && tiers.includes(m.tier));
}

/** Franchise sourcing: the manufacturer's current lineup, and nothing else. */
export function modelsForMake(makeId: string): CarModel[] {
  return CAR_MODELS.filter((m) => m.makeId === makeId && FRANCHISE_MODEL_IDS.has(m.id));
}

export function makeName(makeId: string): string {
  return MAKES[makeId] ?? makeId;
}

/**
 * Which models are new-car inventory rather than used metal.
 *
 * Kept as an explicit id list rather than inferred from the make, because
 * Halvorsen, Okabe and Valmont all sell on both sides of the line — the used
 * Pup and the new Pup GT wear the same badge and must not be interchangeable.
 */
const FRANCHISE_MODEL_IDS = new Set([
  'hv_pup_gt', 'hv_kestrel', 'hv_ridge', 'hv_drover', 'hv_pilot',
  'ok_dart_se', 'ok_tessera_x', 'ok_solstice', 'ok_anvil', 'ok_meridian_gt', 'ok_caravel',
  'vm_astra_s', 'vm_sovereign', 'vm_cascade', 'vm_summit', 'vm_verona',
]);

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

// What each stage sources moved to `STAGES[].sourcing` in stages.ts, where it
// sits next to the ask band, the condition range and the make — all of which
// vary together and none of which mean anything apart.

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
