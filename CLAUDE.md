# Working in this repo

Hooptie Empire — an idle tycoon game about the American used-car business.
Expo / React Native / TypeScript, no backend. See `README.md` for what the game
*is*; this file is about how to work on it without breaking the things that
matter.

**All six stages are built and live**: Curbstone → small used → large used →
low-cost franchise → midsize franchise → premium franchise. `src/sim/stages.ts`
holds the table, and everything that varies by stage lives in it. Three player
skills — **Buying, Closing, Wrenching** — ship alongside them, and on the used
stages buying a car is a judgement call rather than arithmetic: the feed shows an
*estimated* condition with an honest band, not the truth. `docs/skills-plan.md`
is the design doc and carries the balance measurements behind every number.

The **lot is a hard cap on inventory** and the **collections desk is a hard cap
on the book**. A **business management suite** (Office → Business) lets the
player set three house rules the business then runs under offline: a working
capital floor, the repo trigger, and the retainer buyer's minimum margin.
`src/sim/business.ts` resolves them.

**Promotions** are temporary boosts the business runs under, and there is
currently one: every new business opens on a **grand opening** that doubles
walk-up traffic for its first twenty minutes. `src/sim/promotions.ts` is the
table and the plumbing; the tray above the tab bar is the readout.

An **admin console** (Office → Admin, visible to everyone) edits the tuning
constants live. `src/sim/tuning.ts` is the registry; adding a knob is one entry
in `TUNABLES` and nothing else. It is the one place the sim writes a global —
read the header comment there before touching it, and note that overrides live
on the save and are re-applied *before* offline catch-up, which is what keeps a
given save replaying identically.

Cash is editable there too, but through `setCash` rather than through `TUNABLES`,
and that distinction is not optional. **Nothing the simulation writes back to may
ever be registered as a tunable.** Cash is the worked example: as an override it
would be re-stamped on every load and silently delete everything the business
earned while the app was closed, so it is a plain action (`setCash`) that writes
state once, logs a ledger line, and deliberately leaves `lifetimeProfit` alone —
money conjured from a debug field is not profit, and polluting that number makes
every later balance reading a lie.

## The two axes of the stage ladder

Worth internalising before touching anything stage-shaped, because almost every
bug in this area comes from missing one of them.

**Moving clears the ENTIRE upgrade table — in both directions.** Not just the
payroll: the paving, the process and the automation go too, and all of it is
rebought at the new store's `upgradeCostMultiplier`. Cash, the loan book and
skills carry; the lot is sold; nothing else survives. This replaced an older
"property carries, people do not" split, and it is now the dominant cost of a
rung. The line is "would this person have to be hired again", which is why
`scout` (a book of contacts) and `advertising` (a spend) stay, and why walking
back *down* the ladder resets the payroll too — at a different store they would.
**Skills never reset** — they are the carry-over currency and always have been.

**The ladder is climbable out of order.** `moveToStage(state, id)` in
`actions.ts` is the one path; `advanceStage` is the single-step wrapper the
harness and automation use. Two rules make it work and both are easy to break
into generosity without a test noticing:

- **A dealership costs its own entry price, whichever rung you were on.**
  Skipping does not compound. Grinding out $32M at a small lot really does buy a
  Valmont store — you just arrive with a two-man payroll and a book sized for a
  small lot, which is punishment enough and is what the confirmation says.
- **Going down is free and refunds nothing.** Cash, paper and skills come
  with you; every dollar the store you leave cost is written off, and there is
  deliberately no discount coming back up, so a round trip pays the entry price
  twice. That is what stops it being a way to park money. `StageMovePreview`
  carries `direction`, `cost`, `forfeit`, `rungsSkipped`, `bookAfter` and
  `lotAfter` for exactly one reason: the UI must never compute any of it itself.

**Moving clears the lot, in both directions.** Every car physically on the lot is
sold to a wholesaler at `BALANCE.forcedSaleRate` (0.8) of its true
wholesale value and the cash lands with the move. `lotLiquidation(state)` is the
only place that figure is worked out — `stageMovePreview` reports it and
`moveToStage` pays it, so the confirmation cannot promise a cheque the move does
not honour.

What is emphatically *not* sold is the paper. A financed car is still in
`state.cars` marked `sold` so a repossession can bring it back, so the sweep is
`status !== 'sold'` and nothing else; clearing the lot naively strands every note
on the book. There is a test named for it.

The decision this creates is the point: sell the lot down at retail *before* you
move, or take the wholesaler's price and start clean. The haircut is what stops a
move being a free way to convert stock to cash at full value. Note also that the
old "walk down and land thirty cars on a driveway with room for five" case can no
longer happen at all — see the hard cap below.

The harness bot only ever climbs one rung at a time, so **nothing measures the
skipping or the walking back down** — the same caveat the house rules carry.

**Franchise stages are a different game.** The three used stages buy on the open
market: condition is hidden, the ask swings ±20%, and judgement is the game. The
three franchise stages buy from one manufacturer at invoice: one make, delivery
miles, `appraisalSigmaMult: 0` so the feed tells the exact truth, and a nearly
flat price band. Buying stops being a decision and throughput starts. Never test
a capability by comparing stage ids — ask the stage. `financing` is true for five
of the six, and a `=== 'smallUsed'` check silently means "no finance desk at a
Valmont store".

## The rule that must not break

**`src/sim` never imports `react`, `react-native`, or any UI package.**

The simulation is pure, headless and deterministic. It advances in fixed 1s
slices carrying a sub-tick remainder, so `advance(3600×1s)` and
`advance(1×3600s)` produce byte-identical state. That is not a nicety — it is
what makes offline progress the real thing rather than an estimate, and the
whole design leans on it.

Consequences to respect:

- Every random draw goes through `s.rng` (seeded, state lives in the save file).
  `Math.random()` or `Date.now()` inside the sim breaks replay and lets players
  re-roll offline catch-up by reloading.
- Anything a negotiation, deal, or timer needs must live in `GameState`, not in
  React state, or it cannot resolve while the app is closed.
