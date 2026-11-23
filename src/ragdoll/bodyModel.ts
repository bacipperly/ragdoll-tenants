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
import { bodyDims, setProportionCalibration, type BodyDims } from './proportions';
import { PROPORTIONS } from './config';

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
  /**
   * Bone weights: 'ours' (by distance to our capsules, kept to each part's own bones
   * when the model comes in parts) or 'rig' (the model's own rig, its bones mapped
   * onto ours by name). Default 'ours'.
   */
  weights?: 'ours' | 'rig';
  /** Where the knee sits, as a share of the leg's length from the foot (default 0.6, a little above halfway). */
  kneeHeight?: number;
}

/** What each separate part of a segmented model is. */
export type PartRole = 'head' | 'face' | 'torso' | 'finL' | 'finR' | 'legL' | 'legR';

/** A model's own rig, per vertex: up to 4 joints (indices into names) and weights. */
export interface ModelRig { joints: Uint16Array; weights: Float32Array; names: string[] }

/** The model's measurements (its own units), for fitting our proportions to it. */
export interface ModelMeasures {
  height: number;
  headRadius: number; headWidth: number; headHeight: number;
  hip: number; torsoHalfWidth: number;
  finLength: number; finHalfWidth: number; finRootX: number;
  legHalfWidth: number; legX: number;
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
  weights: 'ours' | 'rig';
  /** Segmented models: each vertex's part, and what each part is. */
  part: Int32Array | null;
  roles: PartRole[];
  /** Height of the hip joints (the tops of the legs), when the legs are separate parts. */
  hip: number | null;
  rig: ModelRig | null;
  measures: ModelMeasures | null;
  /** Vertices from here on are the caps' (see capParts). */
  capFrom: number;
  /** Where the knee sits, as a share of the leg from the foot. */
  kneeHeight: number;
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

/** The main axis of some 2D points (x mirrored outward, y up): its angle out from vertical, and extent along and across it. */
function axisOf(xs: number[], ys: number[]): { angle: number; length: number; halfWidth: number } {
  const n = xs.length;
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; }
  mx /= n; my /= n;
  let cxx = 0, cyy = 0, cxy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; cxx += dx * dx; cyy += dy * dy; cxy += dx * dy; }
  const a = 0.5 * Math.atan2(2 * cxy, cyy - cxx); // from vertical, + toward +x as y rises
  const ux = Math.sin(a), uy = Math.cos(a);
  let lo = Infinity, hi = -Infinity, across = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my, t = dx * ux + dy * uy;
    lo = Math.min(lo, t); hi = Math.max(hi, t);
    across = Math.max(across, Math.abs(dx * uy - dy * ux));
  }
  // Out-and-down means x grows as y falls: a negative angle; report it as positive out.
  return { angle: Math.max(0, -a), length: hi - lo, halfWidth: across };
}

/**
 * Works out what each part of a segmented model is, from where it sits: the head is
 * the part at the top; small parts on its front are the face (eyes, mouth); parts
 * that reach the feet are the legs; of the rest, the biggest is the torso and the
 * others are fins, by side (+x is the character's left).
 */
function classifyParts(pos: Float32Array, part: Int32Array): PartRole[] {
  const n = Math.max(...part) + 1;
  const box = Array.from({ length: n }, () => ({ min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], sum: [0, 0, 0], count: 0 }));
  let feet = Infinity;
  for (let v = 0; v < part.length; v++) {
    const b = box[part[v]];
    for (let k = 0; k < 3; k++) { const x = pos[v * 3 + k]; b.min[k] = Math.min(b.min[k], x); b.max[k] = Math.max(b.max[k], x); b.sum[k] += x; }
    b.count++;
    feet = Math.min(feet, pos[v * 3 + 1]);
  }
  const top = Math.max(...box.map((b) => b.max[1])), H = top - feet;
  const roles: PartRole[] = new Array(n).fill('torso');
  const head = box.findIndex((b) => b.max[1] === top);
  roles[head] = 'head';
  const hb = box[head];
  const centre = (b: typeof hb, k: number) => b.sum[k] / Math.max(1, b.count);
  for (let i = 0; i < n; i++) {
    if (i === head || !box[i].count) continue;
    const b = box[i];
    const inHead = [0, 1, 2].every((k) => centre(b, k) >= hb.min[k] && centre(b, k) <= hb.max[k]);
    if (inHead && b.count < 0.35 * hb.count && centre(b, 2) > 0) roles[i] = 'face';
    else if (b.min[1] - feet < 0.03 * H) roles[i] = centre(b, 0) >= 0 ? 'legL' : 'legR';
  }
  const rest = box.map((_, i) => i).filter((i) => roles[i] === 'torso' && box[i].count);
  const torso = rest.reduce((a, b) => (box[b].count > box[a].count ? b : a), rest[0]);
  for (const i of rest) {
    if (i === torso) continue;
    if (Math.abs(centre(box[i], 0)) > 0.25 * (box[torso].max[0] - box[torso].min[0])) roles[i] = centre(box[i], 0) >= 0 ? 'finL' : 'finR';
  }
  return roles;
}

