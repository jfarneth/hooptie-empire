import React, { memo, useMemo } from 'react';
import Svg, {
  Circle,
  Defs,
  Ellipse,
  G,
  Path,
  Polygon,
  RadialGradient,
  Rect,
  Stop,
  Text as SvgText,
} from 'react-native-svg';
import type { StageId } from '../../sim/types';
import { theme } from '../theme';
import type { Camera } from './camera';
import {
  PYLON_RESERVE,
  crackPaths,
  environmentFor,
  lightPositions,
  specks,
  stageSeed,
  weedClumps,
  type EnvironmentDef,
} from './environment';
import type { LotLayout } from './layout';
import { neighbourhoodFor, surroundingsFor, type SurroundBounds } from './surroundings';

/**
 * The place the cars are parked on: the neighbourhood, the building, the ground,
 * the paint, the lights, the perimeter and the street.
 *
 * One `Svg` for the whole plate, memoised on the things that change its shape —
 * layout, camera, stage, sign — so it sits still while the cars above it redraw
 * behind the tick. That matters: at a premium franchise this is ~500 elements,
 * and it would be the most expensive thing on screen if it re-rendered at 4Hz.
 *
 * `environment.ts` decides what each store looks like, `surroundings.ts` decides
 * what is next door, `camera.ts` knows how to get any of it onto the screen.
 * This file draws it, in two passes:
 *
 *   FLAT   everything lying on the ground, in one `G` carrying the camera's
 *          plane matrix. All of it is still authored in flat lot coordinates,
 *          which is why the yaw cost the tarmac art nothing.
 *   UPRIGHT everything that stands up, sorted far-to-near and drawn in that
 *          order. A wall gets its own matrix and its facade is drawn as if it
 *          were lying on a page.
 */

interface Props {
  layout: LotLayout;
  camera: Camera;
  world: SurroundBounds;
  stage: StageId;
  /** Shown on the building. The stage's short name. */
  signText: string;
  /** Only a lot that carries its own paper gets the second line. */
  financing: boolean;
  /**
   * Whether this store can open a service department at all — `STAGES[].shop`.
   *
   * Passed in rather than read off `environment.ts`, so the lot can never
   * advertise a department the sim will not let the player have. The
   * environment says how many doors to draw; this says whether there are any.
   */
  hasShop: boolean;
}

/** Something that stands up, with the depth it sorts on. */
interface Upright {
  depth: number;
  node: React.ReactNode;
}

function LotGroundBase({ layout, camera, world, stage, signText, financing, hasShop }: Props) {
  const { width, showroomDepth, frontageY, carScale } = layout;
  const env = environmentFor(stage);
  const neigh = neighbourhoodFor(stage);

  // Derived once per lot shape. Scattering on every render would reshuffle the
  // cracks, and a crack that moves reads as something having happened.
  const scatter = useMemo(() => {
    const seed = stageSeed(stage);
    return {
      grain: specks(seed, width, layout.height, env.grain),
      cracks: crackPaths(seed, width, showroomDepth, frontageY, env.cracks),
      weeds: weedClumps(seed, width, showroomDepth, frontageY, env.weeds),
      lights: lightPositions(env, width, showroomDepth, frontageY),
    };
  }, [stage, width, layout.height, showroomDepth, frontageY, env]);

  const props = useMemo(() => surroundingsFor(stage, world), [stage, world]);

  const stripeW = Math.max(1, (env.stallLine?.width ?? 2) * Math.min(1.2, carScale));

  const uprights: Upright[] = [];

  for (const [i, p] of props.entries()) {
    if (p.kind === 'box') {
      uprights.push({
        depth: camera.depth(p.u + p.du / 2, p.v + p.dv / 2),
        node: <SurroundBox key={`nb_${i}`} prop={p} cam={camera} lightColor={env.lightColor} />,
      });
    } else if (p.kind === 'tree') {
      uprights.push({
        depth: camera.depth(p.u, p.v),
        node: <Tree key={`nt_${i}`} prop={p} cam={camera} />,
      });
    } else if (p.kind === 'pole') {
      uprights.push({
        depth: camera.depth(p.u, p.v),
        node: <UtilityPole key={`np_${i}`} prop={p} cam={camera} />,
      });
    }
  }

  uprights.push({
    depth: camera.depth(width / 2, showroomDepth),
    node: (
      <Building
        key="building"
        env={env}
        layout={layout}
        cam={camera}
        signText={signText}
        financing={financing}
        hasShop={hasShop}
      />
    ),
  });

  for (const [i, light] of scatter.lights.entries()) {
    uprights.push({
      depth: camera.depth(light.x, light.y),
      node: <PoleLight key={`l_${i}`} env={env} cam={camera} at={light} />,
    });
  }

  if (env.airDancer) {
    // Hard against the kerb, which is where they actually stand, and clear of
    // the first stall column. Everything this file draws sits UNDER the car
    // layer, so a tube man in among the stalls has cars drawn over it.
    const at = { u: width * 0.11, v: frontageY - 16 };
    uprights.push({
      depth: camera.depth(at.u, at.v),
      node: <AirDancer key="dancer" cam={camera} at={at} height={300} />,
    });
  }

  uprights.push({
    depth: camera.depth(width / 2, frontageY - 10),
    node: <Perimeter key="perimeter" env={env} layout={layout} cam={camera} />,
  });

  uprights.sort((a, b) => a.depth - b.depth);

  return (
    <Svg
      width={camera.width}
      height={camera.height}
      viewBox={`0 0 ${camera.width} ${camera.height}`}
    >
      <Defs>
        <RadialGradient id="pool" cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={env.lightColor} stopOpacity={0.15} />
          <Stop offset="0.55" stopColor={env.lightColor} stopOpacity={0.05} />
          <Stop offset="1" stopColor={env.lightColor} stopOpacity={0} />
        </RadialGradient>
      </Defs>

      {/* the world beyond the lot, so the corners the yaw opens up are never bare */}
      <Rect width={camera.width} height={camera.height} fill={neigh.ground} />

      <G transform={camera.planeMatrix(0)}>
        {props.map((p, i) =>
          p.kind === 'pad' ? (
            <Rect
              key={`pad_${i}`}
              x={p.u}
              y={p.v}
              width={p.du}
              height={p.dv}
              fill={p.color}
              opacity={p.opacity}
            />
          ) : null,
        )}

        <Rect width={width} height={frontageY} fill={env.ground} />

        <Surface env={env} layout={layout} />

        {/* light pools under the paint, so the paint reads as painted */}
        {scatter.lights.map(({ x, y }, i) => (
          <Circle key={`pool_${i}`} cx={x} cy={y} r={150 * Math.min(1.3, carScale)} fill="url(#pool)" />
        ))}

        {scatter.grain.map((s, i) => (
          <Rect
            key={`g_${i}`}
            x={s.x}
            y={s.y}
            width={s.w}
            height={s.h}
            fill={s.dark ? '#000' : env.grainLight}
            opacity={s.opacity}
          />
        ))}

        {scatter.cracks.map((d, i) => (
          <Path key={`c_${i}`} d={d} stroke="#0b0d11" strokeWidth={1.1} fill="none" opacity={0.5} />
        ))}

        {/* painted stalls */}
        {env.stallLine ? (
          <G opacity={0.9}>
            {layout.slots.map((slot) => {
              const wob = env.stallLine!.wobble;
              const jitter = wob ? ((slot.index * 37) % 100) / 100 - 0.5 : 0;
              const dx = jitter * wob;
              return (
                <G key={slot.index}>
                  <Path
                    d={`M${slot.x + 2 + dx},${slot.y} L${slot.x + 2 - dx},${slot.y + slot.height}`}
                    stroke={env.stallLine!.color}
                    strokeWidth={stripeW}
                    opacity={env.stallLine!.opacity}
                    strokeLinecap="round"
                  />
                  {slot.col === layout.cols - 1 ? (
                    <Path
                      d={`M${slot.x + slot.width - 2 - dx},${slot.y} L${slot.x + slot.width - 2 + dx},${slot.y + slot.height}`}
                      stroke={env.stallLine!.color}
                      strokeWidth={stripeW}
                      opacity={env.stallLine!.opacity}
                      strokeLinecap="round"
                    />
                  ) : null}
                  <Rect
                    x={slot.x + 2}
                    y={slot.y}
                    width={slot.width - 4}
                    height={stripeW}
                    fill={env.stallLine!.color}
                    opacity={env.stallLine!.opacity * 0.65}
                  />
                </G>
              );
            })}
          </G>
        ) : null}

        {scatter.weeds.map((clump, i) => (
          <G key={`w_${i}`} opacity={0.8}>
            {clump.blades.map((b, j) => (
              <Path
                key={j}
                d={`M${clump.x},${clump.y} l${b.dx.toFixed(1)},${b.dy.toFixed(1)}`}
                stroke={env.plantColor}
                strokeWidth={1.1}
              />
            ))}
          </G>
        ))}

        <Frontage env={env} layout={layout} world={world} />
      </G>

      {uprights.map((u) => u.node)}
    </Svg>
  );
}

