import { advanceStage, purchaseUpgrade, setDealPolicy, stageMovePreview } from './actions';
import { appraisalBand } from './appraisal';
import { BALANCE } from './balance';
import { advance, cloneState, createInitialState } from './engine';
import { getModel, modelsForMake, modelsForTiers } from './models';
import { overCapacityFactor } from './notes';
import { appraisalSigma } from './skills';
import { STAGES, STAGE_ORDER, getStage, hasReached, isFranchise, nextStage, stageRank } from './stages';
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
      expect(STAGES[i].staffCostMultiplier).toBeGreaterThanOrEqual(STAGES[i - 1].staffCostMultiplier);
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
    s.cash = 400_000;
    s.upgrades = {
      driveway: 3, scout: 2, advertising: 2, autoList: 1, autoRecon: 1, lot: 2,
      mechanic: 3, salesDesk: 1, autoBuy: 1, collections: 2, underwriting: 1, repoMan: 1,
    };
    s.dealPolicy = 'auto';
    s.skills.buy.level = 7;
    s.skills.sell.level = 5;
    return s;
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
    expect(stageMovePreview(s).next).toBeNull();
  });

  it('takes the whole payroll and nothing else', () => {
    const before = goingConcern();
    const after = advanceStage(before);

    for (const def of UPGRADES) {
      if (def.staff) expect(level(after, def.id)).toBe(0);
      else expect(level(after, def.id)).toBe(level(before, def.id));
    }
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
        originalPrincipal: 5_000, principal: 5_000, apr: 0.239, paymentAmount: 260,
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
  it('clears the old store’s feed but keeps the cars already bought', () => {
    const before = goingConcern();
    before.cars = advance(before, 60_000).cars;
    expect(before.listings.length).toBeGreaterThan(0);

    const after = advanceStage(before);
    expect(after.listings).toEqual([]);
    expect(after.cars).toEqual(before.cars);

    // And it refills from the store you actually moved into.
    const refilled = advance(after, 10 * 60 * 1000);
    expect(refilled.listings.length).toBeGreaterThan(0);
  });

  it('warns about exactly what the move will do', () => {
    const before = goingConcern();
    const preview = stageMovePreview(before);
    const after = advanceStage(before);

    expect(preview.next?.id).toBe(after.stage);
    expect(preview.cost).toBe(before.cash - after.cash);
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

// --------------------------------------------------- what the new store costs

describe('staffing a bigger store', () => {
  it('charges more for the same hire the further up you are', () => {
    const mechanic = UPGRADES.find((u) => u.id === 'mechanic')!;
    const costs = STAGES.map((def) => upgradeCost(mechanic, 0, def.id));
    for (let i = 1; i < costs.length; i++) expect(costs[i]).toBeGreaterThanOrEqual(costs[i - 1]);
    expect(costs[costs.length - 1]).toBeGreaterThan(costs[0] * 5);
  });

  it('leaves property priced the same wherever you are', () => {
    const lot = UPGRADES.find((u) => u.id === 'lot')!;
    const costs = STAGES.map((def) => upgradeCost(lot, 0, def.id));
    expect(new Set(costs).size).toBe(1);
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
      getStage('largeUsed').baseCarCapacity + 2 * BALANCE.capacityPerLotLevel,
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
