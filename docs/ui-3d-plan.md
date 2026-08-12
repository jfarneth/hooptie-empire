# Making it look like a game

A plan for moving the UI from "a well-organised sheet of information" to
something that reads as a 3D game, and — more importantly — a plan for getting
the art without painting yourself into a corner.

Nothing in here touches `src/sim`. The purity rule holds throughout, the 186
tests and the balance harness are unaffected, and no save migration is required
if the recommendations below are followed.

## Settled before you read on

Two calls are already made, and the rest of the document assumes them.

**The camera is top-down aerial**, not isometric and not a 3/4 hero shot: you are
looking straight down at the dealership, and the lot scrolls as it gets bigger.
That choice is doing more work than it looks. A top-down plate is the only camera
that stays legible across the 5-to-62 car range (§1), it makes the lot a *map* the
player pans rather than a diorama they admire, and it is the cheapest angle to
render — one camera, no per-orientation art until cars need to turn.

**Twelve car archetypes**, not six and not thirty. See §4.

Mockups of every option below, shot at 390×844, are in `docs/mockups/`. They are
drawn procedurally in SVG as stand-ins for rendered sprites — they show the
composition and the lighting intent, not the real pipeline.

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

### Option A — Flat vector, top-down

*Mockup: `docs/mockups/01-option-a.jpg`.*

Keep `react-native-svg`. Redraw the cars from directly above instead of in side
profile, and replace the bay grid with one continuous lot surface: painted stall
lines, drive aisles, a showroom roof across the top of the frame, street frontage
with banner flags at the bottom. The car carries its own state — a price sticker
floating over the roof, a wrench badge while it is in the shop — so no card exists
until you tap one.

Depth comes from contact shadows and overlap alone. All procedural, all in code.

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

*Mockup: `docs/mockups/02-option-b.jpg`.*

Model each car once in 3D, render it offline from a fixed overhead camera to a
sprite atlas, ship the images. Same lot as Option A, except every car is a
properly lit, shaded, three-dimensional object with real ambient occlusion under
the sills and a specular highlight that follows its bodywork — and the tarmac
gets grain, oil stains, tyre scuff and sodium light pools.

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

*Mockup: `docs/mockups/03-option-c.jpg`.*

An actual 3D scene. Orbit the lot, real materials, dynamic lighting, day/night,
a camera that pushes in when you tap a car and cars that turn as they drive in.

The mockup surfaced the argument against it better than prose does: **at phone
width a perspective camera gives you six or nine cars legible and the rest a
smear.** Top-down gives you all sixty-two. Tilting the camera trades away exactly
the property the game needs most at the top of the ladder, and no amount of
render quality buys it back.

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

| Asset | Minimum | **Chosen** | Notes |
|---|---|---|---|
| Car archetypes | 6 | **12** | 6 matches today's fidelity; 12 is the call |
| Paint colours | 9 | 9 | Free — a render loop, not an art task |
| Camera angles | 1 | 4 | 1 for a static lot; 4 if cars turn on arrival |
| Condition overlays | 3 | 5 | Grime, rust, dents — shared across all archetypes |
| Stage backdrops | 6 | 6 | One per stage. Biggest visual win per dollar |
| Lot surface tiles | 4 | 8 | Asphalt, stall lines, curb, corner |
| Props | 6 | 15 | Light poles, banner flags, price signs, tow truck |
| Characters | 3 | 8 | The walk-up buyer, the mechanic, the repo man |

**On archetype count — settled at 12.** The catalogue has 30 models but only 6
body styles, and the game currently distinguishes exactly those 6. Per-model art
multiplies the commission by five and buys less than it looks like — nobody will
notice that the Nakato Civet and the Bergstrom Vantage share a shell, because
they already do.

Twelve is the high-value middle: split each body style by roughly economy vs.
premium. A Kessler Sovereign and a Renwick Comet are both `sedan` today and render
identically apart from paint, which is the one place the current art genuinely
misrepresents the game — the whole ladder is about moving upmarket, and the cars
never look it.

The mapping lives in `registry.ts` as `modelId → archetype`, so the split can be
re-cut later without touching a call site, and the 30 model ids stay exactly as
they are in save data.

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

