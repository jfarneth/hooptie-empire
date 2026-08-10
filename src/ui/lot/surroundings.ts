import type { StageId } from '../../sim/types';
import { seededRandom } from './environment';

/**
 * What is next door.
 *
 * Pure data and pure geometry, like `environment.ts` — no React, no
 * react-native. `LotGround` renders it; this file decides what there is.
 *
 * This exists because of the yaw. Rotating a long thin lot inside a screen-
 * shaped box leaves two large empty triangles at the corners, and empty tarmac
 * in the corner of an isometric scene reads as an unfinished screen rather than
 * as a lot. Filling them costs nothing in car size — the space was already
 * inside the projected bounding box — and it does the one thing the six stages
 * could never do for themselves: say what kind of *place* the business is in.
 * The ladder already changes the ground, the paint, the building, the lights and
 * the fence. Now it changes the neighbourhood:
 *
 *   curbstone         a residential street, because this is somebody's driveway
 *   small used        light industrial, tyre shops and container yards
 *   large used        a commercial strip of other people's lots
 *   low-cost frnch.   a retail park, big sheds and painted islands
 *   midsize frnch.    offices and street trees, somewhere with a planner
 *   premium frnch.    landscaping, mature planting and low stone walls
 *
 * NOTHING IS EVER PLACED IN FRONT OF THE LOT. The camera looks from the street
 * back at the building, so anything on the near side of the road would be
 * nearer than the cars and would have to occlude them — and cars are rendered
 * as pressables in a layer above the ground svg, so it could not. Neighbours go
 * left, right and behind, and the far side of the street stays flat.
 *
 * Everything is derived from a per-stage seed rather than rolled, for the same
 * reason the cracks are: a warehouse that moves when the lot re-renders reads as
 * something having happened.
 */

export type SurroundProp =
  | { kind: 'pad'; u: number; v: number; du: number; dv: number; color: string; opacity: number }
  | {
      kind: 'box';
      u: number;
      v: number;
      du: number;
      dv: number;
      height: number;
      wall: string;
      roof: string;
      /** Lit windows across the front face. Zero for a blank shed. */
      windows: number;
    }
  | { kind: 'tree'; u: number; v: number; r: number; height: number; color: string; trunk: string }
  | { kind: 'pole'; u: number; v: number; height: number; color: string; arm: boolean };

interface NeighbourhoodDef {
  /** Everything beyond the lot: soil, tarmac, grass. */
  ground: string;
  /** Hardstanding or lawn laid under the neighbours themselves. */
  pad: string;
  padOpacity: number;
  wall: string;
  roof: string;
  /** So a row of units is not one flat colour. */
  accents: string[];
  /** Footprint along the strip, across it, and height — all lot units. */
  along: [number, number];
  across: [number, number];
  height: [number, number];
  gap: [number, number];
  windows: number;
  trees: number;
  treeColor: string;
  trunk: string;
  treeSize: [number, number];
  poles: number;
  poleHeight: number;
  poleArm: boolean;
}

