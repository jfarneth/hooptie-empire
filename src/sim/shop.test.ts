import {
  dismissServiceTech,
  hireServiceTech,
  moveToStage,
  promoteServiceTech,
  setBusinessPolicy,
  stageMovePreview,
} from './actions';
import { BALANCE, MS_PER_GAME_WEEK } from './balance';
import { advance, cloneState, createInitialState, weeklyExpenses } from './engine';
import { blankSkills, reconModsFor } from './skills';
import {
  TECH_GRADES,
  TOP_GRADE,
  bayCount,
  canHireTech,
  canPromote,
  closeTheShop,
  hireCost,
  hireTech,
  hoursToPromote,
  jobDurationMs,
  referenceRate,
  shopDemandPerSec,
  shopPayroll,
  shopRate,
  shopUtilisation,
  techWage,
} from './shop';
import { STAGES, getStage } from './stages';
import type { GameState } from './types';

/**
 * The service department.
 *
 * Two things in here are worth more than the rest put together: the measured
 * rework rates (a table nobody can read off the code, and the whole argument for
 * certifying anybody) and the fact that a busy shop turns customers away instead
 * of silently growing an unbounded queue. Both are properties of a run rather
 * than of a line, so both are measured over one.
 */

/** A franchise with bays, techs, and nothing else running. */
function shopAt(
  stage: GameState['stage'],
  bays: number,
  grades: number[] = [],
  seed = 5,
): GameState {
  const s = createInitialState(seed, 0);
  s.stage = stage;
  s.cash = 5_000_000;
  s.upgrades = { serviceBays: bays };
  // No feed, no cars, no buyers: this fixture is about the bays and nothing
  // else, and a lot full of trading would make every count in here noise.
  s.listings = [];
  for (const grade of grades) hireTech(s, grade);
  return s;
}

describe('bays', () => {
  it('exist at the franchises and nowhere else', () => {
    const withShops = STAGES.filter((s) => s.shop).map((s) => s.id);
    expect(withShops).toEqual(['lowCostFranchise', 'midsizeFranchise', 'premiumFranchise']);
  });

  it('are zero until the first one is bought', () => {
    expect(bayCount({ stage: 'lowCostFranchise', upgrades: {} })).toBe(0);
    expect(bayCount({ stage: 'lowCostFranchise', upgrades: { serviceBays: 3 } })).toBe(3);
    // Not even a hand-edited save can open a shop at a used lot.
    expect(bayCount({ stage: 'largeUsed', upgrades: { serviceBays: 3 } })).toBe(0);
  });

  it('cap the roster: a bench each', () => {
    const s = shopAt('lowCostFranchise', 2);
    expect(canHireTech(s)).toBe(true);
    hireTech(s, 0);
    hireTech(s, 0);
    expect(canHireTech(s)).toBe(false);

    const after = hireServiceTech(s, 0);
    expect(after.shop.techs).toHaveLength(2);
    // Refused, so state identity is unchanged — the store must not re-render.
    expect(after).toBe(s);
  });
});

describe('the labour rate', () => {
  it('reads off the store, and the middle stop is the going rate', () => {
    for (const stage of STAGES.filter((s) => s.shop)) {
      const ladder = stage.shop!.hourlyRates;
      expect(ladder).toHaveLength(5);
      // Ascending, or the slider means nothing.
      for (let i = 1; i < ladder.length; i++) expect(ladder[i]).toBeGreaterThan(ladder[i - 1]);
      expect(referenceRate(stage)).toBe(ladder[2]);
      expect(shopRate(stage, 1)).toBe(ladder[0]);
      expect(shopRate(stage, 5)).toBe(ladder[4]);
      // A level from a build with more stops reads as the top one rather than
      // as undefined — same tolerance the sales floors show.
      expect(shopRate(stage, 99)).toBe(ladder[4]);
    }
  });

  it('climbs with the ladder, because a Valmont hour is not a Halvorsen hour', () => {
    const rates = STAGES.filter((s) => s.shop).map((s) => referenceRate(s));
    for (let i = 1; i < rates.length; i++) expect(rates[i]).toBeGreaterThan(rates[i - 1]);
  });

  it('trades demand against price', () => {
    const s = shopAt('lowCostFranchise', 3);
    const stage = getStage('lowCostFranchise');
    const cheap = shopDemandPerSec(s, shopRate(stage, 1));
    const going = shopDemandPerSec(s, shopRate(stage, 3));
    const dear = shopDemandPerSec(s, shopRate(stage, 5));

    expect(cheap).toBeGreaterThan(going);
    expect(going).toBeGreaterThan(dear);
    // At the going rate the store's own figure is what walks in, undistorted.
    expect(going).toBeCloseTo(stage.shop!.demandPerSec, 6);
  });

  it('has no demand at all without a bay to put a car in', () => {
    const closed = shopAt('lowCostFranchise', 0);
    expect(shopDemandPerSec(closed, 72)).toBe(0);
  });
});

