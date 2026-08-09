import React, { memo } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { WEATHERED_GREY, weatherAmount } from '../theme';
import { archetypeFor, bodyStyleOf } from './archetypes';
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
}

function CarArtBase({
  modelId,
  colorIndex,
  condition,
  width,
  angle = 'side',
  variant = 0,
  showWear = true,
}: CarArtProps) {
  const archetype = archetypeFor(modelId);
  const sprite = spriteFor(archetype, angle, colorIndex);

  if (sprite) {
    const height = width * (sprite.height / sprite.width);
    const wear = showWear ? Math.min(SPRITE_WEAR_CEILING, weatherAmount(condition)) : 0;

    return (
      <View style={{ width, height }}>
        <Image source={sprite.source} style={{ width, height }} resizeMode="contain" />
        {wear > 0.01 ? (
          // The same sprite, flattened to grey and laid over itself. Tinting a
          // copy rather than washing the whole box keeps the fade inside the
          // car's silhouette without needing a separate mask asset.
          <Image
            source={sprite.source}
            tintColor={WEATHERED_GREY}
            resizeMode="contain"
            style={[StyleSheet.absoluteFill, { width, height, opacity: wear }]}
          />
        ) : null}
      </View>
    );
  }

  if (angle === 'top') {
    return (
      <CarTop
        archetype={archetype}
        colorIndex={colorIndex}
        condition={condition}
        width={width}
        variant={variant}
        showWear={showWear}
      />
    );
  }

  return (
    <CarSide
      bodyStyle={bodyStyleOf(archetype)}
      colorIndex={colorIndex}
      condition={condition}
      width={width}
      showWear={showWear}
    />
  );
}

export const CarArt = memo(CarArtBase);
