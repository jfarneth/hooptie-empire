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
import { BALANCE } from '../sim/balance';
import { canRecon, reconCost } from '../sim/cars';
import { reconModsFor } from '../sim/skills';
import { deskCounter } from '../sim/haggle';
import { SKILL_IDS, appraisalSigma, getSkill, haggleSkillFor } from '../sim/skills';
import { estimatedRetail, estimatedWholesale } from '../sim/appraisal';
import { portfolioValue, retailValue, wholesaleValue } from '../sim/economy';
import { acquisitionCeiling, advance, createInitialState, expectedCollections } from '../sim/engine';
import { activeNotes, canWriteNote, overCapacityFactor } from '../sim/notes';
import { UPGRADES, canBuyUpgrade, carCapacity, collectionsCapacity, level, upgradeCost } from '../sim/upgrades';
import { STAGES, getStage, nextStage, stageRank } from '../sim/stages';
import type { GameState } from '../sim/types';

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
}

function botTurn(state: GameState, appraisal: AppraisalTally): GameState {
  let s = state;

  // 1. Move up the moment it is affordable. A real player would weigh the
  //    payroll reset against a full book; the bot takes every rung as it comes,
  //    which makes it the *worst* case for the move and the right thing to
  //    measure the ladder against.
  if (canAdvanceStage(s)) s = advanceStage(s);

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
    if (car.status === 'ready' && canRecon(car, reconMods) && reconCost(car, reconMods) <= s.cash * 0.4) {
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
      if (s.cash - l.price < 400) continue;
      // Recorded before the buy, while the listing still exists to compare
      // against — and only on the open market. "Paid over wholesale" is the
      // definition of a bad buy when you are guessing at a stranger's car and
      // meaningless when you are reading a factory invoice, where every unit is
      // over wholesale by design and there is nothing to misjudge.
      if (judging) {
        appraisal.judged += 1;
        appraisal.absError += Math.abs(estimatedRetail(l, sigma) - retailValue(l.car)) / Math.max(1, retailValue(l.car));
        if (l.price > wholesaleValue(l.car)) appraisal.overpaid += 1;
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
      if (s.cash - cost < 3_000 * getStage(s.stage).staffCostMultiplier) continue;
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

function runOne(seed: number, hours: number, verbose: boolean) {
  let s = createInitialState(seed, 0);
  const appraisal: AppraisalTally = { judged: 0, absError: 0, overpaid: 0 };
  const milestones: Milestones = {};
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
    s = botTurn(s, appraisal);
    markMilestones();

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

  return { state: s, milestones, appraisal };
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

  console.log(`\nBalance run — ${hours}h of play, ${seeds} seeds\n${'='.repeat(64)}`);

  const allMilestones: Record<string, number[]> = {};
  const finals: GameState[] = [];
  const tallies: AppraisalTally[] = [];
  const started = Date.now();

  for (let i = 0; i < seeds; i++) {
    const seed = 1000 + i * 7919;
    if (verbose) console.log(`\nseed ${seed}`);
    const { state, milestones, appraisal } = runOne(seed, hours, verbose);
    finals.push(state);
    tallies.push(appraisal);
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

  console.log(`\nharness wall time: ${((Date.now() - started) / 1000).toFixed(1)}s\n`);
}

main();
