import { LOT_TILT_DEGREES, LOT_YAW_DEGREES, fitCameraToWidth } from './camera';

/**
 * The camera is the one thing the ground svg and the car pressables both have to
 * agree about. The ground is drawn by handing an svg `matrix(...)` to a `G`; the
 * cars are positioned by calling `project` in JavaScript. If those two ever
 * disagree the tarmac and the cars are photographed from different cameras, and
 * the failure looks like cars floating a little off their stalls — which reads
 * as a layout bug rather than a projection one. That is what most of this file
 * is guarding.
 */

const WORLD = { u0: -60, v0: -40, u1: 460, v1: 900 };
const cam = fitCameraToWidth(WORLD, 390, 200);

/** Pull the six numbers back out of a `matrix(a,b,c,d,e,f)` string. */
function parse(matrix: string): number[] {
  const nums = matrix.replace('matrix(', '').replace(')', '').split(',').map(Number);
  expect(nums).toHaveLength(6);
  expect(nums.every((n) => Number.isFinite(n))).toBe(true);
  return nums;
}

function applyMatrix(matrix: string, x: number, y: number) {
  const [a, b, c, d, e, f] = parse(matrix);
  return { x: a * x + c * y + e, y: b * x + d * y + f };
}

describe('camera', () => {
  it('keeps verticals vertical on screen', () => {
    // The whole reason masts, posts and fence uprights are still "a rect from
    // the base going up" after the yaw.
    const base = cam.project(120, 400, 0);
    const top = cam.project(120, 400, 260);
    expect(top.x).toBeCloseTo(base.x, 6);
    expect(base.y - top.y).toBeCloseTo(cam.rise(260), 6);
  });

  it('rises by height x sin(tilt), scaled', () => {
    expect(cam.rise(100)).toBeCloseTo(100 * Math.sin((LOT_TILT_DEGREES * Math.PI) / 180) * cam.scale, 6);
  });

  it('draws the ground through the same projection the cars are placed with', () => {
    const matrix = cam.planeMatrix(0);
    for (const [u, v] of [
      [0, 0],
      [390, 0],
      [0, 880],
      [217, 433],
      [-60, -40],
    ]) {
      const direct = cam.project(u, v);
      const viaMatrix = applyMatrix(matrix, u, v);
      expect(viaMatrix.x).toBeCloseTo(direct.x, 2);
      expect(viaMatrix.y).toBeCloseTo(direct.y, 2);
    }
  });

  it('lifts a whole plane when it is drawn at height', () => {
    const at = applyMatrix(cam.planeMatrix(180), 200, 300);
    const direct = cam.project(200, 300, 180);
    expect(at.x).toBeCloseTo(direct.x, 2);
    expect(at.y).toBeCloseTo(direct.y, 2);
  });

  it('round-trips a ground point through unproject', () => {
    const p = cam.project(123, 456);
    const back = cam.unproject(p.x, p.y);
    expect(back.u).toBeCloseTo(123, 4);
    expect(back.v).toBeCloseTo(456, 4);
  });

  it('sorts the street in front of the showroom', () => {
    // The camera stands at the street looking back at the building, so a bigger
    // `v` is nearer and must be drawn later.
    expect(cam.depth(200, 800)).toBeGreaterThan(cam.depth(200, 100));
  });

  describe('wall', () => {
    const wall = cam.wall(20, 300, 320, 300, 240);

    it('puts local (0,0) at the top of the wall where it starts', () => {
      const corner = applyMatrix(wall.matrix, 0, 0);
      const expected = cam.project(20, 300, 240);
      expect(corner.x).toBeCloseTo(expected.x, 2);
      expect(corner.y).toBeCloseTo(expected.y, 2);
    });

    it('puts local (length, 0) at the far top corner', () => {
      const corner = applyMatrix(wall.matrix, wall.length, 0);
      const expected = cam.project(320, 300, 240);
      expect(corner.x).toBeCloseTo(expected.x, 2);
      expect(corner.y).toBeCloseTo(expected.y, 2);
    });

    it('puts local (0, height) at the foot of the wall', () => {
      const foot = applyMatrix(wall.matrix, 0, wall.height);
      const expected = cam.project(20, 300, 0);
      expect(foot.x).toBeCloseTo(expected.x, 2);
      expect(foot.y).toBeCloseTo(expected.y, 2);
    });

    it('is isotropic, so a square drawn on it renders square', () => {
      // Facades are authored as if the wall were lying on a page. That is only
      // true if one local unit is the same number of pixels across the wall as
      // down it — otherwise every letter on the sign stretches.
      const origin = applyMatrix(wall.matrix, 0, 0);
      const across = applyMatrix(wall.matrix, 10, 0);
      const down = applyMatrix(wall.matrix, 0, 10);
      expect(Math.hypot(across.x - origin.x, across.y - origin.y)).toBeCloseTo(
        Math.hypot(down.x - origin.x, down.y - origin.y),
        2,
      );
    });

    it('reports a height in local units that matches the drop on screen', () => {
      const drop = cam.project(20, 300, 0).y - cam.project(20, 300, 240).y;
      const origin = applyMatrix(wall.matrix, 0, 0);
      const foot = applyMatrix(wall.matrix, 0, wall.height);
      expect(foot.y - origin.y).toBeCloseTo(drop, 2);
    });
  });

  describe('fitCameraToWidth', () => {
    it('fills the viewport exactly when it is allowed to shrink', () => {
      const fitted = fitCameraToWidth(WORLD, 390, 200);
      expect(fitted.width).toBeCloseTo(390, 4);
      expect(fitted.panned).toBe(false);
    });

    it('keeps everything inside the surface it reports', () => {
      const fitted = fitCameraToWidth(WORLD, 390, 200);
      for (const [u, v, z] of [
        [WORLD.u0, WORLD.v0, 200],
        [WORLD.u1, WORLD.v0, 200],
        [WORLD.u0, WORLD.v1, 0],
        [WORLD.u1, WORLD.v1, 0],
      ]) {
        const p = fitted.project(u, v, z);
        expect(p.x).toBeGreaterThanOrEqual(-0.01);
        expect(p.x).toBeLessThanOrEqual(fitted.width + 0.01);
        expect(p.y).toBeGreaterThanOrEqual(-0.01);
        expect(p.y).toBeLessThanOrEqual(fitted.height + 0.01);
      }
    });

    it('stops shrinking at the floor and reports that it must be panned', () => {
      const floored = fitCameraToWidth(WORLD, 390, 200, 2);
      expect(floored.scale).toBe(2);
      expect(floored.panned).toBe(true);
      expect(floored.width).toBeGreaterThan(390);
    });

    it('does not report a pan when the floor is slack', () => {
      expect(fitCameraToWidth(WORLD, 390, 200, 0.0001).panned).toBe(false);
    });
  });

  it('rotates flat art onto the ground the same way the ground itself turns', () => {
    // A car is a flat drawing lying on the tarmac. It is rendered outside the
    // svg and cannot take a matrix, so it gets a rotation and a squash instead —
    // and that pair has to land within a few degrees of the real transform or
    // the cars sit crooked in their stalls.
    const nose = cam.project(0, -100);
    const origin = cam.project(0, 0);
    const trueAngle = (Math.atan2(nose.x - origin.x, origin.y - nose.y) * 180) / Math.PI;
    expect(Math.abs(cam.artRotationDeg - trueAngle)).toBeLessThan(5);
    expect(cam.artRotationDeg).toBeGreaterThan(0);
    expect(cam.artSquash).toBeLessThan(1);
    expect(cam.artSquash).toBeGreaterThan(0.85);
  });

  it('is set up as an isometric-ish camera, not a plan view', () => {
    // Guards the pair of constants themselves: a zero yaw silently turns the
    // whole scene back into the old straight-down plan.
    expect(LOT_TILT_DEGREES).toBeGreaterThan(15);
    expect(LOT_YAW_DEGREES).toBeGreaterThan(0);
  });
});