- `cloneState()` in `src/sim/engine.ts` deep-clones by explicit spread. **Any new
  nested object on a state entity must be added there**, or mutations leak
  backwards through history and silently corrupt offline catch-up. Currently
  that means prospects (`negotiation`, `financeTerms`), `business`, and `skills`,
  which is a record of objects and needs `cloneSkills`, not a spread. The
  tick-invariance test is the guard; keep its fingerprint covering new fields.
  Note that the fingerprint only bites for fields the *tick* writes — `business`
  is set by actions only, so its real guard is the clone-isolation test in
  `business.test.ts`. Anything else in that shape needs the same treatment.
  `promotions` is in the fingerprint because the tick expires them.

## Promotions

**A promotion is a clock on the save, and the only one so far starts itself.**
`createInitialState` opens every business — including the one you start after
retiring — on a twenty-minute grand opening that doubles walk-up traffic.
Measured at 64 seeds over the first 30 minutes it is worth **+83% end cash and
+58% lifetime profit** ($2.9k → $5.4k, $5.9k → $9.3k); by hour four it has
washed out entirely and end cash is flat to within 0.2%. That shape is the
point — a boost, not an economy change.

Three rules the module is built on, all easy to break:

- **`endsAt` is stamped when a promotion starts, never derived from a duration
  on read.** Same reason as `nextBillAt`: the clock has to survive the app being
  closed, and a length recomputed from the live constants would silently
  lengthen or shorten a promotion when the admin console moved the knob under a
  run already in progress. The tunable therefore only applies to promotions that
  start *after* the change, and its help text says so.
- **A promotion multiplies the arrival rate and nothing else.** `prospectRate`
  is already zero above `maxViablePriceRatio`, so twice nothing is nothing —
  running a promotion is not a way to sell an overpriced car, and there is a
  test named for it.
- **The stop is the clock filter in `livePromotions`, not the sweep in
  `stepPromotions`.** The sweep is bookkeeping and a ledger line; moving it to
  the end of `step` changes no behaviour, which was confirmed by mutating it.
  Both are wanted: the UI and the harness read the accessor between ticks and
  neither runs the sweep.

Starting one that is already running **extends** it rather than stacking a
second copy — two grand openings would double traffic twice, which is not what
"run it again" means to anybody.

## The lot is a scene, and cars are drawn through one seam

The Lot screen is a top-down view of the dealership, not a grid of cards. Two
directories carry it and both have rules worth knowing before you touch them.
`docs/ui-3d-plan.md` is the design doc, including the four options this came out
of and where the art is meant to come from.

**`src/ui/art` is the only place that knows how a car is drawn.** `CarArt` takes
a `modelId` and an angle and returns a picture; whether that is a rendered sprite
or a vector drawing is decided there and nowhere else. `registry.ts` returns
`null` for any archetype without art and the vector renderer takes over — that
fallback is the contract, not a stopgap, and it is what lets art land one
archetype at a time with no broken build in between. Code that reaches past
`CarArt` to a sprite table will crash on exactly the car nobody has drawn yet.

The catalogue's 30 models map to **12 archetypes** (`archetypes.ts`): each body
style split economy/premium at `PREMIUM_VALUE_THRESHOLD`. That mapping is not
save data — `Car.modelId` is — so the split can be re-cut, or grown to thirty,
without a migration. Three of the twelve (`coupeEconomy`, `hatchPremium`,
`vanPremium`) are unreachable from the current catalogue and deliberately have no
art; they are the standing test of the fallback path.

**The lot is drawn with rendered sprites; everything else is still vector.**
`tools/render-sprites` turns the `.glb` models into 81 top-down frames — nine
archetypes by nine body colours — and generates `src/ui/art/sprites/index.ts`.
Only the top-down angle is rendered: the lot is where sixty cars share a screen
and the shading earns its keep, while the feed and the sheets show one car at a
time and the vector side profile reads fine. Two things that bite:

**The sprites are still shot at 12 degrees and the scene camera is at 25.**
`SPRITE_TILT_DEGREES` in `camera.ts` is the honest record of that, and
`tools/render-sprites/config.json` must match THAT number, not
`LOT_TILT_DEGREES`. The tool needs Blender, which a normal checkout does not
have, so the scene moved ahead of the art. What it costs is small and bounded: a
car is laid on the ground plane through the same affine transform as the tarmac
under it, so it parks in the right place at the right angle with the right
foreshortening, and only its own shading is from a shallower camera. Re-running
the tool with `tiltDegrees: 25` and a yaw closes the gap. Do not "fix" the
mismatch by editing one constant to match the other — that just makes the comment
lie.

- **Paint is baked per colour, never tinted at runtime.** A flat tint destroys
  the shading that is the whole reason for having sprites. Condition is the
  opposite — continuous, so it is composited: the same sprite, flattened to
  grey, laid over itself at `weatherAmount`. Both renderers read that one
  function so a car cannot change condition just because its archetype got art.
- **Paint in the kit is a texture edit, not a material**, and every model ships
  in its own colour. `tools/render-sprites/README.md` has the details, including
  why paint bands must be measured area-weighted rather than by vertex count.

The lot draws cars at ~34px on a small lot and ~60px on a driveway under the
isometric camera, so sprites ship at 192px wide and the whole set is ~2.9MB.

**The camera is isometric — 25 degrees of tilt and 25 degrees of yaw — and it
lives in `camera.ts`, which is the only file that knows how to get from the plan
to the screen.** Everything else still works in flat lot coordinates. That is
affordable because an orthographic camera maps every horizontal plane to the
screen *affinely*: a rectangle of tarmac becomes a parallelogram, never a
trapezium. Three consequences carry the whole design:

- **The ground plate is one svg matrix.** Grain, cracks, weeds, stall paint and
  the road are still authored exactly as they were when the camera pointed
  straight down, wrapped in a single `G` carrying `camera.planeMatrix(0)`. The
  yaw cost the tarmac art nothing.
- **A wall is also an affine image of a rectangle**, so `camera.wall(...)` hands
  back a matrix plus an ISOTROPIC local space, and a facade is drawn as if the
  building had been unfolded onto a page. That is why six storefronts survived
  the yaw unrewritten. Signs and glazing shear with the wall, which is what a
  sign on a wall does.
- **Verticals stay vertical.** Height moves a point straight up the screen with
  no sideways component, so masts, posts and fence uprights are still "a rect
  from the base going up".

`layout.ts` never learned any of this and `layout.test.ts` still tests a flat
plan. `camera.test.ts` is the guard that matters: it checks the svg matrix and
`project()` agree to a hundredth of a pixel, because the ground is drawn with one
and the cars are positioned with the other, and a disagreement looks like a
layout bug rather than a projection one.

