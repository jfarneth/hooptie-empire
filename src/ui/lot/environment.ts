import type { StageId } from '../../sim/types';

/**
 * What each of the six stores looks like from above.
 *
 * Pure data and pure geometry — no React, no react-native. `LotGround` renders
 * it; this file decides what there is to render.
 *
 * The ladder's whole argument is that moving up is a real change, and until now
 * the only thing that changed was the word on the sign. The progression is
 * carried on five axes, each of which reads at a glance on a phone:
 *
 *   ground      cracked slab -> gravel -> asphalt -> sealed -> polished concrete
 *   stall paint none -> crooked and faded -> worn -> crisp -> thin white on a grid
 *   building    a house -> an office trailer -> painted block -> showroom -> flagship
 *   light       porch bulb -> one bad floodlight -> sodium -> LED -> uplighting
 *   perimeter   lawn -> chain-link and bunting -> kerb -> planting
 *
 * Decoration is derived from a fixed seed per stage rather than drawn at
 * random, for the same reason parking is hashed from `car.id`: a crack that
 * moves when the lot re-renders is a crack the player notices.
 */

/*
 * The camera — tilt, yaw and every projection — lives in `camera.ts`. This file
 * is only the stage data it photographs.
 */

/**
 * Width of the strip at the right-hand end of the building band kept clear for
 * the ladder pylon — the sign out front that reads how close you are to the next
 * store.
 *
 * Lives here because two files have to agree about it and neither owns the
 * other: `LadderPylon` draws inside this strip, and `LotGround` keeps the
 * building's own furniture — the service bay, the showroom glazing, the shack's
 * hand-painted board — out of it. Without the reservation the pylon lands on top
 * of a service department at three of the six stores.
 */
export const PYLON_RESERVE = 46;

export type BuildingKind = 'house' | 'shack' | 'brick' | 'showroom' | 'showroomWide' | 'flagship';
export type PerimeterKind = 'lawn' | 'chainlink' | 'kerb' | 'planting' | 'planters' | 'manicured';
export type LightKind = 'porch' | 'flood' | 'sodium' | 'led' | 'uplight';

/**
 * What is on top of the building.
 *
 * A pitched roof is the single strongest signal that a thing is a HOUSE rather
 * than a small commercial shed, and the curbstone stage lives or dies on
 * reading as somebody's home. `parapet` is the opposite tell: a flat roof with
 * a raised edge and a coping band is what a built-to-suit dealership has.
 */
export type RoofKind = 'gable' | 'flat' | 'parapet';

/**
 * How the front door presents itself, which is most of how expensive a
 * building looks.
 *
 * `stoop` is a slab and a step. `canopy` is a flat roof over the doors on two
 * posts — the standard franchise entrance. `portico` is the same idea built
 * properly: full-height columns, a deep soffit, and the glass set back behind
 * it.
 */
export type EntranceKind = 'porch' | 'stoop' | 'canopy' | 'portico';

export interface EnvironmentDef {
  /** Base colour of everything the cars park on. */
  ground: string;
  /** Slabs, patches and joints laid over the base. */
  surface: 'slabs' | 'patched' | 'plain' | 'joints';
  surfaceColor: string;
  /** How much speckle the tarmac carries. Kept small — every speck is a view. */
  grain: number;
  grainLight: string;
  /** Cracks, for ground that has not been resurfaced since the Carter administration. */
  cracks: number;
  /** Clumps of weeds pushing through. */
  weeds: number;

  stallLine: { color: string; opacity: number; width: number; wobble: number } | null;

