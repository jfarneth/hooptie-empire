# Vehicle rarity — design and implementation plan

**Status: proposal. Nothing here is implemented.**
Visual spec: `docs/mockups/rarity.html` (open it in a browser).

Four trim grades on every car the game deals — common, rare, epic, legendary —
at 90 / 9 / 0.9 / 0.1 percent. Each step is worth 10% more at retail than the
one below it, and each step adds one visible piece of trim.

---

## The one-line version

**Rarity multiplies what the car is worth. The seller's ask is drawn against
base trim. The difference is the margin.**

That is the whole feature. Two seams, both one line:

```ts
// economy.ts — everything that scales with "how much car is here"
conditionFreeValue(car) = model.baseValue
  * mileageFactor(car.mileage)
  * repoPenalty
  * rarityValueMult(car.rarity)      // <- new

// engine.ts, spawnListing — what the seller wants for it
const ask = wholesaleValue(baseTrim(car)) * range(rng, askMin, askMax) * edge
//                         ^^^^^^^^^^^^^ rarity stripped
```

Putting the multiplier in `conditionFreeValue` rather than in `retailValue` is
deliberate: `conditionFreeValue` is already the correct basis for anything that
scales with how much car is present, so retail, wholesale, `bhphPrice`, recon
cost, recon value gain, the forced-sale haircut on a stage move and the traffic
reference all price rarity correctly with **no second call site and no other
edits**. In particular recon ROI is unchanged, because cost and value gain both
scale by the same multiplier — which is right. A lift kit does not make bodywork
a better or worse investment.

---

## Why "visible" is the load-bearing word

The game already draws a hard line between what an operator could know and what
they could not: the deal sheet shows exact expected value and default odds
because those are long-run properties a dealer genuinely learns; a specific
car's condition is hidden because how tired that Corolla is underneath is not
something anyone on the lot can see.

**You can see a lift kit.** So rarity carries no appraisal noise, no band, no
sigma. It sits on the listing at full strength and `appraisedCar` passes it
through untouched. `appraisal.ts` needs no changes at all.

This is also what makes the feature a *decision* rather than a lottery: you can
see the epic car, you can see what it costs, and you have to decide whether to
spend the lot slot on it. Because the seller does not price the trim in, the
answer is almost always yes — which is the point. It is a good day.

---

## The numbers

`BALANCE.rarity`, all four registered in `TUNABLES` so Office → Admin can move
them live:

| grade | probability | value multiplier | what you see |
|---|---|---|---|
| common | 0.900 | 1.00 | stock trim, nothing bolted on |
| rare | 0.090 | 1.10 | one bolt-on: spoiler / lift + light bar / roof rails |
| epic | 0.009 | 1.20 | the bolt-on, plus twin racing stripes |
| legendary | 0.001 | 1.30 | all of it, plus neon underglow |

Margin as a share of retail is `1 - wholesaleOfRetail × ask ÷ rarityMult`, so at
each store's mid-band ask:

| store | ask (mid) | common | rare | epic | legendary |
|---|---|---|---|---|---|
| Curbstoning | 1.110 | 17.9% | 25.3% | 31.6% | 36.8% |
| Small used lot | 1.110 | 17.9% | 25.3% | 31.6% | 36.8% |
| Large used lot | 1.100 | 18.6% | 26.0% | 32.2% | 37.4% |
| Halvorsen | 1.200 | 11.2% | 19.3% | 26.0% | 31.7% |
| Okabe | 1.235 | 8.6% | 16.9% | 23.8% | 29.7% |
| Valmont | 1.260 | 6.8% | 15.2% | 22.3% | 28.3% |

**The interesting property, and the one that needs measuring.** Weighted across
the 90/9/0.9/0.1 population, `E[1/M] = 0.9901`, so the economy-wide lift is
**+4.5% profit per car at a curbstone lot and +13.6% at a Valmont store**. The
same ten points of value are worth twice as much where there were only seven
points of margin to begin with, so rarity matters most exactly where margins are
thinnest. In dollar terms a legendary is a 2.1x profit car at the bottom of the
ladder and a 4.2x profit car at the top.