tools/render-cars/
  render.js           # three.js in headless Chromium — no Blender
  models/*.glb        # source models — the actual asset you own
  models.json         # archetypes and paint bands
  views.json          # the angles
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

`tools/render-cars` is a build-time tool. `playwright` and `three` are not in
`package.json`; the generated frames are committed, so a clean clone builds
without either.

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
progression narrative. ✅ **Half done**: the pylon sign at the right-hand end of
the building now carries progress toward the next store — the cap names it, the
column fills with cash, and it reads READY when the cheque would clear. Cash and
book value are still typography at the top of the screen.

**The ladder becomes browsable.** ✅ **Done.** Tapping the sign opens all six
stores, one at a time, including ones the player cannot afford: entry cost, lot
size, what the feed carries, whether the finance desk is theirs, what the payroll
costs. A card that only ever named the next rung hid four fifths of the game from
somebody deciding whether to keep grinding. It also carries the two moves that
were not possible before — jumping rungs, and walking back down and eating the
loss.

**The Office becomes a room** with objects instead of a list of lists: a desk
(Business), a filing cabinet (Admin), a certificate wall (Skills), blueprints on
the drafting table (Upgrades). Old idea, works every time.

**Capacity growth becomes visible.** The `lot` upgrade is literally called "Pave
another row." The lot should gain a row of asphalt when you buy it. That single
change turns the most boring upgrade in the game into the most satisfying one,
and it costs one entry in `layout.ts`.

Both ends of that range are mocked up: `docs/mockups/04-scale-small.jpg` is
curbstoning at three cars with the camera pushed in, and
`docs/mockups/05-scale-big.jpg` is a premium franchise at 62 with the camera
pulled back and the lot scrolling past the frame. Columns, car scale and row
pitch are all outputs of `layout.ts` given a capacity — which is why that function
being pure and tested matters more than it sounds.

---

## 7. Phasing — and the direct answer to the question

You asked whether to build the engine and stub the sprites while a package gets
commissioned, or to build something good enough to launch. **With this pipeline
those are the same work, done in this order:**

**Phase 1 — the scene, no assets. ✅ Done.**
`LotScene`, pure `layout.ts` with a test file, the `CarArt` seam, the twelve
archetypes, top-down vector art, a HUD that floats over the scene, buyer figures,
and capacity-driven lot growth. The renderer is still vector — this is Option A,
and if you never commission anything it is a perfectly respectable place to stop.
**None of it is thrown away when sprites arrive.**

Three things this shook out that the mockups did not:

- Markers positioned relative to the *stall* land on the car in the row in front.
  They hang off the car now.
- Light glass covers most of a car's plan view and washes the paint out — nine
  body colours became shades of the same grey until the glass went dark.
- At 62 cars there can be thirty walk-ups on screen at once. An unringed figure
  is a brown speck on tarmac, so the buyer got a ring in the accent colour.

**Phase 2 — the pipeline, free assets. ✅ Done, then rebuilt.**
Built first against Kenney's CC0 Car Kit in headless Blender: `recolor.py`
repainted the palette atlas, `render.py` rendered 81 top-down frames, `pack.py`
shrank them and generated the sprite table. The lot went rendered 2.5D; the feed
and the sheets stayed vector.

It is `tools/render-cars` now — the same three steps through three.js in
headless Chromium, and the Blender scripts are gone. **The reason is the whole
lesson of this phase: a pipeline a normal checkout cannot run is a pipeline
nobody runs.** Blender + Pillow meant the art was frozen the moment it shipped,
which is why §"the camera moved to isometric" below spent its life recording the
top-down angle as owed work, and why the side angle went unrendered for the
entire life of the feature while the plan said it was optional. Rebuilt on the
browser this repo already drives, the whole matrix re-renders in about six
minutes from `npm i -D playwright three`.

The swap was like-for-like at the top-down angle: footprints measured off the
Blender frames and the three.js frames agree to three decimals.

What the plan got wrong, and what it cost:

- **The kit puts paint in a texture, not a material**, and every model ships in
  its own colour — so there is no one paint band to remap. Bands are declared
  per model in `config.json`.
- **Measuring those bands by vertex count is wrong.** A flat roof is four
  vertices and a bumper is forty, so the first pass concluded every car in the
  kit was green. Area-weighted sampling matched the previews immediately.
- **A packed texture ignores a new filepath.** The GLB embeds its atlas, so
  `reload()` re-read the packed bytes and every colour rendered identically —
  distinguishable only by Cycles' sampling noise, which is just close enough to
  look like it worked.
- **Two mappings were wrong on sight and only on sight.** Kenney's `suv` has an
  unpainted grey roof, so from directly above it never showed its paint at all;
  and `race` is an open-wheel formula car, which at a Valmont franchise filled
  the screen with F1 cars. Both were invisible in the numbers.

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

## The camera moved to isometric (25° tilt, 25° yaw)

The original plan called for a shallow tilt off straight-down — 12 degrees, small
enough that the parking plan could stay flat 2D. That shipped and held. This is
the note on why it changed and what it cost.

**What changed.** The camera now carries two angles: 25 degrees of tilt and 25
degrees of yaw to the right. The lot reads as a diorama rather than a plan, a
building shows two faces instead of one elevation, and the rows run diagonally.
`src/ui/lot/camera.ts` is new and owns every projection; `surroundings.ts` is new
and fills the corners the rotation opens up with a neighbourhood that changes per
stage.

**What it did not cost.** `layout.ts` was not touched. An orthographic camera
maps horizontal planes affinely, so the whole ground plate is still authored in
flat lot coordinates and posted through one svg matrix, and a wall gets an
isotropic local space that let the six storefronts port over nearly verbatim.

**What it did cost, and this is the real trade.** A rotated rectangle needs about
1.8x the width of an unrotated one, and that comes straight out of car size: ~34px
on a small lot against ~75px before. There is no way around it — the corner
triangles are geometry, not a bug — so the honest options were smaller cars or a
scene that pans. Both are in: the camera shrinks to fit until a car would go
under 30px, then stops and lets the scene be panned sideways. The early stages
never pan; a premium franchise always does.

**What is still owed, and it is not what this said.** The sprites are shot at 12
degrees, so they are laid on the ground plane at the right angle and the right
foreshortening but lit from a shallower camera. This paragraph used to call the
fix "re-run the tool with `tiltDegrees: 25` and a matching yaw", deferred only
because Blender was unavailable. The tool is available now, and that fix is
wrong.

`LotScene` lays a top-down frame down through `artRotationDeg` and `artSquash`,
so a render's own foreshortening COMPOSES with the scene's. At 12 degrees the
pair land on 0.978 × 0.939 = 0.918 against a correct 0.906. At 25 they would
land on 0.851 — a car squashed by 15% sitting on tarmac squashed by 9%. The
angle would be right and the shape would be worse.

Closing it properly means baking the full 25/25 projection into the frame and
having `LotScene` stop transforming the art at all: verticals vertical, the roof
correctly offset from the footprint, the sprite simply placed at the projected
stall centre. That is a change to how cars are POSITIONED — new artboard,
re-measured geometry, a different hit target — and it is worth doing. It was
never one config value, and calling it one is what kept it looking cheap enough
to defer indefinitely.
