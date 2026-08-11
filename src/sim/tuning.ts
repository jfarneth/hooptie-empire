import { BALANCE } from './balance';
import { STAGES } from './stages';

/**
 * The admin console's model: every constant worth turning, and the plumbing to
 * turn it.
 *
 * WHY THIS IS ALLOWED TO MUTATE GLOBALS. Everything else in `src/sim` is pure,
 * and this is the one deliberate exception. The alternative — threading a
 * settings object through every valuation, negotiation and note function —
 * would touch essentially every signature in the simulation to serve a tool
 * that exists for tuning. Instead the overrides are written straight into
 * `BALANCE` and `STAGES`, which works because nothing captures a *primitive*
 * from either at import time: skills.ts holds `BALANCE.skills.xp` and haggle.ts
 * holds `BALANCE.negotiation`, both object references whose properties are read
 * per call. `as const` is a compile-time assertion, not `Object.freeze`.
 *
 * Determinism survives because the override set lives in the save
 * (`GameState.tuning`) and is re-applied on load *before* offline catch-up runs.
 * A given save therefore still replays identically. What is NOT preserved is
 * comparability across different override sets — which is the entire point of
 * the console, and why the screen says so.
 *
 * Adding a knob is one entry in TUNABLES. Nothing else needs to change.
 */

export type TunableKind = 'money' | 'ratio' | 'percent' | 'ms' | 'int' | 'number';

export interface TunableDef {
  /** Stable key, also the save key. Never rename without a migration. */
  path: string;
  label: string;
  group: string;
  kind: TunableKind;
  min: number;
  max: number;
  /** One line on what moving it does. Shown under the row. */
  help?: string;
}

export const TUNABLE_GROUPS = [
  'Economy',
  'Rarity',
  'The feed',
  'Reconditioning',
  'Traffic & pricing',
  'Negotiation',
  'Financing',
  'Credit tiers',
  'Capacity',
  'Promotions',
  'Skills',
  'The ladder',
  'Running costs',
  'Retirement',
] as const;

