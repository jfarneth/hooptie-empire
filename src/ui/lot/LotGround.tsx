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
import {
  PYLON_RESERVE,
  crackPaths,
  environmentFor,
  lightPositions,
  specks,
  stageSeed,
  tiltRise,
  weedClumps,
  type EnvironmentDef,
} from './environment';
import type { LotLayout } from './layout';

/**
 * The place the cars are parked on: building, ground, paint, lights, perimeter
 * and the street along the bottom.
 *
 * One `Svg` for the whole plate, memoised on the things that change its shape —
 * layout, stage, sign — so it sits still while the cars above it redraw behind
 * the tick. That matters: at a premium franchise this is ~400 elements, and it
 * would be the most expensive thing on screen if it re-rendered at 4Hz.
 *
 * `environment.ts` decides *what* each store looks like. This file draws it.
 */

interface Props {
  layout: LotLayout;
  stage: StageId;
  /** Shown on the building. The stage's short name. */
  signText: string;
  /** Only a lot that carries its own paper gets the second line. */
  financing: boolean;
}

function LotGroundBase({ layout, stage, signText, financing }: Props) {
  const { width, height, showroomDepth, frontageY, frontageDepth, carScale } = layout;
  const env = environmentFor(stage);

  // Derived once per lot shape. Scattering on every render would reshuffle the
  // cracks, and a crack that moves reads as something having happened.
  const scatter = useMemo(() => {
    const seed = stageSeed(stage);
    return {
      grain: specks(seed, width, height, env.grain),
      cracks: crackPaths(seed, width, showroomDepth, frontageY, env.cracks),
      weeds: weedClumps(seed, width, showroomDepth, frontageY, env.weeds),
      lights: lightPositions(env, width, showroomDepth, frontageY),
    };
  }, [stage, width, height, showroomDepth, frontageY, env]);

  const stripeW = Math.max(1, (env.stallLine?.width ?? 2) * Math.min(1.2, carScale));

  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <Defs>
        <RadialGradient id="pool" cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={env.lightColor} stopOpacity={0.15} />
          <Stop offset="0.55" stopColor={env.lightColor} stopOpacity={0.05} />
          <Stop offset="1" stopColor={env.lightColor} stopOpacity={0} />
        </RadialGradient>
      </Defs>

      <Rect width={width} height={height} fill={env.ground} />

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

      <Building env={env} layout={layout} signText={signText} financing={financing} />

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

      {/* Poles, standing up out of the tarmac. The base stays exactly where the
          light pool is; the mast rises by height x sin(tilt), which is the same
          projection the buildings and the car sprites use. */}
      {scatter.lights.map(({ x, y }, i) => {
        const mast = tiltRise(env.lightHeight);
        if (env.light === 'uplight' || mast < 4) {
          // Ground-recessed uplights have nothing to stand up.
          return <Rect key={`l_${i}`} x={x - 3} y={y - 3} width={6} height={6} rx={1} fill={env.lightColor} />;
        }
        return (
          <G key={`l_${i}`}>
            <Rect x={x - 1.4} y={y - mast} width={2.8} height={mast} fill="#2b323f" />
            <Rect x={x - 1.4} y={y - mast} width={1.2} height={mast} fill="#3d4757" />
            <Ellipse cx={x} cy={y} rx={4} ry={1.6} fill="#000" opacity={0.45} />
            <Rect x={x - 5} y={y - mast - 3} width={10} height={4} rx={1.6} fill="#2a3040" stroke="#4a5568" strokeWidth={1} />
            <Circle cx={x} cy={y - mast - 1} r={2.2} fill={env.lightColor} />
          </G>
        );
      })}

      <Frontage env={env} layout={layout} />
    </Svg>
  );
}

/* ---------------------------------------------------------------- surfaces */

/** Slabs, patches and joints laid over the base colour. */
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

