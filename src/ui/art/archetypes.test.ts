import { CAR_MODELS, BODY_COLORS } from '../../sim/models';
import { weatherAmount, weatheredColor, WEATHERED_GREY } from '../theme';
import {
  ARCHETYPES,
  PREMIUM_VALUE_THRESHOLD,
  archetypeFor,
  archetypeForModel,
  bodyStyleOf,
  isPremium,
} from './archetypes';
import { COLOR_VARIANT_COUNT, renderedArchetypes, spriteFor } from './registry';

describe('archetypeForModel', () => {
  it('maps every car in the catalogue to a declared archetype', () => {
    for (const model of CAR_MODELS) {
      expect(ARCHETYPES).toContain(archetypeForModel(model));
    }
  });

  it('keeps the body style recoverable, since the side view still draws by shape', () => {
    for (const model of CAR_MODELS) {
      expect(bodyStyleOf(archetypeForModel(model))).toBe(model.bodyStyle);
    }
  });

  it('splits on value, which is what the ladder is actually about', () => {
    // The cheap truck and the six-figure truck must not be the same picture.
    expect(archetypeFor('ironmark')).toBe('truckEconomy'); // $32k work pickup
    expect(archetypeFor('vm_summit')).toBe('truckPremium'); // $94k crew cab
    expect(archetypeFor('comet')).toBe('sedanEconomy'); // $9.5k beater
    expect(archetypeFor('vm_sovereign')).toBe('sedanPremium'); // $96k saloon
  });

  it('puts every luxury-tier car on the premium side', () => {
    for (const model of CAR_MODELS.filter((m) => m.tier === 'luxury')) {
      expect(isPremium(archetypeForModel(model))).toBe(true);
    }
  });

  it('agrees with the threshold it documents', () => {
    for (const model of CAR_MODELS) {
      expect(isPremium(archetypeForModel(model))).toBe(
        model.baseValue >= PREMIUM_VALUE_THRESHOLD,
      );
    }
  });
});

describe('registry', () => {
  /**
   * The fallback contract. While the table is empty every lookup must miss, so
   * that `CarArt` draws vector art for the whole catalogue and the game renders
   * with no sprites at all. When art starts landing this test changes shape —
   * what must not change is that a *missing* archetype still returns null
   * rather than throwing or returning a broken frame.
   */
  it('misses cleanly for archetypes with no art', () => {
    for (const archetype of ARCHETYPES) {
      for (const angle of ['top', 'side'] as const) {
        for (let i = 0; i < BODY_COLORS.length; i++) {
          expect(spriteFor(archetype, angle, i)).toBeNull();
        }
      }
    }
  });

  it('reports nothing rendered while the table is empty', () => {
    expect(renderedArchetypes('top')).toHaveLength(0);
    expect(renderedArchetypes('side')).toHaveLength(0);
  });

  it('expects one frame per body colour', () => {
    expect(COLOR_VARIANT_COUNT).toBe(BODY_COLORS.length);
  });

  it('survives a colour index outside the palette', () => {
    // colorIndex is save data and the palette could grow or shrink; the lookup
    // wraps rather than handing back undefined.
    expect(spriteFor('sedanEconomy', 'top', 999)).toBeNull();
    expect(spriteFor('sedanEconomy', 'top', -3)).toBeNull();
  });
});

describe('weathering', () => {
  /**
   * Two renderers have to agree on how tired a car looks. The vector blends its
   * paint toward grey by `weatherAmount`; the sprite lays a grey copy of itself
   * over itself at the same figure. If these drift, the same car changes
   * condition when its archetype gets art.
   */
  it('is zero for a showroom car and capped for a wreck', () => {
    expect(weatherAmount(1)).toBe(0);
    expect(weatherAmount(0)).toBeCloseTo(0.62, 5);
    expect(weatherAmount(-5)).toBeCloseTo(0.62, 5);
    expect(weatherAmount(5)).toBe(0);
  });

  it('rises monotonically as condition falls', () => {
    let previous = -1;
    for (let c = 1; c >= 0; c -= 0.1) {
      const amount = weatherAmount(c);
      expect(amount).toBeGreaterThanOrEqual(previous);
      previous = amount;
    }
  });

  it('drives the vector blend it is extracted from', () => {
    // A car at zero condition should land the documented distance toward grey,
    // which is what the sprite overlay's opacity is mirroring.
    const paint = '#b23b3b';
    expect(weatheredColor(paint, 1)).toBe(paint);
    const worn = weatheredColor(paint, 0);
    expect(worn).not.toBe(paint);

    const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
    for (let i = 0; i < 3; i++) {
      const expected = Math.round(
        channel(paint, i) + (channel(WEATHERED_GREY, i) - channel(paint, i)) * weatherAmount(0),
      );
      expect(channel(worn, i)).toBe(expected);
    }
  });
});
