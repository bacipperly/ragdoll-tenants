/*
 * Hair, from the character hair concepts sheet: chunky, molded, vinyl-toy hair, like
 * the sheet's, built from a few kinds of piece:
 *
 *   a scalp shell   a cap of hair over the head down to a hairline (front, sides, back),
 *                   with some volume on top and its edge tucked in against the head;
 *   locks           tapered, slightly flattened tubes along a path (swoops, fringes,
 *                   long hanging hair, spikes), which a texture can make wavy, or turn
 *                   into ringlets (curly) or tight beads (coily);
 *   blobs           balls: buns, curls, an afro's cloud, a crop's texture;
 *   braids          chains of tilted ovals.
 *
 * It's laid out on a unit head (+z the face, +y up) and scaled to the tenant's. Every
 * piece rides the squishy goo head (the shell point by point, each lock and blob by the
 * goo under its root, as hats do), and hair that hangs below the head swings a little
 * as the head moves and keeps hanging down when the head tips. Under a hat only what
 * the hat doesn't cover is built; under a raised hood, nothing.
 *
 * Built once when the look changes; per frame it only moves vertices (no allocation).
 */
import * as THREE from 'three';
import type { GooHead } from './goo';

export const HAIR_STYLES = [
  'buzz', 'short', 'messy', 'spiky', 'slicked', 'curtains', 'crop', 'medium', 'bob', 'mullet', 'long',
  'ponytail', 'bun', 'topknot', 'manbun', 'pigtails', 'braid', 'cornrows', 'locs', 'afro', 'curly', 'tufts',
] as const;
export type HairStyle = (typeof HAIR_STYLES)[number];
export const HAIR_TEXTURES = ['straight', 'wavy', 'curly', 'coily'] as const;
export type HairTexture = (typeof HAIR_TEXTURES)[number];
export const HAIR_PARTS = ['left', 'middle', 'right'] as const;
export type HairPart = (typeof HAIR_PARTS)[number];
export const HAIR_ACCENTS = ['none', 'highlights', 'streak'] as const;
export type HairAccent = (typeof HAIR_ACCENTS)[number];

/** The sheet's colour ideas. */
export const HAIR_COLORS = {
  black: '#1f1a17', darkBrown: '#4a2c1d', brown: '#7a4a2a', lightBrown: '#a8743f', blonde: '#e8c35a',
  red: '#b8392b', auburn: '#8f3f1f', orange: '#e2742a', platinum: '#efe6cf', gray: '#9a9a9a', white: '#f2f2f2',
  pink: '#f48fb1', purple: '#8e5cf0', blue: '#3a6fd8', teal: '#2bb3a3', green: '#4caf50',
} as const;

export interface HairSpec {
  style: HairStyle;
  color: string;
  texture: HairTexture;
  part: HairPart;
  /** Highlights through it, or one bold streak at the front, in accentColor. */
  accent: HairAccent;
  accentColor: string;
  /** The sides and back shade off to the skin, like a fade cut. */
  fade: boolean;
}

// ---------------------------------------------------------------- building

const FRONT = 0.78, SIDE = 1.55, BACK = 2.05; // default hairline, as angles down from the top
/** Hats come down to about here; under one, only hair below this is built. */
const HAT_LINE = 1.02;

/** A point on (or off) the unit head: φ round from the face toward +x, θ down from the top. */
function P(phi: number, theta: number, rad = 1): THREE.Vector3 {
  return new THREE.Vector3(rad * Math.sin(theta) * Math.sin(phi), rad * Math.cos(theta), rad * Math.sin(theta) * Math.cos(phi));
}

/** Small seeded random numbers, so a style always comes out the same. */
function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

interface Piece {
  geo: THREE.BufferGeometry;
  color: THREE.Color;
  /** Rides the goo under this direction (the piece's root); null: every vertex by its own. */
  root: THREE.Vector3 | null;
  /** Hangs below the head and swings. */
  hangs: boolean;
}

class Builder {
  readonly pieces: Piece[] = [];
  private n = 0;
  constructor(private readonly spec: HairSpec, private readonly underHat: boolean, private readonly skin: THREE.Color) {}

