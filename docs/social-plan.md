# Social features, seasons, and the first backend

Working notes for the thing this game has deliberately never had: a server.
Nothing here is built. This is the design record *before* the measurements
rather than after them, so read every number as an estimate and every rule as a
position to argue with.

`docs/service-plan.md` is the model for what this becomes once it ships.

---

## The frame

Three asks, and they are not the same project:

1. **Global progress tracking** — how does my empire compare to everyone's.
2. **Social features** — friends, sharing, comparison, eventually chat.
3. **Seasons** — an opt-in reset, on a clock, for cosmetics and a leaderboard.
   *Salesperson of the Quarter.*

(3) is the one with a retention argument behind it and it is the one that
should drive the architecture. (1) is a side effect of building (3) properly.
(2) is mostly optional and the expensive parts of it are expensive for reasons
that have nothing to do with hosting.

**The whole of this document is subordinate to one rule**, stated here and
restated wherever it can be broken:

> **A social feature may never touch `src/sim`.** Not a buff, not a bonus, not a
> multiplier, not a season-only upgrade. The moment a leaderboard grants an
> advantage, the single-player game becomes the loser's bracket and the offline
> pillar becomes a competitive disadvantage. Cosmetics, records and comparison
> only.

---

## Part one — seasons

### A season is scoped retirement, not a new reset

`retire()` already does everything the seasonal mechanic needs: it sells the
operation, prices the sale in one place (`retirementPreview`), logs an immutable
`RetirementRecord` to a scoreboard, and starts a genuinely new game through
`createInitialState`. Cash, stock and paper go; skills, house rules, tuning
overrides and the prestige block carry.

**Do not build a second reset.** A season is that reset with four things added:
a fixed start, a fixed end, a shared seed, and a scoreboard other people can
see. Everything else is `retire()` with a different label on the button.

What that buys immediately: the confirmation screen, the pricing, the ledger
line, the scoreboard record and the "start over" path all exist and are tested.
The seasonal work is scoping, not mechanics.

### The season is a second save slot, and that is the whole state model

The obvious implementation — flip a flag on `GameState`, reset it, flip it back
— is wrong in a way that gets worse the longer you look at it. It needs a
`SAVE_VERSION` bump, a `cloneState()` line, a clone-isolation test, and it
throws away a career the player may have spent a fortnight on with no way back.

Instead: **two keys in AsyncStorage.**

```
hooptie.save                 the career. What exists today. Untouched.
hooptie.season.<id>.save     the season run. Its own GameState, its own seed.
hooptie.active               which one is live.
```

`persistence.ts` grows a key parameter and nothing else. `GameState` does not
change shape, there is no migration, and `cloneState` learns nothing. Opting in
is reversible, which turns "reset to 0" from a threat into an experiment —
and an opt-in reset that cannot be undone is a much harder sell than one that
can.

It also dissolves a conflict that would otherwise be real. CLAUDE.md is
emphatic that **skills never reset** — they are the carry-over currency and the
spine of the prestige layer. A season that zeroed them would be overturning a
pillar. A season that is *a different career in a different slot* never touches
the pillar at all: the career's skills are exactly where they were left.

**THE TRAP: only one save may advance.** Offline catch-up runs off
`Date.now() - lastSeenAt`, capped at 8h (`offlineCapMs`, plus 4h per night
manager). Two saves on disk means the obvious implementation lets a player park
their career, play the season for an evening, switch back and collect eight
free hours — then switch again. Stamp `lastSeenAt = now` on the **inactive**
save at every switch, and again on both at every autosave. This wants a test
named for it before the feature is a day old, because it is invisible, it
compounds, and it is exactly the shape of exploit an idle game dies of.

### What resets and what does not

| | resets for the season |
|---|---|
| cash, stock, paper, upgrades, stage | yes — it is a new business |
| skills | yes, *within the season slot*. The career's are untouched. |
| prestige points and the buy-side edge | **yes, and this one matters** |
| house rules (`BusinessPolicy`) | no — carry them in as a convenience |
| tuning overrides | **no. Refuse to start a season with any set.** |
| cosmetics owned | no — account-level, see below |

**The prestige edge has to go.** `prestigeEdge` is up to `edgeCap` off every ask
price, earned linearly in dollars retired across a whole career. A player on
their eighth empire against somebody on their first is not a contest, and the
board would measure account age. A season starts at zero points and earns none;
retiring *inside* a season ends the season run rather than compounding it.

That is also the honest answer to "why would a veteran play a season" — because
the edge is the thing being taken away, and playing without it is a different
problem. Same reason a shared seed is interesting rather than restrictive.

### One seed for everybody

