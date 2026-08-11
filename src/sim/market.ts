import { BALANCE } from './balance';
import { pickWeighted } from './rng';
import type { GameState, ListingOrigin, RngState } from './types';

/**
 * HOW FAR YOU BUY FROM.
 *
 * The problem this exists to solve, measured before it was built: the lot
 * plateaued at about 23 cars at every store above the small lot, whatever the
 * capacity, because the feed is a fixed number of listings per minute and the
 * lot is not. A Valmont store with sixty stalls ran 40% full and the feed had
 * nothing worth buying on it 94% of the time. Paving another row bought
 * literally nothing. Cash was never the constraint up there — 0-6% of turns.
 *
 * The fix is the one a real dealer principal reaches for. A curbstoner buys what
 * is within driving distance. A franchise group buys nationally, and pays to
 * have it trucked in.
 *
 *   LOCAL      What you can go and look at. Trade-in walk-ups, the local auction,
 *              a driveway across town. No freight — you drove it home.
 *   REGIONAL   Auctions a few states over and trades with other dealers. More
 *              cars than one catchment can produce, on a transporter.
 *   NATIONAL   A wholesale supplier who moves volume anywhere. Effectively
 *              unlimited stock, and the longest haul to pay for.
 *
 * TWO RULES CARRY THE WHOLE DESIGN AND ONLY MEAN ANYTHING TOGETHER:
 *
 *  - **Reach only ever ADDS supply.** Local listings keep arriving at exactly
 *    the rate they always did; each tier stacks its own share on top. So buying
 *    reach can never make a store worse off, and there is no "wrong" moment to
 *    buy it. Modelling it as a multiplier on the whole feed instead would have
 *    put freight on cars you would have found in your own town, which is both
 *    wrong and a trap.
 *  - **Freight is charged per listing, on the ones that travelled.** It lands in
 *    the car's cost basis, so it is real money against a real margin and every
 *    downstream number — floorplan, profit, the buyer's ceiling — sees it
 *    without being told about it separately.
 *
 * FREIGHT IS A FLAT BILL PER CAR, not a share of the price, and that is load
 * bearing rather than cosmetic. A transporter charges by the mile and the slot,
 * not by what is standing on it — and modelling it proportionally was measured
 * and does not work. At 7.5% of the ask, national freight is most of a
 * franchise's entire 9% margin, so the retainer buyer filled a Valmont lot with
 * cars carrying about two points of margin, floorplan ate that, and the business
 * went from a $56M profit to a $145M loss with a full lot the whole way down.
 *
 * Flat dollars invert that curve the way the real cost does: the same $1,000
 * haul is a third of the margin on a $10,000 big-lot car and a seventh of it on
 * an $86,000 Valmont. Reach gets BETTER as you climb, which is exactly where the
 * empty lot it exists to fix actually hurts. A flat number would be wrong across
 * the whole ladder, but this is only ever sold from the large lot up, so the
 * span it has to cover is $10,000 to $86,000 and not $3,000 to $86,000.
 */

export interface MarketTier {
  origin: ListingOrigin;
  /** Shown on the listing and on the upgrade card. */
  name: string;
  /**
   * Listings per minute this tier contributes, as a share of the base feed
   * rate. Local is 1 by definition; the others stack on top.
   */
  supplyShare: number;
  /**
   * What the transporter costs to bring one car here, in dollars, flat.
   * See the note above on why this is not a percentage.
   */
  freight: number;
  /** Extra standing slots on the feed, so the added throughput has somewhere to sit. */
  slots: number;
  /** Where a car from here says it came from. */
  sources: readonly string[];
  /** Suffix on a franchise feed, which names the make rather than the market. */
  allocation: string;
}

export const MARKET_TIERS: readonly MarketTier[] = [
  {
    origin: 'local',
    name: 'Local',
    supplyShare: 1,
    freight: 0,
    slots: 0,
    sources: [
      'Craigslist',
      'Dealer auction',
      'Estate sale',
      'Trade-in walk-up',
      'Repo auction',
      'Marketplace',
      'Tow yard lien',
    ],
    allocation: 'allocation',
  },
  {
    origin: 'regional',
    name: 'Regional',
    supplyShare: 0.9,
    freight: 450,
    slots: 3,
    sources: [
      'Regional auction',
      'Dealer trade',
      'Two states over',
      'Fleet return',
      'Lease turn-in block',
    ],
    allocation: 'regional allocation',
  },
  {
    origin: 'national',
    name: 'National',
    supplyShare: 1.6,
    freight: 1_000,
    slots: 5,
    sources: [
      'National wholesaler',
      'Rental fleet buyout',
      'Off-lease, coast to coast',
      'Volume supplier',
      'Bulk consignment',
    ],
    allocation: 'national allocation',
  },
];

