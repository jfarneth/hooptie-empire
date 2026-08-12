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
player set five house rules the business then runs under offline: a working
capital floor, the repo trigger, the retainer buyer's minimum margin, and the
least margin the sales desk will sign for **in cash and on paper**.
`src/sim/business.ts` resolves them, and every one of them is a slider now.

**The two sales floors are SIX HARD NUMBERS PER STORE**, tabulated in
`STAGES[].dealFloors` and set by a slider whose levels — Scraping by, Thin, Fair,
Good, Strong, Steals only — index straight into that table. They shipped
denominated in standard deviations off the store's derived margin distribution,
which solved the right problem (a flat percentage is meaningless across a
thousandfold ladder) and created a worse one: **the yardstick moved every time
the economy did**, so a rule a player set once and stopped looking at quietly
meant a different number after the next retune. A house rule is a promise; it is
written down now. Read the `dealFloors` header in `stages.ts` before touching
this panel. Three things carry it:

- **The price of tabulating is a guard test**, in `margins.test.ts`, and it is
  mutation-tested in both directions: a ladder must stay monotonic, must put
  stops either side of an ordinary deal at any reach level, and must top out
  under the best margin the store's own feed can produce. Move the economy far
  enough and it goes red. **The suite is only half of it** — `npm run sim`
  prints each stop against the share of a real feed it lets through, and that
  column caught three franchise ladders with dead stops at the top that every
  unit test passed. Read it after any margin work.
- **Paper needs its own ladder.** A contract grosses the window price and
  collects part of it, so an average note at a small lot is worth 33% where the
  average cash deal is worth 19%. One shared set of stops would leave the bottom
  half of the finance slider doing nothing. The two converge at a Valmont store,
  which is `bhphMultiplier` telling the truth.
- **"Take any deal" is level 0 and has to be its own stop**, not the bottom of
  the ladder — the bottom stop is a real rule at every store (break-even at a
  curbstone, 5% at a Halvorsen), so backfilling a save onto it would hand it a
  floor it never agreed to.

`src/sim/margins.ts` is still the derived per-store distribution, and it still
earns its place — it is the YARDSTICK now rather than the rules: the panel quotes
a fixed stop against it ("about an average deal here"), the buy slider takes its
grain from it, the harness prints measured against predicted, and the guard test
above measures the table with it.

## Working fast here

The owner's standing complaint, and the thing to protect: **a change to this game
should take minutes, not an afternoon.** Five rules, all of them learned by
breaking them.

- **Match the verification to the change.** The table in the Verify section is
  the contract. A UI change does not need the balance harness; a stage-shaped one
  does. Running everything every time is how a slider became half an hour.
- **Long runs go in the background.** The ladder is 2m45s of nothing to watch.
  Start it, keep working, read it when it lands.
- **Never re-run something to confirm it.** Two runs of one build measure
  determinism, which is settled. If a measurement looks wrong, fix the
  measurement and run once — do not run both.
- **Answer questions with one command, not a fleet.** Most questions about this
  repo are a `grep`, a `git log -S`, or one harness run. Spinning up parallel
  investigators to answer "why is this slow" costs more than the thing being
  investigated.
- **Only install what the change needs.** Playwright and a browser are worth it
  when you are changing something you have to LOOK at — and CLAUDE.md is emphatic
  that you should look — but they are three minutes that a pure-sim change never
  needs to spend.

`.claude/settings.json` runs `npm install` on session start, so a fresh container
is warming up while you read this rather than blocking your first command.

**Every car carries a trim grade** — common, rare, epic, legendary at
90/9/0.9/0.1 — and it is worth 10% more of the car at each step. `src/sim/rarity.ts`
is the table and `docs/rarity-plan.md` is the design record with every
measurement behind it. Two one-line seams carry the whole feature and only mean
anything together: `conditionFreeValue` multiplies by the grade, and
`spawnListing` prices the ask against `baseTrim(car)`. Scale both and rarity is
worth exactly zero; scale neither and it is paint.

**The working-capital floor is the player's own, and it is the ONLY floor.**
The automation reserve used to be `max(player floor, weeks of expenses, price of
N cars)`; the two hidden terms are gone, and with them the era of "why isn't my
buyer buying" having an answer the game refused to show. The Business panel
quotes the weekly bill directly above the floor selector, and **every bill now
charges in full — cash goes negative honestly.** The shark lost his monopoly on
the minus sign; what he keeps is a schedule nothing but retirement stops.

**Sales staff work for a cut.** The `salesDesk` upgrade is the curbstone
**business partner** (no salary, 50% of profit on deals he closes) and the
salaried **sales manager** above (thinning cut per stage, in `STAGES[].desk`).
Staff wait out a 30-second grace window (`BALANCE.desk.graceMs`) before closing
any walk-up — grab the deal yourself inside it and every dollar is yours. That
one asymmetry is both the active-play incentive and the offline brake: nobody
taps while the app is closed, so overnight sales all pay the cut, and the
measured wake-up at a curbstone fell from $1.09M to $526k — the "sleep past two
stores" bug, dead. `docs/offline-plan.md` is the full measurement record.

**Thirty seconds is the ceiling, and the constant that sets it lives in another
section of `balance.ts`.** Prospect patience is 45s ±30%, so the least patient
buyer in the game leaves at 31.5s — and `stepProspects` sweeps the expired
*before* `stepAutomation` runs the desk. A window at or past that floor does not
change who closes the deal, it deletes the deal: nobody serves that buyer at
all, and offline it is the whole night's takings for the impatient tail. Two
tests in `desk.test.ts` hold the line, one on the inequality and one on the
behaviour, and both go red at 32s. The window was 20s and is 30s because half a
minute is long enough to notice a buyer, open the sheet and work the slider,
where 20s rewarded reflexes. **The harness cannot see this change at all** — the
bot closes on its own turn whether the window is 20s or 30s, so a continuous run
diffs byte-identically; the only thing the window could have moved is buyers
expiring in the gap, which is the thing those two tests forbid.

