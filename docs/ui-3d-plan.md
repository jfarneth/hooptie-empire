# Making it look like a game

A plan for moving the UI from "a well-organised sheet of information" to
something that reads as a 3D game, and — more importantly — a plan for getting
the art without painting yourself into a corner.

Nothing in here touches `src/sim`. The purity rule holds throughout, the 186
tests and the balance harness are unaffected, and no save migration is required
if the recommendations below are followed.

---

## 1. What is actually wrong

Worth being precise, because "make it 3D" and "make it feel like a game" are two
different asks and only one of them needs an art budget.

**The rendering is flat, but that is the smaller problem.** `CarSvg` draws six
side-profile silhouettes — a body path, a cabin path, two wheels, a shoulder
highlight, and a rust bloom under 45% condition. It is a genuinely good piece of
work: condition reads at a glance, it costs nothing, and it scales to any size.
It is also a 2D orthographic side view, which is the one camera angle that can
never look three-dimensional.

**The composition is the bigger problem.** Every screen in the game is a
`ScrollView` of cards:

| Screen | What it is now |
|---|---|
| Lot | 2-column flex-wrap grid of bay *cards* — a table with pictures in it |
| Buy | Vertical list of rows: thumbnail, three lines of text, a price column |
| Notes | Vertical list of contract rows |
| Office | Vertical list of upgrade/skill/setting rows |

The lot is not a place. It is a grid of `flexBasis: '47%'` boxes, each carrying a
name, a status line, a meter and up to two badges. A walk-up buyer — the most
dramatic moment the game has — is an orange pill reading `BUYER`. The
reconditioning bay is a 3px progress bar. Nothing occupies space; everything
reports.

**The scale range makes this worse, not better.** Lot capacity runs from **5
cars** (curbstone, driveway maxed) to **62 cars** (premium franchise, 42 base +
5 levels of `lot` at +4). At 5 the card grid is fine. At 62 it is four screens of
scrolling and the player has no idea where to look. Whatever replaces it has to
work across a 12x range, and "more cards" is not an answer at either end.

**The good news:** `CarSvg` has exactly three call sites — `LotGrid`,
`CarSheet`, `BuyScreen`. The seam for swapping the renderer is about as small as
a seam gets.

---

## 2. Four options

### Option A — Vector diorama

Keep `react-native-svg`. Redraw the cars at a 3/4 isometric angle instead of side
profile, and replace the bay grid with one continuous lot surface: a ground plane
in perspective, painted stall lines converging toward a vanishing point, cars
parked in rows that scale down with distance, a dealership facade across the top
of the frame, sodium light pools as radial gradients, a night sky above.

Depth comes from overlap, scale-by-row, ground contact shadows, and a warm-to-cool
gradient into the distance. All procedural, all in code.

- **Asset cost:** zero.
- **Build cost:** 3–4 days.
- **Ceiling:** a stylish flat-vector game — Mini Motorways, Pocket City. It will
  not read as "3D" to anyone who used that word literally.
- **Perf:** the weak point. Each car is ~12 SVG nodes; 62 cars is ~750 nodes
  re-rendering behind a 250ms tick. Needs level-of-detail (back rows drawn as
  simplified shapes) to survive the top stage.
- **Pick this if:** you want a large visible improvement this week and no art
  budget ever.

### Option B — Pre-rendered 2.5D sprites ← **recommended**

Model each car once in 3D, render it offline from a fixed camera angle to a PNG
atlas, ship the images. Same isometric lot scene as Option A, except every car is
a properly lit, shaded, three-dimensional object with real ambient occlusion and
a specular highlight that actually follows its bodywork.

This is what essentially every successful tycoon game looks like, from
RollerCoaster Tycoon through the current mobile idle catalogue. It reads as 3D
because it *is* 3D — just photographed at build time instead of at run time.

- **Asset cost:** the whole question. See §4.
- **Build cost:** ~2 days of pipeline on top of Option A's scene work.
- **Ceiling:** high. Fully art-directed, and identical on every device.
- **Perf:** excellent. `Image` is a native view; 62 of them is nothing. It is
  strictly cheaper than what the game renders today.
