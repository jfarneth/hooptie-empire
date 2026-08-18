import {
  advanceStage,
  moveToStage,
  purchaseUpgrade,
  reopeningFloat,
  setDealPolicy,
  stageMovePreview,
} from './actions';
import { appraisalBand } from './appraisal';
import { applyTuning } from './tuning';
import { BALANCE } from './balance';
import { retailValue, wholesaleValue } from './economy';
import { advance, cloneState, createInitialState } from './engine';
import { getModel, modelsForMake, modelsForTiers } from './models';
import { overCapacityFactor } from './notes';
import { appraisalSigma } from './skills';
import { STAGES, STAGE_ORDER, getStage, hasReached, isFranchise, nextStage, stageRank, typicalCarPrice } from './stages';
import { UPGRADES, carCapacity, collectionsCapacity, level, upgradeCost, upgradeUnlocked } from './upgrades';
import type { GameState, StageId } from './types';

/**
 * The six dealerships.
 *
 * Two things here are load-bearing beyond the obvious. The staff reset has to
 * take exactly the payroll and nothing else — a move that quietly ate the loan
 * book or the player's skills would be indistinguishable from a bug and far more
 * expensive. And the franchise stages have to actually *source*: the first
 * version of this shipped a buy rule that could never match a factory invoice,
 * so the feed sat there and the economy flatlined without a single test noticing.
 */

function stateAt(stage: StageId, over: Partial<GameState> = {}): GameState {
  const s = cloneState(createInitialState(4242, 0));
  s.stage = stage;
  s.cash = 100_000_000;
  return Object.assign(s, over);
}

// --------------------------------------------------------------- the ladder

describe('the stage table', () => {
  it('lists every stage exactly once, in progression order', () => {
    expect(STAGES.map((s) => s.id)).toEqual([...STAGE_ORDER]);
    expect(new Set(STAGE_ORDER).size).toBe(STAGE_ORDER.length);
    STAGE_ORDER.forEach((id, i) => expect(stageRank(id)).toBe(i));
  });

  it('starts free and gets monotonically more expensive', () => {
    expect(STAGES[0].entryCost).toBe(0);
    for (let i = 1; i < STAGES.length; i++) {
      expect(STAGES[i].entryCost).toBeGreaterThan(STAGES[i - 1].entryCost);
    }
  });

  it('gives every step up more room, more expensive staff and better credit', () => {
    for (let i = 1; i < STAGES.length; i++) {
      expect(STAGES[i].baseCarCapacity).toBeGreaterThan(STAGES[i - 1].baseCarCapacity);
      expect(STAGES[i].upgradeCostMultiplier).toBeGreaterThanOrEqual(STAGES[i - 1].upgradeCostMultiplier);
      expect(STAGES[i].creditShift).toBeGreaterThanOrEqual(STAGES[i - 1].creditShift);
    }
  });

  it('opens the finance desk at the small lot and never closes it again', () => {
    expect(getStage('curbstone').financing).toBe(false);
    for (const def of STAGES.slice(1)) expect(def.financing).toBe(true);
  });

  /**
   * The markup falls as the store moves upmarket — a premium franchise cannot
   * charge subprime money for approval. Absolute dollars still rise because the
   * cars do, which is the trade the progression is built on.
   */
  it('thins the finance markup as the store moves upmarket', () => {
    const financing = STAGES.filter((s) => s.financing);
    for (let i = 1; i < financing.length; i++) {
      expect(financing[i].bhphMultiplier).toBeLessThan(financing[i - 1].bhphMultiplier);
    }
  });

  /**
   * A bigger store runs a bigger collections department, and the ladder must
   * never say otherwise — a rung that shrank the book would default the paper
   * you carried into it.
   *
   * The shape, not the literal: the used stages take what the desk buys and the
   * top two are worth more than that. Pinning 1.5 here would only restate the
   * table, which is the mistake `financeGrossMultiple` spent months making.
   */
  it('never shrinks the book as you climb, and pays the top stores for their desk', () => {
    for (let i = 1; i < STAGES.length; i++) {
      expect(STAGES[i].collectionsCapacityMult).toBeGreaterThanOrEqual(
        STAGES[i - 1].collectionsCapacityMult,
      );
    }
    for (const def of STAGES.slice(0, 4)) expect(def.collectionsCapacityMult).toBe(1);
    expect(getStage('midsizeFranchise').collectionsCapacityMult).toBeGreaterThan(1);
    expect(getStage('premiumFranchise').collectionsCapacityMult).toBeGreaterThan(1);
  });

  it('sources from a market or a manufacturer, never both and never neither', () => {
    for (const def of STAGES) {
      const { tiers, makeId } = def.sourcing;
      expect(Boolean(tiers) !== Boolean(makeId)).toBe(true);
      if (makeId) expect(modelsForMake(makeId).length).toBeGreaterThan(0);
      else expect(modelsForTiers(tiers!).length).toBeGreaterThan(0);
    }
  });

  it('knows where the ladder ends', () => {
    expect(nextStage('curbstone')?.id).toBe('smallUsed');
    expect(nextStage('premiumFranchise')).toBeNull();
    expect(hasReached('largeUsed', 'smallUsed')).toBe(true);
    expect(hasReached('smallUsed', 'largeUsed')).toBe(false);
  });
});

