#!/usr/bin/env python3
"""
Render the car sprites. Run inside Blender, headless:

    blender -b -P render.py -- --out build/sprites

Emits one PNG per archetype per body colour, plus a manifest the registry is
generated from. Everything about the camera is fixed and shared, so the frames
compose: a van really is bigger than a hatch because it is bigger in the scene,
not because it was scaled afterwards.

Design notes worth keeping:

- ORTHOGRAPHIC, STRAIGHT DOWN. The lot is a top-down plan view, and a
  perspective camera would give every car a slightly different vanishing point
  depending on where it parked. Orthographic means one render serves every stall.

- ONE ORTHO BOX FOR EVERY ARCHETYPE, matching the CAR_BOX artboard in
  layout.ts. Each car sits at its true relative size inside a shared frame, so
  the game positions sprites exactly where it positioned vector drawings.

- CYCLES ON CPU. Eevee wants a GL context that a headless container does not
  reliably have. This is slower and it does not matter: it is a build step that
  runs when the models change, which is approximately never.

- STANDARD VIEW TRANSFORM. Blender defaults to a filmic curve that desaturates
  flat colours, which would quietly undo the repaint work in recolor.py.

- SHADOW BAKED IN, via a shadow-catcher plane and a transparent film. The lot is
  flat tarmac, so a contact shadow in the sprite is correct and saves the scene
  compositing one per car.
"""
from __future__ import annotations

import json
import math
import os
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(bpy.data.filepath or __file__))
if "--" in sys.argv:
    HERE = os.path.dirname(os.path.abspath(__file__))


def argv_after_ddash() -> list[str]:
    return sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []


def parse_args() -> dict:
    args = {"out": os.path.join(HERE, "build", "sprites"), "only": None}
    rest = argv_after_ddash()
    for i, a in enumerate(rest):
        if a == "--out" and i + 1 < len(rest):
            args["out"] = rest[i + 1]
        if a == "--only" and i + 1 < len(rest):
            args["only"] = rest[i + 1]
    return args


def clear_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def setup_world(samples: int, size_w: int, size_h: int) -> None:
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = False
    scene.render.resolution_x = size_w
    scene.render.resolution_y = size_h
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.view_transform = "Standard"

    world = bpy.data.worlds.new("W")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    # A cool ambient so shadowed flanks stay readable against dark tarmac
    # instead of going to black.
    bg.inputs[0].default_value = (0.30, 0.34, 0.42, 1.0)
    bg.inputs[1].default_value = 0.45


def add_lights() -> None:
    sun = bpy.data.lights.new("Sun", type="SUN")
    sun.energy = 2.0
    # Wide angle for a soft edge. A hard-edged shadow reads as a second object
    # on the tarmac once there are sixty of them on screen.
    sun.angle = math.radians(14)
    obj = bpy.data.objects.new("Sun", sun)
    bpy.context.collection.objects.link(obj)
    # Steep and thrown down-right. Steep because the shadow offset is
    # tan(tilt) x roof height, and anything past ~25 degrees puts a car's
    # shadow under its neighbour in the next row. Down-right because that is
    # where the vector renderer already puts its contact shadow, and a lot with
    # both on it has to agree about where the sun is.
    obj.rotation_euler = (math.radians(22), 0.0, math.radians(218))

    fill = bpy.data.lights.new("Fill", type="AREA")
    fill.energy = 40
    fill.size = 12
    fobj = bpy.data.objects.new("Fill", fill)
    bpy.context.collection.objects.link(fobj)
    fobj.location = (-4, -4, 7)
    fobj.rotation_euler = (math.radians(28), math.radians(-18), 0)


def add_camera(ortho_scale: float) -> bpy.types.Object:
    cam = bpy.data.cameras.new("Cam")
    cam.type = "ORTHO"
    cam.ortho_scale = ortho_scale
    obj = bpy.data.objects.new("Cam", cam)
    bpy.context.collection.objects.link(obj)
    # Straight down. Camera local +Y becomes image up, so a car whose nose
    # points world +Y renders nose-up.
    obj.location = (0, 0, 12)
    obj.rotation_euler = (0, 0, 0)
    bpy.context.scene.camera = obj
    return obj


def add_shadow_catcher() -> None:
    bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, 0))
    plane = bpy.context.active_object
    plane.is_shadow_catcher = True


def import_model(path: str) -> list[bpy.types.Object]:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before]


def mesh_objects(objs: list[bpy.types.Object]) -> list[bpy.types.Object]:
    return [o for o in objs if o.type == "MESH"]


def world_bounds(objs: list[bpy.types.Object]) -> tuple[Vector, Vector]:
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for o in mesh_objects(objs):
        for corner in o.bound_box:
            p = o.matrix_world @ Vector(corner)
            lo = Vector((min(lo[i], p[i]) for i in range(3)))
            hi = Vector((max(hi[i], p[i]) for i in range(3)))
    return lo, hi


