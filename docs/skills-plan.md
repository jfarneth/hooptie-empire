# Proficiency skills: Buying, Closing, Wrenching

Design plan for three levelled player skills. Nothing here is built yet — this
is the shape of the work and the decisions that need making before it starts.

## What we're adding

Three skills the player levels by *doing the thing*, each with tangible effects:

| Skill | State id | Levels from | Gives you |
|---|---|---|---|
| **Buying** | `buy` | Cars purchased | Finding cars faster, and knowing what you're looking at |
| **Closing** | `sell` | Deals closed (and lost) | Negotiating room, reliable tells, an extra counter |
| **Wrenching** | `repair` | Condition points added in the shop | Cheaper, faster, deeper recon |

Alongside that, **buying becomes a judgement call rather than arithmetic.** Today
the sourcing feed prints exact condition, exact retail and exact spread, so
"should I buy this" is a comparison, not a decision. Under this plan the feed
shows an *estimate with a band*, the ask spread widens so more cars sit near the
line, and your Buying level is what tightens the band.

## Why this fits the game we already have

**The information line already drawn.** CLAUDE.md sets the rule: the UI reveals
what a real operator could know. Expected value and default odds on the deal
sheet are long-run properties a dealer genuinely learns, so they're shown. One
buyer's private walk-away price isn't knowable, so it's hidden. *A specific
car's true condition is the seller's private information* — it lands on the
hidden side of exactly that line, and the ability to guess it well is the most
real skill in the used-car business. Ambiguous appraisal isn't a new doctrine,
it's the existing one applied to a surface that got a free pass.

**Skills and upgrades stay distinct.** Upgrades are capacity bought with cash.
Skills are quality earned by playing. Where the two currently touch the same
axis, the plan splits them rather than stacking them (see *Collisions* below).

**This feeds the loan book, it doesn't compete with it.** The worry would be
that three skills about flipping deepen the tutorial at the expense of the
centrepiece. It works the other way: repossessed cars come back damaged and
re-enter the shop, so Wrenching is a *portfolio* stat; `haggle.ts` is
deliberately car-agnostic so Closing carries straight over to down-payment
haggling when that lands; and Buying governs the cost basis of every unit that
gets financed. The skills sit under the loan book, not beside it.

---

## 1. The substrate

### State

```ts
export type SkillId = 'buy' | 'sell' | 'repair';

export interface Skill {
  level: number;   // 1..BALANCE.skills.maxLevel
  xp: number;      // progress toward the next level
}

// on GameState:
skills: Record<SkillId, Skill>;
```

A `Record`, not three named fields. A fourth skill for the paper side
(collections/underwriting) is the obvious next one, and this shape costs nothing
now and saves a migration later.

New module `src/sim/skills.ts`, mirroring how `upgrades.ts` works: definitions,
the XP curve, and derived-effect accessors (`appraisalSigma(state)`,
`reconCostMultiplier(state)`, …). Everything numeric lives in `balance.ts`.

### The XP curve

```ts
xpToNext(level) = round(skills.xpBase * skills.xpGrowth ** (level - 1))
// xpBase 100, xpGrowth 1.55, maxLevel 10  →  ~9,200 XP for a maxed skill
```

Grants, all applied on the **shared** code path so automation earns them too:

| Skill | Where | Grant |
|---|---|---|
| Buying | `buyListingInternal` | `12 * sqrt(price / 1500)` |
| Closing | `acceptCash` | `10 * sqrt(price / 2500)`, `+6` if closed after a counter |
| Closing | walkaway | `4` — you learn more from the ones you lose |
| Wrenching | `stepRecon` on completion | `40 * lift` (condition points, not dollars) |

Square-root scaling on money so one luxury car can't leapfrog you, and
condition-points on recon so beaters train you as well as clean cars do — which
is both fairer and truer to the trade.

> **Put the grants at the seam, not in the wrapper.** `actions.ts` is the
> player-facing path; `autoBuy`, `autoRecon` and the sales desk call the engine
> internals directly. XP granted in `actions.ts` would silently stop accruing the
> moment a player automates, which is backwards for an idle game.

### Effect scaling

