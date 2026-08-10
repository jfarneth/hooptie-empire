#!/usr/bin/env python3
"""
Repaint the kit's palette atlas, once per model per body colour.

Kenney's Car Kit puts every model on a single material sampling one 512x512
palette texture, and each mesh's UVs point at a flat swatch. A car is therefore
repainted by editing the texture, not by touching the model — and because each
model ships in its own colour, there is no one paint band to remap. `config.json`
declares the source band per model; see the note in there for how they were
measured and why the saturation floor matters.

Shading is preserved rather than flattened: a band is ~60 shades of one hue, so
each pixel keeps its brightness relative to the band's reference and picks up
only the target's hue and saturation. Flattening it would throw away the shading
the render depends on.

    python3 recolor.py [--out build/atlases]
"""
from __future__ import annotations

import argparse
import colorsys
import json
import os
import sys

try:
    from PIL import Image
except ImportError:  # pragma: no cover
    sys.exit("Pillow is required: pip install Pillow")

HERE = os.path.dirname(os.path.abspath(__file__))
ATLAS = os.path.join(HERE, "models", "Textures", "colormap.png")
CONFIG = os.path.join(HERE, "config.json")

# Must match BODY_COLORS in src/sim/models.ts. `Car.colorIndex` indexes both, so
# the order is load-bearing: entry N here is the paint for colorIndex N.
BODY_COLORS = [
    "#b23b3b",  # oxide red
    "#2f5f8a",  # fleet blue
    "#3d6b4f",  # forest
    "#8a8f96",  # silver
    "#2b2f36",  # graphite
    "#c8a24a",  # champagne
    "#7d5a8c",  # plum
    "#c26b3a",  # copper
    "#d8d5cd",  # pearl
]


def hex_to_rgb(value: str) -> tuple[float, float, float]:
    v = value.lstrip("#")
    return tuple(int(v[i : i + 2], 16) / 255 for i in (0, 2, 4))  # type: ignore[return-value]


def repaint(base: Image.Image, band: dict, target_hex: str) -> tuple[Image.Image, int]:
    th, ts, tv = colorsys.rgb_to_hsv(*hex_to_rgb(target_hex))
    _, _, reference_v = colorsys.rgb_to_hsv(*hex_to_rgb(band["reference"]))
    hue_min, hue_max = band["hueMin"], band["hueMax"]
    min_sat = band["minSaturation"]

    out = base.copy()
    pixels = out.load()
    width, height = out.size
    touched = 0

    for y in range(height):
        for x in range(width):
            r8, g8, b8 = pixels[x, y][:3]
            h, s, v = colorsys.rgb_to_hsv(r8 / 255, g8 / 255, b8 / 255)
            # Reds wrap around zero, so the window is checked on both sides.
            in_hue = hue_min <= h <= hue_max or (hue_min == 0.0 and h >= 1.0 - 0.02)
            if not in_hue or s < min_sat:
                continue
            nv = max(0.0, min(1.0, v * (tv / reference_v)))
            nr, ng, nb = colorsys.hsv_to_rgb(th, ts, nv)
            pixels[x, y] = (round(nr * 255), round(ng * 255), round(nb * 255))
            touched += 1

    return out, touched


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(HERE, "build", "atlases"))
    args = ap.parse_args()

    with open(CONFIG) as fh:
        config = json.load(fh)

    models = sorted({a["model"] for a in config["archetypes"].values()})
    os.makedirs(args.out, exist_ok=True)
    base = Image.open(ATLAS).convert("RGB")

    manifest = []
    for model in models:
        band = config["paintBands"].get(model)
        if band is None:
            sys.exit(f"config.json has no paintBand for model '{model}'")
        for index, colour in enumerate(BODY_COLORS):
            painted, touched = repaint(base, band, colour)
            name = f"{model}_{index:02d}.png"
            painted.save(os.path.join(args.out, name))
            manifest.append(
                {"model": model, "index": index, "color": colour, "file": name, "texels": touched}
            )
            if touched == 0:
                sys.exit(f"{model}: paint band matched no texels — check config.json")
        print(f"  {model:<18} {len(BODY_COLORS)} colours, {manifest[-1]['texels']} texels each")

    with open(os.path.join(args.out, "atlases.json"), "w") as fh:
        json.dump(manifest, fh, indent=2)
    print(f"wrote {len(manifest)} atlases to {args.out}")


if __name__ == "__main__":
    main()