def point_texture_at(path: str) -> None:
    """
    Swap every image datablock to the repainted atlas.

    The GLB embeds the texture, so Blender imports it *packed* — and a packed
    image reloads from its packed bytes and silently ignores a new filepath.
    Unpacking first is what makes the repaint reach the render; without it every
    colour variant renders identically and only Cycles' sampling noise differs,
    which is just similar enough to look like it worked.
    """
    for img in bpy.data.images:
        if img.type != "IMAGE" or not img.name.lower().startswith("colormap"):
            continue
        if img.packed_file:
            img.unpack(method="REMOVE")
        img.filepath = path
        img.source = "FILE"
        img.reload()
    # The atlas is a palette of flat swatches: linear filtering bleeds one
    # swatch into its neighbour along every UV seam.
    for mat in bpy.data.materials:
        if not mat.use_nodes:
            continue
        for node in mat.node_tree.nodes:
            if node.type == "TEX_IMAGE":
                node.interpolation = "Closest"


def main() -> None:
    args = parse_args()
    with open(os.path.join(HERE, "config.json")) as fh:
        config = json.load(fh)

    rcfg = config["render"]
    width = int(rcfg["size"])
    # Match the CAR_BOX artboard in src/ui/lot/layout.ts (60 x 124) so sprites
    # land exactly where the vector drawings did.
    height = int(round(width * (124 / 60)))
    atlas_dir = os.path.join(HERE, "build", "atlases")
    os.makedirs(args["out"], exist_ok=True)

    with open(os.path.join(atlas_dir, "atlases.json")) as fh:
        atlases = json.load(fh)
    by_model: dict[str, list[dict]] = {}
    for entry in atlases:
        by_model.setdefault(entry["model"], []).append(entry)

    wanted = config["archetypes"]
    if args["only"]:
        wanted = {k: v for k, v in wanted.items() if k == args["only"]}

    # One shared ortho box: measure every model first, then never change it.
    longest = 0.0
    for spec in config["archetypes"].values():
        clear_scene()
        objs = import_model(os.path.join(HERE, "models", spec["model"] + ".glb"))
        lo, hi = world_bounds(objs)
        longest = max(longest, max(hi.x - lo.x, hi.y - lo.y) * spec["scale"])
    ortho = longest * float(rcfg["marginFactor"])
    print(f"[render] longest car {longest:.3f} -> ortho_scale {ortho:.3f}")

    manifest = []
    for archetype, spec in wanted.items():
        model = spec["model"]
        for entry in sorted(by_model[model], key=lambda e: e["index"]):
            clear_scene()
            setup_world(int(rcfg["samples"]), width, height)
            add_lights()
            add_camera(ortho)
            add_shadow_catcher()

            objs = import_model(os.path.join(HERE, "models", model + ".glb"))
            point_texture_at(os.path.join(atlas_dir, entry["file"]))

            lo, hi = world_bounds(objs)
            centre = (lo + hi) / 2
            for o in objs:
                if o.parent is None:
                    o.location -= Vector((centre.x, centre.y, lo.z))
                    o.scale *= spec["scale"]

            out = os.path.join(args["out"], f"{archetype}_{entry['index']:02d}.png")
            bpy.context.scene.render.filepath = out
            bpy.ops.render.render(write_still=True)
            manifest.append(
                {
                    "archetype": archetype,
                    "index": entry["index"],
                    "color": entry["color"],
                    "file": os.path.basename(out),
                    "width": width,
                    "height": height,
                }
            )
            print(f"[render] {archetype} #{entry['index']} -> {os.path.basename(out)}")

    # Merge rather than replace. A partial re-render (`--only`) that overwrote
    # the manifest would leave the frames on disk but drop every other archetype
    # from the generated sprite table, which looks like the art regressing
    # rather than like the tool losing a file.
    manifest_path = os.path.join(args["out"], "sprites.json")
    merged: dict[tuple[str, int], dict] = {}
    if os.path.exists(manifest_path):
        with open(manifest_path) as fh:
            for frame in json.load(fh).get("frames", []):
                merged[(frame["archetype"], frame["index"])] = frame
    for frame in manifest:
        merged[(frame["archetype"], frame["index"])] = frame

    # Anything no longer in config.json is stale — a remapped archetype must not
    # keep shipping the model it used to point at.
    live = set(config["archetypes"])
    frames = [f for f in merged.values() if f["archetype"] in live]
    frames.sort(key=lambda f: (f["archetype"], f["index"]))

    with open(manifest_path, "w") as fh:
        json.dump({"frames": frames, "width": width, "height": height}, fh, indent=2)
    print(f"[render] rendered {len(manifest)} frames; manifest now lists {len(frames)}")


if __name__ == "__main__":
    main()
