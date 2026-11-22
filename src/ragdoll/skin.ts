import * as THREE from 'three';
import { FACE, SKIN } from './config';
import { blendedSkin, type Shape } from './blendskin';
import type { BodyDims, FaceShape } from './proportions';
import { NEUTRAL, type FaceLetter, type Letters } from './mood';
import type { GooHead } from './goo';

/*
 * The character's skin: one smooth mesh draped over the physics skeleton.
 *
 * Every part (body, legs, fins, head) is a surface of revolution drawn from a
 * radius profile in config.ts, built in the skeleton's rest pose. Each vertex is
 * bound to the one or two bones nearest it, with the weights blended across each
 * joint, so when the physics bends a joint the skin bends smoothly over it instead
 * of showing separate capsules. All ragdolls share this one geometry.
 */

/** Which bone (by index into the skeleton) each named part is. Supplied by the ragdoll. */
export type BoneIndex = (part: string) => number;

type Influence = [number, number, number, number];

/** Blend from bone `a` (below) to bone `b` (above) across `at ± half` in height. */
function blendAcross(a: number, b: number, y: number, at: number, half: number): Influence {
  const t = THREE.MathUtils.smoothstep(y, at - half, at + half);
  return [a, b, 1 - t, t];
}

/** Skins by body dimensions, shared by every ragdoll of that shape, with a count of users. */
const skins = new Map<string, { geometry: THREE.BufferGeometry; users: number }>();

/**
 * The skin for a body of these dimensions: shared by every ragdoll of the same shape.
 * Call releaseSkin with the same dims when the ragdoll goes away.
 */
export function acquireSkin(bone: BoneIndex, dims: BodyDims): THREE.BufferGeometry {
  let entry = skins.get(dims.key);
  if (!entry) {
    entry = { geometry: buildSkin(bone, dims), users: 0 };
    skins.set(dims.key, entry);
  }
  entry.users++;
  return entry.geometry;
}

export function releaseSkin(dims: BodyDims): void {
  const entry = skins.get(dims.key);
  if (!entry) return;
  if (--entry.users <= 0) {
    entry.geometry.dispose();
    skins.delete(dims.key);
  }
}

/**
 * The rest-pose skin: belly, legs, fins and butt cheeks as one blended surface
 * (blendskin.ts), each limb melting into the body with a soft fillet.
 */
function buildSkin(bone: BoneIndex, B: BodyDims): THREE.BufferGeometry {
  const belly = bone('torso');
  const chest = bone('chest');
  const shapes: Shape[] = [];
  const size = B.bellyR / 0.089; // fillets and cells scale with the body
  shapes.push({
    profile: B.skin.body, cx: 0, cz: 0, yOffset: 0, squashZ: 1, group: 'body', blend: 0, region: 0,
    influence: (y) => blendAcross(belly, chest, y, B.spineY, 0.05),
  });
  for (const [side, sx] of [['L', 1], ['R', -1]] as const) {
    const thigh = bone(`thigh${side}`);
    const shin = bone(`shin${side}`);
    const kneeY = B.hipY - B.thighLen;
    // Legs: shin at the tip, thigh in the middle, melting into the belly at the hip.
    shapes.push({
      profile: B.skin.leg, cx: sx * B.hipX, cz: 0, yOffset: 0, squashZ: 1, group: 'limb', blend: 0.03 * size, region: 1,
      root: { x: sx * B.hipX, y: B.hipY, z: 0, radius: 0.05 * size },
      influence: (y) => y > (B.hipY + kneeY) / 2
        ? blendAcross(thigh, belly, y, B.hipY, 0.03)
        : blendAcross(shin, thigh, y, kneeY, 0.03),
    });
    const upper = bone(`upperArm${side}`);
    const fore = bone(`forearm${side}`);
    const elbowY = B.shoulderY - B.upperArmLen;
    // Fins: forearm at the tip, upper arm above the elbow, rooted in the chest. Built
    // swung out from the shoulder so they don't melt into the belly's sides.
    shapes.push({
      profile: B.skin.arm, cx: sx * B.shoulderX, cz: 0, yOffset: B.shoulderY, squashZ: SKIN.armThickness,
      group: 'limb', blend: 0.018 * size, region: 2,
      swing: { px: sx * B.shoulderX, py: B.shoulderY, angle: sx * SKIN.finSplay, bones: [upper, fore] },
      root: { x: sx * B.shoulderX, y: B.shoulderY, z: 0, radius: 0.03 * size },
      influence: (y) => y > (B.shoulderY + elbowY) / 2
        ? blendAcross(upper, chest, y, B.shoulderY, 0.02)
        : blendAcross(fore, upper, y, elbowY, 0.05),
    });
  }
  // Butt: two round cheeks low on the back, on their own springy bone so they jiggle.
  const C = B.cheeks;
  if (C.r > 0) {
    const butt = bone('butt');
    const R = C.r;
    const ball: [number, number][] = [];
    for (let i = 0; i <= 12; i++) {
      const t = Math.PI * (i / 12 - 0.5);
      ball.push([Math.sin(t) * R * 0.95, Math.cos(t) * R]);
    }
    for (const sx of [1, -1]) {
      shapes.push({
        profile: ball, cx: sx * C.x, cz: C.z, yOffset: C.y, squashZ: 0.9, group: 'limb', blend: 0.6 * R, region: 3,
        influence: () => [butt, belly, 0.85, 0.15],
      });
    }
  }
  return blendedSkin(shapes, 0.006 * size, bone('__count'));
}

