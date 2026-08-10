import React, { memo, useMemo } from 'react';
import Svg, {
  Circle,
  Defs,
  Ellipse,
  G,
  Path,
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
}

/** Something that stands up, with the depth it sorts on. */
interface Upright {
  depth: number;
  node: React.ReactNode;
}

function LotGroundBase({ layout, camera, world, stage, signText, financing }: Props) {
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
      />
    ),
  });

  for (const [i, light] of scatter.lights.entries()) {
    uprights.push({
      depth: camera.depth(light.x, light.y),
      node: <PoleLight key={`l_${i}`} env={env} cam={camera} at={light} />,
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
function Building({
  env,
  layout,
  cam,
  signText,
  financing,
}: {
  env: EnvironmentDef;
  layout: LotLayout;
  cam: Camera;
  signText: string;
  financing: boolean;
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
  const roofFill = env.building === 'house' ? '#4b4139' : shadeOf(env.wall, -0.18);

  return (
    <G>
      {/* roof plate, at height, still drawn in flat lot coordinates */}
      <G transform={cam.planeMatrix(h)}>
        <Rect x={x0} y={0} width={x1 - x0} height={d} fill={roofFill} />
        {env.building === 'house' ? (
          <>
            <Rect x={x0} y={d * 0.46} width={x1 - x0} height={d * 0.08} fill="#5d5147" />
            <Rect x={width * 0.62} y={d * 0.12} width={26} height={20} fill="#4d423a" />
          </>
        ) : (
          <>
            {[0.2, 0.52, 0.78].map((f, i) => (
              <Rect
                key={i}
                x={f * width - 16}
                y={d * 0.3}
                width={32}
                height={d * 0.26}
                rx={2}
                fill={shadeOf(env.wall, -0.34)}
              />
            ))}
            {Array.from({ length: 4 }, (_, i) => (
              <Rect key={`seam${i}`} x={x0 + ((i + 1) * (x1 - x0)) / 5} y={0} width={1.2} height={d} fill="#000" opacity={0.13} />
            ))}
          </>
        )}
      </G>

      {/* the side the yaw turned toward us */}
      <G transform={side.matrix}>
        <Rect width={side.length} height={side.height} fill={shadeOf(env.wall, -0.32)} />
        <Rect width={side.length} height={2} fill={env.trim} opacity={0.5} />
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
        />
      </G>

      {env.building === 'shack' ? <Board cam={cam} layout={layout} signText={signText} financing={financing} /> : null}
    </G>
  );
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
}: {
  env: EnvironmentDef;
  layout: LotLayout;
  wallLength: number;
  wallHeight: number;
  usable: number;
  signText: string;
  financing: boolean;
  sign: string;
}) {
  if (env.building === 'house') {
    // The garage door lines up with the driveway it opens onto.
    const driveL = layout.slots.length ? Math.min(...layout.slots.map((s) => s.x)) - 8 : 60;
    const driveR = layout.slots.length
      ? Math.max(...layout.slots.map((s) => s.x + s.width)) + 8
      : wallLength - 60;
    const garageW = Math.min(driveR - driveL, wallLength * 0.5);
    const garageX = driveL + (driveR - driveL - garageW) / 2;

    return (
      <G>
        <Rect x={garageX} y={wallHeight * 0.22} width={garageW} height={wallHeight * 0.72} fill="#2f2823" />
        {Array.from({ length: 4 }, (_, i) => (
          <Rect key={i} x={garageX} y={wallHeight * (0.34 + i * 0.14)} width={garageW} height={1.4} fill="#1d1815" />
        ))}
        <Rect x={wallLength * 0.79} y={wallHeight * 0.26} width={wallHeight * 0.34} height={wallHeight * 0.7} fill="#33302a" />
        <Circle cx={wallLength * 0.79 - 8} cy={wallHeight * 0.38} r={3} fill={env.lightColor} />
        <Rect x={wallLength * 0.06} y={wallHeight * 0.28} width={wallHeight * 0.42} height={wallHeight * 0.3} fill="#2b3a46" />
        <SvgText
          x={wallLength * 0.2}
          y={wallHeight * 0.86}
          fontSize={wallHeight * 0.16}
          fontWeight="800"
          fill={theme.colors.textFaint}
          textAnchor="middle"
          letterSpacing={1.6}
        >
          {signText.toUpperCase()}
        </SvgText>
      </G>
    );
  }

  if (env.building === 'shack') {
    // The board out front carries the name, so the office itself is just an
    // office: two windows and a door.
    return (
      <G>
        <Rect x={wallLength * 0.08} y={wallHeight * 0.24} width={wallLength * 0.1} height={wallHeight * 0.36} fill="#2b3a46" stroke={env.trim} strokeWidth={1.5} />
        <Rect x={wallLength * 0.24} y={wallHeight * 0.24} width={wallLength * 0.1} height={wallHeight * 0.36} fill="#2b3a46" stroke={env.trim} strokeWidth={1.5} />
        <Rect x={wallLength * 0.42} y={wallHeight * 0.28} width={wallLength * 0.06} height={wallHeight * 0.68} fill="#33302a" stroke={env.trim} strokeWidth={1.5} />
      </G>
    );
  }

  // Brick and up: a glazed front, a service bay, and the sign on the elevation.
  // Glass belongs on a wall — putting a showroom window on the roof, which is
  // what a pure plan view forced, never made sense.
  const flagship = env.building === 'flagship';
  const glassInset = flagship ? 6 : 14;
  const bayW = flagship ? 0 : Math.min(96, wallLength * 0.24);
  const bayX = usable - bayW - 4;
  const glassW = Math.max(40, (bayW > 30 ? bayX - 10 : usable) - glassInset);
  const glassTop = wallHeight * 0.2;
  const glassH = wallHeight * (flagship ? 0.5 : 0.42);
  const panes = flagship ? 8 : 5;

  return (
    <G>
      <Rect x={glassInset} y={glassTop} width={glassW} height={glassH} fill={flagship ? '#24455c' : '#2f4a63'} stroke={env.trim} strokeWidth={1.5} />
      {Array.from({ length: panes }, (_, i) => (
        <Rect
          key={i}
          x={glassInset + ((i + 1) * glassW) / (panes + 1)}
          y={glassTop}
          width={1.4}
          height={glassH}
          fill={env.trim}
          opacity={0.6}
        />
      ))}
      {[0.25, 0.6, 0.85].map((f, i) => (
        <Circle key={`glow${i}`} cx={glassInset + f * glassW} cy={glassTop + glassH * 0.55} r={glassH * 0.3} fill={env.lightColor} opacity={0.09} />
      ))}

      {bayW > 30 ? (
        <G>
          <Rect x={bayX} y={glassTop} width={bayW} height={glassH} fill="#1b1f26" stroke="#5a6270" strokeWidth={1.5} />
          {Array.from({ length: 3 }, (_, i) => (
            <Rect key={i} x={bayX + 2} y={glassTop + 4 + i * (glassH / 3.4)} width={bayW - 4} height={1.6} fill="#39404c" />
          ))}
          <SvgText
            x={bayX + bayW / 2}
            y={glassTop + glassH / 2 + 3}
            fontSize={8}
            fontWeight="700"
            fill={theme.colors.textFaint}
            textAnchor="middle"
            letterSpacing={1.2}
          >
            SERVICE
          </SvgText>
        </G>
      ) : null}

      <SvgText
        x={flagship ? usable / 2 : glassInset + 6}
        y={financing && !flagship ? wallHeight - 15 : wallHeight - 8}
        fontSize={flagship ? 17 : 14}
        fontWeight="800"
        fill={sign}
        textAnchor={flagship ? 'middle' : 'start'}
        letterSpacing={flagship ? 5 : 1.6}
      >
        {signText.toUpperCase()}
      </SvgText>
      {financing && !flagship ? (
        <SvgText x={glassInset + 6} y={wallHeight - 5} fontSize={7.5} fontWeight="700" fill={theme.colors.textDim} textAnchor="start" letterSpacing={1.6}>
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

/** The upright half: chain-link, or flags on a wire. Nearest thing in the scene. */
function Perimeter({ env, layout, cam }: { env: EnvironmentDef; layout: LotLayout; cam: Camera }) {
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

  if (env.flags) {
    const colors = [theme.colors.danger, theme.colors.accent, theme.colors.money, '#e9ecf3'];
    return (
      <G>
        {Array.from({ length: Math.ceil(width / 34) }, (_, i) => {
          const u = Math.min(width, 8 + i * 34);
          const top = cam.project(u, v, 46);
          const base = cam.project(u, v, 0);
          return (
            <G key={`f${i}`}>
              <Rect x={top.x - 0.6} y={top.y} width={1.2} height={base.y - top.y} fill="#4a5162" opacity={0.6} />
              <Path d={`M${top.x},${top.y} l9,4.5 l-9,4.5 Z`} fill={colors[i % colors.length]} opacity={0.82} />
            </G>
          );
        })}
      </G>
    );
  }

  return null;
}

export const LotGround = memo(LotGroundBase);