That inversion is a feature — the premium franchise currently flatlines, and
this is a small tailwind pointed at it — but CLAUDE.md is explicit that franchise
margin is the strongest lever on late-game pacing (15–22% → 4.5–14% moved the
midsize milestone 49h38m → 76h03m). A +13.6% relative margin lift at the top
**will** pull the midsize and premium milestones in, and nobody knows by how
much until it is measured.

**The lever if it comes in too hot** is a per-stage `raritySellerCapture` in
`STAGES[].sourcing` — the share of the rarity premium the seller prices into the
ask:

```ts
ask = wholesaleValue(car) * (1 - capture * (1 - 1 / rarityMult)) * askRatio * edge
```

At `capture: 0` the seller gives the trim away, which is honest for the used
stages — nobody at a Tuesday dealer auction pays extra for a spoiler. At
`capture: 1` rarity is worth exactly nothing and the trim is pure flavour. A
manufacturer, by contrast, genuinely does charge for a trim package, so a
non-zero franchise capture is the *realistic* setting as well as the corrective
one. **Ship at 0 everywhere, measure, and raise the three franchise entries if
the harness says the top came in too fast** — do not reach for the ask band,
which is the sharpest knob in the game and would move common cars too.

### How often this actually happens

**Measured, not derived.** The naive figure is one listing per 22 s = 164/hour,
but that is the *arrival* rate and the feed is slot-capped: at four slots and a
150 s listing life the offered load is 6.8 listings' worth of arrivals into four
slots, so **52% of would-be listings are never spawned at all.** Stepping the
real engine over 8 seeds × 6 h:

| scout | listings dealt per hour |
|---|---|
| 0 | 78.4 |
| 1 | 119.4 |
| 2 | 163.6 |
| 3 | 211.0 |

So the base feed deals 78/hour, and 164/hour is what a *scout-2* feed does:

| grade | at scout 0 | fully scouted (2.7×) |
|---|---|---|
| rare | every ~8.5 min | every ~3 min |
| epic | every ~85 min | every ~32 min |
| legendary | every ~12.8 h | every ~4.7 h |

This matters beyond bookkeeping: the feed being slot-limited rather than
interval-limited is what makes slot-time the expensive currency below.

---

## The open design problem: the good stuff happens while nobody is watching

`advance()` runs the same `step()` whether or not anybody is watching, so
`stepListings` spawns and expires cars the whole time the app is closed. Close
it for eight hours and about 630 cars come and go on a feed nobody is looking
at. Every legendary among them is simply gone.

**The size of the problem.** For a Poisson arrival with a fixed shelf life, the
chance one is on the feed at the moment you open the app is `rate × lifetime`.
At scout 0 that is `0.078/h × 150 s` = **0.33%**, or about one session in three
hundred.

### What a lifetime multiplier is

`spawnListing` currently stamps a flat shelf life on everything:

```ts
expiresAt: s.t + BALANCE.listingLifetimeMs                        // 150 s, always
expiresAt: s.t + BALANCE.listingLifetimeMs * rarityLifetimeMult(rarity)   // proposed
```

At epic 3× and legendary 8× the top two grades sit for 7.5 and 20 minutes. The
fiction is right — somebody selling a special car holds out for their number —
and the shipped effect is that the odds of opening the app to a legendary go
0.33% → **2.6%** at scout 0, and 0.88% → **7.0%** at scout 3. That is a change
in kind, not a fix: at one in a thousand it *should* stay rare.

### What it costs, which is the part to weigh

