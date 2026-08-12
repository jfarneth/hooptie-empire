/**
 * The three.js half of the renderer. Runs in the page; the node driver in
 * `render.js` calls `renderFrame` once per frame and takes the PNG back.
 *
 * Everything about the camera and the lights is shared and fixed, so the frames
 * compose: a van really is bigger than a hatch because it is bigger in the
 * scene, not because it was scaled afterwards. `measureAll` runs first and
 * establishes one orthographic box for the whole set; nothing may change it
 * afterwards.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { repaint } from './paint.js';

const RAD = Math.PI / 180;

const loader = new GLTFLoader();
const modelCache = new Map();
const atlasCache = new Map();
let baseAtlas = null;

/** The kit's shared palette atlas, loaded once. */
async function loadBaseAtlas(url) {
  if (baseAtlas) return baseAtlas;
  const img = await loadImage(url);
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  c.getContext('2d').drawImage(img, 0, 0);
  baseAtlas = c;
  return c;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${url}`));
    img.src = url;
  });
}

async function loadModel(name) {
  if (modelCache.has(name)) return modelCache.get(name);
  const gltf = await loader.loadAsync(`/models/${name}.glb`);
  modelCache.set(name, gltf.scene);
  return gltf.scene;
}

/**
 * A repainted atlas as a texture.
 *
 * NEAREST FILTERING IS NOT OPTIONAL. The atlas is a palette of flat swatches
 * packed edge to edge, so linear filtering bleeds one swatch into its
 * neighbour along every UV seam — which on a car reads as a dirty rim around
 * every panel. Blender's side of this sets interpolation to 'Closest' for the
 * same reason.
 */
async function paintedTexture(model, band, colorHex, atlasUrl) {
  const key = `${model}|${colorHex}`;
  if (atlasCache.has(key)) return atlasCache.get(key);

  const base = await loadBaseAtlas(atlasUrl);
  const { canvas, touched } = repaint(base, band, colorHex);
  if (touched === 0) {
    throw new Error(`${model}: paint band matched no texels — check config.json`);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.flipY = false; // glTF UVs
  atlasCache.set(key, tex);
  return tex;
}

/** Bounding box of a loaded model in its own space. */
function boundsOf(object) {
  const box = new THREE.Box3().setFromObject(object);
  return box;
}

/**
 * Size ONE orthographic box for the whole set, under a given view.
 *
 * Every model is measured through the same camera and the box is fitted to the
 * largest, so a van really is bigger than a hatch because it is bigger in the
 * scene rather than because it was scaled afterwards. Fitting per frame instead
 * would let a hatch fill the same artboard as a van and destroy the one
 * property that makes these frames compose on a lot.
 *
 * `view.aspect` pins the artboard's shape when something downstream depends on
 * it — the top-down frames must keep the CAR_BOX proportions from layout.ts so
 * the lot goes on positioning them exactly as it did. Without it the box is
 * fitted to the geometry, which is what a hero shot wants: the framing follows
 * whatever the angle actually needs.
 */
export async function measureAll(config, view) {
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
  placeCamera(camera, view.tiltDegrees, view.yawDegrees, 50);
  camera.updateMatrixWorld();
  const toCamera = camera.matrixWorldInverse;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const spec of Object.values(config.archetypes)) {
    const source = await loadModel(spec.model);
    const model = source.clone(true);
    seat(model, spec.scale);
    model.updateMatrixWorld(true);

    // EVERY VERTEX, not the eight corners of the bounding box. A car's box is
    // mostly empty at its corners, and at a three-quarter angle those empty
    // corners are exactly what project furthest — measuring them framed the
    // shipped hero shot with the car filling 39% of its own artboard and the
    // rest air.
    model.traverse((node) => {
      if (!node.isMesh) return;
      const pos = node.geometry.getAttribute('position');
      const v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i += 1) {
        v.fromBufferAttribute(pos, i).applyMatrix4(node.matrixWorld).applyMatrix4(toCamera);
        minX = Math.min(minX, v.x);
        maxX = Math.max(maxX, v.x);
        minY = Math.min(minY, v.y);
        maxY = Math.max(maxY, v.y);
      }
    });
  }

  const margin = view.marginFactor ?? 1.06;
  let frustum = { left: minX, right: maxX, bottom: minY, top: maxY };

  // The lot positions a top-down frame by its centre and assumes that centre is
  // the car's footprint, so that artboard has to stay symmetric about the
  // anchor. A hero shot is placed by nothing and can be packed.
  if (view.anchorCentred) {
    const halfW = Math.max(Math.abs(minX), Math.abs(maxX));
    const halfH = Math.max(Math.abs(minY), Math.abs(maxY));
    frustum = { left: -halfW, right: halfW, bottom: -halfH, top: halfH };
  }

  frustum = pad(frustum, margin);
  if (view.aspect) {
    const [aw, ah] = view.aspect;
    frustum = toAspect(frustum, aw / ah);
  }
  return frustum;
}

/**
 * Where each archetype's own axes point on the finished artboard.
 *
 * A footprint is a bounding box, and a bounding box is enough to place trim on
 * a plan view because a plan view has barely any projection to speak of: the
 * car's length runs down the frame and its width runs across it. On a
 * three-quarter shot neither is true — the length runs diagonally, "up" is a
 * different diagonal, and a spoiler positioned by fractions of a bounding box
 * lands in the air beside the boot.
 *
 * So the renderer hands the overlay the same thing the lot camera hands the
 * ground plate: the projection itself. `anchor` is where the car's footprint
 * centre sits on the artboard, and the three vectors are the artboard
 * displacement from there to the nose, to the near flank, and to roof height.
 * Anything that has to sit ON the car is then placed in the car's own space and
 * projected, rather than guessed at in the frame's.
 *
 * All in artboard fractions, so one set of numbers works at 96px in the feed
 * and at 220px on the sheet.
 */
export async function measureAxes(config, view, box) {
  const camera = new THREE.OrthographicCamera(box.left, box.right, box.top, box.bottom, 0.01, 200);
  placeCamera(camera, view.tiltDegrees, view.yawDegrees, 100);
  camera.updateMatrixWorld();
  const toCamera = camera.matrixWorldInverse;

  const w = box.right - box.left;
  const h = box.top - box.bottom;
  const toArtboard = (v) => {
    const p = v.clone().applyMatrix4(toCamera);
    return { x: round((p.x - box.left) / w), y: round((box.top - p.y) / h) };
  };
  const minus = (a, b) => ({ x: round(a.x - b.x), y: round(a.y - b.y) });

  const out = {};
  for (const [archetype, spec] of Object.entries(config.archetypes)) {
    const source = await loadModel(spec.model);
    const model = source.clone(true);
    seat(model, spec.scale);
    if (view.faceLeft) {
      model.rotation.y += Math.PI;
      model.updateMatrixWorld(true);
    }
    const b = boundsOf(model);
    // Points along the car's own length toward the NOSE, whichever way the
    // frame turned it, so the overlay never has to know which end it is on.
    const nose = view.faceLeft ? b.min.z : b.max.z;

    const anchor = toArtboard(new THREE.Vector3(0, 0, 0));
    out[archetype] = {
      anchor,
      length: minus(toArtboard(new THREE.Vector3(0, 0, nose)), anchor),
      width: minus(toArtboard(new THREE.Vector3(b.max.x, 0, 0)), anchor),
      up: minus(toArtboard(new THREE.Vector3(0, b.max.y, 0)), anchor),
    };
  }
  return out;
}

const round = (n) => Number(n.toFixed(4));

function pad(f, margin) {
  const w = (f.right - f.left) * (margin - 1) * 0.5;
  const h = (f.top - f.bottom) * (margin - 1) * 0.5;
  return { left: f.left - w, right: f.right + w, bottom: f.bottom - h, top: f.top + h };
}

/** Grow the shorter axis until the box has the wanted shape. Never crops. */
function toAspect(f, ratio) {
  const w = f.right - f.left;
  const h = f.top - f.bottom;
  const cx = (f.left + f.right) / 2;
  const cy = (f.bottom + f.top) / 2;
  const [outW, outH] = w / h > ratio ? [w, w / ratio] : [h * ratio, h];
  return { left: cx - outW / 2, right: cx + outW / 2, bottom: cy - outH / 2, top: cy + outH / 2 };
}

/**
 * Footprint centred on the origin, wheels on the ground, length along Z.
 *
 * Shared by the measure pass and the render so the two cannot disagree about
 * where the car is standing — a box fitted around one seating and a car
 * rendered in another is a crop, and it looks like the model is wrong.
 */
function seat(object, scale) {
  const raw = boundsOf(object).getSize(new THREE.Vector3());
  if (raw.x > raw.z) object.rotation.y = Math.PI / 2;
  object.scale.multiplyScalar(scale);
  object.updateMatrixWorld(true);
  const box = boundsOf(object);
  const centre = box.getCenter(new THREE.Vector3());
  object.position.set(-centre.x, -box.min.y, -centre.z);
  object.updateMatrixWorld(true);
}

/**
 * Lights, matched to the Blender pipeline's so the two renderers agree.
 *
 * The sun is steep and thrown down-right: steep because a car's shadow offset
 * is tan(angle) x roof height and anything shallower puts a car's shadow under
 * its neighbour in the next row, down-right because that is where the vector
 * renderer already puts its contact shadow and a lot with both on it has to
 * agree about where the sun is.
 */
function addLights(scene, spread) {
  // Cool ambient, so shadowed flanks stay readable against dark tarmac instead
  // of going to black.
  scene.add(new THREE.AmbientLight(0x4d5769, 1.5));

  const sun = new THREE.DirectionalLight(0xfff4e2, 2.5);
  sun.position.set(-spread * 0.8, spread * 1.6, -spread * 0.7);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const c = sun.shadow.camera;
  c.left = -spread;
  c.right = spread;
  c.top = spread;
  c.bottom = -spread;
  c.near = 0.1;
  c.far = spread * 6;
  // A hard-edged shadow reads as a second object on the tarmac once there are
  // sixty of them on screen, so it is deliberately soft.
  sun.shadow.radius = 4;
  sun.shadow.bias = -0.0016;
  scene.add(sun);

  const fill = new THREE.DirectionalLight(0xc9d8ff, 0.85);
  fill.position.set(spread, spread * 0.9, spread);
  scene.add(fill);
}

/**
 * Position an orthographic camera by tilt off vertical and yaw about vertical.
 *
 * `tiltDegrees` is measured off straight-down, matching the Blender script and
 * `SPRITE_TILT_DEGREES` in camera.ts: 0 is a floor plan, 90 is a side
 * elevation. Yaw swings the camera to the right, the same direction the lot
 * camera's yaw goes.
 *
 * Aimed at the origin, which is the car's footprint centre — so the sprite's
 * anchor does not move when the angle does.
 */
function placeCamera(camera, tiltDegrees, yawDegrees, distance) {
  const t = tiltDegrees * RAD;
  const y = yawDegrees * RAD;
  camera.position.set(
    distance * Math.sin(t) * Math.sin(y),
    distance * Math.cos(t),
    distance * Math.sin(t) * Math.cos(y),
  );
  // Near straight-down there is no horizon to keep level and `up` would be
  // nearly parallel to the view, so it names the axis the car's length should
  // run along on screen instead. A hero shot has a horizon and wants the sky.
  camera.up.set(0, 0, -1);
  if (tiltDegrees >= 45) camera.up.set(0, 1, 0);
  camera.lookAt(0, 0, 0);
}

let renderer = null;

function getRenderer(width, height) {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Blender's side uses the Standard view transform rather than the filmic
    // default, which desaturates flat colours and would quietly undo the
    // repaint. This is the same decision.
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    document.body.appendChild(renderer.domElement);
  }
  renderer.setSize(width, height, false);
  return renderer;
}

/**
 * Render one frame and hand back a PNG data URL.
 *
 * `frame` carries the archetype's model and scale, the paint band, the target
 * colour, and the angle. `box` is the shared ortho box from `measureAll`.
 */
export async function renderFrame(frame, view, box, atlasUrl) {
  const { width, height } = view;
  const scene = new THREE.Scene();
  const spread = Math.max(box.right - box.left, box.top - box.bottom) * 1.4;
  addLights(scene, spread);

  const camera = new THREE.OrthographicCamera(
    box.left,
    box.right,
    box.top,
    box.bottom,
    0.01,
    spread * 8,
  );
  placeCamera(camera, view.tiltDegrees, view.yawDegrees, spread * 2);

  const source = await loadModel(frame.model);
  const car = source.clone(true);
  seat(car, frame.scale);
  // Turned end for end AFTER seating, so the car spins about its own footprint
  // centre and the two directions frame identically.
  if (view.faceLeft) {
    car.rotation.y += Math.PI;
    car.updateMatrixWorld(true);
  }

  const texture = await paintedTexture(frame.model, frame.band, frame.color, atlasUrl);
  car.traverse((node) => {
    if (!node.isMesh) return;
    node.castShadow = true;
    // Clone rather than mutate: models are cached and shared between frames, so
    // assigning a texture in place would repaint every colour rendered after it.
    node.material = node.material.clone();
    node.material.map = texture;
    // The kit is flat-shaded painted plastic. Left at the glTF's metalness with
    // no environment map, every panel renders near-black.
    node.material.metalness = 0;
    node.material.roughness = 0.62;
    node.material.needsUpdate = true;
  });
  scene.add(car);

  // Shadow catcher: transparent except where the car darkens it, so the frame
  // ships a real contact shadow and the lot does not have to composite one per
  // car.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(spread * 4, spread * 4),
    new THREE.ShadowMaterial({ opacity: 0.34 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const r = getRenderer(width, height);
  r.render(scene, camera);
  return r.domElement.toDataURL('image/png');
}

/**
 * Downscale a rendered frame to ship size.
 *
 * Rendered larger because downscaling is free and re-rendering is not, and
 * because the supersample is what keeps a low-poly car's long diagonal edges
 * from crawling at 34px on a small lot.
 */
export async function shrink(dataUrl, shipWidth) {
  const img = await loadImage(dataUrl);
  const c = document.createElement('canvas');
  c.width = shipWidth;
  c.height = Math.round((shipWidth * img.naturalHeight) / img.naturalWidth);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return { url: c.toDataURL('image/png'), width: c.width, height: c.height };
}

/**
 * Where the car actually sits inside the frame, as fractions of the artboard.
 *
 * Measured here rather than by a second tool reading the committed PNGs,
 * because the renderer already knows and a measurement taken at render time
 * cannot go stale against the frame it describes. Same output shape as
 * `tools/measure-sprites`, which still exists for frames this tool did not
 * produce.
 *
 * The three widths are measured across the car at a fraction of its own
 * length, because the bounding box is generous — it catches wing mirrors and,
 * at any real tilt, the flanks — and anything that sits ON the car has to know
 * the row it will land on.
 */
export async function measureFrame(dataUrl) {
  const img = await loadImage(dataUrl);
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, c.width, c.height);

  // IDENTICAL to the rule in tools/measure-sprites/measure.js, deliberately.
  // That tool still exists for frames this one did not produce, and two
  // footprint tables measured by two different rules would disagree by a few
  // percent on every archetype — which reads as trim drifting rather than as
  // two tools that never agreed.
  //
  // Alpha alone is useless here: the soft drop shadow is opaque too. The
  // shadow is near-black, so luminance is what separates it from bodywork.
  const isCar = (i) =>
    data[i + 3] > 250 && 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] > 70;

  let x0 = c.width;
  let x1 = -1;
  let y0 = c.height;
  let y1 = -1;
  const rows = [];
  for (let y = 0; y < c.height; y += 1) {
    let lo = -1;
    let hi = -1;
    for (let x = 0; x < c.width; x += 1) {
      if (!isCar((y * c.width + x) * 4)) continue;
      if (lo < 0) lo = x;
      hi = x;
    }
    rows.push(lo < 0 ? null : { lo, hi });
    if (lo < 0) continue;
    x0 = Math.min(x0, lo);
    x1 = Math.max(x1, hi);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  if (x1 < 0) throw new Error('measureFrame found no car');

  const widthAt = (fraction) => {
    const y = Math.round(y0 + (y1 - y0) * fraction);
    const row = rows[Math.max(0, Math.min(rows.length - 1, y))];
    return row ? (row.hi - row.lo + 1) / c.width : 0;
  };

  const r3 = (n) => Number(n.toFixed(3));
  return {
    x: r3(x0 / c.width),
    X: r3((x1 + 1) / c.width),
    y: r3(y0 / c.height),
    Y: r3((y1 + 1) / c.height),
    hoodW: r3(widthAt(0.28)),
    midW: r3(widthAt(0.55)),
    tailW: r3(widthAt(0.85)),
  };
}
