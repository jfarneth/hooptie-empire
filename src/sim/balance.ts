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
  /**
   * Closed trading weeks kept for the trend readout.
   *
   * Twelve, to show eight. The spare four are so the chart is already full the
   * first time a player opens it after a long absence rather than growing in
   * front of them, and so a week can be dropped from the view without being
   * dropped from the save.
   */
  weekHistory: 12,

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

  /**
   * How far the business buys from. See market.ts for the tier table and the
   * argument; these are the two dials that scale the whole feature.
   *
   * Both exist so the feature can be A/B'd against itself on an identical RNG
   * stream — `--set=balance.market.supplyScale=0` leaves only the local tier
   * contributing and reproduces the build before this landed.
   */
  market: {
    /** Scales every tier's contribution to feed throughput. */
    supplyScale: 1,
    /** Scales every tier's freight bill. At 0, distance is free. */
    freightScale: 1,
  },

  // ------------------------------------------------------------------ the desk
  desk: {
    /**
     * How long a walk-up stands there before the sales staff moves in, and
     * therefore how long the player has to grab the deal and keep the whole
     * margin. The incentive for active play, in milliseconds.
     *
     * MUST STAY UNDER PATIENCE. Prospect patience is a flat 45s (no jitter —
     * every customer runs the identical clock), and `stepProspects` sweeps the
     * expired before the desk acts, so a window at or past 45s does not move
     * who closes the deal, it deletes the deal. At 30s the desk gets its shot
     * with a comfortable margin and resolves the whole haggle inside one tick.
     *
     * Raised from 20s: half a minute is a realistic amount of time to notice a
     * buyer, open the sheet and work the slider, where 20s rewarded reflexes
     * over judgement. The offline brake is unaffected — nobody taps while the
     * app is closed, so every unattended sale still pays the staff cut whatever
     * this is set to.
     */
    graceMs: 30_000,
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
     * WHERE THE COLOUR ON A BUYER CHANGES, as a share of your asking price.
     *
     * The lot draws the shopper in red, amber or green so a full lot can be
     * read at a glance instead of by opening thirty deal sheets. These are the
     * two thresholds, and they are set against MEASURED offers rather than
     * picked round: with cars listed at retail the opening offer runs 0.80 to
     * 1.00 of the ask with a median of 0.895, and 11% of buyers simply pay the
     * sticker. At 0.87 and 0.93 that splits about 33 / 47 / 20, so amber is the
     * ordinary case — which is the right shape for a glance signal, because a
     * colour that is always green teaches nobody anything.
     *
     * They are a READ, not a rule: nothing in the sim consults them, and a
     * buyer's colour changes nothing about what they will pay. Overpricing a
     * car pushes its offers down the scale honestly, because the lowball
     * factor is already denominated in the same ratio.
     */
    offerRead: {
      /** At or above this share of the ask, the buyer is as good as it gets. */
      strong: 0.93,
      /** Below this, it is a lowball. Between the two is an ordinary offer. */
      fair: 0.87,
    },

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

    /**
     * FINANCING IS A NEGOTIATION NOW, and this is its whole model.
     *
     * A financed buyer is not buying a car, they are buying a weekly payment.
     * Every walk-up carries a hidden ceiling on what they can carry — drawn as a
     * multiple of the payment their own terms imply — and pushing the payment
     * toward it raises what the contract collects. Past it they are priced out.
     *
     * Mirrors the cash haggle deliberately: the same "being asked for exactly
     * your maximum is uncomfortable" shape, so a player who has learned to read
     * one is not starting again on the other.
     */
    payment: {
      /** Hidden ceiling on what they can carry, as a multiple of their own payment. */
      ceilingMean: 1.22,
      ceilingSpread: 0.16,
      /** Odds they sign at exactly their ceiling. */
      acceptanceAtCeiling: 0.35,
      /** How fast acceptance dies past it. */
      stretchDecay: 4.5,
      /** Odds a priced-out buyer walks rather than falling back to the cash deal. */
      walkChance: 0.55,
    },
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
  /**
   * Floor on the recovery fee. The real charge is a share of the car — see
   * `repoFeeOfValue` — and this is what a very cheap one costs regardless.
   */
  repoFee: 250,
  /**
   * Recovery fee as a share of the car's condition-free value.
   *
   * 3%, which lands within $40 of the old flat fee at the small lot (where most
   * repossessions actually happen) and scales honestly from there. It is charged
   * in cash AND added to the recovered car's cost basis, the same way recon
   * spend is: you paid for it, and the cost belongs to that unit.
   */
  repoFeeOfValue: 0.03,
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

  // ------------------------------------------------------ service contracts
  /**
   * The plan desk. A note in reverse: paid for once, owed for months.
   *
   * THE WHOLE PRODUCT IS THE LOSS RATIO. A plan is priced at its expected claims
   * divided by `targetLossRatio`, so the 35% margin is a property of the
   * derivation rather than a number asserted somewhere and hoped for. Move
   * `targetLossRatio` and the price moves; the payouts do not, because they are
   * a fact about the car.
   *
   * `attachRate` is the A/B constant. At 0 the attach roll is skipped before it
   * draws, so `--set=balance.service.attachRate=0` reproduces the pre-plan build
   * on a byte-identical RNG stream — the same trick `market.supplyScale` uses.
   */
  service: {
    /** Share of buyers who take a plan at the standard price band. */
    attachRate: 0.2,
    /**
     * Share of the plan price the house actually pays back out in claims,
     * MEASURED over the life of a contract. 35% margin, which is what was asked
     * for.
     *
     * This is the realised figure, not the one the arithmetic would give you if
     * the cap did not exist — see `capRecovery`, which is what reconciles the
     * two. The distinction is not pedantry: a constant named for a target the
     * game misses by ten points is exactly the kind of number that gets quoted
     * in a comment for a year and is wrong the whole time.
     */
    targetLossRatio: 0.65,
    /**
     * Share of expected claim dollars that survives the 150% cap.
     *
     * MEASURED, and it has to be, because there is no closed form: whether a
     * plan hits its cap depends on the whole path of its claims. At the shipped
     * shape the cap eats about a quarter of contracts and 26% of expected
     * claim dollars, and pricing that ignored it would overcharge for cover by
     * a third.
     *
     * `service.test.ts` measures the realised loss ratio against
     * `targetLossRatio` and goes red if this drifts — which it will the moment
     * anybody touches the claim shape or the cap, and that alarm is the entire
     * reason this is a named constant rather than a rounder number quietly
     * baked into the price.
     */
    capRecovery: 0.74,
    /**
     * What a claim costs when your own bays do the work.
     *
     * Measured to land the realised loss ratio at 50% — fifteen POINTS better
     * than 65%, which is the reading that agrees with "makes service plan
     * profit average 50%". Read as: your own shop honours the paper at cost
     * where an independent garage charges you retail to do it.
     */
    shopClaimMultiplier: 0.63,
    /**
     * The loss ratio that multiplier actually DELIVERS, measured.
     *
     * 0.65 x 0.63 is 0.41, and that is not the answer — smaller claims run into
     * the cap less often, so cutting the cost of a claim by a third improves the
     * realised ratio by rather less than a third. Every readout quotes THIS
     * number, because a panel that multiplied the lever would have told the
     * player the house keeps 59% of a plan when it keeps 50%.
     *
     * Held honest the same way `capRecovery` is: service.test.ts measures whole
     * contracts against it, so moving the multiplier without re-measuring goes
     * red rather than quietly making the UI lie.
     */
    shopLossRatio: 0.5,
    /**
     * Hard ceiling on what one plan can cost, as a multiple of what it sold for.
     *
     * Never advertised and never shown: the plan is sold as cover, and a
     * customer does not get told the house stops paying. What it protects is the
     * tail — without it a single transmission on a legendary-trim truck can cost
     * more than a week of trading, which is not variance, it is a crash.
     */
    payoutCap: 1.5,
    /** Odds a claim lands in any given game week of cover. */
    claimChancePerWeek: 0.05,
    /**
     * What the average claim costs, as a share of the car's condition-free
     * value, per unit of condition risk.
     *
     * Indexed to `conditionFreeValue` for the reason recon cost is — bodywork on
     * a 200,000-mile beater does not cost what bodywork on a new car costs, and
     * a plan that priced off the model's showroom value would be unsellable at
     * the bottom of the ladder and free money at the top.
     */
    claimCostOfValue: 0.03,
    /** Claim risk multiplier on a showroom car, and on a rough one. */
    riskAtClean: 0.6,
    riskAtRough: 2.2,
    /**
     * Shape of a single claim, as a multiple of the average one: `min + k·u³`.
     *
     * Cubed on purpose. Most repair orders are small and the mean is carried by
     * the rare one that is not, so the typical claim comes in around half the
     * average and the top of the range is 3.5x it — a single bill bigger than
     * the whole plan. A uniform draw has the right mean and the wrong feel, and
     * the feel is the product: this is the thing that is supposed to have high
     * variability.
     */
    claimShapeMin: 0.15,
    claimShapeSpan: 3.4,
    /**
     * How hard the attach rate reacts to the price band.
     *
     * 2.9 is not a taste: it is `1/(1 - targetLossRatio)`, which puts the peak of
     * `attach x (band - lossRatio)` exactly on the standard band. So pricing at
     * the middle is the best expected dollars per car sold, and both ends trade
     * volume against margin around it. It moves when the shop opens — at a 0.5
     * loss ratio the optimum slides down to the cheap bands, so owning a service
     * department makes it correct to sell plans cheaper and sell more of them.
     */
    attachElasticity: 2.9,
    /** Nobody sells a plan to everybody, whatever the price. */
    maxAttachRate: 0.6,
    /** Closed plans kept for the sheet's history, same rule as closed notes. */
    closedPlanHistory: 30,
  },

  // ----------------------------------------------------- service department
  /**
   * The shop. Bays, technicians, and a labour rate the player sets.
   *
   * It is deliberately A SIDELINE — measured at 15-18% of a franchise store's
   * weekly gross when fully built — because it lands on the three rungs the
   * ladder is most fragile at. See docs/service-plan.md for the sizing, and note
   * that `demandScale` is the A/B constant: at 0 no customer ever arrives and
   * not one draw is consumed.
   */
  shop: {
    /** Scales every store's walk-in service demand. The A/B knob. */
    demandScale: 1,
    /**
     * How much demand moves when the rate does.
     *
     * The decision this creates only exists because capacity is finite: under-
     * price a small shop and the bays fill with work you cannot get to, so the
     * revenue is capped at what the benches can turn while the rate is low.
     * Overprice a big one and the techs sit idle on full wages. The right rate
     * is therefore a function of how many bays you have staffed, and it moves
     * every time you hire.
     */
    rateElasticity: 1.2,
    /** Labour hours on a repair order: `min + span·u²`, so most are small. */
    jobHoursMin: 0.6,
    jobHoursSpan: 5.5,
    /** Sim ms one labour hour takes an entry-level tech. A game day is 8 of them. */
    msPerLabourHour: 2_500,
    /** Repair orders that can wait for a bench, per bay. Past this they go elsewhere. */
    queuePerBay: 2,
    /** A comeback takes this share of the original job, and bills nothing. */
    reworkDuration: 0.6,
    /**
     * A tech's weekly wage: billable hours at the store's own reference rate,
     * times this.
     *
     * Derived from the shop's rate rather than tabulated, the same way
     * `wageOfCost` derives a hire's wage from its price — a store that bills
     * $160 an hour pays its people more than one that bills $72, and neither
     * figure can drift out of step with the other.
     */
    wageShareOfBillings: 0.42,
    /** Billable hours a week a wage is quoted against. */
    wageHoursPerWeek: 50,
    /** Signing on costs this many weeks of the wage. Promotion, by contrast, is free. */
    hireWeeks: 4,
    /** Labour hours a tech has to turn to earn each grade. Cumulative. */
    promoteAtHours: [0, 80, 300, 800, 1_800],
    /** Recon speed and cost per bay, compounding. The shop works on your own stock too. */
    reconSpeedPerBay: 0.95,
    reconCostPerBay: 0.97,
  },

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
      // Both sales rules open at level 0 — take any offer, take their payment —
      // which is exactly what the desk did before either existed.
      offerFloorLevel: 0,
      paymentPushLevel: 0,
      // Filled in by `businessDefaults()`, which derives it from
      // `wholesaleOfRetail` so that the shipped default IS cash retail however
      // that constant is later retuned. The literal here is only a fallback for
      // a caller that reads the table directly.
      listMarkup: 0.351,
      // The plan desk opens at the standard band and the shop at the middle
      // rate. Unlike the sales floors, these two do NOT default to off: a store
      // that offers service contracts and sells none is not reproducing an
      // earlier build, it is a feature nobody found. The A/B constants above are
      // what reproduce the earlier build.
      servicePlanBand: 3,
      shopRateLevel: 3,
    },
    repoTriggerMin: 1,
    repoTriggerMax: 6,

    /**
     * WHAT THE DESK WILL TAKE ON A CASH DEAL, as a share of your own asking
     * price.
     *
     * This replaced a six-number margin ladder PER STORE, and the replacement is
     * a simplification the old design could not reach. A margin is not
     * comparable across a thousandfold ladder — 15% is a bad day at a curbstone
     * and an impossibility at a Valmont store — which is why those tables had to
     * be hand-tabulated, retuned twice, and guarded by a mutation-tested suite
     * and a harness column. A share of your OWN ask is scale-free: 87% of the
     * sticker means the same thing at every rung, because the sticker already
     * carries the store's scale.
     *
     * The stops are the bands `readOffer` already paints on the lot, so the
     * colour that made you walk over and the rule the manager runs under are the
     * same scale. Level 0 is the absence of a floor.
     *
     * NOTHING HERE GUARDS MARGIN, deliberately. Price the lot cheap, set the
     * tolerance wide, and the desk will sell under cost — which is a real way to
     * clear stock and is now sayable.
     */
    offerFloors: [0.8, 0.87, 0.93, 0.97, 1] as const,
    /**
     * How hard the desk pushes a financed buyer, as a multiple of the payment
     * they walked in able to make.
     *
     * The same shape as the slider on the deal card, because it is the same
     * decision: the customer is buying a weekly payment and you are selling
     * total collected. Push too far past what they can carry and they are priced
     * out and leave. Level 0 is "take their number", which is what the desk did
     * before any of this existed.
     */
    paymentPushes: [1.05, 1.1, 1.15, 1.2, 1.3] as const,

    /**
     * How far below cost the BUYER's slider reaches.
     *
     * The buy rule is a plain margin (see `buyMarginRange`), and at a franchise
     * every deal the store can source is profitable — so a range that stopped at
     * break-even could not express "pay a little over the odds to keep the lot
     * full", which at a store that spends most of its life short of stock is a
     * real strategy rather than a mistake.
     */
    buyMarginBelowCost: 0.05,
    /** Hard bounds on the stored buy margin, for a hand-edited save. */
    buyMarginMin: -0.5,
    buyMarginMax: 0.9,

    /**
     * How far the PRICING slider reaches, as a markup over book.
     *
     * The bottom is under every store's cost of sale on purpose — pricing a lot
     * to clear it is a real decision, and one the wholesaler button can only
     * make one car at a time. The top is past the point traffic dies, so the
     * slider contains its own punishment: `prospectRate` is zero above
     * `maxViablePriceRatio` of retail, and retail is book + 35%.
     */
    listMarkupMin: 0,
    listMarkupMax: 0.75,
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
    /**
     * FLOOR on the cars you must be able to buy at the new store before the move
     * is allowed. The real requirement is `reopeningLotShare` of the store's
     * stalls; this is what a very small store needs regardless.
     *
     * Six. Raising it to twelve was measured and made everything worse — it
     * gated every rung harder without saving the top one, which was dying of
     * something else entirely. See `reopeningLotShare`.
     */
    reopeningCars: 6,
    /**
     * Share of the target store's STALLS you must be able to stock before the
     * move is allowed.
     *
     * THIS IS WHAT KILLED THE PREMIUM FRANCHISE, and the diagnosis took a
     * measurement to find because the symptom looked like a margin problem. The
     * requirement used to be a flat six cars at every rung — which is three
     * driveways' worth at a curbstone and one seventh of a lot at a Valmont
     * store. So the top of the ladder was reached with $70M spent on the keys
     * and enough left to stock six stalls out of forty-two, against $20k a week
     * of rent. Six cars at premium margins gross about $21.6k a week and the
     * bill is about $22.4k: the store opened its doors ALREADY INSOLVENT, by a
     * margin too thin to see, and then bled for two hundred hours.
     *
     * That is why widening the franchise ask band read as a cliff rather than a
     * dial — anything under about eight points of extra margin left the store
     * dead and anything over it left the store compounding without limit. The
     * band was never the problem; the store was under-capitalised on arrival.
     *
     * Expressed as a share of the lot, because that is the honest form of the
     * requirement: you may not take on a dealership you cannot put cars on. It
     * leaves the early rungs exactly where they were (the floor above still
     * binds through the large used lot) and raises only the franchises, which
     * are the stores that were failing.
     */
    reopeningLotShare: 0.5,
    /**
     * Opening working capital a move must leave behind, as a share of the new
     * store's ENTRY COST.
     *
     * The other half of the same bug. Automation — and the harness bot, and any
     * player who is not deliberately saving past the goal post — moves the
     * moment the move is affordable, so whatever this function asks for IS the
     * balance the business opens its doors with. Ask for the price of a few cars
     * and the business opens with the price of a few cars, which is why the
     * premium franchise arrived holding $21,233 against $86,000 cars, an empty
     * feed, a released payroll and $20,000 a week of rent.
     *
     * Stocking the lot is not enough on its own, because the whole upgrade table
     * has to be bought again here too — that rebuild is the dominant cost of a
     * rung by design. Sized against the entry cost rather than against the table
     * because the entry cost is the honest scale of the store and it does not
     * over-gate the early rungs: a fifth of $70,000 is a small lot's float, and
     * a fifth of $70,000,000 is a franchise's.
     */
    reopeningCapitalShare: 0.2,
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
     * A hundred levels, and the last of them is a career.
     *
     * THE CAP AND THE XP CURVE ARE ONE SETTING AND MUST MOVE TOGETHER. At the
     * old growth of 1.55 the fiftieth level costs on the order of 10^11 XP —
     * raising the cap alone would not lengthen the ladder, it would saw the top
     * forty rungs off it and leave every effect curve stretched over levels
     * nobody can reach. The move to fifty brought the growth down to 1.12 for
     * exactly that reason.
     *
     * The move from fifty to A HUNDRED deliberately leaves the growth where it
     * is, and this time that is the correct half of the rule rather than a
     * violation of it: at 1.12 the ladder keeps its shape all the way up. XP
     * to max goes ~128k → ~37M — about 290x — which is the "much longer" that
     * was asked for, and at the measured award rates it lands the cap at the
     * very end of a full 350h career instead of partway up the ladder. The
     * first fifty levels cost exactly what they did (no migration needed — the
     * XP behind a level buys the same level), so the early cadence of the v10
     * retune is untouched.
     *
     * What DOES change for an existing save is the effect: `effect()` still
     * interpolates `at1` → `atMax` across the whole range, so level 50 of 100
     * is worth about half what level 50 of 50 was. Same trade the v9 → v10
     * retune made and the same defence: every minute of play is intact, and
     * the ceiling is a place you now spend the whole game climbing toward.
     */
    maxLevel: 100,
    /**
     * XP to go from level 1 to 2; each level costs `xpGrowth` times the last.
     *
     * 60 × 1.12^(n-1). Cumulative: ~290 to level 5, ~890 to level 10, ~12.9k to
     * level 30, ~128k to level 50, ~4.2M to level 80, ~37M to level 100.
     * Against the old curve (100 × 1.55^(n-1), ~9.2k to level 10) the first
     * ten levels are an order of magnitude cheaper and the last twenty are
     * where the time goes — which is the point. The early game should be
     * handing out level-ups, and the cap should be a thing a whole career
     * approaches.
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
