import React, { memo } from 'react';
import Svg, { Ellipse, G, Path, Rect } from 'react-native-svg';
import { BODY_COLORS } from '../../../sim/models';
import { shadeColor, weatheredColor } from '../../theme';
import { CAR_BOX_L, CAR_BOX_W } from '../../lot/layout';
import type { Archetype } from '../archetypes';
import { TOP_SHAPES } from './shapes';

/**
 * Cars seen from directly above, one drawing per archetype.
 *
 * This is the fallback renderer — the shape the lot uses until rendered sprites
 * exist, and the shape it falls back to for any archetype nobody has drawn yet.
 * Flat vector on purpose: no gradients, no soft shadows, nothing that a sprite
 * will do better. It should read as a clean plan view, not as a bad imitation of
 * a render.
 *
 * Everything is laid out inside the `CAR_BOX_W x CAR_BOX_L` artboard from
 * layout.ts, so a van really is bigger than a hatch and one scale factor from
 * the lot positions all twelve.
 */

export interface CarTopProps {
  archetype: Archetype;
  colorIndex: number;
  condition: number;
  /** Width of the artboard on screen. Height follows from it. */
  width?: number;
  /** Small stable integer from `variantOf`, for wheel trim and stance. */
  variant?: number;
  showWear?: boolean;
}

