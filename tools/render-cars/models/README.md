# Source models

The 3D models the sprite pipeline renders from. **These are the asset you own** —
the sprites under `src/ui/art/sprites/` are a build artifact generated from these
and can be deleted and regenerated at any time.

Committed to the repo on purpose. A clean clone has to be able to re-render the
whole sprite set, or the pipeline is not reproducible and the "swap in better art
later" story quietly stops being true.

## What goes here

Prefer **`.glb`** (single file, geometry + materials, no loose textures). `.gltf`
with a sibling `.bin`, or `.obj` with an `.mtl`, also work. Skip `.fbx` unless
nothing else is available.

Do not commit the whole download. Kits ship the same models in four or five
formats plus previews and licence PDFs; commit the format above and drop the
rest, or the repo carries tens of megabytes it never reads. **Do** keep the
licence file — see below.

## What the pipeline needs

Twelve archetypes, matching `src/ui/art/archetypes.ts`. A kit rarely maps
one-to-one, so `config.json` carries the mapping from filenames to archetypes and
one model may serve two archetypes at different scales.

| Archetype | Wants |
|---|---|
| `sedanEconomy` | a plain saloon |
| `sedanPremium` | a longer, lower saloon |
| `coupeEconomy` | a small two-door |
| `coupePremium` | a sports two-door |
| `hatchEconomy` | a small hatchback |
| `hatchPremium` | a warm hatch |
| `suvEconomy` | a boxy crossover |
| `suvPremium` | a large luxury SUV |
| `vanEconomy` | a panel van |
| `vanPremium` | an MPV or a long-wheelbase van |
| `truckEconomy` | a work pickup |
| `truckPremium` | a large crew-cab pickup |

Paint colour is **not** baked into these. The render script assigns the body
material per pass and emits one frame per colour in `BODY_COLORS`, so a model
needs its paintable bodywork on its own material slot. Where a kit bakes paint
into a shared atlas texture, `config.json` names the material to override.

## Licensing

Whatever ships with the kit — `License.txt`, `CC0.txt`, a readme — **commit it
next to the models**. A game that ships third-party art needs its provenance in
the tree, not in someone's memory of where they downloaded it.