export const TUNABLES: readonly TunableDef[] = [
  // ------------------------------------------------------------------ economy
  { path: 'balance.startingCash', label: 'Starting cash', group: 'Economy', kind: 'money', min: 0, max: 1_000_000 },
  { path: 'balance.wholesaleOfRetail', label: 'Wholesale as share of retail', group: 'Economy', kind: 'ratio', min: 0.3, max: 1,
    help: 'What you pay versus what you get. The margin on every used car traces through here.' },
  { path: 'balance.conditionFloorFactor', label: 'Value floor of a rough car', group: 'Economy', kind: 'ratio', min: 0.1, max: 1 },
  { path: 'balance.mileageFloor', label: 'Value floor at high mileage', group: 'Economy', kind: 'ratio', min: 0.02, max: 1 },
  { path: 'balance.mileageDecayScale', label: 'Mileage decay scale', group: 'Economy', kind: 'int', min: 20_000, max: 1_000_000,
    help: 'Miles at which value has fallen by 1/e. Larger is gentler depreciation.' },
  { path: 'balance.repoValuePenalty', label: 'Value lost per prior repo', group: 'Economy', kind: 'ratio', min: 0, max: 0.5 },
  { path: 'balance.forcedSaleRate', label: 'Forced sale, share of wholesale', group: 'Economy', kind: 'ratio', min: 0, max: 1,
    help: 'What you get when a car must go now: the lot on a stage move, or a repo with nowhere to park. At 1 neither costs anything.' },

  // -------------------------------------------------------------------- rarity
  { path: 'balance.rarity.valueStep', label: 'Value added per grade', group: 'Rarity', kind: 'percent', min: 0, max: 1,
    help: 'Each grade is worth this much more of the car at retail. The seller’s ask is always priced in stock trim, so the whole step is margin.' },
  { path: 'balance.rarity.rareChance', label: 'Chance of Sport trim', group: 'Rarity', kind: 'percent', min: 0, max: 1 },
  { path: 'balance.rarity.epicChance', label: 'Chance of Special Edition', group: 'Rarity', kind: 'percent', min: 0, max: 1 },
  { path: 'balance.rarity.legendaryChance', label: 'Chance of a Unicorn', group: 'Rarity', kind: 'percent', min: 0, max: 1,
    help: 'Only affects cars generated after the change — a grade is rolled once and lives on the car.' },

  // ---------------------------------------------------------- running costs
  { path: 'balance.expenses.wageOfCost', label: 'Weekly wage, share of hire cost', group: 'Running costs', kind: 'percent', min: 0, max: 0.5,
    help: 'A hire’s weekly wage as a share of what that level cost to buy, so an expensive hire is expensive to keep. Staff only.' },
  { path: 'balance.expenses.floorplanWeeklyRate', label: 'Floorplan interest per week', group: 'Running costs', kind: 'percent', min: 0, max: 0.2,
    help: 'Charged on the cost basis of everything unsold on the lot. This is what makes dead stock cost money.' },

  // --------------------------------------------------------------- retirement
  { path: 'balance.prestige.pointDollars', label: 'Dollars per retirement point', group: 'Retirement', kind: 'money', min: 10_000, max: 100_000_000,
    help: 'One point per this much net sale value. Linear on purpose: deep runs earn, early bails just reset.' },
  { path: 'balance.prestige.edgePerPoint', label: 'Buy-side edge per point', group: 'Retirement', kind: 'percent', min: 0, max: 0.05,
    help: 'Every ask — auction or invoice — is this much cheaper per point.' },
  { path: 'balance.prestige.edgeCap', label: 'Edge cap', group: 'Retirement', kind: 'percent', min: 0, max: 0.5 },
  { path: 'balance.prestige.notesSaleRate', label: 'Note buyer pays, share of principal', group: 'Retirement', kind: 'ratio', min: 0, max: 1 },
  { path: 'balance.loan.carsOffered', label: 'Shark offer, in cars', group: 'Retirement', kind: 'int', min: 1, max: 20,
    help: 'The UI never says this — it shows his dollar figure, take it or leave it.' },
  { path: 'balance.loan.apr', label: 'Shark APR', group: 'Retirement', kind: 'percent', min: 0.05, max: 2 },
  { path: 'balance.loan.termWeeks', label: 'Shark term, weeks', group: 'Retirement', kind: 'int', min: 4, max: 104 },

  // ----------------------------------------------------------------- the feed
  { path: 'balance.baseListingSlots', label: 'Feed slots', group: 'The feed', kind: 'int', min: 1, max: 30 },
  { path: 'balance.listingSlotsPerScoutLevel', label: 'Extra slots per scout level', group: 'The feed', kind: 'int', min: 0, max: 10 },
  { path: 'balance.listingIntervalMs', label: 'Gap between listings', group: 'The feed', kind: 'ms', min: 1_000, max: 300_000,
    help: 'Throughput compounds harder than anything else in the game. Small changes here are large.' },
  { path: 'balance.listingIntervalPerScoutLevel', label: 'Interval multiplier per scout level', group: 'The feed', kind: 'ratio', min: 0.2, max: 1 },
  { path: 'balance.listingLifetimeMs', label: 'How long a listing lasts', group: 'The feed', kind: 'ms', min: 10_000, max: 900_000 },

  // ------------------------------------------------------------------- recon
  { path: 'balance.reconMsPerPoint', label: 'Shop time per condition point', group: 'Reconditioning', kind: 'ms', min: 5_000, max: 900_000 },
  { path: 'balance.reconCostPerPoint', label: 'Shop cost per condition point', group: 'Reconditioning', kind: 'ratio', min: 0.01, max: 2,
    help: 'As a share of the car’s condition-free value, not the model’s base value.' },
  { path: 'balance.reconMaxLift', label: 'Most one job can add', group: 'Reconditioning', kind: 'ratio', min: 0.05, max: 1 },
  { path: 'balance.reconMsPerMechanicLevel', label: 'Speed multiplier per mechanic level', group: 'Reconditioning', kind: 'ratio', min: 0.2, max: 1 },

  // -------------------------------------------------------- traffic & pricing
  { path: 'balance.baseProspectRatePerSec', label: 'Walk-ups per second at retail', group: 'Traffic & pricing', kind: 'number', min: 0.0001, max: 1 },
  { path: 'balance.ratePerAdvertisingLevel', label: 'Traffic multiplier per advertising level', group: 'Traffic & pricing', kind: 'ratio', min: 1, max: 3 },
  { path: 'balance.priceElasticity', label: 'Price elasticity', group: 'Traffic & pricing', kind: 'number', min: 0, max: 20,
    help: 'How hard buyers punish overpricing.' },
  { path: 'balance.prospectLifetimeMs', label: 'Buyer patience', group: 'Traffic & pricing', kind: 'ms', min: 5_000, max: 600_000 },
  { path: 'balance.maxViablePriceRatio', label: 'Price at which traffic dies', group: 'Traffic & pricing', kind: 'ratio', min: 1, max: 5 },
  { path: 'balance.defaultAskRatio', label: 'Default ask when listing', group: 'Traffic & pricing', kind: 'ratio', min: 0.5, max: 3 },

  // -------------------------------------------------------------- negotiation
  { path: 'balance.negotiation.fullPriceChance', label: 'Pays full price without haggling', group: 'Negotiation', kind: 'percent', min: 0, max: 1 },
  { path: 'balance.negotiation.maxOpeningDiscount', label: 'Deepest opening discount', group: 'Negotiation', kind: 'percent', min: 0, max: 0.9 },
  { path: 'balance.negotiation.roomMean', label: 'Haggling room, mean', group: 'Negotiation', kind: 'ratio', min: 0, max: 1,
    help: 'Where the hidden reservation sits between their offer and your ask.' },
  { path: 'balance.negotiation.roomSpread', label: 'Haggling room, spread', group: 'Negotiation', kind: 'ratio', min: 0, max: 1 },
  { path: 'balance.negotiation.acceptanceAtReservation', label: 'Accepts a counter at their limit', group: 'Negotiation', kind: 'percent', min: 0.01, max: 1,
    help: 'Caps the achievable walk-away rate: an accepted counter can never walk.' },
  { path: 'balance.negotiation.stretchDecay', label: 'Acceptance decay past the limit', group: 'Negotiation', kind: 'number', min: 0.1, max: 20 },
  { path: 'balance.negotiation.baseWalkChance', label: 'Walks after a rejected counter', group: 'Negotiation', kind: 'percent', min: 0, max: 1,
    help: 'At 1.0 the "they come back with a better number" branch dies for a level-1 closer.' },
  { path: 'balance.negotiation.walkPerExcess', label: 'Extra walk odds per unit of overreach', group: 'Negotiation', kind: 'number', min: 0, max: 3 },
  { path: 'balance.negotiation.walkPerRound', label: 'Extra walk odds per round', group: 'Negotiation', kind: 'number', min: 0, max: 1 },
  { path: 'balance.negotiation.maxPlayerCounters', label: 'Counters you get', group: 'Negotiation', kind: 'int', min: 1, max: 6 },
  { path: 'balance.negotiation.deskCounterFraction', label: 'Where the sales desk counters', group: 'Negotiation', kind: 'ratio', min: 0, max: 1 },

  // ---------------------------------------------------------------- financing
  { path: 'balance.delinquencyMissMultiplier', label: 'Miss multiplier once behind', group: 'Financing', kind: 'ratio', min: 1, max: 5 },
  { path: 'balance.repoAfterMissedPayments', label: 'Default repo trigger', group: 'Financing', kind: 'int', min: 1, max: 12,
    help: 'The house default. Players override it in Office → Business.' },
  { path: 'balance.repoFee', label: 'Repo fee', group: 'Financing', kind: 'money', min: 0, max: 20_000 },
  { path: 'balance.repoConditionLoss', label: 'Condition lost on repo', group: 'Financing', kind: 'ratio', min: 0, max: 1 },
  { path: 'balance.repoConditionLossPerExtraMiss', label: 'Extra repo damage per missed payment', group: 'Financing', kind: 'ratio', min: 0, max: 1 },
  { path: 'balance.baseCollectionsCapacity', label: 'Contracts the desk carries', group: 'Financing', kind: 'int', min: 1, max: 200,
    help: 'A hard cap. The finance desk refuses to write past it.' },
  { path: 'balance.collectionsCapacityPerLevel', label: 'Extra contracts per desk level', group: 'Financing', kind: 'int', min: 0, max: 100 },
  { path: 'balance.overCapacityMissPenalty', label: 'Miss penalty per 100% over capacity', group: 'Financing', kind: 'ratio', min: 0, max: 5 },
  { path: 'balance.overCapacityMissPenaltyCap', label: 'Cap on that penalty', group: 'Financing', kind: 'ratio', min: 1, max: 10 },

  // -------------------------------------------------------------- credit mix
  ...(['A', 'B', 'C', 'D'] as const).flatMap((t) => [
    { path: `balance.creditTiers.${t}.missChance`, label: `Tier ${t} — miss chance`, group: 'Credit tiers', kind: 'percent' as const, min: 0, max: 0.95 },
    { path: `balance.creditTiers.${t}.downShare`, label: `Tier ${t} — down payment`, group: 'Credit tiers', kind: 'percent' as const, min: 0, max: 0.9 },
    { path: `balance.creditTiers.${t}.apr`, label: `Tier ${t} — APR`, group: 'Credit tiers', kind: 'percent' as const, min: 0, max: 1 },
    { path: `balance.creditTiers.${t}.weight`, label: `Tier ${t} — share of walk-ups`, group: 'Credit tiers', kind: 'ratio' as const, min: 0.01, max: 1 },
  ]),

  // ----------------------------------------------------------------- capacity
  { path: 'balance.capacityPerDrivewayLevel', label: 'Cars per driveway level', group: 'Capacity', kind: 'int', min: 1, max: 10 },
  { path: 'balance.capacityPerLotLevel', label: 'Cars per lot level', group: 'Capacity', kind: 'int', min: 1, max: 40 },

  // --------------------------------------------------------------- promotions
  { path: 'balance.promotions.grandOpening.trafficMultiplier', label: 'Grand opening — traffic ×', group: 'Promotions', kind: 'ratio', min: 1, max: 10,
    help: 'Multiplies walk-ups while it runs. It cannot rescue an overpriced car — that traffic is already zero.' },
  { path: 'balance.promotions.grandOpening.durationMs', label: 'Grand opening — how long', group: 'Promotions', kind: 'ms', min: 60_000, max: 8 * 60 * 60 * 1000,
    help: 'Only applies to promotions that start after the change; a running one already stamped its end time onto the save.' },

  // ------------------------------------------------------------------- skills
  // The cap and the XP curve are one setting. Moving the cap without moving
  // growth is what makes the top of the ladder unreachable — at 1.55 the
  // fiftieth level costs ~10^11 XP. See balance.ts.
  { path: 'balance.skills.maxLevel', label: 'Skill max level', group: 'Skills', kind: 'int', min: 2, max: 200 },
  { path: 'balance.skills.xpBase', label: 'XP for level 2', group: 'Skills', kind: 'int', min: 10, max: 10_000 },
  { path: 'balance.skills.xpGrowth', label: 'XP growth per level', group: 'Skills', kind: 'ratio', min: 1.01, max: 4 },
  { path: 'balance.skills.sell.extraCounterAt', label: 'Closing level for a third counter', group: 'Skills', kind: 'int', min: 0, max: 200 },
  { path: 'balance.skills.xp.buyPerCar', label: 'Buying XP per car', group: 'Skills', kind: 'number', min: 0, max: 500 },
  { path: 'balance.skills.xp.sellPerDeal', label: 'Closing XP per deal', group: 'Skills', kind: 'number', min: 0, max: 500 },
  { path: 'balance.skills.xp.repairPerPoint', label: 'Wrenching XP per condition point', group: 'Skills', kind: 'number', min: 0, max: 1_000 },

  // --------------------------------------------------------------- the ladder
  ...STAGES.flatMap((stage) => {
    const rows: TunableDef[] = [];
    if (stage.entryCost > 0) {
      rows.push({
        path: `stages.${stage.id}.entryCost`,
        label: `${stage.name} — entry cost`,
        group: 'The ladder',
        kind: 'money',
        min: 0,
        max: 500_000_000,
      });
    }
    rows.push({
      path: `stages.${stage.id}.baseCarCapacity`,
      label: `${stage.name} — cars held`,
      group: 'The ladder',
      kind: 'int',
      min: 1,
      max: 300,
    });
    rows.push({
      path: `stages.${stage.id}.rentPerWeek`,
      label: `${stage.name} — rent per week`,
      group: 'Running costs',
      kind: 'money',
      min: 0,
      max: 10_000_000,
    });
    rows.push({
      path: `stages.${stage.id}.upgradeCostMultiplier`,
      label: `${stage.name} — upgrade cost ×`,
      group: 'The ladder',
      kind: 'ratio',
      min: 0.1,
      max: 200,
    });
    if (stage.financing) {
      rows.push({
        path: `stages.${stage.id}.bhphMultiplier`,
        label: `${stage.name} — window markup`,
        group: 'The ladder',
        kind: 'ratio',
        min: 1,
        max: 5,
      });
    }
    // The ask band is per stage because a franchise buys at invoice and a used
    // lot buys at auction. It is still the sharpest knob in the game.
    rows.push({
      path: `stages.${stage.id}.sourcing.askMin`,
      label: `${stage.name} — ask, low`,
      group: 'The ladder',
      kind: 'ratio',
      min: 0.2,
      max: 3,
      help: stage.sourcing.makeId
        ? undefined
        : 'Share of wholesale. Sets both how many cars are worth buying and the margin on them.',
    });
    rows.push({
      path: `stages.${stage.id}.sourcing.askMax`,
      label: `${stage.name} — ask, high`,
      group: 'The ladder',
      kind: 'ratio',
      min: 0.2,
      max: 4,
    });
    return rows;
  }),
];

