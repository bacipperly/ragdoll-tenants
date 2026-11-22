/*
 * An imported body model (e.g. one made with TripoAI) in place of the generated skin.
 *
 * The generated skin (blendskin.ts) is built from the proportions; an imported model is
 * a fixed sculpted mesh. To drive it with the same physics skeleton it's fitted in four
 * steps, each automatic but overridable from a settings file next to the model:
 *
 *   1. Landmarks. Horizontal slices through the mesh find its feet, crotch (where the
 *      legs join), shoulders (the top of the arms), neck (the narrowest point under the
 *      head) and top.
 *   2. Fit. Heights are remapped piecewise so those landmarks land on this tenant's
 *      (hips, shoulders, head), and it's scaled to its height. So one model fits every
 *      tenant's proportions, though age and weight can only stretch it, not reshape it.
 *   3. Limbs. The model's arms and legs are probably held out at an angle; that angle is
 *      measured, the limbs weighted against capsules swung out to match, and then the
 *      limbs swung back to hang straight, which is our skeleton's rest pose.
 *   4. Skin data. Bone weights from distance to the capsules, plus the per-vertex data
 *      the painted clothes read (which body region, how far along a limb, angles round).
 *
 * The head is the goo head by default (the face, hair and hats ride it), so the model's
 * own head is cut off at the neck. `head: 'model'` keeps it instead.
 *
 * The model's textures and colours are ignored: the tenant's material colours it.
 */
import * as THREE from 'three';
import type { BodyDims } from './proportions';

export interface Landmarks { feet: number; crotch: number; shoulder: number; neck: number; top: number }

export interface BodyModelSettings {
  /** Turn it (degrees about up) so it faces +z. */
  yaw?: number;
  /** 'goo': cut the model's head off and use the goo head (default). 'model': keep it. */
  head?: 'goo' | 'model';
  /** Override any detected landmark (in the model's own units, after yaw). */
  landmarks?: Partial<Landmarks>;
  /** Override the detected limb angles (degrees out from hanging straight down). */
  armAngle?: number;
  legAngle?: number;
}

export interface BodyModel {
  name: string;
  /** Positions and normals as loaded (after yaw), and triangles. */
  positions: Float32Array;
  normals: Float32Array;
  index: Uint32Array;
  landmarks: Landmarks;
  /** How the landmarks were found, per landmark: 'detected', 'set' or 'guessed'. */
  found: Record<keyof Landmarks, 'detected' | 'set' | 'guessed'>;
  armAngle: number;
  legAngle: number;
  head: 'goo' | 'model';
}

/** One physics capsule in the rest pose (vertical), and its bone. */
export interface Capsule { name: string; bone: number; cx: number; cy: number; cz: number; half: number; r: number }

let current: BodyModel | null = null;
/** The body model new tenants are built from (null: the generated skin). */
export function setBodyModel(m: BodyModel | null): void { current = m; }
export function bodyModel(): BodyModel | null { return current; }

// ---------------------------------------------------------------- reading the shape

/** A slice through the mesh at height y: its x extent and how many separate pieces cross it. */
export interface Slice { y: number; minX: number; maxX: number; pieces: [number, number][] /* each piece's x interval */ }

/**
 * Cross-sections of the mesh at n heights: where each triangle crosses the plane gives
 * an x interval; overlapping intervals merge into pieces (a body, two legs, fins…).
 */