**The yaw is the expensive angle and it is paid for in car size.** Rotating a
long thin lot inside a screen-shaped box leaves two big empty triangles at the
corners, so the same lot needs roughly 1.8x the width it used to. Cars land at
~34px on a small lot against ~75px before. Below `MIN_CAR_WIDTH` (30px) the
camera stops shrinking, reports `panned`, and `LotScene` puts the scene in a
horizontal scroller — which is why a premium franchise pans sideways and the
early stages never do. Those corner triangles are not waste: they are where
`surroundings.ts` goes.

Buildings are still exaggerated, but by about 2x rather than 3x — at 25 degrees
the tilt does more of the work. Cars are never compared against a building for
scale, so the cheat is invisible.

**`src/ui/lot/surroundings.ts` decides what is next door**, and it is what stops
the lot filling the screen edge to edge. Each stage gets a neighbourhood — houses
beside a driveway, light industrial beside a small lot, a retail park beside a
low-cost franchise, mature planting beside a premium one — generated from a
per-stage seed into three strips: left, right and behind. **Nothing is ever
placed in front of the lot.** The camera stands at the street, so a neighbour on
the near side would be nearer than the cars and would have to occlude them — and
cars are pressables in a layer *above* the ground svg, so it could not. That rule
has a test, and it is the one that goes red if someone adds a fourth strip.

**`src/ui/lot/layout.ts` is pure and tested, and it is where the 5-to-62 car
range is solved.** Give it a capacity and a width and it returns painted stalls;
column count and car scale come out of a table, so the camera pulls back as the
business grows and "Pave another row" literally paves another row. Two things it
must keep doing:

- **Parking derives from a hash of `car.id`, never from saved state.** No
  `SAVE_VERSION` bump, nothing new for `cloneState()` to miss. It is hash-then-
  probe rather than fill-in-order on purpose: filling in order means every car
  behind the one you just sold shuffles forward, which on a 62-car lot is half
  the screen moving because one car left. `layout.test.ts` guards it, and that
  test is the one that goes red if you "simplify" it.
- **Markers hang off the car, not off the stall.** A badge positioned above the
  stall lands on the tail of the car in the row in front, which put price tags on
  the wrong cars until it was caught in a screenshot.

**A car with a buyer standing at it opens the DEAL, not the car.** Tapping a
parked car normally opens the inventory sheet; while a prospect is beside it,
the same tap opens the deal sheet instead. Two reasons, and both matter: the
shopper figure is a ~30px target next to a car that fills its stall, so the
obvious thing to tap was the wrong thing; and the inventory sheet exists to
reprice and unlist, neither of which you can honestly do with a customer looking
over the bonnet. Declining the buyer hands the car straight back. `LotScene`
builds one `carId → prospect` map and both the pressable and its marker read it
— reaching for `prospects.find` per car was sixty scans a render at a premium
franchise.

**The lot is a hard limit, and a repossession is the path that used to break
it.** Every buying path is gated on capacity, but a repo adds a car without
anybody choosing to: `applyRepoDamage` flips it from `sold` back to `ready`, and
ungated that was the one way to hold more cars than the lot has stalls — which
reads to a player as a bug, because it is one. A full lot does not cancel the
repossession; the car is still taken, it just never comes home, going from the
tow truck straight to auction at `forcedSaleRate`. Same shape as the collections
desk, which sells the customer the car instead of the payment rather than sending
them away. `engine.test.ts` asserts the invariant continuously over a run that
actually fills the lot and actually repossesses — a missing gate can only be
caught by watching the property, never by reading one line.

**The lot is paved for `max(capacity, cars held)`, not for capacity.** Both ways
a lot could exceed its stalls are now closed — moving clears it, and a repo onto
a full lot goes to auction — so this is belt-and-braces for the one case left:
the admin console can shrink a stage's capacity under a lot that is already full.
A car with no stall is a car that cannot be tapped, which is a car that can never
be sold, so it is still paved for. A car with no
stall is a car that cannot be tapped, which is a car that can never be sold; the
HUD still reports the real `held / capacity`, so nothing pretends the space was
bought.

**The pylon sign is the progress readout, and it lives outside the memoised
ground plate.** `LadderPylon.tsx` draws the sign at the right-hand end of the
building: the cap names the store you are saving for, the column fills with cash,
and it reads READY when the cheque would clear. It is a separate tiny `Svg` on
purpose — it changes as cash changes, and putting it inside `LotGround` would
defeat the memo that stops ~400 elements redrawing at 4Hz. It has pointer events
off so taps fall through to the sign target that already opens the ladder.
`PYLON_RESERVE` in `environment.ts` is the strip it stands in, and `LotGround`
reads the same constant to keep the service bay, the showroom glazing and the
shack's board out of it — without that, the pylon lands on a service department
at three of the six stores.

The HUD floats over the screens rather than sitting above them, so every scroll
view pads its content by `HUD_HEIGHT`. A new screen that forgets starts under the
cash readout.

## Retirement, the shark, and the one bill that goes below zero

**Retirement is the prestige layer and the ultimate escape hatch, and it is one
mechanic serving both jobs on purpose.** `retire()` in `actions.ts` sells the
whole operation — cash, the lot at `forcedSaleRate`, the book to a note buyer at
`notesSaleRate` of principal — settles the shark off the top, logs the net on
the scoreboard, and starts a genuinely new game via `createInitialState`. What
the next run inherits is deliberately short: skills, house rules, tuning
overrides, and the prestige block. `retirementPreview` in `src/sim/prestige.ts`
is the one place the sale is priced; the confirmation renders it and the action
pays it, same rule as `stageMovePreview`.

**Points are linear in the money retired — one per `pointDollars` of net — and
that linearity is the anti-farm design.** Value grows ~10x per rung while time
grows ~3x, so deep runs earn and an early bail earns ~nothing: the reset IS the
reward for a dead run, which is why retirement needs no gate and has none. The
counter still increments on a $0 bail — the board remembers everything,
including the failures. Points buy a capped buy-side edge (`prestigeEdge`),
applied where listings are priced so it hits auction and invoice alike, AFTER
the RNG draw so the stream is identical with or without it.