Each effect is declared by its value at level 1 and at max, interpolated with an
easing exponent, so `balance.ts` stays the only file with numbers in it:

```ts
skills: {
  maxLevel: 10, xpBase: 100, xpGrowth: 1.55,
  buy: {
    appraisalSigma:  { at1: 0.18, atMax: 0.03, ease: 0.7 },
    listingInterval: { at1: 1.00, atMax: 0.75, ease: 1.0 },
    listingSlots:    { at1: 0,    atMax: 2,    ease: 1.0 },  // floored to int
  },
  sell: {
    tellJitter:       { at1: 0.30, atMax: 0.05, ease: 0.8 },
    walkChanceMult:   { at1: 1.00, atMax: 0.60, ease: 1.0 },
    roomMean:         { at1: 0.46, atMax: 0.52, ease: 1.0 },
    deskCounterFrac:  { at1: 0.55, atMax: 0.72, ease: 1.0 },
    extraCounterAt:   6,   // maxPlayerCounters 2 → 3
  },
  repair: {
    costMult:  { at1: 1.00, atMax: 0.80, ease: 1.0 },
    speedMult: { at1: 1.00, atMax: 0.60, ease: 1.0 },
    maxLift:   { at1: 0.35, atMax: 0.50, ease: 1.0 },
  },
}
```

**Every `at1` reproduces today's constant exactly** — except `buy.appraisalSigma`,
which is a deliberate balance change. That gives a hard test gate: after phases
1–3, a level-1 save must produce byte-identical output to the current build.

### Bookkeeping that will bite if it's missed

- `cloneState()` — `skills` is a record of objects. It must be cloned per-entry,
  not spread. This is precisely the failure mode CLAUDE.md warns about.
- Tick-invariance fingerprint must cover skill level, XP, and listing noise.
- `SAVE_VERSION` 2 → 3, migration seeds `skills` at level 1 / 0 XP and backfills
  `appraisalNoise: 0` on in-flight listings (honest appraisal on legacy
  listings — non-destructive, and they rotate out within ~150s anyway).
- New `SimEvent` kind `skill-up` so levelling shows up in the away summary.
  `AwaySummaryModal` needs a case for it.
- Walkaway handling is currently duplicated in `actions.counterOffer` and
  `engine.runDeskNegotiation`. Both need the XP grant, so pull out a shared
  `registerWalkaway(s, prospect)` rather than adding a third copy.

---

## 2. Buying — sourcing and appraisal

### The ambiguity mechanic

Store one draw per listing; derive the display from it and the *current* level:

```ts
// on Listing:
appraisalNoise: number;   // z-score, drawn from s.rng at spawn

estimatedCondition(listing, buyLevel) =
  clamp01(listing.car.condition + listing.appraisalNoise * appraisalSigma(buyLevel))
```

Storing the *noise* rather than the *estimate* is what makes levelling up sharpen
the whole feed instantly, with nothing to re-roll and no RNG consumed outside
spawn. The UI shows the estimate with a ±1σ band, and that band is honest — it
really is the error distribution. The game never lies about how much it doesn't
know.

What stays exact: price, mileage, model, body style. What goes fuzzy: condition,
and everything derived from it (retail, wholesale, spread). Truth is revealed on
purchase — you own it, you can put it on a lift.

Scale check: σ = 0.18 in condition moves `conditionFactor` by ~0.10, which on a
typical car is ~13% of retail — several hundred dollars against a spread of
similar size. Enough to make the call real, not enough to make it a coin flip.

### Widen the band

`listingAskMin/Max` goes from `0.86–1.14` of wholesale to roughly `0.72–1.30`.
More genuine steals, more genuine traps, and the "obviously buy this" cases get
rarer.

> **The price leak.** The seller's ask is derived from `wholesaleValue(car)`,
> which uses *true* condition. Show a noisy condition next to a truth-derived
> price and a sharp player back-solves the condition from the price. Widening
> the ask band is what fixes this: at ±0.29 the price signal is far noisier than
> the 0.18 condition noise, so back-solving stops paying. Worth re-checking after
> tuning — if the band ever narrows again, the leak comes back.

### Levelling effects