**A walk-up's offer is colour-coded on the lot: red lowball, amber ordinary,
green near your ask.** `readOffer` in `haggle.ts` is the whole of it, and the
bands (0.87 and 0.93 of the ask) are measured rather than picked round — with
cars listed at retail the opening offer runs 0.80–1.00 with a median of 0.895,
so that splits about 33/47/20 and amber is the ordinary case. It is a READ, not
a rule: nothing in the sim consults it and no price moves. Two things about it
worth keeping. It is measured **against your ask**, so overpricing a car really
does draw redder buyers — the overpricing lowball and the colour are the same
fact seen twice — and it is deliberately **not** a function of profit, which
would go green on a car you stole whatever the buyer was doing. The deal sheet
paints the cash headline the same three colours, so the thing that made you walk
over means one thing on both screens.

**How long a car sits is a property of the STORE, not of the game.**
`STAGES[].trafficPerCar` is walk-up traffic per listed car, 1.0 at the curbstone
falling to 0.5 at the franchises, and it is what stops a forty-car lot running
forty arrival processes side by side and turning its whole stock over in three
days. A car is listed for about a week now at every rung. Dwell is bought with
throughput and paid for nowhere else — see the Verify section before touching it,
because the obvious alternatives were measured and do not work. The player's half
of it is the car sheet: **days on the lot**, and a wholesaler who will take
anything today at `forcedSaleRate` (`sellToWholesaler`), which is the release
valve that stops dead stock being a stuck stall.

**How far you buy from is an upgrade, and it is what makes a big lot fillable.**
`src/sim/market.ts` has three tiers — local, regional, national — sold as the
`reach` upgrade from the large lot up. Each one ADDS supply on top of local (it
never replaces it, so buying it can never hurt) and each shipped car carries a
flat freight bill into its cost basis. This exists because the feed is a fixed
number of listings per minute and the lot is not: measured, every store above
the small lot plateaued at ~23 cars whatever its capacity, and a midsize
franchise ran **43% full with nothing worth buying on the feed 100% of the
time** — paving another row bought literally nothing. See the Verify section.

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

## Trim grades

**Rarity is PUBLIC. Condition is PRIVATE. That asymmetry is the whole design.**
You can see a spoiler and a lift kit, so a grade carries no appraisal noise, no
band and no sigma — `appraisedCar` passes it through untouched and
`appraisal.ts` never mentions it. It is what keeps the line the rest of the game
draws between what an operator could know and what they could not, and it is
what makes a graded car a decision (is it worth the lot slot?) rather than a
lottery.

**The multiplier belongs in `conditionFreeValue` and nowhere else.** That is
already the basis for anything scaling with how much car is present, so retail,
wholesale, the finance window, recon cost, recon value gain, the forced-sale
haircut and the traffic reference all price a spoiler correctly from one
multiply. Recon ROI comes out flat across grades because cost and value gain
scale together — which is right, and is the tell if the multiplier ever lands in
only one of them.

**`raritySellerCapture` is per stage, and it is not a nerf.** Zero on the used
stages: a Tuesday dealer auction does not charge for a spoiler and the wholesale
book has no column for one. 0.7 on the franchises: a manufacturer genuinely does
list the trim package on the invoice. Measured at 8 seeds over 350h, leaving the
franchises at zero pulled the premium store in from 318h to **218h** and doubled
lifetime profit — a different game, not a feature. At 0.7 the top sits 15% inside
baseline, which is inside the band this harness can resolve at all.

**Leaving franchise capture at zero also fixes the premium-franchise flatline.**
Baseline at 350h is cash $0, portfolio $0, book 0/8 — the top open bug below,
reproduced exactly. With the franchise premium free it is $62.3M cash and a full
43/43 book. That is NOT shipped, on the grounds that rarity should not be a
stealth economy patch, but it is one slider in Office → Admin and it is now the
cheapest known lever on that bug.

**The trim is an OVERLAY, and an overlay can only add.** `RarityTrim` composites
over whatever drew the car, because baking rarity would take the sprite matrix
from 81 frames to 324 and needs a Blender pipeline a normal checkout cannot run.
The consequence is a real design constraint: a *lift* was the obvious treatment
for a modified truck and it cannot be drawn, since the overlay cannot raise a
body it did not draw. Fender flares and a roof light bar say the same thing
additively and, unlike ride height, actually read from directly overhead. Two
passes — underglow beneath the car, everything else on top.

**The two renderers do not frame a car the same way, and assuming they do puts
spoilers in mid-air.** The artboards agree on aspect to 0.06%, which is what the
plan assumed was enough; measured, the sprite's sedan fills 85% of its frame
where the vector drawing fills 73%, and a coupe goes the other way. `footprint.ts`
carries a table per renderer, and `tools/measure-sprites` regenerates the sprite
half by reading the committed PNGs through headless Chromium — no Blender, no
Python imaging stack. The shape tables live in `art/vector/shapes.ts` rather than
inside the components so that anything needing to know where a bootlid is does
not have to import `react-native-svg` to find out.

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

## The desk works for a cut

Rules that carry the mechanic, each with a test named for it in `desk.test.ts`:

- **The cut hangs on WHO CLOSED, not on attendance.** `acceptCash`/`acceptFinance`
  take a `closer` param; the desk paths pass `'desk'`, every player action stays
  `'player'`. Offline every sale is a desk sale by construction, so the brake
  needs no attended/unattended flag, no amendment to the offline-is-real pillar,
  and leaves no leave-the-app-open exploit — a lit screen earns nothing unless
  you actually tap deals.
- **Commission is a share of PROFIT at signing, never of price.** Curbstone
  margin runs ~25% of the sale price, so a cut of price is four times sharper
  than it reads. Floored at zero (a loss is all yours) and capped at the cash
  the deal actually produced, so on a financed deal it can never take the till
  below where it stood — only the shark goes below zero.
