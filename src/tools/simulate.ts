/**
 * Headless balance harness.
 *
 *   npm run sim [-- --hours=6 --seeds=8 --verbose]
 *
 * Drives the real engine with a scripted "reasonable player" so the progression
 * curve can be judged from numbers instead of from an afternoon of tapping.
 * When this disagrees with how the game feels, the game is right — but this is
 * how you find out which constant to reach for.
 */
import {
  advanceStage,
  buyListing,
  canAdvanceStage,
  counterOffer,
  listForSale,
  purchaseUpgrade,
  setDealPolicy,
  startRecon,
  takeCashDeal,
  takeFinanceDeal,
} from '../sim/actions';
import { BALANCE, MS_PER_GAME_DAY } from '../sim/balance';
import { canRecon, reconCost } from '../sim/cars';
import { reconModsFor } from '../sim/skills';
import { deskCounter } from '../sim/haggle';
import { SKILL_IDS, appraisalSigma, getSkill, haggleSkillFor } from '../sim/skills';
import { estimatedRetail, estimatedWholesale } from '../sim/appraisal';
import { portfolioValue, retailValue, wholesaleValue } from '../sim/economy';
import { acquisitionCeiling, advance, createInitialState, expectedCollections, weeklyExpenses } from '../sim/engine';
import { activeNotes, canWriteNote, overCapacityFactor } from '../sim/notes';
import { UPGRADES, canBuyUpgrade, carCapacity, collectionsCapacity, level, upgradeCost } from '../sim/upgrades';
import { STAGES, getStage, nextStage, stageRank, typicalCarPrice } from '../sim/stages';
import { RARITIES, RARITY_ORDER } from '../sim/rarity';
import { applyTuning, getTunable } from '../sim/tuning';
import type { GameState, Rarity } from '../sim/types';

const STEP_MS = 5_000;

/** Priority order the bot buys upgrades in. Roughly what a sensible player does. */
const UPGRADE_PRIORITY = [
  'autoList',
  'driveway',
  'scout',
  'mechanic',
  'salesDesk',
  'advertising',
  'autoRecon',
  'driveway',
  'autoBuy',
  'lot',
  'collections',
  'repoMan',
  'underwriting',
  'nightManager',
];

interface AppraisalTally {
  judged: number;
  /** Sum of |estimated - true| retail, as a share of true retail. */
  absError: number;
  /** Buys that were above the car's real wholesale value. */
  overpaid: number;
  /**
   * Every car the bot bought, split by trim grade: how many, and the gross
   * margin it stood to make on each.
   *
   * Recorded at the moment of purchase, because that is the only point where
   * both halves of a rarity deal exist at once — the ask, which was priced in
   * stock trim, and the retail the graded car will actually fetch. Once the
   * listing is gone the ask is gone with it.
   */
  byRarity: Record<Rarity, { bought: number; margin: number }>;
  /**
   * How often the lot was the thing stopping the bot buying, versus how often
   * cash was.
   *
   * The two are not interchangeable and the difference decides whether capacity
   * is a pacing lever at all: a lot that is never full is a lot whose size does
   * not matter, and shrinking it changes nothing until it starts to bite — at
   * which point it bites hard. Sampled once per bot turn, before it acts.
   */
  turns: number;
  lotFull: number;
  brokeNotFull: number;
}

/**
 * How long a car actually sits before it goes.
 *
 * Sampled by watching cars leave: a cash sale removes the car outright and a
 * financed one flips to `sold`, so "no longer on the lot" catches both. Held in
 * sim ms and reported in game days, because days-on-lot is the number a real
 * dealer lives by and the one a player feels.
 */
interface DwellTally {
  /** ms from the car being LISTED to it leaving the lot, by the stage it left at. */
  listedMs: Record<string, number[]>;
  /** ms from purchase to leaving — includes recon and any wait to be listed. */
  ownedMs: number[];
}

function blankDwell(): DwellTally {
  return { listedMs: Object.fromEntries(STAGES.map((s) => [s.id, [] as number[]])), ownedMs: [] };
}