describe('wages', () => {
  it('derive from the store the shop is standing in', () => {
    for (const stage of STAGES.filter((s) => s.shop)) {
      const entry = techWage(stage, 0);
      // A share of what a tech bills in a week at the going rate. Derived, so a
      // store that charges more pays more without a second table to maintain.
      expect(entry).toBeCloseTo(
        referenceRate(stage) * BALANCE.shop.wageHoursPerWeek * BALANCE.shop.wageShareOfBillings,
        0,
      );
      // Every grade above costs more than the one below.
      for (let g = 1; g <= TOP_GRADE; g++) {
        expect(techWage(stage, g)).toBeGreaterThan(techWage(stage, g - 1));
      }
    }
  });

  it('land on the weekly bill, itemised apart from the sales payroll', () => {
    const s = shopAt('midsizeFranchise', 3, [0, 2, 4]);
    const stage = getStage('midsizeFranchise');
    const expected = techWage(stage, 0) + techWage(stage, 2) + techWage(stage, 4);

    expect(shopPayroll(s)).toBe(expected);
    const bill = weeklyExpenses(s);
    expect(bill.shopPayroll).toBe(expected);
    // In the total, so the working-capital floor and the harness both see it.
    expect(bill.total).toBe(
      bill.rent + bill.payroll + bill.floorplan + bill.shopPayroll + bill.debtService,
    );
  });

  it('are actually charged, and hurt a shop with no work', () => {
    // Four techs and literally no customers — demand zeroed through the same
    // knob the A/B uses, because "the top rate starves the bays" stopped being
    // true the day Valmont's repair orders got big enough to out-bill the
    // payroll at any rate. Payroll should simply drain the till.
    const shopKnobs = BALANCE.shop as { demandScale: number };
    const prev = shopKnobs.demandScale;
    shopKnobs.demandScale = 0;
    try {
      let s = shopAt('premiumFranchise', 4, [4, 4, 4, 4]);
      s.cash = 200_000;
      s.nextBillAt = MS_PER_GAME_WEEK;
      const before = s.cash;

      s = advance(s, MS_PER_GAME_WEEK + 1_000);
      expect(s.cash).toBeLessThan(before);
    } finally {
      shopKnobs.demandScale = prev;
    }
  });
});

describe('the bench', () => {
  it('books cars in, works them, and bills the hours', () => {
    let s = shopAt('lowCostFranchise', 3, [0, 0, 0], 12);
    s = advance(s, 10 * 60 * 1000);

    expect(s.stats.shopJobsDone).toBeGreaterThan(0);
    expect(s.stats.shopRevenue).toBeGreaterThan(0);
    // Every dollar billed is a dollar in the till: a shop that logged revenue
    // without paying it would be the sneakiest possible economy bug.
    expect(s.cash).toBeGreaterThan(5_000_000 - shopPayroll(s) * 5);

    // The average invoice is the hours times the rate, so it has to sit inside
    // the possible range for one job.
    const rate = shopRate(getStage('lowCostFranchise'), 3);
    const perJob = s.stats.shopRevenue / s.stats.shopJobsDone;
    expect(perJob).toBeGreaterThan(BALANCE.shop.jobHoursMin * rate * 0.9);
    expect(perJob).toBeLessThan((BALANCE.shop.jobHoursMin + BALANCE.shop.jobHoursSpan) * rate);
  });

  it('does nothing at all without a technician in it', () => {
    let s = shopAt('lowCostFranchise', 4);
    s = advance(s, 10 * 60 * 1000);
    expect(s.stats.shopJobsDone).toBe(0);
    expect(s.stats.shopRevenue).toBe(0);
    // Cars still walk in and find nobody, which is the signal to hire.
    expect(s.stats.shopTurnedAway).toBeGreaterThan(0);
  });

  it('turns customers away rather than growing a queue forever', () => {
    let s = shopAt('premiumFranchise', 1, [0], 3);
    // Cheapest rate, one bench: demand well past capacity by construction.
    s = setBusinessPolicy(s, { shopRateLevel: 1 });
    s = advance(s, 20 * 60 * 1000);

    const queued = s.shop.jobs.filter((j) => j.techId === null).length;
    expect(queued).toBeLessThanOrEqual(bayCount(s) * BALANCE.shop.queuePerBay);
    expect(s.stats.shopTurnedAway).toBeGreaterThan(0);
  });

  it('keeps a busy shop busy', () => {
    let s = shopAt('premiumFranchise', 2, [0, 0], 8);
    s = setBusinessPolicy(s, { shopRateLevel: 1 });
    s = advance(s, 10 * 60 * 1000);
    expect(shopUtilisation(s)).toBeGreaterThan(0);
  });

  it('finishes a job faster in better hands', () => {
    const entry = jobDurationMs(3, TECH_GRADES[0].speed);
    const certified = jobDurationMs(3, TECH_GRADES[TOP_GRADE].speed);
    expect(certified).toBeLessThan(entry);
    // Roughly twice the throughput at the top of the ladder, which is what makes
    // certification worth a bench when bays are the scarce thing.
    expect(entry / certified).toBeGreaterThan(1.9);
  });
});