- **`arrivedAt` is stamped, `claimed` is state.** The grace window counts from a
  stamped clock (same rule as a promotion's `endsAt`), and opening the deal
  sheet claims the prospect so staff can never sell a car out from under the
  slider the player is holding. Both are in the tick fingerprint.
- **The harness bot closes everything inside the window**, so continuous runs
  report `staff commission $0` — correct, not broken. `--cadence=15:240` is the
  mode that measures a real person (bursts of play, hours away); measured at
  36h it shows the partner taking ~$589k of a $1.29M gross. The overnight rig
  lives in the offline-plan doc.
- **The v11→v12 migration backfills `arrivedAt: 0`** so in-flight prospects on
  old saves close old-style (instantly) rather than being granted a window they
  never had. Desks on existing saves start charging from migration forward —
  terms change on a bought upgrade, deliberately; nothing held is destroyed.

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
his dollar figure, take it or leave it. His weekly payment rides `stepBills`. Every
bill drives cash below zero now, so what distinguishes his money is no longer
the minus sign — it is the schedule: rent stops when you move and wages stop
when staff reset, but the shark's payment survives everything short of
retirement, where he is settled from the proceeds even if that leaves a zero on
the board. There is no missed-payment state — the schedule simply runs and the
hole deepens until the player recovers or quits.

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
| Curbstone | 0.80–1.42 | +41% to **−5%** |
| Small used | 0.84–1.38 | +38% to **−2%** |
| Large used | 0.90–1.30 | +33% to +4% |
| Low-cost franchise | 1.16–1.24 | +14% to +8% |
| Midsize franchise | 1.20–1.27 | +11% to +6% |
| Premium franchise | 1.23–1.29 | +9% to +4.5% |

The percentage falls as the dollars rise, which is what makes the top a volume
business and the bottom a judgement one. **This table was stale for the three
used stages until the trim-grade work re-derived it** — it still quoted the bands
from `43aa751`, which `d1625bd` ("bring used margins back to earth") had already
raised, so it claimed a +54% best case against a build delivering +41%. Numbers
in prose rot exactly like dead constants do. Two measured facts about it:

- **Widening the early band costs nothing in pace.** Going from 0.8–1.2 to
  0.62–1.42 left the stage-2 milestone flat (2h36m → 2h29m). A selective buyer
  is *helped* by a wider spread — more junk to skip, but better cars when they
  land. What it buys is character, not slowdown: the band only sets the stakes,
  and the appraisal decides whether a given car actually loses money.
- **Thinning the franchise band is enormous.** Cutting franchise margin from
  15–22% to 4.5–14% moved the midsize milestone 49h38m → 76h03m and pushed
  premium out past 350h. If the late game needs to move, this is the knob.

**The automation reserve is the player's floor, full stop.** It spent a year as
`max(player floor, weeks of expenses, price of N cars)` — protective terms added
when bills floored at zero and a broke business froze silently forever. Both
hidden terms are gone, deliberately: an invisible safety rail was exactly why a
player with $30k, a hired buyer and a floor of zero could not tell why nothing
was being bought. The floor selector now quotes the weekly bill beside it, and
what to keep back is the player's call, informed and theirs to get wrong.
`reopeningFloat` (the ladder gate) still sizes itself in cars — that one is a
property of moving stores, not of automation, and it kept the bug the old
reserve caused out of the move path.

**The premium flatline is FIXED, and the diagnosis was not the one this file
spent months assuming.** The 350h end state reads **+$7.4M cash, a $1.9M
portfolio and a full 43/43 book**, against −$45.2M, $0 and an empty book before.
It was never the margin. Three things were killing it, and all three were
capitalisation rather than economics:

- **The store opened insolvent.** `reopeningFloat` demanded a flat six cars at
  every rung — three driveways' worth at a curbstone and one seventh of a lot at
  a Valmont store. Nothing waits once a move is affordable, so that figure IS the
  balance a store opens with: the premium franchise was reached with $70M spent
  on the keys and **$21,233** left, against $86,000 cars and $20,000 a week of
  rent. Six cars gross about $21.6k a week there and the bill is about $22.4k, so
  it opened under water by a margin too thin to see. It is now sized against the
  stalls and the entry cost (`reopeningLotShare`, `reopeningCapitalShare`).
- **The move destroyed the loan book.** The collections desk was staff, so it
  reset — and a full 43-note book landed 2.9x over a fresh desk's capacity, where
  `overCapacityFactor` pinned the miss chance at its 2.2x ceiling and defaulted
  the entire portfolio inside a game month. Measured: $71.5M and 43/43 at 293h,
  zero notes and zero portfolio at 295h. "The book moves intact" was a sentence
  the game did not honour. `collections` now carries on a move — see
  `carriesOnMove` in upgrades.ts, which is the only exception on the table.
- **The bot rebuilt the office before it stocked the lot.** A harness-brain bug,
  but the same trap a player walks into: it kept back four cars' worth, which is
  a lot at a curbstone and a rounding error at a franchise, then ran five cars on
  a thirty-two stall lot against the payroll it had just hired.

This is why widening the franchise ask band read as a CLIFF rather than a dial
during the retune: anything under about eight points of extra margin left the
store dead and anything over it left the store compounding without limit ($658M
to $1.4B at 350h). A knife-edge like that is the signature of a fixed cost that
is not being covered, not of a margin that needs tuning. **The shipped franchise
ask bands are unchanged.**

The escape hatches are unchanged and both still work: walking down the ladder is
free and ends the rent, and retirement settles everything. The
`raritySellerCapture` lever noted during the rarity work is still there and still
not shipped, and it is no longer needed for this.

The ladder is completable — 8/8 seeds buy the premium store, now at ~315h
against ~264h before, and the business **keeps trading** rather than bleeding to
−$45M. Later and alive is the trade, and it is the right one. Note that
`broke, lot empty` still reads ~98% of the run: at the top a car costs $86k, so
"cannot afford the cheapest listing on the feed" is the normal state of a
healthy business up there and is no longer a distress signal on its own — read
cash, the book and the portfolio instead.

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

**Cash at zero used to be an ABSORBING state; now it is a visible hole.** Under
the old floored bills, a business at $0 paid nothing, earned nothing, and froze
forever — the first cut of running costs killed 12 of 16 harness seeds that way,
and the diagnostic was **identical lifetime profit under different expense
settings**, the signature of `Math.min(cash, bill)` charging nothing. Bills now
charge in full and the balance goes where it goes, which retires that entire
failure mode: a business that cannot make rent shows a negative number, keeps
its buying gates shut (`cash >= price` everywhere), and digs out by selling
stock and collecting payments — both of which work at any balance. The old tell
is dead too, in the good way: expense settings always show up in profit now,
because they always charge.

Two of the three original spiral guards remain, because they guard the *move*
rather than the till: **`reopeningFloat`** — the ladder will not let you move
without enough to restock the new lot, a property of the TARGET store only
(charging for the store you leave scales with what you own and stalls the bot
forever); and **the harness bot keeps restock money back** before rebuying
upgrades, which is the bot's brain rather than the game's rule. The third guard
— the hidden automation reserve — is gone; see the working-capital note above.

## Verify

**MATCH THE VERIFICATION TO THE CHANGE. This is a rule, not a suggestion**, and
it is here because the opposite convention — run everything, every time — is what
made a one-line UI change cost half an hour. The harness is the slowest thing in
this repo by two orders of magnitude; reach for the expensive tiers only when the
change can actually move what they measure.

| the change touches | run |
|---|---|
| UI only (`src/ui`, screens, components) | `npm test`, `npm run typecheck`, and **look at it in the browser** |
| `src/sim` but not pacing (a new field, a migration, plumbing) | the above, plus `npm run sim` (~3s) |
| pacing below the franchises (traffic, negotiation, skills, recon) | plus `npm run sim -- --seeds=64` (~15s) |
| anything stage-, margin- or ladder-shaped | plus the whole ladder (~2m45s) |

```bash
npm test        # 388 tests, ~8s
npm run typecheck
npm run sim     # balance harness — 4h of simulated play in ~3s
npm run sim -- --hours=350 --seeds=8   # the whole ladder, ~2m45s

# A/B a change against an IDENTICAL RNG stream by zeroing the new feature's own
# constant, rather than against the previous build — which measures the reshuffle
# from any added draw as much as the change itself.
npm run sim -- --seeds=64 --set=balance.rarity.valueStep=0
```

**Seeds run one per core (`--jobs=N` to override, `--jobs=1` for the old serial
path), which took the whole-ladder run from 11m30s to 2m45s.** Seeds are
independent by construction — each builds its own state from its own RNG — so
this changes the wall clock and NOT one number in the report; there is a
`--jobs=1` diff proving it. If you ever see parallel and serial disagree,
something has grown shared state between seeds and that is a real bug, not a
harness artefact. Note the crossover: a worker takes a SLICE of the seeds rather
than one seed, because node's ~0.7s start paid per seed cost more than the whole
default run.

**Run the long one in the background and keep working.** It is 2m45s of nothing
to watch. Blocking on it — and worse, running it twice because the first pass
measured the wrong thing — is most of what makes a change feel slow.

**Do not re-run the ladder to confirm a run you already have.** Two runs of the
same build tell you the harness is deterministic, which it is. If the question is
"did my change move this", the comparison is against a DIFFERENT build or a
`--set=` A/B on the same stream; if the question is "where does the ladder sit",
one run answers it.

The ladder at `--seeds=8 --hours=350`, reached by 8/8 — **re-measured after the
dwell retune** (per-store traffic, the reopening float, and the collections desk
carrying across a move). `trafficPerCar` has a constant to zero, so setting every
stage back to 1 reproduces the previous build on an identical stream; the float
and the desk do not, so treat the deltas as cross-build:

| | before dwell | dwell only | shipped (with reach) |
|---|---|---|---|
| Small used dealership | 2h28m | 2h32m | ~2h32m |
| Large used dealership | 5h43m | 6h34m | ~6h34m |
| Low-cost franchise | 10h30m | 11h52m | ~10h27m |
| Midsize franchise | 44h13m | 49h46m | ~39h18m |
| Premium franchise | 264h29m, then dead | 320h34m | ~212h18m, **still trading** |

The reach column is a true A/B — `balance.market.supplyScale=0` leaves only
local stock and reproduces the middle column on an identical RNG stream, because
the feature consumes no draw until it is bought.

**That shipped column was re-run unchanged after the sales floors landed**, to
the minute on every rung and to the dollar on end cash, which is the property to
preserve: the two new rules default to "any deal" and cost the sim nothing until
somebody moves one. A 16-seed 4h run diffs byte-identically against the build
before them.

Every rung is 5-15% later and the top one is a different game: it used to arrive
at 264h and flatline at −$45.2M, and it now arrives at 315h with +$7.4M, a $1.9M
portfolio and a full 43/43 book. Later and alive is the trade.

**Days on the lot is now a harness metric, and it is the one to watch for
anything touching demand.** `npm run sim` prints p50/p90 per store and the share
of cars gone inside a single game day. Before the retune a car was listed 4.5
days at a small lot and **3.5 at a franchise** — the conveyor got FASTER as you
climbed, and one car in seven was gone inside a day, which is a vending machine
rather than a dealership. Shipped:

| store | before | shipped |
|---|---|---|
| Curbstone | 6.3d | 6.5d (untouched) |
| Small lot | 4.5d | 7.3d |
| Big lot | 3.7d | 6.9d |
| Halvorsen / Okabe / Valmont | 3.5-4.2d | 6.5-7.2d |
| sold inside one game day | 10-15% | 7-8% |

**`npm run sim` prints the feed's margin distribution against the model that
predicts it**, per store, and that column is the guard on the whole business
panel: the panel quotes every hard-coded sales floor against this distribution
("about an average deal here"), so a derivation that has drifted from the game
is describing a stop it has never seen. Measured at 8 seeds over 350h the two
agree to within a tenth of a point at every rung:

| store | measured | predicted |
|---|---|---|
| Curbstone | 18.6% ±13.2 | 18.7% ±13.4 |
| Small lot | 18.8% ±11.8 | 18.7% ±11.7 |
| Big lot | 15.3% ±9.9 | 15.5% ±9.3 |
| Halvorsen | 9.3% ±2.6 | 9.4% ±2.5 |
| Okabe | 7.4% ±2.1 | 7.4% ±2.0 |
| Valmont | 6.4% ±1.6 | 6.4% ±1.6 |

Freight is in both columns and it has to be, because it is drawn per listing:
`margins.ts` carries a spread on the haul as well as a mean, and without that
the big lot predicts ±8.8 against a measured ±9.9 — the kind of miss that reads
as noise and is not. The big lot is the loosest row for the same reason; it is
the store where reach is bought partway through, so the freight the model
averages over is not the freight in force for the whole time spent there.

**`npm run sim` also prints every sales-floor stop against the feed it has to
let through**, and this is the guard that lives outside the suite. The floors
are hard numbers per store now, so nothing follows a retune on its own — and a
stop's *percentage* being fine tells you nothing about whether it is a position
worth having. Measured at 8 seeds over 350h, the share of each store's own feed
that clears each stop:

| store | Scraping by | Thin | Fair | Good | Strong | Steals only |
|---|---|---|---|---|---|---|
| Curbstone | 0%: 90% | 8%: 74% | 15%: 59% | 22%: 42% | 30%: 24% | 40%: 3% |
| Small lot | 0%: 95% | 8%: 77% | 15%: 60% | 22%: 42% | 30%: 22% | 40%: 1% |
| Big lot | 4%: 87% | 9%: 71% | 14%: 55% | 20%: 35% | 27%: 13% | 36%: 1% |
| Halvorsen | 5%: 96% | 7%: 80% | 9%: 54% | 11%: 26% | 13%: 8% | 15%: 1% |
| Okabe | 4%: 95% | 6%: 74% | 7%: 56% | 9%: 22% | 10%: 11% | 12%: 2% |
| Valmont | 4%: 94% | 5%: 78% | 6%: 57% | 7%: 36% | 8%: 15% | 10%: 3% |

**THE FIRST CUT OF THAT TABLE PASSED EVERY UNIT TEST AND WAS STILL WRONG**, and
it is the reason this column exists. The three franchise ladders read
`13%:8% 15%:1% 18%:0%` and `12%:2% 15%:0%` and `10%:3% 13%:0%` — two slider
positions at the top of each that both meant "stop selling cars", plus a Valmont
bottom stop at `3%:100%` that could never bite. Every one of them satisfied
monotonic, opens-below-the-average and tops-out-under-what-the-store-can-produce,
because the share of a real feed above a threshold is not something a closed
form over the ask band can see. Read this column after any margin work; a stop
at 0% or at 100% is a slider position doing nothing. Cash only — the finance
ladder is denominated in expected collections per contract, which is a property
of a walk-up's credit rather than of a listing, so the feed cannot measure it.

**A LOT IS ONLY AS BIG AS ITS FEED, and this is the table to read before
touching capacity, the feed, or anything that sounds like "why is the lot
empty".** `npm run sim` prints held/stalls per store and, when a stall is empty,
whether it was because there was nothing worth buying or nothing to buy it with.
The plateau at ~23 cars is the feed rate, and it is why `reach` exists:

| store | local only | with reach | empty because feed dry (local only) |
|---|---|---|---|
| Curbstone | 97% full | 97% | 1% |
| Small lot | 93% | 93% | 1% |
| Big lot | 76% | **99%** | 76% |
| Halvorsen | 55% | **100%** | 98% |
| Okabe | **43%** | **100%** | 100% |
| Valmont | 40% | **98%** | 92% |

Cash was never the constraint up there — 0-6% of turns — which is the whole
diagnosis in one column. Note the first two rows do not move: reach is not sold
below the large lot, and those stores fill from their own town already.

**Dwell is bought with throughput and there is no way around it.** Inventory on
the lot is the sale rate times the dwell time, the lot is capacity-bound or
cash-bound at all times, so halving traffic halves sales — measured, a flat 0.75x
traffic cut took stage 2 from 2h30m to 3h06m. Holding more cars instead does NOT
work and was measured too: doubling capacity at the first two stages took
`broke, lot empty` from 18% of turns to 40% and dwell went DOWN, because the
constraint is the till and not the tarmac. The curbstone keeps `trafficPerCar: 1`
for exactly this reason — stage 1 is already the longest-dwelling store in the
game and the slowest rung, so it had nothing to give.

The trim-grade A/B (same build with `valueStep=0`, so both columns shared one
RNG stream) put the trim premium at ~10% on the used rungs and less up top,
where the invoice prices most of it in. That A/B — zero the feature's own
constant rather than comparing builds — is still the model for measuring a
feature against itself.

The first three rungs came in by 45%, 18% and 6% when `typicalCarPrice` was
fixed — see the regression note below. That decay up the ladder is the shape to
expect from that fix and is how you can tell it is the cause: the number was
only ever wrong on the used stages. The bottom two rungs are the ones to re-read
if anyone wants the old pacing back, and `reopeningCars` is the honest lever for
it.

Measured at `--hours=350 --seeds=8`, because the ladder does not fit in 32h.
Roughly a tripling per rung, steepening sharply at the top — the shape to
preserve. A default 4h run no longer reaches large used at all, so **`npm run
sim` with no flags says nothing above stage 2** — use `--hours=32` for the used
rungs and the low-cost franchise, and the 350h invocation for the top two.

Targets **at `--seeds=64`** over the default 4h, which is the number to quote and
compare against for everything below the franchise:

| | |
|---|---|
| stage 2 reached | ~2h26m (64/64) |
| first note written | ~2h28m |
| first repossession | ~2h59m |
| first note paid off | ~3h20m |
| $100k cash | ~2h19m |
| $50k portfolio | ~2h35m |
| walk-away rate | ~60.5% |
| bad-buy rate (true loss: `price > retailValue`) | ~1.1% |
| appraisal error | ~7.0% |
| Buying / Closing / Wrenching to level 5 | 38m / 31m / 33m |
| end cash at 4h | ~$40k |
| end portfolio at 4h | ~$260k |
| lifetime profit at 4h | ~$548k |
| cars sold at 4h | ~301 |
| days on the lot (curbstone / small lot) | 6.1d / 7.3d |
| lot at capacity | ~79% of the run |

Cars sold and lifetime profit are DOWN by about a quarter and a third against
the pre-dwell build (419 → 301, $800k → $548k) and that is the feature, not a
regression: fewer cars, held longer. The milestone barely moved (2h21m → 2h26m)
because the curbstone stage is untouched.

**This table has been badly stale twice** — once when it outlived the
running-costs and margin work (claiming stage 2 at ~1h11m against a build
delivering ~3h54m), and once when everything in it turned out to be measured
through the wholesale-gated buyer. It is worth knowing that happened, because
the file's own advice — always state the seed count, never compare across
builds — is exactly what stops it happening again. The buyer fix brought the
first repossession, the first note paid off and the portfolio milestones back
inside the 4h window, which is why they are quoted again after a spell out of
the table.

**Always state the seed count.** Seed count moves these numbers further than most
features do, and comparing a 6-seed run against a 64-seed target is the single
easiest way to conclude you broke something you didn't.

End cash at 4h is low and that is not a regression: the snapshot lands
mid-climb at the small lot — the large used store is bought at ~5h43m, outside
the window — with the till ploughed into stock and the book while the bot
accumulates toward the next rung. Cash is the residual after restocking and
the most volatile number in the table; read `lifetime profit` (~$800k) for the
health of the economy and the ladder table above for pacing.

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
  longer: appraisal error 7.8% → 9.6% and bad-buy rate 21.5% → 25.1% — both
  quoted under the old over-wholesale definition of a bad buy, which was
  retired with the buyer's retail gate.
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
- **House rules are sliders whose ENDS are derived per store.** This panel
  shipped as rows of discrete chips, on the argument that a limit survives an
  eight-hour absence in a way a fine-grained dial does not. That argument was
  half right and it was overturned deliberately: the limits are not the same
  size at every store, and a fixed set of stops on a ladder that moves a
  thousandfold is either uselessly coarse at one end or absurd at the other —
  `$50k` was the top working-capital chip, which is a fortune on a driveway and
  under three weeks of rent at a Valmont store. What survives of the original
  argument is the part that mattered: a setting still has to mean something you
  can reason about while away, which is why every stop on the two sales floors
  is a named level with a fixed percentage behind it, quoted back in dollars.
  Every default still reproduces the pre-suite build exactly, which is what
  makes the migration safe.
- **A RULE THE BUSINESS RUNS ON MUST NOT MOVE WHEN THE ECONOMY DOES.** The sales
  floors shipped in standard deviations off the store's derived margin
  distribution, and that was overturned for the reason the σ scale itself was
  never able to answer: the yardstick moved with every retune, so the setting a
  player made once and left running silently meant a different number a week
  later. They are levels on a hard-coded per-store ladder now
  (`STAGES[].dealFloors`), which keeps the property σ was chosen for — the same
  level means the same posture at a curbstone and at a Valmont store — and adds
  the one it could not give: the number does not change under the player. What
  it costs is that the table no longer follows a retune on its own, and that is
  paid for by a mutation-tested guard in `margins.test.ts` plus a measured
  column in `npm run sim`.
- **A rule the desk applies is a LEVEL; a price the buyer pays is a MARGIN.**
  The two sales floors are stage-RELATIVE (stored as a position on the store's
  ladder, so "better than average here" keeps meaning that when you move store)
  and the buyer's minimum margin is ABSOLUTE (stored as a plain margin, because
  "do not pay more than it is worth" is a price, and the default — break-even
  against the worst case — is a specific number rather than a posture). The
  ladder still sets the ENDS of the buy slider, which is what makes its range
  mean something at every rung.