`createInitialState` takes a seed, the sim is deterministic, and every draw goes
through `s.rng`. So a season can hand every player **the same seed**: the same
opening hand, the same first dealt listing, the same feed at the same moments.

That is worth more than it looks:

- It makes the board a measure of play rather than of luck, which is the only
  thing that makes a leaderboard worth reading at these player counts.
- It gives the server ground truth. The feed a player *should* have seen is
  computable, which makes verification cheap (see anti-cheat below).
- It is a format people already understand — the daily run.

**State it honestly in the UI**: the streams diverge the moment two players take
different actions, so it is the same *opening*, not the same run throughout. It
is a shared starting position, like a chess opening, not a shared script.

### Four boards, because a dealership is four businesses

One board means one winner and no reason for player number twelve to open the
app in week three. CLAUDE.md's own framing is the fix — *a dealership is four
businesses and one landlord* — and `WeekLines` already splits every week across
`metal`, `paper`, `plans`, `shop` and `overhead`.

So run the boards per department, with the fiction the game is already wearing:

| board | metric | the title |
|---|---|---|
| metal | profit booked on cars | **Salesperson of the Quarter** |
| paper | profit collected on notes | Finance Manager of the Quarter |
| plans | profit on cover, and the loss ratio | (needs a name) |
| shop | labour billed, net of wages | Service Director of the Quarter |
| overall | `lifetimeProfit` at season close | Dealer of the Quarter |

Four or five placements instead of one, they reward genuinely different play,
and they make the departmental split — which is currently a readout — into
something with stakes. A player who cannot out-grind the top of the ladder can
still run the best finance desk in the game.

**Cost, stated plainly: the lifetime departmental split does not exist yet.**
`Stats` carries `lifetimeProfit`, plan totals and shop totals; the five-way
split lives in `weekLines` (the week in progress) and in `weeks`, which is a
12-week ring buffer. A season board needs lifetime totals per line — five new
numbers on `Stats`, a `SAVE_VERSION` bump, a migration writing zeroes, and they
must accrue through `bookProfit` like everything else or they will drift. That
is the one piece of sim work the whole feature needs, it is small, and it is
worth doing on its own merits: "what has my finance desk made me, ever" is a
question the game cannot currently answer.

### How long is a quarter

"Quarter" is the fiction and should stay — dealerships genuinely run quarterly
sales contests, and the salesperson-of-the-quarter plaque is the exact right
object. It does not have to mean thirteen weeks.

