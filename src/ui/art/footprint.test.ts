import { ARCHETYPES, bodyStyleOf } from './archetypes';
import { footprintFor, type ArtSource } from './footprint';
import { SIDE_SHAPES, TOP_SHAPES } from './vector/shapes';

/**
 * The trim overlay's two archetype-keyed lookups.
 *
 * `RarityTrim` is a drawing, and this project has no component renderer, so
 * these are the parts of it that can be tested honestly: everything the overlay
 * positions itself from comes through `footprintFor` or `SIDE_SHAPES`, and a
 * missing entry in either is exactly how a spoiler ends up in mid-air or an
 * archetype nobody has drawn crashes the lot.
 *
 * That last case is the one that matters. `coupeEconomy`, `hatchPremium` and
 * `vanPremium` are unreachable from the current catalogue and deliberately have
 * no sprite — they are the standing test of the fallback contract, and trim has
 * to work on them the day somebody adds a model that reaches one.
 */

const SOURCES: ArtSource[] = ['sprite', 'vector'];

describe('footprintFor', () => {
  it('answers for every archetype from either renderer', () => {
    for (const archetype of ARCHETYPES) {
      for (const source of SOURCES) {
        const fp = footprintFor(archetype, source);
        for (const value of Object.values(fp)) {
          expect(Number.isFinite(value)).toBe(true);
          // Fractions of the artboard, never pixels. Zero is legal at the low
          // edge: truckPremium is the longest thing in the catalogue and the
          // vector artboard is sized for exactly it, so it starts at y = 0.
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(1);
        }
        expect(fp.X).toBeGreaterThan(fp.x);
        expect(fp.Y).toBeGreaterThan(fp.y);
      }
    }
  });

  it('never hands back a footprint the car would not fill', () => {
    // A car occupying under half its artboard, or a body narrower than a
    // stripe, means the measurement went wrong rather than that the car is
    // small — and the symptom would be trim floating beside the paintwork.
    for (const archetype of ARCHETYPES) {
      for (const source of SOURCES) {
        const fp = footprintFor(archetype, source);
        expect(fp.Y - fp.y).toBeGreaterThan(0.5);
        expect(fp.X - fp.x).toBeGreaterThan(0.5);
        for (const w of [fp.hoodW, fp.midW, fp.tailW]) {
          expect(w).toBeGreaterThan(0.4);
          // Body width is measured across the car, so it cannot meaningfully
          // exceed the bounding box the same pass produced. The slack is one
          // unit in the last place the measuring script rounds to — sedanPremium
          // lands 0.771 against a 0.770 box — not room for a real disagreement.
          expect(w).toBeLessThanOrEqual(fp.X - fp.x + 0.002);
        }
      }
    }
  });

  /**
   * The three archetypes with no rendered frame must fall through to the vector
   * footprint rather than to a default that happens to be a sedan. Mutation-test
   * this one by pointing the fallback at a fixed archetype: it goes red.
   */
  it('falls back to the vector framing for an archetype with no sprite', () => {
    for (const archetype of ['coupeEconomy', 'hatchPremium', 'vanPremium'] as const) {
      expect(footprintFor(archetype, 'sprite')).toEqual(footprintFor(archetype, 'vector'));
      // And it is genuinely that archetype's own shape, not a stand-in.
      const shape = TOP_SHAPES[archetype];
      expect(footprintFor(archetype, 'vector').midW).toBeCloseTo(shape.w / 60, 6);
    }
  });

  it('derives the vector footprint from the shapes rather than a second table', () => {
    // If these ever disagree, one of them is a corpse.
    for (const archetype of ARCHETYPES) {
      const fp = footprintFor(archetype, 'vector');
      const shape = TOP_SHAPES[archetype];
      expect(fp.X - fp.x).toBeCloseTo(shape.w / 60, 6);
      expect(fp.Y - fp.y).toBeCloseTo(shape.len / 124, 6);
      // Centred, which is what lets the overlay put a stripe down the middle.
      expect((fp.x + fp.X) / 2).toBeCloseTo(0.5, 6);
    }
  });
});

describe('side trim anchors', () => {
  it('exist for every archetype, on the car rather than off it', () => {
    for (const archetype of ARCHETYPES) {
      const shape = SIDE_SHAPES[bodyStyleOf(archetype)];
      expect(shape).toBeDefined();

      const { shoulder, sill, deck, roofY, roof, bolt } = shape.trim;
      // The artboard is 0 0 100 44 and the car sits inside it.
      expect(roofY).toBeLessThan(shoulder);
      expect(shoulder).toBeLessThan(sill);
      expect(sill).toBeLessThan(44);
      expect(deck[1]).toBeGreaterThan(deck[0]);
      expect(roof[1]).toBeGreaterThan(roof[0]);
      expect(['spoiler', 'offroad', 'rails']).toContain(bolt);

      // A spoiler is drawn across 74% of the deck, so a deck too short to hold
      // one is a deck measured off the wrong edge. Only asked of the shapes
      // that wear a spoiler: a van's deck really is eight units and it does not
      // matter, because a van gets roof rails.
      if (bolt === 'spoiler') expect(deck[1] - deck[0]).toBeGreaterThan(10);
      expect(roof[1] - roof[0]).toBeGreaterThan(8);
    }
  });

  it('gives trucks and SUVs the off-road treatment and vans the rails', () => {
    // A lift cannot be drawn by an additive overlay and is invisible from
    // overhead besides, so these three groups are genuinely different
    // treatments rather than a cosmetic split.
    expect(SIDE_SHAPES.truck.trim.bolt).toBe('offroad');
    expect(SIDE_SHAPES.suv.trim.bolt).toBe('offroad');
    expect(SIDE_SHAPES.van.trim.bolt).toBe('rails');
    expect(SIDE_SHAPES.sedan.trim.bolt).toBe('spoiler');
    expect(SIDE_SHAPES.coupe.trim.bolt).toBe('spoiler');
    expect(SIDE_SHAPES.hatch.trim.bolt).toBe('spoiler');
  });
});