/* ------------------------------------------------------------ neighbours */

/**
 * A neighbour: a roof plate and the two faces the yaw leaves pointing at the
 * camera. Never more than two — the camera is fixed, so which faces are visible
 * is decided once, here, rather than tested per box.
 */
function SurroundBox({
  prop,
  cam,
  lightColor,
}: {
  prop: Extract<import('./surroundings').SurroundProp, { kind: 'box' }>;
  cam: Camera;
  lightColor: string;
}) {
  const { u, v, du, dv, height, wall, roof, windows } = prop;
  const front = cam.wall(u, v + dv, u + du, v + dv, height);
  const side = cam.wall(u + du, v, u + du, v + dv, height);

  return (
    <G>
      <G transform={cam.planeMatrix(height)}>
        <Rect x={u} y={v} width={du} height={dv} fill={roof} />
        <Rect x={u} y={v} width={du} height={Math.min(8, dv * 0.16)} fill="#000" opacity={0.14} />
      </G>
      <G transform={side.matrix}>
        <Rect width={side.length} height={side.height} fill={shadeOf(wall, -0.3)} />
      </G>
      <G transform={front.matrix}>
        <Rect width={front.length} height={front.height} fill={wall} />
        {Array.from({ length: windows }, (_, i) => (
          <Rect
            key={i}
            x={front.length * ((i + 0.5) / windows) - front.length * 0.055}
            y={front.height * 0.26}
            width={front.length * 0.11}
            height={front.height * 0.3}
            fill={lightColor}
            opacity={0.16}
          />
        ))}
        <Rect y={front.height - 2} width={front.length} height={2} fill="#000" opacity={0.35} />
      </G>
    </G>
  );
}

function Tree({ prop, cam }: { prop: Extract<import('./surroundings').SurroundProp, { kind: 'tree' }>; cam: Camera }) {
  const base = cam.project(prop.u, prop.v);
  const rise = cam.rise(prop.height);
  const r = prop.r * cam.scale;
  return (
    <G>
      <Ellipse cx={base.x} cy={base.y} rx={r * 0.9} ry={r * 0.4} fill="#000" opacity={0.28} />
      <Rect x={base.x - r * 0.11} y={base.y - rise} width={r * 0.22} height={rise} fill={prop.trunk} />
      <Circle cx={base.x} cy={base.y - rise} r={r} fill={prop.color} />
      <Circle cx={base.x - r * 0.3} cy={base.y - rise - r * 0.28} r={r * 0.6} fill={prop.color} opacity={0.55} />
    </G>
  );
}

function UtilityPole({ prop, cam }: { prop: Extract<import('./surroundings').SurroundProp, { kind: 'pole' }>; cam: Camera }) {
  const base = cam.project(prop.u, prop.v);
  const rise = cam.rise(prop.height);
  const w = Math.max(1.6, 3 * cam.scale);
  return (
    <G>
      <Rect x={base.x - w / 2} y={base.y - rise} width={w} height={rise} fill={prop.color} />
      {prop.arm ? (
        <Rect
          x={base.x - w * 4}
          y={base.y - rise + rise * 0.08}
          width={w * 8}
          height={Math.max(1.2, w * 0.5)}
          fill={prop.color}
        />
      ) : null}
    </G>
  );
}

/* ---------------------------------------------------------------- surfaces */

/** Slabs, patches and joints laid over the base colour. Flat: lot coordinates. */
function Surface({ env, layout }: { env: EnvironmentDef; layout: LotLayout }) {
  const { width, showroomDepth, frontageY } = layout;
  const top = showroomDepth;
  const depth = Math.max(0, frontageY - showroomDepth);

  if (env.surface === 'slabs') {
    // A poured apron with control joints, and lawn around the edges.
    //
    // Derived from where the stalls actually are, not from a fraction of the
    // width: the first cut hard-coded the driveway at 14%-46% and the cars
    // parked on the grass beside it, which reads as a bug rather than as
    // curbstoning.
    const left = layout.slots.length ? Math.min(...layout.slots.map((s) => s.x)) - 8 : 12;
    const right = layout.slots.length
      ? Math.max(...layout.slots.map((s) => s.x + s.width)) + 8
      : width - 12;
    return (
      <G>
        <Rect x={left} y={top} width={right - left} height={depth} fill={env.surfaceColor} />
        {Array.from({ length: Math.max(1, layout.cols - 1) }, (_, i) => (
          <Rect
            key={i}
            x={left + ((i + 1) * (right - left)) / layout.cols}
            y={top}
            width={2}
            height={depth}
            fill="#2a2d30"
          />
        ))}
      </G>
    );
  }

  if (env.surface === 'patched') {
    // Broken concrete dropped over gravel, never quite covering it.
    const patches = [
      [0.03, 0.02, 0.44, 0.3],
      [0.5, 0.0, 0.47, 0.33],
      [0.05, 0.42, 0.52, 0.29],
      [0.61, 0.4, 0.36, 0.27],
      [0.12, 0.76, 0.6, 0.22],
    ];
    return (
      <G opacity={0.9}>
        {patches.map(([fx, fy, fw, fh], i) => (
          <Rect
            key={i}
            x={fx * width}
            y={top + fy * depth}
            width={fw * width}
            height={fh * depth}
            fill={env.surfaceColor}
          />
        ))}
      </G>
    );
  }

  if (env.surface === 'joints') {
    // Poured concrete on an expansion-joint grid: deliberate, architectural,
    // and the clearest signal that this is not a tarmac lot any more.
    const cols = 6;
    const rowH = 118;
    const rows = Math.max(1, Math.round(depth / rowH));
    return (
      <G>
        {Array.from({ length: cols + 1 }, (_, i) => (
          <Rect key={`v${i}`} x={(i * width) / cols} y={top} width={1.2} height={depth} fill={env.surfaceColor} />
        ))}
        {Array.from({ length: rows }, (_, i) => (
          <Rect
            key={`h${i}`}
            x={0}
            y={top + ((i + 1) * depth) / rows}
            width={width}
            height={1.2}
            fill={env.surfaceColor}
          />
        ))}
      </G>
    );
  }

  return <Rect y={top} width={width} height={depth} fill={env.surfaceColor} opacity={0.5} />;
}

