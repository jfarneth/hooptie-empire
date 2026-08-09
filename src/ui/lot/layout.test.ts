import { CAR_BOX_W, assignSlots, columnsFor, hashId, lotLayout, variantOf } from './layout';

/**
 * The lot geometry is pure, so it gets tested like the sim does. The cases that
 * matter are the two ends of the ladder — a driveway and a fully paved premium
 * franchise — because everything in between is interpolation.
 */

const PHONE = 390;

describe('columnsFor', () => {
  it('widens the lot as capacity grows', () => {
    expect(columnsFor(2)).toBe(2); // curbstone, no upgrades
    expect(columnsFor(5)).toBe(3); // curbstone, driveway maxed
    expect(columnsFor(6)).toBe(3); // small used lot
    expect(columnsFor(14)).toBe(4); // large used lot
    expect(columnsFor(22)).toBe(5); // low-cost franchise
    expect(columnsFor(42)).toBe(6); // premium franchise
    expect(columnsFor(62)).toBe(6); // premium franchise, lot maxed
  });

  it('never returns fewer than two abreast', () => {
    expect(columnsFor(0)).toBeGreaterThanOrEqual(2);
    expect(columnsFor(1)).toBeGreaterThanOrEqual(2);
  });
});

describe('lotLayout', () => {
  it('paints one stall per space, occupied or not', () => {
    for (const capacity of [1, 2, 5, 6, 14, 22, 32, 42, 62]) {
      expect(lotLayout(capacity, PHONE).slots).toHaveLength(capacity);
    }
  });

  it('keeps every stall inside the surface', () => {
    for (const capacity of [2, 5, 14, 62]) {
      const layout = lotLayout(capacity, PHONE);
      for (const slot of layout.slots) {
        expect(slot.x).toBeGreaterThanOrEqual(0);
        expect(slot.x + slot.width).toBeLessThanOrEqual(layout.width + 0.001);
        expect(slot.carX).toBeGreaterThanOrEqual(slot.x);
        expect(slot.carY + layout.carLength).toBeLessThanOrEqual(slot.y + slot.height + 0.001);
        // Everything parks on the lot, never in the showroom or the street.
        expect(slot.y).toBeGreaterThanOrEqual(layout.showroomDepth);
        expect(slot.y + slot.height).toBeLessThanOrEqual(layout.frontageY + 0.001);
      }
    }
  });

  it('does not overlap stalls in the same row', () => {
    const layout = lotLayout(62, PHONE);
    const byRow = new Map<number, typeof layout.slots[number][]>();
    for (const slot of layout.slots) {
      byRow.set(slot.row, [...(byRow.get(slot.row) ?? []), slot]);
    }
    for (const row of byRow.values()) {
      const sorted = [...row].sort((a, b) => a.x - b.x);
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i].x).toBeGreaterThanOrEqual(sorted[i - 1].x + sorted[i - 1].width - 0.001);
      }
    }
  });

  it('pulls the camera back as the lot fills up', () => {
    const driveway = lotLayout(5, PHONE);
    const franchise = lotLayout(62, PHONE);
    expect(franchise.carScale).toBeLessThan(driveway.carScale);
    expect(franchise.cols).toBeGreaterThan(driveway.cols);
    // ...but never so far back that a car stops being a car.
    expect(franchise.carWidth).toBeGreaterThan(20);
  });

  it('widens the lot monotonically and never loses a stall', () => {
    let cols = 0;
    for (const capacity of [2, 5, 6, 14, 22, 32, 42, 62]) {
      const layout = lotLayout(capacity, PHONE);
      expect(layout.cols).toBeGreaterThanOrEqual(cols);
      expect(layout.slots).toHaveLength(capacity);
      cols = layout.cols;
    }
  });

  it('only grows downward while the camera holds still', () => {
    // Height is a scroll extent, not a measure of the business: crossing a
    // column boundary pulls the camera back, and a wider lot at a smaller zoom
    // can be shorter than a narrower one (32 stalls at 5 across is taller than
    // 42 at 6 across). That is the intended zoom-out. What must never happen is
    // the lot getting shorter at a *fixed* zoom.
    const byCols = new Map<number, number[]>();
    for (let capacity = 2; capacity <= 62; capacity++) {
      const layout = lotLayout(capacity, PHONE);
      byCols.set(layout.cols, [...(byCols.get(layout.cols) ?? []), layout.height]);
    }
    for (const heights of byCols.values()) {
      for (let i = 1; i < heights.length; i++) {
        expect(heights[i]).toBeGreaterThanOrEqual(heights[i - 1]);
      }
    }
  });

  it('paves another row when a row is what you bought', () => {
    // The `lot` upgrade is +4 spaces. Every step of it must be visible.
    const before = lotLayout(14, PHONE);
    const after = lotLayout(18, PHONE);
    expect(after.rows).toBeGreaterThan(before.rows);
    expect(after.height).toBeGreaterThan(before.height);
  });

  it('scales the car to the stall it sits in', () => {
    const layout = lotLayout(14, PHONE);
    expect(layout.carWidth).toBeCloseTo(CAR_BOX_W * layout.carScale, 5);
    expect(layout.carWidth).toBeLessThan(layout.slots[0].width);
  });

  it('survives a viewport narrower than anything real', () => {
    const layout = lotLayout(62, 120);
    expect(layout.slots).toHaveLength(62);
    for (const slot of layout.slots) {
      expect(slot.width).toBeGreaterThan(0);
    }
  });
});

