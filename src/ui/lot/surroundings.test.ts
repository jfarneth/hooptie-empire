import { STAGES } from '../../sim/stages';
import { surroundingsFor, type SurroundBounds } from './surroundings';

/**
 * The neighbourhood has two hard rules and both of them are invisible until they
 * break in a way that looks like something else:
 *
 *  - nothing may stand inside the lot, or a warehouse parks on the sales floor;
 *  - nothing may stand in front of the lot, because the cars are pressables in a
 *    layer above the ground svg and could never be occluded by it. A neighbour
 *    nearer than a car would be drawn behind it and read as a z-order bug.
 */

const BOUNDS: SurroundBounds = {
  u0: -520,
  v0: -300,
  u1: 900,
  v1: 1300,
  lotWidth: 390,
  frontageY: 880,
};

describe('surroundings', () => {
  it('is the same neighbourhood every time it is asked', () => {
    // Same reason the cracks are seeded: a warehouse that moves between renders
    // reads as something having happened.
    expect(surroundingsFor('smallUsed', BOUNDS)).toEqual(surroundingsFor('smallUsed', BOUNDS));
  });

  it('gives every stage on the ladder somewhere to be', () => {
    for (const stage of STAGES) {
      const props = surroundingsFor(stage.id, BOUNDS);
      expect(props.some((p) => p.kind === 'box')).toBe(true);
      expect(props.some((p) => p.kind === 'pad')).toBe(true);
    }
  });

  it('gives each stage a different neighbourhood', () => {
    const shapes = STAGES.map((s) =>
      JSON.stringify(surroundingsFor(s.id, BOUNDS).filter((p) => p.kind === 'box')),
    );
    expect(new Set(shapes).size).toBe(STAGES.length);
  });

  it('never puts a building on the lot', () => {
    for (const stage of STAGES) {
      for (const p of surroundingsFor(stage.id, BOUNDS)) {
        if (p.kind !== 'box') continue;
        const clearOfLot =
          p.u + p.du <= 0 || p.u >= BOUNDS.lotWidth || p.v + p.dv <= 0 || p.v >= BOUNDS.frontageY;
        expect(clearOfLot).toBe(true);
      }
    }
  });

  it('never puts anything between the camera and the cars', () => {
    for (const stage of STAGES) {
      for (const p of surroundingsFor(stage.id, BOUNDS)) {
        if (p.kind === 'pad') continue;
        const far = p.kind === 'box' ? p.v + p.dv : p.v;
        expect(far).toBeLessThanOrEqual(BOUNDS.frontageY);
      }
    }
  });

  it('keeps every neighbour inside the world it was given', () => {
    for (const stage of STAGES) {
      for (const p of surroundingsFor(stage.id, BOUNDS)) {
        const u1 = p.kind === 'box' || p.kind === 'pad' ? p.u + p.du : p.u;
        const v1 = p.kind === 'box' || p.kind === 'pad' ? p.v + p.dv : p.v;
        expect(p.u).toBeGreaterThanOrEqual(BOUNDS.u0 - 0.001);
        expect(p.v).toBeGreaterThanOrEqual(BOUNDS.v0 - 0.001);
        expect(u1).toBeLessThanOrEqual(BOUNDS.u1 + 0.001);
        expect(v1).toBeLessThanOrEqual(BOUNDS.v1 + 0.001);
      }
    }
  });

  it('draws nothing at all when there is no room beside the lot', () => {
    const tight: SurroundBounds = { ...BOUNDS, u0: -4, u1: 394, v0: -4 };
    expect(surroundingsFor('largeUsed', tight).filter((p) => p.kind === 'box')).toHaveLength(0);
  });
});