/**
 * Triangulates a closed loop of points (an opening's outline, however long, bent or
 * twisted) with the least total area: the classic hole-filling method. Every triangle
 * joins points of the outline, so the patch spans the opening without spikes or gaps.
 * Triangles come back as indices into the loop, wound in the loop's order.
 */
function minAreaFill(pts: [number, number, number][]): [number, number, number][] {
  const n = pts.length;
  const area = (i: number, j: number, k: number) => {
    const a = pts[i], b = pts[j], c = pts[k];
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    return 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
  };
  const W = new Float64Array(n * n), M = new Int32Array(n * n).fill(-1);
  for (let len = 2; len < n; len++) {
    for (let i = 0; i + len < n; i++) {
      const j = i + len;
      let best = Infinity, arg = -1;
      for (let m = i + 1; m < j; m++) {
        const w = W[i * n + m] + W[m * n + j] + area(i, m, j);
        if (w < best) { best = w; arg = m; }
      }
      W[i * n + j] = best; M[i * n + j] = arg;
    }
  }
  const out: [number, number, number][] = [];
  const walk = (i: number, j: number) => {
    if (j - i < 2) return;
    const m = M[i * n + j];
    out.push([i, m, j]);
    walk(i, m); walk(m, j);
  };
  walk(0, n - 1);
  return out;
}

/**
 * Closes each part's open edges. Segmenting cuts one mesh into pieces, leaving every
 * part open where it was cut from its neighbour; where a part comes away from another
 * as the body moves (a fin that hugged the side, lifting off it), you'd see into its
 * hollow inside. Each open loop is filled with the least-area patch spanning it, so the
 * part is a closed shell. Returns the mesh with the caps added.
 */
function capParts(pos: Float32Array, nrm: Float32Array, index: Uint32Array, part: Int32Array, roles: PartRole[]) {
  const P = Array.from(pos), N = Array.from(nrm), I = Array.from(index), Q = Array.from(part);
  const H = (() => { let lo = Infinity, hi = -Infinity; for (let i = 1; i < pos.length; i += 3) { lo = Math.min(lo, pos[i]); hi = Math.max(hi, pos[i]); } return hi - lo; })();
  const q = (v: number) => Math.round((v / H) * 1e5);
  // Weld within each part (texture seams duplicate points), so only real cuts are open.
  const id = new Int32Array(pos.length / 3), byKey = new Map<string, number>();
  for (let v = 0; v < id.length; v++) {
    const k = `${part[v]}:${q(pos[v * 3])},${q(pos[v * 3 + 1])},${q(pos[v * 3 + 2])}`;
    id[v] = byKey.get(k) ?? (byKey.set(k, v), v);
  }
  const count = new Map<string, number>(), dir = new Map<string, [number, number]>();
  for (let t = 0; t < index.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = id[index[t + e]], b = id[index[t + (e + 1) % 3]];
      if (a === b) continue;
      const k = a < b ? `${a},${b}` : `${b},${a}`;
      count.set(k, (count.get(k) ?? 0) + 1);
      dir.set(k, [a, b]);
    }
  }
  const next = new Map<number, number>();
  for (const [k, c] of count) if (c === 1) { const [a, b] = dir.get(k)!; next.set(a, b); }
  const seen = new Set<number>();
  let capped = 0;
  for (const start of next.keys()) {
    if (seen.has(start) || roles[part[start]] === 'face') continue;
    const loop: number[] = [];
    let v = start;
    while (!seen.has(v) && next.has(v) && loop.length < 5000) { seen.add(v); loop.push(v); v = next.get(v)!; }
    if (v !== start || loop.length < 3) continue; // not a clean loop: leave it
    // Fill the opening (copies of its outline's points, so the cap gets its own shading),
    // reversing the outline's direction so the cap closes the shell the other way round.
    const tris = minAreaFill(loop.map((u) => [pos[u * 3], pos[u * 3 + 1], pos[u * 3 + 2]] as [number, number, number]));
    const dup = loop.map((u) => { const d = P.length / 3; P.push(pos[u * 3], pos[u * 3 + 1], pos[u * 3 + 2]); N.push(0, 0, 0); Q.push(part[u]); return d; });
    for (const [i0, i1, i2] of tris) {
      const a0 = dup[i2], a1 = dup[i1], a2 = dup[i0];
      I.push(a0, a1, a2);
      // Shading from the cap's own triangles, as wound (lit right from either side).
      const ux = P[a1 * 3] - P[a0 * 3], uy = P[a1 * 3 + 1] - P[a0 * 3 + 1], uz = P[a1 * 3 + 2] - P[a0 * 3 + 2];
      const vx = P[a2 * 3] - P[a0 * 3], vy = P[a2 * 3 + 1] - P[a0 * 3 + 1], vz = P[a2 * 3 + 2] - P[a0 * 3 + 2];
      const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
      for (const v of [a0, a1, a2]) { N[v * 3] += fx; N[v * 3 + 1] += fy; N[v * 3 + 2] += fz; }
    }
    for (const v of dup) {
      const l = Math.hypot(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]) || 1;
      N[v * 3] /= l; N[v * 3 + 1] /= l; N[v * 3 + 2] /= l;
    }
    capped++;
  }
  return { pos: Float32Array.from(P), nrm: Float32Array.from(N), index: Uint32Array.from(I), part: Int32Array.from(Q), capped };
}

