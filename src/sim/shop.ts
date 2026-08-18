import { BALANCE, MS_PER_GAME_WEEK, TICK_MS } from './balance';
import { arrivalChance } from './economy';
import { mintId } from './ids';
import { customerName, modelsForMake, modelsForTiers } from './models';
import { chance, intRange, pick, range } from './rng';
import { SHOP_RATE_LEVELS, getStage, type StageDef } from './stages';
import type { GameState, RngState, ServiceJob, ServiceTech } from './types';

/**
 * The service department.
 *
 * The first part of this business that earns money without selling anything —
 * cars come in, hours are billed, and the only inventory is somebody's time.
 * That makes it structurally different from every other system here and is why
 * it is worth having: the lot is capacity-bound on stalls and cash, and the shop
 * is capacity-bound on BENCHES, which is a constraint the player has never had
 * to think about before.
 *
 * Four rules carry it:
 *
 *  - **Demand belongs to the store, capacity belongs to you.** Buying a bay does
 *    not create customers; it lets you serve the ones already being turned away.
 *    If demand scaled with bays, paving would print money — the same mistake the
 *    lot's traffic model exists to avoid.
 *  - **The rate is the dial and capacity is what makes it a decision.** Underprice
 *    a small shop and the queue overflows at a low rate. Overprice a big one and
 *    six techs sit on full wages. The right rate therefore moves every time you
 *    hire, which is what stops it being a set-once slider.
 *  - **A cheap technician is not cheap.** Grade buys speed and buys FEWER
 *    COMEBACKS, and a comeback occupies a bench and bills nothing. On a shop
 *    where benches are the scarce thing, that is the whole argument for
 *    certification.
 *  - **Nobody is hired twice at the same store.** Techs are staff. A move
 *    releases them along with the rest of the payroll, and their experience goes
 *    with them, because at a new store they would have to be hired again.
 */

export interface TechGrade {
  name: string;
  /** Short form for the roster row, which has very little width. */
  shortName: string;
  /** Multiplier on how long a job takes. Lower is faster. */
  speed: number;
  /** Odds a finished job comes back. */
  rework: number;
  /** Multiplier on the weekly wage. */
  wage: number;
}

/**
 * The ladder, entry to certified.
 *
 * Speed climbs faster than wage on purpose. Flat per-dollar the two grades would
 * be interchangeable and the roster would be a spreadsheet with one right answer;
 * as set, an entry tech is the better buy per DOLLAR of payroll and a certified
 * one is the better buy per BENCH — so which you want depends on whether you are
 * short of money or short of bays, and that flips over the course of a store.
 *
 * Rework runs 15% down to 2%, which is what was asked for and is also roughly
 * the real spread between an apprentice and a master tech.
 */
export const TECH_GRADES: readonly TechGrade[] = [
  { name: 'Entry level', shortName: 'Entry', speed: 1, rework: 0.15, wage: 1 },
  { name: 'Mid level', shortName: 'Mid', speed: 0.82, rework: 0.1, wage: 1.3 },
  { name: 'Certified I', shortName: 'Cert I', speed: 0.68, rework: 0.06, wage: 1.65 },
  { name: 'Certified II', shortName: 'Cert II', speed: 0.57, rework: 0.035, wage: 2.05 },
  { name: 'Certified III', shortName: 'Cert III', speed: 0.48, rework: 0.02, wage: 2.5 },
];

export const TOP_GRADE = TECH_GRADES.length - 1;

export function techGrade(tech: ServiceTech): TechGrade {
  return TECH_GRADES[Math.min(Math.max(0, Math.round(tech.grade)), TOP_GRADE)];
}

/** What kind of work is on the ramp. Cosmetic, but the queue is unreadable without it. */
const JOB_KINDS: readonly string[] = [
  'service',
  'brakes',
  'diagnostics',
  'timing belt',
  'clutch',
  'suspension',
  'aircon',
  'gearbox',
  'electrical',
  'bodywork',
  'exhaust',
  'warranty work',
];

// ------------------------------------------------------------------ capacity

