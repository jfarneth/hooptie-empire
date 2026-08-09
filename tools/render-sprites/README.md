# Sprite pipeline

Turns the `.glb` models in `models/` into the top-down car sprites the lot
draws. Three steps, each runnable on its own:

```bash
cd tools/render-sprites
python3 recolor.py                                  # atlases, one per model per colour
blender -b -P render.py -- --out build/sprites      # 81 frames, Cycles CPU
python3 pack.py                                     # shrink + generate the sprite table
```

`--only <archetype>` re-renders one archetype; the manifest merges rather than
being replaced, so a partial run does not drop the rest from the generated table.

Requires Blender (4.0 tested) with numpy available to its Python — Ubuntu's
package uses the system interpreter, so `apt-get install python3-numpy` is what
the glTF importer needs. Pillow is needed for the two Python steps.

## What ships and what does not

`models/` and `config.json` are the assets. `build/` is intermediate and
gitignored. `src/ui/art/sprites/` is the packed output, committed because a
clean clone has to build without Blender installed.

## The one thing to know before changing it

**Paint is a texture edit, not a material.** Kenney's kit puts every model on a
single material sampling one 512x512 palette atlas, and each mesh's UVs point at
a flat swatch — so recolouring a material would repaint the glass and tyres too.
Each model also ships in its own colour, so there is no single paint band;
`config.json` declares the source hue window per model. The saturation floor in
those declarations is what separates paint from the shared blue-grey chassis
that every model carries at ~40% of its surface, and it is load-bearing.

Measure paint bands **area-weighted**, never by vertex count. A big flat roof is
four vertices and a detailed bumper is forty, so counting vertices reports the
bumper as the car's colour — which is how the first attempt concluded that every
car in the kit was green.