  /** The colour for the next lock/blob: the base, a touch varied, accented now and then. */
  colorFor(role: 'lock' | 'front' | 'tie' = 'lock'): THREE.Color {
    const s = this.spec, c = new THREE.Color(s.color);
    if (role === 'tie') return new THREE.Color(s.accent !== 'none' ? s.accentColor : '#e63946');
    const k = this.n++;
    c.multiplyScalar(0.94 + 0.12 * (((k * 0.618) % 1)));
    if (s.accent === 'highlights' && k % 3 === 1) c.lerp(new THREE.Color(s.accentColor), 0.7);
    if (s.accent === 'streak' && role === 'front') c.set(s.accentColor);
    return c;
  }

  /** True if this spot is under a hat (so leave it out). */
  hidden(at: THREE.Vector3): boolean {
    return this.underHat && at.y > Math.cos(HAT_LINE) * at.length();
  }

  add(geo: THREE.BufferGeometry, color: THREE.Color, root: THREE.Vector3 | null, hangs = false): void {
    if (root && this.hidden(root)) { geo.dispose(); return; }
    this.pieces.push({ geo, color, root, hangs });
  }

  /** The scalp: a cap of hair down to the hairline, `vol` thick on top, its edge tucked in. */
  shell(o: { front?: number; side?: number; back?: number; vol?: number; from?: number; minPhi?: number } = {}): void {
    const front = o.front ?? FRONT, side = o.side ?? SIDE, back = o.back ?? BACK, vol = o.vol ?? 0.06;
    const from = Math.max(o.from ?? 0, this.underHat ? HAT_LINE : 0);
    const NP = 32, NR = 10, pos: number[] = [], idx: number[] = [], col: number[] = [];
    const base = new THREE.Color(this.spec.color);
    for (let r = 0; r <= NR; r++) {
      const t = r / NR;
      for (let i = 0; i <= NP; i++) {
        const phi = -Math.PI + (2 * Math.PI * i) / NP, c = Math.cos(phi);
        // High at the forehead only right at the front; down by the ears; low at the nape.
        const line = side + (c > 0 ? (front - side) * c ** 4 : (back - side) * c * c);
        const th = from + (Math.max(line, from + 0.05) - from) * t;
        // Thick on top, thinning toward the edge, which tucks in against the head.
        const lift = r === NR ? 0.985 : 1.012 + vol * Math.max(0, Math.cos(th)) ** 0.6 * (1 - t * t * 0.7);
        const p = P(phi, th, lift);
        pos.push(p.x, p.y, p.z);
        const k = this.spec.fade ? THREE.MathUtils.smoothstep(t, 0.55, 1) * Math.max(0, 1 - c) * 0.5 : 0;
        const cc = base.clone().lerp(this.skin, k);
        col.push(cc.r, cc.g, cc.b);
      }
    }
    for (let r = 0; r < NR; r++) {
      for (let i = 0; i < NP; i++) {
        const a = r * (NP + 1) + i, b = a + NP + 1;
        const phi = -Math.PI + (2 * Math.PI * (i + 0.5)) / NP;
        if (o.minPhi && Math.abs(phi) < o.minPhi) continue; // bald in front (an elder's horseshoe)
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    this.pieces.push({ geo: g, color: new THREE.Color(1, 1, 1), root: null, hangs: false });
  }

  /** A tapered tube along a path, a little flattened against the head. */
  lock(pts: THREE.Vector3[], r0: number, r1: number, role: 'lock' | 'front' = 'lock', hangs = false, flat = 0.45, wide = 1.6): void {
    const tex = this.spec.texture;
    if (tex === 'curly' || tex === 'coily') { this.ringlets(pts, r0, r1, role, hangs); return; }
    if (tex === 'wavy') pts = wave(pts, 0.07);
    this.add(taperTube(pts, r0, r1, flat, wide), this.colorFor(role), pts[0], hangs);
  }

  /**
   * Hanging hair as one molded sheet round the back and sides (leaving the face clear
   * within `gap` of the front): down over the head from `from`, then straight down to
   * `yEnd`, flaring out, its surface grooved into locks and its hem scalloped. Curly
   * and coily hair hangs as ringlets instead.
   */
  drape(o: { gap: number; yEnd: number; from?: number; flare?: number; grooves?: number; tuck?: boolean; out?: number }): void {
    const tex = this.spec.texture;
    const grooves = o.grooves ?? 14, flare = o.flare ?? 0.08, out = o.out ?? 1.08;
    if (tex === 'curly' || tex === 'coily') {
      for (let phi = o.gap; phi <= 2 * Math.PI - o.gap + 1e-6; phi += (2 * Math.PI) / Math.min(grooves, 12)) {
        const f = phi > Math.PI ? phi - 2 * Math.PI : phi;
        this.ringlets(hang(f, (o.from ?? 0.5) + 0.25, o.yEnd, flare), 0.17, 0.12, 'lock', true);
      }
      return;
    }
    const from = Math.max(o.from ?? 0.35, this.underHat ? HAT_LINE : 0);
    const NP = 40, NR = 16, pos: number[] = [], col: number[] = [], idx: number[] = [];
    const base = new THREE.Color(this.spec.color), accent = new THREE.Color(this.spec.accentColor);
    const yA = out * Math.cos(1.75), rA = out * Math.sin(1.75);
    const lenA = 1.75 - from, lenB = Math.max(0.01, yA - o.yEnd), split = lenA / (lenA + lenB);
    for (let r = 0; r <= NR; r++) {
      const t = r / NR;
      for (let i = 0; i <= NP; i++) {
        const phi = o.gap + ((2 * Math.PI - 2 * o.gap) * i) / NP;
        const groove = Math.cos(grooves * phi);
        let rad: number, y: number;
        if (t <= split) {
          const th = from + (1.75 - from) * (t / split);
          rad = (1.04 + (out - 1.04) * (t / split)) * Math.sin(th); y = (1.04 + (out - 1.04) * (t / split)) * Math.cos(th);
        } else {
          const tb = (t - split) / (1 - split);
          rad = rA + flare * tb * tb; y = yA + (o.yEnd - yA) * tb;
          if (tex === 'wavy') rad += 0.09 * Math.sin(tb * Math.PI * 4 + 0.6 * Math.sin(3 * phi)) * Math.min(1, tb * 2);
          if (r === NR) y -= 0.08 * (0.5 + 0.5 * groove); // a scalloped hem
          if (o.tuck && r >= NR - 1) rad -= 0.08 * (r - NR + 2) / 2;
        }
        rad *= 1 + 0.035 * groove * Math.min(1, t * 4);
        pos.push(rad * Math.sin(phi), y, rad * Math.cos(phi));
        const band = Math.floor(((phi - o.gap) / (2 * Math.PI)) * grooves + 0.5);
        const c = base.clone().multiplyScalar(0.9 + 0.1 * groove);
        if (this.spec.accent === 'highlights' && band % 3 === 1) c.lerp(accent, 0.65);
        if (this.spec.accent === 'streak' && i <= 2) c.copy(accent);
        col.push(c.r, c.g, c.b);
      }
    }
    for (let r = 0; r < NR; r++) {
      for (let i = 0; i < NP; i++) {
        const a = r * (NP + 1) + i, b = a + NP + 1;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    this.pieces.push({ geo: g, color: new THREE.Color(1, 1, 1), root: null, hangs: true });
  }

  /** A straight lock whatever the texture (spikes, slicked hair). */
  plainLock(pts: THREE.Vector3[], r0: number, r1: number, role: 'lock' | 'front' = 'lock', flat = 0.65, wide = 1, hangs = false): void {
    this.add(taperTube(pts, r0, r1, flat, wide), this.colorFor(role), pts[0], hangs);
  }

  /** A lock as a run of curls: ringlets (curly) or tight beads (coily). */
  private ringlets(pts: THREE.Vector3[], r0: number, r1: number, role: 'lock' | 'front', hangs: boolean): void {
    const curve = new THREE.CatmullRomCurve3(pts), len = curve.getLength();
    const coily = this.spec.texture === 'coily';
    const color = this.colorFor(role);
    const parts: THREE.BufferGeometry[] = [];
    let t = 0, k = 0;
    while (t <= 1) {
      const r = (r0 + (r1 - r0) * t) * (coily ? 0.9 : 1.15) + 0.03;
      const p = curve.getPointAt(Math.min(1, t));
      const out = p.clone().normalize().multiplyScalar(coily ? 0.05 : 0.02);
      const side = new THREE.Vector3().crossVectors(curve.getTangentAt(Math.min(1, t)), p).normalize().multiplyScalar((k % 2 ? 1 : -1) * r * 0.35);
      parts.push(ball(p.add(out).add(side), r, r, r, 8)); // low-poly: there are a lot of them
      t += (r * (coily ? 1.3 : 1.6)) / len;
      k++;
    }
    this.add(merge(parts), color, pts[0], hangs);
  }

  /** A ball of hair (a bun, a curl, a puff of afro). */
  blob(at: THREE.Vector3, rx: number, ry = rx, rz = rx, role: 'lock' | 'front' | 'tie' = 'lock', hangs = false): void {
    this.add(ball(at, rx, ry, rz), this.colorFor(role), at.clone(), hangs);
  }

  /** A braid: a chain of ovals tipped alternately, along a path. */
  braid(pts: THREE.Vector3[], r: number, hangs = true): void {
    const curve = new THREE.CatmullRomCurve3(pts), len = curve.getLength();
    const parts: THREE.BufferGeometry[] = [];
    const color = this.colorFor();
    let k = 0;
    const small = r < 0.1; // cornrows: many little beads, kept light
    for (let s = 0; s <= len; s += r * (small ? 1.5 : 1.25), k++) {
      const t = Math.min(1, s / len), p = curve.getPointAt(t), tan = curve.getTangentAt(t);
      const rr = r * (1 - 0.35 * t);
      const g = new THREE.SphereGeometry(1, small ? 7 : 10, small ? 5 : 7).scale(rr, rr * 1.55, rr * 0.75);
      g.rotateZ((k % 2 ? 1 : -1) * 0.55);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), tan.clone().negate()));
      g.translate(p.x, p.y, p.z);
      parts.push(g);
    }
    this.add(merge(parts), color, pts[0], hangs);
    const end = curve.getPointAt(1);
    this.blob(end.add(curve.getTangentAt(1).multiplyScalar(r * 0.4)), r * 0.45, r * 0.3, r * 0.45, 'tie', hangs);
  }
}

function ball(at: THREE.Vector3, rx: number, ry: number, rz: number, seg = 12): THREE.BufferGeometry {
  return new THREE.SphereGeometry(1, seg, Math.round(seg * 0.67)).scale(rx, ry, rz).translate(at.x, at.y, at.z);
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [], nrm: number[] = [], idx: number[] = [];
  for (const g of parts) {
    const base = pos.length / 3;
    const p = g.attributes.position.array, n = g.attributes.normal.array;
    for (let i = 0; i < p.length; i++) { pos.push(p[i]); nrm.push(n[i]); }
    for (const i of g.index!.array) idx.push(base + i);
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  out.setIndex(idx);
  return out;
}

/** Wiggles a path side to side (across it, along the head's surface). */
function wave(pts: THREE.Vector3[], amp: number): THREE.Vector3[] {
  const curve = new THREE.CatmullRomCurve3(pts), out: THREE.Vector3[] = [];
  const n = 12;
  for (let i = 0; i <= n; i++) {
    const t = i / n, p = curve.getPointAt(t), tan = curve.getTangentAt(t);
    const side = new THREE.Vector3().crossVectors(tan, p).normalize();
    out.push(p.addScaledVector(side, amp * Math.sin(t * Math.PI * 3) * Math.min(1, t * 3)));
  }
  return out;
}

/**
 * A tube along a path, tapering from r0 to r1 with a rounded tip, flattened across the
 * head's radial direction so locks lie against it like molded hair.
 */
function taperTube(pts: THREE.Vector3[], r0: number, r1: number, flat: number, wide = 1): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(pts);
  const SEG = 12, RAD = 8, pos: number[] = [], idx: number[] = [];
  const T = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3(), p = new THREE.Vector3();
  for (let i = 0; i <= SEG; i++) {
    const t = i / SEG;
    curve.getPointAt(t, p);
    curve.getTangentAt(t, T);
    N.copy(p).normalize().addScaledVector(T, -T.dot(p.clone().normalize())).normalize(); // out from the head
    B.crossVectors(T, N);
    const r = r0 + (r1 - r0) * t;
    for (let j = 0; j < RAD; j++) {
      const a = (2 * Math.PI * j) / RAD;
      pos.push(p.x + (N.x * Math.cos(a) * flat + B.x * Math.sin(a) * wide) * r, p.y + (N.y * Math.cos(a) * flat + B.y * Math.sin(a) * wide) * r, p.z + (N.z * Math.cos(a) * flat + B.z * Math.sin(a) * wide) * r);
    }
  }
  // Caps: the root closes on itself; the tip rounds off past the end.
  const start = curve.getPointAt(0), end = curve.getPointAt(1).addScaledVector(curve.getTangentAt(1), r1 * 0.8);
  const s = pos.length / 3; pos.push(start.x, start.y, start.z);
  const e = s + 1; pos.push(end.x, end.y, end.z);
  for (let i = 0; i < SEG; i++) {
    for (let j = 0; j < RAD; j++) {
      const a = i * RAD + j, b = i * RAD + ((j + 1) % RAD), c = a + RAD, d = b + RAD;
      idx.push(a, c, b, b, c, d);
    }
  }
  for (let j = 0; j < RAD; j++) {
    idx.push(s, j, (j + 1) % RAD);
    const a = SEG * RAD + j, b = SEG * RAD + ((j + 1) % RAD);
    idx.push(a, e, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A path from the scalp along the head's surface, between two spots. */
function over(phi0: number, th0: number, phi1: number, th1: number, rad0 = 1.06, rad1 = 1.08, n = 5): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push(P(phi0 + (phi1 - phi0) * t, th0 + (th1 - th0) * t, rad0 + (rad1 - rad0) * t));
  }
  return out;
}

/** A path from the scalp down the side of the head and on down to height `yEnd`, flaring out by `flare`. */
function hang(phi: number, th0: number, yEnd: number, flare = 0.08): THREE.Vector3[] {
  const h = new THREE.Vector3(Math.sin(phi), 0, Math.cos(phi));
  const pts = [P(phi, th0, 1.04), P(phi, (th0 + 1.65) / 2, 1.08), P(phi, 1.75, 1.1)];
  const r = 1.1 * Math.sin(1.75);
  for (const [y, k] of [[(pts[2].y + yEnd) / 2, 0.5], [yEnd, 1]] as const) pts.push(h.clone().multiplyScalar(r + flare * k).setY(y));
  return pts;
}

// ---------------------------------------------------------------- the styles

function build(b: Builder, s: HairSpec): void {
  const rnd = seeded(HAIR_STYLES.indexOf(s.style) * 7919 + 13);
  const ps = s.part === 'left' ? 1 : s.part === 'right' ? -1 : 0; // which side the part is on (+x: its left)
  const sideSweep = ps || 1;
  // A fringe of short locks over the forehead.
  const fringe = (n: number, len: number, spread = 1.1) => {
    for (let i = 0; i < n; i++) {
      const phi = (i / (n - 1) - 0.5) * spread;
      b.lock(over(phi + 0.05 * sideSweep, 0.35, phi - 0.08 * sideSweep, FRONT + len, 1.06, 1.05, 3), 0.15, 0.08, i === Math.floor(n / 2) ? 'front' : 'lock', false, 0.4, 1.5);
    }
  };
  switch (s.style) {
    case 'buzz':
      b.shell({ vol: 0.012 });
      break;
    case 'short': // a classic side part, swept across
      b.shell({ vol: 0.05 });
      for (let i = 0; i < 6; i++) {
        const th = 0.15 + i * 0.14;
        b.lock(over(sideSweep * 0.55, th, -sideSweep * 0.75, th + 0.38, 1.07, 1.06, 4), 0.2, 0.07, i === 5 ? 'front' : 'lock');
      }
      break;
    case 'messy':
      b.shell({ vol: 0.06 });
      for (let i = 0; i < 16; i++) {
        const phi = (rnd() - 0.5) * 2 * Math.PI, th = 0.15 + rnd() * (phi * phi < 1 ? 0.6 : 1.1);
        const dir = P(phi + (rnd() - 0.5) * 1.2, th + 0.2 + rnd() * 0.4, 1);
        const a = P(phi, th, 1.05);
        b.lock([a, a.clone().lerp(dir.multiplyScalar(1.3), 0.5), dir.multiplyScalar(1.22 / 1.3)], 0.15, 0.04, i === 0 ? 'front' : 'lock');
      }
      break;
    case 'spiky':
      b.shell({ vol: 0.04 });
      for (let i = 0; i < 13; i++) {
        const phi = (i / 13) * 2 * Math.PI + rnd() * 0.3, th = i < 4 ? 0.12 + i * 0.1 : 0.45 + rnd() * 0.45;
        const a = P(phi, th, 1.04), tip = P(phi, th * 0.75 + 0.05, 1.42 + rnd() * 0.12);
        if (Math.cos(phi) > 0.7 && th > 0.5) tip.add(new THREE.Vector3(0, 0.1, 0.1));
        b.plainLock([a, a.clone().lerp(tip, 0.5), tip], 0.14, 0.01, i === 0 ? 'front' : 'lock', 1);
      }
      break;
    case 'slicked':
      b.shell({ vol: 0.09, front: 0.72 });
      for (let i = -3; i <= 3; i++) b.plainLock(over(i * 0.25, 0.75, i * 0.33, 1.9, 1.09, 1.05, 5), 0.12, 0.08, i === 0 ? 'front' : 'lock', 0.35, 1.9);
      break;
    case 'curtains': // a middle part, falling either side of the face
      b.shell({ vol: 0.06, side: 1.5 });
      for (const sg of [1, -1]) {
        for (let i = 0; i < 3; i++) b.lock(over(sg * (0.06 + i * 0.1), 0.25 + i * 0.08, sg * (0.85 + i * 0.12), 1.32 + i * 0.08, 1.07, 1.07, 5), 0.17, 0.07, i === 0 && sg === 1 ? 'front' : 'lock');
      }
      break;
    case 'crop': { // textured on top, a short fringe
      b.shell({ vol: 0.04 });
      const r = s.texture === 'coily' ? 0.11 : 0.14;
      for (let i = 0; i < 22; i++) {
        const phi = rnd() * 2 * Math.PI, th = Math.acos(1 - rnd() * 0.55);
        b.blob(P(phi, th, 1.04 + 0.02 * rnd()), r, r * 0.7, r, i === 0 ? 'front' : 'lock');
      }
      fringe(5, 0.08, 0.9);
      break;
    }
    case 'medium': // layered, to the jaw
      b.shell({ vol: 0.08, side: 1.55, back: 2.1 });
      b.drape({ gap: 0.8, yEnd: -0.5, grooves: 13, flare: 0.1 });
      fringe(5, 0.14);
      break;
    case 'bob': // smooth, to the chin, ends turned under
      b.shell({ vol: 0.1, side: 1.6, back: 2.15 });
      b.drape({ gap: 0.72, yEnd: -0.62, grooves: 18, flare: 0.14, tuck: true, out: 1.1 });
      fringe(6, 0.2, 1.2);
      break;
    case 'mullet': // short up top, long at the back
      b.shell({ vol: 0.05, back: 2.15 });
      fringe(4, 0.06, 0.8);
      b.drape({ gap: 2.0, yEnd: -1.3, from: 1.1, grooves: 16, flare: 0.06 });
      break;
    case 'long':
      b.shell({ vol: 0.08, side: 1.55, back: 2.15 });
      b.drape({ gap: 0.8, yEnd: -1.55, grooves: 12, flare: 0.16 });
      if (ps) b.lock(over(ps * 0.5, 0.2, -ps * 0.65, 1.0, 1.08, 1.07, 4), 0.2, 0.09, 'front'); // swept over from the part
      else fringe(5, 0.12, 0.9);
      break;
    case 'ponytail': {
      b.shell({ vol: 0.04 });
      const base = P(Math.PI, 1.05, 1.03);
      b.blob(base.clone().multiplyScalar(1.04), 0.13, 0.13, 0.08, 'tie');
      b.lock([base.clone().multiplyScalar(1.08), new THREE.Vector3(0, 0.12, -1.32), new THREE.Vector3(0, -0.45, -1.36), new THREE.Vector3(0, -1.05, -1.22)], 0.3, 0.09, 'front', true, 0.75, 1.25);
      break;
    }
    case 'bun':
      b.shell({ vol: 0.04 });
      b.blob(P(Math.PI, 0.55, 1.22), 0.4, 0.36, 0.36, 'front');
      b.lock(over(Math.PI - 0.6, 0.45, Math.PI + 0.6, 0.65, 1.42, 1.42, 6), 0.09, 0.05); // a wrap round it
      break;
    case 'topknot':
      b.shell({ vol: 0.04, front: 0.7 });
      b.blob(P(0, 0.05, 1.17), 0.3, 0.27, 0.3, 'front');
      b.blob(P(0, 0.05, 1.03), 0.2, 0.08, 0.2, 'tie');
      break;
    case 'manbun':
      b.shell({ vol: 0.05 });
      b.blob(P(Math.PI, 0.85, 1.25), 0.3, 0.27, 0.27, 'front');
      b.blob(P(Math.PI, 0.85, 1.06), 0.13, 0.13, 0.06, 'tie');
      break;
    case 'pigtails': // two braids
      b.shell({ vol: 0.04, side: 1.5 });
      for (const sg of [1, -1]) {
        const root = P(sg * Math.PI / 2, 1.25, 1.06);
        b.braid([root, P(sg * 1.75, 1.6, 1.18), new THREE.Vector3(sg * 1.05, -0.65, -0.2), new THREE.Vector3(sg * 0.95, -1.25, -0.15)], 0.15);
      }
      fringe(5, 0.1, 1);
      break;
    case 'braid': // one, down the back
      b.shell({ vol: 0.05, back: 2.0 });
      b.braid([P(Math.PI, 1.6, 1.07), new THREE.Vector3(0, -0.55, -1.15), new THREE.Vector3(0, -1.0, -1.13), new THREE.Vector3(0, -1.45, -1.05)], 0.17);
      break;
    case 'cornrows':
      b.shell({ vol: 0.01 });
      for (let i = -3; i <= 3; i++) {
        const pts = over(i * 0.2, FRONT, i * 0.26, BACK + 0.05, 1.03, 1.03, 6);
        b.braid(pts, 0.07, false);
      }
      break;
    case 'locs':
      b.shell({ vol: 0.07 });
      for (let i = 0; i < 22; i++) {
        const phi = 0.7 + (i / 21) * (2 * Math.PI - 1.4);
        b.plainLock(hang(phi > Math.PI ? phi - 2 * Math.PI : phi, 0.3 + 0.25 * rnd(), -1.0 - 0.25 * rnd(), 0.12), 0.14, 0.12, i === 8 ? 'front' : 'lock', 0.95, 1, true);
      }
      break;
    case 'afro': {
      b.shell({ vol: 0.08 });
      const r = s.texture === 'coily' || s.texture === 'straight' ? 0.36 : 0.4;
      for (let i = 0; i < 48; i++) {
        const phi = (i * 2.39996) % (2 * Math.PI), th = Math.acos(1 - (i / 47) * 1.5);
        if (Math.cos(phi) > 0.5 && th > 0.95) continue; // the face stays clear
        b.blob(P(phi, th, 1.22 + 0.06 * rnd()), r, r * 0.92, r, i === 0 ? 'front' : 'lock');
      }
      break;
    }
    case 'curly':
      b.shell({ vol: 0.06, side: 1.5 });
      for (let i = 0; i < 34; i++) {
        const phi = (i * 2.39996) % (2 * Math.PI), th = Math.acos(1 - (i / 33) * 1.25);
        if (Math.cos(phi) > 0.6 && th > 0.75) continue;
        const r = 0.2 + 0.05 * rnd();
        b.blob(P(phi, th, 1.1), r, r, r, i === 0 ? 'front' : 'lock');
      }
      break;
    case 'tufts': // an elder's: bald on top, tufts over the ears, a band round the back
      b.shell({ vol: 0.03, from: 1.3, side: 1.65, back: 1.95, minPhi: 1.2 });
      for (const sg of [1, -1]) {
        for (let k = 0; k < 3; k++) b.blob(P(sg * (1.45 + 0.22 * k), 1.38 + 0.08 * k, 1.07), 0.17, 0.14, 0.13, k === 0 && sg === 1 ? 'front' : 'lock');
      }
      break;
  }
}

// ---------------------------------------------------------------- the hair on a head

export class Hair {
  readonly mesh: THREE.Mesh;
  private readonly rest: Float32Array;
  /** Which goo vertex each vertex rides (−1: none), and how much it hangs (world units). */
  private readonly ride: Int32Array;
  private readonly hangLen: Float32Array;
  private readonly sway: Float32Array;
  private readonly prev = new THREE.Vector3();
  private readonly lag = new THREE.Vector3();
  private readonly lagVel = new THREE.Vector3();
  private readonly qInv = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly v = new THREE.Vector3();
  private readonly down = new THREE.Vector3();
  private started = false;
  readonly empty: boolean;

  /**
   * @param R the head's radius (world units); the hair is built in the head bone's frame.
   * @param goo the head it rides (null: it doesn't ride, as in the face lab).
   * @param underHat build only what a hat leaves showing.
   * @param skin the body colour (a fade shades off to it).
   */
  constructor(spec: HairSpec, private readonly R: number, private readonly goo: GooHead | null, underHat = false, skin = '#ffcb00') {
    const b = new Builder(spec, underHat, new THREE.Color(skin));
    build(b, spec);
    let count = 0, indices = 0;
    for (const pc of b.pieces) { count += pc.geo.attributes.position.count; indices += pc.geo.index!.count; }
    this.empty = count === 0;
    const pos = new Float32Array(count * 3), nrm = new Float32Array(count * 3), col = new Float32Array(count * 3);
    const idx = new Uint32Array(indices);
    this.ride = new Int32Array(count).fill(-1);
    this.hangLen = new Float32Array(count);
    this.sway = new Float32Array(count);
    let v0 = 0, i0 = 0;
    const tmp = new THREE.Vector3();
    for (const pc of b.pieces) {
      const g = pc.geo, n = g.attributes.position.count;
      const gp = g.attributes.position.array, gn = g.attributes.normal.array, gc = g.attributes.color?.array;
      const rootRide = goo && pc.root ? goo.nearestVertex(pc.root) : -1;
      for (let k = 0; k < n; k++) {
        const x = gp[k * 3], y = gp[k * 3 + 1], z = gp[k * 3 + 2];
        pos.set([x * R, y * R, z * R], (v0 + k) * 3);
        nrm.set([gn[k * 3], gn[k * 3 + 1], gn[k * 3 + 2]], (v0 + k) * 3);
        if (gc) col.set([gc[k * 3], gc[k * 3 + 1], gc[k * 3 + 2]], (v0 + k) * 3);
        else col.set([pc.color.r, pc.color.g, pc.color.b], (v0 + k) * 3);
        if (goo) this.ride[v0 + k] = pc.root ? rootRide : goo.nearestVertex(tmp.set(x, y, z));
        if (pc.hangs) {
          const below = Math.max(0, -y - 0.05);
          this.hangLen[v0 + k] = below * R;
          this.sway[v0 + k] = Math.min(1, below / 1.2);
        }
      }
      const gi = g.index!.array;
      for (let k = 0; k < gi.length; k++) idx[i0 + k] = gi[k] + v0;
      v0 += n; i0 += gi.length;
      g.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere();
    if (geo.boundingSphere) geo.boundingSphere.radius *= 1.3;
    this.rest = new Float32Array(pos);
    // Molded, satin like the body, a little shinier.
    this.mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.48, metalness: 0, side: THREE.DoubleSide }));
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
  }