/**
 * Benches. Zero until the first one is bought, and that purchase IS opening the
 * department — there is no free bay, so `hasServiceDept` is a single question
 * with a single answer.
 */
export function bayCount(state: Pick<GameState, 'stage' | 'upgrades'>): number {
  if (!getStage(state.stage).shop) return 0;
  return state.upgrades['serviceBays'] ?? 0;
}

/** A bench each. You cannot hire the seventh tech into a six-bay shop. */
export function canHireTech(state: GameState): boolean {
  return state.shop.techs.length < bayCount(state);
}

// --------------------------------------------------------------------- rates

/** The store's labour rate stops, or an empty ladder where there is no shop. */
export function shopRateLadder(stage: StageDef): readonly number[] {
  return stage.shop?.hourlyRates ?? [];
}

/**
 * The rate the shop is charging, in dollars an hour.
 *
 * A level past the end of the ladder — a save from a build with more stops, or a
 * hand-edited one — reads as the top stop rather than as undefined, which is the
 * same tolerance `dealMarginFloor` shows.
 */
export function shopRate(stage: StageDef, level: number): number {
  const ladder = shopRateLadder(stage);
  if (ladder.length === 0) return 0;
  const index = Math.min(Math.max(1, Math.round(level)), ladder.length) - 1;
  return ladder[index];
}

/**
 * The middle stop: the going rate this store's demand is quoted at.
 *
 * Everything about the shop's demand is a departure from this number, so it has
 * to come from the ladder rather than from a second constant that could disagree
 * with it.
 */
export function referenceRate(stage: StageDef): number {
  const ladder = shopRateLadder(stage);
  if (ladder.length === 0) return 0;
  return ladder[Math.floor((ladder.length - 1) / 2)];
}

/**
 * Repair orders per second walking in at the current rate.
 *
 * Zero without bays: a shop that cannot take a car is not turning one away, it
 * simply is not a shop, and counting phantom lost customers before the first
 * bench is bought would make the panel's one honest number a lie.
 */
export function shopDemandPerSec(state: Pick<GameState, 'stage' | 'upgrades'>, rate: number): number {
  const stage = getStage(state.stage);
  const shop = stage.shop;
  if (!shop || bayCount(state) === 0) return 0;

  const reference = referenceRate(stage);
  if (reference <= 0 || rate <= 0) return 0;

  const scale = BALANCE.shop.demandScale;
  if (scale <= 0) return 0;

  const response = Math.exp(-BALANCE.shop.rateElasticity * (rate / reference - 1));
  return shop.demandPerSec * response * scale;
}

// -------------------------------------------------------------------- payroll

/**
 * One technician's weekly wage.
 *
 * DERIVED FROM THE STORE'S OWN RATE, not tabulated — a shop billing $160 an hour
 * pays its people more than one billing $72, and the two figures can never drift
 * apart because there is only one of them. Exactly the argument `wageOfCost`
 * makes for the rest of the payroll, and it means a new grade on the ladder gets
 * a sensible wage for free.
 */
export function techWage(stage: StageDef, grade: number): number {
  const { wageShareOfBillings, wageHoursPerWeek } = BALANCE.shop;
  const base = referenceRate(stage) * wageHoursPerWeek * wageShareOfBillings;
  const rung = TECH_GRADES[Math.min(Math.max(0, Math.round(grade)), TOP_GRADE)];
  return Math.round(base * rung.wage);
}

/** What it costs to get somebody to start at this grade. Promotion, by contrast, is free. */
export function hireCost(stage: StageDef, grade: number): number {
  return Math.round(techWage(stage, grade) * BALANCE.shop.hireWeeks);
}

/** The shop's share of the weekly bill. */
export function shopPayroll(state: Pick<GameState, 'stage' | 'shop'>): number {
  const stage = getStage(state.stage);
  let total = 0;
  for (const tech of state.shop?.techs ?? []) total += techWage(stage, tech.grade);
  return total;
}

// ------------------------------------------------------------------ promotion