The arithmetic: the ladder is ~315h of sim time to a premium franchise, and the
offline cap gives 8–12h a day. So a 30-day season is roughly one full ladder for
somebody checking in twice a day, and 90 days is two and a half with nothing to
do at the end. **Four to five weeks is the shape**, named as quarters (Q1 '26,
Q2 '26) and run four to a year is fine too — nobody audits the calendar.

The honest constraint is not pacing, it is that a season which ends and is not
replaced reads as an abandoned game. See the live-ops note at the end.

### Cosmetics, and why this game gets them almost free

Cosmetics are the correct reward and the art pipeline is already most of the way
there:

- **Paint.** `tools/render-cars` renders 9 archetypes × 9 body colours × 2
  angles. A tenth colour is a re-render (~6 minutes) and a table entry, not new
  code. A season paint is a colour nobody else has.
- **Trim overlays.** `RarityTrim` already composites over any car on either
  renderer, positioned off generated `FrameAxes` rather than hard-coded heights.
  A season decal, plate frame or dealer sticker is another overlay entry through
  a seam that already exists and already survives a re-render.
- **The lot itself.** `environment.ts` draws six storefronts, bunting, an air
  dancer, a sign board. A season banner across the frontage, a different air
  dancer, a plaque by the door — all of it is under the car layer where the
  drawing is easy and nothing is pressable.
- **The pylon.** `LadderPylon` is already the progress readout. A season badge
  on the cap is one element.

**Cosmetics do not live in `GameState`.** Same argument as the onboarding flag,
and it is a stronger case here: they are account-level, they must survive
`hardReset` and every retirement, and *nothing about a hat resolves overnight*.
Putting them on the save buys a version bump, a migration and a `cloneState`
line for something the simulation must never read. A `src/state/wardrobe.ts`
under its own key, mirrored server-side once accounts exist.

That mirror is the real argument for accounts, incidentally. A player who earns
an exclusive paint and loses it to a new phone is a support ticket you cannot
answer.

### The rule, restated where it can break

A season cosmetic must never be a season *advantage*. No "+5% traffic livery",
no season-only upgrade, no title that does anything. The moment one exists,
opting out costs money and the opt-in stops being opt-in.

The one exception worth allowing: cosmetics may be **evidence**. A plaque that
says what you did is not a buff.

---

## Part two — the social ladder

Four tiers, cheapest first. Ship in this order; each is useful alone.

### Tier 0 — no backend at all

Do this first regardless of what follows.

- **Share cards.** Render a run summary — stage, net, the departmental split,
  the best car you ever found — and hand it to the OS share sheet. `finds.ts`
  already computes the away-summary carousel, which is the most shareable thing
  in the game and currently evaporates.
- **A leaderboard seeded from the harness.** `npm run sim` produces realistic
  runs at every rung with honest numbers. Ship a board of *house runs* — the
  district manager's figures — clearly labelled as such. At five players a real
  leaderboard is empty and depressing; this solves cold start for zero infra,
  zero privacy surface and zero ongoing cost.

Tier 0 is the only tier that keeps App Privacy at "Data Not Collected".

### Tier 1 — read-mostly global stats

Anonymous device ID. Two endpoints: `POST /sync`, `GET /world`. Global
counters, top-N boards, percentile-of-your-stage. No accounts, no friends, no
free text. **This is the tier the seasonal mechanic needs and nothing more.**

### Tier 2 — identity and friends

Sign in with Apple (required by Apple the moment any third-party login exists),
friend codes, side-by-side comparison, season history that survives a device
change. Still no realtime, still no user text.

### Tier 3 — chat and guilds

**Defer hard, and not for hosting reasons.** User-generated content brings App
Review obligations: block and report flows, a stated moderation commitment, an
EULA, a higher age rating, and an unbounded ongoing time cost for a solo
developer. It is the only tier whose price never drops.

---

## Part three — the backend

### The seam

`src/net/`, with the mirror of the rule that governs `src/sim`:

> **`src/sim` never imports `src/net`, and `src/net` never mutates `GameState`.**

Network results land in their own zustand slice and render as `—` when absent.
Nothing in the game ever blocks on a request. Offline progress is the pillar and
a leaderboard that stalls the lot screen has broken it.

One pure function is the entire client contract:

```ts
// src/net/profile.ts — pure, testable, no I/O
export interface PublicProfile {
  seasonId: string | null;
  stage: StageId;
  lifetimeProfit: number;
  lines: { metal: number; paper: number; plans: number; shop: number };
  carsSold: number;
  prestigePoints: number;
  retirements: number;
  skills: Record<SkillId, number>;
  playedMs: number;
  dirty: boolean;   // tuning overrides or an 'admin' ledger line, ever
}
```

Roughly 300 bytes. It is the only thing that goes over the wire. No PII, which
keeps the App Store privacy answer short.

**Sync on events, never on a timer**: foreground, retirement, stage move, season
close. Debounced to about once a minute. Five to fifteen writes per player per
day, not one per tick.

### Data model

Three tables carry all of Tier 1 and the whole seasonal feature.

```
players     (id, created_at, last_seen_at, platform, flags)
profiles    (player_id PK, season_id, snapshot JSON, updated_at, dirty)
placements  (id, player_id, season_id, board, value, at)   -- append-only
```

Leaderboards are a **rollup regenerated every few minutes into a KV blob**, never
an `ORDER BY` on the read path. At a hundred players the database is essentially
never touched by a read. Closed seasons become immutable JSON and can be served
as static files forever.

### The stack, and what it costs

**Cloudflare Workers + D1.** One Worker, a couple of hundred lines. Free tier at
time of writing is 100k requests/day on Workers and 5GB / 5M row reads / 100k
row writes per day on D1 — *verify before committing, these move.*

The arithmetic that matters:

| players (DAU) | syncs/day | requests/day | cost |
|---|---|---|---|
| 10 | 10 | 100 | $0 |
| 500 | 10 | 5,000 | $0 |
| 5,000 | 10 | 50,000 | $0 |
| 20,000 | 10 | 200,000 | ~$5/mo |

**You do not pay for hosting until you have thousands of daily players**, and
then it is a coffee. The real fixed costs are the Apple developer account you
already have and a domain.

Two properties make this cheaper than it looks. The sim is pure TypeScript with
zero runtime dependencies, so it runs *unmodified* in a Worker if verification
ever wants it. And seasons bound the write volume by construction — an all-time
board grows forever, a season is a closed set.

**Supabase** is the alternative if auth, storage and realtime batteries matter
more than cost control. Its free tier pauses projects after about a week of
inactivity, which is precisely wrong for a game with three players, so budget
the paid tier from day one there. Start on Workers.

---

## Part four — anti-cheat, and two holes that already exist

A vanity board can be soft. **A board that awards exclusive cosmetics is worth
cheating for**, so seasons raise the stakes on this considerably.

### Two repo-specific holes, both live today

**The public web build is a cheat client by design.** `adminEnabled()` returns
true for `platform === 'web'`, and the GitHub Pages deploy *is* the web target.
That ships the admin console — which sets cash to any number and edits every
economic constant — to anyone with the link. `retire()` prices off cash, so the
natural leaderboard metric is directly pollutable there. Either refuse
submissions from web builds, or ship Pages with the console gated and keep a
separate internal URL. This is a decision to make before the first board exists,
not after.

**Offline catch-up trusts the device clock.** `deserialize` computes elapsed as
`Date.now() - lastSeenAt`. `offlineCapMs` bounds a single load to 8h (+4h per
night manager), but advance-clock-and-reload repeats it without limit. That is
already a single-player exploit and nobody notices, because there is nobody to
beat. Add a board and it is the first thing anyone tries. Fix: the server stamps
time on sync and elapsed is clamped against the *server's* last-seen, not the
client's.

### The soft posture — ship this first

Refuse any submission where `state.tuning` is non-empty or the ledger has ever
carried an `admin` event, and make the flag **sticky**: once dirty, always
dirty, for the account and not just the run. One boolean, and it closes the only
cheat that requires no effort at all.

Note that `lifetimeProfit` is already the better metric on these grounds:
`setCash` deliberately leaves it alone, and it only moves through `bookProfit`.
Cash is a level anybody can write; profit is a subtraction with one door.

### The hard posture — keep the door open

Record an action journal — `(t, action, args)` — and replay it server-side
through the real sim. The sim is pure, deterministic, dependency-free and
already runs in node; the shared season seed means the server knows what the
feed should have contained.

**Write `src/net/journal.ts` on day one even if nothing consumes it.** A journal
cannot be backfilled. If verified boards are ever wanted, the decision has to
have been made before the season it verifies.

The honest limit: replay proves internal consistency, not wall-clock honesty. It
catches an edited save; it does not catch a manipulated clock. That is what the
server timestamp above is for, and the two together are most of the way there.

---

## What this costs the project

Worth pricing before committing, because several current properties depend on
there being no server.

- **App Privacy stops being "Data Not Collected".** A device identifier plus
  gameplay stats is *Identifiers* + *Usage Data*, linked to the user. Still a
  short form; no longer a one-liner.
- **A privacy policy URL becomes mandatory**, and a deletion endpoint with it.
  Trivial built on day one, painful retrofitted.
- **`usesNonExemptEncryption: false` stays correct** — OS-provided TLS is
  exempt — but re-confirm at submission rather than assuming.
- **Account recovery becomes real support load.** Anonymous device IDs mean a
  new phone loses everything, and with cosmetics on the line that is a ticket
  you cannot answer. This is the argument for pulling Sign in with Apple earlier
  than Tier 2 suggests.
- **Seasons are a live-ops commitment.** A season that ends and is not replaced
  reads as an abandoned game — worse than never having had one. Mitigation:
  make the fallback **evergreen**, so a season auto-rolls with a generated seed
  and a generated name and never needs a human to start it. Hand-authored
  seasons then become a bonus rather than an obligation.

---

## Open questions

- **Does an opt-in reset help or hurt retention here?** The stated case is that
  it gives players a reason to keep playing, and for the players who opt in that
  is almost certainly right. The counter-risk is the majority who do not: once
  the leaderboard is where the news is, the career game can start reading as the
  side mode. Mitigations are all cheap — keep career progress visible during a
  season, let season cosmetics be worn in the career, keep seasons short — but
  nobody has measured any of it and this game has no telemetry to measure it
  with.
- **Is a shared seed a feature or a straitjacket?** It makes the board
  comparable and makes cheating detectable. It also means everybody's first
  hour is identical, which is the part of this game that is most scripted
  already (the first listing is dealt, not rolled). Needs a human to play two
  seasons on one seed and say whether it reads as a format or as a rerun.
- **Which board is the headline?** Salesperson of the Quarter is the best name
  and metal is the most legible business, but paper is the game — "the loan book
  is the game" is the oldest settled decision in the file. If the headline board
  rewards flipping cars, the season quietly argues against the thing the game is
  about.
- **What does a season cost the balance harness?** Nothing directly — the
  harness never retires and never borrows, so it cannot see any of this. But a
  season with no prestige edge is a run configuration nothing currently measures,
  and `prestigeEdge` is applied after the RNG draw specifically so a run with and
  without it share a stream. That makes it a clean A/B; somebody should run it.
- **Does the departmental board survive contact with the ladder?** A premium
  franchise books more profit in a week than a curbstone does in a career, so a
  raw per-department board is a stage board wearing a hat. Banding by stage, or
  normalising by weeks played, or running separate boards per rung — all three
  are plausible and none is obviously right.
