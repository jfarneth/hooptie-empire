import { advance, cloneState, createInitialState } from '../sim/engine';
import { retailValue } from '../sim/economy';
import type { Car, GameState, Rarity } from '../sim/types';
import { specialFinds } from './finds';

/**
 * The away-summary carousel picks its cars by acquisition time.
 *
 * That is a one-comparison rule and therefore exactly the kind that looks
 * correct while being off by one: an `acquiredAt > before.t` or a read of the
 * wrong clock would show yesterday's cars every single morning, and nothing
 * about the screen would look wrong.
 */

function car(over: Partial<Car>): Car {
  return {
    id: 'car_x',
    modelId: 'civet',
    colorIndex: 0,
    rarity: 'common',
    mileage: 80_000,
    condition: 0.7,
    costBasis: 5_000,
    acquiredAt: 0,
    status: 'ready',
    reconRemainingMs: 0,
    reconTotalMs: 0,
    reconTargetCondition: 0.7,
    askPrice: 0,
    listedAt: null,
    repoCount: 0,
    ...over,
  };
}

/** When the player closed the app; catch-up runs from here. */
const CLOSED_AT = 3_600_000;

/** A pair of states an hour apart, with whatever cars the caller wants. */
function window(cars: Car[]): { before: GameState; after: GameState } {
  const before = cloneState(createInitialState(5, 0));
  before.t = CLOSED_AT;
  const after = cloneState(before);
  after.t = 7_200_000;
  after.cars = cars;
  return { before, after };
}

describe('specialFinds', () => {
  it('takes only what was bought inside the window', () => {
    const { before, after } = window([
      car({ id: 'old', rarity: 'legendary', acquiredAt: CLOSED_AT - 1 }),
      car({ id: 'new', rarity: 'legendary', acquiredAt: CLOSED_AT + 1 }),
      car({ id: 'exactly-on-the-boundary', rarity: 'epic', acquiredAt: CLOSED_AT }),
    ]);

    const ids = specialFinds(before, after).map((f) => f.car.id);
    expect(ids).toContain('new');
    // The instant the player closed the app counts as during the absence: that
    // tick was simulated by catch-up, not watched.
    expect(ids).toContain('exactly-on-the-boundary');
    expect(ids).not.toContain('old');
  });

  it('ignores stock and Sport cars', () => {
    // Rare is roughly one every eight minutes. A card for each would turn the
    // one screen that should feel like an event into a delivery manifest.
    const grades: Rarity[] = ['common', 'rare', 'epic', 'legendary'];
    const { before, after } = window(
      grades.map((rarity) => car({ id: rarity, rarity, acquiredAt: CLOSED_AT + 1 })),
    );
    expect(specialFinds(before, after).map((f) => f.car.id)).toEqual(['legendary', 'epic']);
  });

  it('ignores a car that was sold again before anyone looked', () => {
    const { before, after } = window([
      car({ id: 'gone', rarity: 'legendary', acquiredAt: CLOSED_AT + 1, status: 'sold' }),
    ]);
    expect(specialFinds(before, after)).toEqual([]);
  });

  it('quotes the deal in dollars, with the spread being the trim premium', () => {
    const found = car({ id: 'u', rarity: 'legendary', acquiredAt: CLOSED_AT + 1, costBasis: 5_000 });
    const { before, after } = window([found]);

    const [find] = specialFinds(before, after);
    expect(find.paid).toBe(5_000);
    expect(find.worth).toBe(retailValue(found));
    // The premium is real money: a legendary Civet at 80k miles and 70% is worth
    // meaningfully more than the stock car whose price it was bought at.
    expect(find.worth - find.paid).toBeGreaterThan(3_000);
  });

  it('puts the rarest first', () => {
    const { before, after } = window([
      car({ id: 'e', rarity: 'epic', acquiredAt: CLOSED_AT + 2 }),
      car({ id: 'l', rarity: 'legendary', acquiredAt: CLOSED_AT + 1 }),
    ]);
    expect(specialFinds(before, after).map((f) => f.car.id)).toEqual(['l', 'e']);
  });

  it('finds nothing on an ordinary night, against the real engine', () => {
    // The common case, and the one the carousel must render nothing for: an
    // hour of actual simulation on a fresh save turns up no graded car, because
    // epic is one in a hundred and change and the lot holds two.
    const start = createInitialState(31337, 0);
    expect(specialFinds(start, advance(start, 60 * 60_000))).toEqual([]);
  });
});
