# Curbstone

An idle tycoon game about the American used-car business. You start selling one
car at a time out of a driveway and climb toward a lot with its own finance desk.

The genre hook is not flipping cars — plenty of games do that. It is that
**buy-here-pay-here is modelled honestly**. On a BHPH lot you sell the car twice:
once for the down payment, and again as a retail installment contract that pays
every week at 24% for two years. Collections run whether or not you are at the
desk, which makes lending the most thematically honest idle mechanic available in
any business setting. Flipping cars is the tutorial. The loan portfolio is the
game.

Current scope is a vertical slice: **stage 1 (curbstoning) and stage 2 (a small
BHPH lot)**, fully playable and tuned. Stage 1 runs about 35–45 minutes and
stage 2 sustains several hours.

## Running it

```bash
npm install
npm start          # Expo dev server — open in Expo Go, a simulator, or the web target
npm run web        # browser build, useful for quick checks
```

```bash
npm test           # simulation test suite
npm run typecheck  # tsc --noEmit
npm run sim        # headless balance harness (see below)
```

## Where it runs

Nowhere, until you want it to. The game is entirely client-side — no server, no
database, no API, no accounts — so there is nothing to keep running and nothing
to pay for.

- **On your phone:** `npm start`, then scan the QR with Expo Go. Every native
  module used here ships inside Expo Go, so no custom build is needed. This is
  the real playtesting loop.
- **On the web:** pushing to `master` publishes a playable build to GitHub Pages
  via `.github/workflows/deploy-web.yml`. Good for sharing a link; React Native
  Web is faithful but not identical to native, so judge game *feel* on a device.
- **App stores:** not set up. When the game earns it, EAS Build produces
  iOS/Android binaries without needing a Mac, and EAS Update pushes JS changes
  over the air — useful when retuning `balance.ts` is most of the work.

Note that **saves are local to the device.** Lose the phone, lose the portfolio.
There is no cloud sync, and adding it is the one feature that would introduce a
backend. The save layer carries versioning and migrations from day one so that
stays a choice rather than a forced rewrite.

## Architecture

The one rule worth enforcing in review:

> **`src/sim` must never import from `react-native`, `react`, or any UI package.**

The simulation is a pure, headless, deterministic module. Everything else is a
view of it. That single constraint is what makes the rest work:

- **Offline progress is not a separate code path.** The engine advances in fixed
  1-second steps, carrying a sub-tick remainder between calls. Coming back after
  eight hours away calls the same `advance()` with a bigger `dt`. Advancing
  3600×1s and 1×3600s produce *byte-identical* state — there is a test for it.
  What the away summary reports is what actually happened, not an estimate.
- **The economy is testable.** Amortization, delinquency, default and repossession
  are pure functions over plain data.
- **Balance is measurable.** The harness plays hours of the game in about a
  second, so the progression curve gets tuned from numbers instead of vibes.

Randomness comes from a seeded mulberry32 whose state lives **inside the save
file**, so a save replays identically and offline catch-up cannot be re-rolled by
reloading the app.

```
src/
  sim/            # pure simulation — no UI imports, fully tested
    engine.ts       # advance(), the fixed-step loop, offline catch-up
    economy.ts      # valuation curves; everything earned traces through here
    notes.ts        # BHPH contracts: amortization, delinquency, default, repo
    customers.ts    # walk-ups, credit tiers, deal structuring
    cars.ts         # generation, reconditioning, repo damage
    upgrades.ts     # definitions and derived stats
    actions.ts      # player commands (state -> state)
    save.ts         # serialization, versioning, migrations
    balance.ts      # every tuning constant in the game, one file
  state/          # zustand store + AsyncStorage persistence; owns the clock only
  ui/             # screens, components, theme
  tools/
    simulate.ts     # headless balance harness
```

## Tuning the game

`src/sim/balance.ts` holds every constant that affects pacing. Nothing else
should hard-code a number that changes the curve.

```bash
npm run sim -- --hours=4 --seeds=8 --verbose
```

The harness drives the real engine with a scripted "reasonable player" and
reports time-to-milestone across seeds:

```
  cash for lot               45m   (8/8)
  stage 2: BHPH              34m   (8/8)
  first note written         36m   (8/8)
  first repo                 59m   (8/8)
  first note paid off      1h32m   (8/8)
  default rate              25.8%
```

When the harness and the way the game actually feels disagree, the game is right
— but this is how you find out which constant to reach for.

## Design notes

**Time compression.** A game day is 20 real seconds, so a game week — the beat
note payments land on — is 140 seconds. A 24-week contract runs about 56 real
minutes: long enough to feel like an investment, short enough to see it pay off
in one sitting.

**Why the repo loop is interesting.** When a borrower defaults you keep every
dollar already collected *and* get the car back to sell again. Frequently that
outcome is worth more than the cash sale you turned down. The deal sheet shows
the expected value of the paper next to the cash offer, computed with the same
Markov chain the engine uses to resolve the contract — so learning to read that
screen is learning the real economics, not a UI fiction.

**Collections capacity** caps how many active notes you can service. Grow the
book past the desk and everyone's default odds climb. Growing without staffing is
a real and punishing mistake, which is the point.

## Not built yet

Stages 3–5 (midsize independent, franchise store, dealer group, manufacturer),
prestige/reset layer, monetization, audio, cloud save. The prestige hook point is
noted in the stage handling because it shapes state, but nothing is built for it.

One open call before this goes further: the repo loop describes a genuinely
predatory real-world practice. Leaning into that knowingly — the way *Universal
Paperclips* leans into its premise — makes the game sharper than playing it
straight. That is a tone decision, and it mostly costs writing rather than
engineering.