/** Labour hours this tech needs before the next grade is earned. */
export function hoursToPromote(tech: ServiceTech): number {
  const next = Math.min(TOP_GRADE, Math.round(tech.grade) + 1);
  return BALANCE.shop.promoteAtHours[next] ?? Infinity;
}

/**
 * Has this one earned the next grade?
 *
 * Promotion costs nothing and is the player's call rather than automatic, which
 * is the point: it raises the wage immediately and the throughput only while
 * there is work to do, so promoting the whole roster the moment it is available
 * is a genuine mistake in a quiet shop.
 */
export function canPromote(tech: ServiceTech): boolean {
  return Math.round(tech.grade) < TOP_GRADE && tech.xp >= hoursToPromote(tech);
}

// ---------------------------------------------------------------------- hiring

export function hireTech(s: GameState, grade: number): ServiceTech {
  const rung = Math.min(Math.max(0, Math.round(grade)), TOP_GRADE);
  const tech: ServiceTech = {
    id: mintId(s, 'tech'),
    name: customerName(intRange(s.rng, 0, 999), intRange(s.rng, 0, 999)),
    grade: rung,
    // Hired in at grade, credited with what that grade takes to reach. Without
    // it a bought-in Certified III would need a career's worth of hours before
    // the "promote" button meant anything, which reads as a bug.
    xp: BALANCE.shop.promoteAtHours[rung] ?? 0,
    hiredAt: s.t,
    jobId: null,
  };
  s.shop.techs.push(tech);
  return tech;
}

// -------------------------------------------------------------------- the tick

export interface ShopTickResult {
  /** Jobs finished and billed this step. */
  billed: { job: ServiceJob; tech: ServiceTech }[];
  /** Comebacks that went back on a bench this step. */
  reworked: { job: ServiceJob; tech: ServiceTech }[];
  /** Customers who found no room and went elsewhere. */
  turnedAway: number;
}

/**
 * One second of the service department.
 *
 * Arrivals first, then assignment, then work — in that order so a car that walks
 * in beside an idle bench is on the ramp the same second rather than next one.
 * Returns what happened instead of paying for it, same division as
 * `stepDuePlans`: the caller owns the cash, the ledger and the stats.
 */
export function stepShop(s: GameState, rate: number): ShopTickResult {
  const result: ShopTickResult = { billed: [], reworked: [], turnedAway: 0 };
  const bays = bayCount(s);
  if (bays === 0) return result;

  const stage = getStage(s.stage);

  // ---- arrivals
  const demand = shopDemandPerSec(s, rate);
  // Guarded before the draw, so a shop with the feature zeroed consumes nothing.
  if (demand > 0 && chance(s.rng, arrivalChance(demand, TICK_MS))) {
    const queued = s.shop.jobs.filter((j) => j.techId === null).length;
    if (queued >= bays * BALANCE.shop.queuePerBay) {
      // No bench and no room to wait. They go down the road, and the count is
      // the only signal that says buy another bay rather than cut the rate.
      result.turnedAway += 1;
    } else {
      s.shop.jobs.push(bookJob(s, stage, rate));
    }
  }

  // ---- assignment
  for (const tech of s.shop.techs) {
    if (tech.jobId !== null) continue;
    const next = s.shop.jobs.find((j) => j.techId === null);
    if (!next) break;
    next.techId = tech.id;
    // Duration is set when the work starts, not when the car arrives, so the
    // grade that actually does the job is the grade that prices its time.
    next.totalMs = jobDurationMs(next.hours, techGrade(tech).speed);
    next.remainingMs = next.totalMs;
    tech.jobId = next.id;
  }

  // ---- work
  for (const tech of s.shop.techs) {
    if (tech.jobId === null) continue;
    const job = s.shop.jobs.find((j) => j.id === tech.jobId);
    if (!job) {
      tech.jobId = null;
      continue;
    }

    job.remainingMs -= TICK_MS;
    if (job.remainingMs > 0) continue;

    if (!job.rework) {
      // THE CUSTOMER PAYS WHEN THE WORK IS DONE, and that is what makes rework
      // cost what it costs. The invoice is settled here, once; if it comes back
      // you have already been paid and you fix it for nothing. A comeback is a
      // bench you cannot sell, not a refund.
      //
      // Experience is per HOUR turned, so a gearbox teaches more than an oil
      // change — and a comeback teaches nothing, because doing it twice was
      // never the point.
      tech.xp += job.hours;
      result.billed.push({ job, tech });

      const grade = techGrade(tech);
      if (grade.rework > 0 && chance(s.rng, grade.rework)) {
        job.rework = true;
        job.totalMs = Math.round(job.totalMs * BALANCE.shop.reworkDuration);
        job.remainingMs = job.totalMs;
        result.reworked.push({ job, tech });
        continue;
      }
    }

    tech.jobId = null;
    s.shop.jobs = s.shop.jobs.filter((j) => j.id !== job.id);
  }

  return result;
}

