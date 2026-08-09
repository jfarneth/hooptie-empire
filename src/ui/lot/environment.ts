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
 *   building    a house -> a portable shack -> brick + service bay -> showroom
 *   light       porch bulb -> one bad floodlight -> sodium -> LED -> uplighting
 *   perimeter   lawn -> chain-link and weeds -> kerb and flags -> planting
 *
 * Decoration is derived from a fixed seed per stage rather than drawn at
 * random, for the same reason parking is hashed from `car.id`: a crack that
 * moves when the lot re-renders is a crack the player notices.
 */

export type BuildingKind = 'house' | 'shack' | 'brick' | 'showroom' | 'showroomWide' | 'flagship';
export type PerimeterKind = 'lawn' | 'chainlink' | 'kerb' | 'planting' | 'planters' | 'manicured';
export type LightKind = 'porch' | 'flood' | 'sodium' | 'led' | 'uplight';

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
  buildingDepth: number;
  /** How far the stalls sit in from the screen edge. Wide on a driveway. */
  edgePad: number;
  wall: string;
  trim: string;
  /** Marque colour on the sign. Undefined falls back to the theme accent. */
  signColor?: string;

  light: LightKind;
  lightColor: string;
  /** Roughly how far apart the pole lights sit, in lot pixels. */
  lightSpacing: number;

  perimeter: PerimeterKind;
  plantColor: string;
  flags: boolean;

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
    edgePad: 62,
    wall: '#3f362f',
    trim: '#6b5d51',
    light: 'porch',
    lightColor: '#ffe0a8',
    lightSpacing: 999, // one bulb over the door, and that is the lighting plan
    perimeter: 'lawn',
    plantColor: '#3f5b39',
    flags: false,
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
    edgePad: 16,
    wall: '#4a453c',
    trim: '#5b544a',
    light: 'flood',
    lightColor: '#ffd89a',
    lightSpacing: 420,
    perimeter: 'chainlink',
    plantColor: '#3f5b39',
    flags: false,
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
    edgePad: 12,
    wall: '#4a3b35',
    trim: '#6a5a50',
    light: 'sodium',
    lightColor: '#ffd89a',
    lightSpacing: 300,
    perimeter: 'kerb',
    plantColor: '#3f5b39',
    flags: true,
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
    edgePad: 12,
    wall: '#39424f',
    trim: '#7c8797',
    signColor: '#5fbf6a',
    light: 'led',
    lightColor: '#e8f0ff',
    lightSpacing: 290,
    perimeter: 'planting',
    plantColor: '#4a6b45',
    flags: true,
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
    edgePad: 10,
    wall: '#3b4552',
    trim: '#93a0b2',
    signColor: '#6ea8e8',
    light: 'led',
    lightColor: '#dceaff',
    lightSpacing: 280,
    perimeter: 'planters',
    plantColor: '#31513f',
    flags: false,
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
    edgePad: 10,
    wall: '#38414e',
    trim: '#a9b8cb',
    signColor: '#e8e2d2',
    light: 'uplight',
    lightColor: '#cfe6ff',
    lightSpacing: 260,
    perimeter: 'manicured',
    plantColor: '#33553f',
    flags: false,
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
function mulberry(seed: number): () => number {
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
  const r = mulberry(seed);
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
  const r = mulberry(seed ^ 0x9e37);
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
  const r = mulberry(seed ^ 0x51ed);
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
