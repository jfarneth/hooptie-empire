import React, { memo } from 'react';
import { Image } from 'react-native';
import { archetypeFor, bodyStyleOf } from './archetypes';
import { spriteFor, type CarAngle } from './registry';
import { CarSide } from './vector/CarSide';
import { CarTop } from './vector/CarTop';

/**
 * Draw a car. The one place the rest of the UI asks for one.
 *
 * This is the seam the whole art plan hangs off. Callers pass a `modelId` and an
 * angle and get a picture; whether that picture is a rendered sprite or a vector
 * drawing is decided here and nowhere else. When the sprite pipeline lands, this
 * file changes and no screen does.
 *
 * The fallback is not a stopgap, it is the contract: `spriteFor` returns `null`
 * for any archetype nobody has drawn yet, and that is a supported state. It is
 * what lets art land one archetype at a time without a broken build in between.
 * Anything that reaches around this component to a sprite table directly will
 * crash on exactly the car that has no art.
 */

export interface CarArtProps {
  modelId: string;
  colorIndex: number;
  condition: number;
  /** Width on screen. Height follows the artboard's aspect. */
  width: number;
  /** 'top' for the lot, 'side' for the feed and the sheets. */
  angle?: CarAngle;
  /** Stable per-car integer from `variantOf`, for trim that must never change. */
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
  const sprite = spriteFor(archetype, angle);

  if (sprite) {
    return (
      <Image
        source={sprite.source}
        style={{ width, height: width * (sprite.height / sprite.width) }}
        resizeMode="contain"
      />
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