/** Prepares a loaded mesh: turned to face +z, centred over its feet, its landmarks, limb angles and measurements found. */
export function prepareBodyModel(name: string, positions: Float32Array, normals: Float32Array, index: Uint32Array, settings: BodyModelSettings = {},
  extra: { part?: Int32Array; rig?: ModelRig } = {}): BodyModel {
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
  let armAngle = finAngle(S, L, tol);
  let legAngle = limbAngle(S, L.feet + 0.1 * (L.crotch - L.feet), L.crotch - 0.1 * (L.crotch - L.feet), tol);
  let hip: number | null = null, measures: ModelMeasures | null = null;
  const part = extra.part ?? null;
  const roles = part ? classifyParts(pos, part) : [];

  // Segmented: the parts say exactly where everything is.
  if (part && roles.includes('head') && roles.includes('torso')) {
    const pts = (role: PartRole) => {
      const xs: number[] = [], ys: number[] = [], zs: number[] = [];
      for (let v = 0; v < part.length; v++) if (roles[part[v]] === role) { xs.push(pos[v * 3]); ys.push(pos[v * 3 + 1]); zs.push(pos[v * 3 + 2]); }
      return { xs, ys, zs };
    };
    const ext = (a: number[]) => [Math.min(...a), Math.max(...a)];
    const head = pts('head'), torso = pts('torso');
    const [hx0, hx1] = ext(head.xs), [hy0, hy1] = ext(head.ys), [hz0, hz1] = ext(head.zs);
    const set = (k: keyof Landmarks, v: number) => { if (settings.landmarks?.[k] === undefined) { L[k] = v; found[k] = 'detected'; } };
    set('neck', hy0);
    set('crotch', ext(torso.ys)[0]);
    const fins = (['finL', 'finR'] as const).map((r) => pts(r)).filter((f) => f.xs.length > 10);
    const legs = (['legL', 'legR'] as const).map((r) => pts(r)).filter((f) => f.xs.length > 10);
    let finLen = 0, finHalf = 0, finRootX = 0, finTop = 0;
    if (fins.length) {
      const fa = fins.map((f) => axisOf(f.xs.map(Math.abs), f.ys));
      armAngle = fa.reduce((a, f) => a + f.angle, 0) / fa.length;
      finLen = fa.reduce((a, f) => a + f.length, 0) / fa.length;
      finHalf = fa.reduce((a, f) => a + f.halfWidth, 0) / fa.length;
      finTop = fins.reduce((a, f) => a + ext(f.ys)[1], 0) / fins.length;
      // The root: where the fin's top meets the body, a fin-width in from the top.
      finRootX = fins.reduce((a, f) => {
        let sx = 0, k = 0;
        const [, top] = ext(f.ys);
        for (let i = 0; i < f.xs.length; i++) if (f.ys[i] > top - finHalf) { sx += Math.abs(f.xs[i]); k++; }
        return a + sx / Math.max(1, k);
      }, 0) / fins.length;
      set('shoulder', finTop - finHalf);
    }
    let legHalf = 0, legX = 0;
    if (legs.length) {
      const la = legs.map((f) => axisOf(f.xs.map(Math.abs), f.ys));
      legAngle = la.reduce((a, f) => a + f.angle, 0) / la.length;
      legHalf = la.reduce((a, f) => a + f.halfWidth, 0) / la.length;
      hip = legs.reduce((a, f) => a + ext(f.ys)[1], 0) / legs.length - legHalf; // a leg-width under the leg's top
      legX = legs.reduce((a, f) => a + Math.abs(f.xs.reduce((p, q) => p + q, 0) / f.xs.length), 0) / legs.length;
    }
    const torsoHalf = Math.max(...torso.xs.map(Math.abs));
    measures = {
      height: L.top - L.feet,
      headRadius: ((hx1 - hx0) + (hy1 - hy0) + (hz1 - hz0)) / 6, headWidth: hx1 - hx0, headHeight: hy1 - hy0,
      hip: (hip ?? L.crotch) - L.feet, torsoHalfWidth: torsoHalf,
      finLength: finLen, finHalfWidth: finHalf, finRootX, legHalfWidth: legHalf, legX,
    };
  }
  // Close the parts' cut edges (after measuring, which the caps don't change).
  let finalPos = pos, finalNrm = nrm, finalIndex = index, finalPart = part;
  if (part && roles.length) {
    const c = capParts(pos, nrm, index, part, roles);
    finalPos = c.pos; finalNrm = c.nrm; finalIndex = c.index; finalPart = c.part;
  }
  if (settings.armAngle !== undefined) armAngle = THREE.MathUtils.degToRad(settings.armAngle);
  if (settings.legAngle !== undefined) legAngle = THREE.MathUtils.degToRad(settings.legAngle);
  const rig = extra.rig ?? null;
  return {
    name, positions: finalPos, normals: finalNrm, index: finalIndex, landmarks, found, armAngle, legAngle, head: settings.head ?? 'goo',
    capFrom: pos.length / 3,
    kneeHeight: Math.min(0.85, Math.max(0.2, settings.kneeHeight ?? 0.6)),
    weights: settings.weights === 'rig' && rig ? 'rig' : 'ours', part: finalPart, roles, hip, rig: rig && finalPos.length > pos.length ? extendRig(rig, (finalPos.length - pos.length) / 3, finalPart!, part!) : rig, measures,
  };
}

