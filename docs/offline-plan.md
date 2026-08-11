# The overnight problem — measurement and candidate levers

**Status: measured, not decided.** No balance constants have moved. This
document exists because the numbers below took real machinery to produce and
the decision they inform is still open.

## The bug, stated precisely

Sleep at the curbstone and you wake up able to skip the small dealership —
usually the large one too. Measured with the honest protocol (bot plays
curbstone for 2h, then **pure engine catch-up** with no bot, exactly what
`store.load()` runs):

> **Go to sleep with $21.5k. Wake up with $1.09M.** 544 cars sold overnight;
> 81% of seeds can buy the $900k large lot before breakfast. Sleep an hour
> later instead and it is $1.32M and 100%.

The mechanism is one upgrade: **`salesDesk` is buyable at curbstone** for
$6,000, `staff: true`, wage $72/game-week — and he works every night, forever,
at full speed. Curbstone's own blurb says *"nobody to pay but yourself."* The
`nightManager` — whose entire fiction is "keeps the lot running while you are
away" — is gated to `smallUsed` and only extends an offline cap (8h flat) that
already covers a full night without him. So the coverage fantasy is sold one
rung above the place it matters, and stage 1 ships with a tireless night shift
nobody hired for nights.

Note the harness never saw this: the bot climbs the moment it can afford to
and acts every 5 seconds forever, so "asleep on a rung with only the engine
running" was unmeasured until `tools`-side rigs were written for this doc.

## The grid

16 seeds each. Protocol as above; "mult" is a traffic multiplier applied only
during the offline stretch; wage/floorplan are applied throughout, as a real
settings change would be. `affordBig` = share of seeds that can buy the $900k
large lot on waking.

| lever | wake cash | sold overnight | affordBig |
|---|---|---|---|
| **baseline** (8h night) | **$1,089k** | 544 | **81%** |
| sleep at 3h instead of 2h | $1,316k | 571 | 100% |
| offline traffic ×0.5 | $844k | 407 | 25% |
| offline traffic ×0.25 | $439k | 228 | 0% |
| offline traffic ×0.1 | $159k | 93 | 0% |
| offline cap 8h → 4h | $549k | 267 | 0% |
| offline cap 8h → 2h | $293k | 127 | 0% |
| combo ×0.5 + 4h cap | $416k | 204 | 0% |
| wages ×3 (0.036) | $988k | 517 | 63% |
| wages ×8 (0.10) | $555k | 437 | 0% |
| floorplan ×5 (0.02/wk) | $852k | 436 | 44% |
| salesDesk moved off curbstone | **$0** + 5 cars stock | 0 | 0% |

For scale: two hours of *attended* play earns ~$21k, so a night "worth 1–2
hours of play" — the genre convention — is a wake cash around $150–350k.
Traffic ×0.1–0.25 and cap 2–4h both land in or near that band. **Any fix must
hold for later bedtimes too**: both do, because a cap bounds the night
absolutely and a multiplier scales whatever the rate was.

## Expenses: measured, and the wrong tool for this job

The wage knob is live (`weeklyWage` reads `BALANCE.expenses.wageOfCost` per
call — an earlier draft of this grid said otherwise because the measuring rig
itself reset the override; `applyTuning` resets every tunable before applying
its map, which is worth knowing before anyone else writes a rig).

But look at what the bill already claims, per stage, measured as expenses ÷
gross on a going concern (engine-only, 2h):

| stage | expenses/h | net profit/h | expense share of gross |
|---|---|---|---|
| curbstone | $5.5k | $28.7k | **17%** |
| small used | $20.5k | $131.5k | 15% |
| large used | $69.5k | $153.6k | 36% |
| low-cost franchise | $165k | $302.5k | 38% |
| midsize franchise | $346k | $69.0k | **85%** |
| premium franchise | $742k | $13.0k | **133%** |

(The curbstone absolute rate is understated here — the rig's warm-up buys no
driveway levels — but the *shares* are the point.)

Two conclusions fall straight out:

- **"Expenses feel low" is true only at the bottom.** At the top the premium
  franchise already pays out more in overhead than it grosses — that IS the
  flatline bug, quantified. Wages scale by `upgradeCostMultiplier` (18× at
  Valmont), so any global raise lands 18× harder exactly where the economy is
  already dying. Wages ×8 does brake the curbstone night ($555k) — and would
  annihilate every franchise. The lever works; it is aimed at the wrong thing.
- If anything, the ladder's top wants expenses *cut* or margins raised, which
  is the standing retune CLAUDE.md already calls one job, not three.

## Do not do the "pure" thematic fix alone

Moving `salesDesk` to `smallUsed` (which its fiction invites) makes the
overnight **net negative**: nothing sells, the mechanic's and buyer's wages
plus floorplan drain cash to the zero floor, and you wake with **$0 and five
cars** — the lot capacity itself caps how much inventory can accumulate. "Wake
to a lot full of the buyer's finds, sell them over coffee" is a genuinely nice
loop, but only if the wage clock is not running on staff who cannot close.
As a lone change it reads as punishment and flirts with the documented spiral.

## The candidate mechanisms, with design notes

**A. Coverage cap (recommended first move).** Base `offlineCapMs` 8h → 2–3h;
`nightManager` +5h per level (max ≈ 22h, near today's 24) and stays where it
is, at `smallUsed`. Wake ≈ $293k at 2h. Nothing new is built: the cap exists,
the away modal *already says* "Your night manager only covers so much. Hire
more coverage…", and the constants are two lines. No determinism questions —
within the cap, offline is still exactly real, which keeps the settled pillar
intact. The small dealership stops being skippable by sleep and becomes the
store that *sells you the night*: the ladder card can say so, and curbstone
can show a locked night-manager row as the advertisement. Cost: two constants,
copy, a locked-row UI nicety, and a re-measure.

**B. Offline sell-through multiplier (the user's instinct, made thematic).**
While unattended, walk-ups arrive but close at ×0.25 or less — the desk goes
home; each `nightManager` level restores toward ×1. Softer feel than a cap
(the whole night shows life in the away summary) and the staffing tie kills
the classic exploit (leave the app open = full speed) by making coverage the
thing you buy rather than attendance the thing you fake. Cost: an
attended/unattended input to `advance()` read at one call site
(`stepProspects`), nightManager coupling, away-modal copy, and an honest
amendment to the "offline progress is the real thing" pillar in CLAUDE.md —
it becomes "the engine really ran; the lot was just dark." Determinism
survives (the flag is fixed for the whole catch-up), but the tick-invariance
test should grow a case with the flag set.

**C. Market depth (the long-horizon honest fix).** A neighbourhood only
absorbs so many cars a week; `prospectRate` falls as recent sales exceed a
per-stage depth, generous up top where volume is the design. This is the only
lever that targets *parked* play in general — the 9h `--stay` runs, not just
the offline case — with no attended/unattended distinction and no pillar
amendment, and it hands the ladder a second reason to exist: move up because
the market is bigger, not just the cars. It is also the only candidate that is
a real feature: new state (a rolling sold counter), `SAVE_VERSION` 12,
clone/fingerprint entries, and a full re-measure. Worth doing on its own
merits someday; too big to be the overnight fix.

**D. Expenses.** See above: keep for the late-game retune, not for this.

A and B compose cleanly (B is what A's cap "feels like" from inside) but
either alone closes the reported bug. A is one evening of work; B is a
weekend.