  building: BuildingKind;
  /**
   * Total depth of the building band. Split by the renderer into a roof plate
   * and, below it, the front elevation the tilt reveals.
   */
  buildingDepth: number;
  /**
   * Height of the building, before the tilt turns it into a front elevation.
   *
   * DELIBERATELY EXAGGERATED, unlike the cars — but by less than it used to be.
   * At the old 12-degree tilt a real single-storey showroom projected about
   * 25px of frontage, which cannot hold a door, never mind glazing and a sign,
   * so these carried a roughly 3x cheat. At 25 degrees the tilt does more of the
   * work and the cheat came down to about 2x; buildings are still the one thing
   * the player never compares against a car for scale, which is why the cheat is
   * allowed at all.
   */
  buildingHeight: number;
  /** How far the stalls sit in from the screen edge. Wide on a driveway. */
  edgePad: number;
  wall: string;
  trim: string;
  /** Marque colour on the sign. Undefined falls back to the theme accent. */
  signColor?: string;

  roof: RoofKind;
  /** How far the ridge rises above the eaves. Only a gable uses it. */
  ridge: number;
  /** Roof colour. A house gets shingles; everything else gets its wall, darker. */
  roofColor?: string;

  entrance: EntranceKind;
  /**
   * Share of the elevation given over to glass.
   *
   * The one number that carries "cheap franchise" to "premium franchise" on its
   * own: a dealership gets more expensive almost entirely by replacing wall
   * with window, which is why this climbs the whole way up the ladder and the
   * wall colours barely move. `environment.test.ts` holds it monotonic.
   */
  glazing: number;

  /**
   * Service bay doors to draw on the elevation.
   *
   * Only ever drawn when the STORE ACTUALLY HAS A SHOP — `LotGround` takes that
   * from `STAGES[].shop`, never from this number, so a lot cannot advertise a
   * service department the sim will not let the player open. This is how many
   * doors it shows once it does, and there is a test on the difference.
   */
  bays: number;

  /** Cheap flare: pennants on wires along the street frontage. */
  bunting: boolean;
  /** The inflatable tube man. Exactly one store gets one, and it earns it. */
  airDancer: boolean;

  light: LightKind;
  lightColor: string;
  /** Roughly how far apart the pole lights sit, in lot pixels. */
  lightSpacing: number;
  /** Mast height. A porch bulb has none; a franchise pole is tall. */
  lightHeight: number;

  perimeter: PerimeterKind;
  plantColor: string;

  /** Kerb, verge and road, bottom of the lot. */
  road: string;
  verge: string;
  laneMark: string;
  laneOpacity: number;
}