// ------------------------------------------------------------- the franchise

describe('buying from the manufacturer', () => {
  const franchises = STAGES.filter((s) => isFranchise(s.id));

  it('covers three of the six stages', () => {
    expect(franchises.map((s) => s.id)).toEqual([
      'lowCostFranchise',
      'midsizeFranchise',
      'premiumFranchise',
    ]);
  });

  it('puts one make and nothing but new cars on the feed', () => {
    for (const def of franchises) {
      const s = advance(stateAt(def.id), 30 * 60 * 1000);
      expect(s.listings.length).toBeGreaterThan(0);
      for (const listing of s.listings) {
        const model = getModel(listing.car.modelId);
        expect(model.makeId).toBe(def.sourcing.makeId);
        expect(listing.car.mileage).toBeLessThanOrEqual(def.sourcing.mileageMax);
        expect(listing.car.condition).toBeGreaterThanOrEqual(def.sourcing.conditionMin - 0.001);
        expect(listing.source).toMatch(/allocation/);
      }
    }
  });

  /**
   * The whole point of invoice pricing. On the open market the ask swings +/-20%
   * around wholesale and reading it is the game; here the spread is nearly flat,
   * so there is nothing to read.
   */
  it('prices to a narrow invoice band rather than the open market spread', () => {
    const used = getStage('largeUsed').sourcing;
    const franchise = getStage('midsizeFranchise').sourcing;
    expect(franchise.askMax - franchise.askMin).toBeLessThan(used.askMax - used.askMin);
  });

  it('stops appraising, because nobody appraises a car off a transporter', () => {
    expect(appraisalSigma(stateAt('midsizeFranchise'))).toBe(0);
    expect(appraisalSigma(stateAt('largeUsed'))).toBeGreaterThan(0);

    const s = advance(stateAt('midsizeFranchise'), 20 * 60 * 1000);
    const band = appraisalBand(s.listings[0], appraisalSigma(s));
    expect(band.exact).toBe(true);
    expect(band.low).toBe(band.high);
  });

  it('never leaks a new car onto a used lot, or a used one into the lineup', () => {
    const usedTiers = getStage('largeUsed').sourcing.tiers!;
    for (const m of modelsForTiers(usedTiers)) {
      expect(m.id.startsWith('hv_') || m.id.startsWith('ok_') || m.id.startsWith('vm_')).toBe(false);
    }
    // Halvorsen sells on both sides of the line; the used Pup must not be
    // orderable from the factory just because the badge matches.
    expect(modelsForMake('halvorsen').map((m) => m.id)).not.toContain('pup');
    expect(modelsForTiers(['beater']).map((m) => m.id)).toContain('pup');
  });

  /**
   * Franchise sourcing skips the market-source draw but must still consume it,
   * or the RNG stream would desynchronise and replay would stop matching. Same
   * keystone property engine.test.ts guards for the opening stage.
   */
  it('stays tick-invariant on a franchise feed', () => {
    const bySecond = (() => {
      let s = stateAt('premiumFranchise');
      for (let i = 0; i < 600; i++) s = advance(s, 1_000);
      return s;
    })();
    const inOneGo = advance(stateAt('premiumFranchise'), 600_000);

    expect(bySecond.rng.s).toBe(inOneGo.rng.s);
    expect(bySecond.listings.map((l) => `${l.id}:${l.price}`)).toEqual(
      inOneGo.listings.map((l) => `${l.id}:${l.price}`),
    );
  });
});

// ------------------------------------------------------------ moving stores

