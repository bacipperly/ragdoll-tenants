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
  if (settings.armAngle !== undefined) armAngle = THREE.MathUtils.degToRad(settings.armAngle);
  if (settings.legAngle !== undefined) legAngle = THREE.MathUtils.degToRad(settings.legAngle);
  const rig = extra.rig ?? null;
  return {
    name, positions: pos, normals: nrm, index, landmarks, found, armAngle, legAngle, head: settings.head ?? 'goo',
    weights: settings.weights === 'rig' && rig ? 'rig' : 'ours', part, roles, hip, rig, measures,
  };
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
    if (chain && m.weights !== 'rig') {
      const fin = chain.startsWith('fin'), sd = chain.endsWith('L') ? 'L' : 'R';
      const up = segByName.get(fin ? `upperArm${sd}` : `thigh${sd}`)!, low = segByName.get(fin ? `forearm${sd}` : `shin${sd}`)!;
      const root = segByName.get(fin ? 'chest' : 'torso')!;
      const lb = segs[up].limb!, a = lb.side * lb.angle;
      const dx = Math.sin(a), dy = -Math.cos(a); // down the limb, as the model holds it
      const t = (x - lb.px) * dx + (y - lb.py) * dy;
      const upperLen = fin ? D.upperArmLen : D.thighLen;
      const lower = THREE.MathUtils.smoothstep(t, upperLen * 0.6, upperLen * 1.4);
      const body = 1 - THREE.MathUtils.smoothstep(t, -0.1 * upperLen, 0.35 * upperLen);
      w.fill(0);
      w[low] = (1 - body) * lower; w[up] = (1 - body) * (1 - lower); w[root] = body;
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