**The shark is the other half of the system.** One loan at a time, sized in
cars (`BALANCE.loan.carsOffered`) but never presented that way — the UI shows
his dollar figure, take it or leave it. His weekly payment rides `stepBills`,
and it is **the one charge in the game allowed to drive cash below zero.** Rent
and wages still floor at zero; his cut does not. That asymmetry is the entire
design: a business with no loan can never go negative, so the old invariant
holds for everyone who has not signed with him, and the trapdoor only opens by
choice. There is no missed-payment state — the schedule simply runs, the hole
deepens, and the way out is recovery or retirement, where he is settled from
the proceeds even if that leaves a zero on the board.

**The harness never retires and never borrows**, so both mechanics are
unmeasured by `npm run sim` — the same caveat the house rules carry. A fresh
run's edge is zero, so every baseline number is untouched by construction.

## Running costs, and the spiral they nearly caused

**The business pays rent, wages and floorplan interest every game week**
(`weeklyExpenses`, charged by `stepBills` on the same beat note payments land
on). Rent is per stage; a staff line's wage is a share of what that level cost to
hire (`wageOfCost`), so an expensive hire is expensive to keep and a new staff
upgrade gets a sensible wage for free; floorplan is interest on the cost basis of
everything unsold.

**THE STICKER IS CASH RETAIL, NOT THE FINANCE WINDOW.** `listCar` defaults the
ask to `retailValue`, and the subprime premium is applied where the contract is
written (`bhphPrice`, in `customers.ts`). It used to default to the window —
retail x `bhphMultiplier` — which was incoherent twice over: a cash offer is
capped at `min(askPrice, retail)` so nine buyers in ten could never pay it, and
`askPrice / retail` feeds the overpricing model, so the default price was
simultaneously unreachable and read by the game as greedy. A $11.8k car showed a
$16.8k sticker. Traffic is judged against the same number the sticker is
denominated in, for the same reason — with the window as reference, a car priced
at exactly what it is worth looked like a 30% discount.

**Margin is shaped along the ladder, and it is the strongest lever on run rate
there is.** `STAGES[].sourcing.askMin/askMax` is a share of true wholesale, so
margin as a share of retail is `1 - wholesaleOfRetail x ask` and break-even sits
at an ask of ~1.35. The bands now straddle that line on the used stages and sit
well under it on the franchises:

| | ask band | margin, best to worst |
|---|---|---|
| Curbstone | 0.62–1.42 | +54% to **−5%** |
| Small used | 0.66–1.38 | +51% to **−2%** |
| Large used | 0.74–1.30 | +45% to +4% |
| Low-cost franchise | 1.16–1.24 | +14% to +8% |
| Midsize franchise | 1.20–1.27 | +11% to +6% |
| Premium franchise | 1.23–1.29 | +9% to +4.5% |

The percentage falls as the dollars rise, which is what makes the top a volume
business and the bottom a judgement one. Two measured facts about it:

- **Widening the early band costs nothing in pace.** Going from 0.8–1.2 to
  0.62–1.42 left the stage-2 milestone flat (2h36m → 2h29m). A selective buyer
  is *helped* by a wider spread — more junk to skip, but better cars when they
  land. What it buys is character, not slowdown: the band only sets the stakes,
  and the appraisal decides whether a given car actually loses money.
- **Thinning the franchise band is enormous.** Cutting franchise margin from
  15–22% to 4.5–14% moved the midsize milestone 49h38m → 76h03m and pushed
  premium out past 350h. If the late game needs to move, this is the knob.

**A reserve measured in weeks of rent is not a reserve.** Thin franchise margins
exposed this: a business would arrive at a midsize store with $18k, which is not
one $34k car, so it could never restock, never earn, and died with the rent still
running. The working-capital floor is now `max(player floor, weeks of expenses,
price of N cars at this store)` — denominated in the unit that actually matters.
`reopeningFloat` is sized the same way.

**The premium franchise still kills the economy, and it is the top open bug.**
The ladder is completable — 8/8 seeds buy the premium store at ~321h — but the
business then flatlines and never trades again. The tell is the one this file
already names: lifetime profit is identical to the dollar at 350h and 420h,
which means cash is pinned at zero. It dies rebuilding an 18x-priced office on
4.5-9% margins. Raising `reopeningCars` to 12 was measured and made it worse —
it gated every earlier rung harder without saving the last one. The likely fix
is the upgrade multiplier at the top, not the float.

**The upgrade table is badly out of scale with the ladder, and it is the next
thing to fix.** A sales manager costs 1:18 of the store at a small lot and
1:1111 at a premium franchise — the store gets 1000x dearer and the hire only
18x. Raising `upgradeCostMultiplier` to hold that ratio near 1:38 was measured
and it makes the midsize franchise unreachable inside 350h, even with entry
costs cut to $16M. The franchise stages simply cannot accumulate that much once
upgrades are priced properly, which says the fix is not the multiplier alone:
the absolute dollar figures are inflated because entry costs were raised to gate
time against a ~26% gross margin. Thinner margins would let the same pacing be
gated by realistic figures, and the ratio would fall out of a smaller spread. A
retune that moves margins, entry costs and the multiplier together is one job,
not three. This is what stops a franchise
being pure upside once its entry cost clears.

**Cash at zero is an ABSORBING state, and that is the whole difficulty.** No
cash buys no stock, no stock earns nothing, and the bill still arrives. The first
cut of this killed 12 of 16 harness seeds outright while the surviving 4 ran at
the old pace — a bimodal result, which is the signature of a spiral rather than a
tax. Three things had to land before expenses became a dial instead of a cliff,
and removing any one of them brings the spiral back:

- **`BALANCE.expenses.reserveWeeks`** — automation never spends below a few
  weeks of running costs, on top of the player's own working-capital floor.
- **`reopeningFloat`** — the ladder will not let you move unless you keep enough
  back to restock the new lot and cover its first weeks of rent. The entry cost
  buys the keys; this buys something to sell. **It is a property of the TARGET
  store only.** The first version also charged for rebuilding the office you were
  leaving, which scales with what you own — so every upgrade pushed the next rung
  further away and the bot stalled forever. A requirement that grows when you
  invest is a trap, not a gate.
- **The harness bot keeps restock money back** before it rebuys upgrades. With
  the whole table wiped on a move, the bot's old "$3k float" heuristic left it
  unable to buy a single car.