describe('taking on the next dealership', () => {
  /** A going concern: staff hired, property bought, paper on the book. */
  function goingConcern(): GameState {
    const s = stateAt('smallUsed');
    s.cash = 8_000_000;
    s.upgrades = {
      driveway: 3, scout: 2, advertising: 2, autoList: 1, autoRecon: 1, lot: 2,
      mechanic: 3, salesDesk: 1, autoBuy: 1, collections: 2, underwriting: 1, repoMan: 1,
    };
    s.dealPolicy = 'auto';
    s.skills.buy.level = 7;
    s.skills.sell.level = 5;
    return s;
  }

  /**
   * Run until there is actually stock parked, rather than for a fixed 40
   * minutes and hoping.
   *
   * A fully automated lot buys, lists and sells continuously, so at any given
   * instant the number of cars on it oscillates through zero — measured, this
   * fixture sits at 0 on fifteen of its first forty minutes. Advancing a fixed
   * span and asserting the lot is non-empty is therefore a coin toss dressed as
   * a precondition, and it lands differently the moment anything shifts the RNG
   * stream. Both tests below need cars on the ground to mean anything at all,
   * so they wait for cars on the ground.
   */
  function withStockOnTheLot(s: GameState): GameState {
    let next = s;
    for (let minute = 0; minute < 90; minute++) {
      next = advance(next, 60_000);
      if (next.cars.some((c) => c.status !== 'sold') && next.listings.length > 0) return next;
    }
    throw new Error('the fixture never held stock — the automated lot has stopped trading');
  }

  it('charges the entry cost and moves the store', () => {
    const before = goingConcern();
    const after = advanceStage(before);
    expect(after.stage).toBe('largeUsed');
    expect(after.cash).toBe(before.cash - getStage('largeUsed').entryCost);
  });

  it('refuses when the cheque would bounce', () => {
    const s = goingConcern();
    s.cash = getStage('largeUsed').entryCost - 1;
    expect(advanceStage(s)).toBe(s);
  });

  it('stops at the top of the ladder', () => {
    const s = stateAt('premiumFranchise');
    expect(advanceStage(s)).toBe(s);
    expect(stageMovePreview(s).target).toBeNull();
  });

  it('takes the whole upgrade table, not just the payroll', () => {
    // The office you built belonged to that store. Everything on the table is
    // bought again at the new one, which is now the dominant cost of a rung.
    const before = goingConcern();
    expect(UPGRADES.some((d) => level(before, d.id) > 0)).toBe(true);

    const after = advanceStage(before);
    for (const def of UPGRADES) {
      if (def.carriesOnMove) continue;
      expect(level(after, def.id)).toBe(0);
    }
  });

  /**
   * The one exception, and the reason it exists: the paper moves intact, so the
   * desk that services it moves too. Releasing it landed a full book far over a
   * reset desk's capacity, where `overCapacityFactor` pinned the miss chance at
   * its ceiling and defaulted the entire portfolio inside a game month — which
   * made "the book comes with you" a sentence the game did not honour.
   */
  it('keeps the collections desk, because the book it services comes too', () => {
    const before = goingConcern();
    before.upgrades.collections = 3;
    const capacityBefore = collectionsCapacity(before);

    const after = advanceStage(before);

    expect(level(after, 'collections')).toBe(3);
    expect(collectionsCapacity(after)).toBe(capacityBefore);
  });

  /**
   * The list of things a player would be furious to lose. Skills especially:
   * CLAUDE.md has called them the carry-over currency since before stages
   * existed, and a move that reset them would make levelling pointless.
   */
  it('leaves cash, inventory, the book and hard-won skills alone', () => {
    const before = goingConcern();
    before.notes = [
      {
        id: 'n1', carId: 'c1', carLabel: 'x', customerName: 'y', customerTier: 'C',
        originalPrincipal: 5_000,
        downPayment: 0, principal: 5_000, apr: 0.239, paymentAmount: 260,
        paymentsTotal: 24, paymentsRemaining: 24, nextDueAt: 999_999_999,
        missedPayments: 0, collected: 0, status: 'current', openedAt: 0,
      },
    ];
    const after = advanceStage(before);

    expect(after.notes).toEqual(before.notes);
    expect(after.cars).toEqual(before.cars);
    expect(after.skills).toEqual(before.skills);
    expect(after.business).toEqual(before.business);
    expect(after.stats).toEqual(before.stats);
  });

  /**
   * The sales manager was staff. Leaving the policy set would have it silently
   * do nothing while the player believed the desk was still closing deals.
   */
  it('stands the sales desk down along with the manager who ran it', () => {
    const after = advanceStage(goingConcern());
    expect(after.dealPolicy).toBe('manual');
    // And it cannot be set again until somebody is rehired.
    expect(setDealPolicy(after, 'auto').dealPolicy).toBe('manual');
  });

  /**
   * The feed belonged to the old store. A franchise that spends its first two
   * minutes showing auction beaters has broken its own promise, and on the used
   * stages a carried-over feed lets a big lot buy the small lot's inventory.
   */
  it('clears the old store’s feed and sells the lot to a wholesaler', () => {
    const before = goingConcern();
    before.upgrades.autoBuy = 1;
    before.cars = withStockOnTheLot(before).cars;
    const held = before.cars.filter((c) => c.status !== 'sold');
    expect(held.length).toBeGreaterThan(0);
    expect(before.listings.length).toBeGreaterThan(0);

    const preview = stageMovePreview(before);
    const after = advanceStage(before);

    expect(after.listings).toEqual([]);
    expect(after.cars.filter((c) => c.status !== 'sold')).toEqual([]);

    // The wholesaler's price, and the haircut is real money off it.
    const full = held.reduce((sum, c) => sum + wholesaleValue(c), 0);
    expect(preview.liquidation.cars).toBe(held.length);
    expect(preview.liquidation.proceeds).toBeLessThan(full);
    expect(preview.liquidation.proceeds).toBeCloseTo(full * BALANCE.forcedSaleRate, -1);
    expect(after.cash).toBe(before.cash - preview.cost + preview.liquidation.proceeds);

    // And it refills from the store you actually moved into.
    const refilled = advance(after, 10 * 60 * 1000);
    expect(refilled.listings.length).toBeGreaterThan(0);
  });

  it('never sells a financed car out from under its note', () => {
    // A financed car stays in `cars` marked sold so a repo can bring it back.
    // Clearing the lot must not touch it, or the book has nothing to repossess
    // and every contract against it is stranded.
    const before = goingConcern();
    before.upgrades.autoBuy = 1;
    before.cars = withStockOnTheLot(before).cars;
    const out = before.cars[0];
    out.status = 'sold';

    const after = advanceStage(before);

    // Every car already delivered survives — those are the book's collateral —
    // and nothing still on the lot does.
    const delivered = before.cars.filter((c) => c.status === 'sold');
    expect(after.cars.map((c) => c.id)).toContain(out.id);
    expect(after.cars.map((c) => c.id).sort()).toEqual(delivered.map((c) => c.id).sort());
    expect(stageMovePreview(before).liquidation.cars).toBe(
      before.cars.length - delivered.length,
    );
  });

  it('warns about exactly what the move will do', () => {
    const before = goingConcern();
    const preview = stageMovePreview(before);
    const after = advanceStage(before);

    expect(preview.target?.id).toBe(after.stage);
    expect(before.cash - after.cash).toBe(preview.cost - preview.liquidation.proceeds);
    // The warning is the truth: everyone it names is gone, and nobody else is.
    const named = preview.staffLost.map((s) => s.name).sort();
    const actuallyLost = UPGRADES.filter(
      (u) => level(before, u.id) > 0 && level(after, u.id) === 0,
    )
      .map((u) => u.name)
      .sort();
    expect(named).toEqual(actuallyLost);
    expect(preview.bookAfter.capacity).toBe(collectionsCapacity(after));
  });
});

