# Service contracts and the service department

The design record for the two features that landed together, and every
measurement behind their numbers. `docs/skills-plan.md` and `docs/rarity-plan.md`
are the models for this document: what was built, what was measured, and what is
still unknown.

Both features answer the same complaint from a different side. The back half of
the ladder is a volume business — buying stops being a decision at the
franchises, and what is left is throughput. These add two things a dealership
actually makes money on that have nothing to do with buying a car well.

---

## Service contracts — a note in reverse

**Offered from the large used dealership up** (`STAGES[].serviceContracts`).

A `Note` is an asset: the customer owes you, you collect weekly, and the worst
case is that you take the car back. A `ServiceContract` is the mirror image. The
customer pays once at signing, and the house owes the repairs for the life of the
plan — same weekly beat, opposite sign. It is a real object on the save for the
same reason a note is: a plan sold two hours ago has to be able to cost money
tonight, with the app closed.

### The three properties that carry it

**Price is the car's risk, and the player does not set it.** `planPrice` is
expected claims over the target loss ratio. Expected claims index to
`conditionFreeValue` — the same basis recon cost uses, and for the same reason
(`docs`: a gearbox for a 200,000-mile beater is not a gearbox for a new car) —
multiplied by a condition risk term that runs 0.6 on a showroom car to 2.2 on a
rough one. **So cover on a beater costs the customer more**, which is the
inversion the whole product is built on and the thing that makes selling plans on
rough stock a decision rather than free money.

Measured, on a big-lot car:

| condition | plan price, as a share of retail |
|---|---|
| 0.9 (clean) | ~7% |
| 0.55 | ~11% |
| 0.2 (rough) | ~16% |

**The margin is a derivation, not an assertion.** There is no line anywhere that
adds a profit. The price is expected claims divided by `targetLossRatio`, and the
35% is what is left over when the claims are paid. That is what makes it
impossible to quietly get wrong, and it is why `service.test.ts` measures the
realised ratio over thousands of whole contracts rather than restating the
arithmetic — the `financeGrossMultiple` bug in CLAUDE.md is what happens when a
model is checked against itself.

**The variance is the product.** A plan desk that returned 35% on every contract
would be an interest rate with extra steps.

### The claim shape, and what it measures

A claim lands with probability `claimChancePerWeek` (5%) in each week of cover.
Its size is `min + span·u³` times the average claim — cubed, so most repair
orders are small and the mean is carried by the rare one that is not. Cumulative
payout is hard-capped at **150% of the plan price**, floored at zero by
construction.

Measured over 30,000 whole contracts spread across the four contract lengths:

| | no service department | with one |
|---|---|---|
| realised loss ratio | **65.1%** | **50.1%** |
| plans that never claim | 26% | 26% |
| plans that cost more than they sold for | 35% | 22% |
| plans that reach the cap | 24% | 10% |

That is the requested shape: about a quarter of plans are pure margin, a third
lose money, and the average is 35% (or 50% with your own bays).

**The cap is load-bearing, not decoration.** It eats 26% of expected claim
dollars, and pricing that ignored it would overcharge for cover by a third and
hand the house a 45% margin on a product sold as a 35% one. That is what
`capRecovery` is: a measured constant, with no closed form available, guarded by
the loss-ratio test. Move the claim shape or the cap and that test goes red,
which is the alarm the design trades for the fudge.

Note also what the cap means in fiction: a warranty that quietly stops paying on
a quarter of the plans that are claimed on hardest. That is on theme for this
game, and it is deliberately never shown to the customer.

### The band, and why the middle is the optimum

The player sets a MARKUP, not a price (`BusinessPolicy.servicePlanBand`), and the
attach rate moves against it:

| band | multiplier | buyers who take it |
|---|---|---|
| Loss leader | 0.80 | 36% |
| Cheap | 0.90 | 27% |
| Standard | 1.00 | 20% |
| Firm | 1.15 | 13% |
| Take them for it | 1.30 | 8% |