- **Pick this if:** you want it to look like a real game and run on a cheap
  Android.

### Option C — Real-time 3D (`expo-gl` + three.js)

An actual 3D scene. Orbit the lot, real materials, dynamic lighting, day/night,
a camera that pushes in when you tap a car and cars that turn as they drive in.

- **Asset cost:** the same as Option B. You do not escape needing 3D models; you
  just load them at runtime instead of rendering them at build time.
- **Build cost:** high, and front-loaded with unknowns. New dependency surface
  (`expo-gl`, `expo-three` or `@react-three/fiber/native`, `expo-asset`, a glTF
  loader). Needs a spike to confirm it survives all three targets this project
  ships to: Expo Go, the react-native-web export on GitHub Pages, and a low-end
  phone. I would not assume any of those without testing them.
- **Payoff over B:** camera freedom and real animation. For a game the player
  looks at in 30-second bursts, that is a smaller win than it sounds.
- **Risk:** highest by a wide margin, and it destabilises a deploy pipeline that
  currently just works.
- **Pick this if:** the camera itself is the feature you want.

### Option D — Hybrid

3D only where it earns its keep — the lot scene, and possibly the car detail
sheet as a "walk around it" moment — with everything else 2D but restyled.

This is a scoping strategy layered on B or C rather than a separate technology,
and it is how B should be executed anyway: the Notes screen does not become a
better game by being rendered in perspective.

---

## 3. The recommendation, and the one decision that matters

**Option B, built so that Option C stays open.**

The decision that actually matters is not which renderer you pick. It is this:

> **Commission 3D models, not 2D sprites. The sprite sheet is a build artifact,
> not an asset.**

If you own `.glb` files and a Blender render script that lives in the repo, then:

- a new camera angle is a config change
- nine paint colours is a `for` loop, not nine commissions
- a new resolution for tablets is a re-run
- a damaged/repo'd variant is a material swap
- and moving to real-time 3D later means loading the files you already own

If instead you commission flat 2D sprites, you re-buy the art for every angle,
every colour, every condition state, and real 3D becomes a from-scratch
repurchase. The price difference at commission time is maybe 30%; the price
difference over the life of the project is several times over.

---

## 4. Getting the assets

### What you actually need

| Asset | Minimum | Comfortable | Notes |
|---|---|---|---|
| Car archetypes | **6** | **12** | 6 exactly matches today's fidelity |
| Paint colours | 9 | 9 | Free — a render loop, not an art task |
| Camera angles | 1 | 4 | 1 for a static lot; 4 if cars turn on arrival |
| Condition overlays | 3 | 5 | Grime, rust, dents — shared across all archetypes |
| Stage backdrops | 6 | 6 | One per stage. Biggest visual win per dollar |
| Lot surface tiles | 4 | 8 | Asphalt, stall lines, curb, corner |
| Props | 6 | 15 | Light poles, banner flags, price signs, tow truck |
| Characters | 3 | 8 | The walk-up buyer, the mechanic, the repo man |

**On archetype count.** The catalogue has 30 models but only 6 body styles, and
the game currently distinguishes exactly those 6. Per-model art multiplies the
commission by five and buys less than it looks like — nobody will notice that the
Nakato Civet and the Bergstrom Vantage share a shell, because they already do.

The high-value middle ground is **12 archetypes**: split each body style by
roughly economy vs. premium. A Kessler Sovereign and a Renwick Comet are both
`sedan` today and render identically apart from paint, which is the one place the
current art genuinely misrepresents the game — the whole ladder is about moving
upmarket, and the cars never look it.

**On backdrops.** Six stage backdrops will do more for "this is a 3D game" than
the cars will. A cracked suburban driveway under a streetlight, a gravel corner
lot with a hand-lettered sign, a paved lot with banner flags, and three
increasingly glassy franchise showrooms — that progression *is* the game's
narrative, and it is currently communicated by the text string in `stage.shortName`.