// ------------------------------------------ jumping rungs, and walking back

/**
 * The ladder is climbable out of order in both directions, which is two rules:
 * a dealership costs its own entry price no matter which rung you were standing
 * on, and leaving one refunds nothing. Both are easy to break in a way no other
 * test would notice — a jump that charged the sum of the rungs, or a downgrade
 * that quietly handed back the entry cost, would look like generosity rather
 * than like a bug.
 */
describe('jumping rungs and walking back down', () => {
  function goingConcern(stage: StageId, cash: number): GameState {
    const s = stateAt(stage);
    s.cash = cash;
    s.upgrades = { lot: 2, mechanic: 3, salesDesk: 1, collections: 2, scout: 1 };
    s.dealPolicy = 'auto';
    s.skills.buy.level = 7;
    return s;
  }

  it('buys straight past a rung for the target’s price and nothing more', () => {
    const before = goingConcern('smallUsed', 40_000_000);
    const after = moveToStage(before, 'lowCostFranchise');

    expect(after.stage).toBe('lowCostFranchise');
    expect(after.cash).toBe(before.cash - getStage('lowCostFranchise').entryCost);
    // Explicitly NOT the rungs added up: the store you skipped was never bought.
    expect(after.cash).toBeGreaterThan(
      before.cash - getStage('lowCostFranchise').entryCost - getStage('largeUsed').entryCost,
    );
    expect(stageMovePreview(before, 'lowCostFranchise').rungsSkipped).toBe(1);
  });

  it('refuses a jump the cash does not cover', () => {
    const s = goingConcern('smallUsed', getStage('lowCostFranchise').entryCost - 1);
    expect(moveToStage(s, 'lowCostFranchise')).toBe(s);
    expect(stageMovePreview(s, 'lowCostFranchise').allowed).toBe(false);
  });

  it('clears the upgrade table on a jump exactly as it does on a step', () => {
    const after = moveToStage(goingConcern('smallUsed', 400_000_000), 'premiumFranchise');
    for (const def of UPGRADES) {
      if (def.carriesOnMove) continue;
      expect(level(after, def.id)).toBe(0);
    }
    expect(after.dealPolicy).toBe('manual');
    expect(after.listings).toEqual([]);
  });

  /**
   * The book capacity on the confirmation is the TARGET store's, in both
   * directions — half of it is a property of the premises now, so a preview
   * computed at the store being left would promise a Valmont-sized book to
   * somebody who has not moved yet, and hide the shrink on the way back down.
   *
   * The pair is the point. Reading the current stage instead of the target
   * fails going up; hard-coding the target's own multiplier fails coming down.
   */
  it('quotes the book capacity at the store being moved to, both ways', () => {
    const up = goingConcern('lowCostFranchise', 400_000_000);
    const climbed = moveToStage(up, 'premiumFranchise');
    expect(stageMovePreview(up, 'premiumFranchise').bookAfter.capacity).toBe(
      collectionsCapacity(climbed),
    );
    expect(stageMovePreview(up, 'premiumFranchise').bookAfter.capacity).toBeGreaterThan(
      collectionsCapacity(up),
    );

    const down = goingConcern('premiumFranchise', 400_000_000);
    const dropped = moveToStage(down, 'largeUsed');
    expect(stageMovePreview(down, 'largeUsed').bookAfter.capacity).toBe(
      collectionsCapacity(dropped),
    );
    expect(stageMovePreview(down, 'largeUsed').bookAfter.capacity).toBeLessThan(
      collectionsCapacity(down),
    );
  });

  it('costs nothing to go down, and the cash comes with you', () => {
    const before = goingConcern('largeUsed', 40_000_000);
    const after = moveToStage(before, 'smallUsed');

    expect(after.stage).toBe('smallUsed');
    expect(after.cash).toBe(before.cash);
    expect(stageMovePreview(before, 'smallUsed').cost).toBe(0);
  });

  it('writes off the store you leave, and charges full price to come back', () => {
    const before = goingConcern('largeUsed', 40_000_000);
    const preview = stageMovePreview(before, 'smallUsed');
    expect(preview.forfeit).toBe(getStage('largeUsed').entryCost);

    const down = moveToStage(before, 'smallUsed');
    const backUp = moveToStage(down, 'largeUsed');
    // The round trip is pure loss: no credit for the store already paid for.
    expect(backUp.cash).toBe(before.cash - getStage('largeUsed').entryCost);
  });

  it('sells the lot on the way down too, and leaves the book and the skills alone', () => {
    const before = goingConcern('largeUsed', 40_000_000);
    before.upgrades.autoBuy = 1;
    before.cars = advance(before, 40 * 60_000).cars;
    expect(before.cars.length).toBeGreaterThan(0);
    before.notes = [
      {
        id: 'n1', carId: 'c1', carLabel: 'x', customerName: 'y', customerTier: 'C',
        originalPrincipal: 5_000,
        downPayment: 0, principal: 5_000, apr: 0.239, paymentAmount: 260,
        paymentsTotal: 24, paymentsRemaining: 24, nextDueAt: 999_999_999,
        missedPayments: 0, collected: 0, status: 'current', openedAt: 0,
      },
    ];

    const preview = stageMovePreview(before, 'curbstone');
    const after = moveToStage(before, 'curbstone');

    // The lot goes, at the wholesaler's price; the paper and the skills do not.
    expect(after.cars.filter((c) => c.status !== 'sold')).toEqual([]);
    expect(preview.liquidation.proceeds).toBeGreaterThan(0);
    expect(after.cash).toBe(before.cash + preview.liquidation.proceeds);
    expect(after.notes).toEqual(before.notes);
    expect(after.skills).toEqual(before.skills);

    // The driveway it lands on is a driveway, and it is empty — the card has to
    // be able to say both.
    expect(preview.lotAfter.capacity).toBe(carCapacity(after));
  });

  it('stands the sales desk down and clears the feed going down too', () => {
    const before = goingConcern('largeUsed', 40_000_000);
    before.listings = advance(before, 60_000).listings;
    expect(before.listings.length).toBeGreaterThan(0);

    const after = moveToStage(before, 'smallUsed');
    expect(after.listings).toEqual([]);
    expect(after.dealPolicy).toBe('manual');
  });

  it('describes a store you cannot afford without letting you move there', () => {
    const s = goingConcern('curbstone', 500);
    const preview = stageMovePreview(s, 'premiumFranchise');

    expect(preview.target?.id).toBe('premiumFranchise');
    expect(preview.direction).toBe('up');
    expect(preview.cost).toBe(getStage('premiumFranchise').entryCost);
    expect(preview.rungsSkipped).toBe(4);
    expect(preview.allowed).toBe(false);
    expect(moveToStage(s, 'premiumFranchise')).toBe(s);
  });

  /**
   * THE FLOAT IS THE STORE'S OPENING BALANCE, not a formality, because nothing
   * waits once a move is affordable — automation and the harness bot both take a
   * rung the instant they can pay for it, so whatever this asks for is exactly
   * what the business opens its doors with.
   *
   * A flat six cars was three driveways' worth at a curbstone and a seventh of a
   * lot at a Valmont store: the premium franchise was reached with $70M spent on
   * the keys and $21,233 left against $86,000 cars and $20,000 a week of rent.
   * It opened insolvent and never traded again. Sized against the lot and the
   * entry cost, the top of the ladder demands a real opening balance while the
   * early rungs — where the flat floor still binds — are left exactly as they
   * were.
   */
  it('demands a real opening balance at a big store, and no more than it used to at a small one', () => {
    const smallLot = getStage('smallUsed');
    const premium = getStage('premiumFranchise');

    // The early rungs are unchanged: the flat floor still binds, because half of
    // an eight-car lot is less than six cars.
    expect(Math.ceil(smallLot.baseCarCapacity * BALANCE.expenses.reopeningLotShare)).toBeLessThan(
      BALANCE.expenses.reopeningCars,
    );
    expect(reopeningFloat(stateAt('curbstone'), smallLot)).toBe(
      Math.round(
        typicalCarPrice(smallLot) * BALANCE.expenses.reopeningCars +
          smallLot.rentPerWeek * BALANCE.expenses.reserveWeeks +
          smallLot.entryCost * BALANCE.expenses.reopeningCapitalShare,
      ),
    );

    // At the top it is a real number: enough to half-fill forty-two stalls and
    // start rebuilding the office, rather than the price of six cars.
    const float = reopeningFloat(stateAt('midsizeFranchise'), premium);
    const oldRule = typicalCarPrice(premium) * BALANCE.expenses.reopeningCars;
    expect(float).toBeGreaterThan(oldRule * 10);
    expect(float).toBeGreaterThan(typicalCarPrice(premium) * (premium.baseCarCapacity / 2));
  });

  it('does nothing when asked to move to the store you are already in', () => {
    const s = goingConcern('largeUsed', 40_000_000);
    expect(stageMovePreview(s, 'largeUsed').direction).toBe('stay');
    expect(stageMovePreview(s, 'largeUsed').allowed).toBe(false);
    expect(moveToStage(s, 'largeUsed')).toBe(s);
  });

  it('ignores a stage id this build does not know', () => {
    const s = goingConcern('smallUsed', 5_000_000);
    expect(moveToStage(s, 'usedSpaceships' as StageId)).toBe(s);
    expect(stageMovePreview(s, 'usedSpaceships' as StageId).target).toBeNull();
  });
});