describe('comebacks', () => {
  /**
   * The measured rework rate, by grade.
   *
   * The headline claim of the whole tech ladder — 15% at entry down to 2% at
   * Certified III — and the only way to check it is to run a shop for a long
   * time and count. A tolerance of a few points either way is the sampling
   * error at this many jobs; the ordering is the part that must never break.
   */
  function reworkRate(grade: number, seed: number): { rate: number; jobs: number } {
    let s = shopAt('premiumFranchise', 3, [grade, grade, grade], seed);
    s = setBusinessPolicy(s, { shopRateLevel: 1 });
    s = advance(s, 60 * 60 * 1000);
    return { rate: s.stats.shopReworks / Math.max(1, s.stats.shopJobsDone), jobs: s.stats.shopJobsDone };
  }

  it('happen at roughly the rate the grade table claims', () => {
    for (const grade of [0, TOP_GRADE]) {
      const { rate, jobs } = reworkRate(grade, 100 + grade);
      expect(jobs).toBeGreaterThan(200);
      expect(rate).toBeGreaterThan(TECH_GRADES[grade].rework - 0.05);
      expect(rate).toBeLessThan(TECH_GRADES[grade].rework + 0.05);
    }
  });

  it('are rarer in better hands, all the way up the ladder', () => {
    for (let g = 1; g <= TOP_GRADE; g++) {
      expect(TECH_GRADES[g].rework).toBeLessThan(TECH_GRADES[g - 1].rework);
      expect(TECH_GRADES[g].speed).toBeLessThan(TECH_GRADES[g - 1].speed);
      expect(TECH_GRADES[g].wage).toBeGreaterThan(TECH_GRADES[g - 1].wage);
    }
  });

  it('bill nothing and hold the bench', () => {
    // An entry shop and a certified shop, same seed, same rate. The certified
    // one bills more per bench-second, which is the entire argument.
    const entry = reworkRate(0, 77);
    const certified = reworkRate(TOP_GRADE, 77);
    expect(certified.jobs).toBeGreaterThan(entry.jobs);
    expect(certified.rate).toBeLessThan(entry.rate);
  });
});

/**
 * THE DESIGN TARGET THE TOP STORE'S JOB SCALE WAS SIZED FROM, measured through
 * the real engine rather than asserted off the closed form: a Valmont shop with
 * every bay staffed at max cert has to make money, comfortably, at the going
 * rate. This is the owner's requirement stated as a test, and it is the guard
 * that goes red if the arrival ceiling, the wage derivation, the grade table or
 * the job scale ever drift back into the configuration that ran the shipped
 * build's service bay at −24.5%.
 *
 * The other half is just as load-bearing: the SAME roster at an Okabe store
 * must lose money. That flip — entry hands mid-ladder, certified hands at the
 * top — is what makes the roster a decision that changes over the life of a
 * store instead of a spreadsheet with one right answer.
 */
