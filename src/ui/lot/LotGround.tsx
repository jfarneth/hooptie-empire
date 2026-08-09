import React, { memo } from 'react';
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
import { theme } from '../theme';
import type { LotLayout } from './layout';

/**
 * The tarmac everything else stands on: showroom band, painted stalls, pole
 * lights, and the street along the bottom edge.
 *
 * One `Svg` for the whole plate rather than a view per stall. It only depends on
 * the layout and the sign text, so it memoises on those and sits still while the
 * cars above it redraw behind the tick.
 *
 * The street matters more than it looks. Without it the lot fades into an
 * unbounded field of grey and stops reading as a place you could stand in — the
 * frontage is what makes it a business on a road.
 */

interface Props {
  layout: LotLayout;
  /** Shown on the building. The stage's short name. */
  signText: string;
  /** Only a lot that carries its own paper gets the second line. */
  financing: boolean;
}

function LotGroundBase({ layout, signText, financing }: Props) {
  const { width, height, showroomDepth, frontageY, frontageDepth, carScale } = layout;
  const stripe = '#5b6578';
  const stripeW = Math.max(1, 1.6 * carScale);

  const poleRows = polePositions(layout);

  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <Defs>
        <RadialGradient id="pool" cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor="#ffc46b" stopOpacity={0.14} />
          <Stop offset="0.6" stopColor="#ffab4a" stopOpacity={0.05} />
          <Stop offset="1" stopColor="#ff9d3a" stopOpacity={0} />
        </RadialGradient>
      </Defs>

      <Rect width={width} height={height} fill={theme.colors.asphalt} />

      {/* light pools first, so paint and cars sit on top of them */}
      {poleRows.map(({ x, y }, i) => (
        <Circle key={`pool_${i}`} cx={x} cy={y} r={130 * carScale} fill="url(#pool)" />
      ))}

      {/* ---- the showroom ---- */}
      <Rect width={width} height={showroomDepth} fill={theme.colors.surfaceAlt} />
      <Rect y={showroomDepth - 4} width={width} height={4} fill="#12151c" opacity={0.85} />
      <Rect
        x={14}
        y={16}
        width={width - 28}
        height={44}
        rx={4}
        fill="#33506b"
        stroke="#4d5b71"
        strokeWidth={1.5}
      />
      {Array.from({ length: 7 }, (_, i) => (
        <Rect
          key={`mullion_${i}`}
          x={14 + (i + 1) * ((width - 28) / 8)}
          y={16}
          width={1.5}
          height={44}
          fill="#4d5b71"
          opacity={0.7}
        />
      ))}

      {/* service bay — where a car in recon has gone */}
      <Rect
        x={width - 92}
        y={showroomDepth - 44}
        width={78}
        height={38}
        rx={2}
        fill="#171b23"
        stroke="#3a4353"
        strokeWidth={1}
      />
      <SvgText
        x={width - 53}
        y={showroomDepth - 21}
        fontSize={7.5}
        fontWeight="700"
        fill={theme.colors.textFaint}
        textAnchor="middle"
        letterSpacing={1}
      >
        SERVICE
      </SvgText>

      {/* the sign is the stage: it is how you know which store you are standing in */}
      <Rect
        x={width / 2 - 84}
        y={showroomDepth - 30}
        width={168}
        height={23}
        rx={3}
        fill="#12151c"
      />
      <SvgText
        x={width / 2}
        y={showroomDepth - 19.5}
        fontSize={10}
        fontWeight="800"
        fill={theme.colors.accent}
        textAnchor="middle"
        letterSpacing={1.3}
      >
        {signText.toUpperCase()}
      </SvgText>
      {financing ? (
        <SvgText
          x={width / 2}
          y={showroomDepth - 10.5}
          fontSize={6.5}
          fontWeight="700"
          fill={theme.colors.textDim}
          textAnchor="middle"
          letterSpacing={1.6}
        >
          BUY HERE · PAY HERE
        </SvgText>
      ) : null}

      {/* ---- painted stalls ---- */}
      <G opacity={0.85}>
        {layout.slots.map((slot) => (
          <G key={slot.index}>
            <Rect x={slot.x + 2} y={slot.y} width={stripeW} height={slot.height} fill={stripe} />
            {slot.col === layout.cols - 1 ? (
              <Rect
                x={slot.x + slot.width - 2 - stripeW}
                y={slot.y}
                width={stripeW}
                height={slot.height}
                fill={stripe}
              />
            ) : null}
            <Rect
              x={slot.x + 2}
              y={slot.y}
              width={slot.width - 4}
              height={stripeW}
              fill={stripe}
              opacity={0.7}
            />
          </G>
        ))}
      </G>

      {/* ---- pole lights ---- */}
      {poleRows.map(({ x, y }, i) => (
        <G key={`pole_${i}`}>
          <Circle cx={x} cy={y} r={5.5} fill="#2a3040" stroke="#454f63" strokeWidth={1} />
          <Circle cx={x} cy={y} r={2.4} fill="#ffd89a" />
        </G>
      ))}

      {/* ---- frontage ---- */}
      <G>
        {Array.from({ length: 12 }, (_, i) => {
          const x = 10 + i * ((width - 20) / 11);
          const colors = [theme.colors.danger, theme.colors.accent, theme.colors.money, '#e9ecf3'];
          return (
            <G key={`flag_${i}`}>
              <Rect x={x - 0.6} y={frontageY - 15} width={1.2} height={15} fill="#4a5162" opacity={0.6} />
              <Path
                d={`M${x},${frontageY - 15} l9,4.5 l-9,4.5 Z`}
                fill={colors[i % colors.length]}
                opacity={0.8}
              />
            </G>
          );
        })}
        <Rect y={frontageY} width={width} height={20} fill="#31363f" />
        <Rect y={frontageY} width={width} height={3} fill="#454c58" />
        <Rect y={frontageY + 20} width={width} height={frontageDepth - 20} fill="#15171c" />
        {Array.from({ length: Math.ceil(width / 46) }, (_, i) => (
          <Rect
            key={`lane_${i}`}
            x={i * 46 + 8}
            y={frontageY + 20 + (frontageDepth - 20) / 2 - 1.5}
            width={26}
            height={3}
            fill="#c9c3a8"
            opacity={0.32}
          />
        ))}
      </G>
    </Svg>
  );
}

/**
 * Pole lights down both edges, spaced so a long lot does not run dark in the
 * middle. Positions come from the layout so they land in the aisles rather than
 * on top of a car.
 */
function polePositions(layout: LotLayout): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const span = layout.frontageY - layout.showroomDepth;
  const count = Math.max(2, Math.round(span / (300 * layout.carScale)));
  for (let i = 0; i < count; i++) {
    const y = layout.showroomDepth + (span * (i + 0.5)) / count;
    out.push({ x: 14, y }, { x: layout.width - 14, y });
  }
  return out;
}

export const LotGround = memo(LotGroundBase);
