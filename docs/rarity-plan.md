# Vehicle rarity — design and implementation plan

**Status: SHIPPED.** This document is kept as the design record; where the build
and the plan disagree, a note says which way it went and why. Visual spec:
`docs/mockups/rarity.html`.

Four things turned out differently once measured, and all four are worth reading
before touching this area:

1. **The franchise stages needed `raritySellerCapture` after all.** The plan left
   it as an escape hatch; the 350h run made it a shipped field. See below.
2. **The two renderers do not frame a car the same way.** The plan assumed one
   shared footprint would do because the artboards agree on aspect to 0.06%.
   They disagree on everything else by up to 16%.
3. **A lift cannot be drawn.** An overlay can only add, so trucks got fender
   flares and a light bar instead — which read from overhead, where a lift does
   not.
4. **The base feed deals 78 cars an hour, not 164.** It is slot-capped, and that
   is what killed the listing-shelf-life idea.

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
| rare | 0.090 | 1.10 | one bolt-on: spoiler / flares + light bar / roof rails |
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

### What the harness actually said, and why capture shipped

`raritySellerCapture` was planned as an escape hatch and is now a shipped field
in `STAGES[].sourcing`: the share of the trim premium the seller prices in.

```ts
ask = wholesaleValue(baseTrim(car)) * rarityAskMult(rarity, capture) * askRatio * edge
```

Every run below is a clean A/B on an IDENTICAL RNG stream, using the new
`--set=balance.rarity.valueStep=0` harness flag. That matters: rarity adds a draw
per car, so comparing against the previous build would have measured the
reshuffle as much as the feature. The baseline reproduces the shipped game to
within noise (stage 2 at 2h36m against the documented ~2h32m).

**64 seeds, 4h** — the used stages, where capture is 0:

| | baseline | rarity | |
|---|---|---|---|
| stage 2 reached | 2h36m | **2h22m** | −9% |
| lifetime profit | $438k | **$543k** | +24% |
| portfolio | $164k | $196k | +19% |
| cars sold | 253 | 275 | +9% |
| bad-buy rate | 28.2% | 27.9% | flat |
| walk-away rate | 61.5% | 60.1% | flat |

**8 seeds, 350h** — the whole ladder, and the reason capture is not zero:

| | baseline | capture 0 | **shipped (0.7)** |
|---|---|---|---|
| Large used | 8h04m | 7h04m | 7h04m |
| Low-cost franchise | 18h44m | 16h37m | 16h37m |
| Midsize franchise | 55h00m | 47h46m | **50h34m** |
| Premium franchise | 318h24m | **218h11m** | **271h06m** |
| lifetime profit | $50.6M | $103.5M | $58.6M |

At capture 0 the top rung came in **31% early and lifetime profit doubled**,
which is a different game rather than a feature. At 0.7 the top sits 15% inside
baseline — and CLAUDE.md's own rule is that the harness cannot separate two
configs within ~15%, so that is as close to "unchanged" as this tool can report.
The used stages keep the full premium, because an auction genuinely does not
charge for a spoiler and because the early ladder moving 9% faster is a *welcome*
answer to the standing "stage 1 may now be too slow" question.

**⚠ THE ONE FINDING THAT IS NOT A PACING NUMBER.** At capture 0 the premium
franchise stops flatlining. Baseline at 350h: cash $0, portfolio $0, book 0/8,
collections desk 0 — CLAUDE.md's top open bug, reproduced exactly. With the
franchise premium free: **$62.3M cash, $2.0M portfolio, a full 43/43 book.** The
margin is enough to rebuild the office and keep trading.

That is not shipped, and deliberately so: rarity should not be a stealth economy
patch, and CLAUDE.md's own reading is that the honest fix is the upgrade
multiplier at the top rather than more margin. But it is one slider in
Office → Admin (`Valmont — trim priced in`), and it is now the cheapest known
lever on that bug. Somebody should decide that on purpose.

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

## Coming back to it: the special-car carousel