describe('a full bench of certified hands', () => {
  function certShopWeeks(stage: GameState['stage'], weeks: number): { billed: number; wages: number } {
    let s = shopAt(stage, 6, [4, 4, 4, 4, 4, 4], 21);
    s.cash = 10_000_000;
    const wages = shopPayroll(s) * weeks;
    const before = s.stats.shopRevenue;
    s = advance(s, weeks * MS_PER_GAME_WEEK);
    return { billed: s.stats.shopRevenue - before, wages };
  }

  it('pays for itself at the top store, with room to spare', () => {
    const { billed, wages } = certShopWeeks('premiumFranchise', 6);
    expect(billed).toBeGreaterThan(wages * 1.25);
  });

  it('is the wrong roster one rung down, which is the flip the ladder wants', () => {
    const { billed, wages } = certShopWeeks('midsizeFranchise', 6);
    expect(billed).toBeLessThan(wages);
  });
});

describe('promotion', () => {
  it('is earned in hours, not bought', () => {
    const s = shopAt('lowCostFranchise', 2, [0]);
    const tech = s.shop.techs[0];
    expect(canPromote(tech)).toBe(false);

    tech.xp = hoursToPromote(tech);
    expect(canPromote(tech)).toBe(true);

    const after = promoteServiceTech(s, tech.id);
    expect(after.shop.techs[0].grade).toBe(1);
    // Free — the cost of a promotion is the wage from here on, not a fee.
    expect(after.cash).toBe(s.cash);
    expect(techWage(getStage('lowCostFranchise'), 1)).toBeGreaterThan(
      techWage(getStage('lowCostFranchise'), 0),
    );
  });

  it('refuses a tech who has not earned it', () => {
    const s = shopAt('lowCostFranchise', 2, [0]);
    const after = promoteServiceTech(s, s.shop.techs[0].id);
    expect(after).toBe(s);
  });

  it('stops at the top of the ladder', () => {
    const s = shopAt('lowCostFranchise', 2, [TOP_GRADE]);
    s.shop.techs[0].xp = 1_000_000;
    expect(canPromote(s.shop.techs[0])).toBe(false);
  });

  it('credits somebody hired in at grade with the hours that grade implies', () => {
    // Without it, a bought-in Certified III would need a whole career before the
    // promote button meant anything, which reads as a bug rather than a rule.
    const s = shopAt('lowCostFranchise', 3);
    const tech = hireTech(s, 3);
    expect(tech.xp).toBe(BALANCE.shop.promoteAtHours[3]);
    expect(canPromote(tech)).toBe(false);
  });

  it('earns hours by turning work', () => {
    let s = shopAt('premiumFranchise', 1, [0], 31);
    s = setBusinessPolicy(s, { shopRateLevel: 1 });
    s = advance(s, 15 * 60 * 1000);
    expect(s.shop.techs[0].xp).toBeGreaterThan(0);
  });
});

describe('hiring and letting go', () => {
  it('charges a signing fee that scales with the grade and the store', () => {
    const halvorsen = getStage('lowCostFranchise');
    const valmont = getStage('premiumFranchise');
    expect(hireCost(valmont, 0)).toBeGreaterThan(hireCost(halvorsen, 0));
    expect(hireCost(halvorsen, TOP_GRADE)).toBeGreaterThan(hireCost(halvorsen, 0));

    const s = shopAt('lowCostFranchise', 2);
    s.cash = hireCost(halvorsen, 0);
    const after = hireServiceTech(s, 0);
    expect(after.shop.techs).toHaveLength(1);
    expect(after.cash).toBe(0);
  });

  it('refuses a hire the till cannot cover', () => {
    const s = shopAt('lowCostFranchise', 2);
    s.cash = 1;
    expect(hireServiceTech(s, 0)).toBe(s);
  });

  it('puts the car back in the queue when the tech goes', () => {
    let s = shopAt('premiumFranchise', 2, [0, 0], 44);
    s = setBusinessPolicy(s, { shopRateLevel: 1 });
    s = advance(s, 5 * 60 * 1000);

    const busy = s.shop.techs.find((t) => t.jobId !== null);
    expect(busy).toBeDefined();
    const jobId = busy!.jobId;

    const after = dismissServiceTech(s, busy!.id);
    expect(after.shop.techs).toHaveLength(1);
    // The customer is still waiting for their car. Losing the repair order with
    // the technician would be a way to make work disappear.
    const job = after.shop.jobs.find((j) => j.id === jobId);
    expect(job).toBeDefined();
    expect(job!.techId).toBeNull();
  });
});

