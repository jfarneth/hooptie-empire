import React, { memo } from 'react';
import Svg, { Circle, Ellipse, G, Path, Rect } from 'react-native-svg';
import { BODY_COLORS } from '../../../sim/models';
import type { BodyStyle } from '../../../sim/types';
import { SIDE_SHAPES } from './shapes';
import { theme, weatheredColor } from '../../theme';

/**
 * Side-profile car silhouettes — the shape a listing photograph would be in.
 *
 * Drawn rather than imported: six shapes plus a paint colour and a condition
 * value cover the whole catalogue with no asset pipeline, and they stay crisp at
 * any size. Condition is visible at a glance — paint goes chalky, glass goes
 * flat, and rough cars pick up rust blooms — so the lot reads as inventory
 * quality without the player opening a single card.
 */

export interface CarSideProps {
  bodyStyle: BodyStyle;
  colorIndex: number;
  condition: number;
  width?: number;
  /** Rust blooms appear below this condition. */
  showWear?: boolean;
}

function CarSideBase({
  bodyStyle,
  colorIndex,
  condition,
  width = 100,
  showWear = true,
}: CarSideProps) {
  const shape = SIDE_SHAPES[bodyStyle] ?? SIDE_SHAPES.sedan;
  const base = BODY_COLORS[colorIndex % BODY_COLORS.length];
  const paint = weatheredColor(base, condition);
  const height = width * 0.44;

  // Gloss fades with condition; a rough car reflects nothing.
  const gloss = Math.max(0, condition - 0.25) * 0.5;
  const rough = condition < 0.45 && showWear;

  return (
    <Svg width={width} height={height} viewBox="0 0 100 44">
      {/* contact shadow */}
      <Ellipse cx="50" cy="39.5" rx="42" ry="2.6" fill="#000" opacity={0.35} />

      <G>
        <Path d={shape.body} fill={paint} />
        {shape.detail ? <Path d={shape.detail} fill={paint} /> : null}
        <Path d={shape.cabin} fill={theme.colors.glass} opacity={0.55 + gloss * 0.5} />
        <Path d={shape.cabin} fill="none" stroke={paint} strokeWidth={1.6} />

        {/* highlight strip along the shoulder line */}
        <Rect x="10" y="23.4" width="80" height="1.1" fill="#fff" opacity={gloss} rx={0.5} />

        {rough ? (
          <G opacity={0.55}>
            <Ellipse cx="18" cy="30" rx="5" ry="2.4" fill="#7a4a2c" />
            <Ellipse cx="72" cy="31" rx="4" ry="2" fill="#7a4a2c" />
          </G>
        ) : null}
      </G>

      {shape.wheels.map((cx) => (
        <G key={cx}>
          <Circle cx={cx} cy={33} r={shape.wheelR} fill="#15171c" />
          <Circle cx={cx} cy={33} r={shape.wheelR * 0.45} fill="#464c58" />
        </G>
      ))}
    </Svg>
  );
}

// The lot re-renders on every tick; these props change rarely, so memoizing
// keeps a full lot from redrawing 4x a second.
export const CarSide = memo(CarSideBase);