### Where to get it, ranked honestly

1. **Kenney (CC0, free).** The Car Kit and City Kit are public-domain low-poly 3D
   models. Enough to build the entire pipeline today, and arguably enough to
   launch. Zero cost, zero licensing risk, zero distinctiveness — a lot of games
   use these and it shows. **This is my recommended stub, and it is also a
   legitimate ship-it option.**
2. **Synty POLYGON packs** (~$20–60 each). City and Vehicle packs, cohesive
   style, permissive game-use licence. Cheap, far more distinctive than Kenney,
   and instantly recognisable to anyone who plays indie games — which cuts both
   ways.
3. **Commission low-poly 3D models.** Roughly $80–250 per car, $200–600 per
   environment/backdrop. A 12-archetype + 6-backdrop pack lands somewhere around
   **$2.5k–6k** depending on who you hire. The spec matters more than the price:
   *low-poly, single texture atlas, body paint on its own material slot, exported
   as `.glb`, consistent scale, origin at the ground contact point.* That spec is
   what makes the render loop trivial and the colour variants free.
4. **Commission 2D sprites directly.** Cheaper per image, permanently limiting.
   See §3.
5. **AI generation.** Genuinely useful for briefing — mood boards, backdrop
   concepts, showing an artist the lighting you want. Bad for shipping a 12-car
   set that has to look like one family photographed from one camera; visual
   consistency across a set is precisely its weakest property, and the licensing
   story for a commercial game is muddy. Use it to write the brief, not to fill
   the folder.

---

## 5. The seam

The thing that makes "stub it now, swap it later" work rather than becoming a
rewrite. Three new directories, no changes to existing call sites beyond an
import rename.

```
src/ui/art/
  CarArt.tsx          # <CarArt modelId colorIndex condition angle width />
  registry.ts         # modelId -> archetype -> sprite frame, or null
  vector/CarSvg.tsx   # today's drawing, moved — now the fallback renderer
  sprites/atlas.ts    # GENERATED: frame coordinates and sizes
  sprites/*.webp      # GENERATED

src/ui/lot/
  LotScene.tsx        # ground plane, rows, camera scale, prop layer
  layout.ts           # PURE: capacity -> slot positions. Unit-testable.
  Backdrop.tsx        # per-stage backdrop

tools/render-sprites/
  render.py           # headless Blender script
  models/*.glb        # source models — the actual asset you own
  config.json         # archetypes, angles, colours, resolution
```

Three properties make this work:

**`registry.ts` returns `null` for anything without art, and `CarArt` falls back
to the vector renderer.** So art can land one archetype at a time and the game is
never broken in between. That is the whole stubbing story, and it is four lines
of code.

**`layout.ts` is pure and takes a capacity.** Slot positions for 5 cars and for
62 cars come out of the same function, it has no React in it, and it gets a test
file like everything else in this repo. This is where the 12x scale range gets
solved once instead of being fought in JSX.

**Slot assignment and per-car variation derive from a hash of `car.id`.** Not
from new state. This is deliberate: it means `SAVE_VERSION` stays at 7,
`cloneState()` is untouched, and none of CLAUDE.md's warnings about nested state
objects come into play. A car parks in the same spot every render and keeps the
same wheel variant forever, with no migration and no risk to offline catch-up.

`tools/render-sprites` is a build-time tool. Blender is not an npm dependency;
the generated atlas is committed, so a clean clone builds without it.

---

## 6. Beyond the renderer — "less like a sheet of information"

Free of assets, and probably worth more than the art. Roughly in value order:

**The lot becomes a place.** One pannable surface, not a grid. Status lives *on*
the car: a windshield price sticker instead of a text row, the car up on a lift
with the hood open instead of a 3px meter, a `SOLD` banner across the glass. No
per-car card exists until you tap one.

**The buyer becomes a person.** A walk-up is currently an orange `BUYER` pill. It
should be a figure walking onto the lot toward a specific car. This is the single
most dramatic beat the game has and it is presently typography.