- **"Take any deal" is a stop, not a small number.** Both sales floors default to
  level 0, which is the ABSENCE of a floor rather than a lenient one. It has to
  be its own position because the bottom stop is a real rule at every store —
  break-even at a curbstone, 5% at a Halvorsen — so a save backfilled onto it
  would arrive holding a floor it never agreed to and stop selling its ordinary
  bad days. Both the v13 → v14 and v14 → v15 migrations write the off value
  longhand for exactly this reason.
- **Paper is judged on what it collects, and on its own scale.** The finance
  floor compares the contract's expected value against the metal, not the
  sticker — so raising it makes the desk write SAFER paper rather than simply
  less of it, which is the underwriting lever the credit note below has always
  wanted. It also gets its own LADDER: a financed car leaves at the window price
  and only part of it is collected, so the average contract at a small lot is
  worth 33% where the average cash deal is worth 19%. Sharing one set of stops
  would have left the bottom half of the finance slider doing nothing and had
  the panel describe routine subprime as "a steal". The multiple is not
  always above 1: at a premium franchise it is 0.997, because the window markup
  is 1.15 there and collections eat more than that. Paper stops being a premium
  at the top of the ladder, which is what `bhphMultiplier` has always said.
- **A refusal is not a walk-away.** A deal under the floor is simply not closed:
  the buyer stands there, nothing is logged, and they leave when their own
  patience runs out. And the desk will not COUNTER on a deal it could never
  sign — countering costs walk-aways and buys nothing if even the asking price
  falls short. Both have tests named for them; without the second, a strict
  floor would read as a broken negotiator and would quietly poison the
  walk-away rate the harness reports.
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
- **Nothing gates a buy on wholesale: a franchise buys at invoice, and a used
  lot buys for RETAIL margin.** Automation must gate on `acquisitionCeiling`,
  never on a bare wholesale comparison — both branches of that function have now
  paid for the lesson separately. The first cut of the ladder gated both buyers
  on "is this under wholesale?", which a factory allocation can never satisfy —
  the feed sat untouched for ten hours and the economy flatlined with no test
  failing. The used stages carried the same bug in a milder key for far longer:
  the ask band straddles retail break-even on purpose, so a buyer that refuses
  to pay over wholesale rejects ~90% of a feed the store's own economy calls
  profitable (see the regression entry below). The used ceiling is now
  worst-case retail × (1 − the house minimum margin) — the question the sticker
  answers. `AppraisalStance` keeps the two buyers distinct on the used stages:
  the retainer buyer works from the worst case because it spends money
  unattended, the harness bot works from the estimate because that is what a
  person does. Collapsing them cost 35 minutes off the stage-2 milestone before
  it was caught.
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
- **`typicalCarPrice` must price the car that TURNS UP, not the model.** It read
  `model.baseValue` — a clean low-mileage example — for a curbstone feed that
  actually deals 200,000-mile beaters, and it took `values[n / 2]` on an
  even-length bimodal list of three beaters and three commuters, which returned
  the cheapest commuter and pretended the beater half did not exist. Together
  those overstated a curbstone car by 3.6x. Three spending gates are denominated
  in this number, so all three broke at once and none of them looked broken:
  the automation reserve (`max(player floor, weeks of expenses, N cars)`) sat at
  $23,820 against a $3,000 starting balance, so **the retainer buyer could never
  buy anything at any price** and silently overrode a player's $500 working-capital
  setting by a factor of forty-seven; `reopeningFloat` gated the used rungs at
  roughly twice their designed size; and the shark over-lent. Fixing it took the
  first three rungs in by 45%, 18% and 6% — the decay is the tell, because the
  number was only ever wrong where a car's value is a fraction of its base value.
  **The franchise stages were correct throughout**, which is exactly why the
  pacing work never caught it.