`attachElasticity` is 2.9, which is not a taste: it is `1/(1 − targetLossRatio)`,
the value that puts the peak of `attach × (band − lossRatio)` exactly on the
standard band. Both ends are therefore real trades around a genuine optimum
rather than one of them being a mistake.

**Opening a service department moves that optimum.** At a 0.5 loss ratio the peak
slides down to the cheap bands, because the house is no longer paying an
independent garage retail to honour its own paper. That is emergent rather than
scripted, and it is the nicest thing about the two features being priced off one
number.

### Rules worth keeping

- **The term is the buyer's own.** `financeTerms.weeks` is drawn for every
  walk-up whether or not they finance, so cover runs exactly as long as this
  customer's note would have — no second contract-length table to drift.
- **A repossession tears the plan up.** The customer and the car are both gone,
  and the house has no reason to keep repairing a car sitting on its own lot for
  somebody who stopped paying for it. It also means the worst borrowers are the
  cheapest to cover.
- **Plans move with the business; technicians do not.** Cover is paper, and paper
  moves intact exactly like the loan book — you still owe those customers the
  work, and you will be honouring it at the new store without the bays you used
  to have.
- **The desk's commission does not see plan money.** A commission is a share of
  the profit on the CAR at signing, and a plan's profit is made over eight months
  of not being claimed on. Paying a percentage of it on the day would be paying
  commission on a liability.
- **The price does not move when the shop opens.** The customer's price is the
  market's; what changes is what it costs the house to keep the promise.

---

## The service department — the first thing here that is not about cars

**Available at the franchise stages** (`STAGES[].shop`), opened by buying the
first `serviceBays` upgrade. There is no free bay, so "does this business have a
service department" is one question with one answer.

It is the only system in the game whose binding constraint is **benches**. The
lot is bound by stalls and cash; the shop is bound by how many people you can put
in front of a car at once, which is a constraint the player has not met before.

### Four rules

**Demand belongs to the store, capacity belongs to you.** Buying a bay does not
create customers — it lets you serve the ones being turned away. If demand scaled
with bays, paving would print money, which is the same mistake the lot's traffic
model exists to avoid.

**The rate is the dial, and capacity is what makes it a decision.** Underprice a
small shop and the queue overflows at a low rate; overprice a big one and six
technicians sit on full wages. The right rate is therefore a function of how much
bench you have, and it moves every time you hire. That is what stops it being a
set-once slider.

**A cheap technician is not cheap.** Grade buys speed and buys *fewer comebacks*,
and a comeback occupies a bench and bills nothing.

| grade | speed | comeback rate | wage |
|---|---|---|---|
| Entry | 1.00 | 15% | 1.00× |
| Mid | 0.82 | 10% | 1.30× |
| Certified I | 0.68 | 6% | 1.65× |
| Certified II | 0.57 | 3.5% | 2.05× |
| Certified III | 0.48 | 2% | 2.50× |

Speed climbs faster than wage on purpose. Flat per-dollar, the grades would be
interchangeable and the roster would be a spreadsheet with one right answer. As
set, an **entry technician is the better buy per dollar of payroll** and a
**certified one is the better buy per bench** — so which you want depends on
whether you are short of money or short of bays, and that flips over the life of
a store. Measured over an hour of continuous work per grade, a Certified III shop
turns roughly twice the jobs of an entry shop.

**Nobody is hired twice at the same store.** Technicians are staff, and a move
releases them with the rest of the payroll — the rule is "would this person have
to be hired again at the new store", and a Certified III who has spent forty game
weeks learning your bays would. Their experience goes with them. That is the
sharpest single cost of moving once a shop is running, which is why
`StageMovePreview.techsReleased` puts it in front of the button.

### Promotion

Earned in labour hours turned, not bought: 80 / 300 / 800 / 1,800 cumulative.
A busy technician turns roughly 50 hours a game week, so Certified III is about
36 game weeks of continuous work — a progression that spans hours of play rather
than minutes.

