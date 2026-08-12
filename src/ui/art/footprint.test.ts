import { ARCHETYPES, bodyStyleOf, type Archetype } from './archetypes';
import { footprintFor, frameAxes, spriteFootprint, type ArtSource } from './footprint';
import type { CarAngle } from './registry';
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

/**
 * The projection the three-quarter trim is placed through.
 *
 * `SideSpriteTrim` names every point in the car's own space — along the length,
 * out to the flank, up to the roof — and projects it with these. A wrong sign
 * or a collapsed axis puts a spoiler in mid-air on every rare car in the game
 * and nothing throws, so the properties below are the guard: they are checked
 * against the FOOTPRINT from the same run, which is the independent
 * measurement of where the car actually is on that frame.
 */
describe('frameAxes', () => {
  const ANGLES: CarAngle[] = ['top', 'side'];
  const RENDERED = ARCHETYPES.filter((a) => spriteFootprint(a, 'top') !== null);
  const UNRENDERED = ['coupeEconomy', 'hatchPremium', 'vanPremium'] as const;

  it('covers exactly the archetypes that have frames', () => {
    expect(RENDERED.length).toBeGreaterThan(0);
    for (const angle of ANGLES) {
      for (const archetype of RENDERED) expect(frameAxes(archetype, angle)).not.toBeNull();
      for (const archetype of UNRENDERED) expect(frameAxes(archetype, angle)).toBeNull();
    }
  });

  it('spans a real car rather than a collapsed one', () => {
    for (const angle of ANGLES) {
      for (const archetype of RENDERED) {
        const a = frameAxes(archetype, angle)!;
        const len = (v: { x: number; y: number }) => Math.hypot(v.x, v.y);
        // Every axis has to cover a visible slice of the artboard, or the car
        // was measured end-on and trim would stack on a single point.
        expect(len(a.length)).toBeGreaterThan(0.1);
        expect(len(a.width)).toBeGreaterThan(0.02);
        expect(len(a.up)).toBeGreaterThan(0.02);
        // Height only ever moves a point UP the screen — the same invariant
        // the lot camera holds. A positive y here is a sign flip, and it puts
        // the roof rails under the car.
        expect(a.up.y).toBeLessThan(0);
      }
    }
  });

  /**
   * The load-bearing one, and the direction of it is the whole point.
   *
   * It does NOT ask that the car's corners land inside the silhouette — they
   * cannot, and asking cost a first draft: a car's bounding box is mostly empty
   * at its corners, so the corner at (nose, near flank, roof) really is a
   * couple of percent of the artboard above the bonnet. What must hold is the
   * other way round: the box the trim is placed in has to CONTAIN the car the
   * footprint measured, and not be much bigger than it. Too small and a stripe
   * runs off the end of the flank; too big and it floats.
   *
   * WHAT IT CANNOT SEE, because it was written claiming it could and the
   * mutation ran green: which END of the car `length` points at. The box is
   * taken over l = ±1, so negating `length` produces an identical box — and a
   * negated `length` is a real bug, the one that puts the spoiler on the
   * bonnet. Nothing in these numbers distinguishes a nose from a boot, and no
   * arrangement of them can; it is a fact about the picture. It is checked the
   * way this repo checks pictures — by opening the game and looking, which is
   * how the storefront traffic bug and the dead feed-slot bonus were both
   * found — and it is held by the generator computing the nose from the model's
   * own bounds rather than from a constant.
   *
   * What it does catch: a stale table against re-rendered frames, an axis that
   * has collapsed, and an axis scaled to the wrong car.
   */
  it('spans the car the footprint measured, and not much more', () => {
    for (const angle of ANGLES) {
      for (const archetype of RENDERED) {
        const a = frameAxes(archetype, angle)!;
        const fp = spriteFootprint(archetype, angle)!;

        const xs: number[] = [];
        const ys: number[] = [];
        for (const l of [-1, 1]) {
          for (const w of [-1, 1]) {
            for (const u of [0, 1]) {
              xs.push(a.anchor.x + a.length.x * l + a.width.x * w + a.up.x * u);
              ys.push(a.anchor.y + a.length.y * l + a.width.y * w + a.up.y * u);
            }
          }
        }
        const box = {
          x: Math.min(...xs),
          X: Math.max(...xs),
          y: Math.min(...ys),
          Y: Math.max(...ys),
        };

        // Contains it. The slack is the footprint's own threshold: it is
        // measured off lit pixels, so it clips the darkest sliver of a shadowed
        // flank, where the axes come from geometry and do not.
        expect(box.x).toBeLessThanOrEqual(fp.x + 0.03);
        expect(box.X).toBeGreaterThanOrEqual(fp.X - 0.03);
        expect(box.y).toBeLessThanOrEqual(fp.y + 0.03);
        expect(box.Y).toBeGreaterThanOrEqual(fp.Y - 0.03);

        // And is still the same car. A bounding box is legitimately bigger than
        // the silhouette inside it — empty corners — and the measured worst case
        // is 1.47, at truckEconomy in profile, where the box has to reach past
        // an open load bed to the cab roof. 1.6 is that with room, and it is
        // what catches an axis scaled off a different archetype.
        expect(box.X - box.x).toBeLessThan((fp.X - fp.x) * 1.6);
        expect(box.Y - box.y).toBeLessThan((fp.Y - fp.y) * 1.6);

        // And it is roughly on the artboard. The tolerance is wide on purpose:
        // a frame is fitted to VERTICES, so the empty corner of a bounding box
        // legitimately hangs a few percent past the edge on the biggest car in
        // the set. Nothing is ever drawn out there. What this still catches is
        // an anchor that has drifted off its frame entirely.
        for (const v of [box.x, box.X, box.y, box.Y]) {
          expect(v).toBeGreaterThanOrEqual(-0.1);
          expect(v).toBeLessThanOrEqual(1.1);
        }
      }
    }
  });

  it('points the length down the frame overhead and across it in profile', () => {
    // The two angles are genuinely different pictures, and this is the cheapest
    // statement of how: from above a car is long top-to-bottom, from the side
    // it is long left-to-right. A views.json edit that swapped them would sail
    // through every other test here.
    for (const archetype of RENDERED) {
      const top = frameAxes(archetype, 'top')!;
      const side = frameAxes(archetype, 'side')!;
      expect(Math.abs(top.length.y)).toBeGreaterThan(Math.abs(top.length.x));
      expect(Math.abs(side.length.x)).toBeGreaterThan(Math.abs(side.length.y));
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