// ---- The face: shapes drawn on the head that change shape rather than swap ----
/*
 * Each piece of the face (an eye, the mouth, a brow) is one outline drawn onto the head:
 * a top edge and a bottom edge, sampled at the same points across. Expressions only move
 * those edges, so a blink is the lid coming down, smile ↔ line ↔ frown is one mouth
 * bending, and an "o" is that same mouth dropping open. Nothing pops in or out: brows and
 * blush fade in, the tongue slides out from under the lip, the sparkle hides under the lid.
 */

const INK = 0x14141c;
/** Drawn just above the head and pulled forward in depth, so the goo never covers it. */
const decal = (factor: number) => ({ side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: factor, polygonOffsetUnits: 2 * factor });
const inkMaterial = new THREE.MeshStandardMaterial({ color: INK, roughness: 0.22, ...decal(-2) });
const tongueMaterial = new THREE.MeshStandardMaterial({ color: 0xff6f91, roughness: 0.5, ...decal(-1) });
const glintMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, ...decal(-3) });
/** Icon eyes (love, starstruck) and the open mouth's insides. */
const heartMaterial = new THREE.MeshStandardMaterial({ color: 0xff3358, roughness: 0.3, ...decal(-2) });
const starMaterial = new THREE.MeshStandardMaterial({ color: 0xfff4c2, roughness: 0.4, ...decal(-2) });
const insideMaterial = new THREE.MeshStandardMaterial({ color: 0xff6f86, roughness: 0.5, ...decal(-3) });
const teethMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, ...decal(-3) });
const inkOverMaterial = new THREE.MeshStandardMaterial({ color: INK, roughness: 0.22, ...decal(-4) });
/**
 * How far above the head each layer is drawn: blush under the tongue under the ink, the
 * mouth's insides (tongue, teeth) on the ink, then their lines and the eye's sparkle.
 */
const LIFT = { blush: 0.0015, tongue: 0.0022, ink: 0.003, inside: 0.0033, over: 0.0036, glint: 0.0036 };

/** A thin bar along +x starting at its origin, for lashes (so it can be rotated about its root). */
const lashGeometry = new THREE.CapsuleGeometry(0.5, 1, 2, 5).rotateZ(Math.PI / 2).translate(0.75, 0, 0);
/** Where on each eye's top edge the lashes grow (radians from "outward", toward "up"), and how long each is. */
const LASHES = [[0.35, 0.8], [0.75, 1], [1.15, 0.85]] as const;
const DEFAULT_FACE: FaceShape = { eyeSize: 1, eyeSpacing: 1, eyeHeight: 0, lashes: 0, blush: 0, mouthWidth: 1 };
const MOUTH_Y = -0.058;
/** The open eye's half-sizes, before the character's eye size. */
const EYE = { w: 0.024, h: 0.054 }; // tall glossy ovals, as on the reference sheet

/** Icons drawn in an eye's place (by the face letters of the same name). */
const ICONS = ['squeeze', 'heartEyes', 'starEyes', 'spiralEyes'] as const;
type Icon = (typeof ICONS)[number];
/** Samples round an icon: 30 puts the star's ten corners on samples. */
const NI = 30;
/** Scratch path for ribbons (no allocation per frame). */
const PX = new Float32Array(NI + 1), PY = new Float32Array(NI + 1), PT = new Float32Array(NI + 1);
/** Thin bar for the gaps between teeth: unit half-length along y. */
const toothGapGeometry = new THREE.CapsuleGeometry(0.5, 1, 2, 5).scale(1, 1 / 2, 1);

/**
 * Lays a stroke of half-thickness PT[i] along the path PX/PY (n+1 points): its two edges
 * are the path pushed out either side along the path's normal. `closed` joins the ends.
 */
function ribbon(o: Outline, n: number, closed: boolean): void {
  for (let i = 0; i <= n; i++) {
    const a = i > 0 ? i - 1 : closed ? n - 1 : 0, b = i < n ? i + 1 : closed ? 1 : n;
    let dx = PX[b] - PX[a], dy = PY[b] - PY[a];
    const l = Math.hypot(dx, dy) || 1;
    dx /= l; dy /= l;
    o.tx[i] = PX[i] - dy * PT[i]; o.ty[i] = PY[i] + dx * PT[i];
    o.bx[i] = PX[i] + dy * PT[i]; o.by[i] = PY[i] - dx * PT[i];
  }
}

/** The star icon's outline, sample i of NI, around (cx, cy) with outer radius R. */
function starPoint(i: number, cx: number, cy: number, R: number): void {
  const c0 = Math.floor(i / 3), f = (i % 3) / 3;
  const corner = (c: number, k: 0 | 1) => {
    const r = c % 2 === 0 ? R : 0.47 * R, a = Math.PI / 2 + (c * Math.PI) / 5;
    return k === 0 ? cx + r * Math.cos(a) : cy + r * Math.sin(a);
  };
  PX[i] = corner(c0, 0) + (corner(c0 + 1, 0) - corner(c0, 0)) * f;
  PY[i] = corner(c0, 1) + (corner(c0 + 1, 1) - corner(c0, 1)) * f;
}

