# Hooptie Empire

An idle tycoon game about the American used-car business. You start selling one
car at a time out of a driveway and climb six rungs to a premium franchise
store.

The genre hook is not flipping cars — plenty of games do that. It is that
**buy-here-pay-here is modelled honestly**. On a BHPH lot you sell the car twice:
once for the down payment, and again as a retail installment contract that pays
every week at 24% for two years. Collections run whether or not you are at the
desk, which makes lending the most thematically honest idle mechanic available in
any business setting. Flipping cars is the tutorial. The loan portfolio is the
game.

**Six dealerships**, all built and tuned: curbstoning off a driveway, a small
used lot, a large used lot, then franchise stores for a budget, a mainstream and
a premium marque. The first is about an hour; the last takes a serious player
most of a day.

Two things change every time you move up, and together they are the shape of the
game. **Cars get more expensive** — better inventory, bigger margins, and a much
larger cheque before you own any of it. **Your staff does not come with you** —
every employee resets and costs more to hire at the bigger store. Property,
inventory, the loan book and everything the work has taught you all carry over;
the payroll does not. Moving up is a decision, not a button, and the game puts
the bill in front of you before you sign.

The franchise stores are deliberately a different game. You buy from one
manufacturer at invoice: one make on the whole feed, standardised pricing, and no
guesswork about condition because nobody appraises a car off a transporter. The
question stops being *is this a good car* and becomes *can you move volume and
write paper* — which is the real difference between an independent lot and a
franchise store.

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
- **App stores:** configured but not yet submitted. `eas.json` carries the three
  build profiles and `app.json` carries the release fields — see below.

## Release builds

There are no `ios/` or `android/` directories — the native projects are
generated from `app.json` at build time, so that file *is* the native config and
editing it is how you change anything Xcode would otherwise own.

```bash
npm i -g eas-cli && eas login
eas build:configure                       # links the project to an EAS account, once
eas build --profile preview  --platform ios   # simulator build, no signing needed
eas build --profile production --platform ios # signed archive for App Store Connect
eas submit --profile production --platform ios
```

Four things in `app.json` exist only for the store and are easy to knock out:

- **The bundle identifier is permanent, and it is deliberately impersonal.** It
  was `com.jfarneth.hooptieempire` and is now `com.hooptieempire.game`, because
  an ID cannot be changed once an app has shipped — the only way out is
  publishing a *different* app and abandoning its ratings and installs. Naming
  it after the game rather than after a person means it reads the same whether
  the seller is an individual or a company, and Apple's way of making that
  change (transfer the app between accounts) does not touch it. Free to get
  right before the first release and impossible afterwards. `android.package`
  is the same string for the same reason.
- **`version` is what reviewers and customers see** (`CFBundleShortVersionString`).
  The build number underneath it is *not* in this file — `eas.json` sets
  `appVersionSource: "remote"` with `autoIncrement`, so EAS owns it and two
  builds of one version cannot collide.
- **`usesNonExemptEncryption: false`** answers the export-compliance question at
  build time instead of in a web form before every single submission. It is
  honest here: the app makes no network calls at all.
- **The splash screen is a config plugin, not a `splash` key.** Since SDK 52 the
  key in `app.json` is ignored; `expo-splash-screen` in `plugins` is the only
  thing that generates the launch storyboard, and a missing one ships a white
  flash into a game that is otherwise `#101219` throughout.

**No data leaves the device, and that is worth saying out loud on the listing.**
There is no network code in `src` at all, which makes App Privacy a single
"Data Not Collected" declaration rather than a questionnaire.

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
    haggle.ts       # negotiation: opening offers, reservation prices, counters
    cars.ts         # generation, reconditioning, repo damage
    stages.ts       # the six dealerships: entry costs, staffing, sourcing
    upgrades.ts     # definitions and derived stats
    skills.ts       # Buying/Closing/Wrenching: XP, levels, derived stats
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
npm run sim -- --hours=32 --seeds=16     # far enough to see the whole ladder
```

The harness drives the real engine with a scripted "reasonable player" and
reports time-to-milestone across seeds. A four-hour run only ever reaches the
large used lot, so the franchise stages need the longer invocation:

```
  Small used dealership    1h11m   (16/16)
  Large used dealership    3h16m   (16/16)
  Low-cost franchise       5h40m   (16/16)
  Midsize franchise       12h03m   (16/16)
  Premium franchise       27h36m   (16/16)
  walk-away rate            53.0%
  default rate              23.8%