const NEIGHBOURHOODS: Record<StageId, NeighbourhoodDef> = {
  curbstone: {
    ground: '#243021',
    pad: '#2c3a27',
    padOpacity: 0.9,
    wall: '#4a4038',
    roof: '#3a3129',
    accents: ['#4d4239', '#46413c', '#524438', '#3f3a34'],
    along: [150, 210],
    across: [110, 150],
    height: [150, 200],
    gap: [60, 110],
    windows: 3,
    trees: 14,
    treeColor: '#3d5c37',
    trunk: '#2e2620',
    treeSize: [16, 30],
    poles: 3,
    poleHeight: 230,
    poleArm: false,
  },

  smallUsed: {
    ground: '#2a2823',
    pad: '#33312b',
    padOpacity: 0.85,
    wall: '#4a4a46',
    roof: '#3b3b38',
    accents: ['#4f4a42', '#454a4d', '#544c40', '#3f4448'],
    along: [190, 300],
    across: [130, 180],
    height: [150, 230],
    gap: [40, 90],
    windows: 0,
    trees: 4,
    treeColor: '#3a4a33',
    trunk: '#2b2721',
    treeSize: [14, 22],
    poles: 5,
    poleHeight: 300,
    poleArm: true,
  },

  largeUsed: {
    ground: '#23262c',
    pad: '#2a2e35',
    padOpacity: 0.85,
    wall: '#454b55',
    roof: '#363b44',
    accents: ['#4c4f58', '#55494a', '#414d55', '#4a4a54'],
    along: [160, 260],
    across: [120, 165],
    height: [170, 250],
    gap: [50, 100],
    windows: 4,
    trees: 6,
    treeColor: '#3a5236',
    trunk: '#2b2823',
    treeSize: [16, 26],
    poles: 4,
    poleHeight: 320,
    poleArm: true,
  },

  lowCostFranchise: {
    ground: '#1f242c',
    pad: '#262c35',
    padOpacity: 0.9,
    wall: '#414a56',
    roof: '#333b46',
    accents: ['#4a5460', '#48525c', '#3f4954', '#515b67'],
    along: [230, 330],
    across: [150, 200],
    height: [180, 260],
    gap: [55, 105],
    windows: 5,
    trees: 10,
    treeColor: '#3f6140',
    trunk: '#2c2a25',
    treeSize: [18, 28],
    poles: 4,
    poleHeight: 330,
    poleArm: true,
  },

  midsizeFranchise: {
    ground: '#1c222b',
    pad: '#242b35',
    padOpacity: 0.9,
    wall: '#465264',
    roof: '#374050',
    accents: ['#4c596d', '#425064', '#515e72', '#3e4a5c'],
    along: [170, 250],
    across: [140, 190],
    height: [260, 400],
    gap: [60, 110],
    windows: 7,
    trees: 16,
    treeColor: '#37583f',
    trunk: '#2b2b28',
    treeSize: [20, 32],
    poles: 2,
    poleHeight: 300,
    poleArm: false,
  },

  premiumFranchise: {
    ground: '#26302a',
    pad: '#2c3830',
    padOpacity: 0.95,
    wall: '#4a5560',
    roof: '#3a444e',
    accents: ['#515d68', '#47535e', '#58636d', '#4c5862'],
    along: [150, 220],
    across: [130, 175],
    height: [200, 300],
    gap: [110, 190],
    windows: 4,
    trees: 26,
    treeColor: '#2f5138',
    trunk: '#2a2a26',
    treeSize: [24, 42],
    poles: 0,
    poleHeight: 0,
    poleArm: false,
  },
};

export function neighbourhoodFor(stage: StageId): NeighbourhoodDef {
  return NEIGHBOURHOODS[stage] ?? NEIGHBOURHOODS.smallUsed;
}

export interface SurroundBounds {
  /** The world, in lot coordinates. Wider and deeper than the lot itself. */
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  /** The lot's own footprint, which nothing may be placed inside. */
  lotWidth: number;
  /** Where the street starts. Nothing is placed at or beyond it. */
  frontageY: number;
}

/**
 * Everything next door, far to near in no particular order — `LotGround` sorts
 * by depth before it draws.
 *
 * Deterministic in `stage` and the bounds, so the neighbourhood is the same
 * every render and across sessions.
 */