/** Samples across a shape (−1..1), bunched toward the ends so they stay round. */
const N = 16;
const U = Float32Array.from({ length: N + 1 }, (_, i) => -Math.cos((Math.PI * i) / N));
/** The height of a unit circle at each sample: an ellipse's profile. */
const E = Float32Array.from(U, (u) => Math.sqrt(Math.max(0, 1 - u * u)));
/**
 * Rows from the top edge down to the bottom one: tall shapes need a few, or their middle
 * cuts a straight chord under the round head and the skin shows through.
 */
const ROWS = 3;
/** Triangles row by row: vertex (row j, sample i) is j·(n+1) + i, row 0 the top edge. Cached per n. */
const OUTLINE_INDEX = new Map<number, number[]>();
function outlineIndex(n: number): number[] {
  let idx = OUTLINE_INDEX.get(n);
  if (!idx) {
    idx = [];
    for (let j = 0; j < ROWS; j++) {
      for (let i = 0; i < n; i++) {
        const t = j * (n + 1) + i, b = t + n + 1;
        idx.push(t, b, t + 1, t + 1, b, b + 1);
      }
    }
    OUTLINE_INDEX.set(n, idx);
  }
  return idx;
}

/**
 * Half-thickness of a stroke with round ends at `u` along it: `th` through the middle,
 * closing in a half circle over the last `th` of its half-length `half`.
 */
function stroke(u: number, th: number, half: number): number {
  const rho = Math.min(1, th / Math.max(half, 1e-6));
  const over = Math.abs(u) - (1 - rho);
  if (over <= 0) return th;
  const t = over / rho;
  return th * Math.sqrt(Math.max(0, 1 - t * t));
}

/**
 * One piece of the face: a filled outline between a top and a bottom edge (N+1 points
 * each, in face coordinates), wrapped onto the head and redrawn whenever it changes.
 */
class Outline {
  readonly mesh: THREE.Mesh;
  readonly tx: Float32Array;
  readonly ty: Float32Array;
  readonly bx: Float32Array;
  readonly by: Float32Array;
  private readonly pos: THREE.BufferAttribute;
  private readonly nrm: THREE.BufferAttribute;

  /** @param n samples across, less one (the eyes, brows and mouth use N; icons more). */
  constructor(material: THREE.Material, private readonly lift: number, readonly n = N) {
    this.tx = new Float32Array(n + 1);
    this.ty = new Float32Array(n + 1);
    this.bx = new Float32Array(n + 1);
    this.by = new Float32Array(n + 1);
    const g = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array((ROWS + 1) * (n + 1) * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.nrm = new THREE.BufferAttribute(new Float32Array((ROWS + 1) * (n + 1) * 3), 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.pos);
    g.setAttribute('normal', this.nrm);
    g.setIndex(outlineIndex(n));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 0.1);
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.frustumCulled = false;
  }

  /** Writes the edges onto the head (radius r), relative to the mesh's spot at (cx, cy). */
  commit(cx: number, cy: number, r: number): void {
    const cz = surfaceZ(cx, cy, r);
    const n = this.n;
    for (let j = 0; j <= ROWS; j++) {
      const t = j / ROWS;
      for (let i = 0; i <= n; i++) {
        const x = this.tx[i] + (this.bx[i] - this.tx[i]) * t, y = this.ty[i] + (this.by[i] - this.ty[i]) * t;
        const xy = x * x + y * y, z = xy < r * r ? Math.sqrt(r * r - xy) : 0;
        const len = xy < r * r ? r : Math.sqrt(xy) || 1; // on the sphere, the radius
        const nx = x / len, ny = y / len, nz = z / len, k = j * (n + 1) + i;
        this.pos.setXYZ(k, x + nx * this.lift - cx, y + ny * this.lift - cy, z + nz * this.lift - cz);
        this.nrm.setXYZ(k, nx, ny, nz);
      }
    }
    this.pos.needsUpdate = true;
    this.nrm.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
  }
}

/** Height of the head's front surface above (x, y). */
function surfaceZ(x: number, y: number, r: number): number {
  return Math.sqrt(Math.max(0, r * r - x * x - y * y));
}

/**
 * A soft rosy patch on the cheek: solid in the middle, fading out at the rim. Built once,
 * wrapped onto the head at (cx, cy).
 */