describe('assignSlots', () => {
  const ids = Array.from({ length: 20 }, (_, i) => `car_${i}`);

  it('is deterministic', () => {
    expect(assignSlots(ids, 24)).toEqual(assignSlots(ids, 24));
  });

  it('parks one car per stall, all in range', () => {
    const slots = assignSlots(ids, 24);
    expect(new Set(slots).size).toBe(ids.length);
    for (const slot of slots) {
      expect(slot).toBeGreaterThanOrEqual(0);
      expect(slot).toBeLessThan(24);
    }
  });

  it('fills a lot that is exactly full', () => {
    const slots = assignSlots(ids, ids.length);
    expect([...slots].sort((a, b) => a - b)).toEqual(ids.map((_, i) => i));
  });

  it('puts an over-capacity book of cars somewhere rather than dropping it', () => {
    const slots = assignSlots(ids, 5);
    expect(slots).toHaveLength(ids.length);
    expect(new Set(slots).size).toBe(ids.length);
  });

  /**
   * The reason this is hash-then-probe rather than "fill in array order".
   * Selling a car must not shuffle the rest of the lot. Guarded because the
   * simpler implementation passes every other test in this file.
   */
  it('leaves undisplaced cars parked where they were when one sells', () => {
    const slotCount = 40;
    // Pick cars whose preferred stalls are all distinct, so nothing in this set
    // is standing in a spot it had to probe for.
    const undisplaced: string[] = [];
    const seen = new Set<number>();
    for (let i = 0; undisplaced.length < 8 && i < 500; i++) {
      const id = `pick_${i}`;
      const preferred = hashId(id) % slotCount;
      if (seen.has(preferred)) continue;
      seen.add(preferred);
      undisplaced.push(id);
    }
    expect(undisplaced).toHaveLength(8);

    const before = assignSlots(undisplaced, slotCount);
    const remaining = undisplaced.filter((_, i) => i !== 3);
    const after = assignSlots(remaining, slotCount);

    remaining.forEach((id, i) => {
      expect(after[i]).toBe(before[undisplaced.indexOf(id)]);
    });
  });
});

describe('variantOf', () => {
  it('is stable and in range', () => {
    for (let i = 0; i < 50; i++) {
      const v = variantOf(`car_${i}`, 4);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(4);
      expect(variantOf(`car_${i}`, 4)).toBe(v);
    }
  });

  it('is not just the parking slot again', () => {
    const ids = Array.from({ length: 40 }, (_, i) => `car_${i}`);
    const slots = assignSlots(ids, 64);
    const variants = ids.map((id) => variantOf(id, 4));
    const correlated = ids.filter((_, i) => slots[i] % 4 === variants[i]).length;
    expect(correlated).toBeLessThan(ids.length);
  });

  it('collapses to a single variant when asked for one', () => {
    expect(variantOf('anything', 1)).toBe(0);
    expect(variantOf('anything', 0)).toBe(0);
  });
});