/**
 * How far this business currently buys. Level 0 is local only, and every save
 * that has never bought the upgrade sits there.
 */
export function reachLevel(state: Pick<GameState, 'upgrades'>): number {
  // Read straight off the record rather than through `level()` in upgrades.ts,
  // which imports this module for the upgrade card's copy. A cycle here would
  // resolve at call time and work, right up until somebody moved a constant to
  // module scope; not having one is cheaper than remembering why it is safe.
  return Math.min(MARKET_TIERS.length - 1, state.upgrades.reach ?? 0);
}

/** The tiers currently open to this business, local first. */
export function marketTiers(state: Pick<GameState, 'upgrades'>): readonly MarketTier[] {
  return MARKET_TIERS.slice(0, reachLevel(state) + 1);
}

export function getMarketTier(origin: ListingOrigin): MarketTier {
  return MARKET_TIERS.find((t) => t.origin === origin) ?? MARKET_TIERS[0];
}

/**
 * Total feed throughput, as a multiple of the base rate.
 *
 * Exactly 1 at local, which is what makes this feature inert until it is bought
 * — including for the RNG stream, see `drawOrigin`.
 */
export function supplyMultiplier(state: Pick<GameState, 'upgrades'>): number {
  // Local is 1 and is NOT scaled: it is the feed that existed before this
  // feature and must stay exactly itself, so `supplyScale=0` reproduces the old
  // build on an identical stream rather than turning the feed off.
  let total = 1;
  for (const tier of marketTiers(state)) {
    if (tier.origin === 'local') continue;
    total += tier.supplyShare * BALANCE.market.supplyScale;
  }
  return total;
}

/** This tier's weight in the mix of what turns up. Local is always 1. */
function originWeight(tier: MarketTier): number {
  return tier.origin === 'local' ? 1 : tier.supplyShare * BALANCE.market.supplyScale;
}

/** Extra standing listing slots the open tiers pay for. */
export function extraSlots(state: Pick<GameState, 'upgrades'>): number {
  let total = 0;
  for (const tier of marketTiers(state)) total += tier.slots;
  return total;
}

/**
 * Which market this listing came out of.
 *
 * CONSUMES NO RNG DRAW AT LOCAL, which is not an optimisation — it is what lets
 * a save that never buys reach replay byte-identically against the build before
 * this existed, and what makes `--set=balance.market.supplyScale=0` a true A/B
 * on an identical stream rather than a reshuffle. Weighted by supply share, so
 * a tier that contributes a third of the cars is the source of a third of them.
 */
export function drawOrigin(rng: RngState, state: Pick<GameState, 'upgrades'>): ListingOrigin {
  const tiers = marketTiers(state);
  if (tiers.length === 1) return 'local';
  return pickWeighted(
    rng,
    tiers.map((t) => t.origin),
    tiers.map(originWeight),
  );
}

/**
 * What it costs to get a car here from `origin`, in dollars.
 *
 * Takes the price only so a haul can never cost more than the car — a $900
 * beater on a $1,000 transporter is nobody's business decision, and without the
 * cap the national tier would put negative-value cars on the feed.
 */
export function freightCost(origin: ListingOrigin, price: number): number {
  const bill = getMarketTier(origin).freight * BALANCE.market.freightScale;
  return Math.round(Math.min(bill, price * 0.5));
}

/**
 * WHAT THE CAR ACTUALLY COSTS YOU. The ask plus the truck.
 *
 * Every gate, ceiling and cost basis in the game is denominated in this rather
 * than in `price`, because a $40,000 car with $3,000 of freight on it is a
 * $43,000 car — and a buyer that compares the ask against its margin rule while
 * paying the landed cost is the same class of bug as the retainer buyer that
 * gated on wholesale at a store pricing in retail.
 */
export function landedCost(listing: { price: number; freight: number }): number {
  return listing.price + listing.freight;
}