/**
 * The model's own rig, extended to the caps' new vertices: each takes the weights of
 * the first original vertex of its part at the same spot (a cap's middle, its part's first).
 */
function extendRig(rig: ModelRig, added: number, partAll: Int32Array, partOrig: Int32Array): ModelRig {
  const n0 = partOrig.length;
  const firstOfPart = new Map<number, number>();
  for (let v = 0; v < n0; v++) if (!firstOfPart.has(partOrig[v])) firstOfPart.set(partOrig[v], v);
  const joints = new Uint16Array((n0 + added) * 4), weights = new Float32Array((n0 + added) * 4);
  joints.set(rig.joints); weights.set(rig.weights);
  for (let v = n0; v < n0 + added; v++) {
    const from = firstOfPart.get(partAll[v]) ?? 0;
    for (let k = 0; k < 4; k++) { joints[v * 4 + k] = rig.joints[from * 4 + k]; weights[v * 4 + k] = rig.weights[from * 4 + k]; }
  }
  return { ...rig, joints, weights };
}

/** A rig bone's name → which of our bones it moves (Mixamo-style names, which Tripo uses). */
export function ourBoneForRigBone(name: string): string {
  const n = name.replace(/^.*:/, '').toLowerCase();
  const side = n.startsWith('left') ? 'L' : n.startsWith('right') ? 'R' : '';
  if (side) {
    if (/upleg|thigh/.test(n)) return `thigh${side}`;
    if (/leg|foot|toe|calf|shin/.test(n)) return `shin${side}`;
    if (/forearm|hand|thumb|index|middle|ring|pinky/.test(n)) return `forearm${side}`;
    if (/arm|shoulder/.test(n)) return `upperArm${side}`;
  }
  if (/neck|head/.test(n)) return 'head';
  if (/spine2|spine1|chest/.test(n)) return 'chest';
  return 'torso'; // hips, spine, anything else
}

// ---------------------------------------------------------------- our proportions, from the model

type ProportionKey = keyof typeof PROPORTIONS;

/**
 * Multipliers on our proportions so a standard adult's skeleton matches the model: the
 * same head size (the goo head replaces the model's), hip, shoulder and neck heights,
 * fin length, and where the fins and legs join, all as shares of the height. Babies,
 * elders and every slider still work on top of this. Needs a segmented model (null
 * otherwise). Solved by repeatedly nudging each multiplier by how far off its
 * measurement is, since they interact (longer legs lift the head, and so on).
 *
 * Thickness (body width, fin width, leg thickness) is left alone on purpose: the
 * model's mesh supplies the shape, and fat capsules only make stiff physics (short,
 * thick legs become two balls with no knee to speak of).
 */
