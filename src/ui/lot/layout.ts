/**
 * Where every car parks.
 *
 * Pure geometry: no React, no react-native, no `GameState`. Give it a capacity
 * and a viewport width and it hands back a painted lot — stalls, rows, aisles,
 * the showroom band across the top and the street frontage at the bottom.
 *
 * This file exists because the lot has to work across a 12x range. A curbstoner
 * holds 5 cars; a fully paved premium franchise holds 62 (42 base plus five
 * levels of `lot` at +4). A layout that looks right at one end is unreadable at
 * the other, so the camera pulls back as the business grows: more columns,
 * smaller cars, tighter rows. Doing that here — once, in a function with a test
 * file — is the whole reason the scene component stays simple.
 *
 * It is also what makes "Pave another row" mean something. Capacity is the only
 * input that matters, so buying the upgrade literally paves another row.
 */

/**
 * The top-down car artboard. Every archetype is drawn inside this box so a van
 * really is bigger than a hatch, and so one scale factor positions all of them.
 * Matches the viewBox in `art/vector/CarTop.tsx` — change both or neither.
 */
export const CAR_BOX_W = 60;
export const CAR_BOX_L = 124;

/**
 * Default gap between the lot edge and the outermost stall. Each store can
 * widen it: a driveway is a narrow strip of concrete with lawn either side, and
 * spreading its stalls the full width of the screen makes it read as a car park
 * attached to a house rather than as somebody's home.
 */
export const DEFAULT_EDGE_PAD = 12;
/**
 * Share of a stall's width the car artboard takes up. The rest is paint.
 *
 * This is the artboard, not the car: both renderers draw a car smaller than the
 * box it sits in, because the box is sized for the longest vehicle in the set
 * and a hatchback is not a crew-cab pickup. Tuned by looking at a full lot —
 * lower and the cars float in their stalls with the tarmac reading as empty.
 */
const CAR_FILL = 0.84;
/** Cars never get sillier than this, in either direction. */
const MIN_SCALE = 0.42;
const MAX_SCALE = 1.85;
/** Space between the tail of one row and the nose of the next. */
const ROW_GAP = 14;
/** A drive aisle every this many rows, so the lot reads as a lot. */
const AISLE_EVERY = 2;
const AISLE_DEPTH = 46;
/**
 * Default depth of the building band across the top, and the run-in between it
 * and row one. Each store overrides the depth — a house needs more room than a
 * portable office — so this is only the fallback.
 */
export const DEFAULT_SHOWROOM_DEPTH = 96;
export const DEFAULT_APRON = 22;
/** Curb, sidewalk and road along the bottom edge. */
const FRONTAGE_DEPTH = 128;

/**
 * How many cars park abreast. A table rather than a formula because the
 * boundaries are judgement calls — three across is the most that stays legible
 * on a driveway, six the most that fits a phone at the top of the ladder.
 */
const COLUMN_STEPS: readonly { upTo: number; cols: number }[] = [
  { upTo: 3, cols: 2 },
  { upTo: 8, cols: 3 },
  { upTo: 18, cols: 4 },
  { upTo: 34, cols: 5 },
  { upTo: Number.POSITIVE_INFINITY, cols: 6 },
];

export interface LotSlot {
  index: number;
  row: number;
  col: number;
  /** Top-left of the painted stall, in lot coordinates. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Top-left of the car drawn inside the stall, already centred. */
  carX: number;
  carY: number;
}

export interface LotLayout {
  capacity: number;
  cols: number;
  rows: number;
  /** Multiplier from the car artboard to on-screen pixels. */
  carScale: number;
  carWidth: number;
  carLength: number;
  slots: readonly LotSlot[];
  /** The whole scrollable surface. */
  width: number;
  height: number;
  showroomDepth: number;
  /**
   * Depth of the display forecourt between the building and row one.
   *
   * A driveway has none to speak of; a franchise has a deep paved apron in
   * front of the showroom that is part of how big the place looks. Reported so
   * the ground plate can paint it rather than re-deriving it from the first
   * stall.
   */
  apron: number;
  /** Where the curb starts. Everything below this is street, not lot. */
  frontageY: number;
  frontageDepth: number;
}

export function columnsFor(capacity: number): number {
  const step = COLUMN_STEPS.find((s) => capacity <= s.upTo);
  return step ? step.cols : COLUMN_STEPS[COLUMN_STEPS.length - 1].cols;
}

/**
 * Build the lot.
 *
 * `capacity` is what `carCapacity(state)` returns — the number of stalls to
 * paint, occupied or not. Empty stalls are the point: an eight-car lot holding
 * three cars should look like a lot with room, not like a three-car lot.
 */