function CarTopBase({
  archetype,
  colorIndex,
  condition,
  width = 60,
  variant = 0,
  showWear = true,
}: CarTopProps) {
  const shape = TOP_SHAPES[archetype] ?? TOP_SHAPES.sedanEconomy;
  const base = BODY_COLORS[colorIndex % BODY_COLORS.length];
  const paint = weatheredColor(base, condition);

  // Gloss fades with condition, same rule the side profile uses: a rough car
  // reflects nothing, and that has to read at a glance across a full lot.
  const gloss = Math.max(0, condition - 0.25) * 0.55;
  const rough = condition < 0.45 && showWear;

  const roofPaint = shadeColor(paint, 0.12);
  const sill = shadeColor(paint, -0.34);
  // Dark glass on purpose. Light glass covers most of a car's plan view and
  // washes the paint out, which on a full lot turns nine body colours into
  // shades of the same grey.
  const glass = '#232c38';

  const x0 = (CAR_BOX_W - shape.w) / 2;
  const y0 = (CAR_BOX_L - shape.len) / 2;
  const at = (f: number) => y0 + shape.len * f;
  const across = (f: number) => x0 + shape.w * f;

  const hoodY = at(shape.hood);
  const [roofA, roofB] = [at(shape.roof[0]), at(shape.roof[1])];
  const tailY = at(shape.tail);

  // Wheels sit at the body edge; trim varies so a lot of the same archetype
  // does not look stamped.
  const wheelW = shape.w * 0.14;
  const wheelH = shape.len * 0.17;
  const wheelInset = variant % 2 === 0 ? 1.5 : 0.5;
  const wheel = (x: number, y: number) => (
    <Rect
      key={`${x}_${y}`}
      x={x}
      y={y}
      width={wheelW}
      height={wheelH}
      rx={wheelW * 0.42}
      fill="#15171c"
    />
  );

  return (
    <Svg
      width={width}
      height={width * (CAR_BOX_L / CAR_BOX_W)}
      viewBox={`0 0 ${CAR_BOX_W} ${CAR_BOX_L}`}
    >
      {/* contact shadow — the only thing separating the car from the tarmac */}
      <Ellipse
        cx={CAR_BOX_W / 2}
        cy={y0 + shape.len * 0.54}
        rx={shape.w * 0.52}
        ry={shape.len * 0.46}
        fill="#000"
        opacity={0.28}
      />

      {wheel(x0 - wheelW + wheelInset, at(shape.hood) - wheelH * 0.75)}
      {wheel(x0 + shape.w - wheelInset, at(shape.hood) - wheelH * 0.75)}
      {wheel(x0 - wheelW + wheelInset, at(shape.tail) - wheelH * 1.05)}
      {wheel(x0 + shape.w - wheelInset, at(shape.tail) - wheelH * 1.05)}

      {/* body */}
      <Rect x={x0} y={y0} width={shape.w} height={shape.len} rx={shape.rx} fill={paint} />

      {/* mirrors, just outboard of the windscreen */}
      <Rect x={x0 - 3.2} y={hoodY - 0.5} width={3.6} height={5.4} rx={1.6} fill={sill} />
      <Rect x={x0 + shape.w - 0.4} y={hoodY - 0.5} width={3.6} height={5.4} rx={1.6} fill={sill} />

      {/* windscreen: narrows toward the nose */}
      <Path
        d={`M${across(0.2)},${hoodY} L${across(0.8)},${hoodY} L${across(0.85)},${roofA} L${across(0.15)},${roofA} Z`}
        fill={glass}
      />

      {shape.bed ? (
        <>
          <Rect
            x={across(0.1)}
            y={at(shape.bed[0])}
            width={shape.w * 0.8}
            height={shape.len * (shape.bed[1] - shape.bed[0])}
            rx={2.5}
            fill={shadeColor(paint, -0.42)}
          />
          <Rect
            x={across(0.16)}
            y={at(shape.bed[0]) + 2.4}
            width={shape.w * 0.68}
            height={shape.len * (shape.bed[1] - shape.bed[0]) - 4.8}
            rx={2}
            fill={shadeColor(paint, -0.56)}
          />
        </>
      ) : null}

      {/* roof panel and rear glass */}
      <Rect
        x={across(0.16)}
        y={roofA}
        width={shape.w * 0.68}
        height={roofB - roofA}
        rx={3}
        fill={roofPaint}
      />
      {!shape.bed ? (
        <Path
          d={`M${across(0.18)},${roofB} L${across(0.82)},${roofB} L${across(0.77)},${tailY} L${across(0.23)},${tailY} Z`}
          fill={glass}
        />
      ) : null}

      {/* gloss down the centre of the roof */}
      {gloss > 0.02 ? (
        <Rect
          x={across(0.22)}
          y={roofA + 1.5}
          width={shape.w * 0.11}
          height={Math.max(0, roofB - roofA - 3)}
          rx={1.5}
          fill="#fff"
          opacity={gloss}
        />
      ) : null}

      {shape.chrome ? (
        <>
          <Rect x={x0 + 1} y={hoodY} width={1.1} height={tailY - hoodY} fill="#c9ccd2" opacity={0.34} />
          <Rect
            x={x0 + shape.w - 2.1}
            y={hoodY}
            width={1.1}
            height={tailY - hoodY}
            fill="#c9ccd2"
            opacity={0.34}
          />
        </>
      ) : null}

      {/* lamps */}
      <Rect x={across(0.1)} y={y0 + 1.4} width={shape.w * 0.18} height={4} rx={1.6} fill="#e8e2c8" />
      <Rect x={across(0.72)} y={y0 + 1.4} width={shape.w * 0.18} height={4} rx={1.6} fill="#e8e2c8" />
      <Rect
        x={across(0.1)}
        y={y0 + shape.len - 5.4}
        width={shape.w * 0.18}
        height={4}
        rx={1.6}
        fill="#8f3630"
      />
      <Rect
        x={across(0.72)}
        y={y0 + shape.len - 5.4}
        width={shape.w * 0.18}
        height={4}
        rx={1.6}
        fill="#8f3630"
      />

      {rough ? (
        <G opacity={0.5}>
          <Ellipse cx={across(0.26)} cy={at(0.62)} rx={shape.w * 0.13} ry={shape.len * 0.04} fill="#7a4a2c" />
          <Ellipse cx={across(0.78)} cy={at(0.34)} rx={shape.w * 0.1} ry={shape.len * 0.03} fill="#7a4a2c" />
        </G>
      ) : null}
    </Svg>
  );
}

// The lot redraws behind a 250ms tick; these props change rarely.
export const CarTop = memo(CarTopBase);