- **The harness cannot see the retainer buyer's reserve at all.** The bot gates
  its own buying on `cash - price < 400 + float` and never calls
  `typicalCarPrice`, so it traded happily all the way up a ladder the retainer
  buyer was frozen on. Automation the harness does not itself use is unmeasured
  by construction — check it by playing, or by instrumenting the actual gate.
- **The buyer must not gate on wholesale at a store that prices in retail
  margin.** The used-market `acquisitionCeiling` capped every automated buy at
  pessimistic wholesale × (1 − margin) long after the margin reshaping moved
  the ask band to straddle retail break-even, so it silently skipped ~90% of a
  feed that was deliberately profitable. No test failed, and the harness said
  nothing because the bot SHARED the gate — every pacing baseline in this file
  up to that point was measured through the throttled buyer, which is the
  inverse of the entry above: automation the harness does use is still
  unmeasured if the harness has the same bug. It was found the only way it
  could be — a player's screenshot of eight green-margin listings and an idle
  buyer; re-deriving those exact numbers showed 7 of the 8 were over the old
  ceiling despite every one clearing retail with margin to spare. Fixing the
  basis to retail took the 32h ladder in by 19% and 37% on its two rungs and
  4h lifetime profit up 40%, which is how much economy the old gate was
  quietly discarding. The bad-buy metric moved with the rule: paying over
  wholesale is policy now, so a bad buy is `price > retailValue(car)` — a true
  loss — and reads ~1.4% where the old definition read ~28%. Never compare
  the two across the change.