export function slices(positions: Float32Array, index: Uint32Array, n = 48): Slice[] {
  let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    minY = Math.min(minY, positions[i + 1]); maxY = Math.max(maxY, positions[i + 1]);
    minX = Math.min(minX, positions[i]); maxX = Math.max(maxX, positions[i]);
  }
  const band = (maxY - minY) / n, gap = (maxX - minX) * 0.01;
  const spans: [number, number][][] = Array.from({ length: n }, () => []);
  const xs = [0, 0, 0], ys = [0, 0, 0];
  for (let t = 0; t < index.length; t += 3) {
    for (let k = 0; k < 3; k++) { xs[k] = positions[index[t + k] * 3]; ys[k] = positions[index[t + k] * 3 + 1]; }
    const lo = Math.min(ys[0], ys[1], ys[2]), hi = Math.max(ys[0], ys[1], ys[2]);
    for (let s = Math.max(0, Math.ceil((lo - minY) / band - 0.5)); s < n; s++) {
      const y = minY + (s + 0.5) * band;
      if (y > hi) break;
      let a = Infinity, b = -Infinity;
      for (let k = 0; k < 3; k++) {
        const k2 = (k + 1) % 3, y0 = ys[k], y1 = ys[k2];
        if ((y0 - y) * (y1 - y) > 0 || y0 === y1) continue;
        const x = xs[k] + ((y - y0) / (y1 - y0)) * (xs[k2] - xs[k]);
        a = Math.min(a, x); b = Math.max(b, x);
      }
      if (a <= b) spans[s].push([a, b]);
    }
  }
  return spans.map((list, s) => {
    list.sort((p, q) => p[0] - q[0]);
    const pieces: [number, number][] = [];
    let a = Infinity, b = -Infinity, lo = Infinity, hi = -Infinity;
    for (const [x0, x1] of list) {
      if (x0 > b + gap && b > -Infinity) { pieces.push([a, b]); a = x0; b = x1; } else { a = Math.min(a, x0); b = Math.max(b, x1); }
      lo = Math.min(lo, x0); hi = Math.max(hi, x1);
    }
    if (b > -Infinity) pieces.push([a, b]);
    return { y: minY + (s + 0.5) * band, minX: lo === Infinity ? 0 : lo, maxX: hi === -Infinity ? 0 : hi, pieces };
  });
}

const onCentre = (p: [number, number], tol: number) => p[0] <= tol && p[1] >= -tol;

/**
 * Finds the landmarks (see the top of the file); anything it can't find is guessed
 * from the drawn character's proportions.
 *   crotch:   going up from the feet, the first height where the body crosses the
 *             centre line (legs never do);
 *   neck:     the narrowest height between the body and the head;
 *   shoulder: just under the neck (the character has no neck to speak of; the fins
 *             hang from the top of the body).
 */
export function findLandmarks(positions: Float32Array, index: Uint32Array, set: Partial<Landmarks> = {}): { landmarks: Landmarks; found: BodyModel['found'] } {
  const S = slices(positions, index);
  const half = (S[1].y - S[0].y) / 2;
  const feet = S[0].y - half, top = S[S.length - 1].y + half, H = top - feet;
  const tol = 0.01 * H;
  const det: Partial<Landmarks> = {};
  for (let k = 1; k < S.length * 0.6; k++) {
    if (!S[k - 1].pieces.some((p) => onCentre(p, tol)) && S[k].pieces.some((p) => onCentre(p, tol))) { det.crotch = S[k].y - half; break; }
  }
  const from = (det.crotch ?? feet + 0.15 * H) + 0.15 * H;
  let narrow = Infinity;
  for (const s of S) {
    if (s.y <= from || s.y >= top - 0.2 * H) continue;
    const centre = s.pieces.find((p) => onCentre(p, tol));
    const w = centre ? centre[1] - centre[0] : Infinity; // the body's own width (not the fins)
    if (w < narrow) { narrow = w; det.neck = s.y; }
  }
  if (det.neck !== undefined) det.shoulder = det.neck - 0.12 * (det.neck - (det.crotch ?? feet + 0.12 * H));
  // Guesses, as shares of the height, from the drawn character (head ~55%).
  const guess: Landmarks = { feet, crotch: feet + 0.12 * H, shoulder: feet + 0.38 * H, neck: feet + 0.45 * H, top };
  const landmarks = { ...guess } as Landmarks;
  const found = {} as BodyModel['found'];
  for (const k of Object.keys(guess) as (keyof Landmarks)[]) {
    if (set[k] !== undefined) { landmarks[k] = set[k]!; found[k] = 'set'; }
    else if (k === 'feet' || k === 'top' || det[k] !== undefined) { landmarks[k] = k === 'feet' ? feet : k === 'top' ? top : det[k]!; found[k] = 'detected'; }
    else found[k] = 'guessed';
  }
  return { landmarks, found };
}

/**
 * How far a pair of limbs is held out from hanging straight down (radians): fitted to
 * how the pieces off the centre line (fins, or legs) drift outward as they go down.
 */
function limbAngle(S: Slice[], y0: number, y1: number, tol: number): number {
  let n = 0, sy = 0, sx = 0, syy = 0, sxy = 0;
  for (const s of S) {
    if (s.y < y0 || s.y > y1) continue;
    for (const p of s.pieces) {
      if (onCentre(p, tol)) continue;
      const x = Math.abs((p[0] + p[1]) / 2);
      n++; sy += s.y; sx += x; syy += s.y * s.y; sxy += s.y * x;
    }
  }
  if (n < 3) return 0;
  const slope = (n * sxy - sx * sy) / Math.max(1e-9, n * syy - sy * sy); // d|x|/dy (negative: out as it goes down)
  return Math.max(0, Math.atan(-slope));
}