  get vertexCount(): number { return this.rest.length / 3; }

  /**
   * Once per rendered frame (when the tenant's close enough to see it): follow the goo,
   * and let hanging hair swing behind the head's motion and keep hanging down.
   * `head` is the head bone (the hair's parent).
   */
  update(dt: number, head: THREE.Object3D): void {
    head.getWorldQuaternion(this.qInv).invert();
    head.getWorldPosition(this.p);
    if (!this.started) { this.prev.copy(this.p); this.started = true; }
    this.v.copy(this.p).sub(this.prev).divideScalar(Math.max(1e-3, dt)).applyQuaternion(this.qInv);
    this.prev.copy(this.p);
    // A soft spring trailing the head's motion (in the head's frame).
    const target = this.v.multiplyScalar(-0.035);
    if (target.length() > 0.3 * this.R) target.setLength(0.3 * this.R);
    const k = 70, c = 2 * 0.4 * Math.sqrt(k);
    this.lagVel.addScaledVector(target.sub(this.lag), k * dt).addScaledVector(this.lagVel, -c * dt);
    this.lag.addScaledVector(this.lagVel, dt);
    // Which way is down, in the head's frame, compared with down when it's upright.
    this.down.set(0, -1, 0).applyQuaternion(this.qInv);
    const gx = this.down.x, gy = this.down.y + 1, gz = this.down.z;

    const pos = this.mesh.geometry.attributes.position as THREE.BufferAttribute;
    const a = pos.array as Float32Array, rest = this.rest, u = this.goo?.offset;
    const lx = this.lag.x, ly = this.lag.y, lz = this.lag.z;
    for (let i = 0, n = rest.length / 3; i < n; i++) {
      const o = i * 3;
      let x = rest[o], y = rest[o + 1], z = rest[o + 2];
      const r = this.ride[i];
      if (u && r >= 0) { x += u[r * 3]; y += u[r * 3 + 1]; z += u[r * 3 + 2]; }
      const h = this.hangLen[i];
      if (h > 0) {
        const w = this.sway[i];
        x += lx * w + gx * h * 0.85; y += ly * w + gy * h * 0.85; z += lz * w + gz * h * 0.85;
      }
      a[o] = x; a[o + 1] = y; a[o + 2] = z;
    }
    pos.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