export function calibrate(m: BodyModel): Partial<Record<ProportionKey, number>> | null {
  const M = m.measures;
  if (!M || !M.height) return null;
  const H = M.height, L = m.landmarks;
  const adult = { age: 0.5, weight: 0, fitness: 0 };
  const f: Partial<Record<ProportionKey, number>> = { headSize: 1, legLength: 1, bodyHeight: 1, finLength: 1, shoulderWidth: 1, hipWidth: 1 };
  setProportionCalibration({});
  const want = {
    head: (2 * M.headRadius) / H, hip: M.hip / H, neck: (L.neck - L.feet) / H,
    finLen: M.finLength / H, finX: M.finRootX / H, legX: M.legX / H,
  };
  const clamp = (k: ProportionKey) => { f[k] = Math.min(4, Math.max(0.25, f[k]!)); };
  for (let it = 0; it < 12; it++) {
    const P = { ...PROPORTIONS };
    for (const k in f) P[k as ProportionKey] *= f[k as ProportionKey]!;
    const D = bodyDims(P, adult), h = D.height;
    const nudge = (k: ProportionKey, target: number, now: number, power = 1) => {
      if (target > 0 && now > 0) { f[k]! *= Math.pow(target / now, power); clamp(k); }
    };
    nudge('headSize', want.head, (2 * D.headR) / h);
    nudge('legLength', want.hip, D.hipY / h);
    nudge('bodyHeight', want.neck - want.hip, (D.headY - D.headR - D.hipY) / h);
    if (want.finLen) nudge('finLength', want.finLen, (D.upperArmLen + D.forearmLen + D.forearmR) / h, 0.8);
    if (want.finX) nudge('shoulderWidth', want.finX, D.shoulderX / h, 0.6);
    if (want.legX) nudge('hipWidth', want.legX, D.hipX / h, 0.6);
  }
  for (const k in f) f[k as ProportionKey] = Math.round(f[k as ProportionKey]! * 1000) / 1000;
  return f;
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
  const knots: [number, number][] = [[L.feet, 0], m.hip !== null ? [m.hip, D.hipY] : [L.crotch, ourCrotch], [L.shoulder, D.shoulderY], [L.neck, ourNeck], [L.top, D.height]];
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
    if (m.part) {
      // Segmented: drop the face, and the head itself when the goo head replaces it.
      const role = m.roles[m.part[a]];
      if (role === 'face' || (role === 'head' && m.head === 'goo')) continue;
    } else if (m.head === 'goo' && (src[a * 3 + 1] + src[b * 3 + 1] + src[c * 3 + 1]) / 3 > L.neck) continue;
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
  // Each kept vertex's part role, and (from the model's rig) its weights by our bone name.
  const vRole: (PartRole | null)[] = new Array(count).fill(null);
  const vSrc = new Int32Array(count);
  for (let i = 0; i < remap.length; i++) if (remap[i] >= 0) { vSrc[remap[i]] = i; vRole[remap[i]] = m.part ? m.roles[m.part[i]] : null; }

  // 3. Capsules swung out to the model's limb angles, for weighting.
  type Seg = { name: string; bone: number; region: number; side: number; ax: number; ay: number; bx: number; by: number; z: number; r: number; limb: Limb | null };
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
    return { name: c.name, bone: c.bone, region: REGION[c.name] ?? 0, side, ax, ay, bx, by, z: c.cz, r: c.r, limb };
  });

  // 4. Weights and clothes data, then the limbs swung back to hang straight.
  const skinIndex = new Uint16Array(count * 4), skinWeight = new Float32Array(count * 4);
  const clothA = new Float32Array(count * 4), clothB = new Float32Array(count * 4);
  const d = new Float32Array(segs.length), w = new Float32Array(segs.length);
  const order: number[] = segs.map((_, i) => i);
  // Which of our bones each part may follow (a part's own limb, plus what it joins).
  const ALLOWED: Record<PartRole, (name: string) => boolean> = {
    legL: (n) => n === 'thighL' || n === 'shinL' || n === 'torso',
    legR: (n) => n === 'thighR' || n === 'shinR' || n === 'torso',
    finL: (n) => n === 'upperArmL' || n === 'forearmL' || n === 'chest',
    finR: (n) => n === 'upperArmR' || n === 'forearmR' || n === 'chest',
    torso: (n) => !n.startsWith('shin') && !n.startsWith('forearm') && n !== 'head',
    head: () => true, face: () => true,
  };
  const segByName = new Map(segs.map((g, i) => [g.name, i]));
  // Every vertex's weight on every bone, worked out first so the seams can be welded.
  const S = segs.length, allW = new Float32Array(count * S), tmpW = new Float32Array(S);
  type LimbRole = 'finL' | 'finR' | 'legL' | 'legR';
  /**
   * A limb's weights at (x, y), as a rig would have them: the upper bone down to the
   * elbow or knee, the lower bone past it, the body only at the root. Joints blend over
   * a good stretch (in absolute terms too: short, thick legs otherwise crease sharply),
   * so a tucked knee or a raised fin bends the skin smoothly instead of tearing it.
   */
  const chainInto = (limb: LimbRole, x: number, y: number, out: Float32Array) => {
    const fin = limb.startsWith('fin'), sd = limb.endsWith('L') ? 'L' : 'R';
    const up = segByName.get(fin ? `upperArm${sd}` : `thigh${sd}`)!, low = segByName.get(fin ? `forearm${sd}` : `shin${sd}`)!;
    const root = segByName.get(fin ? 'chest' : 'torso')!;
    const lb = segs[up].limb!, a = lb.side * lb.angle;
    const t = (x - lb.px) * Math.sin(a) + (y - lb.py) * -Math.cos(a); // down the limb, as the model holds it
    const upperLen = fin ? D.upperArmLen : D.thighLen;
    const span = seamReach(limb);
    // Where the limb was cut from the torso in a ring at its root (legs), the bend starts
    // just below that ring, like a sleeve: the ring itself stays with the body, so the
    // seam never opens. A limb fused to the body along its length (fins hugging the
    // sides) can't be kept shut without dragging the body along, so it bends from the
    // joint and its cut edges are capped instead (see capHoles).
    const depth = seamDepth.get(limb) ?? -Infinity;
    const sleeve = depth > -Infinity && depth < 0.6 * upperLen;
    let lower: number, body: number;
    if (sleeve) {
      // A short hand-over just below the seam, then the upper bone has the limb down to
      // the joint and the lower bone past it, each its fair share. (Spread wider, the
      // body keeps most of a short leg and only its foot swings, bending backward like a
      // bird's.)
      // The hand-over straddles the seam (the hip gives a little too, as a real one does),
      // and the torso round the seam follows the same rule (see the torso, below), so
      // both sides agree on the seam itself and it stays shut.
      // (Blends are sized from the whole limb, so moving the knee doesn't sharpen them.)
      const band = fin ? upperLen : (D.thighLen + D.shinLen) / 2;
      body = 1 - THREE.MathUtils.smoothstep(t, depth - 0.5 * band, depth + 0.5 * band);
      // Between the legs, at the crotch, the body holds still: pulled two ways by
      // scissoring thighs it would tear. The swing shows on the outside of the hip.
      if (!fin) {
        const inner = 1 - THREE.MathUtils.smoothstep(x * lb.side, 0.1 * Math.abs(lb.px), 0.75 * Math.abs(lb.px));
        body += (1 - body) * inner * (1 - THREE.MathUtils.smoothstep(t, depth, depth + band));
      }
      const knee = Math.max(upperLen, depth + 0.5 * band);
      lower = THREE.MathUtils.smoothstep(t, knee - 0.35 * band, knee + 0.35 * band);
    } else {
      lower = THREE.MathUtils.smoothstep(t, upperLen - 0.6 * span, upperLen + 0.6 * span);
      body = 1 - THREE.MathUtils.smoothstep(t, -0.4 * span, 0.7 * span);
    }
    out.fill(0);
    out[low] = (1 - body) * lower; out[up] = (1 - body) * (1 - lower); out[root] = body;
  };
  /** How far down each limb its seam with the torso reaches (along the limb, from the joint). */
  const seamDepth = new Map<LimbRole, number>();
  const seamReach = (limb: LimbRole) => limb.startsWith('fin')
    ? Math.max(D.upperArmLen, 1.2 * D.upperArmR) : Math.max(D.thighLen, 1.2 * D.thighR);
  /** Groups of kept vertices sitting at the same spot in the model (within a hair), via a spatial hash. */
  const coincident = (n: number, at: (v: number) => number): number[][] => {
    const tol = 2e-4 * (L.top - L.feet), cell = 4 * tol, grid = new Map<string, number[]>();
    const parent = Int32Array.from({ length: n }, (_, i) => i);
    const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    for (let v = 0; v < n; v++) {
      const i = at(v), x = src[i * 3], y = src[i * 3 + 1], z = src[i * 3 + 2];
      const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        for (const u of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
          const j = at(u);
          if (Math.hypot(src[j * 3] - x, src[j * 3 + 1] - y, src[j * 3 + 2] - z) <= tol) parent[find(u)] = find(v);
        }
      }
      const k = `${cx},${cy},${cz}`;
      (grid.get(k) ?? grid.set(k, []).get(k)!).push(v);
    }
    const out = new Map<number, number[]>();
    for (let v = 0; v < n; v++) { const r = find(v); (out.get(r) ?? out.set(r, []).get(r)!).push(v); }
    return [...out.values()].filter((g) => g.length > 1);
  };
  // Where each limb was cut from the torso: the points they share.
  const seams = new Map<LimbRole, number[]>();
  if (m.part) {
    const withTorso = new Uint8Array(count);
    for (const g of coincident(count, (v) => vSrc[v])) if (g.some((v) => vRole[v] === 'torso')) for (const v of g) withTorso[v] = 1;
    for (let v = 0; v < count; v++) {
      const r = vRole[v];
      if (r !== 'finL' && r !== 'finR' && r !== 'legL' && r !== 'legR') continue;
      if (!withTorso[v]) continue;
      const list = seams.get(r) ?? seams.set(r, []).get(r)!;
      list.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
    }
    for (const [limb, pts] of seams) {
      const fin = limb.startsWith('fin'), sd = limb.endsWith('L') ? 'L' : 'R';
      const lb = segs[segByName.get(fin ? `upperArm${sd}` : `thigh${sd}`)!].limb!, a = lb.side * lb.angle;
      let deepest = -Infinity;
      for (let k = 0; k < pts.length; k += 3) deepest = Math.max(deepest, (pts[k] - lb.px) * Math.sin(a) + (pts[k + 1] - lb.py) * -Math.cos(a));
      seamDepth.set(limb, deepest);
    }
  }
  for (let v = 0; v < count; v++) {
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    const role = vRole[v];
    let dMin = Infinity;
    for (let s = 0; s < segs.length; s++) {
      const g = segs[s];
      // A limb only takes vertices on its own side of the body (and a part only its own bones).
      if ((g.side && x * g.side < -0.25 * D.hipX) || (role && !ALLOWED[role](g.name))) { d[s] = Infinity; continue; }
      const ex = g.bx - g.ax, ey = g.by - g.ay, l2 = ex * ex + ey * ey || 1;
      const u = Math.max(0, Math.min(1, ((x - g.ax) * ex + (y - g.ay) * ey) / l2));
      d[s] = Math.max(0, Math.hypot(x - g.ax - ex * u, y - g.ay - ey * u, z - g.z) - g.r);
      dMin = Math.min(dMin, d[s]);
    }
    const soft = 0.15 * D.bellyR; // how far a bone's pull reaches past the nearest one: small keeps limbs crisp
    let sum = 0;
    for (let s = 0; s < segs.length; s++) { w[s] = Number.isFinite(d[s]) ? Math.exp(-(d[s] - dMin) / soft) : 0; sum += w[s]; }
    // A limb part: weighted along the limb, as a rig would be. The upper bone down to the
    // elbow or knee, the lower bone past it (blended across the joint), and the body
    // only right at the root, so the limb follows its bones and bends at a clear joint.
    const chain = role === 'finL' || role === 'finR' || role === 'legL' || role === 'legR' ? role : null;
    if (chain && m.weights !== 'rig') { chainInto(chain, x, y, w); sum = 1; }
    // The torso part: only the body's own bones, belly blending into chest by height.
    // (Pulling it along with the limbs drags the body's sides and hips out of shape.)
    if (role === 'torso' && m.weights !== 'rig') {
      const band = 0.6 * D.chestLen;
      const chest = THREE.MathUtils.smoothstep(y, D.spineY - band, D.spineY + band);
      w.fill(0);
      w[segByName.get('chest')!] = chest; w[segByName.get('torso')!] = 1 - chest;
      // Round a leg's ring seam (the hip), blend into that leg's own weights, all the
      // way on the seam itself. (Not round the fins: fused along the sides, they'd drag
      // the body's flanks out of shape; those seams are capped and come apart instead.)
      for (const [limb, pts] of seams) {
        const depth = seamDepth.get(limb) ?? -Infinity, upperLen = limb.startsWith('fin') ? D.upperArmLen : D.thighLen;
        if (!(depth > -Infinity && depth < 0.6 * upperLen)) continue;
        let best = Infinity;
        for (let k = 0; k < pts.length; k += 3) best = Math.min(best, Math.hypot(x - pts[k], y - pts[k + 1], z - pts[k + 2]));
        const near = 1 - THREE.MathUtils.smoothstep(best, 0, 0.8 * (limb.startsWith('fin') ? upperLen : (D.thighLen + D.shinLen) / 2));
        if (near <= 0) continue;
        chainInto(limb, x, y, tmpW);
        for (let s2 = 0; s2 < S; s2++) w[s2] += (tmpW[s2] - w[s2]) * near;
      }
      sum = 1;
    }
    if (m.weights === 'rig' && m.rig) {
      // The model's own rig instead: its bones' weights, summed onto ours by name.
      w.fill(0); sum = 0;
      const i0 = vSrc[v] * 4;
      for (let k = 0; k < 4; k++) {
        const ww = m.rig.weights[i0 + k];
        if (ww <= 0) continue;
        const our = ourBoneForRigBone(m.rig.names[m.rig.joints[i0 + k]]);
        const s = segByName.get(our === 'head' ? 'chest' : our);
        if (s !== undefined) { w[s] += ww; sum += ww; }
      }
      if (sum <= 0) { const s = segByName.get('torso')!; w[s] = 1; sum = 1; }
    }
    for (let s = 0; s < S; s++) allW[v * S + s] = w[s] / (sum || 1);
  }

  // Weld the seams. A segmented model's parts were cut from one mesh, so along each cut
  // the parts' open edges sit on the very same points. Those points must move as one,
  // or the cut opens into a hole as the limb moves: give every vertex at the same spot
  // the same weights (the average of what each part would give it).
  {
    const groups = new Map<number, number[]>();
    for (const g of coincident(count, (v) => vSrc[v])) groups.set(g[0], g);
    const avg = new Float32Array(S);
    // Only ring seams (a limb cut off at its root) are welded; a limb fused to the body
    // along its length is left free to come away, its cut edges capped.
    const fused = (r: PartRole | null) => (r === 'finL' || r === 'finR' || r === 'legL' || r === 'legR')
      && (seamDepth.get(r) ?? -Infinity) >= 0.6 * (r.startsWith('fin') ? D.upperArmLen : D.thighLen);
    for (const all of groups.values()) {
      const g = all.filter((v) => !fused(vRole[v]));
      if (g.length < 2) continue;
      avg.fill(0);
      for (const v of g) for (let s = 0; s < S; s++) avg[s] += allW[v * S + s] / g.length;
      for (const v of g) allW.set(avg, v * S);
    }
  }

  for (let v = 0; v < count; v++) {
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    for (let s = 0; s < S; s++) w[s] = allW[v * S + s];
    const sum = 1;
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
  // Where the caps' vertices start (for checks: caps are inside the body, mostly).
  let capFrom = count;
  for (let i = m.capFrom; i < remap.length; i++) if (remap[i] >= 0) capFrom = Math.min(capFrom, remap[i]);
  geo.userData.capFrom = capFrom;
  return geo;
}