const BY_PATH = new Map(TUNABLES.map((t) => [t.path, t]));

export function getTunable(path: string): TunableDef | undefined {
  return BY_PATH.get(path);
}

// ------------------------------------------------------------------ plumbing

const STAGE_BY_ID = new Map(STAGES.map((s) => [s.id, s]));

/**
 * Resolve a dotted path to the object that owns the value and the key on it.
 * Returns null for a path this build does not recognise, which is what makes a
 * save carrying a knob that has since been removed harmless rather than fatal.
 */
function resolve(path: string): { owner: Record<string, unknown>; key: string } | null {
  const parts = path.split('.');
  const root = parts.shift();

  let node: unknown;
  if (root === 'balance') node = BALANCE;
  else if (root === 'stages') node = STAGE_BY_ID.get(parts.shift() as never);
  else return null;

  const key = parts.pop();
  if (!key || node == null) return null;

  for (const part of parts) {
    if (typeof node !== 'object' || node === null) return null;
    node = (node as Record<string, unknown>)[part];
  }
  if (typeof node !== 'object' || node === null) return null;
  if (typeof (node as Record<string, unknown>)[key] !== 'number') return null;

  return { owner: node as Record<string, unknown>, key };
}

/**
 * Every tunable's shipped value, captured once at import.
 *
 * Taken before anything can apply an override, which is what makes "reset to
 * default" exact rather than approximate. Read from a stored snapshot rather
 * than re-derived, because by the time reset is called the live object has
 * already been written over.
 */