`advance()` runs the same `step()` whether or not anybody is watching, so the
feed churns the whole time the app is closed. Close it for eight hours and about
630 cars come and go on a feed nobody is looking at. **A legendary on the feed
is one you will rarely be there to see** — at scout 0 the chance one is on
screen when you open the app is `rate × lifetime` = `0.078/h × 150 s` = 0.33%.

**The answer is not to change the feed.** An earlier draft proposed a per-grade
listing shelf life, and it was a bad idea for two reasons. The feed is
slot-capped and already blocking 52% of arrivals, so a car that lingers is a car
that stops another being dealt — epic at 3× and legendary at 8× would hold ~2.9%
of all slot-time, which against the measured throughput→cash elasticity is
1–1.5% of end cash, permanently, bought for an event that happens twice a day.
And it does not even solve the problem: 0.33% → 2.6% is still a coin you flip
forty times.

**The retainer buyer already solves it with no changes at all.** `autoBuy` gates
on `acquisitionCeiling` → `pessimisticWholesale` → `conditionFreeValue`, so it
already values a rare car correctly and will buy an offline legendary at exactly
the bargain the feature intends. The thing that is missing is not the
acquisition. It is that **nobody tells you it happened.**

### The carousel

The away summary gains a carousel of the epic and legendary cars bought while
the app was closed, each with the deal that was struck. Rendered in
`docs/mockups/rarity.html`.

One card per car: the side profile at its trim, the badge in its rarity colour,
name and odometer, and three figures — **paid / worth / spread**. The spread is
the honest headline, because the ask was drawn against base trim, so it *is* the
rarity premium landing on the player's side of the deal.

**It needs no new save data and no new event type.** `store.ts` already holds
the state from before offline catch-up and the state after it, so the cars are
simply:

```ts
next.cars.filter((c) => c.acquiredAt >= saved.t && rank(c.rarity) >= 2)
```

`Car.costBasis` is what was paid and `retailValue(car)` is what it is worth. Two
new fields on `AwaySummary`, one component, nothing in `src/sim`.

**It renders nothing when nothing turned up** — the same rule the promotion tray
follows. This is a state the game is occasionally in, not a fixture, and an
empty "no special cars" panel every morning would teach players to skip the
whole modal.

### Three things to settle

- **Cars bought *and sold* while away** are gone from `state.cars` by the time
  anyone looks, so they cannot be found this way. A `SimEvent` on the *sale* of
  an epic or legendary covers them as a line rather than a card, which is the
  right weight — a car you never saw and no longer own is news, not a trophy.
- **Before `autoBuy` exists, the carousel is always empty.** That is honest and
  probably fine: stage 1 is ~2.5 h with short check-in cycles, so the early game
  is hands-on anyway and the player is usually there. Worth knowing rather than
  fixing.
- **"The one that got away"** — showing a legendary that spawned and expired
  unseen — is tempting and probably a mistake. It creates desire for the
  retainer buyer, but it is a notification whose entire content is that you
  missed something, arriving at the moment a player opens the app. If it is
  tried at all, gate it to legendary only, so it is a story rather than a nag.

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
| legendary | UNICORN | a car that should not exist in this spec |

**Why the top one steps out of the badge vocabulary.** SPORT and SPECIAL EDITION
are things a factory puts on a bootlid. A legendary is a spoiler *and* stripes
*and* neon underglow — the factory did not build that, somebody in a lock-up
did. So the top grade being lot slang rather than a badge is not an
inconsistency, it is the correct register: **UNICORN** is what the trade
actually calls a car in a spec you never see, it is dry rather than heroic, and
it works equally on a neon Ironmark and a Valmont.

Alternates if it reads wrong: **GRAIL** (collector vernacular, slightly more
reverent), or the original **ONE OF ONE** (cleanest, but claims a fact about
production numbers the game does not model). Avoid BARN FIND — right register,
wrong car, since nothing about the trim says "uncovered after thirty years".

One table in `rarity.ts`, zero mechanical difference, and it is trivially
reversible if it reads worse in play. **Cheap to try, so try it.**

---

## What the art does

Full visual spec with rendered examples: **`docs/mockups/rarity.html`**.

### The constraint that decides the whole approach