- **Appraisal σ** 0.18 → 0.03. The headline effect.
- **Listing interval** ×1.00 → ×0.75 — you turn up cars faster.
- **Slots** +0 → +2, at levels 4 and 8.

Deliberately *not* included: better ask prices at higher level. Your edge should
be your eye, not the market treating you as a favourite — and shifting the ask
distribution is a direct money printer.

### Feedback

When a purchase lands more than ~0.08 off the estimate, log an event: *"Once it
was on the lift — worse than it looked."* That moment is where the skill teaches
itself, and it's free drama.

---

## 3. Closing — negotiation

`haggle.ts` knows nothing about cars and shouldn't start now. Pass skill effects
in as an abstract options object — `{ roomMean, walkChanceMult, tellJitter }` —
so the module stays the seam it was built to be.

- **Tell jitter** 0.30 → 0.05. Today there's a 30% chance the tell is off by a
  band; at cap it's nearly reliable. This is the cleanest possible read of "better
  instincts": it never reveals the number, it just makes your read trustworthy.
- **Walk chance** ×1.00 → ×0.60. You know how to keep someone in the chair.
- **Room mean** 0.46 → 0.52. They concede a little more to someone good. Small
  on purpose — this is the most inflationary knob in the skill.
- **Extra counter** at level 6, `maxPlayerCounters` 2 → 3. The biggest *feel*
  win in the whole plan and the one that most rewards playing by hand.
- **Desk counter fraction** 0.55 → 0.72 — the sales desk gets better as you do,
  so automating isn't strictly worse than playing.

---

## 4. Wrenching — recon

**Shipped:** cost ×0.92, speed ×0.82, max lift 0.35 → 0.40, `ease` 0.7 —
considerably milder than the values below, for the reasons in *What the harness
actually said*.

Originally proposed:

- **Cost** ×1.00 → ×0.80
- **Speed** ×1.00 → ×0.60
- **Max lift** 0.35 → 0.50 (one job takes a rough car further)

**This is the most inflationary of the three, by a distance.** Per job today:

```
gain = lift × CFV × 0.55        cost = lift × CFV × 0.36
profit = lift × CFV × 0.19  →  at lift 0.35:  0.067 × CFV
```

At cap (lift 0.50, cost ×0.80): `0.50 × CFV × (0.55 − 0.288) = 0.131 × CFV` —
roughly **2× the profit per job and 1.67× the throughput, so ~3.3× the money per
hour from the shop**. Against a late game that already runs hot at ~$1.7M by hour
four, that needs watching.

### What the harness actually said

The ~3.3× figure is a *cap* calculation, and nobody reaches the cap inside four
hours — a 4h run levels Wrenching to about 4–6 of 10. Measured end-to-end at 64
seeds against an identical flat baseline:

| Setting | lifetime profit | end cash |
|---|---|---|
| 0.95 / 0.90 / 0.38 | +3.8% | +8.1% |
| **0.92 / 0.82 / 0.40 (shipped)** | **+5.1%** | **+7.6%** |
| 0.80 / 0.60 / 0.50 (planned) | +8.3% | +19.0% |
| 0.85 / 0.70 / 0.45 | +13.2% | +31.0% |

Two things worth carrying forward:

- **The harness separates the mild band from the strong band and nothing
  finer.** The last two rows are out of order — the weaker setting measures
  higher — because with `ease 0.7` they sit within 0.5% of each other at the
  levels a 4h run reaches, so the gap between them is seed noise. End-cash
  medians swing ±12 points at 64 seeds. Don't tune against differences smaller
  than that.
- **Seed count moves the baseline more than this feature does.** The flat
  baseline reads 41m to stage 2 at 6 seeds and 45m at 64. The documented targets
  were taken at 8. Compare like with like or the reading is meaningless.

Shipped values are the measurably-gentle option, chosen because the late game is
already hot and Buying's ambiguity — the counterweight that takes free money out
of the front end — is not built yet. Raise them once it is.

---

## 5. Collisions to fix