/**
 * The fins' angle out from hanging straight down (radians): from the shoulder (just
 * inside the body's edge at shoulder height) to the fin tip, which is the lowest
 * height with a piece more than the body and legs account for (one body above the
 * crotch, two legs below it): its outermost piece.
 */
function finAngle(S: Slice[], L: Landmarks, tol: number): number {
  let tip: [number, number] | null = null;
  for (const s of S) {
    if (s.y > L.shoulder) break;
    const expected = s.y < L.crotch ? 2 : 1;
    if (s.pieces.length > expected) {
      const p = s.pieces.reduce((a, b) => (Math.abs(a[0] + a[1]) > Math.abs(b[0] + b[1]) ? a : b));
      tip = [Math.abs((p[0] + p[1]) / 2), s.y];
      break;
    }
  }
  if (!tip) return 0;
  const at = S.reduce((a, b) => (Math.abs(b.y - L.shoulder) < Math.abs(a.y - L.shoulder) ? b : a));
  const body = at.pieces.find((p) => onCentre(p, tol)) ?? [at.minX, at.maxX];
  const px = 0.7 * (body[1] - body[0]) / 2;
  return Math.max(0, Math.atan2(tip[0] - px, L.shoulder - tip[1]));
}

/** Prepares a loaded mesh: turned to face +z, centred over its feet, its landmarks and limb angles found. */
export function prepareBodyModel(name: string, positions: Float32Array, normals: Float32Array, index: Uint32Array, settings: BodyModelSettings = {}): BodyModel {
  const pos = new Float32Array(positions), nrm = new Float32Array(normals);
  const yaw = THREE.MathUtils.degToRad(settings.yaw ?? 0), c = Math.cos(yaw), s = Math.sin(yaw);
  let cx = 0, cz = 0;
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], z = pos[i + 2];
    pos[i] = c * x + s * z; pos[i + 2] = -s * x + c * z;
    const nx = nrm[i], nz = nrm[i + 2];
    nrm[i] = c * nx + s * nz; nrm[i + 2] = -s * nx + c * nz;
    cx += pos[i]; cz += pos[i + 2];
  }
  cx /= pos.length / 3; cz /= pos.length / 3;
  for (let i = 0; i < pos.length; i += 3) { pos[i] -= cx; pos[i + 2] -= cz; }
  const { landmarks, found } = findLandmarks(pos, index, settings.landmarks);
  const S = slices(pos, index);
  const L = landmarks;
  const tol = 0.01 * (L.top - L.feet);
  const armAngle = settings.armAngle !== undefined ? THREE.MathUtils.degToRad(settings.armAngle)
    : finAngle(S, L, tol);
  const legAngle = settings.legAngle !== undefined ? THREE.MathUtils.degToRad(settings.legAngle)
    : limbAngle(S, L.feet + 0.1 * (L.crotch - L.feet), L.crotch - 0.1 * (L.crotch - L.feet), tol);
  return { name, positions: pos, normals: nrm, index, landmarks, found, armAngle, legAngle, head: settings.head ?? 'goo' };
}

// ---------------------------------------------------------------- fitting it to a tenant

const REGION: Record<string, number> = {
  torso: 0, chest: 0, head: 0, butt: 3, thighL: 1, thighR: 1, shinL: 1, shinR: 1,
  upperArmL: 2, upperArmR: 2, forearmL: 2, forearmR: 2,
};

/**
 * The imported model fitted to a tenant's skeleton: rest-pose positions and normals,
 * bone weights, and the painted clothes' data, as the generated skin has them.
 */