export function lotLayout(
  capacity: number,
  viewportWidth: number,
  showroomDepth: number = DEFAULT_SHOWROOM_DEPTH,
  edgePad: number = DEFAULT_EDGE_PAD,
  siteWidth: number = 1,
  apron: number = DEFAULT_APRON,
): LotLayout {
  const stalls = Math.max(1, Math.floor(capacity));
  const building = Math.max(0, showroomDepth);
  const base = Math.max(240, viewportWidth);
  const site = Math.max(1, siteWidth);
  const width = base * site;
  // Never let the inset eat the lot on a narrow screen.
  const pad = Math.max(0, Math.min(edgePad, base * 0.22)) * site;
  // COLUMNS SCALE WITH THE SITE, which is what keeps a bigger lot from being a
  // zoom-out. Lot coordinates only mean anything against the car artboard, so
  // widening the ground without adding columns would just make every stall
  // wider and every car bigger with it, and nothing would look any larger.
  // Scaling both leaves a stall exactly the size it was and puts more of them
  // abreast: the site really is twice the ground, and a car really is half the
  // share of it.
  const cols = Math.max(2, Math.round(columnsFor(stalls) * site));
  const rows = Math.ceil(stalls / cols);

  const stallWidth = (width - pad * 2) / cols;
  const carScale = clamp((stallWidth * CAR_FILL) / CAR_BOX_W, MIN_SCALE, MAX_SCALE);
  const carWidth = CAR_BOX_W * carScale;
  const carLength = CAR_BOX_L * carScale;

  const stallHeight = carLength + ROW_GAP * carScale;
  const aisleDepth = AISLE_DEPTH * carScale;
  // A wide site gets a drive lane per row rather than one per pair. Doubling
  // the columns halves the rows, and four rows of twelve run together into one
  // slab of metal without a lane between them — which is also why a real
  // dealership of that shape has one.
  const aisleEvery = site > 1.5 ? 1 : AISLE_EVERY;

  const slots: LotSlot[] = [];
  let y = building + Math.max(0, apron);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const index = row * cols + col;
      if (index >= stalls) break;
      const x = pad + col * stallWidth;
      slots.push({
        index,
        row,
        col,
        x,
        y,
        width: stallWidth,
        height: stallHeight,
        carX: x + (stallWidth - carWidth) / 2,
        carY: y + (stallHeight - carLength) / 2,
      });
    }
    y += stallHeight;
    // An aisle after the last row of a group, but never a trailing one — the
    // street is the bottom edge, and a lot does not end in a strip of nothing.
    if ((row + 1) % aisleEvery === 0 && row < rows - 1) y += aisleDepth;
  }

  const frontageY = y + 10 * carScale;

  return {
    capacity: stalls,
    cols,
    rows,
    carScale,
    carWidth,
    carLength,
    slots,
    width,
    height: frontageY + FRONTAGE_DEPTH,
    showroomDepth: building,
    apron: Math.max(0, apron),
    frontageY,
    frontageDepth: FRONTAGE_DEPTH,
  };
}

/**
 * FNV-1a. Any stable string hash would do; the requirement is that it is pure
 * and lives here rather than on the save.
 */
export function hashId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Which stall each car parks in.
 *
 * Derived from a hash of `car.id` rather than stored on the save, which is the
 * whole trick: no `SAVE_VERSION` bump, no new nested object for `cloneState()`
 * to miss, and a car parks in the same place every render for the life of the
 * game.
 *
 * Hash-then-probe rather than "fill in array order" on purpose. Filling in order
 * means every car behind the one you just sold shuffles forward a stall, which
 * on a 62-car lot is the entire back half of the screen moving because one car
 * left. Here, a car only ever moves if it had been displaced by the car that
 * left, so the lot stays still.
 *
 * Returns slot indices parallel to `carIds`. Anything that will not fit inside
 * `slotCount` is given an overflow index past the end — a v-whatever save can
 * sit over its capacity the same way the loan book can, and the answer is to
 * draw it, not to hide a car somebody owns.
 */
export function assignSlots(carIds: readonly string[], slotCount: number): number[] {
  const taken = new Set<number>();
  const out: number[] = [];
  let overflow = Math.max(0, slotCount);

  for (const id of carIds) {
    if (slotCount <= 0 || taken.size >= slotCount) {
      out.push(overflow++);
      continue;
    }
    const preferred = hashId(id) % slotCount;
    let slot = preferred;
    while (taken.has(slot)) slot = (slot + 1) % slotCount;
    taken.add(slot);
    out.push(slot);
  }

  return out;
}

/**
 * A small stable integer per car, for the choices that should be consistent
 * forever but are not worth saving: which wheel trim, how the car sits in its
 * stall, which way it is parked.
 */
export function variantOf(id: string, buckets: number): number {
  if (buckets <= 1) return 0;
  // A different mix of the hash than `assignSlots` uses, so a car's stall and
  // its trim are not correlated.
  return (Math.imul(hashId(id) ^ 0x9e3779b9, 0x85ebca6b) >>> 0) % buckets;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