- **A test that computes its expectation by calling the thing under test cannot
  fail.** Every test around the working-capital floor sized its fixture with
  `typicalCarPrice`, so they agreed with the broken value by construction and
  stayed green through all of it. The guards that replaced them are absolute:
  one compares the claim against listings the real engine spawns, the other says
  in dollars that $20,000 buys a beater at a curbstone lot. Same disease as the
  entry below; a different flavour of it.
- **The buyer must judge a purchase against the number the car SELLS at, and
  that has now been paid for three times.** The franchise branch of
  `acquisitionCeiling` had its own line reading `windowPrice` — retail x the
  store's subprime markup — which let the retainer buyer pay up to 22% ABOVE
  what a car sells for. It never bit while an invoice asked ~0.9x retail and
  there was nothing else to add, so it sat as a latent copy of the wholesale-gate
  bug above it. Freight made it bite: landed cost could clear retail while still
  passing a ceiling set 22% over it, and the buyer filled a franchise lot with
  cars carrying two points of margin — $56M of profit became a $145M loss with
  the lot 100% full the whole way down. There is one basis now, cash retail, at
  every stage.
- **A cost that is a percentage is wrong when the real thing is flat.** Freight
  shipped first as a share of the ask, which put national haulage at 7.5% against
  a franchise margin of 9%. Flat dollars invert it the way the real cost does —
  the same $1,000 transporter is a third of the margin on a $10,000 big-lot car
  and a seventh of it on an $86,000 Valmont — so reach gets better as you climb,
  which is exactly where the empty lot hurts. Capped at half the car so a $900
  beater is never worth less than its own truck.