// --------------------------------------------------- what the new store costs

describe('staffing a bigger store', () => {
  it('charges more for the same hire the further up you are', () => {
    const mechanic = UPGRADES.find((u) => u.id === 'mechanic')!;
    const costs = STAGES.map((def) => upgradeCost(mechanic, 0, def.id));
    for (let i = 1; i < costs.length; i++) expect(costs[i]).toBeGreaterThanOrEqual(costs[i - 1]);
    expect(costs[costs.length - 1]).toBeGreaterThan(costs[0] * 5);
  });

  it('prices every upgrade up as the ladder goes up', () => {
    // Not just wages. A move clears the whole table, so every line on it is a
    // rebuy, and a bigger store charges bigger-store prices for all of them.
    for (const def of UPGRADES) {
      const costs = STAGES.map((stage) => upgradeCost(def, 0, stage.id));
      for (let i = 1; i < costs.length; i++) {
        expect(costs[i]).toBeGreaterThanOrEqual(costs[i - 1]);
      }
      expect(costs[costs.length - 1]).toBeGreaterThan(costs[0]);
    }
  });

  it('keeps every earlier store’s upgrades available at a later one', () => {
    const big = stateAt('premiumFranchise');
    for (const def of UPGRADES) expect(upgradeUnlocked(big, def)).toBe(true);

    const curb = stateAt('curbstone');
    expect(upgradeUnlocked(curb, UPGRADES.find((u) => u.id === 'collections')!)).toBe(false);
    expect(purchaseUpgrade(curb, 'collections')).toBe(curb);
  });

  it('adds the store’s base capacity to whatever property you own', () => {
    const s = stateAt('largeUsed', { upgrades: { lot: 2 } });
    expect(carCapacity(s)).toBe(
      getStage('largeUsed').baseCarCapacity + 2 * getStage('largeUsed').capacityPerLevel,
    );
    // Property carries, so the same rows keep paying at the next store up.
    expect(carCapacity(stateAt('premiumFranchise', { upgrades: { lot: 2 } }))).toBeGreaterThan(
      carCapacity(s),
    );
  });
});

