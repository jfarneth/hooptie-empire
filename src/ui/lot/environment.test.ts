import { STAGE_ORDER, getStage } from '../../sim/stages';
import { environmentFor } from './environment';

/**
 * The six storefronts, checked against the ladder they are meant to describe.
 *
 * `environment.ts` is a table of taste and most of it can only be reviewed by
 * looking — `tools/screenshots/lots.js` photographs every stage for exactly
 * that. What CAN be asserted is the part that is not taste: the art must not
 * contradict the simulation, and the progression must actually progress.
 */

describe('the storefront ladder', () => {
  /**
   * THE ONE THAT MATTERS. A lot that shows service bay doors is telling the
   * player this store has a workshop, and at three of the six it does not —
   * `STAGES[].shop` is undefined until the first franchise. Drawing them anyway
   * would be the same class of lie as the empty-lot copy that told a new player
   * to look for cars priced under wholesale: player-facing, confident, and
   * describing a game that does not exist.
   *
   * Mutation-test by giving `largeUsed` a bay: it goes red.
   */
  it('never shows a service bay at a store that cannot open a shop', () => {
    for (const id of STAGE_ORDER) {
      if (environmentFor(id).bays > 0) {
        expect(getStage(id).shop).toBeDefined();
      }
    }
    // And it is not vacuous: the franchises really do draw doors.
    const withBays = STAGE_ORDER.filter((id) => environmentFor(id).bays > 0);
    expect(withBays.length).toBe(STAGE_ORDER.filter((id) => getStage(id).shop).length);
  });

  /**
   * Glass is the progression. A dealership gets more expensive almost entirely
   * by replacing wall with window, which is why this one number carries the
   * three franchises apart and the wall colours barely move — so it has to
   * climb, and a retune that accidentally flattened it would take the top of
   * the ladder with it.
   */
  it('never puts less glass on a bigger store', () => {
    const glazing = STAGE_ORDER.map((id) => environmentFor(id).glazing);
    for (let i = 1; i < glazing.length; i += 1) {
      expect(glazing[i]).toBeGreaterThanOrEqual(glazing[i - 1]);
    }
    // A curbstoner's house has none and a flagship is mostly window.
    expect(glazing[0]).toBe(0);
    expect(glazing[glazing.length - 1]).toBeGreaterThan(0.7);
  });

  /**
   * The curbstone stage's whole joke is that this is not a dealership, it is
   * somebody's house — so it is the only pitched roof on the ladder, and every
   * store above it has the flat roof a commercial building has.
   */
  it('gives a pitched roof to the house and to nothing else', () => {
    const gabled = STAGE_ORDER.filter((id) => environmentFor(id).roof === 'gable');
    expect(gabled).toEqual(['curbstone']);
    expect(environmentFor('curbstone').ridge).toBeGreaterThan(0);
  });

  /** Pennants and a tube man are what a used lot does. A franchise does not. */
  it('keeps the cheap flare on the used lots', () => {
    for (const id of STAGE_ORDER) {
      const env = environmentFor(id);
      if (getStage(id).shop) {
        expect(env.bunting).toBe(false);
        expect(env.airDancer).toBe(false);
      }
    }
    expect(STAGE_ORDER.filter((id) => environmentFor(id).airDancer)).toHaveLength(1);
  });
});