The tell for all three failures was the same and worth recognising: **identical
lifetime profit under different expense settings.** That means the economy is
pinned at zero, where `Math.min(cash, bill)` charges nothing, so the setting
cannot matter. If two expense configs report the same profit to the dollar, the
business is dead, not taxed.

## Verify

```bash
npm test        # 282 tests
npm run typecheck
npm run sim     # balance harness — 4h of simulated play in ~2s
npm run sim -- --hours=350 --seeds=8   # the whole ladder, ~2min
```

The ladder, median at `--seeds=16 --hours=32`, reached by 16/16:

| | |
|---|---|
| Small used dealership | ~4h32m |
| Large used dealership | ~9h15m |
| Low-cost franchise | ~19h44m |
| Midsize franchise | ~55h08m |
| Premium franchise | ~320h59m |

Measured at `--hours=350 --seeds=8`, because the ladder no longer fits in 32h.
Roughly a tripling per rung now, steepening at the top — the shape to preserve. A 4h run only ever
reaches large used, so **a default `npm run sim` cannot tell you anything about
the franchise stages** — use the 32h invocation for those.

Targets **at `--seeds=64`** over the default 4h, which is the number to quote and
compare against for everything below the franchise:

| | |
|---|---|
| stage 2 reached | ~3h52m (8/64 inside 4h) |
| take-it-back odds on the deal sheet | ~30% |
| walk-away rate | ~64% |
| bad-buy rate | ~25% |
| appraisal error | ~9.6% |
| Buying / Closing / Wrenching to level 5 | 52m / 43m / 40m |
| $100k cash | ~3h09m |
| end cash at 4h | ~$125k |
| lifetime profit at 4h | ~$133k |
| cars sold at 4h | ~74 |

**These were re-measured, and the numbers they replaced were badly stale.** The
old table dated from before running costs, the ladder stretch and the margin
reshaping landed, and it claimed stage 2 at ~1h11m and end cash at ~$20k against
a build that actually reached stage 2 at ~3h54m with ~$125k. It is worth knowing
that happened, because the file's own advice — always state the seed count,
never compare across builds — is exactly what stops it happening again. A 4h run
now barely reaches the small lot at all, so **the default `npm run sim` says
nothing about anything above stage 1**; use the 32h and 350h invocations for the
rest of the ladder. The first repossession, the first note paid off and the
portfolio numbers no longer land inside 4h and have been dropped rather than
quoted from a run that does not reach them.

**Always state the seed count.** Seed count moves these numbers further than most
features do, and comparing a 6-seed run against a 64-seed target is the single
easiest way to conclude you broke something you didn't.

End cash at 4h is low and that is not a regression: the bot buys the large used
dealership at ~3h37m, which spends the balance, resets the payroll *and now sells
the lot*, so the 4h snapshot lands squarely mid-rebuild — it is the most
liquidation-sensitive number in the table and should be read as noise unless it
moves by a lot. Read `lifetime profit` (~$1.30M) for the health of the economy
and the ladder table above for pacing.

Clearing the lot on a move cost the ladder about 5-8% per rung (large used 3h16m
to 3h36m, premium 27h36m to 28h05m at 16 seeds) and took 4h lifetime profit from
~$1.86M to ~$1.30M. That is the bot paying the haircut on every rung and never
once selling down at retail first, which is the play the feature exists to
create — so treat it as the worst case, not the expected one. Earlier deliberate retunes
moved the rest: the book cap took end cash from $1.36M to $935k, and the
risk/negotiation tune-up took it to ~$503k pre-ladder.

Pacing constants live in `src/sim/balance.ts`, except the ones that vary by store
— entry costs, capacities, sourcing, staff and markup multipliers — which live in
the `STAGES` table in `src/sim/stages.ts`. Those two files are the whole surface;
nothing else should hard-code a number that affects the curve. Office → Admin
edits both at runtime, which is the fastest way to feel a change before
committing it.

## Tuning the economy — read before touching `balance.ts` or `stages.ts`

Hard-won during the skills work. Every one of these cost a wrong turn.

- **The ask band (`STAGES[].sourcing.askMin/Max`) is the sharpest knob in the
  game.** It moved out of balance.ts with the ladder — a franchise buys at
  invoice, a used lot buys at auction — so it is per stage now. It sets both the
  share of listings worth buying *and* the margin on the ones that are, and an idle economy compounds margin over four hours. Holding its width
  and shifting position up by 0.06 took end cash from $1.52M to $282k; another
  0.06 took it to $28k. Results track the bot's buyable pass rate almost
  exactly. Do not widen or move it without a 64-seed run.
- **The skill cap and the XP curve are ONE setting.** `maxLevel` is 50 and
  `xpGrowth` is 1.12, and they moved together for a reason that is easy to miss:
  at the old growth of 1.55 the fiftieth level costs on the order of 10^11 XP,
  so raising the cap alone does not lengthen the ladder — it saws the top forty
  rungs off and leaves every effect curve stretched across levels nobody can
  reach. `effect()` still interpolates `at1` → `atMax` over the whole range, so
  a maxed skill is worth exactly what it always was; what changed is that you
  arrive there over a career instead of an afternoon. Measured at 64 seeds over
  4h, the retune left pacing flat (stage 2 3h54m → 3h52m, end cash −0.2%,
  lifetime profit +0.7% — all inside the noise band) while level 5 arrives about
  three times sooner (Buying 2h46m → 52m). The visible cost is that a 4h run now
  finishes in the high twenties rather than maxed, so Buying's σ stays wider for
  longer: appraisal error 7.8% → 9.6% and bad-buy rate 21.5% → 25.1%, which
  lands that health metric back on the ~25% this file already calls the target.
  **A level number is not comparable across a change to either constant** — see
  the v9 → v10 migration, which re-derives the level from the XP behind it
  rather than carrying the number across.
- **A milestone level is set by XP, not by proportion.** `extraCounterAt` is 15
  of 50, not 30. It was 6 of 10 and cost ~1,445 XP; level 15 costs ~1,940, so
  Closing's third counter still arrives at roughly the point in a run it always
  did. Holding the *fraction* would have put it at ~10k XP and quietly deferred
  the best thing Closing does by hours.
