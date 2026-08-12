/**
 * Where the camera stands, and the only place that knows how to get from the
 * lot's flat plan to the screen.
 *
 * Pure geometry — no React, no react-native. `layout.ts` still solves parking in
 * flat 2D lot coordinates and knows nothing about any of this; this file turns
 * that plan into pixels.
 *
 * THE CAMERA IS ORTHOGRAPHIC, TILTED OFF STRAIGHT-DOWN AND YAWED TO THE RIGHT.
 * Two angles instead of one, which buys the isometric read — a building shows
 * two faces instead of a front elevation, and rows of cars run diagonally rather
 * than straight down the screen.
 *
 * The thing that makes this affordable is that an orthographic camera maps every
 * horizontal plane to the screen *affinely*. A rectangle of tarmac becomes a
 * parallelogram, never a trapezium, so:
 *
 *  - the entire ground plate — grain, cracks, weeds, stall paint, the road —
 *    is still drawn in flat lot coordinates and wrapped in ONE svg matrix.
 *    Nothing in that art had to be rewritten for the yaw.
 *  - a vertical wall is also an affine image of a rectangle, so a facade is
 *    drawn in its own local (along-the-wall, down-the-wall) space and posted
 *    through `wall()`. Signs and glazing shear with the wall, which is what
 *    a sign on a wall does.
 *  - verticals stay vertical on screen. Height only ever moves a point up by
 *    `height x sin(tilt)`, with no sideways component, so masts, posts and
 *    fence uprights are still "rise from the base" the way they always were.
 *
 * Conventions, and they matter:
 *   u  across the lot, left to right in the plan
 *   v  into the lot: v=0 is the back fence, v=max is the street
 *   z  up
 * The camera is on the STREET side looking back at the building, so larger `v`
 * is nearer the viewer. `depth()` returns that ordering and is the painter's
 * sort key for everything that stands up.
 */

/**
 * How far the camera is tilted off straight-down.
 *
 * At 25 degrees the ground foreshortens by 9.4%, which is enough that the plan
 * still reads as a plan — `layout.ts` keeps computing stalls as rectangles and
 * `layout.test.ts` never learns the camera exists — while giving every vertical
 * surface a face worth drawing on.
 */
export const LOT_TILT_DEGREES = 25;

/**
 * How far the camera is swung to the right, so it looks across the lot rather
 * than straight down it.
 *
 * This is the expensive angle, and it is worth knowing why before changing it.
 * A lot is a long thin rectangle; rotating one inside a screen-aligned box
 * leaves two big empty triangles at the corners, so the same lot needs roughly
 * 1.8x the width it used to. That cost is paid in car size — see
 * `fitCameraToWidth`, which is allowed to give up on fitting and let the scene
 * be panned instead. The triangles are not waste: they are where the
 * neighbourhood in `surroundings.ts` goes, which is the whole reason the lot
 * stopped filling the screen edge to edge.
 */
export const LOT_YAW_DEGREES = 25;

/**
 * The angle the car sprites in `art/sprites` were actually photographed at.
 *
 * NOT the camera above, and deliberately so. `tools/render-cars/views.json`
 * must match THIS number, not `LOT_TILT_DEGREES`.
 *
 * What the difference costs: a car is laid on the ground plane through the same
 * affine transform as the tarmac it sits on, so it parks in the right place, at
 * the right angle, foreshortened by the right amount. Only its *own* shading is
 * from a 13-degree-shallower camera, which at 34-110px is a slightly flatter
 * roof and nothing else.
 *
 * **RE-SHOOTING AT 25 DOES NOT CLOSE THE GAP, and this comment said it did for
 * as long as nobody could run the tool to find out.** `LotScene` lays the frame
 * down through `artRotationDeg` and `artSquash`, so the render's own
 * foreshortening COMPOSES with the scene's: at 12 degrees the pair land on
 * 0.978 x 0.939 = 0.918 against a correct 0.906, and at 25 they would land on
 * 0.851 — a car squashed by 15% where the tarmac under it is squashed by 9%.
 * The angle would be right and the shape would be worse.
 *
 * Closing it properly means baking the whole 25/25 projection into the frame
 * and having `LotScene` stop transforming the art at all — verticals vertical,
 * the roof correctly offset from the footprint, the sprite simply placed at the
 * projected stall centre. That is a change to how cars are POSITIONED, not to a
 * number here, and it lands with a new artboard, a re-measured geometry table
 * and a different hit target. Worth doing; not one config value.
 */
export const SPRITE_TILT_DEGREES = 12;

const RAD = Math.PI / 180;