// -------------------------------------------------- the book across a move

describe('the collections desk across a move', () => {
  /**
   * The sharpest edge in the whole progression: the desk is staff, the book is
   * not, so a full book lands at the new store with capacity for eight. Uncapped
   * that was a 4.6x miss multiplier and the entire portfolio died inside a game
   * month, which turns a strategic decision into a trap.
   */
  it('caps how badly a buried desk can punish the book', () => {
    expect(overCapacityFactor(43, 8)).toBe(BALANCE.overCapacityMissPenaltyCap);
    expect(overCapacityFactor(400, 8)).toBe(BALANCE.overCapacityMissPenaltyCap);
    // Still graduated below the cap, so mild overage is still mild.
    expect(overCapacityFactor(10, 8)).toBeGreaterThan(1);
    expect(overCapacityFactor(10, 8)).toBeLessThan(BALANCE.overCapacityMissPenaltyCap);
    expect(overCapacityFactor(8, 8)).toBe(1);
  });
});

// ------------------------------------------------ what a car costs here

/**
 * `typicalCarPrice` is the unit three separate spending gates are denominated
 * in: the automation reserve, the reopening float on a stage move, and the size
 * of the shark's offer. If it is wrong, all three are wrong at once and none of
 * them look wrong — they just quietly refuse to let the player do things.
 *
 * It WAS wrong, by 3.6x at curbstone, for two compounding reasons: it priced a
 * model's clean `baseValue` rather than the 200,000-mile example that actually
 * turns up, and it took `values[n / 2]` on an even-length bimodal list, which
 * returned the cheapest commuter and pretended the beater half of the feed did
 * not exist. The result was a $23,820 reserve on a business that starts with
 * $3,000: a retainer buyer that could never buy anything at any price.
 *
 * Every test that existed passed throughout, because they all computed their
 * expectations by calling `typicalCarPrice` — so they agreed with it by
 * construction whatever it said. This one does not: it generates listings
 * through the real engine and checks the claim against what the feed is
 * actually asking.
 */