| Thing | Problem | Fix |
|---|---|---|
| `scout` upgrade | Gives slots *and* interval; Buying would double-dip both | `scout` keeps **slots** (cash buys shelf space), Buying takes **interval** (practice buys speed). Reword the card. |
| `autoBuy` upgrade | Buys on `wholesaleValue(listing.car)` — ground truth. A retainer buyer that is omniscient while the player guesses is strictly better than playing. | Route it through the same estimate the player sees, plus a margin-of-safety cushion derived from current σ. |
| `mechanic` upgrade | Recon speed, same axis as Wrenching | Keep both — they compose multiplicatively and neither is information. Check the combined ceiling in the harness. |
| `advertising` upgrade | Traffic; Closing doesn't touch traffic | No conflict. |
| Harness bot | Buys on `retailValue`/`wholesaleValue` truth | Must buy on estimates, or the harness measures a game nobody plays. |

---

## 6. Harness and targets

New metrics to add to `npm run sim`:

- Time to **Buying 5 / Closing 5 / Wrenching 5**
- **Mean absolute appraisal error** at time of purchase
- **Bad-buy rate** — share of purchases that ended up underwater. This is the
  health metric for the whole ambiguity system.

Starting targets, to be argued with once they're measurable:

| | |
|---|---|
| all three skills ~level 4–5 | by stage 2 |
| level 6–7 | ~hour 2 |
| cap reachable | ~hour 5 |
| bad-buy rate at Buying 1–3 | 15–25% |
| bad-buy rate at cap | < 8% |

**Expect stage 2 to land later than 43m.** Buying is currently close to free
money and this plan removes that. A drift to ~45–50m is the system working; a
drift past an hour means the ask band went too wide or σ too high. Decide which
of those two is the acceptable outcome *before* reading the numbers.

---

## 7. UI

- **Skills view** — a segmented control on the existing Upgrades screen rather
  than a fourth nav slot. Level, XP bar, what the next level does.
- **BuyScreen** — exact spread becomes an estimated range; `UNDER WHOLESALE`
  becomes a confidence-flavoured read (`LOOKS CHEAP` → `UNDER WHOLESALE` only
  once the band is tight enough to say so).
- **CarSheet** — true condition once owned, with the delta against what the feed
  said. This is where the lesson lands.
- **HUD / away summary** — skill-up lines, so eight hours away shows progress.

---

## 8. Phasing

Each phase ships independently.

1. ~~**Substrate**~~ — **done.** State, XP, curve, `skills.ts`, save v3,
   `cloneState`, events, balance tables. Gate met: harness output byte-identical
   before and after. Every effect spec ships with `atMax === at1`, so the curves
   are flat and levels currently buy nothing — each phase below turns one skill
   on by editing those numbers and wiring the accessor that already exists.
2. ~~**Wrenching**~~ — **done.** `ReconMods` threaded through `cars.ts`, the
   mechanic upgrade folded into it, values tuned at 64 seeds. See above.
3. **Closing** — `haggle.ts` options object, desk fraction, extra counter.
4. **Buying + ambiguity** — the real work. Listing noise, widened ask band,
   `autoBuy` fix, harness bot on estimates, BuyScreen rework.
5. **Rebalance and polish** — harness metrics, retune, skills UI, feedback events.

Phases 1–3 hold the existing balance targets. Phase 4 is where they move, which
is why it's last and alone.

---

## 9. Open questions

1. **Does the fuzz cover mileage too?** Recommend condition only for v1.
   True-miles-unknown listings are a real auction thing and good flavour, but
   they're a second mechanic — better as its own listing type later.
2. **Reveal truth on purchase, or behind an inspection?** Recommend reveal on
   purchase for v1. But an *inspect* action — tap a listing, spend a few seconds,
   narrow the band, with Buying level making it faster and sharper — is the best
   candidate in the whole plan for giving the buy screen something to actively
   *do*. Strong phase-2 follow-up.
3. **Full XP from automation?** Recommend yes. Taxing idle play to push manual
   play is the wrong lever in this genre; pace it with the curve instead.
4. **A fourth skill for the paper side?** Not now, but the `Record` shape
   reserves it. Collections is the natural one — levelled by payments taken and
   repos worked, paying out in miss chance and recovery.
5. **Skills and prestige.** If a prestige layer ever lands, partially-retained
   skill levels are the obvious carry-over currency. Worth keeping the shape
   compatible with a "retain X%" pass, even though nothing is built for it.