const ENVIRONMENTS: Record<StageId, EnvironmentDef> = {
  curbstone: {
    ground: '#1a2118',
    surface: 'slabs',
    surfaceColor: '#3a3d40',
    grain: 90,
    grainLight: '#4a6b42',
    cracks: 7,
    weeds: 6,
    stallLine: null, // nobody paints stalls on their own driveway
    building: 'house',
    buildingDepth: 126,
    buildingHeight: 188,
    edgePad: 62,
    wall: '#3f362f',
    trim: '#6b5d51',
    roof: 'gable',
    ridge: 78,
    roofColor: '#4a3f36',
    entrance: 'porch',
    glazing: 0,
    bays: 0,
    bunting: false,
    airDancer: false,
    light: 'porch',
    lightColor: '#ffe0a8',
    lightSpacing: 999, // one bulb over the door, and that is the lighting plan
    lightHeight: 0,
    perimeter: 'lawn',
    plantColor: '#3f5b39',
    road: '#16181c',
    verge: '#43464b',
    laneMark: '#c9c3a8',
    laneOpacity: 0.3,
  },

  smallUsed: {
    ground: '#2e2b26',
    surface: 'patched',
    surfaceColor: '#3c3a35',
    grain: 130,
    grainLight: '#7d7566',
    cracks: 9,
    weeds: 7,
    stallLine: { color: '#b9b19a', opacity: 0.24, width: 2.4, wobble: 5 },
    building: 'shack',
    buildingDepth: 132,
    buildingHeight: 174,
    edgePad: 16,
    wall: '#4a453c',
    trim: '#5b544a',
    roof: 'flat',
    ridge: 0,
    entrance: 'stoop',
    glazing: 0.18,
    bays: 0,
    bunting: true,
    airDancer: false,
    light: 'flood',
    lightColor: '#ffd89a',
    lightSpacing: 420,
    lightHeight: 210,
    perimeter: 'chainlink',
    plantColor: '#3f5b39',
    road: '#191b1e',
    verge: '#3a362f',
    laneMark: '#c9c3a8',
    laneOpacity: 0.26,
  },

  largeUsed: {
    ground: '#22262e',
    surface: 'plain',
    surfaceColor: '#282d36',
    grain: 100,
    grainLight: '#8d98ab',
    cracks: 4,
    weeds: 3,
    stallLine: { color: '#d8d2bc', opacity: 0.32, width: 2.5, wobble: 0 },
    building: 'brick',
    buildingDepth: 130,
    buildingHeight: 208,
    edgePad: 12,
    wall: '#4a3b35',
    trim: '#6a5a50',
    roof: 'flat',
    ridge: 0,
    entrance: 'stoop',
    glazing: 0.3,
    bays: 0,
    bunting: true,
    airDancer: true,
    light: 'sodium',
    lightColor: '#ffd89a',
    lightSpacing: 300,
    lightHeight: 250,
    perimeter: 'kerb',
    plantColor: '#3f5b39',
    road: '#15171c',
    verge: '#3a3f47',
    laneMark: '#c9c3a8',
    laneOpacity: 0.34,
  },

  lowCostFranchise: {
    ground: '#1e232b',
    surface: 'plain',
    surfaceColor: '#242a33',
    grain: 60,
    grainLight: '#93a0b5',
    cracks: 0,
    weeds: 0,
    stallLine: { color: '#f0ecd8', opacity: 0.42, width: 2.5, wobble: 0 },
    building: 'showroom',
    buildingDepth: 128,
    buildingHeight: 214,
    edgePad: 12,
    wall: '#39424f',
    trim: '#7c8797',
    signColor: '#5fbf6a',
    roof: 'parapet',
    ridge: 0,
    entrance: 'canopy',
    glazing: 0.44,
    bays: 2,
    bunting: false,
    airDancer: false,
    light: 'led',
    lightColor: '#e8f0ff',
    lightSpacing: 290,
    lightHeight: 265,
    perimeter: 'planting',
    plantColor: '#4a6b45',
    road: '#14161b',
    verge: '#3d434c',
    laneMark: '#e4dfc8',
    laneOpacity: 0.42,
  },

  midsizeFranchise: {
    ground: '#1b2029',
    surface: 'plain',
    surfaceColor: '#212734',
    grain: 45,
    grainLight: '#9fb0c6',
    cracks: 0,
    weeds: 0,
    stallLine: { color: '#f6f3e4', opacity: 0.5, width: 2.5, wobble: 0 },
    building: 'showroomWide',
    buildingDepth: 146,
    buildingHeight: 248,
    edgePad: 10,
    wall: '#3b4552',
    trim: '#93a0b2',
    signColor: '#6ea8e8',
    roof: 'parapet',
    ridge: 0,
    entrance: 'canopy',
    glazing: 0.6,
    bays: 3,
    bunting: false,
    airDancer: false,
    light: 'led',
    lightColor: '#dceaff',
    lightSpacing: 280,
    lightHeight: 280,
    perimeter: 'planters',
    plantColor: '#31513f',
    road: '#13151a',
    verge: '#414852',
    laneMark: '#eee9d2',
    laneOpacity: 0.5,
  },

  premiumFranchise: {
    ground: '#3c4148',
    surface: 'joints',
    surfaceColor: '#2f343a',
    grain: 40,
    grainLight: '#c9d3e2',
    cracks: 0,
    weeds: 0,
    stallLine: { color: '#ffffff', opacity: 0.32, width: 2, wobble: 0 },
    building: 'flagship',
    buildingDepth: 164,
    buildingHeight: 294,
    edgePad: 10,
    wall: '#55606f',
    trim: '#d3dde9',
    signColor: '#e8e2d2',
    roof: 'parapet',
    ridge: 0,
    entrance: 'portico',
    glazing: 0.78,
    bays: 3,
    bunting: false,
    airDancer: false,
    light: 'uplight',
    lightColor: '#cfe6ff',
    lightSpacing: 260,
    lightHeight: 150,
    perimeter: 'manicured',
    plantColor: '#33553f',
    road: '#12141a',
    verge: '#464d58',
    laneMark: '#f4efd8',
    laneOpacity: 0.55,
  },
};