- **A gate that is a flat count is wrong at both ends of a 1000x ladder.** The
  reopening float asked for six cars at every rung — three driveways' worth at a
  curbstone, one seventh of a lot at a Valmont store. Nothing waits once a move
  is affordable, so that number is not a gate, it is the balance the new store
  OPENS WITH: the premium franchise was reached with $70M spent and $21,233 left
  against $86,000 cars. It is sized against the stalls and the entry cost now.
  The tell was a knife-edge — franchise margin had no setting between "dead" and
  "compounding to $1.4B" — and a cliff like that is always a fixed cost that is
  not being covered, never a margin that needs tuning.
- **A reset that destroys what the player was promised keeps is a trap.** Moving
  stores released the collections desk, and a full book landed 2.9x over a fresh
  desk's capacity where `overCapacityFactor` pinned miss chance at its ceiling
  and defaulted the entire portfolio inside a game month. "The book moves intact"
  was false in practice for three hundred hours of paper. `collections` carries
  now (`carriesOnMove`), and the move preview had to learn it too — a
  confirmation that over-warns is as wrong as one that under-warns, and there is
  a test comparing the two lists.
- **The sheet must judge price against the same number traffic does.** `CarSheet`
  measured the ask against `windowPrice` — retail x the store's subprime markup —
  long after the sticker moved to cash retail, so a car priced at exactly what it
  is worth read "priced under market, it will move fast", and the button labelled
  "Match market" repriced it to 1.5x retail, a whisker under `maxViablePriceRatio`
  and close to zero traffic. Identical in kind to the traffic-reference bug the
  entry above this records, and invisible until cars started sitting long enough
  to show "42 days on the lot" and "it will move fast" one line apart. Found by
  opening the game, not by a test.