function blankRarityTally(): AppraisalTally['byRarity'] {
  return {
    common: { bought: 0, margin: 0 },
    rare: { bought: 0, margin: 0 },
    epic: { bought: 0, margin: 0 },
    legendary: { bought: 0, margin: 0 },
  };
}

function botTurn(state: GameState, appraisal: AppraisalTally, stay = false): GameState {
  let s = state;

  {
    const held = s.cars.filter((c) => c.status !== 'sold').length;
    const full = held >= carCapacity(s);
    const cheapest = s.listings.reduce((min, l) => Math.min(min, l.price), Infinity);
    appraisal.turns += 1;
    if (full) appraisal.lotFull += 1;
    else if (s.cash < cheapest) appraisal.brokeNotFull += 1;
  }

  // Float the bot keeps back at all times: enough to make rent for a few weeks.
  //
  // Added when running costs landed, and not an optimisation — without it the
  // bot spends its last dollar on stock, cannot pay the bill, and never gets out
  // again, because cash at zero buys no inventory and no inventory earns
  // anything. That killed 12 of 16 seeds outright while the other 4 ran at the
  // old pace. A player learns this in one store; the bot has to be told.
  const float = weeklyExpenses(s).total * BALANCE.expenses.reserveWeeks;

  // 1. Move up the moment it is affordable. A real player would weigh the
  //    payroll reset against a full book; the bot takes every rung as it comes,
  //    which makes it the *worst* case for the move and the right thing to
  //    measure the ladder against.
  if (!stay && canAdvanceStage(s)) s = advanceStage(s);

  // 2. Close any walk-up standing in front of us. Paper when it pays better and
  //    the desk has room for it; otherwise sell them the car.
  for (const prospect of [...s.prospects]) {
    if (getStage(s.stage).financing && canWriteNote(s)) {
      const capFactor = overCapacityFactor(activeNotes(s.notes).length, collectionsCapacity(s));
      const ev =
        prospect.downPayment +
        expectedCollections(
          prospect.financeTerms.weeks,
          prospect.financeTerms.weeklyPayment,
          BALANCE.creditTiers[prospect.tier].missChance * capFactor,
        ).expectedCollected;
      if (ev > prospect.negotiation.currentOffer) {
        s = takeFinanceDeal(s, prospect.id);
        continue;
      }
    }
    s = haggleThenClose(s, prospect.id);
  }

  // 3. Recondition anything worth reconditioning, then list it.
  const reconMods = reconModsFor(s);
  for (const car of s.cars) {
    if (car.status === 'ready' && canRecon(car, reconMods) && reconCost(car, reconMods) <= (s.cash - float) * 0.4) {
      s = startRecon(s, car.id);
    }
  }
  for (const car of s.cars) {
    if (car.status === 'ready') s = listForSale(s, car.id);
  }

  // 4. Buy the best deal on the feed if there is room and money.
  const held = s.cars.filter((c) => c.status !== 'sold').length;
  if (held < carCapacity(s)) {
    // The bot buys on the appraisal, not on the truth. Left on ground truth the
    // harness would measure a game nobody can play — the whole point of the
    // ambiguity is that this decision is made with incomplete information.
    const sigma = appraisalSigma(s);
    // The same ceiling the retainer buyer uses, so the harness cannot measure a
    // buying rule nothing in the game actually applies. On a franchise stage
    // that ceiling is the sticker rather than wholesale — an allocation is
    // always priced over wholesale, and gating on wholesale there meant the bot
    // bought literally nothing for the rest of the run.
    const ceiling = (l: (typeof s.listings)[number]) => acquisitionCeiling(s, l, 'estimate');
    const deals = s.listings
      .map((l) => ({ l, margin: estimatedRetail(l, sigma) - l.price }))
      .filter((d) => d.l.price <= ceiling(d.l) * 1.02)
      .sort((a, b) => b.margin - a.margin);
    const judging = !getStage(s.stage).sourcing.makeId;
    for (const { l } of deals) {
      if (s.cars.filter((c) => c.status !== 'sold').length >= carCapacity(s)) break;
      if (s.cash - l.price < 400 + float) continue;
      // Recorded before the buy, while the listing still exists to compare
      // against — and only on the open market, where there is something to
      // misjudge. A BAD BUY IS A CAR WHOSE TRUE RETAIL IS UNDER THE PRICE — a
      // purchase that loses money even sold perfectly. It used to be "paid
      // over wholesale", which stopped meaning anything the day the buyer's
      // ceiling moved to retail margin: paying over wholesale for a
      // retail-profitable car is now the policy, not the mistake.
      if (judging) {
        appraisal.judged += 1;
        appraisal.absError += Math.abs(estimatedRetail(l, sigma) - retailValue(l.car)) / Math.max(1, retailValue(l.car));
        if (l.price > retailValue(l.car)) appraisal.overpaid += 1;
      }
      // Both halves of the rarity deal, while they still exist together.
      const grade = appraisal.byRarity[l.car.rarity];
      if (grade) {
        grade.bought += 1;
        grade.margin += (retailValue(l.car) - l.price) / Math.max(1, retailValue(l.car));
      }
      s = buyListing(s, l.id);
    }
  }

  // 5. Reinvest — but stop and save once the next store is genuinely in reach,
  //    the way a player who can see the goal post would.
  const upNext = nextStage(s.stage);
  const savingForNextStore = upNext !== null && s.cash >= upNext.entryCost * 0.55;
  if (!savingForNextStore) {
    for (const id of UPGRADE_PRIORITY) {
      if (!canBuyUpgrade(s, id)) continue;
      const def = UPGRADES.find((u) => u.id === id)!;
      const cost = upgradeCost(def, level(s, id), s.stage);
      // Keep enough working capital to keep a car pipeline moving. Scaled to the
      // store, because $3k of float is a pipeline at a curbstone and a rounding
      // error at a Valmont franchise.
      // Keep back the float AND enough to restock. Moving now clears the whole
      // upgrade table, so the first thing a bot does at a new store is rebuy all
      // of it — and the old guard let it spend down to $3k, which does not buy
      // one car at a small lot. It then had no stock, no income, and a rent
      // bill, which is the definition of the spiral. A player learns to keep
      // cars on the lot before they buy a nicer office.
      //
      // FOUR CARS WAS THAT LESSON HALF-LEARNED. It is a lot at a curbstone and a
      // rounding error at a franchise: arriving at a midsize store the bot spent
      // its entire $4.6M opening balance rebuilding the office, then ran five
      // cars on a thirty-two stall lot against the payroll it had just hired —
      // $10.6k a week of gross against $29k of wages and rent. It never traded
      // again, and the same shape killed the premium store. Stock the lot you
      // are standing on FIRST; the office can wait for the cars to pay for it.
      const stage = getStage(s.stage);
      const restock = Math.max(4, Math.ceil(carCapacity(s) * BALANCE.expenses.reopeningLotShare));
      const keep = float + typicalCarPrice(stage) * restock;
      if (s.cash - cost < keep) continue;
      s = purchaseUpgrade(s, id);
      if (id === 'salesDesk') s = setDealPolicy(s, 'auto');
    }
  }

  return s;
}