/** A car books in. Priced at the rate in force right now, and stamped. */
function bookJob(s: GameState, stage: StageDef, rate: number): ServiceJob {
  const { jobHoursMin, jobHoursSpan } = BALANCE.shop;
  // Squared, so most repair orders are an hour or two and the long ones are
  // genuinely rare. Same shape argument as a service claim, one power gentler.
  // `jobScale` is the store's ticket size — the same draw at every store,
  // scaled after it, so the stream is identical whatever the store bills.
  const u = range(s.rng, 0, 1);
  const scale = stage.shop?.jobScale ?? 1;
  const hours = Math.round((jobHoursMin + jobHoursSpan * u * u) * scale * 10) / 10;

  // A franchise shop mostly sees its own marque, which costs nothing to say and
  // is the difference between a queue that reads as a dealership and one that
  // reads as a list of strings.
  const models = stage.sourcing.makeId
    ? modelsForMake(stage.sourcing.makeId)
    : modelsForTiers(stage.sourcing.tiers ?? []);
  const model = pick(s.rng, models);
  const kind = pick(s.rng, JOB_KINDS);

  return {
    id: mintId(s, 'job'),
    label: `${model.name} · ${kind}`,
    hours,
    price: Math.round(hours * rate),
    arrivedAt: s.t,
    remainingMs: 0,
    totalMs: 0,
    techId: null,
    rework: false,
  };
}

export function jobDurationMs(hours: number, speed: number): number {
  return Math.max(TICK_MS, Math.round(hours * BALANCE.shop.msPerLabourHour * speed));
}

// ------------------------------------------------------------- the other bays

/**
 * What the department does for your own stock.
 *
 * Compounding per bay rather than a flat bonus for having one, so the shop keeps
 * being worth expanding after the first bench — and multiplicative with the
 * `mechanic` upgrade and the Wrenching skill, which is the house rule whenever
 * money and practice touch one axis. See `reconModsFor`.
 */
export function shopReconMods(state: Pick<GameState, 'stage' | 'upgrades'>): {
  speedMult: number;
  costMult: number;
} {
  const bays = bayCount(state);
  if (bays === 0) return { speedMult: 1, costMult: 1 };
  return {
    speedMult: Math.pow(BALANCE.shop.reconSpeedPerBay, bays),
    costMult: Math.pow(BALANCE.shop.reconCostPerBay, bays),
  };
}

/**
 * Send the techs home and the queue elsewhere.
 *
 * Called on a stage move. Techs are staff and staff do not come with you — the
 * rule is "would this person have to be hired again at the new store", and a
 * Certified III who has spent forty game weeks learning your bays would. The
 * queue goes too: those customers booked a car in at a business that has just
 * changed hands.
 */
export function closeTheShop(s: GameState): number {
  const released = s.shop.techs.length;
  s.shop = { techs: [], jobs: [], weekRevenue: 0, weekJobs: 0 };
  return released;
}

/** Utilisation right now, for the panel. Benches busy over benches staffed. */
export function shopUtilisation(state: Pick<GameState, 'shop'>): number {
  const techs = state.shop?.techs ?? [];
  if (techs.length === 0) return 0;
  return techs.filter((t) => t.jobId !== null).length / techs.length;
}

export { SHOP_RATE_LEVELS };

export type { RngState };