- **A scale-free derivation is not scale-free if anything inside it rounds to
  dollars.** `financeGrossMultiple` prices a notional contract per dollar of
  window price, which is legitimate — every term is proportional to the price.
  But `expectedCollections` rounds its answer to whole dollars, so a one-dollar
  contract collects either $0 or $1 and the entire credit ladder collapses into
  two values: it read A-tier at 1.14 and D-tier at 0.31 when the truth is 1.00
  and 0.58. The model claimed 1.33 against a measured 1.21. It is priced on a
  notional million now. The only reason this was caught is that the test
  measures the model against contracts the engine actually writes, rather than
  against the derivation restated.
- **The reference distribution must not be measured through the opening hand.**
  `createInitialState` deals its listings at the CURBSTONE — including the
  guaranteed-affordable starter, which is dealt rather than rolled — so a
  fixture that sets `stage` afterwards and then samples the feed is measuring a
  handful of cheap beaters as if a Valmont store had sourced them. It moved the
  measured premium-franchise mean by 0.8 points, which is half a standard
  deviation there, and it looked exactly like a wrong derivation. The harness
  has the same shape of error available to it: predicting a store's feed with
  the reach level the business ENDS the run holding read a curbstone at 6.0%
  against a measured 18.6%, because the bot had no transporter at the curbstone.
  Freight is recorded per stage as it stood at the time now.
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
  Currently **v15**. Saves are long-lived and local to the device; "we wiped
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
  - Does the buy still read as a fair judgement call? The old health metric —
    a ~28% bad-buy rate — died with the wholesale gate: paying over wholesale
    is policy now, so the harness counts a bad buy as a true loss (`price >
    retailValue`) and reads ~1.4%. Appraisal error (~6.6%) is the number left
    on the health dashboard, and whether a judgement game where the bot almost
    never truly loses money still has teeth is a playtest question.
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
- **Buying goes dead at the top.** `appraisalSigmaMult: 0` retires the appraisal
  on all three franchise stages, so a maxed Buying skill buys nothing there. That
  is the intended character change, but it does leave a levelled skill inert for
  the back half of the game. If that reads badly in play, the honest fix is to
  give Buying a franchise-side effect (allocation throughput, say) rather than to
  put fake uncertainty back on a new car.
- **The top two rungs are not re-gated.** 39h and 212h is a 5.4x step where the
  rest of the ladder is roughly 3x — flatter than it was (6.5x) because reach
  lets the top stores actually trade, but still the steepest part of the game.
  `entryCost` and `upgradeCostMultiplier` are the honest levers and the note
  below on the upgrade table still stands.
- **Nothing measures a player who declines market reach.** The harness bot buys
  it as soon as it can afford it, so every number in the shipped column assumes
  it. A player who stays local keeps the full margin on every car and runs a
  half-empty lot, which is a real strategy the harness has never played. Whether
  that reads as a live choice or as an obviously-wrong one is a playtest
  question.
- **The late game is no longer hot; stage 1 may now be too slow.** The
  stage-2 gate has drifted from 48m through 1h11m to ~2h21m across the running
  costs, the ladder stretch and the honest-till passes, and a 140-minute
  tutorial is a lot to ask before the game changes shape. If that needs
  shortening, `lotPurchaseCost` is the honest lever — it targets stage 1
  without undoing the negotiation change. Needs a human playing it.
- **Fifty levels is a shape nobody has felt yet.** The retune keeps a maxed
  skill worth exactly what it was and hands out level-ups roughly three times as
  often early, which is the trade it was chosen for — but the harness can only
  say that pacing did not move. What it cannot say is whether a 4h run finishing
  in the high twenties reads as "still climbing" or as "will never get there",
  and whether the shallower per-level step still feels like a reward. Needs a
  human playing it. `maxLevel` and `xpGrowth` are both in Office → Admin, which
  is the fastest way to try a different length.
- **The five house rules are unmeasured by design.** The harness bot runs them
  all at their defaults, which is what makes the cap's measurement clean — but it
  means nothing here bounds what a player gets from setting them. The repo
  trigger in particular trades collections against recovered condition, and
  CLAUDE.md's own warning applies: the harness separates the mild band from the
  strong band and nothing finer.
  The two sales floors are doubly invisible: they govern what the DESK signs, and
  the harness bot closes everything itself inside the grace window, so a
  continuous run never touches them at all. `--cadence=15:240` is the only mode
  that would see them. What nobody has felt yet is whether a floor is a good
  trade in practice — a strict desk banks a better margin per car but sells
  fewer of them, and in an economy that compounds throughput this hard, "fewer
  and better" is exactly the shape of a setting that reads as an upgrade and
  costs you money. Somebody has to leave one running overnight at Good or Strong
  and compare.
- **A fourth skill for the paper side** — collections, levelled by payments taken
  and repos worked — is the obvious next one. `skills` is a `Record` so it needs
  no reshaping, and skill levels are the natural carry-over currency if a
  prestige layer ever lands.
- **Tone.** The repossession loop is mechanically the best thing in the game and
  describes a genuinely predatory real-world practice. Leaning into that
  knowingly reads sharper than playing it straight. Mostly a writing decision,
  and it is the user's call to make.