/**
 * Mirrors the sales desk: counter once, then take whatever comes back.
 *
 * The bot must haggle the same way automation does, or the harness would be
 * measuring a game nobody actually plays.
 */
function haggleThenClose(state: GameState, prospectId: string): GameState {
  let s = state;
  const prospect = s.prospects.find((p) => p.id === prospectId);
  if (!prospect) return s;

  const neg = prospect.negotiation;
  if (neg.status === 'open' && neg.countersMade === 0) {
    const counter = deskCounter(neg, haggleSkillFor(s));
    if (counter > neg.currentOffer) s = counterOffer(s, prospectId, counter);
  }

  // They may have walked, in which case the prospect is gone or flagged.
  const after = s.prospects.find((p) => p.id === prospectId);
  if (!after || after.negotiation.status === 'walked') return s;

  return takeCashDeal(s, prospectId);
}

interface Milestones {
  [key: string]: number | undefined;
}

function runOne(
  seed: number,
  hours: number,
  verbose: boolean,
  stay = false,
  cadence: { activeMs: number; idleMs: number } | null = null,
) {
  let s = createInitialState(seed, 0);
  const appraisal: AppraisalTally = {
    judged: 0,
    absError: 0,
    overpaid: 0,
    byRarity: blankRarityTally(),
    turns: 0,
    lotFull: 0,
    brokeNotFull: 0,
  };
  const milestones: Milestones = {};
  const dwell: DwellTally = blankDwell();
  /** carId -> when it was bought and when it was listed, for the cars on the lot. */
  let held = new Map<string, { acquiredAt: number; listedAt: number | null }>();
  const totalMs = hours * 60 * 60 * 1000;
  let lastReport = 0;

  const mark = (key: string) => {
    if (milestones[key] === undefined) milestones[key] = s.t;
  };

  /**
   * Checked either side of the bot's turn, because some milestones describe a
   * state the bot immediately spends away.
   *
   * The stage milestones are why. botTurn moves up on its first line, so a check
   * that only ran afterwards would never see the balance that paid for the move
   * — the original 'cash for lot' milestone silently reported the time to earn
   * $18k *back*, which made stage 1 look about twenty minutes longer than it was.
   */
  const markMilestones = () => {
    // One milestone per rung, so the whole ladder is visible in one run.
    for (const def of STAGES) {
      if (stageRank(s.stage) >= stageRank(def.id)) mark(def.name);
    }
    if (s.stats.financeDeals >= 1) mark('first note written');
    if (s.stats.reposCompleted >= 1) mark('first repo');
    if (s.notes.filter((n) => n.status === 'paid').length >= 1) mark('first note paid off');
    if (portfolioValue(s.notes) >= 50_000) mark('$50k portfolio');
    if (s.cash >= 100_000) mark('$100k cash');
    // Does levelling keep pace with the stages it is meant to accompany?
    for (const id of SKILL_IDS) {
      if (s.skills[id].level >= 5) mark(`${getSkill(id).name} 5`);
    }
  };

  while (s.t < totalMs) {
    s = advance(s, STEP_MS);
    markMilestones();
    // In cadence mode the bot only exists during its active windows; the rest
    // of the cycle is the same engine-only run that offline catch-up performs.
    const cycleT = cadence ? s.t % (cadence.activeMs + cadence.idleMs) : 0;
    const attending = !cadence || cycleT < cadence.activeMs;
    if (attending) s = botTurn(s, appraisal, stay);
    markMilestones();

    {
      const now = new Map<string, { acquiredAt: number; listedAt: number | null }>();
      for (const c of s.cars) {
        if (c.status === 'sold') continue;
        now.set(c.id, { acquiredAt: c.acquiredAt, listedAt: c.listedAt });
      }
      for (const [id, was] of held) {
        if (now.has(id)) continue;
        dwell.ownedMs.push(s.t - was.acquiredAt);
        if (was.listedAt !== null) dwell.listedMs[s.stage].push(s.t - was.listedAt);
      }
      held = now;
    }

    if (verbose && s.t - lastReport >= 15 * 60 * 1000) {
      lastReport = s.t;
      console.log(
        `  ${fmtTime(s.t).padStart(7)}  cash ${fmtMoney(s.cash).padStart(10)}` +
          `  portfolio ${fmtMoney(portfolioValue(s.notes)).padStart(9)}` +
          `  cars ${String(s.cars.filter((c) => c.status !== 'sold').length).padStart(2)}` +
          `  notes ${String(activeNotes(s.notes).length).padStart(3)}/${String(collectionsCapacity(s)).padEnd(3)}` +
          `  sold ${String(s.stats.carsSold).padStart(3)}`,
      );
    }
  }

  return { state: s, milestones, appraisal, dwell };
}

