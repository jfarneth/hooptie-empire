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
  that means prospects (`negotiation`, `financeTerms`) and `skills`, which is a
  record of objects and needs `cloneSkills`, not a spread. The tick-invariance
  test is the guard; keep its fingerprint covering new fields.

## Verify

```bash
npm test        # 109 tests
npm run typecheck
npm run sim     # balance harness — 4h of simulated play in ~2s
```

Targets **at `--seeds=64`**, which is the number to quote and compare against:

| | |
|---|---|
| stage 2 reached | ~48m |
| first repossession | ~1h08m |
| default rate | ~27% |
| walk-away rate | ~9% |
| bad-buy rate | ~28% |
| Buying / Closing / Wrenching to level 5 | 54m / 1h06m / 1h23m |
| end cash at 4h | ~$1.36M |

**Always state the seed count.** The default `npm run sim` is 6 seeds and reads
stage 2 at ~51m and $1.45M for the exact same build — seed count moves these
numbers further than most features do. Comparing a 6-seed run against a 64-seed
target is the single easiest way to conclude you broke something you didn't.

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

## Settled decisions — don't relitigate these

- **Mobile-first Expo.** Not web-first, not Unity. The web build exists for
  sharing and for verification, not as the target.
- **The loan book is the game.** Buy-here-pay-here modelled as real note objects
  is the differentiator; car flipping is the tutorial. Resist changes that make
  flipping the main event.
- **Illustrated lot**, not a data-dense dashboard.
- **Negotiation**: slider input, cash-only for now, sales desk counters once and
  takes what comes back, moderate walk risk. `src/sim/haggle.ts` deliberately
  works in abstract money and takes a `HaggleSkill` of plain numbers — it knows
  about neither cars nor `GameState`. That is the seam for down-payment
  haggling later. Keep it that way.
- **Upgrades buy capacity; skills earn quality.** Where both touch one axis they
  stack multiplicatively (`mechanic` × Wrenching speed, `scout` × the feed).
  Splitting an axis between them instead is how you silently nerf something a
  player already paid for.
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
  Currently **v4**. Saves are long-lived and local to the device; "we wiped
  saves" is the thing that ends an idle game. `src/state/persistence.ts` also
  carries legacy storage-key fallback for the same reason.

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
- The bottom nav is **Lot / Buy / Notes / Office**. Upgrades and Skills live
  behind *Office*, and "Buy" also matches the header text "BUY HERE PAY HERE",
  which will bite any text-based selector.

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
- **Late game still runs hot** (~$1.36M cash at hour 4, +27% versus the
  pre-skills build). Needs a human playing it, not more harness fitting.
- **A fourth skill for the paper side** — collections, levelled by payments taken
  and repos worked — is the obvious next one. `skills` is a `Record` so it needs
  no reshaping, and skill levels are the natural carry-over currency if a
  prestige layer ever lands.
- **Tone.** The repossession loop is mechanically the best thing in the game and
  describes a genuinely predatory real-world practice. Leaning into that
  knowingly reads sharper than playing it straight. Mostly a writing decision,
  and it is the user's call to make.