- **Throughput compounds; judgement doesn't.** Anything that adds cars per hour
  is worth far more than it looks: shortening the listing interval measured +15%
  end cash, one extra feed slot +21%. This is why Buying grants *no* throughput
  and is purely an accuracy skill.
- **The harness's `default rate` line measures the underwriter, not the paper.**
  The sales desk finances on expected value, so raising borrower risk makes it
  write *safer* paper and the measured rate saturates around 22–25% and then
  falls: at a 4x miss chance it reads 12.2%, below where it started, because by
  then the desk will only touch A-tier. Tune credit risk against the deal
  sheet's "chance you take it back" — `expectedCollections(...).defaultProbability`
  over the walk-in mix — which is unconfounded and is what the player actually
  sees. Non-monotonicity in the harness line is automation reacting correctly.
- **Negotiation walk rate is capped by acceptance, not by walk odds.** The desk
  counters once, so per haggle `P(walk) = (1 - acceptance) x walkChance`; an
  accepted counter can never walk. That puts a hard ceiling of `1 - acceptance`
  on the metric no matter what `baseWalkChance` does. Moving the walk rate means
  moving `acceptanceAtReservation` first and walk odds second. Also note Closing's
  `walkChanceMult` bottoms at 0.6, and the harness spends most of a 4h run at
  Closing 10, so the measured rate sits well under the level-1 rate.
- **The harness separates the mild band from the strong band and nothing
  finer.** End-cash medians swing ±12 points at 64 seeds — enough to order two
  settings backwards. If two configs are within ~15%, the harness cannot tell
  them apart; decide on design grounds and say so.
- **It cannot see hand play at all.** The bot mirrors the sales desk: one
  counter, then take what comes back. So it never reads a tell and never uses a
  third counter. Closing measured as costing nothing, which is true *for
  automation only* — its upside for someone playing by hand is unmeasured.
- **Ground truth vs. what the player sees.** Anything spending money unattended
  (`autoBuy`, the harness bot) must work from the appraisal, never from
  `wholesaleValue(listing.car)`. Automation that can see what the owner cannot
  makes automating strictly better than playing.
- **The book cap is now the biggest single lever on the late game**, and it is
  the only thing behind the target change above. Measured at 64 seeds by
  disabling `canWriteNote` and re-running: end cash $1.36M and portfolio $1.10M
  with the cap off, against $935k / $307k with it on. The same run isolates the
  $500 working capital floor as costing *nothing* measurable, so attribute the
  whole −31% cash / −73% portfolio swing to the cap. It also drops the default
  rate from 27% to 15%, because the pre-cap book ran ~3.5x over a fully staffed
  desk and `overCapacityFactor` was pinning miss chance near its ceiling.
- **The bot maxes `collections` and then sits at 43/43 for the rest of the run.**
  The harness prints `book / limit` and `collections desk` for exactly this
  reason — when the finance side of a run looks wrong, that is the first place
  to look. A change to `baseCollectionsCapacity` or `collectionsCapacityPerLevel`
  is now a change to the whole late-game curve, not a tweak to a penalty.

## Settled decisions — don't relitigate these

- **Mobile-first Expo.** Not web-first, not Unity. The web build exists for
  sharing and for verification, not as the target.
- **The loan book is the game.** Buy-here-pay-here modelled as real note objects
  is the differentiator; car flipping is the tutorial. Resist changes that make
  flipping the main event.
- **Illustrated lot**, not a data-dense dashboard. Isometric since the camera
  moved: a diorama with a neighbourhood around it, not a plan view.
- **Countering is a gamble, not free money.** Since the tune-up, a refused
  counter loses the buyer ~9 times in 10 at level-1 Closing. Walk-aways are only
  ever triggered by a counter — take the opening offer and nothing can go wrong —
  so "should I push back at all?" is now a live decision where it used to be
  automatic. The harness cannot see this: the bot always counters, so its stage-1
  slowdown is the worst case, not what a careful hand player feels.
- **Negotiation**: slider input, cash-only for now, sales desk counters once and
  takes what comes back, and a rejected counter usually ends the deal. `src/sim/haggle.ts` deliberately
  works in abstract money and takes a `HaggleSkill` of plain numbers — it knows
  about neither cars nor `GameState`. That is the seam for down-payment
  haggling later. Keep it that way.