```

When the harness and the way the game actually feels disagree, the game is right
— but this is how you find out which constant to reach for.

One caveat that has already caused a wrong turn. That `default rate` is measured
over the contracts the automated sales desk chose to write, and the desk
underwrites on expected value — so making borrowers riskier makes it write safer
paper, and the number can move the *opposite* way to the knob you turned. Tune
credit risk against the odds the deal sheet quotes instead.

**Everything is tunable in-app.** Office → Admin exposes the simulation's
constants — the ask band, negotiation odds, credit risk, collections capacity,
the cost of every rung on the ladder — as live fields. Changes apply
immediately, save with your game, and hold while the app is closed; they do not
rewrite history, so cars you already own keep their cost basis and contracts
already written keep their terms. Every row shows its shipped default and can be
reset individually.

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

**Haggling runs on a hidden walk-away price.** A buyer opens below your ask and
carries a private reservation — the most they would actually pay — drawn
somewhere between the two. Countering below it is likely to land, above it
usually is not, and pushing far past it loses them. Modelling it that way rather
than as a distance-from-their-offer formula means some buyers genuinely have room
and some genuinely do not, which is what makes it read as a person.

**Pushing back is a gamble.** Turn down their number and there is a good chance
they are simply gone — about half of all negotiations now end in a walk-off.
Nothing bad can happen if you just take the opening offer, so the real question
on every walk-up is whether this buyer is worth the risk at all. Closing is the
skill that buys you the odds.

Two things stay hidden on purpose. The deal sheet shows exact expected value and
exact default odds for financing, because those are long-run properties a dealer
really does learn. One buyer's private walk-away number is not something anyone on
that lot could know, so the slider gives a qualitative read and a **tell** instead
of a percentage. Reading customers is a skill, not arithmetic.

**Collections capacity is a hard cap** on how many contracts you can carry. Fill
the desk and the finance option goes away — walk-ups get sold the car instead of
the payment until something on the book pays off or goes bad. Staffing the desk
is what buys the right to write more paper, which makes it the decision the whole
back half of the game turns on.

**House rules** (Office → Business) are the standing constraints the place runs
under while you are not watching: a floor under the till that no automation will
spend past, how many missed payments you allow before the car comes back, the
least margin your sales manager will sign for in cash and on paper, and how far
under the worst case your buyer on retainer insists on being before it spends
your money. None of them is a free win. Pull the repo trigger sooner and you
recover a better car from a customer who might have caught up; give them rope and
you collect more from the ones who do, and get back a rougher car from the ones
who never had it.

The three margin rules are set in **standard deviations off the average deal at
the store you are standing in**, not in flat percent, because 20% of the gross is
an ordinary car at a curbstone lot and more than a Valmont franchise can produce
on anything it will ever sell. At the bottom the desk takes whatever walks up. At
the top it is holding out for something that essentially has to be a mispriced
unicorn — and the panel tells you, in dollars, what each stop is asking for. The
buyer's rule reaches below zero, which is a real strategy at a store that spends
its life short of stock: overpay a little and keep the stalls full.

## Not built yet

Stages 3–5 (midsize independent, franchise store, dealer group, manufacturer),
prestige/reset layer, monetization, audio, cloud save. The prestige hook point is
noted in the stage handling because it shapes state, but nothing is built for it.

One open call before this goes further: the repo loop describes a genuinely
predatory real-world practice. Leaning into that knowingly — the way *Universal
Paperclips* leans into its premise — makes the game sharper than playing it
straight. That is a tone decision, and it mostly costs writing rather than
engineering.