export function surroundingsFor(stage: StageId, bounds: SurroundBounds): SurroundProp[] {
  const def = neighbourhoodFor(stage);
  const seed = stageSeedFor(stage);
  const r = seededRandom(seed);
  const out: SurroundProp[] = [];

  const pick = ([lo, hi]: [number, number]) => lo + r() * (hi - lo);

  // Three strips: down the left, down the right, across the back. The near side
  // stays empty on purpose — see the header.
  const strips: { along: 'v' | 'u'; a0: number; a1: number; c0: number; c1: number }[] = [
    { along: 'v', a0: bounds.v0, a1: bounds.frontageY, c0: bounds.u0, c1: 0 },
    { along: 'v', a0: bounds.v0, a1: bounds.frontageY, c0: bounds.lotWidth, c1: bounds.u1 },
    { along: 'u', a0: bounds.u0, a1: bounds.u1, c0: bounds.v0, c1: 0 },
  ];

  for (const strip of strips) {
    const lo = Math.min(strip.c0, strip.c1);
    const hi = Math.max(strip.c0, strip.c1);
    const width = hi - lo;
    if (width < 40) continue;

    // The pad the neighbours stand on, so the strip does not read as bare soil.
    out.push({
      kind: 'pad',
      u: strip.along === 'v' ? lo : strip.a0,
      v: strip.along === 'v' ? strip.a0 : lo,
      du: strip.along === 'v' ? width : strip.a1 - strip.a0,
      dv: strip.along === 'v' ? strip.a1 - strip.a0 : width,
      color: def.pad,
      opacity: def.padOpacity,
    });

    let at = strip.a0 + pick(def.gap) * 0.5;
    while (at < strip.a1 - 60) {
      const along = Math.min(pick(def.along), strip.a1 - at);
      const across = Math.min(pick(def.across), width - 16);
      if (along < 60 || across < 40) break;
      // Placed anywhere across the strip that leaves the whole footprint inside
      // it. The margin at both ends is what keeps a warehouse off the lot's own
      // fence line, where it would read as a collision rather than a neighbour.
      const near = lo + 12 + r() * Math.max(0, width - across - 24);

      out.push({
        kind: 'box',
        u: strip.along === 'v' ? near : at,
        v: strip.along === 'v' ? at : near,
        du: strip.along === 'v' ? across : along,
        dv: strip.along === 'v' ? along : across,
        height: pick(def.height),
        wall: def.accents[Math.floor(r() * def.accents.length)] ?? def.wall,
        roof: def.roof,
        windows: def.windows,
      });

      at += along + pick(def.gap);
    }
  }

  for (let i = 0; i < def.trees; i++) {
    const spot = scatterSpot(r, bounds);
    if (!spot) continue;
    const size = pick(def.treeSize);
    out.push({
      kind: 'tree',
      u: spot.u,
      v: spot.v,
      r: size,
      height: size * 3.4,
      color: def.treeColor,
      trunk: def.trunk,
    });
  }

  for (let i = 0; i < def.poles; i++) {
    const spot = scatterSpot(r, bounds);
    if (!spot) continue;
    out.push({
      kind: 'pole',
      u: spot.u,
      v: spot.v,
      height: def.poleHeight * (0.85 + r() * 0.3),
      color: '#3b3a35',
      arm: def.poleArm,
    });
  }

  return out;
}

/** A point outside the lot but inside the world. Null if the strip is too thin. */
function scatterSpot(
  r: () => number,
  bounds: SurroundBounds,
): { u: number; v: number } | null {
  const left = -bounds.u0;
  const right = bounds.u1 - bounds.lotWidth;
  const back = -bounds.v0;
  const total = left + right + back;
  if (total < 30) return null;

  const roll = r() * total;
  if (roll < left) {
    return { u: bounds.u0 + r() * left, v: bounds.v0 + r() * (bounds.frontageY - bounds.v0) };
  }
  if (roll < left + right) {
    return {
      u: bounds.lotWidth + r() * right,
      v: bounds.v0 + r() * (bounds.frontageY - bounds.v0),
    };
  }
  return { u: bounds.u0 + r() * (bounds.u1 - bounds.u0), v: bounds.v0 + r() * back };
}

/**
 * A different mix from `stageSeed` in `environment.ts`, so the neighbourhood and
 * the cracks in the tarmac are not correlated — two scatters off one seed put a
 * tree and a weed clump in step with each other.
 */
function stageSeedFor(stage: StageId): number {
  let h = 0x2545f491;
  for (let i = 0; i < stage.length; i++) {
    h ^= stage.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