function Building({
  env,
  layout,
  signText,
  financing,
}: {
  env: EnvironmentDef;
  layout: LotLayout;
  signText: string;
  financing: boolean;
}) {
  const { width, showroomDepth: d } = layout;
  const sign = env.signColor ?? theme.colors.accent;

  // The tilt turns the bottom of the building band into a front elevation. The
  // band's total depth is unchanged, so `layout.ts` keeps reserving exactly the
  // same space and nothing about the parking plan moves.
  const rise = tiltRise(env.buildingHeight);
  const roofD = Math.max(12, d - rise);
  const face = d; // bottom of the elevation, where the wall meets the tarmac

  /** Roof plate colour, a shade off the wall so the fold reads. */
  const roofFill = env.building === 'house' ? '#4b4139' : shadeOf(env.wall, -0.18);

  if (env.building === 'house') {
    const ridgeY = roofD * 0.52;
    const driveL = layout.slots.length ? Math.min(...layout.slots.map((s) => s.x)) - 8 : 60;
    const driveR = layout.slots.length
      ? Math.max(...layout.slots.map((s) => s.x + s.width)) + 8
      : width - 60;
    const garageW = Math.min(driveR - driveL, width * 0.5);
    const garageX = driveL + (driveR - driveL - garageW) / 2;

    return (
      <G>
        {/* hipped roof, seen from just off vertical */}
        <Rect x={6} y={0} width={width - 12} height={roofD} fill={env.wall} />
        <Path d={`M6,0 L${width - 6},0 L${width - 74},${ridgeY} L78,${ridgeY} Z`} fill={roofFill} />
        <Path d={`M6,${roofD} L${width - 6},${roofD} L${width - 74},${ridgeY} L78,${ridgeY} Z`} fill="#372f29" />
        <Path d={`M78,${ridgeY} L${width - 74},${ridgeY}`} stroke="#5d5147" strokeWidth={3} />
        <Path
          d={`M6,0 L78,${ridgeY} M${width - 6},0 L${width - 74},${ridgeY}`}
          stroke="#2b241f"
          strokeWidth={2}
          opacity={0.8}
        />
        <Rect x={width * 0.62} y={12} width={26} height={22} fill="#4d423a" stroke="#241f1b" strokeWidth={2} />

        {/* gutter, then the front wall the tilt reveals */}
        <Rect x={2} y={roofD - 3} width={width - 4} height={5} fill={env.trim} />
        <Rect x={6} y={roofD} width={width - 12} height={rise} fill={shadeOf(env.wall, 0.1)} />
        <Rect x={6} y={face - 3} width={width - 12} height={3} fill="#000" opacity={0.35} />

        {/* garage door, lined up with the driveway it opens onto */}
        <Rect x={garageX} y={roofD + rise * 0.16} width={garageW} height={rise * 0.84} fill="#2f2823" />
        {Array.from({ length: 4 }, (_, i) => (
          <Rect
            key={i}
            x={garageX}
            y={roofD + rise * (0.3 + i * 0.16)}
            width={garageW}
            height={1.2}
            fill="#1d1815"
          />
        ))}
        {/* front door and the porch bulb, which is the entire lighting plan */}
        <Rect x={width * 0.78} y={roofD + rise * 0.22} width={rise * 0.4} height={rise * 0.78} fill="#33302a" />
        <Circle cx={width * 0.78 - 7} cy={roofD + rise * 0.35} r={2.4} fill={env.lightColor} />
        <SvgText
          x={width * 0.14}
          y={roofD + rise * 0.62}
          fontSize={8}
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
    const boxW = width * 0.46;
    // Stops short of the pylon strip: the board and the sign are two different
    // signs, and overlapping them reads as one broken one.
    const boardX = width * 0.52;
    const boardW = Math.max(90, width - PYLON_RESERVE - 6 - boardX);
    const boardRise = tiltRise(150);

    return (
      <G>
        {/* the portable office: flat roof, then its front */}
        <Rect x={14} y={10} width={boxW} height={roofD - 10} fill={roofFill} />
        {Array.from({ length: 5 }, (_, i) => (
          <Rect key={i} x={14} y={10 + i * ((roofD - 10) / 5)} width={boxW} height={1.2} fill="#000" opacity={0.22} />
        ))}
        <Rect x={12} y={roofD - 3} width={boxW + 4} height={4} fill={env.trim} />
        <Rect x={14} y={roofD} width={boxW} height={rise} fill={shadeOf(env.wall, 0.12)} />
        <Rect x={14} y={face - 2} width={boxW} height={2} fill="#000" opacity={0.4} />
        <Rect x={30} y={roofD + rise * 0.2} width={30} height={rise * 0.42} fill="#2b3a46" stroke={env.trim} strokeWidth={1.5} />
        <Rect x={boxW - 26} y={roofD + rise * 0.2} width={30} height={rise * 0.42} fill="#2b3a46" stroke={env.trim} strokeWidth={1.5} />
        <Rect x={boxW / 2} y={roofD + rise * 0.24} width={20} height={rise * 0.76} fill="#33302a" stroke={env.trim} strokeWidth={1.5} />

        {/* the hand-painted board, standing on two posts */}
        <Rect x={boardX} y={face - boardRise - 44} width={boardW} height={44} fill="#5c4a33" stroke="#33291c" strokeWidth={3} />
        <SvgText
          x={boardX + boardW / 2}
          y={face - boardRise - 24}
          fontSize={12}
          fontWeight="700"
          fill="#e8dcc0"
          textAnchor="middle"
        >
          {signText.toUpperCase()}
        </SvgText>
        {financing ? (
          <SvgText
            x={boardX + boardW / 2}
            y={face - boardRise - 10}
            fontSize={7}
            fill="#d8c9a4"
            textAnchor="middle"
            letterSpacing={1}
          >
            BUY HERE · PAY HERE
          </SvgText>
        ) : null}
        <Rect x={boardX + 12} y={face - boardRise} width={4.5} height={boardRise} fill="#3a3128" />
        <Rect x={boardX + boardW - 16} y={face - boardRise} width={4.5} height={boardRise} fill="#3a3128" />
      </G>
    );
  }

  // Brick and up: a flat roof with plant on it, and a glazed front elevation.
  // Glass belongs on a wall — putting a showroom window on the roof, which is
  // what a pure plan view forced, never made sense.
  // The elevation ends where the pylon strip begins — glazing that ran under the
  // sign would be half a showroom window with a post through it.
  const frontRight = width - PYLON_RESERVE;
  const glassInset = env.building === 'flagship' ? 0 : 14;
  const bayW = env.building === 'flagship' ? 0 : Math.min(96, width * 0.26);
  const bayX = frontRight - bayW - 4;
  const glassW = (bayW > 30 ? bayX - 10 : frontRight) - glassInset;
  const glassTop = roofD + rise * 0.16;
  const glassH = rise * (env.building === 'flagship' ? 0.62 : 0.5);

  return (
    <G>
      {/* roof plate */}
      <Rect width={width} height={roofD} fill={roofFill} />
      {[0.2, 0.52, 0.78].map((f, i) => (
        <Rect
          key={i}
          x={f * width - 16}
          y={roofD * 0.3}
          width={32}
          height={roofD * 0.28}
          rx={2}
          fill={shadeOf(env.wall, -0.34)}
        />
      ))}
      {Array.from({ length: 4 }, (_, i) => (
        <Rect key={`seam${i}`} x={((i + 1) * width) / 5} y={0} width={1.2} height={roofD} fill="#000" opacity={0.13} />
      ))}
      <Rect y={roofD - 3} width={width} height={4} fill={env.trim} opacity={0.7} />

      {/* front elevation */}
      <Rect y={roofD} width={width} height={rise} fill={env.wall} />
      <Rect y={face - 3} width={width} height={3} fill="#000" opacity={0.4} />

      <Rect
        x={glassInset}
        y={glassTop}
        width={glassW}
        height={glassH}
        fill={env.building === 'flagship' ? '#24455c' : '#2f4a63'}
        stroke={env.trim}
        strokeWidth={1.5}
      />
      {Array.from({ length: env.building === 'flagship' ? 8 : 5 }, (_, i) => (
        <Rect
          key={i}
          x={glassInset + ((i + 1) * glassW) / (env.building === 'flagship' ? 9 : 6)}
          y={glassTop}
          width={1.4}
          height={glassH}
          fill={env.trim}
          opacity={0.6}
        />
      ))}
      {/* lit interior, so the glass reads as a room rather than a panel */}
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
            y={glassTop + glassH / 2 + 2.5}
            fontSize={6.5}
            fontWeight="700"
            fill={theme.colors.textFaint}
            textAnchor="middle"
            letterSpacing={1.2}
          >
            SERVICE
          </SvgText>
        </G>
      ) : null}

      {/* the sign, mounted on the elevation */}
      <SvgText
        x={env.building === 'flagship' ? frontRight / 2 : glassInset + 6}
        y={financing && env.building !== 'flagship' ? face - 19 : face - 9}
        fontSize={env.building === 'flagship' ? 15 : 12}
        fontWeight="800"
        fill={sign}
        textAnchor={env.building === 'flagship' ? 'middle' : 'start'}
        letterSpacing={env.building === 'flagship' ? 5 : 1.6}
      >
        {signText.toUpperCase()}
      </SvgText>
      {financing && env.building !== 'flagship' ? (
        <SvgText
          x={glassInset + 6}
          y={face - 7}
          fontSize={6.5}
          fontWeight="700"
          fill={theme.colors.textDim}
          textAnchor="start"
          letterSpacing={1.6}
        >
          BUY HERE · PAY HERE
        </SvgText>
      ) : null}
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

/* --------------------------------------------------------------- frontage */

function Frontage({ env, layout }: { env: EnvironmentDef; layout: LotLayout }) {
  const { width, frontageY: y, frontageDepth } = layout;
  const walk = 22;
  const road = frontageDepth - walk - 8;

  return (
    <G>
      {/* what separates the lot from the pavement */}
      {env.perimeter === 'chainlink' ? (
        <G>
          <Rect y={y - 10} width={width} height={3} fill="#5a5f68" opacity={0.7} />
          {Array.from({ length: Math.ceil(width / 15) }, (_, i) => (
            <Rect key={i} x={i * 15} y={y - 10} width={1.2} height={22} fill="#5a5f68" opacity={0.45} />
          ))}
          {Array.from({ length: Math.ceil(width / 56) }, (_, i) => (
            <Rect key={`p${i}`} x={i * 56} y={y - 14} width={3.5} height={30} fill="#474c55" />
          ))}
        </G>
      ) : null}

      {env.flags
        ? Array.from({ length: Math.ceil(width / 30) }, (_, i) => {
            const x = 8 + i * 30;
            const colors = [theme.colors.danger, theme.colors.accent, theme.colors.money, '#e9ecf3'];
            return (
              <G key={`f${i}`}>
                <Rect x={x - 0.6} y={y - 15} width={1.2} height={15} fill="#4a5162" opacity={0.6} />
                <Path d={`M${x},${y - 15} l9,4.5 l-9,4.5 Z`} fill={colors[i % colors.length]} opacity={0.82} />
              </G>
            );
          })
        : null}

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

      <Rect y={y} width={width} height={8} fill={env.perimeter === 'lawn' ? env.verge : '#606874'} />
      <Rect y={y + 8} width={width} height={walk} fill={env.verge} />
      <Rect y={y + 8 + walk} width={width} height={road} fill={env.road} />
      {Array.from({ length: Math.ceil(width / 86) }, (_, i) => (
        <Rect
          key={`lane${i}`}
          x={i * 86 + 12}
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

export const LotGround = memo(LotGroundBase);