/* --------------------------------------------------------------- buildings */

/**
 * The store itself: a roof plate at height, the front elevation the camera
 * looks at, and the one side face the yaw reveals.
 *
 * The facade is drawn inside `cam.wall(...)`'s local space, which is isotropic
 * and runs (0,0) at the top-left of the wall to (length, height) at its foot —
 * so this code reads as if the building had been unfolded onto a page, and the
 * matrix puts it back on the wall. That is the whole reason the yaw did not cost
 * the six storefronts a rewrite.
 */
/**
 * Any planar quad in lot space, as svg polygon points.
 *
 * This is the seam that lets the buildings be more than boxes. `planeMatrix`
 * covers horizontal planes and `wall` covers vertical ones, which between them
 * cannot draw a pitched roof, a canopy soffit or the sloping face of anything.
 * An ORTHOGRAPHIC camera maps every plane affinely — that is the same property
 * the whole ground plate leans on — so a planar quad projects to a quad and
 * four calls to `project` are the whole of it. Three corners give a triangle,
 * which is what a gable end is.
 */
function quad(cam: Camera, corners: [number, number, number][]): string {
  return corners
    .map(([u, v, z]) => {
      const p = cam.project(u, v, z);
      return `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
    })
    .join(' ');
}

/**
 * A rectangular box standing on the ground, drawn as the three faces this
 * camera can see: the top, the front, and the right-hand side the yaw turns
 * toward us.
 *
 * Chimneys, roof plant, canopy slabs, columns, kerb blocks and sign bases are
 * all this shape, and each of them was a bespoke pile of rects before.
 */
function Box3D({
  cam,
  u0,
  v0,
  u1,
  v1,
  z0,
  z1,
  color,
}: {
  cam: Camera;
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  z0: number;
  z1: number;
  color: string;
}) {
  return (
    <G>
      <Polygon
        points={quad(cam, [
          [u0, v0, z1],
          [u1, v0, z1],
          [u1, v1, z1],
          [u0, v1, z1],
        ])}
        fill={shadeOf(color, 0.1)}
      />
      <Polygon
        points={quad(cam, [
          [u0, v1, z1],
          [u1, v1, z1],
          [u1, v1, z0],
          [u0, v1, z0],
        ])}
        fill={color}
      />
      <Polygon
        points={quad(cam, [
          [u1, v0, z1],
          [u1, v1, z1],
          [u1, v1, z0],
          [u1, v0, z0],
        ])}
        fill={shadeOf(color, -0.28)}
      />
    </G>
  );
}

function Building({
  env,
  layout,
  cam,
  signText,
  financing,
  hasShop,
}: {
  env: EnvironmentDef;
  layout: LotLayout;
  cam: Camera;
  signText: string;
  financing: boolean;
  hasShop: boolean;
}) {
  const { width, showroomDepth: d } = layout;
  const sign = env.signColor ?? theme.colors.accent;
  const h = env.buildingHeight;

  const x0 = 6;
  const x1 = width - 6;
  const front = cam.wall(x0, d, x1, d, h);
  const side = cam.wall(x1, 0, x1, d, h);
  /** Where the facade has to stop so it does not run under the pylon. */
  const usable = front.length - PYLON_RESERVE;

  return (
    <G>
      <Roof env={env} cam={cam} x0={x0} x1={x1} d={d} h={h} />

      {/* the side the yaw turned toward us */}
      <G transform={side.matrix}>
        <Rect width={side.length} height={side.height} fill={shadeOf(env.wall, -0.32)} />
        <Rect width={side.length} height={2} fill={env.trim} opacity={0.5} />
        {env.building === 'house' ? (
          // Siding wraps the corner. Without it the gable end reads as a flat
          // card stood on edge rather than as the end of a house.
          <G opacity={0.3}>
            {Array.from({ length: 9 }, (_, i) => (
              <Rect
                key={i}
                y={side.height * (0.12 + i * 0.09)}
                width={side.length}
                height={1}
                fill="#000"
              />
            ))}
          </G>
        ) : null}
      </G>

      {/* the front elevation */}
      <G transform={front.matrix}>
        <Rect width={front.length} height={front.height} fill={shadeOf(env.wall, 0.06)} />
        <Rect width={front.length} height={2.5} fill={env.trim} />
        <Rect y={front.height - 2.5} width={front.length} height={2.5} fill="#000" opacity={0.4} />
        <Facade
          env={env}
          layout={layout}
          wallLength={front.length}
          wallHeight={front.height}
          usable={usable}
          signText={signText}
          financing={financing}
          sign={sign}
          hasShop={hasShop}
        />
      </G>

      {/* Anything that stands FORWARD of the elevation, on the tarmac. */}
      <Entrance env={env} layout={layout} cam={cam} h={h} sign={sign} />

      {env.building === 'shack' ? (
        <Board cam={cam} layout={layout} signText={signText} financing={financing} />
      ) : null}
      {env.building === 'house' ? (
        <YardSign cam={cam} layout={layout} signText={signText} />
      ) : null}
    </G>
  );
}

/**
 * What is on top.
 *
 * The gable is the whole reason `quad` exists. A pitched roof is the strongest
 * single signal that a building is somebody's HOUSE — a flat-roofed box with a
 * garage door reads as a small warehouse no matter what colour it is painted,
 * which is exactly what the curbstone stage looked like — and it is two sloped
 * planes, a triangle and a ridge board.
 */
function Roof({
  env,
  cam,
  x0,
  x1,
  d,
  h,
}: {
  env: EnvironmentDef;
  cam: Camera;
  x0: number;
  x1: number;
  d: number;
  h: number;
}) {
  const fill = env.roofColor ?? shadeOf(env.wall, -0.18);

  if (env.roof === 'gable') {
    const r = env.ridge;
    // Eaves overhang the walls. A roof flush with its walls is a model of a
    // house; the overhang and the shadow under it are what make it a house.
    const a0 = x0 - 11;
    const a1 = x1 + 11;
    const vb = -10;
    const vf = d + 10;
    const mid = d / 2;
    const courses = 7;

    return (
      <G>
        {/* Back slope first: it is the far side of the ridge. */}
        <Polygon
          points={quad(cam, [
            [a0, vb, h],
            [a1, vb, h],
            [a1, mid, h + r],
            [a0, mid, h + r],
          ])}
          fill={shadeOf(fill, -0.26)}
        />
        <Polygon
          points={quad(cam, [
            [a0, vf, h],
            [a1, vf, h],
            [a1, mid, h + r],
            [a0, mid, h + r],
          ])}
          fill={fill}
        />
        {/* Shingle courses, running along the eave. */}
        {Array.from({ length: courses }, (_, i) => {
          const t = (i + 1) / (courses + 1);
          const v = vf + (mid - vf) * t;
          const z = h + r * t;
          return (
            <Polygon
              key={i}
              points={quad(cam, [
                [a0, v, z],
                [a1, v, z],
                [a1, v - 2.4, z],
                [a0, v - 2.4, z],
              ])}
              fill="#000"
              opacity={0.16}
            />
          );
        })}
        {/* The gable end the yaw turns toward us. */}
        <Polygon
          points={quad(cam, [
            [a1 - 11, vb + 10, h],
            [a1 - 11, vf - 10, h],
            [a1 - 11, mid, h + r],
          ])}
          fill={shadeOf(env.wall, -0.24)}
        />
        {/* A vent in the gable, which is a detail every house in America has. */}
        <Polygon
          points={quad(cam, [
            [a1 - 10, mid - 9, h + r * 0.34],
            [a1 - 10, mid + 9, h + r * 0.34],
            [a1 - 10, mid, h + r * 0.72],
          ])}
          fill="#22201d"
        />
        {/* Ridge board. */}
        <Polygon
          points={quad(cam, [
            [a0, mid - 2.5, h + r],
            [a1, mid - 2.5, h + r],
            [a1, mid + 2.5, h + r],
            [a0, mid + 2.5, h + r],
          ])}
          fill={shadeOf(fill, 0.16)}
        />
        <Box3D
          cam={cam}
          u0={x0 + 26}
          v0={mid - 12}
          u1={x0 + 48}
          v1={mid + 12}
          z0={h}
          z1={h + r + 42}
          color="#4a4038"
        />
      </G>
    );
  }

  return (
    <G>
      <G transform={cam.planeMatrix(h)}>
        <Rect x={x0} y={0} width={x1 - x0} height={d} fill={fill} />
        {/* Roof plant. Every flat commercial roof has some. */}
        {[0.2, 0.52, 0.78].map((f, i) => (
          <Rect
            key={i}
            x={x0 + (x1 - x0) * f - 16}
            y={d * 0.3}
            width={32}
            height={d * 0.26}
            rx={2}
            fill={shadeOf(env.wall, -0.34)}
          />
        ))}
        {Array.from({ length: 4 }, (_, i) => (
          <Rect
            key={`seam${i}`}
            x={x0 + ((i + 1) * (x1 - x0)) / 5}
            y={0}
            width={1.2}
            height={d}
            fill="#000"
            opacity={0.13}
          />
        ))}
      </G>

      {/* A parapet: the roof edge carried up past the deck, with a coping band
          along the top. It is what separates a built-to-suit dealership from a
          shed with a flat roof, and it costs two quads. */}
      {env.roof === 'parapet' ? (
        <G>
          <Box3D cam={cam} u0={x0} v0={d - 5} u1={x1} v1={d} z0={h} z1={h + 26} color={shadeOf(env.wall, 0.1)} />
          <Box3D cam={cam} u0={x1 - 5} v0={0} u1={x1} v1={d} z0={h} z1={h + 26} color={shadeOf(env.wall, -0.1)} />
          <Polygon
            points={quad(cam, [
              [x0, d - 5, h + 26],
              [x1, d - 5, h + 26],
              [x1, d, h + 26],
              [x0, d, h + 26],
            ])}
            fill={env.trim}
            opacity={0.85}
          />
        </G>
      ) : null}
    </G>
  );
}

/**
 * Where a house's garage and front door sit, in the wall's own coordinates.
 *
 * Shared by the elevation and by the stoop that stands in front of it. The
 * garage lines up on the driveway it opens onto, which is the same strip of
 * tarmac the cars are parked in, so it moves with the lot.
 */
function houseOpenings(layout: LotLayout, wallLength: number) {
  const driveL = layout.slots.length ? Math.min(...layout.slots.map((s) => s.x)) - 8 : 60;
  const driveR = layout.slots.length
    ? Math.max(...layout.slots.map((s) => s.x + s.width)) + 8
    : wallLength - 60;
  const garageW = Math.min(driveR - driveL, wallLength * 0.5);
  const garageX = driveL + (driveR - driveL - garageW) / 2;
  const doorW = wallLength * 0.075;
  const doorX = garageX + garageW + Math.max(12, (wallLength - garageX - garageW) * 0.18);
  return { garageX, garageW, doorX, doorW };
}

/** What is on the front wall, in the wall's own flat coordinates. */
function Facade({
  env,
  layout,
  wallLength,
  wallHeight,
  usable,
  signText,
  financing,
  sign,
  hasShop,
}: {
  env: EnvironmentDef;
  layout: LotLayout;
  wallLength: number;
  wallHeight: number;
  usable: number;
  signText: string;
  financing: boolean;
  sign: string;
  hasShop: boolean;
}) {
  if (env.building === 'house') {
    const { garageX, garageW, doorX, doorW } = houseOpenings(layout, wallLength);

    // A HOUSE, and nothing on it says otherwise. The store's name used to be
    // painted across the front in letters a foot high, which is the one thing
    // guaranteed to stop a building reading as somebody's home — a curbstoner's
    // whole business model is that this is NOT a dealership. It is on a
    // hand-lettered board staked in the lawn instead, which is where it goes.
    const doorY = wallHeight * 0.34;

    return (
      <G>
        {/* Lap siding. Horizontal shadow lines are most of what says "house". */}
        <G opacity={0.26}>
          {Array.from({ length: 11 }, (_, i) => (
            <Rect
              key={`sid${i}`}
              y={wallHeight * (0.06 + i * 0.085)}
              width={wallLength}
              height={1.2}
              fill="#000"
            />
          ))}
        </G>

        {/* The garage, lined up on the driveway the cars are parked in. */}
        <Rect
          x={garageX}
          y={wallHeight * 0.3}
          width={garageW}
          height={wallHeight * 0.64}
          fill="#2f2823"
          stroke={shadeOf(env.trim, 0.1)}
          strokeWidth={2.5}
        />
        {Array.from({ length: 4 }, (_, i) => (
          <Rect
            key={i}
            x={garageX + 2}
            y={wallHeight * (0.42 + i * 0.13)}
            width={garageW - 4}
            height={1.6}
            fill="#171310"
          />
        ))}

        {/* Front door, with a light over it and a number beside it. */}
        <Rect x={doorX} y={doorY} width={doorW} height={wallHeight * 0.6} fill="#3d2f24" stroke={env.trim} strokeWidth={2} />
        <Circle cx={doorX + doorW * 0.78} cy={doorY + wallHeight * 0.3} r={1.8} fill="#c9b380" />
        <Rect x={doorX - 7} y={doorY - 9} width={5} height={7} rx={2.5} fill={env.lightColor} opacity={0.85} />
        <Circle cx={doorX - 4.5} cy={doorY + wallHeight * 0.16} r={wallHeight * 0.2} fill={env.lightColor} opacity={0.08} />

        {/* Two windows, lit. A dark house at night reads as abandoned. */}
        {[wallLength * 0.05, wallLength * 0.05 + wallHeight * 0.34].map((x, i) => (
          <G key={`win${i}`}>
            <Rect x={x} y={wallHeight * 0.3} width={wallHeight * 0.26} height={wallHeight * 0.3} fill="#3a3d2c" stroke={shadeOf(env.trim, 0.16)} strokeWidth={2.5} />
            <Rect x={x + wallHeight * 0.125} y={wallHeight * 0.3} width={1.6} height={wallHeight * 0.3} fill={shadeOf(env.trim, 0.16)} />
            <Rect x={x} y={wallHeight * 0.44} width={wallHeight * 0.26} height={1.6} fill={shadeOf(env.trim, 0.16)} />
            {/* Sill. */}
            <Rect x={x - 3} y={wallHeight * 0.6} width={wallHeight * 0.26 + 6} height={3} fill={shadeOf(env.trim, 0.2)} />
          </G>
        ))}
      </G>
    );
  }

  if (env.building === 'shack') {
    // A SINGLE-WIDE OFFICE TRAILER, which is what a roadside buy-here-pay-here
    // lot actually operates out of. The board out front carries the name, so
    // this is just the office: skirting to the ground, a door up three steps,
    // two windows and a window air conditioner.
    const skirt = wallHeight * 0.78;
    return (
      <G>
        {/* Ribbed metal siding. */}
        <G opacity={0.22}>
          {Array.from({ length: 22 }, (_, i) => (
            <Rect key={`rib${i}`} x={(wallLength * (i + 0.5)) / 22} y={0} width={1.4} height={skirt} fill="#000" />
          ))}
        </G>
        {/* Skirting: the trailer does not reach the ground, it is boxed in. */}
        <Rect y={skirt} width={wallLength} height={wallHeight - skirt} fill={shadeOf(env.wall, -0.34)} />
        <Rect y={skirt} width={wallLength} height={2} fill="#000" opacity={0.4} />

        {[wallLength * 0.08, wallLength * 0.24].map((x, i) => (
          <G key={`w${i}`}>
            <Rect x={x} y={wallHeight * 0.22} width={wallLength * 0.11} height={wallHeight * 0.34} fill="#33414b" stroke={env.trim} strokeWidth={1.5} />
            <Rect x={x} y={wallHeight * 0.22} width={wallLength * 0.11} height={wallHeight * 0.34} fill={env.lightColor} opacity={0.1} />
          </G>
        ))}
        <Rect x={wallLength * 0.42} y={wallHeight * 0.2} width={wallLength * 0.07} height={wallHeight * 0.58} fill="#2a2620" stroke={env.trim} strokeWidth={1.5} />
        {/* The window unit, dripping onto the tarmac since 1994. */}
        <Rect x={wallLength * 0.58} y={wallHeight * 0.3} width={wallLength * 0.07} height={wallHeight * 0.16} fill="#6b6b66" stroke="#2a2620" strokeWidth={1.5} />
      </G>
    );
  }

  if (env.building === 'brick') {
    // A REAL BUILDING, and that is the whole step up from the trailer. Still
    // cheap: painted block, a sign band screwed to the parapet, one showroom
    // window. No service bays — the sim does not open a shop until the first
    // franchise, and a lot must never advertise a department the player cannot
    // have.
    const bandH = wallHeight * 0.24;
    const glassW = usable * 0.44;
    return (
      <G>
        {/* Block courses. */}
        <G opacity={0.18}>
          {Array.from({ length: 9 }, (_, i) => (
            <Rect key={`c${i}`} y={bandH + ((wallHeight - bandH) * (i + 1)) / 10} width={wallLength} height={1.2} fill="#000" />
          ))}
        </G>

        {/* Sign band across the top, in the marque colour. */}
        <Rect width={usable} height={bandH} fill={shadeOf(sign, -0.55)} />
        <Rect y={bandH - 2} width={usable} height={2} fill={sign} opacity={0.5} />
        <SvgText
          x={usable / 2}
          y={bandH * 0.68}
          fontSize={bandH * 0.52}
          fontWeight="800"
          fill={sign}
          textAnchor="middle"
          letterSpacing={2.4}
        >
          {signText.toUpperCase()}
        </SvgText>

        <Rect x={14} y={bandH + wallHeight * 0.1} width={glassW} height={wallHeight * 0.4} fill="#2f4a63" stroke={env.trim} strokeWidth={1.5} />
        {Array.from({ length: 3 }, (_, i) => (
          <Rect key={i} x={14 + ((i + 1) * glassW) / 4} y={bandH + wallHeight * 0.1} width={1.4} height={wallHeight * 0.4} fill={env.trim} opacity={0.6} />
        ))}
        <Rect x={14} y={bandH + wallHeight * 0.1} width={glassW} height={wallHeight * 0.4} fill={env.lightColor} opacity={0.07} />

        <Rect x={usable * 0.62} y={bandH + wallHeight * 0.12} width={wallLength * 0.06} height={wallHeight * 0.5} fill="#2a2620" stroke={env.trim} strokeWidth={1.5} />

        {financing ? (
          <SvgText x={14} y={wallHeight - 7} fontSize={8} fontWeight="700" fill={theme.colors.textDim} letterSpacing={1.8}>
            BUY HERE · PAY HERE
          </SvgText>
        ) : null}
      </G>
    );
  }

  // The three franchises. THE ONE THING THAT CLIMBS IS GLASS: a dealership gets
  // more expensive almost entirely by replacing wall with window, so `glazing`
  // carries the whole progression and the wall colours barely move.
  const flagship = env.building === 'flagship';
  // Bays are the STORE's fact, never the artwork's — see `hasShop`.
  const bayCount = hasShop ? env.bays : 0;
  const bayW = bayCount ? Math.min(38, (usable * 0.34) / bayCount) : 0;
  const bayBlock = bayCount * (bayW + 5);
  const bayX = usable - bayBlock - 4;

  const glassInset = flagship ? 8 : 14;
  const glassW = Math.max(40, (bayCount ? bayX - 12 : usable) - glassInset);
  const glassH = wallHeight * env.glazing;
  const glassTop = wallHeight - glassH - wallHeight * (flagship ? 0.05 : 0.16);
  const panes = Math.round(4 + env.glazing * 8);

  return (
    <G>
      {/* Fascia band above the glass, where the name goes. */}
      <Rect width={usable} height={glassTop - 4} fill={shadeOf(env.wall, flagship ? 0.14 : 0.02)} />
      <Rect y={glassTop - 6} width={usable} height={2.5} fill={env.trim} opacity={0.7} />

      {/* Uplighting: fans of light thrown UP the fascia from fittings in the
          kerb. This is the difference between an expensive building and a big
          one, and it is the reason `lightHeight` drops at the top of the ladder
          rather than climbing — a flagship stops lighting its lot from masts
          and starts lighting its own wall. */}
      {env.light === 'uplight' ? (
        <G>
          {[0.1, 0.28, 0.46, 0.64, 0.82].map((f, i) => (
            <Path
              key={`up${i}`}
              d={
                `M${usable * f - 13},${glassTop - 6}` +
                ` L${usable * f + 13},${glassTop - 6}` +
                ` L${usable * f + 6},1 L${usable * f - 6},1 Z`
              }
              fill={env.lightColor}
              opacity={0.08}
            />
          ))}
        </G>
      ) : null}

      <Rect x={glassInset} y={glassTop} width={glassW} height={glassH} fill={flagship ? '#1d3a52' : '#2f4a63'} stroke={env.trim} strokeWidth={flagship ? 2 : 1.5} />
      {Array.from({ length: panes }, (_, i) => (
        <Rect
          key={i}
          x={glassInset + ((i + 1) * glassW) / (panes + 1)}
          y={glassTop}
          width={flagship ? 1.1 : 1.4}
          height={glassH}
          fill={env.trim}
          opacity={flagship ? 0.45 : 0.6}
        />
      ))}
      {/* Showroom light spilling out, and the floor visible through the glass.
          A lit interior is what separates an open dealership from a closed one. */}
      <Rect x={glassInset} y={glassTop + glassH * 0.72} width={glassW} height={glassH * 0.28} fill={env.lightColor} opacity={flagship ? 0.13 : 0.08} />
      {[0.2, 0.5, 0.8].map((f, i) => (
        <Circle key={`glow${i}`} cx={glassInset + f * glassW} cy={glassTop + glassH * 0.5} r={glassH * 0.34} fill={env.lightColor} opacity={flagship ? 0.11 : 0.08} />
      ))}

      {bayCount ? (
        <G>
          {Array.from({ length: bayCount }, (_, i) => {
            const x = bayX + i * (bayW + 5);
            return (
              <G key={`bay${i}`}>
                <Rect x={x} y={glassTop} width={bayW} height={glassH} fill="#191d24" stroke={shadeOf(env.trim, -0.2)} strokeWidth={1.5} />
                {Array.from({ length: 5 }, (_, j) => (
                  <Rect key={j} x={x + 2} y={glassTop + 3 + (j * (glassH - 6)) / 5} width={bayW - 4} height={1.4} fill="#39404c" />
                ))}
              </G>
            );
          })}
          <SvgText
            x={bayX + bayBlock / 2}
            y={glassTop - 9}
            fontSize={7.5}
            fontWeight="700"
            fill={theme.colors.textFaint}
            textAnchor="middle"
            letterSpacing={1.4}
          >
            SERVICE
          </SvgText>
        </G>
      ) : null}

      <SvgText
        x={flagship ? usable / 2 : glassInset + 4}
        y={glassTop - (flagship ? 16 : 12)}
        fontSize={flagship ? 18 : 14}
        fontWeight="800"
        fill={sign}
        textAnchor={flagship ? 'middle' : 'start'}
        letterSpacing={flagship ? 6 : 1.8}
      >
        {signText.toUpperCase()}
      </SvgText>
      {financing && !flagship ? (
        <SvgText x={glassInset + 4} y={wallHeight - 6} fontSize={7.5} fontWeight="700" fill={theme.colors.textDim} letterSpacing={1.6}>
          BUY HERE · PAY HERE
        </SvgText>
      ) : null}
    </G>
  );
}

/**
 * The shack's hand-painted board, standing on two posts in front of the office.
 *
 * Its own upright rather than part of the elevation: it stands forward of the
 * building on the tarmac, and at this angle that difference is visible.
 */
function Board({
  cam,
  layout,
  signText,
  financing,
}: {
  cam: Camera;
  layout: LotLayout;
  signText: string;
  financing: boolean;
}) {
  const v = layout.showroomDepth + 8;
  const u0 = layout.width * 0.5;
  const u1 = layout.width - PYLON_RESERVE - 8;
  const board = cam.wall(u0, v, u1, v, 150);
  const postTop = cam.project(u0 + 10, v, 150);
  const postBase = cam.project(u0 + 10, v, 0);
  const post2Top = cam.project(u1 - 10, v, 150);
  const post2Base = cam.project(u1 - 10, v, 0);
  const postW = Math.max(1.5, 4.5 * cam.scale);

  return (
    <G>
      <Rect x={postTop.x - postW / 2} y={postTop.y} width={postW} height={postBase.y - postTop.y} fill="#3a3128" />
      <Rect x={post2Top.x - postW / 2} y={post2Top.y} width={postW} height={post2Base.y - post2Top.y} fill="#3a3128" />
      <G transform={board.matrix}>
        <Rect width={board.length} height={board.height * 0.42} fill="#5c4a33" stroke="#33291c" strokeWidth={3} />
        <SvgText
          x={board.length / 2}
          y={board.height * (financing ? 0.2 : 0.26)}
          fontSize={board.height * 0.14}
          fontWeight="700"
          fill="#e8dcc0"
          textAnchor="middle"
        >
          {signText.toUpperCase()}
        </SvgText>
        {financing ? (
          <SvgText x={board.length / 2} y={board.height * 0.34} fontSize={board.height * 0.085} fill="#d8c9a4" textAnchor="middle" letterSpacing={1}>
            BUY HERE · PAY HERE
          </SvgText>
        ) : null}
      </G>
    </G>
  );
}

/**
 * The bit of the building that stands forward of its own front wall.
 *
 * A canopy over the doors is the cheapest thing a building can do to stop
 * reading as a box, and it is what actually separates the three franchises from
 * the two used lots in a glance: none of them has one, all of them do.
 */
function Entrance({
  env,
  layout,
  cam,
  h,
  sign,
}: {
  env: EnvironmentDef;
  layout: LotLayout;
  cam: Camera;
  h: number;
  sign: string;
}) {
  const { width, showroomDepth: d } = layout;
  const x0 = 6;
  const x1 = width - 6;

  if (env.entrance === 'porch') {
    // Three steps and a slab, UNDER THE FRONT DOOR. A wall's local x is its lot
    // u less the building's inset — `cam.wall` measures its length in lot units
    // — so the elevation and the tarmac can share one answer for where the door
    // is. They did not, and the stoop sat half a house away from it.
    const { doorX, doorW } = houseOpenings(layout, x1 - x0);
    const u = x0 + doorX - 7;
    return (
      <G>
        <Box3D cam={cam} u0={u} v0={d} u1={u + doorW + 14} v1={d + 24} z0={0} z1={16} color="#4a443c" />
        <Box3D cam={cam} u0={u + 5} v0={d + 24} u1={u + doorW + 9} v1={d + 32} z0={0} z1={9} color="#524b42" />
      </G>
    );
  }

  if (env.entrance === 'stoop') {
    const u = x0 + (x1 - x0) * 0.42;
    return <Box3D cam={cam} u0={u} v0={d} u1={u + 40} v1={d + 22} z0={0} z1={14} color="#3d3a34" />;
  }

  const portico = env.entrance === 'portico';
  const span = Math.min(portico ? 210 : 150, (x1 - x0) * (portico ? 0.5 : 0.42));
  const u = x0 + (x1 - x0) * 0.05;
  const depth = portico ? 62 : 42;
  const deck = h * (portico ? 0.8 : 0.58);
  const posts = portico ? 4 : 2;
  const postW = portico ? 13 : 7;

  return (
    <G>
      {Array.from({ length: posts }, (_, i) => {
        const pu = u + 6 + ((span - 12 - postW) * i) / (posts - 1);
        return (
          <Box3D
            key={i}
            cam={cam}
            u0={pu}
            v0={d + depth - postW - 4}
            u1={pu + postW}
            v1={d + depth - 4}
            z0={0}
            z1={deck}
            color={shadeOf(env.trim, portico ? 0.1 : -0.2)}
          />
        );
      })}
      {/* The slab. A portico's is deep enough to throw a soffit, which is why
          it gets an underside in its own shade rather than just a top. */}
      <Box3D
        cam={cam}
        u0={u}
        v0={d}
        u1={u + span}
        v1={d + depth}
        z0={deck}
        z1={deck + (portico ? 22 : 13)}
        color={portico ? shadeOf(env.wall, 0.2) : shadeOf(env.wall, 0.08)}
      />
      {portico ? (
        <Polygon
          points={quad(cam, [
            [u + 3, d + depth - 3, deck],
            [u + span - 3, d + depth - 3, deck],
            [u + span - 3, d + 3, deck],
            [u + 3, d + 3, deck],
          ])}
          fill={sign}
          opacity={0.14}
        />
      ) : null}
    </G>
  );
}

/**
 * A hand-lettered board on two stakes in the front yard.
 *
 * This is where the curbstone stage's name lives, and it has to be here rather
 * than on the building: a curbstoner's entire position is that this is NOT a
 * dealership, so the store's name painted across the front of the house in
 * letters a foot high is the one thing that would break the joke.
 */
function YardSign({
  cam,
  layout,
  signText,
}: {
  cam: Camera;
  layout: LotLayout;
  signText: string;
}) {
  const v = layout.showroomDepth + 40;
  const u0 = 14;
  const u1 = 14 + Math.min(150, layout.width * 0.34);
  const board = cam.wall(u0, v, u1, v, 96);
  const stake = (u: number) => {
    const top = cam.project(u, v, 62);
    const base = cam.project(u, v, 0);
    const w = Math.max(1.2, 3 * cam.scale);
    return <Rect x={top.x - w / 2} y={top.y} width={w} height={base.y - top.y} fill="#4a3f30" />;
  };

  return (
    <G>
      {stake(u0 + 10)}
      {stake(u1 - 10)}
      <G transform={board.matrix}>
        <Rect width={board.length} height={board.height * 0.46} fill="#c9bb92" stroke="#6d5f42" strokeWidth={2.5} />
        <SvgText
          x={board.length / 2}
          y={board.height * 0.2}
          fontSize={board.height * 0.15}
          fontWeight="800"
          fill="#3a3226"
          textAnchor="middle"
        >
          {signText.toUpperCase()}
        </SvgText>
        <SvgText
          x={board.length / 2}
          y={board.height * 0.35}
          fontSize={board.height * 0.1}
          fontWeight="700"
          fill="#5c5140"
          textAnchor="middle"
        >
          CARS 4 SALE
        </SvgText>
      </G>
    </G>
  );
}

/**
 * The inflatable tube man.
 *
 * Exactly one store on the ladder gets one, and it is the large used lot: the
 * rung where the operator has enough money to advertise and not enough taste to
 * stop. It is drawn as a wavy stroke because that is what it is — the shape is
 * the whole joke, and it does not need to move to land.
 */
function AirDancer({ cam, at, height }: { cam: Camera; at: { u: number; v: number }; height: number }) {
  const base = cam.project(at.u, at.v);
  const rise = cam.rise(height);
  const w = Math.max(5, 11 * cam.scale);
  const y = (f: number) => base.y - rise * f;
  const sway = rise * 0.12;

  // One long S, so the tube reads as caught mid-flail rather than as a post.
  const spine =
    `M${base.x},${base.y}` +
    ` C${base.x - sway},${y(0.3)} ${base.x + sway * 1.4},${y(0.5)} ${base.x + sway * 0.5},${y(0.72)}` +
    ` C${base.x - sway * 0.4},${y(0.86)} ${base.x + sway * 0.9},${y(0.94)} ${base.x + sway * 1.5},${y(1)}`;

  return (
    <G>
      <Ellipse cx={base.x} cy={base.y} rx={w * 0.9} ry={w * 0.35} fill="#000" opacity={0.4} />
      <Path d={spine} stroke="#e8574a" strokeWidth={w} fill="none" strokeLinecap="round" />
      <Path d={spine} stroke="#ffd166" strokeWidth={w * 0.34} fill="none" strokeLinecap="round" opacity={0.85} />
      {/* Arms, thrown the way the top of the tube is leaning. */}
      <Path
        d={`M${base.x + sway * 0.5},${y(0.72)} C${base.x + sway * 2.6},${y(0.78)} ${base.x + sway * 3},${y(0.62)} ${base.x + sway * 2.2},${y(0.52)}`}
        stroke="#e8574a"
        strokeWidth={w * 0.55}
        fill="none"
        strokeLinecap="round"
      />
      <Path
        d={`M${base.x + sway * 0.4},${y(0.7)} C${base.x - sway * 2.2},${y(0.8)} ${base.x - sway * 2.8},${y(0.9)} ${base.x - sway * 1.6},${y(0.97)}`}
        stroke="#e8574a"
        strokeWidth={w * 0.55}
        fill="none"
        strokeLinecap="round"
      />
      {/* The blower it is bolted to. */}
      <Rect x={base.x - w * 0.8} y={base.y - w * 0.5} width={w * 1.6} height={w * 0.6} rx={1.5} fill="#2f3540" />
    </G>
  );
}

/** Nudge a hex colour lighter or darker, for the fold between roof and wall. */
function shadeOf(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (c: number) =>
    Math.max(0, Math.min(255, Math.round(amount > 0 ? c + (255 - c) * amount : c * (1 + amount))));
  const to2 = (v: number) => v.toString(16).padStart(2, '0');
  return `#${to2(ch((n >> 16) & 255))}${to2(ch((n >> 8) & 255))}${to2(ch(n & 255))}`;
}

/* ------------------------------------------------------------------ lights */

/**
 * A pole light, standing up out of the tarmac.
 *
 * The base stays exactly where the light pool is and the mast rises straight up
 * the screen: height has no sideways component under this camera, which is what
 * lets a mast still be "a rect from the base going up" after the yaw.
 */
function PoleLight({ env, cam, at }: { env: EnvironmentDef; cam: Camera; at: { x: number; y: number } }) {
  const base = cam.project(at.x, at.y);
  const mast = cam.rise(env.lightHeight);
  const w = Math.max(1.4, 2.8 * cam.scale);

  if (env.light === 'uplight' || mast < 4) {
    // Ground-recessed uplights have nothing to stand up.
    return <Rect x={base.x - 3} y={base.y - 3} width={6} height={6} rx={1} fill={env.lightColor} />;
  }

  return (
    <G>
      <Ellipse cx={base.x} cy={base.y} rx={5} ry={2} fill="#000" opacity={0.45} />
      <Rect x={base.x - w / 2} y={base.y - mast} width={w} height={mast} fill="#2b323f" />
      <Rect x={base.x - w / 2} y={base.y - mast} width={w * 0.42} height={mast} fill="#3d4757" />
      <Rect x={base.x - 5} y={base.y - mast - 3} width={10} height={4} rx={1.6} fill="#2a3040" stroke="#4a5568" strokeWidth={1} />
      <Circle cx={base.x} cy={base.y - mast - 1} r={2.2} fill={env.lightColor} />
    </G>
  );
}

/* --------------------------------------------------------------- frontage */

/**
 * The flat half of the street: kerb, pavement, road, planting bed.
 *
 * Runs the full width of the world rather than the width of the lot. A road that
 * stops dead at the property line is the single thing that most gives away that
 * the neighbourhood is scenery — and at this angle both ends of it are on screen.
 */
function Frontage({ env, layout, world }: { env: EnvironmentDef; layout: LotLayout; world: SurroundBounds }) {
  const { width, frontageY: y, frontageDepth } = layout;
  const walk = 22;
  const road = frontageDepth - walk - 8;
  const x0 = world.u0;
  const span = world.u1 - world.u0;

  return (
    <G>
      {env.perimeter === 'planting' || env.perimeter === 'planters' || env.perimeter === 'manicured' ? (
        <G>
          <Rect y={y - 14} width={width} height={14} fill={env.perimeter === 'planting' ? '#2c3a2c' : '#2a3a30'} />
          {env.perimeter !== 'planting'
            ? [0.1, 0.3, 0.5, 0.72, 0.92].map((f, i) => (
                <Circle key={i} cx={f * width} cy={y - 7} r={7} fill={env.plantColor} stroke="#20362a" strokeWidth={1.5} />
              ))
            : null}
        </G>
      ) : null}

      <Rect x={x0} y={y} width={span} height={8} fill={env.perimeter === 'lawn' ? env.verge : '#606874'} />
      <Rect x={x0} y={y + 8} width={span} height={walk} fill={env.verge} />
      <Rect x={x0} y={y + 8 + walk} width={span} height={road} fill={env.road} />
      {Array.from({ length: Math.ceil(span / 86) }, (_, i) => (
        <Rect
          key={`lane${i}`}
          x={x0 + i * 86 + 12}
          y={y + 8 + walk + road / 2 - 2}
          width={46}
          height={3.5}
          fill={env.laneMark}
          opacity={env.laneOpacity}
        />
      ))}
    </G>
  );
}

/** The upright half: chain-link and bunting. Nearest thing in the scene. */
function Perimeter({ env, layout, cam }: { env: EnvironmentDef; layout: LotLayout; cam: Camera }) {
  const { width, frontageY } = layout;
  const v = frontageY - 8;

  return (
    <G>
      <Fence env={env} layout={layout} cam={cam} />
      {env.bunting ? <Bunting layout={layout} cam={cam} /> : null}
    </G>
  );
}

/**
 * Pennant bunting, swagged between poles along the street frontage.
 *
 * Along the FRONT rather than across the lot, and that is a layering fact
 * rather than a taste: everything `LotGround` draws is under the car layer, so
 * a wire strung over the stalls would have sixty cars drawn on top of it. Along
 * the frontage it is in front of everything and reads correctly.
 */
function Bunting({ layout, cam }: { layout: LotLayout; cam: Camera }) {
  const { width, frontageY } = layout;
  const v = frontageY - 6;
  const colors = ['#e8574a', '#ffd166', '#5fbf6a', '#e9ecf3', '#6ea8e8'];
  const bays = Math.max(2, Math.round(width / 150));
  const top = 96;

  return (
    <G>
      {Array.from({ length: bays + 1 }, (_, i) => {
        const u = (width * i) / bays;
        const a = cam.project(u, v, top);
        const b = cam.project(u, v, 0);
        return <Rect key={`pole${i}`} x={a.x - 1.4} y={a.y} width={2.8} height={b.y - a.y} fill="#5a5f68" />;
      })}
      {Array.from({ length: bays }, (_, i) => {
        const u0 = (width * i) / bays;
        const u1 = (width * (i + 1)) / bays;
        const a = cam.project(u0, v, top);
        const b = cam.project(u1, v, top);
        // The swag. A dead-straight wire reads as a cable, not as bunting.
        const sag = 16;
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + sag * 2 };
        const flags = 7;
        return (
          <G key={`bay${i}`}>
            <Path d={`M${a.x},${a.y} Q${mid.x},${mid.y} ${b.x},${b.y}`} stroke="#6b7280" strokeWidth={1.1} fill="none" />
            {Array.from({ length: flags }, (_, j) => {
              const t = (j + 0.5) / flags;
              // Point on the quadratic, so a pennant hangs off the wire rather
              // than off a straight line between the poles.
              const x = (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * mid.x + t * t * b.x;
              const y = (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * mid.y + t * t * b.y;
              return (
                <Path
                  key={j}
                  d={`M${x - 4.5},${y} L${x + 4.5},${y} L${x},${y + 11} Z`}
                  fill={colors[(i * flags + j) % colors.length]}
                  opacity={0.88}
                />
              );
            })}
          </G>
        );
      })}
    </G>
  );
}

/** Chain-link, or a row of single pennants on short poles. */
function Fence({ env, layout, cam }: { env: EnvironmentDef; layout: LotLayout; cam: Camera }) {
  const { width, frontageY } = layout;
  const v = frontageY - 8;

  if (env.perimeter === 'chainlink') {
    const step = 56;
    const posts = Math.max(2, Math.ceil(width / step));
    const mesh = cam.wall(0, v, width, v, 62);
    return (
      <G>
        <G transform={mesh.matrix}>
          <Rect width={mesh.length} height={mesh.height} fill="#8d939c" opacity={0.1} />
          <Rect width={mesh.length} height={2} fill="#5a5f68" opacity={0.65} />
          {Array.from({ length: Math.ceil(width / 14) }, (_, i) => (
            <Rect key={i} x={i * 14} width={1} height={mesh.height} fill="#5a5f68" opacity={0.3} />
          ))}
        </G>
        {Array.from({ length: posts + 1 }, (_, i) => {
          const u = Math.min(width, i * step);
          const top = cam.project(u, v, 70);
          const base = cam.project(u, v, 0);
          return (
            <Rect
              key={`p${i}`}
              x={top.x - Math.max(1, 1.8 * cam.scale)}
              y={top.y}
              width={Math.max(2, 3.6 * cam.scale)}
              height={base.y - top.y}
              fill="#474c55"
            />
          );
        })}
      </G>
    );
  }

  return null;
}

export const LotGround = memo(LotGroundBase);