function fmtMoney(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

function fmtTime(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}m` : `${m}m`;
}

function main() {
  const args = process.argv.slice(2);
  const getArg = (name: string, fallback: number) => {
    const hit = args.find((a) => a.startsWith(`--${name}=`));
    return hit ? Number(hit.split('=')[1]) : fallback;
  };
  const hours = getArg('hours', 4);
  const seeds = getArg('seeds', 6);
  const verbose = args.includes('--verbose');
  /**
   * `--stay` — never move up the ladder.
   *
   * The bot normally takes every rung the instant it is affordable, which makes
   * it the worst case for the move. What that can never show is the case a real
   * player hits constantly: being ASLEEP on a rung. Eight hours of offline
   * catch-up runs at whatever store you closed the app on, and nothing in the
   * game moves you up while you are gone — so the money piles up at one
   * capacity, against one ask band, with nothing to spend it on. That is how a
   * player wakes up able to skip a store, and the default harness has never
   * measured it.
   */
  const stay = args.includes('--stay');
  /**
   * `--cadence=15:240` — burst play. Active for the first number of minutes,
   * then hands-off (engine only, exactly what offline catch-up runs) for the
   * second, repeating. This is the profile a real person actually has — ten or
   * twenty minutes over coffee, then hours away — and it is the mode where the
   * commission desk matters: during bursts the bot grabs every walk-up inside
   * the grace window and keeps the whole margin, and between bursts every sale
   * is a staff sale at the stage's cut. The continuous default measures a
   * player who never sleeps; keep quoting it for comparability, but read this
   * one to know what the game actually pays.
   */
  const cadenceArg = args.find((a) => a.startsWith('--cadence='));
  const cadence = cadenceArg
    ? (() => {
        const [active, idle] = cadenceArg.split('=')[1].split(':').map(Number);
        if (!(active > 0) || !(idle > 0)) throw new Error('--cadence=activeMin:idleMin');
        return { activeMs: active * 60_000, idleMs: idle * 60_000 };
      })()
    : null;

  /**
   * `--set=balance.rarity.valueStep=0` — the same knobs the admin console turns.
   *
   * This exists so a change can be A/B'd against an IDENTICAL RNG stream. Adding
   * a draw per car reshuffles every seed, so comparing a new build against an
   * old one measures the reshuffle as much as the change; setting the new
   * feature's own constant to zero leaves the stream alone and isolates what the
   * feature is actually worth. Overrides are applied before any state is built,
   * exactly as `reconcileTuning` does on load.
   */
  const overrides: Record<string, number> = {};
  for (const arg of args) {
    if (!arg.startsWith('--set=')) continue;
    const body = arg.slice('--set='.length);
    const at = body.lastIndexOf('=');
    if (at < 0) throw new Error(`--set needs path=value, got "${body}"`);
    const path = body.slice(0, at);
    if (!getTunable(path)) throw new Error(`--set: "${path}" is not a tunable`);
    overrides[path] = Number(body.slice(at + 1));
  }
  if (Object.keys(overrides).length > 0) applyTuning(overrides);

  console.log(
    `\nBalance run — ${hours}h of play, ${seeds} seeds${stay ? ', STAYING PUT' : ''}${
      cadence ? `, cadence ${cadence.activeMs / 60_000}m on / ${cadence.idleMs / 60_000}m off` : ''
    }\n${'='.repeat(64)}`,
  );
  for (const [path, value] of Object.entries(overrides)) {
    console.log(`  override  ${path} = ${value}`);
  }

  const allMilestones: Record<string, number[]> = {};
  const finals: GameState[] = [];
  const tallies: AppraisalTally[] = [];
  const dwells: DwellTally = blankDwell();
  const started = Date.now();

  for (let i = 0; i < seeds; i++) {
    const seed = 1000 + i * 7919;
    if (verbose) console.log(`\nseed ${seed}`);
    const { state, milestones, appraisal, dwell } = runOne(seed, hours, verbose, stay, cadence);
    finals.push(state);
    tallies.push(appraisal);
    // Pushed one at a time: a spread of a multi-million-element array blows the
    // call stack, and a 350h run produces exactly that.
    for (const def of STAGES) {
      const into = dwells.listedMs[def.id];
      for (const ms of dwell.listedMs[def.id]) into.push(ms);
    }
    for (const ms of dwell.ownedMs) dwells.ownedMs.push(ms);
    for (const [key, t] of Object.entries(milestones)) {
      if (t === undefined) continue;
      (allMilestones[key] ??= []).push(t);
    }
  }

  console.log(`\nMilestones (median, reached-by-count of ${seeds})`);
  console.log('-'.repeat(64));
  const order = [
    ...STAGES.slice(1).map((def) => def.name),
    'first note written',
    'first repo',
    'first note paid off',
    '$50k portfolio',
    '$100k cash',
    ...SKILL_IDS.map((id) => `${getSkill(id).name} 5`),
  ];
  for (const key of order) {
    const times = allMilestones[key];
    if (!times || times.length === 0) {
      console.log(`  ${key.padEnd(22)} not reached`);
      continue;
    }
    const sorted = [...times].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    console.log(
      `  ${key.padEnd(22)} ${fmtTime(median).padStart(7)}   (${times.length}/${seeds})`,
    );
  }

  console.log(`\nEnd state after ${hours}h (median across seeds)`);
  console.log('-'.repeat(64));
  const median = (pick: (s: GameState) => number) => {
    const vals = finals.map(pick).sort((a, b) => a - b);
    return vals[Math.floor(vals.length / 2)];
  };
  console.log(`  cash               ${fmtMoney(median((s) => s.cash)).padStart(12)}`);
  console.log(`  portfolio          ${fmtMoney(median((s) => portfolioValue(s.notes))).padStart(12)}`);
  console.log(`  lifetime profit    ${fmtMoney(median((s) => s.stats.lifetimeProfit)).padStart(12)}`);
  console.log(`  cars sold          ${String(median((s) => s.stats.carsSold)).padStart(12)}`);

  // Health of the ambiguity system. A bad-buy rate near zero means the feed is
  // still telling the player the answer; near half means it is a coin flip.
  const judged = tallies.reduce((n, t) => n + t.judged, 0);
  if (judged > 0) {
    const err = tallies.reduce((n, t) => n + t.absError, 0) / judged;
    const bad = tallies.reduce((n, t) => n + t.overpaid, 0) / judged;
    console.log(`  appraisal error    ${(err * 100).toFixed(1).padStart(11)}%`);
    console.log(`  bad-buy rate       ${(bad * 100).toFixed(1).padStart(11)}%`);
  }
  // The book limit is a hard constraint now, so how close the bot runs to it —
  // and whether it ever staffs the desk high enough to matter — is the first
  // thing to look at when the finance side of a run looks wrong.
  console.log(
    `  book / limit       ${String(median((s) => activeNotes(s.notes).length)).padStart(6)} /${String(median((s) => collectionsCapacity(s))).padStart(5)}`,
  );
  console.log(`  collections desk   ${String(median((s) => level(s, 'collections'))).padStart(12)}`);
  console.log(`  cash / finance     ${String(median((s) => s.stats.cashDeals)).padStart(6)} /${String(median((s) => s.stats.financeDeals)).padStart(5)}`);
  console.log(`  notes paid / dflt  ${String(median((s) => s.stats.notesPaidOff)).padStart(6)} /${String(median((s) => s.stats.notesDefaulted)).padStart(5)}`);
  console.log(`  repos              ${String(median((s) => s.stats.reposCompleted)).padStart(12)}`);
  console.log(
    `  staff commission   ${fmtMoney(median((s) => s.stats.commissionPaid)).padStart(12)}`,
  );
  console.log(
    `  haggles won / lost ${String(median((s) => s.stats.negotiationsWon)).padStart(6)} /${String(median((s) => s.stats.walkaways)).padStart(5)}`,
  );

  const won = median((s) => s.stats.negotiationsWon);
  const lost = median((s) => s.stats.walkaways);
  if (won + lost > 0) {
    console.log(`  walk-away rate     ${((lost / (won + lost)) * 100).toFixed(1).padStart(11)}%`);
  }

  const defaults = median((s) => s.stats.notesDefaulted);
  const written = median((s) => s.stats.financeDeals);
  if (written > 0) {
    console.log(`  default rate       ${((defaults / written) * 100).toFixed(1).padStart(11)}%`);
  }

  /**
   * Trim grades, pooled across every seed rather than taken as a median.
   *
   * Legendary is one car in a thousand, so a per-seed median of it is zero at
   * every plausible run length and would report the rarest thing in the game as
   * not existing. The margin column is the one that matters: it should climb by
   * six to seven points a grade on the used stages, and if it is flat the ask is
   * tracking the trim and the feature is doing nothing.
   */
  const turns = tallies.reduce((n, t) => n + t.turns, 0);
  if (turns > 0) {
    const full = tallies.reduce((n, t) => n + t.lotFull, 0) / turns;
    const broke = tallies.reduce((n, t) => n + t.brokeNotFull, 0) / turns;
    console.log(`  lot full           ${(full * 100).toFixed(1).padStart(11)}%`);
    console.log(`  broke, lot empty   ${(broke * 100).toFixed(1).padStart(11)}%`);
  }

  /**
   * Days on the lot, pooled across seeds.
   *
   * Pooled rather than medianed per seed for the same reason the rarity table
   * is: this is a distribution over cars, not a property of a run. The p90 is
   * the one to watch when the complaint is "nothing ever sits" — a median of
   * two days with a p90 of three means the lot is a conveyor belt.
   */
  {
    const days = (ms: number) => ms / MS_PER_GAME_DAY;
    const q = (xs: number[], p: number) => {
      const sorted = [...xs].sort((a, b) => a - b);
      return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
    };
    console.log(`\nDays on the lot, by store (all seeds pooled)`);
    console.log('-'.repeat(64));
    for (const def of STAGES) {
      const xs = dwells.listedMs[def.id];
      if (xs.length === 0) continue;
      const quick = xs.filter((ms) => ms < MS_PER_GAME_DAY).length / xs.length;
      console.log(
        `  ${def.shortName.padEnd(10)} ${String(xs.length).padStart(5)} cars` +
          `   p50 ${days(q(xs, 0.5)).toFixed(1).padStart(5)}d` +
          `   p90 ${days(q(xs, 0.9)).toFixed(1).padStart(5)}d` +
          `   <1d ${(quick * 100).toFixed(0).padStart(3)}%`,
      );
    }
  }

  const pooled = blankRarityTally();
  for (const t of tallies) {
    for (const id of RARITY_ORDER) {
      pooled[id].bought += t.byRarity[id].bought;
      pooled[id].margin += t.byRarity[id].margin;
    }
  }
  const totalBought = RARITY_ORDER.reduce((n, id) => n + pooled[id].bought, 0);
  if (totalBought > 0) {
    console.log(`\nTrim grades bought (all ${seeds} seeds pooled, ${totalBought} cars)`);
    console.log('-'.repeat(64));
    for (const id of RARITY_ORDER) {
      const { bought, margin } = pooled[id];
      const share = ((bought / totalBought) * 100).toFixed(2);
      const mean = bought > 0 ? `${((margin / bought) * 100).toFixed(1)}%` : '—';
      console.log(
        `  ${RARITIES[id].name.padEnd(11)} ${String(bought).padStart(5)}` +
          `  ${share.padStart(6)}% of buys   margin ${mean.padStart(6)}`,
      );
    }
  }

  console.log(`\nharness wall time: ${((Date.now() - started) / 1000).toFixed(1)}s\n`);
}

main();