It is the **player's call rather than automatic**, and that is the decision: the
wage rises the moment you tap it and the throughput only pays back while there is
work on the ramp, so promoting the whole roster in a quiet shop is a genuine
mistake. Somebody hired in at grade is credited with the hours that grade
implies, or a bought-in Certified III would need a career before the button meant
anything.

### Sizing — "a useful sideline"

The brief was 10–20% of weekly gross, deliberately, because the shop lands on the
three rungs the ladder is most fragile at. Derived against each store's measured
weekly gross margin:

| store | weekly gross | shop at the going rate, fully built | share |
|---|---|---|---|
| Halvorsen | ~$67k | ~$11k | 17% |
| Okabe | ~$109k | ~$18k | 17% |
| Valmont | ~$263k | ~$48k | 18% |

Labour rates are hard numbers per store (`STAGES[].shop.hourlyRates`), for the
same reason the sales floors are: a rate is a rule the business runs on for hours
at a time, and one denominated in a share of something that moves would quietly
mean a different thing after every retune.

| store | rate stops ($/hr) | demand at the going rate |
|---|---|---|
| Halvorsen | 45 / 58 / 72 / 90 / 115 | 0.50 jobs/sec |
| Okabe | 55 / 72 / 92 / 118 / 150 | 0.65 jobs/sec |
| Valmont | 95 / 125 / 160 / 205 / 265 | 1.00 jobs/sec |

**Wages derive from the store's own rate** rather than being tabulated — a shop
billing $160 an hour pays its people more than one billing $72, and the two
figures cannot drift apart because there is only one of them. Same argument
`wageOfCost` makes for the rest of the payroll, and a new grade on the ladder
gets a sensible wage for free.

Demand is sized so a fully built shop at the middle rate is roughly at capacity,
which is what makes the rate slider a decision from the first bay to the sixth.

### What the department does beyond billing hours

- **Recon**: `reconSpeedPerBay` and `reconCostPerBay`, compounding, multiplicative
  with the `mechanic` upgrade and Wrenching — the house rule wherever money and
  practice touch one axis.
- **Service plans**: `shopClaimMultiplier`, taking the realised loss ratio from
  65% to 50%.

---

## Verify

Both features have an A/B constant that consumes **no RNG at all** when zeroed,
which is what lets every pacing baseline measured before they landed still
reproduce byte for byte:

```bash
npm run sim -- --seeds=64 --set=balance.service.attachRate=0
npm run sim -- --seeds=64 --set=balance.shop.demandScale=0
```

The attach roll is skipped *before* it draws rather than drawn and failed — a
roll that always loses still moves the stream. There is a test named for it, and
it is mutation-tested.

Confirmed: a 4h / 16-seed run on this build is **byte-identical** to the same run
on the build before it, because neither feature exists below the large used lot.

Measured on the ladder at `--hours=350 --seeds=8` — see CLAIMS in CLAUDE.md's
Verify section for the shipped column.

---

## Open questions

- **Nothing measures a player who prices cover away from Standard.** The harness
  bot runs every house rule at its default, so the band slider is unmeasured in
  exactly the way the sales floors are. The elasticity puts the EV optimum on the
  middle band by construction; whether the ends *feel* like real choices is a
  playtest question.
- **The bot only ever hires entry technicians and promotes from within**, which
  is the cheap play and therefore the conservative measurement. A player who buys
  certified staff in gets more than the harness reports, never less — but nobody
  has measured how much more.
- **Nobody has played a shop with the rate at either end.** The diagnosis line on
  the panel ("work is queueing and every bench is full") is the design's answer to
  a player who cannot tell an under-priced shop from an under-staffed one, and it
  has never been read by a human.
- **A fourth skill for the shop side** is now more obviously missing than it was.
  Technicians level; the player does not level alongside them. `skills` is a
  `Record`, so it needs no reshaping.
- **The plan desk is invisible on the lot.** Cover is sold on the deal sheet's
  behalf without the player seeing it happen — it appears in the ledger and on the
  Plans tab afterwards. Whether that reads as "the finance office doing its job"
  or as "money appearing from nowhere" needs a human.
