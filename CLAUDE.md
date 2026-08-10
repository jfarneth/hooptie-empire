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

The **collections desk is a hard cap on the book**, and a **business management
suite** (Office → Business) lets the player set three house rules that the
business then runs under offline: a working capital floor, the repo trigger, and
the retainer buyer's minimum margin. `src/sim/business.ts` resolves them.

An **admin console** (Office → Admin, visible to everyone) edits the tuning
constants live. `src/sim/tuning.ts` is the registry; adding a knob is one entry
in `TUNABLES` and nothing else. It is the one place the sim writes a global —
read the header comment there before touching it, and note that overrides live
on the save and are re-applied *before* offline catch-up, which is what keeps a
given save replaying identically.

## The two axes of the stage ladder

Worth internalising before touching anything stage-shaped, because almost every
bug in this area comes from missing one of them.

**Moving resets the payroll — in both directions.** Staff (`staff: true` in
`upgrades.ts`) drop to zero and cost `staffCostMultiplier` more to rehire at the
new store. Property, process, cash, inventory, the loan book and skills all
carry. The line is "would this person have to be hired again", which is why
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
- **Going down is free and refunds nothing.** Cash, cars, paper and skills come
  with you; every dollar the store you leave cost is written off, and there is
  deliberately no discount coming back up, so a round trip pays the entry price
  twice. That is what stops it being a way to park money. `StageMovePreview`
  carries `direction`, `cost`, `forfeit`, `rungsSkipped`, `bookAfter` and
  `lotAfter` for exactly one reason: the UI must never compute any of it itself.

The harness bot only ever climbs one rung at a time, so **nothing measures either
of these** — the same caveat the house rules carry.

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

**The lot is paved for `max(capacity, cars held)`, not for capacity.** A lot can
legitimately be over capacity — a repo comes back to a full lot, and walking back
down the ladder lands thirty cars on a driveway with room for five. A car with no
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

## Verify

```bash
npm test        # 253 tests
npm run typecheck
npm run sim     # balance harness — 4h of simulated play in ~2s
npm run sim -- --hours=32 --seeds=16   # the whole ladder, ~15s
```

The ladder, median at `--seeds=16 --hours=32`, reached by 16/16:

| | |
|---|---|
| Small used dealership | ~1h11m |
| Large used dealership | ~3h16m |
| Low-cost franchise | ~5h40m |
| Midsize franchise | ~12h03m |
| Premium franchise | ~27h36m |

Roughly a doubling per rung, which is the shape to preserve. A 4h run only ever
reaches large used, so **a default `npm run sim` cannot tell you anything about
the franchise stages** — use the 32h invocation for those.

Targets **at `--seeds=64`** over the default 4h, which is the number to quote and
compare against for everything below the franchise:

| | |
|---|---|
| stage 2 reached | ~1h11m |
| first repossession | ~1h43m |
| take-it-back odds on the deal sheet | ~30% |
| harness `default rate` | ~24% (see below — not the same number) |
| walk-away rate | ~53% |
| bad-buy rate | ~26% |
| Buying / Closing / Wrenching to level 5 | 1h24m / 1h15m / 1h52m |
| large used reached | ~3h13m |
| end cash at 4h | ~$63k |
| end portfolio at 4h | ~$420k |

**Always state the seed count.** Seed count moves these numbers further than most
features do, and comparing a 6-seed run against a 64-seed target is the single
easiest way to conclude you broke something you didn't.

End cash at 4h is low and that is not a regression: the bot buys the large used
dealership at ~3h13m, which spends the balance and resets the payroll, so the 4h
snapshot lands mid-rebuild. Read `lifetime profit` (~$1.86M) for the health of
the economy and the ladder table above for pacing. Earlier deliberate retunes
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
- **Property carries, people do not.** That single line is the whole design of
  the stage reset, and it is what makes moving up a decision instead of a button.
  Anything new on the upgrade table needs a deliberate answer to "would this have
  to be hired again at a bigger store".
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
- **Bump `SAVE_VERSION` and add a migration whenever `GameState` changes shape.**
  Currently **v7**. Saves are long-lived and local to the device; "we wiped
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
- **Every skill now levels ~50% slower** (Buying 5 at 1h21m, was 53m) for the
  same reason: fewer closed deals means less XP. Nothing about the skills
  changed. Check this against feel before touching `xpBase`.
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
