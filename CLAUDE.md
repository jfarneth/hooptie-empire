# Working in this repo

Hooptie Empire — an idle tycoon game about the American used-car business.
Expo / React Native / TypeScript, no backend. See `README.md` for what the game
*is*; this file is about how to work on it without breaking the things that
matter.

Stages 1–2 are built and live. Three player skills — **Buying, Closing,
Wrenching** — ship alongside them, and buying a car is a judgement call rather
than arithmetic: the feed shows an *estimated* condition with an honest band,
not the truth. `docs/skills-plan.md` is the design doc and carries the balance
measurements behind every number.

The **collections desk is a hard cap on the book**, and a **business management
suite** (Office → Business) lets the player set three house rules that the
business then runs under offline: a working capital floor, the repo trigger, and
the retainer buyer's minimum margin. `src/sim/business.ts` resolves them.

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

## Verify

```bash
npm test        # 136 tests
npm run typecheck
npm run sim     # balance harness — 4h of simulated play in ~2s
```

Targets **at `--seeds=64`**, which is the number to quote and compare against:

| | |
|---|---|
| stage 2 reached | ~1h11m |
| first repossession | ~1h42m |
| take-it-back odds on the deal sheet | ~30% |
| harness `default rate` | ~17% (see below — not the same number) |
| walk-away rate | ~53% |
| bad-buy rate | ~30% |
| Buying / Closing / Wrenching to level 5 | 1h21m / 1h14m / 1h51m |
| book / limit at 4h | 43 / 43 |
| end cash at 4h | ~$503k |
| end portfolio at 4h | ~$316k |

**Always state the seed count.** The default `npm run sim` is 6 seeds and reads
stage 2 at ~1h10m and $619k for the exact same build — seed count moves these
numbers further than most features do. Comparing a 6-seed run against a 64-seed
target is the single easiest way to conclude you broke something you didn't.

Two deliberate retunes moved these, and neither is a regression. The book cap
(see below) took end cash from $1.36M to $935k. The risk/negotiation tune-up then
took it to $503k, mostly via the negotiation half — stage 2 slid from 48m to
1h11m because stage 1 is all cash deals and half the haggles now fail.

All pacing constants live in `src/sim/balance.ts`. Nothing else should hard-code
a number that affects the curve.

## Tuning the economy — read before touching `balance.ts`

Hard-won during the skills work. Every one of these cost a wrong turn.

- **The ask band (`listingAskMin/Max`) is the sharpest knob in the game.** It
  sets both the share of listings worth buying *and* the margin on the ones that
  are, and an idle economy compounds margin over four hours. Holding its width
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
- **Illustrated lot**, not a data-dense dashboard.
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
- **A test that asserts `sum >= count` cannot fail.** The first automation test
  written for skills passed on a run that accrued zero XP. Mutation-test any
  test guarding a regression: break the code, watch it go red, put it back.
- **Bump `SAVE_VERSION` and add a migration whenever `GameState` changes shape.**
  Currently **v5**. Saves are long-lived and local to the device; "we wiped
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
- **Don't play 40 minutes to reach stage 2.** Generate a mid-game save by running
  the harness bot forward, then inject it into `localStorage` under the key
  `hooptie.save` before the page loads (`page.addInitScript`).
- **Playwright + Chromium** at `/opt/pw-browsers/chromium` works for driving the
  app; `npm i -D playwright` with `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` is not in
  `package.json` on purpose. Look at the running game, not just the suite — the
  dead feed-slot bonus and a text-wrapping regression were both found this way
  and neither had a failing test.
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
- **The collections ladder now caps the entire late game and nobody has argued
  the number.** `collections` maxes at level 5, so the book stops at 43
  contracts, and the bot is pinned there from roughly hour two onward. "The loan
  book is the game" sits awkwardly next to a book that stops growing halfway
  through a session. Two honest options, and this is a design call rather than a
  measurement: accept the throttle, or extend the ladder (`maxLevel`,
  `collectionsCapacityPerLevel`) so continued investment keeps buying room. The
  cap was shipped untuned on purpose — retuning the economy in the same change
  that introduced the constraint would have made both unmeasurable.
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