export function environmentFor(stage: StageId): EnvironmentDef {
  return ENVIRONMENTS[stage] ?? ENVIRONMENTS.smallUsed;
}

/* ------------------------------------------------------------------ scatter */

export interface Speck {
  x: number;
  y: number;
  w: number;
  h: number;
  dark: boolean;
  opacity: number;
}
export interface Clump {
  x: number;
  y: number;
  blades: { dx: number; dy: number }[];
}

/**
 * Everything scattered over the tarmac, derived rather than rolled.
 *
 * Seeded so a given stage's lot looks the same on every render and across
 * sessions — decoration that reshuffles is worse than no decoration, because
 * the eye reads the movement as something having happened.
 */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function stageSeed(stage: StageId): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < stage.length; i++) {
    h ^= stage.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function specks(seed: number, width: number, height: number, count: number): Speck[] {
  const r = seededRandom(seed);
  return Array.from({ length: Math.max(0, Math.floor(count)) }, () => ({
    x: r() * width,
    y: r() * height,
    w: 0.7 + r() * 2,
    h: 0.7 + r() * 1.7,
    dark: r() < 0.5,
    opacity: 0.03 + r() * 0.09,
  }));
}

/** Jagged polylines, as SVG path data, confined to the given band. */
export function crackPaths(
  seed: number,
  width: number,
  top: number,
  bottom: number,
  count: number,
): string[] {
  const r = seededRandom(seed ^ 0x9e37);
  const span = Math.max(1, bottom - top);
  return Array.from({ length: Math.max(0, Math.floor(count)) }, () => {
    let x = r() * width;
    let y = top + r() * span;
    let d = `M${x.toFixed(1)},${y.toFixed(1)}`;
    const segments = 4 + Math.floor(r() * 4);
    for (let i = 0; i < segments; i++) {
      x = Math.max(0, Math.min(width, x + (r() - 0.5) * 46));
      y = Math.max(top, Math.min(bottom, y + (r() - 0.35) * 40));
      d += ` L${x.toFixed(1)},${y.toFixed(1)}`;
    }
    return d;
  });
}

export function weedClumps(
  seed: number,
  width: number,
  top: number,
  bottom: number,
  count: number,
): Clump[] {
  const r = seededRandom(seed ^ 0x51ed);
  const span = Math.max(1, bottom - top);
  return Array.from({ length: Math.max(0, Math.floor(count)) }, () => {
    const x = r() * width;
    const y = top + r() * span;
    const blades = Array.from({ length: 4 }, () => {
      const angle = -1.6 + (r() - 0.5) * 1.5;
      const len = 4 + r() * 6;
      return { dx: Math.cos(angle) * len, dy: Math.sin(angle) * len };
    });
    return { x, y, blades };
  });
}

/**
 * Where the pole lights stand: down both edges, spaced by the stage's habit,
 * and never fewer than one pair or the middle of a long lot goes dark.
 */
export function lightPositions(
  env: EnvironmentDef,
  width: number,
  top: number,
  bottom: number,
): { x: number; y: number }[] {
  if (env.light === 'porch') return [];
  const span = Math.max(1, bottom - top);
  const rows = Math.max(1, Math.round(span / env.lightSpacing));
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < rows; i++) {
    const y = top + (span * (i + 0.5)) / rows;
    // One bad floodlight is the whole point of the shack; it does not get a pair.
    if (env.light === 'flood') out.push({ x: width - 22, y });
    else out.push({ x: 16, y }, { x: width - 16, y });
  }
  return out;
}