describe('typicalCarPrice', () => {
  /** Median ask across listings the engine really spawns at this stage. */
  function realMedianAsk(stage: StageId): number {
    const prices: number[] = [];
    for (let seed = 0; seed < 3; seed++) {
      let s: GameState = { ...createInitialState(700 + seed, 0), stage, listings: [] };
      const seen = new Set<string>();
      for (let i = 0; i < 60; i++) {
        s = advance(s, 30_000);
        for (const l of s.listings) {
          if (seen.has(l.id)) continue;
          seen.add(l.id);
          prices.push(l.price);
        }
      }
    }
    prices.sort((a, b) => a - b);
    return prices[Math.floor(prices.length / 2)];
  }

  it('agrees with what the feed actually asks, at every stage', () => {
    for (const stage of STAGES) {
      const real = realMedianAsk(stage.id);
      const claim = typicalCarPrice(stage);
      expect(real).toBeGreaterThan(0);
      // Generous either way — this is an estimate used to size a float, not a
      // valuation. It is still nowhere near wide enough to admit the 3.6x the
      // old formula was out by at curbstone.
      expect(claim).toBeGreaterThan(real * 0.6);
      expect(claim).toBeLessThan(real * 1.5);
    }
  });

  /**
   * The used stages are where this broke and the franchise stages are why
   * nobody noticed: a delivered car really is worth close to its clean base
   * value, so the old formula was right at the top of the ladder and wrong at
   * the bottom, which is the worst possible place for a bug to hide.
   */
  it('prices a worn-out beater well under the model it came from', () => {
    const curbstone = getStage('curbstone');
    const cheapest = Math.min(...modelsForTiers(curbstone.sourcing.tiers ?? []).map((m) => m.baseValue));
    expect(typicalCarPrice(curbstone)).toBeLessThan(cheapest);
  });

  it('takes the middle of an even, bimodal model list rather than the upper half', () => {
    // Curbstone sources three beaters and three commuters and nothing between
    // them, so an off-by-one in the median lands entirely inside one cluster.
    const curbstone = getStage('curbstone');
    const models = modelsForTiers(curbstone.sourcing.tiers ?? []);
    expect(models.length % 2).toBe(0);

    const beaters = models.filter((m) => m.tier === 'beater').length;
    expect(beaters).toBeGreaterThan(0);
    expect(beaters).toBeLessThan(models.length);
  });
});