- **Upgrades buy capacity; skills earn quality.** Where both touch one axis they
  stack multiplicatively (`mechanic` × Wrenching speed, `scout` × the feed,
  `repoMan` × the repo trigger's damage). Splitting an axis between them instead
  is how you silently nerf something a player already paid for.
- **The collections desk sets a hard limit, not a soft one.** The number was
  already on the HUD and the ledger; it just was not enforced, so a player who
  read it as a limit was wrong and one who ignored it was rewarded. Enforced on
  `acceptFinance` — the single path the sales desk, the harness bot and the
  player's tap all go through. A full book sells the customer the car instead of
  the payment; it never sends them away.
- **A promotion is a boost, not an economy.** It moves the arrival rate and
  nothing else, which is what lets it be strong early — +83% cash over the first
  30 minutes — without a single price, margin or credit number moving with it.
  The moment one wants to touch pricing or the feed, the honest shape is another
  accessor beside `promotionTrafficMultiplier`, read at the one call site that
  cares, rather than a generic modifier bag every system has to consult.
- **The promotion tray is in the tab bar, not the HUD.** The HUD is the two
  scores, and a third readout with a clock on it floating over the lot would
  crowd the surface the game most wants you looking at. It renders nothing when
  nothing is running, because this is a state the game is briefly in rather than
  a permanent fixture, and it is deliberately not pressable — there is nothing
  to open yet, and a control that no-ops teaches players to stop tapping.
- **House rules are limits, not dials.** The business suite deliberately offers
  discrete choices rather than sliders: these are settings a player picks once
  and then reasons about after eight hours away, and a limit survives that
  absence in a way a fine-grained dial does not. Every default reproduces the
  pre-suite build exactly, which is what makes the migration safe.
- **A repo trigger has to cost something.** Left flat, a longer leash is strictly
  better — more chances to cure, higher expected collections, fewer defaults, and
  a financed car occupies no lot space while it is out. Repo condition damage
  scales with the trigger so patience is paid for in the unit you recover. If a
  future setting looks free, it is not a setting.
- **Property carries, people do not, and the stock is sold.** The first half is
  the whole design of the stage reset, and it is what makes moving up a decision
  instead of a button — anything new on the upgrade table needs a deliberate
  answer to "would this have to be hired again at a bigger store". The stock is
  sold at a haircut because hauling beaters to a franchise store was never the
  fantasy, and unwinding a mismatched lot by hand was bookkeeping rather than a
  decision. The loan book is the exception and always will be: it is the business,
  and it moves intact.
- **The ladder reads both ways, and only one direction is generous.** A player
  can page through all six stores from the sign — including ones they cannot
  afford — because a ladder whose card only ever names the next rung hides four
  fifths of the game from someone deciding whether to keep grinding. They can
  also jump rungs, and walk back down. Going down is the escape hatch, not a
  strategy: it costs nothing, refunds nothing, and coming back pays full price.
  If a way down ever looks free, it is not a way down.
- **A franchise buys at invoice, not below wholesale.** Automation must gate on
  `acquisitionCeiling`, never on a bare wholesale comparison. The first cut of
  the ladder gated both buyers on "is this under wholesale?", which a factory
  allocation can never satisfy — the feed sat untouched for ten hours and the
  economy flatlined with no test failing. `AppraisalStance` keeps the two buyers
  distinct on the used stages: the retainer buyer works from the worst case
  because it spends money unattended, the harness bot works from the estimate
  because that is what a person does. Collapsing them cost 35 minutes off the
  stage-2 milestone before it was caught.
- **What the UI reveals.** The deal sheet shows exact expected value and default
  odds for financing, because those are long-run properties a dealer genuinely
  learns. It hides negotiation acceptance odds and a car's true condition,
  because one buyer's private walk-away price and one car's hidden wear are not
  things anyone on that lot could know. The line is "what a real operator could
  know" — apply it to new surfaces too.
- **The appraisal band is honest.** The ±1σ range shown on the feed really is
  the error distribution; the noise draw has unit standard deviation so that
  stays true. The game never misrepresents how much it doesn't know.

## Regressions already paid for — do not reintroduce

Each of these was a real bug found by testing or by looking at the running game.
Most have a guarding test; check before "simplifying" the code around them.

- **Cash offers must not derive from `bhphPrice`.** A cash buyer will not pay the
  subprime markup — that markup is the price of getting approved. Deriving from
  it made cash beat financing on 78% of deals and inverted the premise.
- **Recon cost indexes to `conditionFreeValue`, not the model's `baseValue`.**
  Otherwise bodywork on a 200k-mile beater costs what it would on a new car, and
  reconditioning is strictly negative across all of stage 1.
- **Mileage depreciation is exponential.** Linear-to-zero valued a 200k-mile car
  at ~10% of base and left the opening stage with no viable margins.
- **The first listing of a new game is dealt, not rolled** — guaranteed
  affordable with a clear margin. Left to chance, ~1 game in 8 opened with
  nothing buyable.
- **`humanizePrice` floors on both branches.** Rounding to nearest let an offer
  land above the price it was derived from.
- **XP is awarded on the shared engine path, never in `actions.ts`.** The
  standing shop order, the retainer buyer and the sales desk call the engine
  internals directly, so awards in the player-facing wrappers stop accruing the
  moment someone automates — backwards for an idle game.
- **Integer skill effects round, they don't floor.** Flooring a 0→1 curve only
  reaches 1 at exactly max level, which left the feed-slot bonus dead for nine
  of the ten levels it was meant to span while `balance.ts` claimed level 5.
- **A constant that moves into a table leaves a corpse behind.** The ladder
  copied the ask band, base capacities and the window markup into `STAGES` and
  left the originals in `balance.ts`, where they read as live tuning for two
  commits — including the one CLAUDE.md called the sharpest knob in the game.
  Nothing failed, because dead constants never do. When you move a number, grep
  `BALANCE.<key>` and delete what has no readers.
- **A test that asserts `sum >= count` cannot fail.** The first automation test
  written for skills passed on a run that accrued zero XP. Mutation-test any
  test guarding a regression: break the code, watch it go red, put it back.
- **A level number is save data whose MEANING lives in `balance.ts`.** The v9 →
  v10 migration is the worked example: the cap went 10 → 50 and the XP curve
  came down with it, so carrying a level across verbatim would have taken a
  maxed player from every effect at full strength to a third of it, in one
  reload, with nothing lost that could be pointed at. The migration adds up what
  each level cost at the OLD prices and re-spends it at the NEW ones, which puts
  a maxed v9 skill at 27 of 50 with every minute of play intact. Both curves are
  written out longhand there and that is not duplication to be tidied away — a
  migration has to keep meaning what it meant the day it shipped, and reading
  the live constants would silently re-grade every old save after the next
  balance pass.
- **Bump `SAVE_VERSION` and add a migration whenever `GameState` changes shape.**
  Currently **v10**. Saves are long-lived and local to the device; "we wiped
  saves" is the thing that ends an idle game. `src/state/persistence.ts` also
  carries legacy storage-key fallback for the same reason.
- **A new limit never retroactively destroys what a save already holds.** A v4
  book can sit far over the v5 cap. The migration leaves every contract intact
  and lets the book shrink back under the line by attrition, with
  `overCapacityFactor` still degrading it in the meantime — that penalty is not
  dead code, it is what makes meeting an over-capacity book graceful. Deleting
  notes to make the invariant true would delete somebody's portfolio.

## Environment constraints

These will waste your time if you discover them the hard way:

- **Repo-settings writes are blocked by the proxy.** Renaming the repo, enabling
  Pages, changing branch protection — the user has to do those in the GitHub UI.
  Don't retry; just say so.
- **`github.io` is unreachable from here** (proxy blocks CONNECT). You cannot
  load the live site. To verify a web build, export with
  `EXPO_WEB_BASE_URL=/hooptie-empire` and serve it locally under a matching
  `/hooptie-empire/` subpath — the base path bug only shows up on a subpath.
  Serving at root proves nothing about the deploy.
- **Don't play 40 minutes to reach stage 2.** `npx tsx src/tools/dumpsave.ts
  smallUsed save.json` writes a real save at any stage — it buys the store, turns
  on the automation upgrades and lets the engine fill the lot. Inject it into
  `localStorage` under the key `hooptie.save` before the page loads
  (`page.addInitScript`).
- **Playwright + Chromium** at `/opt/pw-browsers/chromium` works for driving the
  app; `npm i -D playwright` with `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` is not in
  `package.json` on purpose. Look at the running game, not just the suite — the
  dead feed-slot bonus and a text-wrapping regression were both found this way
  and neither had a failing test.
- **Look at a franchise in the browser, not just the harness.** The stale-feed
  bug — a brand new franchise showing auction beaters for two minutes on a feed
  that promises one make — was invisible to 163 passing tests and obvious in one
  screenshot. Generate a save at the stage you changed and open it.
- The bottom nav is **Lot / Buy / Notes / Office**. Upgrades, Skills and Business
  live behind *Office*, and "Buy" also matches the header text "BUY HERE PAY
  HERE", which will bite any text-based selector.
- **`page.addInitScript` runs on every navigation, including `reload()`.** Seed
  the save only when the key is absent, or a reload re-stamps your fixture over
  whatever the game just autosaved and every persistence check silently passes
  against the fixture. Autosave is on a 5s timer, so wait past it before reading.
- The away-summary modal renders a full-screen backdrop labelled *Close* that
  eats every click on the lot. It appears whenever the injected save's
  `lastSeenAt` is more than a minute old — stamp it to `Date.now()` at inject
  time, or dismiss "Back to work" first.
- Chromium is at **`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`**, not
  `/opt/pw-browsers/chromium`, which is a file rather than a directory.
  `playwright` must be required from the repo root to resolve.

## Deployment

**SHIPPING IS THE DEFAULT. The owner's standing instruction: when they ask for
something to be built, assume it goes all the way to production** — branch,
commit, and merge to `master` so Pages rebuilds — **unless they say "let's plan"
or "planning"**, which means stop at a proposal. Do not leave finished work
sitting on a feature branch waiting to be asked, and do not make them choose a
merge strategy: they are not here to operate git. Say what went live and what
they will see.

The one thing still worth flagging rather than doing silently is anything that
would *destroy* something — a save-breaking change, a force-push over somebody
else's work. Shipping is not in that category.

Pushing to `master` builds and publishes to GitHub Pages via
`.github/workflows/deploy-web.yml`. The export writes absolute asset URLs, so
`app.config.js` sets a base path from `EXPO_WEB_BASE_URL`, which the workflow
derives from the repo name. Without it the deployed page 404s its own bundle and
renders blank with no error.

Only `master` triggers it. Pages serves one site, so a feature branch in that
trigger list silently republishes over whatever `master` deployed — if you ever
need a branch preview, build it somewhere that is not the live site.

## Open questions

- **Two things only playtesting can answer**, both live now:
  - Is Closing's third counter (level 6) stronger than the harness can see? The
    bot never uses it, so its upside is genuinely unmeasured.
  - Does a ~28% bad-buy rate read as a fair judgement call or as a coin flip?
    That number is the health metric for the whole appraisal system.
- **Wrenching's ceiling is under-argued.** It was held low waiting for the
  ambiguity to act as a deflationary counterweight; it doesn't — widening the
  ask band helps a selective buyer, so the appraisal rework came out
  *inflationary*. The caps were raised once on their own merits and could go
  further, at roughly +8% end cash per step.
- **Buying grants no throughput**, which departs from the original "locate more
  cars as you level" brief. Both levers were built and measured and both are
  simply money (see above). The machinery is intact and tested — raising either
  `atMax` in `BALANCE.skills.buy` turns it back on.
- **The collections ladder still caps the book at 43 contracts at every stage.**
  `collections` maxes at level 5 and the stage table does not touch it, so a
  premium franchise carries exactly as much paper as a small lot — only each
  contract is worth ten times more. That is defensible (the desk is the desk) but
  nobody has argued it, and "the loan book is the game" sits oddly next to a book
  whose *count* never grows. A per-stage capacity term in `STAGES` is the obvious
  lever if it needs one.
- **Nothing on the ladder is a per-stage sink yet.** Staff cost more to rehire,
  but there are no ongoing costs at all — no rent, no salaries, no floorplan
  interest. That is why the franchise stages are pure upside once you clear the
  entry cost. Recurring cost is the natural next mechanic and would make the
  working-capital floor mean much more than it currently does.
- **Buying goes dead at the top.** `appraisalSigmaMult: 0` retires the appraisal
  on all three franchise stages, so a maxed Buying skill buys nothing there. That
  is the intended character change, but it does leave a levelled skill inert for
  the back half of the game. If that reads badly in play, the honest fix is to
  give Buying a franchise-side effect (allocation throughput, say) rather than to
  put fake uncertainty back on a new car.
- **The late game is no longer hot; stage 1 may now be too slow.** End cash is
  ~$503k at hour 4, down from $1.36M across two retunes. The standing complaint
  is resolved, but the stage-2 gate moved from 48m to 1h11m, and a 70-minute
  tutorial is a lot to ask before the game changes shape. If that needs
  shortening, `lotPurchaseCost` is the honest lever — it targets stage 1 without
  undoing the negotiation change. Needs a human playing it.
- **Fifty levels is a shape nobody has felt yet.** The retune keeps a maxed
  skill worth exactly what it was and hands out level-ups roughly three times as
  often early, which is the trade it was chosen for — but the harness can only
  say that pacing did not move. What it cannot say is whether a 4h run finishing
  in the high twenties reads as "still climbing" or as "will never get there",
  and whether the shallower per-level step still feels like a reward. Needs a
  human playing it. `maxLevel` and `xpGrowth` are both in Office → Admin, which
  is the fastest way to try a different length.
- **The three house rules are unmeasured by design.** The harness bot runs them
  all at their defaults, which is what makes the cap's measurement clean — but it
  means nothing here bounds what a player gets from setting them. The repo
  trigger in particular trades collections against recovered condition, and
  CLAUDE.md's own warning applies: the harness separates the mild band from the
  strong band and nothing finer.
- **A fourth skill for the paper side** — collections, levelled by payments taken
  and repos worked — is the obvious next one. `skills` is a `Record` so it needs
  no reshaping, and skill levels are the natural carry-over currency if a
  prestige layer ever lands.
- **Tone.** The repossession loop is mechanically the best thing in the game and
  describes a genuinely predatory real-world practice. Leaning into that
  knowingly reads sharper than playing it straight. Mostly a writing decision,
  and it is the user's call to make.
