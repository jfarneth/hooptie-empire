import React, { memo } from 'react';
import { Image, StyleSheet, View, type ImageSourcePropType } from 'react-native';
import { BODY_COLORS } from '../../sim/models';
import type { Rarity } from '../../sim/types';
import { WEATHERED_GREY, weatherAmount, weatheredColor } from '../theme';
import { archetypeFor, bodyStyleOf } from './archetypes';
import { RarityTrim, hasTrim } from './RarityTrim';
import { spriteFor, type CarAngle } from './registry';
import { CarSide } from './vector/CarSide';
import { CarTop } from './vector/CarTop';

/**
 * Draw a car. The one place the rest of the UI asks for one.
 *
 * This is the seam the art plan hangs off. Callers pass a `modelId` and an angle
 * and get a picture; whether that picture is a rendered sprite or a vector
 * drawing is decided here and nowhere else. When the sprite pipeline lands, this
 * file changes and no screen does.
 *
 * The fallback is not a stopgap, it is the contract: `spriteFor` returns `null`
 * for any archetype nobody has drawn yet, and that is a supported state.
 *
 * Trim grade is composited rather than baked, for the same reason condition is:
 * baking it would multiply the sprite matrix by four and needs a Blender
 * pipeline a normal checkout cannot run. `RarityTrim` therefore draws over
 * whichever renderer produced the car — in two passes, because underglow spills
 * onto the ground beneath the car and everything else sits on top of it.
 */

/**
 * How grey a sprite is allowed to go at zero condition.
 *
 * The vector renderer blends only the paint toward grey, so it can afford the
 * full `weatherAmount`. A sprite has no separable paint — the tinted overlay
 * covers glass, tyres and shadow too — so the same number would flatten the
 * shading that makes the sprite read as three-dimensional at all, which is the
 * entire reason for having sprites.
 *
 * NEEDS EYES ON IT. This is a visual judgement made before any sprite existed;
 * check it against a lot of rough cars and move it rather than trusting it.
 */
const SPRITE_WEAR_CEILING = 0.45;

/** Artboard aspects, so the overlay box matches whatever drew the car. */
const TOP_ASPECT = 124 / 60;
const SIDE_ASPECT = 0.44;

export interface CarArtProps {
  modelId: string;
  colorIndex: number;
  condition: number;
  /** Width on screen. Height follows the artboard's aspect. */
  width: number;
  /** 'top' for the lot, 'side' for the feed and the sheets. */
  angle?: CarAngle;
  /**
   * Stable per-car integer from `variantOf`, for trim that must never change.
   * Vector only for now — the render script emits one frame per colour, not per
   * variant, so a sprite ignores it rather than pretending to vary.
   */
  variant?: number;
  showWear?: boolean;
  /**
   * Trim grade. Defaults to stock so every existing call site keeps drawing
   * exactly what it drew before.
   */
  rarity?: Rarity;
}

function CarArtBase({
  modelId,
  colorIndex,
  condition,
  width,
  angle = 'side',
  variant = 0,
  showWear = true,
  rarity = 'common',
}: CarArtProps) {
  const archetype = archetypeFor(modelId);
  const sprite = spriteFor(archetype, angle, colorIndex);
  const trimmed = hasTrim(rarity);

  // Trim ages with the car it is bolted to: a spoiler on a chalky beater is a
  // chalky spoiler. Both renderers derive their paint the same way, so this is
  // the same colour the bodywork underneath ended up.
  const paint = weatheredColor(
    BODY_COLORS[colorIndex % BODY_COLORS.length],
    showWear ? condition : 1,
  );

  const height = sprite
    ? width * (sprite.height / sprite.width)
    : width * (angle === 'top' ? TOP_ASPECT : SIDE_ASPECT);

  const trim = (layer: 'under' | 'over') =>
    trimmed ? (
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <RarityTrim
          rarity={rarity}
          archetype={archetype}
          angle={angle}
          source={sprite ? 'sprite' : 'vector'}
          layer={layer}
          width={width}
          height={height}
          paint={paint}
        />
      </View>
    ) : null;

  return (
    <View style={{ width, height }}>
      {trim('under')}

      {sprite ? (
        <>
          <Image source={sprite.source} style={{ width, height }} resizeMode="contain" />
          {renderWear(sprite.source, width, height, showWear ? weatherAmount(condition) : 0)}
        </>
      ) : angle === 'top' ? (
        <CarTop
          archetype={archetype}
          colorIndex={colorIndex}
          condition={condition}
          width={width}
          variant={variant}
          showWear={showWear}
        />
      ) : (
        <CarSide
          bodyStyle={bodyStyleOf(archetype)}
          colorIndex={colorIndex}
          condition={condition}
          width={width}
          showWear={showWear}
        />
      )}

      {trim('over')}
    </View>
  );
}

function renderWear(
  source: ImageSourcePropType,
  width: number,
  height: number,
  amount: number,
) {
  const wear = Math.min(SPRITE_WEAR_CEILING, amount);
  if (wear <= 0.01) return null;
  // The same sprite, flattened to grey and laid over itself. Tinting a copy
  // rather than washing the whole box keeps the fade inside the car's
  // silhouette without needing a separate mask asset.
  return (
    <Image
      source={source}
      tintColor={WEATHERED_GREY}
      resizeMode="contain"
      style={[StyleSheet.absoluteFill, { width, height, opacity: wear }]}
    />
  );
}

export const CarArt = memo(CarArtBase);