export function buildImportedSkin(m: BodyModel, D: BodyDims, caps: Capsule[]): THREE.BufferGeometry {
  const L = m.landmarks;
  // 1–2. Heights remapped landmark to landmark; across, scaled with the height.
  const ourCrotch = D.hipY - 0.15 * D.thighLen, ourNeck = D.headY - D.headR;
  const knots: [number, number][] = [[L.feet, 0], [L.crotch, ourCrotch], [L.shoulder, D.shoulderY], [L.neck, ourNeck], [L.top, D.height]];
  const mapY = (y: number) => {
    for (let k = 1; k < knots.length; k++) {
      const [a0, b0] = knots[k - 1], [a1, b1] = knots[k];
      if (y <= a1 || k === knots.length - 1) return b0 + ((y - a0) / Math.max(1e-6, a1 - a0)) * (b1 - b0);
    }
    return y;
  };
  const scale = D.height / Math.max(1e-6, L.top - L.feet);

  // Drop the model's head (the goo head takes its place) unless it's kept.
  const src = m.positions, srcN = m.normals;
  const keepTri: number[] = [];
  for (let t = 0; t < m.index.length; t += 3) {
    const a = m.index[t], b = m.index[t + 1], c = m.index[t + 2];
    if (m.head === 'goo' && (src[a * 3 + 1] + src[b * 3 + 1] + src[c * 3 + 1]) / 3 > L.neck) continue;
    keepTri.push(a, b, c);
  }
  // Compact to the vertices still used.
  const remap = new Int32Array(src.length / 3).fill(-1);
  let count = 0;
  for (const i of keepTri) if (remap[i] < 0) remap[i] = count++;
  const pos = new Float32Array(count * 3), nrm = new Float32Array(count * 3);
  for (let i = 0; i < remap.length; i++) {
    const j = remap[i];
    if (j < 0) continue;
    pos[j * 3] = src[i * 3] * scale; pos[j * 3 + 1] = mapY(src[i * 3 + 1]); pos[j * 3 + 2] = src[i * 3 + 2] * scale;
    nrm[j * 3] = srcN[i * 3]; nrm[j * 3 + 1] = srcN[i * 3 + 1]; nrm[j * 3 + 2] = srcN[i * 3 + 2];
  }
  const index = new Uint32Array(keepTri.length);
  for (let t = 0; t < keepTri.length; t++) index[t] = remap[keepTri[t]];

  // 3. Capsules swung out to the model's limb angles, for weighting.
  type Seg = { bone: number; region: number; side: number; ax: number; ay: number; bx: number; by: number; z: number; r: number; limb: Limb | null };
  type Limb = { px: number; py: number; angle: number; len: number; side: number };
  const limbs = new Map<string, Limb>();
  const segs: Seg[] = caps.map((c) => {
    const side = c.name.endsWith('L') ? 1 : c.name.endsWith('R') ? -1 : 0;
    const arm = c.name.startsWith('upperArm') || c.name.startsWith('forearm');
    const leg = c.name.startsWith('thigh') || c.name.startsWith('shin');
    let limb: Limb | null = null;
    if (arm || leg) {
      const key = `${arm ? 'arm' : 'leg'}${side}`;
      limb = limbs.get(key) ?? null;
      if (!limb) {
        const px = side * (arm ? D.shoulderX : D.hipX), py = arm ? D.shoulderY : D.hipY;
        limb = { px, py, angle: arm ? m.armAngle : m.legAngle, len: arm ? D.upperArmLen + D.forearmLen : D.thighLen + D.shinLen, side };
        limbs.set(key, limb);
      }
    }
    // Ends of the capsule's core, swung about the limb's root (outward is away from x = 0).
    const swing = (x: number, y: number): [number, number] => {
      if (!limb) return [x, y];
      const a = side * limb.angle, dx = x - limb.px, dy = y - limb.py;
      return [limb.px + dx * Math.cos(a) - dy * Math.sin(a), limb.py + dx * Math.sin(a) + dy * Math.cos(a)];
    };
    const [ax, ay] = swing(c.cx, c.cy - c.half), [bx, by] = swing(c.cx, c.cy + c.half);
    return { bone: c.bone, region: REGION[c.name] ?? 0, side, ax, ay, bx, by, z: c.cz, r: c.r, limb };
  });

  // 4. Weights and clothes data, then the limbs swung back to hang straight.
  const skinIndex = new Uint16Array(count * 4), skinWeight = new Float32Array(count * 4);
  const clothA = new Float32Array(count * 4), clothB = new Float32Array(count * 4);
  const d = new Float32Array(segs.length), w = new Float32Array(segs.length);
  const order: number[] = segs.map((_, i) => i);
  for (let v = 0; v < count; v++) {
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    let dMin = Infinity;
    for (let s = 0; s < segs.length; s++) {
      const g = segs[s];
      // A limb only takes vertices on its own side of the body.
      if (g.side && x * g.side < -0.25 * D.hipX) { d[s] = Infinity; continue; }
      const ex = g.bx - g.ax, ey = g.by - g.ay, l2 = ex * ex + ey * ey || 1;
      const u = Math.max(0, Math.min(1, ((x - g.ax) * ex + (y - g.ay) * ey) / l2));
      d[s] = Math.max(0, Math.hypot(x - g.ax - ex * u, y - g.ay - ey * u, z - g.z) - g.r);
      dMin = Math.min(dMin, d[s]);
    }
    const soft = 0.15 * D.bellyR; // how far a bone's pull reaches past the nearest one: small keeps limbs crisp
    let sum = 0;
    for (let s = 0; s < segs.length; s++) { w[s] = Number.isFinite(d[s]) ? Math.exp(-(d[s] - dMin) / soft) : 0; sum += w[s]; }
    order.sort((a, b) => w[b] - w[a]);
    let top = 0;
    for (let k = 0; k < 4; k++) top += w[order[k]];
    let limbW = 0, limbT = 0, limbAng = 0, swung = 0;
    let swingLimb: Limb | null = null;
    for (let k = 0; k < 4; k++) {
      const s = order[k], ww = top > 0 ? w[s] / top : k === 0 ? 1 : 0;
      skinIndex[v * 4 + k] = segs[s].bone;
      skinWeight[v * 4 + k] = ww;
    }
    for (let s = 0; s < segs.length; s++) {
      const ww = w[s] / (sum || 1), g = segs[s];
      clothA[v * 4 + g.region] += ww;
      if (g.limb) {
        limbW += ww;
        swung += ww;
        if (!swingLimb || ww > 0.5 * swung) swingLimb = g.limb;
      }
    }
    // Swing the limb back to hang straight (as the generated skin does for its fins):
    // skinning will place it at (still + swung·R)·rest, so divide that rotation back out.
    let rx = x, ry = y, nx = nrm[v * 3], ny = nrm[v * 3 + 1];
    if (swingLimb && swung > 0) {
      const a = swingLimb.side * swingLimb.angle;
      const ar = 1 - swung + swung * Math.cos(a), ai = swung * Math.sin(a), m2 = ar * ar + ai * ai;
      const dx = x - swingLimb.px, dy = y - swingLimb.py;
      rx = swingLimb.px + (dx * ar + dy * ai) / m2;
      ry = swingLimb.py + (dy * ar - dx * ai) / m2;
      const mm = Math.sqrt(m2);
      const nnx = (nx * ar + ny * ai) / mm, nny = (ny * ar - nx * ai) / mm;
      nx = nnx; ny = nny;
      limbT = THREE.MathUtils.clamp((swingLimb.py - ry) / swingLimb.len, 0, 1);
      limbAng = Math.atan2(rx - swingLimb.px, z);
    }
    pos[v * 3] = rx; pos[v * 3 + 1] = ry;
    const nl = Math.hypot(nx, ny, nrm[v * 3 + 2]) || 1;
    nrm[v * 3] = nx / nl; nrm[v * 3 + 1] = ny / nl; nrm[v * 3 + 2] /= nl;
    clothB[v * 4] = ry;
    clothB[v * 4 + 1] = limbW > 0 ? limbT : 0;
    clothB[v * 4 + 2] = Math.atan2(rx, z);
    clothB[v * 4 + 3] = limbAng;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
  geo.setAttribute('clothA', new THREE.BufferAttribute(clothA, 4));
  geo.setAttribute('clothB', new THREE.BufferAttribute(clothB, 4));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeBoundingSphere();
  return geo;
}

// ---------------------------------------------------------------- loading (in the browser)

/**
 * Loads a .glb (every mesh in it merged, as placed in the file) and, if there is one,
 * the settings file next to it (same name, .json).
 */
export async function loadBodyModel(url: string): Promise<BodyModel> {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const gltf = await new GLTFLoader().loadAsync(url);
  let settings: BodyModelSettings = {};
  try {
    const r = await fetch(url.replace(/\.glb$/i, '.json'));
    if (r.ok) settings = (await r.json()) as BodyModelSettings;
  } catch { /* no settings: all automatic */ }
  const pos: number[] = [], nrm: number[] = [], idx: number[] = [];
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    let g = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.index) g = g.toNonIndexed();
    const base = pos.length / 3;
    const p = g.attributes.position, n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); nrm.push(n.getX(i), n.getY(i), n.getZ(i)); }
    if (g.index) for (const i of g.index.array) idx.push(base + i);
    else for (let i = 0; i < p.count; i++) idx.push(base + i);
  });
  if (!pos.length) throw new Error(`${url}: no meshes in it`);
  const name = url.split('/').pop()!.replace(/\.glb$/i, '');
  return prepareBodyModel(name, Float32Array.from(pos), Float32Array.from(nrm), Uint32Array.from(idx), settings);
}