**Slot-time is the most expensive currency in the game.** The feed is already
slot-limited — 52% of arrivals are blocked at scout 0 — so a car that stays
longer is a car that stops another one being dealt. Epic at 3× and legendary at
8× hold about **2.9% of all slot-time**. Against the measured throughput→cash
elasticity (scout 1 is +52% listings for CLAUDE.md's +21% end cash), that is
roughly **1–1.5% of end cash, permanently**, bought for an event that happens
twice a day.

**So do not buy it with shared slots.** Give the top two grades their own:
`StageSourcing.slots` plus a `specialSlots: 1` that only epic and legendary may
occupy. Then the long shelf life costs ordinary throughput nothing, and the
fiction is better again — the good stuff gets its own line on the board.

### The thing that may make most of this moot

**The retainer buyer already handles it correctly with zero changes.** `autoBuy`
gates on `acquisitionCeiling` → `pessimisticWholesale` → `conditionFreeValue`,
so it already pays more for a rare car and will happily buy an offline legendary
at a bargain. Add a `SimEvent` when an epic or legendary is *bought* — not when
one spawns, which at scout 3 would be two lines an hour of noise — and coming
back to "the buyer picked up a legendary Ironmark 1500, $4,200 under book"
is a **good** offline moment rather than a miss.

Which reframes the whole thing: the lifetime multiplier is an **early-game**
fix, covering the window before `autoBuy` is bought. That argues for a gentler
2×/3× rather than 3×/8×, and it makes the special slot optional rather than
required.

---

## Naming

`common | rare | epic | legendary` are the ids, and they should stay: they are
what was asked for, they are unambiguous, and they sort. But the game's voice is
American used-car, not RPG loot, and "EPIC" on a window sticker is a jarring
register shift for a game whose other chips read `LOOKS CHEAP` and
`UNDER WHOLESALE`.

Recommendation: keep the ids, add a display-name column, show trim names in the
rarity colour so the ramp still reads.

| id | display | reads as |
|---|---|---|
| common | *(nothing shown)* | a car |
| rare | SPORT | a trim level |
| epic | SPECIAL EDITION | a trim level somebody wanted |
| legendary | ONE OF ONE | a car with a story |

One table in `rarity.ts`, zero mechanical difference, and it is trivially
reversible if it reads worse in play. **Cheap to try, so try it.**

---

## What the art does

Full visual spec with rendered examples: **`docs/mockups/rarity.html`**.

### The constraint that decides the whole approach

The lot draws cars from **baked sprites** — 9 archetypes × 9 body colours = 81
frames at ~2.9 MB, generated by `tools/render-sprites`, which needs Blender.
Baking rarity would take that to **324 frames and ~11.6 MB**, and could not be
regenerated from a normal checkout.

So **trim is an SVG overlay composited over whatever drew the car**, exactly the
way condition already is. `CarArt` gains one child:

```tsx
{rarity !== 'common' ? <RarityTrim archetype={archetype} rarity={rarity}
    paint={paint} angle={angle} width={width} variant={variant} /> : null}
```

That works over the sprite and the vector fallback alike, needs no Blender, and
adds nothing to the bundle. It also preserves the contract `registry.ts` already
states — art lands one archetype at a time and a missing sprite is a supported
state.

**Alignment.** The overlay is authored in normalised artboard fractions. This is
affordable because the two artboards already agree: the sprite frame is
192 × 397 (aspect 0.4836) and `CAR_BOX_W × CAR_BOX_L` is 60 × 124 (aspect
0.4839) — a 0.06% difference. One normalised footprint table per archetype
therefore serves both renderers. **Verify this by eye on a full lot before
believing it**; if the trim floats on the sprite, the fallback is to measure the
alpha bounds of the 81 PNGs once and emit a `SPRITE_FOOTPRINT` table from
`pack.py`, which needs no Blender because the PNGs are already in the repo.

### The trim itself

| grade | top-down (the lot) | side (feed and sheets) |
|---|---|---|
| rare | car: spoiler bar across the decklid, wider than the body. truck/suv: wheels move outboard and grow, plus a light bar across the leading edge of the roof. van: two roof rails. | car: blade spoiler on two uprights. truck/suv: body rides 3.4 units higher on tyres 1.28× bigger with the contact patch unchanged, plus the light bar over the cab. |
| epic | rare's bolt-on, plus twin stripes down the centre in **three segments** — hood, roof, decklid — because a real stripe stops at the glass. | rare's bolt-on, plus twin rocker stripes along the flank. A stripe over the roof is edge-on in profile and invisible; the flank stripe is the profile read of the same car. |
| legendary | all of the above, plus three nested rounded plates spilling past the footprint at 0.34 / 0.18 / 0.11 opacity. | all of the above, plus three stacked ellipses under the sill and a bright 0.9-unit neon line along the rocker. |

- **A lift is nearly invisible from directly overhead**, which is why the
  top-down rare treatment for trucks is *wheels outboard + light bar* rather than
  a literal ride-height change. The light bar is what makes it read.
- **Paint-derived, not fixed.** The spoiler is `shadeColor(paint, -0.24)`; the
  stripe is white on dark paint and near-black on light, chosen by luminance.
  Nine body colours get nine correct-looking cars with no hand-tuned palettes,
  the same rule the rest of the lot art already follows.
- **The neon is one fixed colour** (`#ff3ea5`), because legendary has to be
  recognisable at 34 px across a full lot, and a colour that varied per car
  would not be.
- **The 34 px test.** On a small lot a car is drawn ~34 px wide. The spoiler and
  the lift survive it because they are silhouette changes; the stripe survives as
  a value break; the underglow is the only treatment that reads as *colour* at
  that size — which is why it is reserved for one car in a thousand.
- **Condition still runs on top of everything.** Rarity and condition are
  independent axes and the art must say so: a legendary beater still goes chalky
  and still blooms rust. The mockup shows this deliberately.

### Where rarity shows up in the UI

- **BuyScreen listing row** — a rarity chip beside `LOOKS CHEAP`, and the row
  border tinted for epic and legendary. Nothing for common.
- **CarSheet** — one line naming the grade and what it is worth.
- **Lot markers** — a small pip on the existing car marker. Markers hang off the
  car, never off the stall.
- **DealSheet** — nothing. The deal is about the buyer, not the car.

### Performance

`CarArt` is memoised; add `rarity` to the props so the memo invalidates
correctly. Only ~10% of a lot is non-common, so a full 62-car premium lot draws
about six extra small SVGs behind the existing 250 ms tick. Not a concern, but
worth not being careless about.

---

## Save, determinism, and the things that bite

**`SAVE_VERSION` 10 → 11.** `Car.rarity` is save data. The migration backfills
`'common'` on every entry in `state.cars` and every `listing.car` — which is
exactly the game as it exists today, so a live save notices nothing. Written out
longhand, per the standing rule that a migration has to keep meaning what it
meant the day it shipped.

**`cloneState` needs no change**, because `rarity` is a primitive on `Car` and
`Car` is already cloned by spread. Worth stating explicitly rather than leaving
someone to wonder — the rule is about *nested objects*, and this is not one.

**The RNG stream moves.** `generateCar` gains one draw, so every existing seed
produces a different game from the moment the feature lands. That is
unavoidable, harmless for saves (the migration backfills, and the stream only
diverges going forward), and means **every number in CLAUDE.md's balance tables
has to be re-measured at 64 seeds**. Budget for that; it is most of the risk in
this change.

The draw must be unconditional and in a fixed position in `generateCar` so used
and franchise stages consume the same amount of stream.

**The tick-invariance fingerprint** in `engine.test.ts` already covers
`cars` and `listings`; add `rarity` to the car entry so a missed clone or a
divergent draw shows up there rather than as a mystery months later.

---

## Files, in dependency order

| file | change |
|---|---|
| `src/sim/types.ts` | `export type Rarity = 'common' \| 'rare' \| 'epic' \| 'legendary'`; `Car.rarity: Rarity` |
| `src/sim/rarity.ts` *(new)* | the table: probabilities, value multipliers, listing-lifetime multipliers, display names; `rollRarity(rng)`, `rarityValueMult(r)`, `baseTrim(car)` |
| `src/sim/balance.ts` | `BALANCE.rarity` block |
| `src/sim/economy.ts` | one multiply in `conditionFreeValue` |
| `src/sim/cars.ts` | `generateCar` rolls rarity |
| `src/sim/engine.ts` | `spawnListing` prices against `baseTrim`; listing lifetime multiplier; `SAVE_VERSION` 11 |
| `src/sim/save.ts` | migration 10 → 11 |
| `src/sim/tuning.ts` | four `TUNABLES` entries |
| `src/tools/simulate.ts` | rarity counts and margin-by-rarity in the harness output |
| `src/ui/art/RarityTrim.tsx` *(new)* | the overlay, both angles, all twelve archetypes |
| `src/ui/art/CarArt.tsx` | compose the overlay; `rarity` prop |
| `src/ui/screens/BuyScreen.tsx`, `components/CarSheet.tsx`, `lot/LotScene.tsx` | chip, line, pip |

`STAGES[].sourcing.raritySellerCapture` is deliberately *not* in that list — add
it only if the harness says the franchise stages came in too fast.

---

## Tests

Two of these are the ones that matter; the rest are ordinary.

- **Distribution.** 200,000 calls to `rollRarity` land within tolerance of
  90/9/0.9/0.1. Direct on the roll function, because 0.1% needs a large N and
  generating 200k full cars to check it is wasteful.
- **Value.** A rare car is worth exactly 1.10× an otherwise identical common one
  at `retailValue`, `wholesaleValue`, `bhphPrice` and `reconCost`, and recon ROI
  is unchanged.
- **⚠ The margin test must not compute its expectation from the thing under
  test.** CLAUDE.md has two entries on this exact failure — a test that sizes its
  fixture with `typicalCarPrice` agreed with a broken value by construction and
  stayed green through the whole bug. So: spawn listings from the *real engine*
  over a fixed seed, group by rarity, and assert in **absolute dollars** that
  the ask is statistically indistinguishable across grades while estimated
  retail rises by 10% a step. Then mutation-test it: delete the `baseTrim` call,
  watch it go red, put it back.
- **Migration.** A v10 fixture with cars and listings comes out with every car
  `'common'` and nothing else touched.
- **Tick invariance.** Existing test, with `rarity` added to the fingerprint.
- **Art.** `RarityTrim` renders for every archetype × rarity × angle without
  throwing, and renders nothing for common. This is the guard on the fallback
  contract — the three archetypes with no sprite (`coupeEconomy`,
  `hatchPremium`, `vanPremium`) must still get trim.

---

## Sequence

1. **Sim first, no art.** Types, `rarity.ts`, the two seams, the migration,
   tuning, tests. The game is fully playable at this point with rarity invisible.
2. **Measure.** `npm run sim -- --seeds=64` for the used stages and
   `--hours=350 --seeds=8` for the franchises. Compare against a re-run of the
   current build on the same invocation, **not** against CLAUDE.md's table.
3. **Decide on `raritySellerCapture`** from that measurement, not from taste.
4. **Art.** `RarityTrim`, then the three UI surfaces.
5. **Look at it in the browser.** `npx tsx src/tools/dumpsave.ts smallUsed
   save.json`, inject, and look at a full lot — plus a premium franchise, which
   is the case where cars are smallest and the scene pans. The dead feed-slot
   bonus and the stale-franchise-feed bug were both invisible to a green suite
   and obvious in one screenshot.
6. **Update CLAUDE.md** with the re-measured tables and a section on the two
   seams.

---

## One thing found on the way in

**CLAUDE.md's margin table is stale for the three used stages.** It quotes
Curbstone 0.62–1.42, Small used 0.66–1.38, Large used 0.74–1.30, which were the
values up to commit `43aa751`. Commit `d1625bd` ("bring used margins back to
earth") raised them to **0.80 / 0.84 / 0.90** and the table was not updated, so
the doc claims a +54% best-case curbstone margin against a build that actually
delivers +40.8%. The table in this document uses the code.

Worth fixing in the same pass — it is the same disease as the "constant that
moves into a table leaves a corpse behind" entry, in the other direction.