describe('moving store', () => {
  it('empties the bays and keeps the paper', () => {
    let s = shopAt('lowCostFranchise', 3, [0, 2, 4]);
    s.cash = 500_000_000;
    s.serviceContracts = [
      {
        id: 'plan_1',
        carId: 'car_x',
        carLabel: 'test',
        customerName: 'Somebody',
        price: 1_000,
        expectedPayout: 650,
        paidOut: 0,
        claims: 0,
        weeksTotal: 24,
        weeksRemaining: 24,
        nextCheckAt: 10 * MS_PER_GAME_WEEK,
        status: 'active',
        openedAt: 0,
      },
    ];

    const after = moveToStage(s, 'midsizeFranchise');
    expect(after.stage).toBe('midsizeFranchise');
    // Technicians are staff: at a new store they would have to be hired again.
    expect(after.shop.techs).toHaveLength(0);
    expect(after.shop.jobs).toHaveLength(0);
    expect(after.upgrades.serviceBays ?? 0).toBe(0);
    // THE PLANS COME WITH YOU. Cover is paper, and paper moves with the business
    // exactly like the loan book does — you still owe those customers the work.
    expect(after.serviceContracts).toHaveLength(1);
    expect(after.serviceContracts[0].status).toBe('active');
  });

  it('says how many technicians a move would cost, before the button', () => {
    const s = shopAt('lowCostFranchise', 3, [0, 1, 2]);
    s.cash = 500_000_000;
    expect(stageMovePreview(s, 'midsizeFranchise').techsReleased).toBe(3);
  });

  it('closes the shop as a unit', () => {
    const s = shopAt('lowCostFranchise', 3, [0, 1]);
    expect(closeTheShop(s)).toBe(2);
    expect(s.shop).toEqual({ techs: [], jobs: [], weekRevenue: 0, weekJobs: 0 });
  });
});

describe('the shop works on your own stock too', () => {
  it('makes recon faster and cheaper, per bay', () => {
    const none = reconModsFor({ stage: 'lowCostFranchise', upgrades: {}, skills: blankSkills() });
    const some = reconModsFor({
      stage: 'lowCostFranchise',
      upgrades: { serviceBays: 3 },
      skills: blankSkills(),
    });

    expect(some.speedMult).toBeLessThan(none.speedMult);
    expect(some.costMult).toBeLessThan(none.costMult);
    // Compounding per bay, so the sixth bench is still worth something.
    const more = reconModsFor({
      stage: 'lowCostFranchise',
      upgrades: { serviceBays: 6 },
      skills: blankSkills(),
    });
    expect(more.speedMult).toBeLessThan(some.speedMult);
  });

  it('does nothing at a store with no bays to buy', () => {
    const used = reconModsFor({ stage: 'largeUsed', upgrades: { serviceBays: 6 }, skills: blankSkills() });
    const bare = reconModsFor({ stage: 'largeUsed', upgrades: {}, skills: blankSkills() });
    expect(used.speedMult).toBe(bare.speedMult);
  });
});

describe('the shop on the state', () => {
  it('survives a clone without leaking backwards', () => {
    const s = shopAt('lowCostFranchise', 2, [0, 1]);
    s.shop.jobs.push({
      id: 'job_1',
      label: 'test',
      hours: 2,
      price: 100,
      arrivedAt: 0,
      remainingMs: 500,
      totalMs: 1_000,
      techId: null,
      rework: false,
    });

    const copy = cloneState(s);
    copy.shop.techs[0].grade = 4;
    copy.shop.techs[0].xp = 9_999;
    copy.shop.jobs[0].remainingMs = 0;
    copy.shop.weekRevenue = 12_345;

    expect(s.shop.techs[0].grade).toBe(0);
    expect(s.shop.techs[0].xp).toBe(0);
    expect(s.shop.jobs[0].remainingMs).toBe(500);
    expect(s.shop.weekRevenue).toBe(0);
  });

  it('writes one weekly ledger line rather than one per car', () => {
    let s = shopAt('premiumFranchise', 3, [1, 1, 1], 61);
    s.nextBillAt = MS_PER_GAME_WEEK;
    s = setBusinessPolicy(s, { shopRateLevel: 1 });
    s = advance(s, MS_PER_GAME_WEEK + 5_000);

    const shopLines = s.events.filter((e) => e.kind === 'shop');
    expect(shopLines).toHaveLength(1);
    expect(shopLines[0].amount).toBeGreaterThan(0);
    // ...and dozens of jobs behind it. A line each would leave the sixty-entry
    // ledger showing nothing but oil changes for the rest of the run.
    expect(s.stats.shopJobsDone).toBeGreaterThan(shopLines.length * 5);
    // The week resets, so the next line is the next week's takings.
    expect(s.shop.weekJobs).toBeLessThan(s.stats.shopJobsDone);
  });
});