function blushPatch(cx: number, cy: number, r: number): THREE.BufferGeometry {
  const RX = 0.03, RY = 0.019, SEG = 20;
  const rings = [[0, 0.9], [0.55, 0.75], [1, 0]] as const; // [radius share, opacity]
  const pos: number[] = [], nrm: number[] = [], col: number[] = [], idx: number[] = [];
  const cz = surfaceZ(cx, cy, r);
  for (const [k, a] of rings) {
    const n = k === 0 ? 1 : SEG;
    for (let s = 0; s < n; s++) {
      const t = (2 * Math.PI * s) / SEG;
      const x = cx + RX * k * Math.cos(t), y = cy + RY * k * Math.sin(t), z = surfaceZ(x, y, r);
      const len = Math.hypot(x, y, z);
      pos.push(x + (x / len) * LIFT.blush - cx, y + (y / len) * LIFT.blush - cy, z + (z / len) * LIFT.blush - cz);
      nrm.push(x / len, y / len, z / len);
      col.push(1, 1, 1, a);
    }
  }
  for (let s = 0; s < SEG; s++) {
    const s1 = (s + 1) % SEG;
    idx.push(0, 1 + s, 1 + s1);
    const a = 1 + s, b = 1 + s1, c = 1 + SEG + s, d = 1 + SEG + s1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  g.setIndex(idx);
  return g;
}

interface Eye {
  ink: Outline; glint: Outline; x: number; y: number; side: number;
  /** An icon in the eye's place: its filled shape and its ink line (either may be unused). */
  icon: Outline; iconLine: Outline;
  /** A frame lying flat on the face at the eye's centre, holding its lashes. */
  lashFrame: THREE.Group; lashes: THREE.Mesh[];
}

/**
 * The face, as in the drawing: tall oval eyes and a small smile on the +z side of the
 * head. It rides on the head bone, so positions are relative to the head's centre.
 *
 * It's driven by the face letters (see mood.ts): smile, mouthOpen, eyeOpen, brows, gaze,
 * blush, and the concentrating ones (lopsided, mouthShift, tongue), plus `awake` (0 = out
 * cold: eyes shut to curves, the jaw slack), which overrides the rest as it drops.
 */
export class Face {
  readonly root = new THREE.Group();
  private readonly shape: FaceShape;
  private readonly r: number;
  /**
   * Which side this face favours when it goes lopsided (+1 or −1): the eye that squints
   * harder and the corner the mouth slides to. Each tenant has its own.
   */
  private readonly side: number;
  private readonly eyes: Eye[] = [];
  private readonly brows: { ink: Outline; x: number; y: number; side: number }[] = [];
  private readonly cheeks: THREE.Mesh[] = [];
  private readonly mouth: Outline;
  private readonly tongue: Outline;
  /** The open mouth's pink inside (a tongue at the bottom of a grin). */
  private readonly inside: Outline;
  /** A grimace's gritted teeth: the white band, the line between the rows, and the gaps. */
  private readonly teeth: Outline;
  private readonly teethLine: Outline;
  private readonly toothGaps: THREE.Mesh[] = [];
  /** This face's own, so its brows and blush can fade without touching anyone else's. */
  private readonly browMaterial: THREE.MeshStandardMaterial;
  private readonly blushMaterial: THREE.MeshStandardMaterial;
  /**
   * Where each piece sits before the goo moves it: set when placed, and every frame for
   * the ones that move about the face (eyes with the gaze, brows, the mouth).
   */
  private readonly bases = new Map<THREE.Object3D, THREE.Vector3>();
  /** The goo surface the pieces ride on, which vertex each one rides, and the face's scale. */
  private goo: GooHead | null = null;
  private readonly riding = new Map<THREE.Object3D, number>();
  private gooScale = 1;

  constructor(r: number, shape: FaceShape = DEFAULT_FACE, side = 1) {
    this.shape = shape;
    this.side = side < 0 ? -1 : 1;
    this.r = r;
    this.browMaterial = new THREE.MeshStandardMaterial({ color: INK, roughness: 0.55, transparent: true, ...decal(-2) });
    this.blushMaterial = new THREE.MeshStandardMaterial({
      color: 0xff7aa2, roughness: 0.8, transparent: true, vertexColors: true, depthWrite: false, ...decal(-1),
    });
    const anchor = (obj: THREE.Object3D, x: number, y: number) => {
      obj.position.set(x, y, surfaceZ(x, y, r));
      this.root.add(obj);
      this.bases.set(obj, obj.position.clone());
    };
    const eyeY = 0.02 + shape.eyeHeight * r;
    for (const sx of [1, -1]) {
      const x = sx * 0.072 * shape.eyeSpacing;
      const ink = new Outline(inkMaterial, LIFT.ink);
      anchor(ink.mesh, x, eyeY);
      const glint = new Outline(glintMaterial, LIFT.glint);
      anchor(glint.mesh, x, eyeY);
      const lashFrame = new THREE.Group();
      anchor(lashFrame, x, eyeY);
      lashFrame.lookAt(lashFrame.position.clone().multiplyScalar(2)); // flat on the face
      const lashes = LASHES.map(() => new THREE.Mesh(lashGeometry, inkMaterial));
      for (const l of lashes) lashFrame.add(l);
      const icon = new Outline(heartMaterial, LIFT.ink, NI);
      anchor(icon.mesh, x, eyeY);
      const iconLine = new Outline(inkOverMaterial, LIFT.over, NI);
      anchor(iconLine.mesh, x, eyeY);
      this.eyes.push({ ink, glint, x, y: eyeY, side: sx, lashFrame, lashes, icon, iconLine });

      // Blush: a soft rosy patch on each cheek, below and outside the eye.
      const cx = sx * 0.112 * shape.eyeSpacing, cy = eyeY - 0.066;
      const cheek = new THREE.Mesh(blushPatch(cx, cy, r), this.blushMaterial);
      anchor(cheek, cx, cy);
      this.cheeks.push(cheek);

      // Brows: hidden unless a mood or reaction shows them (the drawing has none).
      const brow = new Outline(this.browMaterial, LIFT.ink);
      const bx = sx * 0.07 * shape.eyeSpacing, by = eyeY + 0.068 * shape.eyeSize;
      anchor(brow.mesh, bx, by);
      this.brows.push({ ink: brow, x: bx, y: by, side: sx });
    }
    this.mouth = new Outline(inkMaterial, LIFT.ink);
    anchor(this.mouth.mesh, 0, MOUTH_Y);
    this.tongue = new Outline(tongueMaterial, LIFT.tongue);
    anchor(this.tongue.mesh, 0, MOUTH_Y);
    this.inside = new Outline(insideMaterial, LIFT.inside);
    anchor(this.inside.mesh, 0, MOUTH_Y);
    this.teeth = new Outline(teethMaterial, LIFT.inside);
    anchor(this.teeth.mesh, 0, MOUTH_Y);
    this.teethLine = new Outline(inkOverMaterial, LIFT.over);
    anchor(this.teethLine.mesh, 0, MOUTH_Y);
    for (let k = 0; k < 3; k++) {
      const gap = new THREE.Mesh(toothGapGeometry, inkOverMaterial);
      this.teeth.mesh.add(gap);
      this.toothGaps.push(gap);
    }
    this.setExpression(1, NEUTRAL);
  }

  /**
   * Rides the face on a goo head: each piece follows the goo vertex under it, so the
   * face smears, flattens and sloshes with the glop. `scale` is the face's own scale
   * (the goo moves in real units; the face is laid out for the drawn head).
   */
  pinTo(goo: GooHead, scale: number): void {
    this.goo = goo;
    this.gooScale = scale;
    this.riding.clear();
    for (const [obj, base] of this.bases) this.riding.set(obj, goo.nearestVertex(base));
    this.followSurface();
  }

  /** Puts every piece at its base spot plus the goo's offset there. */
  followSurface(): void {
    const u = this.goo?.offset;
    for (const [obj, base] of this.bases) {
      obj.position.copy(base);
      const i = u ? this.riding.get(obj) : undefined;
      if (u && i !== undefined) {
        obj.position.x += u[3 * i] / this.gooScale;
        obj.position.y += u[3 * i + 1] / this.gooScale;
        obj.position.z += u[3 * i + 2] / this.gooScale;
      }
    }
  }

  dispose(): void {
    for (const e of this.eyes) { e.ink.dispose(); e.glint.dispose(); e.icon.dispose(); e.iconLine.dispose(); }
    this.inside.dispose();
    this.teeth.dispose();
    this.teethLine.dispose();
    for (const b of this.brows) b.ink.dispose();
    for (const c of this.cheeks) c.geometry.dispose();
    this.mouth.dispose();
    this.tongue.dispose();
    this.browMaterial.dispose();
    this.blushMaterial.dispose();
  }

  /** Feelings only show while it's awake: each letter blends back toward neutral as it drops. */
  private alert = 1;
  private letters: Letters = NEUTRAL;
  private readonly letter = (k: FaceLetter) => NEUTRAL[k] + (this.letters[k] - NEUTRAL[k]) * this.alert;

  /** The mouth's current shape, set in setExpression and read by lip(). */
  private readonly mouthShape = { depth: 0, Ho: 0, lift: 0.25, line: 0, W: 1, box: 0, wavy: 0 };

  /**
   * The mouth's top (side +1) or bottom (−1) edge at u (−1..1) across it, before tilting:
   * the curve of the smile, the stroke's thickness, the opening (oval, or boxy for a
   * grimace) and the wobble.
   */
  private lip(u: number, side: 1 | -1): number {
    const m = this.mouthShape;
    const e = Math.sqrt(Math.max(0, 1 - u * u));
    const open = m.box > 0 ? e + (Math.pow(e, 0.25) - e) * m.box : e;
    const base = m.depth * (u * u - 0.5) + m.wavy * 0.0035 * Math.sin(3 * Math.PI * u);
    return side > 0
      ? base + stroke(u, m.line, m.W) + m.lift * m.Ho * open
      : base - stroke(u, m.line, m.W) - m.Ho * open;
  }

  /** Redraws an outline whose edges are filled in, anchored at (cx, cy). */
  private draw(o: Outline, cx: number, cy: number): void {
    this.bases.get(o.mesh)!.set(cx, cy, surfaceZ(cx, cy, this.r));
    o.commit(cx, cy, this.r);
  }

  /**
   * An icon in an eye's place, grown to `amt` (with a little pop past full size on the
   * way): a red heart, an outlined star, a dizzy spiral, or a screwed-shut chevron.
   */
  private drawIcon(e: Eye, icon: Icon, amt: number, cx: number, cy: number, es: number): void {
    const f = e.icon, ln = e.iconLine;
    const show = amt > 0.02;
    const pop = amt * (1 + 0.3 * Math.sin(Math.PI * Math.min(1, amt)));
    const R = EYE.h * es * pop;
    const fill = show && (icon === 'heartEyes' || icon === 'starEyes');
    const line = show && icon !== 'heartEyes';
    f.mesh.visible = fill;
    ln.mesh.visible = line;
    if (!show) return;
    const lw = FACE.line * es * 1.2 * Math.min(1, pop);
    if (icon === 'heartEyes') {
      // The classic heart curve (32 wide, 29 tall), as a fan from a point inside it.
      const k = (0.92 * R) / 17;
      for (let i = 0; i <= NI; i++) {
        const t = (2 * Math.PI * i) / NI, st = Math.sin(t);
        f.tx[i] = cx + 16 * st * st * st * k;
        f.ty[i] = cy + (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t) + 2.5) * k;
        f.bx[i] = cx; f.by[i] = cy;
      }
      f.mesh.material = heartMaterial;
      this.draw(f, cx, cy);
      return;
    }
    if (icon === 'starEyes') {
      // Clockwise (like the heart), so the fan faces out of the head and catches the light.
      for (let i = 0; i <= NI; i++) { starPoint((NI - i) % NI, cx, cy, 1.05 * R); PT[i] = lw; f.tx[i] = PX[i]; f.ty[i] = PY[i]; f.bx[i] = cx; f.by[i] = cy; }
      f.mesh.material = starMaterial;
      this.draw(f, cx, cy);
      ribbon(ln, NI, true);
    } else if (icon === 'spiralEyes') {
      // Two and a quarter turns out from the middle, mirrored between the eyes.
      for (let i = 0; i <= NI; i++) {
        const u = i / NI, a = e.side * u * 2.25 * 2 * Math.PI;
        PX[i] = cx + 0.8 * R * u * Math.cos(a);
        PY[i] = cy + 0.8 * R * u * Math.sin(a);
        PT[i] = stroke(2 * u - 1, lw, 0.05);
      }
      ribbon(ln, NI, false);
    } else {
      // Squeezed shut: a chevron pointing in toward the middle of the face (> <).
      const inward = -e.side, h = 0.62 * R, half = 0.45 * R;
      for (let i = 0; i <= NI; i++) {
        const u = i / NI, v = u < 0.5 ? u * 2 : (1 - u) * 2; // 0 at the ends … 1 at the tip
        PX[i] = cx + inward * half * (2 * v - 1);
        PY[i] = cy + h * (1 - 2 * u);
        PT[i] = stroke(2 * u - 1, lw * 1.15, 0.05);
      }
      ribbon(ln, NI, false);
    }
    this.draw(ln, cx, cy);
  }

  /**
   * @param awake 1 = awake, 0 = out cold (eyes shut, jaw slack). Blends in between.
   * @param f the face letters (see mood.ts).
   * @param blink 0..1, how far the lids are down for a blink (eyes only).
   */
  setExpression(awake: number, f: Letters, blink = 0): void {
    const { smoothstep, lerp } = THREE.MathUtils;
    this.alert = smoothstep(awake, 0.3, 0.9);
    const L = this.letter;
    this.letters = f;
    const es = this.shape.eyeSize;
    // How far the lids are down: 0 open, 1 shut.
    const shut = Math.max(blink, 1 - smoothstep(awake, 0.05, 0.95));

    // ---- Eyes: an open oval whose top lid comes down (and bottom lid up a little) to
    // meet in a shut eye's curve: sleepy and relaxed shut eyes curve down (‿), happy
    // ones (a big smile, a wink) arch up (^). An icon (hearts, stars, spirals, > <) can
    // grow in the eye's place while the eye shrinks away under it.
    const gx = L('gazeX') * 0.016, gy = L('gazeY') * 0.012;
    const eo = L('eyeOpen');
    // Lopsided: the favoured side's eye squints harder, the other opens a touch.
    const lop = L('lopsided') * this.side;
    const th = FACE.line * es * 1.25;
    const happyShut = L('eyeSmile'), calmShut = L('eyeClose'), wink = L('wink'), sparkle = L('sparkleEyes');
    let icon: Icon = 'heartEyes', iconAmt = 0;
    for (const k of ICONS) { const v = L(k); if (v > iconAmt) { iconAmt = v; icon = k; } }
    const keep = 1 - iconAmt; // how much of the plain eye is left
    for (const e of this.eyes) {
      const k = e.side * lop;
      const cap = Math.max(happyShut, wink * e.side), cup = Math.max(calmShut, shut);
      const sh = Math.max(cap, cup);
      // The shut curve's bend: −0.8 a sleepy ‿, +1 a happy ^ (whichever shuts it more).
      const bend = cap + cup > 1e-4 ? (cap - 0.8 * cup) / (cap + cup) : -0.8;
      const up = Math.max(0, bend);
      // Wide: taller and much rounder. Narrowed: half-lidded down to a slit.
      const W = keep * EYE.w * es * (1 + 0.4 * Math.max(0, eo)) * (1 + 0.2 * Math.max(0, k));
      const H = keep * EYE.h * es * (eo >= 0 ? 1 + 0.1 * eo : 1 + 0.6 * eo) * (k > 0 ? Math.max(0.2, 1 - 1.05 * k) : 1 - 0.15 * k);
      // Shut: a little curve, lower than the open eye's middle, like a sleeping face (or
      // higher and wider, arched, for a happy one).
      const w = lerp(W, keep * (0.019 + 0.005 * up) * es, sh);
      const cx = e.x + gx, cy = e.y + gy;
      const o = e.ink;
      o.mesh.visible = keep > 0.03;
      if (o.mesh.visible) {
        for (let i = 0; i <= N; i++) {
          const c = stroke(U[i], th * keep * (1 + 0.25 * up), w);
          const mid = (-0.002 - 0.004 * up) * es + bend * 0.01 * es * E[i] * E[i];
          let top = lerp(H * E[i], mid + c, sh);
          let bot = lerp(-H * E[i], mid - c, sh * sh);
          if (top - bot < 2 * c) { const m = (top + bot) / 2; top = m + c; bot = m - c; }
          o.tx[i] = o.bx[i] = cx + w * U[i];
          o.ty[i] = cy + top;
          o.by[i] = cy + bot;
        }
        this.draw(o, cx, cy);
      }

      // Sparkle: a white dot high on the eye, on the same side for both eyes (where the
      // light comes from). It shrinks away as the lid comes down over it. In awe, it
      // swells into a big four-pointed sparkle in the middle of the eye.
      const g = FACE.glint * W * (1 + 1.3 * sparkle) * (1 - sh) * (1 - sh) * Math.min(1, H / (EYE.h * es * keep || 1));
      const gpx = cx - 0.3 * W * (1 - sparkle), gpy = cy + 0.42 * H * (1 - sh) * (1 - 0.7 * sparkle);
      const q = 2 - 1.35 * sparkle; // 2: a circle … 0.65: a pinched four-pointed star
      const s = e.glint;
      s.mesh.visible = g > 0.0008;
      if (s.mesh.visible) {
        for (let i = 0; i <= N; i++) {
          const h = g * (q === 2 ? E[i] : Math.pow(Math.max(0, 1 - Math.pow(Math.abs(U[i]), q)), 1 / q));
          s.tx[i] = s.bx[i] = gpx + g * U[i];
          s.ty[i] = gpy + h;
          s.by[i] = gpy - h;
        }
        this.draw(s, gpx, gpy);
      }

      // Lashes ride the top lid's outer edge, pointing out from it.
      const lashes = this.shape.lashes * keep;
      e.lashFrame.visible = lashes > 0.01;
      this.bases.get(e.lashFrame)!.set(cx, cy, surfaceZ(cx, cy, this.r));
      if (e.lashFrame.visible) {
        const len = 0.02 * lashes * es * (1 - 0.4 * sh);
        const cz = surfaceZ(cx, cy, this.r);
        for (let j = 0; j < LASHES.length; j++) {
          const l = e.lashes[j], [a, size] = LASHES[j];
          const u = e.side * Math.cos(a);
          const i = Math.min(N - 1, Math.max(1, Math.round((Math.acos(-u) / Math.PI) * N)));
          const px = o.tx[i], py = o.ty[i];
          const dx = o.tx[i + 1] - o.tx[i - 1], dy = o.ty[i + 1] - o.ty[i - 1];
          l.position.set(px - cx, py - cy, surfaceZ(px, py, this.r) - cz + LIFT.ink);
          l.rotation.z = Math.atan2(dx, -dy) + e.side * -0.25;
          l.scale.set(len * size, 0.004, 0.004);
        }
      }

      this.drawIcon(e, icon, iconAmt, cx, cy, es);
    }

    // ---- Brows: tapered strokes that fade in (rising a little as they come), then
    // move up and down and tilt. Turning a +x brow anticlockwise drops its inner end
    // (cross); clockwise lifts it (sad/worried). Mirrored per side.
    const browShow = Math.min(1, L('browShow'));
    this.browMaterial.opacity = browShow;
    for (const b of this.brows) {
      const o = b.ink;
      o.mesh.visible = browShow > 0.01;
      if (!o.mesh.visible) continue;
      const ang = b.side * 0.5 * L('browAngle'), cos = Math.cos(ang), sin = Math.sin(ang);
      const cx = b.x, cy = b.y + 0.016 * L('browHeight') - 0.012 * b.side * lop - 0.008 * (1 - browShow);
      const half = 0.026 * (0.85 + 0.15 * browShow), bt = 0.0048;
      for (let i = 0; i <= N; i++) {
        const x = half * U[i], arch = 0.003 * E[i] * E[i];
        const c = stroke(U[i], bt, half) * (1 - 0.4 * Math.max(0, U[i] * b.side)); // thinner at the outer end
        o.tx[i] = cx + x * cos - (arch + c) * sin; o.ty[i] = cy + x * sin + (arch + c) * cos;
        o.bx[i] = cx + x * cos - (arch - c) * sin; o.by[i] = cy + x * sin + (arch - c) * cos;
      }
      this.draw(o, cx, cy);
    }

    // ---- Blush: the character's own, plus any from the mood. Fades rather than grows.
    const blush = Math.min(1.2, this.shape.blush + L('blush'));
    this.blushMaterial.opacity = 0.85 * Math.min(1, blush);
    for (const c of this.cheeks) {
      c.visible = blush > 0.01;
      c.scale.setScalar(0.85 + 0.15 * Math.min(1.2, blush));
    }

    // ---- Mouth: one stroke. Smiling bends it up at the corners, frowning down; opening
    // drops the bottom lip (and lifts the top a touch), so a straight face opens into an
    // "o" and a smile into a grin with a pink tongue at the bottom. Out cold, the jaw hangs
    // slack. Gritted teeth square it off into a box of teeth; queasy makes it wobble.
    const mw = this.shape.mouthWidth;
    const tt = L('teeth') * smoothstep(awake, 0.3, 1);
    const sm = L('smile') * smoothstep(awake, 0.3, 1);
    const slack = 1 - smoothstep(awake, 0, 0.6);
    const op = Math.min(1, Math.max(slack, L('mouthOpen'), 0.55 * tt));
    // Concentrating: the mouth slides off to one side, scrunched shorter and tilted up at
    // that corner, and the tip of the tongue pokes out of it.
    const shift = L('mouthShift') * this.side;
    const round = op * (1 - Math.min(1, 1.5 * Math.abs(sm))) * (1 - tt); // how much it's an "o" rather than a grin
    const W = lerp(FACE.mouthWidth * mw * (1 - 0.15 * Math.max(0, -sm)), 0.017 * Math.sqrt(mw), round)
      * (1 - 0.2 * Math.abs(shift)) * (1 + 0.2 * tt);
    const ms = this.mouthShape;
    ms.depth = FACE.smileDepth * sm * (1 - 0.75 * tt);
    ms.Ho = FACE.mouthOpen * op * (1 - 0.2 * slack) * (1 - 0.35 * tt);
    ms.lift = 0.25 + 0.3 * tt; // how far the top lip rises as it opens
    ms.line = FACE.line; ms.W = W; ms.box = tt; ms.wavy = L('wavy') * smoothstep(awake, 0.3, 1);
    const mt = FACE.line;
    const ang = 0.35 * shift, cos = Math.cos(ang), sin = Math.sin(ang);
    const mx = 0.022 * shift, my = MOUTH_Y;
    const m = this.mouth;
    for (let i = 0; i <= N; i++) {
      const x = W * U[i];
      const top = this.lip(U[i], 1), bot = this.lip(U[i], -1);
      m.tx[i] = mx + x * cos - top * sin; m.ty[i] = my + x * sin + top * cos;
      m.bx[i] = mx + x * cos - bot * sin; m.by[i] = my + x * sin + bot * cos;
    }
    this.draw(m, mx, my);

    // Inside a grin: a pink tongue lying in the bottom of the mouth (hidden in an "o").
    const grin = ms.Ho * (1 - round) * (1 - tt);
    const ins = this.inside;
    ins.mesh.visible = grin > 0.004;
    if (ins.mesh.visible) {
      for (let i = 0; i <= N; i++) {
        const u = 0.72 * U[i], x = W * u;
        const floor = this.lip(u, -1) + 1.3 * mt, roof = this.lip(u, 1) - 1.3 * mt;
        const top = floor + Math.max(0, 0.45 * (roof - floor)) * E[i];
        ins.tx[i] = mx + x * cos - top * sin; ins.ty[i] = my + x * sin + top * cos;
        ins.bx[i] = mx + x * cos - floor * sin; ins.by[i] = my + x * sin + floor * cos;
      }
      this.draw(ins, mx, my);
    }

    // Gritted teeth: a white band filling the box, a line between the rows and three gaps.
    const T = this.teeth, TL = this.teethLine;
    T.mesh.visible = TL.mesh.visible = tt > 0.02;
    if (T.mesh.visible) {
      const fill = Math.min(1, 1.5 * tt);
      for (let i = 0; i <= N; i++) {
        const u = 0.94 * U[i], x = W * u;
        const hi = this.lip(u, 1) - 1.2 * mt, lo = this.lip(u, -1) + 1.2 * mt;
        const mid = (hi + lo) / 2, half = Math.max(0, (hi - lo) / 2) * fill;
        T.tx[i] = mx + x * cos - (mid + half) * sin; T.ty[i] = my + x * sin + (mid + half) * cos;
        T.bx[i] = mx + x * cos - (mid - half) * sin; T.by[i] = my + x * sin + (mid - half) * cos;
        PX[i] = mx + x * cos - mid * sin; PY[i] = my + x * sin + mid * cos;
        PT[i] = stroke(U[i], 0.55 * mt * fill, W);
      }
      this.draw(T, mx, my);
      ribbon(TL, N, false);
      this.draw(TL, mx, my);
      const cz = surfaceZ(mx, my, this.r);
      for (let k = 0; k < this.toothGaps.length; k++) {
        const u = (k - 1) * 0.42, x = W * u;
        const hi = this.lip(u, 1) - 1.2 * mt, lo = this.lip(u, -1) + 1.2 * mt;
        const mid = (hi + lo) / 2, half = Math.max(0, (hi - lo) / 2) * fill;
        const gx2 = mx + x * cos - mid * sin, gy2 = my + x * sin + mid * cos;
        const gap = this.toothGaps[k];
        gap.position.set(gx2 - mx, gy2 - my, surfaceZ(gx2, gy2, this.r) - cz + LIFT.over - LIFT.inside);
        gap.rotation.z = ang;
        gap.scale.set(1.1 * mt, Math.max(1e-4, half), 0.002);
      }
    }

    // Tongue: hangs from the bottom lip, toward the corner the mouth slid to (or from the
    // middle, sticking right out, when it hasn't), tucked under the lip's ink so it grows
    // out from behind it.
    const tg = L('tongue') * smoothstep(awake, 0.5, 1);
    const t = this.tongue;
    t.mesh.visible = tg > 0.01;
    if (t.mesh.visible) {
      const dir = Math.sign(shift) || this.side;
      const middle = 1 - Math.min(1, 3 * Math.abs(shift));
      const tw = Math.min(0.009 * Math.sqrt(mw) * (1 + 0.45 * middle), 0.45 * W);
      const uc = dir * (0.85 - tw / W) * (1 - middle);
      const len = 0.022 * tg * (1 + 0.35 * middle);
      for (let i = 0; i <= N; i++) {
        const x = uc * W + tw * U[i];
        const lip = this.lip(x / W, -1);
        const top = lip + 0.8 * mt, bot = lip - len * E[i];
        t.tx[i] = mx + x * cos - top * sin; t.ty[i] = my + x * sin + top * cos;
        t.bx[i] = mx + x * cos - bot * sin; t.by[i] = my + x * sin + bot * cos;
      }
      this.draw(t, mx, my);
    }
    this.followSurface();
  }
}
