/**
 * Every tuning constant in the game lives here.
 *
 * Nothing else should hard-code a number that affects pacing. When the balance
 * harness (`npm run sim`) says the curve is wrong, this is the only file that
 * should need to change.
 */

/** The engine always steps in fixed 1s slices. See engine.ts for why. */
export const TICK_MS = 1000;

/**
 * Time compression. A game day is 20 real seconds, so a game week — the beat
 * that note payments land on — is 140 real seconds. A 24-week contract runs
 * ~56 real minutes, which is long enough to feel like an investment and short
 * enough that a player sees notes pay off in one sitting.
 */
export const MS_PER_GAME_DAY = 20_000;
export const MS_PER_GAME_WEEK = MS_PER_GAME_DAY * 7;

export const BALANCE = {
  startingCash: 3_000,
  eventLogSize: 60,
  /** Paid-off and defaulted notes kept for the ledger history tab. */
  closedNoteHistory: 30,

  /** Offline catch-up cap, extended by the night-manager upgrade. */
  offlineCapMs: 8 * 60 * 60 * 1000,
  offlineCapPerNightManagerMs: 4 * 60 * 60 * 1000,

  // ---------------------------------------------------------------- valuation
  /** Retail falls off with miles; never below this floor share of base value. */
  mileageFloor: 0.18,
  /** Miles at which value has decayed by 1/e. Larger = gentler depreciation. */
  mileageDecayScale: 220_000,
  /** A rough car is worth this share of an identical clean one. */
  conditionFloorFactor: 0.45,
  /** Wholesale (what you pay) as a share of retail (what you get). */
  wholesaleOfRetail: 0.74,
  /** Each prior repossession knocks this much off retail. */
  repoValuePenalty: 0.06,

  /**
   * Trim grades. See rarity.ts — the probabilities are the share of cars at each
   * grade above stock, and common is whatever is left over.
   *
   * `valueStep` is the whole economic content of the feature: each grade is
   * worth this much more of the car at retail, while the seller's ask is drawn
   * against stock trim, so the step lands entirely on the dealer's margin.
   * Weighted across the population it is a small lift at a curbstone lot and a
   * much larger one at a franchise, because the same ten points of value are
   * worth more where there was less margin to start with.
   */
  rarity: {
    rareChance: 0.09,
    epicChance: 0.009,
    legendaryChance: 0.001,
    valueStep: 0.1,
  },

  // ------------------------------------------------------------------ sourcing
  /** How many listings can sit on the feed at once (before upgrades). */
  baseListingSlots: 4,
  /** Cars already on the feed when a new game starts, so there is no dead open. */
  initialListings: 3,
  listingSlotsPerScoutLevel: 2,
  /** Mean gap between new listings appearing. */
  listingIntervalMs: 22_000,
  listingIntervalPerScoutLevel: 0.78,
  listingLifetimeMs: 150_000,

  // ------------------------------------------------------------------ the desk
  desk: {
    /**
     * How long a walk-up stands there before the sales staff moves in, and
     * therefore how long the player has to grab the deal and keep the whole
     * margin. The incentive for active play, in milliseconds.
     *
     * Prospect patience is 45s +/-30%, so at 20s the staff always has time
     * left to work with. Push this above ~30s in the admin console and the
     * slowest walk-ups will leave before the desk ever gets to them.
     */
    graceMs: 20_000,
  },
  // The seller ask band moved into `STAGES[].sourcing` in stages.ts when the
  // ladder landed, because a franchise buys at invoice and a used lot does not.
  // It is still the sharpest knob in the game; it just lives per stage now.
  /** Condition points of appraisal miss worth telling the player about. */
  appraisalSurpriseThreshold: 0.08,

  // --------------------------------------------------------------------- recon
  /** Sim ms to raise condition by a full 1.0 point. */
  reconMsPerPoint: 150_000,
  reconMsPerMechanicLevel: 0.7,
  /** Dollars to raise condition by a full 1.0 point, as a share of base value. */
  reconCostPerPoint: 0.36,
  /** One recon job lifts condition by at most this much. */
  reconMaxLift: 0.35,

  // --------------------------------------------------------------------- sales
  /** Prospect arrival rate per second for a car listed exactly at retail. */
  baseProspectRatePerSec: 1 / 110,
  ratePerAdvertisingLevel: 1.15,
  /** Price elasticity. Higher = buyers punish overpricing harder. */
  priceElasticity: 5.0,
  /** Prospects lose interest after this long. */
  prospectLifetimeMs: 45_000,
  /** Cars priced above this multiple of retail get essentially no traffic. */
  maxViablePriceRatio: 1.6,

  /** Default ask price when a car is listed, as a multiple of retail value. */
  defaultAskRatio: 1.0,

  // --------------------------------------------------------------- negotiation
  negotiation: {
    /** Share of shoppers who simply pay the asking price without haggling. */
    fullPriceChance: 0.12,
    /** Deepest opening discount off list, before aggression scaling. */
    maxOpeningDiscount: 0.2,
    /** Asking over market invites a harder lowball. */
    overpricingLowballFactor: 0.6,
    /** Cap on that effect, so an absurd ask does not produce an absurd offer. */
    maxOverpricingPush: 0.6,
    /** Chance a buyer names an un-round number, which is what makes the round
     *  ones read as deliberate rather than as engine output. */
    oddNumberChance: 0.15,

    /**
     * Where the hidden reservation price sits between their offer and your ask.
     * This is the master knob for how much haggling room the economy has.
     */
    roomMean: 0.46,
    roomSpread: 0.44,

    /**
     * Odds they accept a counter placed exactly at their reservation price.
     *
     * Halved from 0.55 in the tune-up that took the negotiation success rate
     * down by half. Read it as: being asked for the absolute most you would pay
     * is uncomfortable, and most people balk rather than shrug.
     *
     * This knob and `baseWalkChance` had to move together, and the reason is
     * worth knowing before either is touched again. The sales desk counters
     * once, so per haggle `P(walk) = (1 - acceptance) x walkChance` — an
     * accepted counter can never walk. At the old 0.55 acceptance, roughly half
     * of all counters were simply taken, which capped the achievable walk rate
     * near 49% even with `baseWalkChance` at 1.0 and no Closing protection.
     * Walk odds alone cannot move this metric past that ceiling.
     */
    acceptanceAtReservation: 0.2,
    /** How fast acceptance dies once you push past the reservation. */
    stretchDecay: 3.2,

    /**
     * Walk odds after a rejected counter.
     *
     * 0.9 rather than 1.0 deliberately. At 1.0 every rejected counter loses the
     * buyer outright for a level-1 closer, which kills the "they come back with
     * a better number" branch of `resolveCounter` entirely — haggle.test.ts
     * asserts all three outcomes stay reachable at base skill, and that test is
     * the design guard, not an inconvenience. At 0.9 the branch survives, and
     * Closing's `walkChanceMult` is what buys more of it.
     */
    baseWalkChance: 0.9,
    /** Added walk odds per unit of overreach beyond the reservation. */
    walkPerExcess: 0.6,
    /** Patience wears out across rounds. */
    walkPerRound: 0.1,

    /** Counters the player gets. On the last one they accept or walk. */
    maxPlayerCounters: 2,
    /** Time added to the buyer's clock per exchange, so haggling is not
     *  guillotined by the walk-up timer. */
    exchangeGraceMs: 30_000,

    /** Sales desk: where it counters, as a fraction of offer→ask. */
    deskCounterFraction: 0.55,
  },

  // ---------------------------------------------------------------- capacities
  // Base capacity per store is `STAGES[].baseCarCapacity`. What survives here is
  // only what each *upgrade level* adds, which does not vary by stage.

  // ---------------------------------------------------------------------- BHPH
  // The window markup is per stage (`STAGES[].bhphMultiplier`) — it falls as the
  // store moves upmarket, so there is no single house number any more.
  /** Contract length options, in game weeks. */
  termWeeks: [18, 24, 30, 36] as const,

  /**
   * Per-tier: down payment share, APR, per-payment miss chance, arrival weight.
   *
   * Miss chances are a uniform 1.2x on what they were, which puts the odds the
   * deal sheet quotes — "chance you take it back", averaged over the walk-in mix
   * and the four contract lengths — at ~30%, up from ~21.6%. Uniform on purpose:
   * scaling every tier by the same factor preserves the ladder's shape, and the
   * ladder is the credit model. On a 24-week contract that reads A 0% / B 4% /
   * C 25% / D 73%, against A 0% / B 2% / C 16% / D 54% before.
   *
   * Tune this against the deal sheet number, NOT against the harness's
   * `default rate` line. That line measures the automated underwriter's
   * selectivity as much as the paper's riskiness: the sales desk finances on
   * expected value, so raising risk makes it write safer paper, and the measured
   * rate saturates around 22-25% and then falls. At a 4x miss chance it reads
   * 12.2% — below where it started — because by then the desk will only touch
   * A-tier. Measured non-monotonicity in that metric is the automation reacting,
   * not the economy misbehaving.
   */
  creditTiers: {
    A: { downShare: 0.14, apr: 0.149, missChance: 0.036, weight: 0.14 },
    B: { downShare: 0.18, apr: 0.199, missChance: 0.096, weight: 0.26 },
    C: { downShare: 0.24, apr: 0.239, missChance: 0.192, weight: 0.34 },
    D: { downShare: 0.31, apr: 0.289, missChance: 0.324, weight: 0.26 },
  },

  /**
   * A borrower who is already behind is likelier to miss again. This is what
   * turns a single missed payment into a repo, and it is the main reason a
   * portfolio needs watching rather than just growing.
   */
  delinquencyMissMultiplier: 1.5,
  /** Default repo trigger. The player can move it; see `business` below. */
  repoAfterMissedPayments: 3,
  repoFee: 250,
  /** Condition lost when a car comes back on the hook, at the default trigger. */
  repoConditionLoss: 0.18,
  /**
   * How much worse a repo comes back per missed payment you let ride past the
   * default trigger — and how much better it comes back if you pull sooner.
   *
   * This is what makes the repo trigger a decision rather than a free lunch.
   * Left flat, a longer leash is strictly better: the borrower gets more chances
   * to cure, so expected collections rise and defaults fall, and a financed car
   * occupies no lot space while it is out. Damage that scales with patience puts
   * the cost where the real business puts it — the unit you finally recover has
   * been driven by someone who stopped paying for it two months ago.
   */
  repoConditionLossPerExtraMiss: 0.25,
  /** Floor on that multiplier, so a hair-trigger repo is not damage-free. */
  repoConditionLossFloor: 0.5,

  /**
   * Active notes the collections desk will carry. This is a hard limit: the
   * finance desk refuses to write past it.
   *
   * It used to be a soft one — you could write as much paper as you liked and
   * pay for it in delinquency — which meant the number on the HUD was a
   * suggestion, and the book ran ~3.5x over a fully-staffed desk by hour four.
   */
  baseCollectionsCapacity: 8,
  collectionsCapacityPerLevel: 7,
  /**
   * Miss chance multiplier applied per 100% over collections capacity.
   *
   * Still load-bearing even though the cap is hard now: a save written before
   * the cap, or one whose desk shrank, can sit over the line, and it should
   * degrade rather than break.
   *
   * Moving up a dealership made that the normal case rather than the legacy one.
   * The collections desk is staff, so it resets on a move, and a player carrying
   * a full book lands at the new store with capacity for eight. Uncapped that is
   * a 4.6x multiplier — the entire portfolio defaults inside a game month, which
   * turns a strategic decision into a trap.
   */
  overCapacityMissPenalty: 0.9,
  /**
   * Ceiling on that multiplier. A desk this buried is as buried as it gets; past
   * here the player is already rehiring as fast as they can and there is nothing
   * left for more punishment to teach.
   */
  overCapacityMissPenaltyCap: 2.2,

  // ------------------------------------------------------- business management
  /**
   * The house rules a player can set, and the range they can set them over.
   *
   * `defaults` is the invariant: every one of these reproduces what the game did
   * before the suite existed, so a fresh save and a migrated one behave the same
   * and the only thing this feature changes on its own is what the player can
   * now choose to change.
   */
  business: {
    defaults: {
      minWorkingCapital: 500,
      repoAfterMissedPayments: 3,
      minBuyMargin: 0,
    },
    /** Offered as a choice rather than a slider: these are decisions, not dials. */
    workingCapitalChoices: [0, 500, 2_500, 10_000, 50_000],
    repoTriggerMin: 1,
    repoTriggerMax: 6,
    buyMarginChoices: [0, 0.05, 0.1, 0.2],
  },

  /**
   * Running the place. Charged every game week, whether or not a car sells.
   *
   * The game had no recurring costs at all until this landed, which is why a
   * franchise was pure upside the moment its entry cost cleared and why
   * accumulation was close to linear. A sink changes the *rate* rather than the
   * target, so it slows the curve without making any single number bigger, and
   * it gives three things that already existed a reason to matter: the working
   * capital floor, a lot full of unsold stock, and the size of the payroll.
   *
   * Rent is per stage and lives in `STAGES[].rentPerWeek` — it is meaningless
   * apart from the store it is charged for.
   */
  expenses: {
    /**
     * Weekly wage for one level of a staff upgrade, as a share of what that
     * level cost to buy — so an expensive hire is expensive to keep, and a
     * sales manager is not billed at the same rate as a lot mechanic.
     *
     * Derived rather than tabulated on purpose: a new staff line on the upgrade
     * table gets a sensible wage for free, and it cannot drift out of step with
     * the hire's price the way a second column would.
     */
    wageOfCost: 0.012,
    /**
     * Weekly interest on the money tied up in unsold inventory, as a share of
     * cost basis. This is floorplan financing, and it is what makes a lot full
     * of cars nobody wants an actively bad place to be rather than a neutral
     * one.
     */
    floorplanWeeklyRate: 0.004,
    /**
     * Weeks of running costs automation always holds back, on top of whatever
     * floor the player set in the business suite.
     *
     * This is what stops recurring costs being a cliff instead of a dial. Cash
     * at zero is an ABSORBING state: no cash buys no inventory, no inventory
     * earns nothing, and the bill still arrives — so a business that spends its
     * last dollar on stock never recovers. Measured before this existed, light
     * expenses killed 12 of 16 harness seeds outright while the surviving 4 ran
     * at the old pace: a bimodal result, which is the signature of a spiral
     * rather than a tax.
     *
     * Holding a few weeks back turns that into what it should be — an operation
     * that keeps enough float to make rent, and buys with what is left.
     */
    reserveWeeks: 3,
    /** Cars you must be able to buy at the new store before the move is allowed. */
    /**
     * Cars you must be able to buy at the new store before the move is allowed.
     *
     * Six. Raising it to twelve was measured and made everything worse — it
     * gated every rung harder without saving the top one, which dies for a
     * different reason (see the note on the premium franchise in CLAUDE.md).
     */
    reopeningCars: 6,
  },

  // ---------------------------------------------------------------- promotions
  /**
   * Temporary boosts the business runs under. See `src/sim/promotions.ts` for
   * the table; these are the dials.
   *
   * One promotion so far, and it starts itself: every new business opens with a
   * grand opening. It exists because the first twenty minutes of a run are the
   * thinnest part of the game — one car on the lot, one buyer every couple of
   * minutes — and a doubled arrival rate turns that into something with a pulse
   * without touching a single number the rest of the economy is balanced on.
   *
   * A promotion multiplies the ARRIVAL RATE and nothing else. It does not make
   * an overpriced car sell: `prospectRate` still returns zero above
   * `maxViablePriceRatio`, and twice nothing is nothing.
   *
   * Changing `durationMs` only affects promotions that start after the change —
   * a running one already stamped its end time onto the save, the same way
   * `nextBillAt` is stamped rather than recomputed.
   */
  promotions: {
    grandOpening: {
      /** Multiplier on walk-up traffic while it runs. */
      trafficMultiplier: 2,
      /** How long it runs, in sim ms. ~8.5 game weeks. */
      durationMs: 20 * 60 * 1000,
    },
  },

  // ---------------------------------------------------------------- retirement
  /**
   * Selling the whole operation and starting over. `src/sim/prestige.ts` does
   * the arithmetic; these are the dials.
   *
   * Points are LINEAR in the money retired — one point per `pointDollars` of
   * net sale — on purpose. Value grows roughly 10x per rung while time grows
   * roughly 3x, so a linear award makes the deep run the way to earn and the
   * early retirement worth almost nothing, which is exactly the split wanted:
   * bailing out of a dead run is an escape hatch, and the reset IS the reward.
   */
  prestige: {
    /** What a note buyer pays for the book, as a share of outstanding principal. */
    notesSaleRate: 0.7,
    /** One retirement point per this many dollars of net sale value. */
    pointDollars: 1_000_000,
    /** Buy-side edge per point: every ask is this much cheaper, used or invoice. */
    edgePerPoint: 0.002,
    /** The edge never exceeds this, however long the career. */
    edgeCap: 0.15,
  },

  /**
   * The shark. One loan at a time, sized in cars — the unit that matters — but
   * never presented that way: the UI shows a dollar figure, take it or leave it.
   *
   * The APR is predatory because the lender knows exactly how stuck you are,
   * and its weekly payment is the one charge in the game allowed to drive the
   * balance negative. That is the whole trade: real liquidity now, a hole that
   * digs itself if the recovery does not come, and retirement as the only
   * guaranteed way out.
   */
  loan: {
    carsOffered: 4,
    apr: 0.32,
    termWeeks: 24,
  },

  // -------------------------------------------------------------- progression
  // Entry costs, staff cost multipliers, per-stage capacities and per-stage
  // sourcing all live in the STAGES table in stages.ts, following the precedent
  // upgrades.ts sets for a definition table that carries its own costs. They are
  // meaningless apart from the stage they belong to, and splitting them across
  // two files would mean every tuning pass had to edit both.

  /**
   * What the wholesaler pays when a car has to be sold RIGHT NOW, as a share of
   * its true wholesale value.
   *
   * Two things force a sale and both are the same trade, which is why they share
   * one number rather than two that would always be set alike:
   *
   *   - CHANGING STORES clears the lot. The wholesaler knows you have already
   *     signed for the next store and there is nobody else to sell twelve cars
   *     to this afternoon.
   *   - A REPOSSESSION LANDING ON A FULL LOT goes straight from the tow truck to
   *     the auction, because there is physically nowhere to put it.
   *
   * Under 1 on purpose. At 1 a stage move would be a free way to convert stock
   * to cash at book value, and a full lot would stop costing anything at all.
   *
   * It does NOT vary by stage: the haircut is the buyer's leverage over somebody
   * with no choice, which is the same whether the car is a beater or a Valmont.
   *
   * The player loses more than this number says — the retail spread they were
   * holding the car for, and any recon already paid, go with it.
   */
  forcedSaleRate: 0.8,

  // -------------------------------------------------------------------- skills
  /**
   * Player proficiencies: Buying, Closing, Wrenching.
   *
   * Every effect is declared as its value at level 1 and at max level, with an
   * easing exponent applied to normalized progress. `ease < 1` front-loads the
   * gain so the first levels are the ones a player feels.
   *
   * INVARIANT: every `at1` equals the constant the game used before skills
   * existed, so a level-1 save behaves exactly like the pre-skills build. There
   * is a test for it (skills.test.ts) and it is what makes it safe to land the
   * substrate ahead of the effects that read it.
   *
   * Every `atMax` currently equals its `at1`, so the curves are flat and levels
   * buy nothing yet. That is deliberate: the substrate ships provably inert, and
   * each later phase turns one skill on by editing these numbers and wiring the
   * accessor that already exists. Target values live in docs/skills-plan.md and
   * are not committed here until the harness has argued with them.
   */
  skills: {
    /**
     * Fifty levels, not ten.
     *
     * THE CAP AND THE XP CURVE ARE ONE SETTING AND MUST MOVE TOGETHER. At the
     * old growth of 1.55 the fiftieth level costs on the order of 10^11 XP —
     * raising the cap alone would not lengthen the ladder, it would saw the top
     * forty rungs off it and leave every effect curve stretched over levels
     * nobody can reach. So the growth came down with it.
     *
     * What the retune preserves is the total: `effect()` still interpolates
     * `at1` → `atMax` across the whole range, so a maxed skill is worth exactly
     * what it was worth before. What changes is the shape of getting there —
     * many small levels instead of ten large ones, spread across a career
     * rather than an afternoon. A 4h run used to finish maxed; it now lands
     * somewhere in the high twenties, which is the runway this exists to buy.
     */
    maxLevel: 50,
    /**
     * XP to go from level 1 to 2; each level costs `xpGrowth` times the last.
     *
     * 60 × 1.12^(n-1). Cumulative: ~290 to level 5, ~890 to level 10, ~12.9k to
     * level 30, ~128k to level 50. Against the old curve (100 × 1.55^(n-1),
     * ~9.2k to level 10) the first ten levels are an order of magnitude cheaper
     * and the last twenty are where the time goes — which is the point. The
     * early game should be handing out level-ups, and the cap should be a thing
     * you approach over the whole ladder.
     */
    xpBase: 60,
    xpGrowth: 1.12,

    /**
     * XP awards. Money-driven grants scale with a square root so one expensive
     * car cannot leapfrog a skill, and recon pays per condition point so beaters
     * train the shop just as well as clean cars do.
     */
    xp: {
      buyPerCar: 12,
      buyPriceRef: 1_500,
      sellPerDeal: 10,
      sellPriceRef: 2_500,
      /** Closing a deal you actually haggled for teaches more than taking list. */
      sellCounterBonus: 6,
      /** You learn from the ones who walk, too. */
      sellWalkaway: 4,
      repairPerPoint: 55, // Shop work is rarer than buying or selling; this keeps Wrenching roughly in step.
    },

    /**
     * Buying. The one skill whose level 1 is deliberately NOT the old game:
     * before this, the feed printed exact condition and exact spread, and
     * "should I buy this" was a comparison rather than a decision.
     *
     * σ = 0.18 moves `conditionFactor` by about 0.10, which on a typical car is
     * ~13% of retail — several hundred dollars against a spread of similar
     * size. Enough to make the call real, not enough to make it a coin flip.
     *
     * Buying carries NO throughput at all, which is a deliberate departure from
     * the original brief of "locate more cars as you level".
     *
     * Both throughput levers were built, measured and switched off, because
     * this economy compounds throughput exponentially over four hours: the
     * interval term measured +15% end cash on its own, and a single extra feed
     * slot measured +21%. Against a late game already flagged as running hot,
     * that is a great deal of money for a small perk. `scout` is how a player
     * buys feed throughput, with cash, at a price.
     *
     * The machinery for both is intact and tested — raising either atMax turns
     * it back on — so this is a balance call, not a missing feature.
     */
    buy: {
      /** 1σ of appraisal error, in condition points. */
      appraisalSigma: { at1: 0.18, atMax: 0.03, ease: 0.7 },
      listingInterval: { at1: 1, atMax: 1, ease: 0.7 },
      listingSlots: { at1: 0, atMax: 0, ease: 0.7 },
    },
    /**
     * Closing. Shipped at the full planned strength, because measurement says
     * it costs nothing: across 64 seeds every setting from timid to strong
     * landed within ±3% on lifetime profit, which is inside the noise.
     *
     * The reason is structural, and it is worth knowing before anyone "fixes"
     * it. The sales desk counters exactly once and takes whatever comes back,
     * so it cannot exploit a better negotiator; and two of these five effects
     * are invisible to the harness by construction — a bot never reads a tell,
     * and never uses a third counter it does not ask for. Closing is a skill
     * that pays out almost entirely to someone playing by hand, which is the
     * intent. The corollary is that the harness cannot bound its upside for a
     * player who does use all three counters. Watch that in playtest, not here.
     */
    sell: {
      tellJitter: { at1: 0.3, atMax: 0.05, ease: 0.7 },
      walkChanceMult: { at1: 1, atMax: 0.6, ease: 0.7 },
      roomMean: { at1: 0.46, atMax: 0.52, ease: 0.7 },
      deskCounterFrac: { at1: 0.55, atMax: 0.72, ease: 0.7 },
      /**
       * Level at which the player gets a third counter. 0 disables it.
       *
       * Set by XP rather than by proportion, which is why it is 15 of 50 and
       * not 30. It was 6 of 10, which cost ~1,445 XP; level 15 on the new curve
       * costs ~1,940, so the perk still arrives at roughly the point in a run
       * it always did. Holding the *fraction* instead would have pushed it to
       * ~10k XP and quietly deferred the best thing Closing does by hours.
       */
      extraCounterAt: 15,
    },
    /**
     * Wrenching. Caps deliberately well short of what the shop could bear.
     *
     * Raised in phase 5. The original caps were held low pending the ambiguity
     * acting as a deflationary counterweight — it does not; see the appraisal
     * note above. With that reasoning void, these were re-argued on their own
     * merits: at 0.92/0.82/0.40 the skill was barely perceptible (cost -8%,
     * speed -18%) which is a poor thing to make a player level for.
     *
     * At 64 seeds all three skills together now land +24% end cash and +13%
     * lifetime profit against the pre-skills build. The next step up
     * (0.85/0.72/0.45) measured +31% and was declined: the late game was
     * already flagged as hot, and that call needs a human playing it rather
     * than another sweep.
     *
     * Two things the harness genuinely cannot answer, so do not re-derive them
     * from it: it separates the mild band from the strong band and nothing
     * finer — end-cash medians swing ±12 points between settings that are
     * within 0.5% of each other at the levels a 4h run actually reaches — and
     * it cannot tell the easings apart at all. `ease: 0.7` front-loads the gain
     * on feel alone: the first few levels are the ones a player is present for.
     */
    repair: {
      costMult: { at1: 1, atMax: 0.88, ease: 0.7 },
      speedMult: { at1: 1, atMax: 0.76, ease: 0.7 },
      maxLift: { at1: 0.35, atMax: 0.43, ease: 0.7 },
    },
  },
} as const;

export type BalanceConfig = typeof BALANCE;
