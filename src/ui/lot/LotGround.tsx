import React, { memo, useMemo } from 'react';
import Svg, {
  Circle,
  Defs,
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
  crackPaths,
  environmentFor,
  lightPositions,
  specks,
  stageSeed,
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

      {/* pole heads on top of everything they light */}
      {scatter.lights.map(({ x, y }, i) =>
        env.light === 'uplight' ? (
          <Rect key={`l_${i}`} x={x - 3} y={y - 3} width={6} height={6} rx={1} fill={env.lightColor} />
        ) : (
          <G key={`l_${i}`}>
            <Circle cx={x} cy={y} r={5.5} fill="#2a3040" stroke="#4a5568" strokeWidth={1} />
            <Circle cx={x} cy={y} r={2.4} fill={env.lightColor} />
          </G>
        ),
      )}

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

  if (env.building === 'house') {
    // A hipped roof from above: ridge, hips, gutter, chimney, garage, porch
    // light. Read as a *house*, because the joke of curbstoning is that the
    // dealership is where you live.
    const ridgeY = d * 0.55;
    return (
      <G>
        <Rect x={6} y={0} width={width - 12} height={d} fill={env.wall} />
        <Path d={`M6,0 L${width - 6},0 L${width - 74},${ridgeY} L78,${ridgeY} Z`} fill="#4b4139" />
        <Path
          d={`M6,${d} L${width - 6},${d} L${width - 74},${ridgeY} L78,${ridgeY} Z`}
          fill="#372f29"
        />
        <Path d={`M78,${ridgeY} L${width - 74},${ridgeY}`} stroke="#5d5147" strokeWidth={3} />
        <Path
          d={`M6,0 L78,${ridgeY} M${width - 6},0 L${width - 74},${ridgeY}`}
          stroke="#2b241f"
          strokeWidth={2}
          opacity={0.8}
        />
        <Rect x={0} y={d - 6} width={width} height={7} fill={env.trim} />
        <Rect x={width * 0.62} y={18} width={30} height={26} fill="#4d423a" stroke="#241f1b" strokeWidth={2} />
        {/* garage door, at the head of the driveway */}
        <Rect x={width * 0.14} y={d} width={Math.min(width * 0.46, 168)} height={12} fill="#2f2823" />
        <SvgText
          x={width / 2}
          y={d - 16}
          fontSize={9}
          fontWeight="800"
          fill={theme.colors.textFaint}
          textAnchor="middle"
          letterSpacing={2}
        >
          {signText.toUpperCase()}
        </SvgText>
      </G>
    );
  }

  if (env.building === 'shack') {
    // A portable office and a hand-painted board on two posts.
    const boxW = width * 0.46;
    return (
      <G>
        <Rect x={14} y={12} width={boxW} height={d - 24} fill={env.wall} />
        {Array.from({ length: 6 }, (_, i) => (
          <Rect key={i} x={14} y={12 + i * ((d - 24) / 6)} width={boxW} height={1.2} fill="#000" opacity={0.25} />
        ))}
        <Rect x={30} y={30} width={38} height={26} fill="#2b3a46" stroke={env.trim} strokeWidth={2} />
        <Rect x={boxW - 34} y={30} width={38} height={26} fill="#2b3a46" stroke={env.trim} strokeWidth={2} />
        <Rect x={boxW / 2 - 4} y={d - 52} width={30} height={38} fill="#33302a" stroke={env.trim} strokeWidth={2} />
        {/* the board */}
        <Rect x={width * 0.55} y={16} width={width * 0.4} height={50} fill="#5c4a33" stroke="#33291c" strokeWidth={3} />
        <SvgText
          x={width * 0.75}
          y={38}
          fontSize={13}
          fontWeight="700"
          fill="#e8dcc0"
          textAnchor="middle"
        >
          {signText.toUpperCase()}
        </SvgText>
        {financing ? (
          <SvgText x={width * 0.75} y={54} fontSize={8} fill="#d8c9a4" textAnchor="middle" letterSpacing={1}>
            BUY HERE · PAY HERE
          </SvgText>
        ) : null}
        <Rect x={width * 0.58} y={66} width={5} height={d - 66} fill="#3a3128" />
        <Rect x={width * 0.92} y={66} width={5} height={d - 66} fill="#3a3128" />
      </G>
    );
  }

  // Everything from the brick box up shares a frame: wall, glazing, a service
  // bay and a lit sign. What changes is how much glass and how good it looks.
  const glassW = env.building === 'brick' ? width * 0.52 : env.building === 'flagship' ? width : width * 0.68;
  const glassH = env.building === 'flagship' ? d * 0.6 : d * 0.46;
  const bayW = env.building === 'flagship' ? 0 : width - glassW - 34;

  return (
    <G>
      <Rect width={width} height={d} fill={env.wall} />
      <Rect y={d - 6} width={width} height={6} fill="#12161c" />

      {env.building === 'flagship' ? (
        <G>
          <Rect x={0} y={8} width={width} height={glassH} fill="#24455c" />
          <Rect x={0} y={8} width={width} height={3} fill={env.trim} opacity={0.55} />
          <Rect x={0} y={8 + glassH - 3} width={width} height={3} fill={env.trim} opacity={0.35} />
          {Array.from({ length: 9 }, (_, i) => (
            <Rect key={i} x={((i + 1) * width) / 10} y={8} width={1.6} height={glassH} fill={env.trim} opacity={0.5} />
          ))}
          {[0.18, 0.4, 0.62, 0.84].map((f, i) => (
            <Circle key={`glow${i}`} cx={f * width} cy={8 + glassH * 0.5} r={26} fill="#cfe6ff" opacity={0.08} />
          ))}
        </G>
      ) : (
        <G>
          <Rect x={16} y={16} width={glassW} height={glassH} rx={3} fill="#2f4a63" stroke={env.trim} strokeWidth={2} />
          {Array.from({ length: 5 }, (_, i) => (
            <Rect
              key={i}
              x={16 + ((i + 1) * glassW) / 6}
              y={16}
              width={1.6}
              height={glassH}
              fill={env.trim}
              opacity={0.7}
            />
          ))}
          {bayW > 30 ? (
            <G>
              <Rect x={width - bayW - 14} y={16} width={bayW} height={glassH + 12} rx={2} fill="#1b1f26" stroke="#5a6270" strokeWidth={2} />
              {Array.from({ length: 4 }, (_, i) => (
                <Rect key={i} x={width - bayW - 12} y={22 + i * 13} width={bayW - 4} height={2} fill="#39404c" />
              ))}
              {/* Inside the bay door, not under it: the sign sits across the
                  bottom of the building and was clipping this label. */}
              <SvgText
                x={width - bayW / 2 - 14}
                y={16 + (glassH + 12) / 2 + 3}
                fontSize={7}
                fontWeight="700"
                fill={theme.colors.textFaint}
                textAnchor="middle"
                letterSpacing={1.4}
              >
                SERVICE
              </SvgText>
            </G>
          ) : null}
        </G>
      )}

      {/* the sign is how you know which store you are standing in */}
      <Rect x={width / 2 - 96} y={d - 40} width={192} height={financing ? 32 : 24} rx={3} fill="#12151c" />
      <SvgText
        x={width / 2}
        y={d - 26}
        fontSize={env.building === 'flagship' ? 15 : 12}
        fontWeight="800"
        fill={sign}
        textAnchor="middle"
        letterSpacing={env.building === 'flagship' ? 5 : 1.6}
      >
        {signText.toUpperCase()}
      </SvgText>
      {financing ? (
        <SvgText
          x={width / 2}
          y={d - 14}
          fontSize={6.5}
          fontWeight="700"
          fill={theme.colors.textDim}
          textAnchor="middle"
          letterSpacing={1.8}
        >
          BUY HERE · PAY HERE
        </SvgText>
      ) : null}
    </G>
  );
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
