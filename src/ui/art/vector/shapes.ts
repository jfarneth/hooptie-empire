import type { BodyStyle } from '../../../sim/types';
import type { Archetype } from '../archetypes';

/**
 * Car geometry — the tables both vector renderers draw from, and the tables the
 * rarity overlay positions itself against.
 *
 * Pure data in a pure module on purpose. These used to live inside the two
 * drawing components, which meant anything that merely needed to KNOW where a
 * bootlid is had to import `react-native-svg` to find out — including
 * `footprint.ts`, and including its test, which could not run at all.
 */

export interface TopShape {
  /** Body footprint, centred in the artboard. */
  w: number;
  len: number;
  rx: number;
  /** Fractions of `len`: where the glass starts, the roof panel, the tail. */
  hood: number;
  roof: [number, number];
  tail: number;
  /** Pickup bed, as fractions of `len`. */
  bed?: [number, number];
  /** Premium cars get a chrome beltline and a bit more glass. */
  chrome?: boolean;
}

/**
 * Exported so `footprint.ts` can derive the vector renderer's framing from the
 * shapes themselves rather than copying the numbers into a second table, which
 * is exactly how a constant ends up meaning two different things.
 */
export const TOP_SHAPES: Record<Archetype, TopShape> = {
  hatchEconomy: { w: 42, len: 92, rx: 9, hood: 0.28, roof: [0.42, 0.75], tail: 0.9 },
  hatchPremium: { w: 44, len: 98, rx: 10, hood: 0.3, roof: [0.44, 0.76], tail: 0.91, chrome: true },

  sedanEconomy: { w: 44, len: 104, rx: 9, hood: 0.29, roof: [0.43, 0.7], tail: 0.83 },
  sedanPremium: { w: 47, len: 116, rx: 11, hood: 0.32, roof: [0.46, 0.71], tail: 0.85, chrome: true },

  coupeEconomy: { w: 43, len: 98, rx: 11, hood: 0.31, roof: [0.45, 0.67], tail: 0.79 },
  coupePremium: { w: 46, len: 106, rx: 13, hood: 0.34, roof: [0.48, 0.68], tail: 0.81, chrome: true },

  suvEconomy: { w: 48, len: 108, rx: 7, hood: 0.25, roof: [0.38, 0.8], tail: 0.91 },
  suvPremium: { w: 51, len: 118, rx: 8, hood: 0.27, roof: [0.4, 0.82], tail: 0.92, chrome: true },

  vanEconomy: { w: 49, len: 112, rx: 7, hood: 0.2, roof: [0.32, 0.86], tail: 0.95 },
  vanPremium: { w: 51, len: 120, rx: 8, hood: 0.22, roof: [0.34, 0.87], tail: 0.95, chrome: true },

  truckEconomy: { w: 48, len: 116, rx: 6, hood: 0.24, roof: [0.36, 0.56], tail: 0.62, bed: [0.64, 0.95] },
  truckPremium: { w: 51, len: 124, rx: 7, hood: 0.26, roof: [0.38, 0.57], tail: 0.63, bed: [0.65, 0.96], chrome: true },
};

/**
 * The handful of coordinates `RarityTrim` needs to hang a spoiler or a light bar
 * on the right part of the car.
 *
 * These live beside the paths they are read off rather than in the overlay,
 * because a spoiler floating an inch above the bootlid is exactly the sort of
 * thing nobody notices in a diff. Read them off the `body` and `cabin` strings
 * above whenever a shape changes.
 */
export interface SideTrimAnchors {
  /** Where the bodywork stops, top and bottom. */
  shoulder: number;
  sill: number;
  /** The bootlid, or the flat behind the cab on a truck: a spoiler sits here. */
  deck: [number, number];
  /** Top of the cabin and the run of roof, for a light bar or roof rails. */
  roofY: number;
  roof: [number, number];
  /** Which of the three treatments this shape wears at rare and above. */
  bolt: 'spoiler' | 'offroad' | 'rails';
}

interface Shape {
  body: string;
  cabin: string;
  /** Extra geometry drawn over the body, e.g. a pickup bed. */
  detail?: string;
  wheelR: number;
  wheels: [number, number];
  trim: SideTrimAnchors;
}

export const SIDE_SHAPES: Record<BodyStyle, Shape> = {
  sedan: {
    body: 'M6,33 L6,25 Q6,22 10,22 L90,22 Q94,22 94,25 L94,33 Z',
    cabin: 'M27,22 L35,12 L65,12 L74,22 Z',
    wheelR: 6,
    wheels: [24, 76],
    trim: { shoulder: 22, sill: 33, deck: [74, 94], roofY: 12, roof: [35, 65], bolt: 'spoiler' },
  },
  coupe: {
    body: 'M7,33 L7,26 Q7,23 11,23 L89,23 Q93,23 93,26 L93,33 Z',
    cabin: 'M29,23 L42,13 L60,13 L73,23 Z',
    wheelR: 6,
    wheels: [25, 75],
    trim: { shoulder: 23, sill: 33, deck: [73, 93], roofY: 13, roof: [42, 60], bolt: 'spoiler' },
  },
  hatch: {
    body: 'M9,33 L9,25 Q9,22 13,22 L87,22 Q91,22 91,25 L91,33 Z',
    cabin: 'M26,22 L34,11 L70,11 L78,22 Z',
    wheelR: 6,
    wheels: [26, 74],
    trim: { shoulder: 22, sill: 33, deck: [78, 91], roofY: 11, roof: [34, 70], bolt: 'spoiler' },
  },
  suv: {
    body: 'M6,33 L6,24 Q6,21 10,21 L90,21 Q94,21 94,24 L94,33 Z',
    cabin: 'M22,21 L27,9 L77,9 L82,21 Z',
    wheelR: 7,
    wheels: [24, 76],
    trim: { shoulder: 21, sill: 33, deck: [82, 94], roofY: 9, roof: [27, 77], bolt: 'offroad' },
  },
  van: {
    body: 'M6,33 L6,24 Q6,21 10,21 L90,21 Q94,21 94,24 L94,33 Z',
    cabin: 'M18,21 L23,7 L81,7 L86,21 Z',
    wheelR: 6.5,
    wheels: [24, 78],
    trim: { shoulder: 21, sill: 33, deck: [86, 94], roofY: 7, roof: [23, 81], bolt: 'rails' },
  },
  truck: {
    body: 'M6,33 L6,24 Q6,21 10,21 L90,21 Q94,21 94,24 L94,33 Z',
    cabin: 'M21,21 L26,10 L52,10 L57,21 Z',
    // Bed walls behind the cab.
    detail: 'M60,21 L60,14 L92,14 L92,21 Z',
    wheelR: 7,
    wheels: [23, 77],
    trim: { shoulder: 21, sill: 33, deck: [60, 92], roofY: 10, roof: [26, 52], bolt: 'offroad' },
  },
};

