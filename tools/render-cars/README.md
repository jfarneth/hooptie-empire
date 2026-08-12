# Car art pipeline

Turns the `.glb` models in `models/` into the frames the game draws. **No
Blender and no Python** — three.js in headless Chromium, which is the browser
the repo already keeps around for driving the app.

```bash
npm i -D playwright three                # not in package.json: build-time only
node tools/render-cars/render.js         # 162 frames, both angles
node tools/render-cars/pack.js           # generate index.ts and geometry.ts
```

`--view=side` or `--only=sedanEconomy` narrows a run; the manifest merges rather
than being replaced, so a partial run does not drop the rest from the generated
tables. `--colors=1` renders one swatch, which is what you want when you are
eyeballing an angle rather than shipping one.

Then look at it, which is the only verification that applies to a picture:

```bash
npx expo export --platform web --output-dir /tmp/web
npx tsx src/tools/dumpsave.ts smallUsed /tmp/save.json
node tools/render-cars/shots.js /tmp/web /tmp/save.json /tmp/shots
```

`shots.js` forces one car of each trim grade onto the lot, because rarity is
90/9/0.9/0.1 and a legendary car will not turn up in a fixture by waiting for
it — and the grades are exactly what the overlay has to land correctly on.

## What it produces

| view | angle | ships at | drawn by |
|---|---|---|---|
| `top` | 12° off vertical | 192 x 397 | the lot, ~34–60px, sixty at a time |
| `side` | 62° off vertical, yawed 66° | 288 x 176 | the feed at 96px, the sheets at 220px |

Both go to `src/ui/art/sprites/`, committed, because a clean clone has to build
without any of this installed. `frames.json` beside them is the manifest.

## The two generated files, and why they are generated

`index.ts` is the sprite table. Metro cannot resolve a computed `require`, so it
has to be a source file with one literal require per frame.

`geometry.ts` is where each car sits in its frame and which way its own axes
point. This used to be measured by a separate pass over the committed PNGs and
pasted into `footprint.ts` by hand, which works and leaves one failure mode wide
open: re-render, forget the paste, and every spoiler in the game sits a few
percent off the car it is bolted to, on every screen, with nothing failing. A
number written by the run that produced the frame cannot go stale against it.

## Things that bite

**Paint is a texture edit, not a material.** Kenney's kit puts every model on a
single material sampling one 512x512 palette atlas, and each mesh's UVs point at
a flat swatch — so recolouring a material would repaint the glass and the tyres
too. Each model also ships in its own colour, so there is no single paint band;
`models.json` declares the source hue window per model. The saturation floor in
those declarations is what separates paint from the shared blue-grey chassis
every model carries at ~40% of its surface, and it is load-bearing.

Measure paint bands **area-weighted**, never by vertex count. A big flat roof is
four vertices and a detailed bumper is forty, so counting vertices reports the
bumper as the car's colour — which is how the first attempt concluded that every
car in the kit was green.

**The ortho box is measured over every VERTEX, not over bounding-box corners.** A
car's box is mostly empty at its corners, and at a three-quarter angle those
empty corners are exactly what project furthest: the first cut of the hero shot
framed the car filling 39% of its own artboard and the rest air.

**Nearest-neighbour filtering on the atlas is not optional.** It is a palette of
flat swatches packed edge to edge, so linear filtering bleeds one swatch into
its neighbour along every UV seam, which on a car reads as a dirty rim around
every panel.

**The top view's tilt is 12° and must stay in step with `SPRITE_TILT_DEGREES`**
in `src/ui/lot/camera.ts`. It is deliberately not the lot camera's 25° — see the
note in `views.json` for why that is a change to `LotScene` rather than a change
to a number here.

**Chromium is at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`**, which is
a directory; `/opt/pw-browsers/chromium` is a file. `playwright` resolves only
from the repo root. There is no GPU, so the launch asks for SwiftShader
explicitly — three falls back to nothing at all rather than to software.

## Credits

Models are Kenney's Car Kit, CC0. `models/License.txt` is the original licence.