// ------------------------------------------------- how long a car sits

/**
 * Walk-up traffic per listed car, and the dwell time it buys.
 *
 * DWELL IS THE CHARACTER OF A STORE. Traffic used to be a flat per-car rate, so
 * a forty-car franchise ran forty arrival processes side by side and turned its
 * whole stock over in three and a half game days — one car in seven gone inside
 * a single day, which is a vending machine rather than a dealership.
 *
 * The property that matters is that the number arrives in `stepProspects`.
 * Asserting on the table alone would pass just as happily if the engine never
 * read it, which is the same trap `promotions.test.ts` documents.
 */
describe('how busy a store is', () => {
  /** A lot of identical cars, all listed at retail, at `stage`. */
  function stockedLot(seed: number, stage: StageId, cars: number): GameState {
    const s = cloneState(createInitialState(seed, 0));
    s.stage = stage;
    s.cash = 10_000_000;
    s.listings = [];
    // No grand opening: it doubles traffic and would swamp the comparison.
    s.promotions = [];
    for (let i = 0; i < cars; i++) {
      const car = { ...createInitialState(seed + i * 31 + 1, 0).listings[0].car };
      car.id = `car_${i}`;
      car.status = 'listed';
      car.askPrice = retailValue(car);
      s.cars.push(car);
    }
    return s;
  }

  /** Every distinct buyer who turned up over `ms`, counted by id. */
  function arrivals(start: GameState, ms: number): number {
    let s = start;
    const seen = new Set<string>();
    for (let elapsed = 0; elapsed < ms; elapsed += 5_000) {
      s = advance(s, 5_000);
      for (const p of s.prospects) seen.add(p.id);
    }
    return seen.size;
  }

  it('falls as you move upmarket, so bigger stores hold stock longer', () => {
    const rates = STAGES.map((def) => def.trafficPerCar);
    expect(rates[0]).toBe(1);
    for (let i = 1; i < rates.length; i++) {
      expect(rates[i]).toBeGreaterThan(0);
      expect(rates[i]).toBeLessThanOrEqual(rates[i - 1]);
    }
  });

  /**
   * Summed across seeds because one run's walk-ups are a Poisson draw. Compared
   * at the same stage with the table overridden, so the ONLY difference between
   * the two runs is this number — a comparison across two real stages would move
   * the cars, the ask band and the credit mix at the same time.
   */
  it('is what the engine actually counts walk-ups against', () => {
    const busy = getStage('smallUsed').trafficPerCar;
    let quiet = 0;
    let loud = 0;
    try {
      for (let seed = 0; seed < 6; seed++) {
        applyTuning({ 'stages.smallUsed.trafficPerCar': 1 });
        loud += arrivals(stockedLot(700 + seed, 'smallUsed', 5), 10 * 60 * 1000);
        applyTuning({ 'stages.smallUsed.trafficPerCar': 0.25 });
        quiet += arrivals(stockedLot(700 + seed, 'smallUsed', 5), 10 * 60 * 1000);
      }
    } finally {
      applyTuning({ 'stages.smallUsed.trafficPerCar': busy });
    }

    expect(quiet).toBeGreaterThan(0);
    expect(loud).toBeGreaterThan(quiet);
    // A quarter of the rate, throttled a little by one shopper at a time per car.
    expect(loud / quiet).toBeGreaterThan(1.8);
  });

  /**
   * The same rule a promotion follows from the other direction: this multiplies
   * a rate and does not overrule the pricing model. A busy store cannot sell a
   * car priced out of the market, because the rate is already zero up there.
   */
  it('cannot bring anybody to a car priced out of the market', () => {
    const s = stockedLot(88, 'curbstone', 5);
    for (const car of s.cars) car.askPrice = retailValue(car) * 100;
    expect(arrivals(s, 15 * 60 * 1000)).toBe(0);
  });
});