// ---------------------------------------------------------------- loading (in the browser)

/**
 * Loads a .glb (every mesh in it merged, as placed in the file) and, if there is one,
 * the settings file next to it (same name, .json).
 */
export async function loadBodyModel(url: string, overrides: BodyModelSettings = {}): Promise<BodyModel> {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const gltf = await new GLTFLoader().loadAsync(url);
  let settings: BodyModelSettings = {};
  try {
    const r = await fetch(url.replace(/\.glb$/i, '.json'));
    if (r.ok) settings = (await r.json()) as BodyModelSettings;
  } catch { /* no settings: all automatic */ }
  settings = { ...settings, ...overrides };
  const pos: number[] = [], nrm: number[] = [], idx: number[] = [], part: number[] = [];
  const joints: number[] = [], weights: number[] = [], names: string[] = [];
  let parts = 0, rigged = true;
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    let g = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.index) g = g.toNonIndexed();
    const base = pos.length / 3;
    const p = g.attributes.position, n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); nrm.push(n.getX(i), n.getY(i), n.getZ(i)); part.push(parts); }
    if (g.index) for (const i of g.index.array) idx.push(base + i);
    else for (let i = 0; i < p.count; i++) idx.push(base + i);
    // Its rig, if it has one: joints as indices into one shared list of bone names.
    const sk = (mesh as THREE.SkinnedMesh).skeleton, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
    if (sk && si && sw) {
      for (let i = 0; i < p.count; i++) {
        for (let k = 0; k < 4; k++) {
          const bn = sk.bones[si.getComponent(i, k)]?.name ?? '';
          let j = names.indexOf(bn);
          if (j < 0) { j = names.length; names.push(bn); }
          joints.push(j); weights.push(sw.getComponent(i, k));
        }
      }
    } else rigged = false;
    parts++;
  });
  if (!pos.length) throw new Error(`${url}: no meshes in it`);
  const name = url.split('/').pop()!.replace(/\.glb$/i, '');
  return prepareBodyModel(name, Float32Array.from(pos), Float32Array.from(nrm), Uint32Array.from(idx), settings, {
    part: parts > 1 ? Int32Array.from(part) : undefined,
    rig: rigged && names.length ? { joints: Uint16Array.from(joints), weights: Float32Array.from(weights), names } : undefined,
  });
}
