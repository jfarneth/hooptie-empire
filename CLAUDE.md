# Working in this repo

Hooptie Empire — an idle tycoon game about the American used-car business.
Expo / React Native / TypeScript, no backend. See `README.md` for what the game
*is*; this file is about how to work on it without breaking the things that
matter.

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
  backwards through history and silently corrupt offline catch-up. The
  tick-invariance test is the guard; keep its fingerprint covering new fields.

## Verify

```bash
npm test        # sim test suite
npm run typecheck
npm run sim     # balance harness — 4h of simulated play in ~2s
```

`npm run sim` prints time-to-milestone across seeds. Current targets — treat a
large move as a signal, not noise:

| | |
|---|---|
| stage 2 reached | ~43m |
| first repossession | ~1h02m |
| default rate | ~30% |
| walk-away rate | ~9% |

All pacing constants live in `src/sim/balance.ts`. Nothing else should hard-code
a number that affects the curve.

## Settled decisions — don't relitigate these

- **Mobile-first Expo.** Not web-first, not Unity. The web build exists for
  sharing and for verification, not as the target.
- **The loan book is the game.** Buy-here-pay-here modelled as real note objects
  is the differentiator; car flipping is the tutorial. Resist changes that make
  flipping the main event.
- **Illustrated lot**, not a data-dense dashboard.
- **Negotiation**: slider input, cash-only for now, sales desk counters once and
  takes what comes back, moderate walk risk. `src/sim/haggle.ts` deliberately
  takes abstract `(anchor, overpricing)` money and knows nothing about cars —
  that is the seam for down-payment haggling later. Keep it that way.
- **What the UI reveals.** The deal sheet shows exact expected value and default
  odds for financing, because those are long-run properties a dealer genuinely
  learns. It hides negotiation acceptance odds, because one buyer's private
  walk-away price is not something anyone on that lot could know. The line is
  "what a real operator could know" — apply it to new surfaces too.

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
- **Bump `SAVE_VERSION` and add a migration whenever `GameState` changes shape.**
  Currently v3. Saves are long-lived and local to the device; "we wiped saves" is
  the thing that ends an idle game. `src/state/persistence.ts` also carries
  legacy storage-key fallback for the same reason.

## Environment constraints

These will waste your time if you discover them the hard way:

- **Repo-settings writes are blocked by the proxy.** Renaming the repo, enabling
  Pages, changing branch protection — the user has to do those in the GitHub UI.
  Don't retry; just say so.
- **`github.io` is unreachable from here** (proxy blocks CONNECT). You cannot
  load the live site. To verify a web build, export with
  `EXPO_WEB_BASE_URL=/hooptie-empire` and serve it locally under a matching
  `/hooptie-empire/` subpath — the base path bug only shows up on a subpath.
- **Don't play 40 minutes to reach stage 2.** Generate a mid-game save by running
  the harness bot forward, then inject it into `localStorage` under the key
  `hooptie.save` before the page loads.
- **Playwright + Chromium** at `/opt/pw-browsers/chromium` works for driving the
  app. Several real bugs were caught this way and not by tests — look at the
  running game, not just the suite.

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

- **Late game runs hot** (~$1.7M by hour 4). That needs a human playing it, not
  more balance-harness fitting.
- **Tone.** The repossession loop is mechanically the best thing in the game and
  describes a genuinely predatory real-world practice. Leaning into that
  knowingly reads sharper than playing it straight. Mostly a writing decision,
  and it is the user's call to make.