The lot draws cars from **baked sprites** — 9 archetypes × 9 body colours = 81
frames at ~2.9 MB, generated by `tools/render-cars`. Baking rarity would take
that to **324 frames and ~11.6 MB**, and the feed and sheets now carry a second
angle, so it is really 648.

(When this was written the pipeline needed Blender and "could not be regenerated
from a normal checkout" was the argument's second leg. That leg is gone — the
renderer is three.js in headless Chromium now. The first leg is untouched and it
was always the load-bearing one: an overlay is 0 KB and covers every archetype
nobody has drawn yet.)

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
| `src/sim/rarity.ts` *(new)* | the table: probabilities, value multipliers, display names; `rollRarity(rng)`, `rarityValueMult(r)`, `rarityRank(r)`, `baseTrim(car)` |
| `src/sim/balance.ts` | `BALANCE.rarity` block |
| `src/sim/economy.ts` | one multiply in `conditionFreeValue` |
| `src/sim/cars.ts` | `generateCar` rolls rarity |
| `src/sim/engine.ts` | `spawnListing` prices against `baseTrim`; `SAVE_VERSION` 11 |
| `src/sim/save.ts` | migration 10 → 11 |
| `src/sim/tuning.ts` | four `TUNABLES` entries |
| `src/tools/simulate.ts` | rarity counts and margin-by-rarity in the harness output |
| `src/ui/art/RarityTrim.tsx` *(new)* | the overlay, both angles, all twelve archetypes |
| `src/ui/art/CarArt.tsx` | compose the overlay; `rarity` prop |
| `src/ui/screens/BuyScreen.tsx`, `components/CarSheet.tsx`, `lot/LotScene.tsx` | chip, line, pip |
| `src/state/store.ts` | `AwaySummary.specialFinds` — cars acquired inside the catch-up window at epic or above |
| `src/ui/components/AwaySummaryModal.tsx` | the carousel, above the tiles; renders nothing when the list is empty |

Two things deliberately *not* in that list. `STAGES[].sourcing.raritySellerCapture`
— add it only if the harness says the franchise stages came in too fast. And any
per-grade listing shelf life, for the reasons under "Coming back to it".

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
- **The carousel picks the right cars.** Run real offline catch-up over a state
  seeded with a held epic acquired *before* the window and a legendary acquired
  *inside* it, and assert only the second one comes back. An `acquiredAt >=
  saved.t` filter that is accidentally `>` or reads the wrong clock would look
  perfectly plausible and silently show yesterday's cars every morning.

---

## Sequence

1. **Sim first, no art.** Types, `rarity.ts`, the two seams, the migration,
   tuning, tests. The game is fully playable at this point with rarity invisible.
2. **Measure.** `npm run sim -- --seeds=64` for the used stages and
   `--hours=350 --seeds=8` for the franchises. Compare with a `--set=` A/B that
   zeroes the feature's own constant, which holds the RNG stream identical and
   costs one run — **not** against CLAUDE.md's table, which is a different build.
   (This used to say "compare against a re-run of the current build", which
   doubled the cost of every franchise measurement for no extra information: a
   re-run of the same build is a determinism check, and the harness is
   deterministic. Use it only when there is no constant to zero.)
3. **Decide on `raritySellerCapture`** from that measurement, not from taste.
4. **Art.** `RarityTrim`, then the three in-game surfaces (feed chip, sheet
   line, lot pip).
5. **The carousel.** `AwaySummary.specialFinds` and the away-summary component.
   It comes last on purpose: it is the only piece that depends on the art
   existing, and it is worth nothing until there is something to put in it.
6. **Look at it in the browser.** `npx tsx src/tools/dumpsave.ts smallUsed
   save.json`, inject, and look at a full lot — plus a premium franchise, which
   is the case where cars are smallest and the scene pans. The dead feed-slot
   bonus and the stale-franchise-feed bug were both invisible to a green suite
   and obvious in one screenshot. For the carousel, back-date `lastSeenAt` on
   the injected save so catch-up actually runs.
7. **Update CLAUDE.md** with the re-measured tables and a section on the two
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