**The Buy feed becomes an auction lane.** The design is already a judgement call
under uncertainty — an estimated condition with an honest band. That deserves one
big card with the car front and centre and the band as a *gauge* the player reads
at a glance, not two small numbers in a price column. A swipe deck is worth
prototyping here; "swipe left on a hooptie" fits the fiction unreasonably well.

**The Notes screen is the hard one, and I would not force it.** The loan book is
the actual game and it is inherently tabular — 43 contracts with balances, due
dates and delinquency states. The best idea I have is a *collections board*: a
wall of customer cards with photographs, payment-due lights, and delinquents
moving into a chase column. But keep a table view behind a toggle, because unlike
the lot, this screen's numbers are the thing the player is reasoning about. A
pretty lot that hides the money would make the game worse, and that is the real
design risk in this whole document.

**The HUD goes diegetic.** Cash and book value on a lit dealership sign, and the
sign changes with the stage. Six signs is six pieces of art that carry the entire
progression narrative.

**The Office becomes a room** with objects instead of a list of lists: a desk
(Business), a filing cabinet (Admin), a certificate wall (Skills), blueprints on
the drafting table (Upgrades). Old idea, works every time.

**Capacity growth becomes visible.** The `lot` upgrade is literally called "Pave
another row." The lot should gain a row of asphalt when you buy it. That single
change turns the most boring upgrade in the game into the most satisfying one,
and it costs one entry in `layout.ts`.

---

## 7. Phasing — and the direct answer to the question

You asked whether to build the engine and stub the sprites while a package gets
commissioned, or to build something good enough to launch. **With this pipeline
those are the same work, done in this order:**

**Phase 1 — the scene, no assets. ~3–4 days.**
`LotScene`, pure `layout.ts`, the `CarArt` seam, diegetic HUD, buyer figures,
capacity-driven lot growth. The renderer is still today's vector art, improved to
a 3/4 angle. **This ships on its own as a real improvement and none of it is
thrown away.** If you never commission anything, this is Option A and it is a
perfectly respectable place to stop.

**Phase 2 — the pipeline, free assets. ~2 days.**
`tools/render-sprites` built against Kenney's CC0 models. At the end of this the
game is genuinely 2.5D and genuinely launchable. This is also your insurance
policy: if the commission falls through or takes three months, you have already
shipped.

**Phase 3 — the real pack. Weeks, mostly external.**
Commission against the §4 spec. It drops into the same registry and the same
render script. **Zero code change**, and it can land archetype by archetype
because the registry falls back per-archetype. There is no broken intermediate
state and no big-bang merge.

**Phase 4 — optional, only if you still want it.**
Real-time 3D. The `.glb` files are already in the repo by then; only the renderer
changes, and you will know from Phase 2 whether the extra fidelity is worth the
risk.

---

## 8. Risks and gotchas

- **Web bundle size.** The game deploys to GitHub Pages. 12 archetypes × 9
  colours × 1 angle at 512px WebP is roughly 3–5MB. Acceptable, but lazy-load per
  stage — a curbstoner never needs the Valmont lineup.
- **Perf at 62 cars.** Sprites are fine. SVG is not, and today's renderer already
  redraws the whole lot behind a 250ms tick. If Option A is the destination
  rather than a waypoint, LOD is mandatory, not optional.
- **No save changes** if variation derives from `car.id`. Worth holding the line
  on — CLAUDE.md is emphatic about `cloneState()` and nested state, and this whole
  project can avoid touching either.
- **The sim is untouched.** Everything here is `src/ui`. The harness, the 186
  tests and the determinism guarantees are not in scope and should not become so.
- **Legibility regression is the real danger.** The current UI is dense because
  the game is about numbers. Every screen that becomes a picture needs an honest
  answer to "where did the number go", and Notes probably keeps a table view
  permanently.
- **Verify in a browser at a real stage, not just in the harness.** CLAUDE.md's
  own note applies double here: generate a premium-franchise save, inject it, and
  look at 62 cars on a phone-width viewport before believing any of this works.