export interface WorldRect {
  /** Lot coordinates. `u0`/`v0` may be negative — the world is bigger than the lot. */
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

export interface Camera {
  /** Lot units to screen pixels. */
  scale: number;
  /** The whole drawable surface, in screen pixels. */
  width: number;
  height: number;
  /** True when the scene had to give up fitting the viewport and can be panned. */
  panned: boolean;
  project(u: number, v: number, z?: number): { x: number; y: number };
  /**
   * Back from a screen point to the patch of ground under it.
   *
   * Used to work out how much world the surroundings have to cover: the scene is
   * fitted to the *lot*, and the neighbourhood then has to fill whatever is left
   * over out to the edges, which is a question only the screen can answer.
   */
  unproject(x: number, y: number): { u: number; v: number };
  /** Painter's sort key. Bigger is nearer the viewer, so draw it later. */
  depth(u: number, v: number): number;
  /** Screen pixels something of this height rises. Verticals stay vertical. */
  rise(height: number): number;
  /** `matrix(...)` mapping flat lot coordinates at height `z` onto the screen. */
  planeMatrix(z?: number): string;
  /**
   * A vertical wall standing on the segment (u0,v0)-(u1,v1), `height` tall.
   *
   * Returns the matrix plus the size of the wall in its own local space, which
   * is ISOTROPIC: one local unit is the same number of screen pixels across the
   * wall as down it. That is what lets facade code — glazing, a service bay,
   * the sign — be written as if the wall were lying flat on a page, exactly the
   * way it was written when the camera had no yaw. Local x runs along the wall
   * from (u0,v0); local y runs down it from the top.
   */
  wall(
    u0: number,
    v0: number,
    u1: number,
    v1: number,
    height: number,
  ): { matrix: string; length: number; height: number };
  /**
   * How to lay a flat top-down drawing — a car sprite — onto the ground when it
   * is rendered outside the svg and cannot take a matrix.
   *
   * Rotation is measured on the car's long axis rather than its width, because a
   * car is longer than it is wide and that is the axis a mis-set angle shows on.
   * The two differ by the 4.3 degrees of shear the yaw introduces, which is
   * invisible at lot scale and is the entire error in this approximation.
   */
  artRotationDeg: number;
  artSquash: number;
}

function makeCamera(scale: number, offsetX: number, offsetY: number, width: number, height: number, panned: boolean): Camera {
  const t = LOT_TILT_DEGREES * RAD;
  const y = LOT_YAW_DEGREES * RAD;
  const ct = Math.cos(t);
  const st = Math.sin(t);
  const cy = Math.cos(y);
  const sy = Math.sin(y);

  const project = (u: number, v: number, z = 0) => ({
    x: (u * cy - v * sy) * scale + offsetX,
    y: ((u * sy + v * cy) * ct - z * st) * scale + offsetY,
  });

  // Rounded so the matrix strings stay short — they are re-emitted on every
  // render of the ground plate. Five places is ~2e-4px of disagreement with
  // `project` at the far edge of the widest lot, which is why `camera.test.ts`
  // checks the two agree to a hundredth of a pixel rather than exactly.
  const fixed = (n: number) => Number(n.toFixed(5));

  return {
    scale,
    width,
    height,
    panned,
    project,

    unproject(x, y) {
      // The yaw part is a rotation, so its inverse is its transpose; the tilt is
      // a plain divide because height is assumed zero.
      const px = (x - offsetX) / scale;
      const py = (y - offsetY) / (scale * ct);
      return { u: px * cy + py * sy, v: -px * sy + py * cy };
    },

    depth: (u, v) => u * sy + v * cy,
    rise: (h) => h * st * scale,

    planeMatrix(z = 0) {
      // x = s*cy*u - s*sy*v + ox
      // y = s*ct*sy*u + s*ct*cy*v + (oy - s*z*st)
      return `matrix(${fixed(scale * cy)},${fixed(scale * ct * sy)},${fixed(-scale * sy)},${fixed(
        scale * ct * cy,
      )},${fixed(offsetX)},${fixed(offsetY - scale * z * st)})`;
    },

    wall(u0, v0, u1, v1, height) {
      const a = project(u0, v0, height);
      const b = project(u1, v1, height);
      const len = Math.hypot(u1 - u0, v1 - v0) || 1;
      const ex = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
      // Screen pixels one local unit covers. Local y uses the same magnitude
      // pointing straight down, which is what keeps the space isotropic —
      // height only ever moves a point down the screen, never sideways.
      const m = Math.hypot(ex.x, ex.y) || 1;
      return {
        matrix: `matrix(${fixed(ex.x)},${fixed(ex.y)},0,${fixed(m)},${fixed(a.x)},${fixed(a.y)})`,
        length: len,
        height: (height * st * scale) / m,
      };
    },

    artRotationDeg: Math.atan2(sy, ct * cy) / RAD,
    artSquash: Math.hypot(sy, ct * cy) / Math.hypot(cy, ct * sy),
  };
}

/**
 * Fit a world to a viewport.
 *
 * `headroom` is how tall the tallest thing in the scene is, in lot units — the
 * projected box has to include the top of the building or the sign gets cropped.
 *
 * `minScale` is the escape hatch. A premium franchise is eleven rows deep, and
 * rotating eleven rows into a phone's width shrinks a car to about 16px, which
 * is not a car. Below `minScale` the camera stops shrinking and reports
 * `panned`, and the screen puts the scene in a horizontal scroller instead.
 */
export function fitCameraToWidth(
  world: WorldRect,
  viewportWidth: number,
  headroom: number,
  minScale = 0,
): Camera {
  const t = LOT_TILT_DEGREES * RAD;
  const y = LOT_YAW_DEGREES * RAD;
  const ct = Math.cos(t);
  const st = Math.sin(t);
  const cy = Math.cos(y);
  const sy = Math.sin(y);

  const raw: { x: number; y: number }[] = [];
  for (const u of [world.u0, world.u1]) {
    for (const v of [world.v0, world.v1]) {
      for (const z of [0, headroom]) {
        raw.push({ x: u * cy - v * sy, y: (u * sy + v * cy) * ct - z * st });
      }
    }
  }

  const minX = Math.min(...raw.map((p) => p.x));
  const maxX = Math.max(...raw.map((p) => p.x));
  const minY = Math.min(...raw.map((p) => p.y));
  const maxY = Math.max(...raw.map((p) => p.y));

  const span = Math.max(1, maxX - minX);
  const fit = Math.max(1, viewportWidth) / span;
  const scale = Math.max(fit, minScale);

  return makeCamera(
    scale,
    -minX * scale,
    -minY * scale,
    span * scale,
    Math.max(1, maxY - minY) * scale,
    scale > fit + 1e-6,
  );
}