const DEFAULTS: Record<string, number> = (() => {
  const out: Record<string, number> = {};
  for (const def of TUNABLES) {
    const site = resolve(def.path);
    if (site) out[def.path] = site.owner[site.key] as number;
  }
  return out;
})();

export function defaultValue(path: string): number | undefined {
  return DEFAULTS[path];
}

/** The value currently in force, override or not. */
export function currentValue(path: string): number | undefined {
  const site = resolve(path);
  return site ? (site.owner[site.key] as number) : undefined;
}

/** Clamp to the knob's declared range, and round where the sim needs an integer. */
export function coerceTunable(def: TunableDef, raw: number): number {
  if (!Number.isFinite(raw)) return DEFAULTS[def.path] ?? def.min;
  const clamped = Math.min(def.max, Math.max(def.min, raw));
  return def.kind === 'int' || def.kind === 'ms' ? Math.round(clamped) : clamped;
}

/**
 * Put the world back to its shipped values and then lay `overrides` on top.
 *
 * Always a full reset first, so applying a *smaller* override set genuinely
 * removes the knobs that are no longer in it. Applying diffs on top of a dirty
 * global was the obvious shortcut and would have made "reset this row" silently
 * do nothing.
 */
export function applyTuning(overrides: Record<string, number> | undefined): void {
  for (const [path, value] of Object.entries(DEFAULTS)) {
    const site = resolve(path);
    if (site) site.owner[site.key] = value;
  }
  if (!overrides) return;

  for (const [path, value] of Object.entries(overrides)) {
    const def = BY_PATH.get(path);
    const site = def && resolve(path);
    if (!def || !site) continue; // knob removed since the save was written
    site.owner[site.key] = coerceTunable(def, value);
  }
}

/** Overrides that still differ from default, so the save stays sparse. */
export function pruneTuning(overrides: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [path, value] of Object.entries(overrides)) {
    const def = BY_PATH.get(path);
    if (!def) continue;
    const coerced = coerceTunable(def, value);
    if (coerced !== DEFAULTS[def.path]) out[path] = coerced;
  }
  return out;
}
