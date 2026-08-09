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
   * Three archetypes are declared but unreachable from the catalogue, so the
   * pipeline never renders them. They are the standing proof of the fallback
   * contract: an archetype with no art must miss cleanly rather than throw or
   * hand back a broken frame, which is what lets art land one archetype at a
   * time. If models.ts ever gains a premium hatch, this list shrinks — what
   * must not change is that a miss stays a clean null.
   */
  const UNRENDERED = ['coupeEconomy', 'hatchPremium', 'vanPremium'] as const;

  it('misses cleanly for archetypes with no art', () => {
    for (const archetype of UNRENDERED) {
      for (let i = 0; i < BODY_COLORS.length; i++) {
        expect(spriteFor(archetype, 'top', i)).toBeNull();
      }
    }
  });

  it('has art for every archetype the catalogue can actually produce', () => {
    const reachable = ARCHETYPES.filter((a) => !UNRENDERED.includes(a as never));
    for (const archetype of reachable) {
      expect(spriteFor(archetype, 'top', 0)).not.toBeNull();
    }
    expect(renderedArchetypes('top').sort()).toEqual([...reachable].sort());
  });

  it('renders the lot only — the feed keeps the vector side profile', () => {
    expect(renderedArchetypes('side')).toHaveLength(0);
    for (const archetype of ARCHETYPES) {
      expect(spriteFor(archetype, 'side', 0)).toBeNull();
    }
  });

  it('carries one frame per body colour, and they are distinct', () => {
    expect(COLOR_VARIANT_COUNT).toBe(BODY_COLORS.length);
    const sources = new Set(
      Array.from({ length: BODY_COLORS.length }, (_, i) =>
        JSON.stringify(spriteFor('sedanEconomy', 'top', i)?.source),
      ),
    );
    // Nine colours must be nine files. Sharing one would mean the repaint step
    // silently produced identical atlases, which is exactly what a packed
    // texture did until it was unpacked.
    expect(sources.size).toBe(BODY_COLORS.length);
  });

  it('reports a frame size the layout can scale from', () => {
    const frame = spriteFor('sedanEconomy', 'top', 0);
    expect(frame!.width).toBeGreaterThan(0);
    expect(frame!.height).toBeGreaterThan(frame!.width);
    // The artboard aspect the lot positions against — see CAR_BOX in layout.ts.
    expect(frame!.height / frame!.width).toBeCloseTo(124 / 60, 1);
  });

  it('wraps a colour index outside the palette rather than returning nothing', () => {
    // colorIndex is save data and the palette could grow or shrink.
    expect(spriteFor('sedanEconomy', 'top', 999)).not.toBeNull();
    expect(spriteFor('sedanEconomy', 'top', -3)).not.toBeNull();
    expect(spriteFor('sedanEconomy', 'top', BODY_COLORS.length)).toEqual(
      spriteFor('sedanEconomy', 'top', 0),
    );
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
