import * as THREE from 'three';
import { SKIN } from './config';
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
    profile: B.skin.body, cx: 0, cz: 0, yOffset: 0, squashZ: 1, group: 'body', blend: 0,
    influence: (y) => blendAcross(belly, chest, y, B.spineY, 0.05),
  });
  for (const [side, sx] of [['L', 1], ['R', -1]] as const) {
    const thigh = bone(`thigh${side}`);
    const shin = bone(`shin${side}`);
    const kneeY = B.hipY - B.thighLen;
    // Legs: shin at the tip, thigh in the middle, melting into the belly at the hip.
    shapes.push({
      profile: B.skin.leg, cx: sx * B.hipX, cz: 0, yOffset: 0, squashZ: 1, group: 'limb', blend: 0.03 * size,
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
      group: 'limb', blend: 0.018 * size,
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
        profile: ball, cx: sx * C.x, cz: C.z, yOffset: C.y, squashZ: 0.9, group: 'limb', blend: 0.6 * R,
        influence: () => [butt, belly, 0.85, 0.15],
      });
    }
  }
  return blendedSkin(shapes, 0.006 * size, bone('__count'));
}

// ---- The face: rigid little meshes that ride on the head bone ----

const faceMaterial = new THREE.MeshStandardMaterial({ color: 0x1b1b2f, roughness: 0.55 });
const eyeGeometry = new THREE.SphereGeometry(1, 12, 10);
/** A small arc, used for the smile and for closed eyes. The arc is centred on its bottom. */
const arcGeometry = new THREE.TorusGeometry(1, 0.17, 6, 18, Math.PI * 0.6);
arcGeometry.rotateZ(Math.PI + Math.PI * 0.2); // the torus arc starts at +x; turn it to hang at the bottom

const EYE_OPEN = new THREE.Vector3(0.021, 0.046, 0.012);
const SMILE_SCALE = 0.032;
/** The mouth's half-sizes: a closed line, the slack jaw when out cold, a surprised "o". */
const LINE_MOUTH = { x: 0.018, y: 0.0038 };
const SLACK_MOUTH = { x: 0.016, y: 0.021 };
const OPEN_MOUTH = { x: 0.017, y: 0.025 };
const BROW = new THREE.Vector3(0.05, 0.0095, 0.006);
const browGeometry = new THREE.CapsuleGeometry(0.5, 1, 2, 6).rotateZ(Math.PI / 2); // a rounded bar along x
/** A thin bar along +x starting at its origin, for lashes (so it can be rotated about its root). */
const lashGeometry = new THREE.CapsuleGeometry(0.5, 1, 2, 5).rotateZ(Math.PI / 2).translate(0.75, 0, 0);
const blushMaterial = new THREE.MeshStandardMaterial({ color: 0xff7aa2, roughness: 0.8, transparent: true, opacity: 0.75 });
/** Where on each eye's outline the lashes grow (radians from "outward", toward "up"), and how long each is. */
const LASHES = [[0.35, 0.8], [0.75, 1], [1.15, 0.85]] as const;
const DEFAULT_FACE: FaceShape = { eyeSize: 1, eyeSpacing: 1, eyeHeight: 0, lashes: 0, blush: 0, mouthWidth: 1 };

/** Where a face feature sits: its rest spot on the face, how far it's sunk in, and the object to move. */
interface Feature { obj: THREE.Object3D; x: number; y: number; inset: number }

/**
 * The face, as in the drawing: tall oval eyes and a small smile on the +z side of the
 * head. It rides on the head bone, so positions are relative to the head's centre.
 *
 * It's driven by the face letters (see mood.ts): smile, mouthOpen, eyeOpen, brows, gaze
 * and blush, plus `awake` (0 = out cold: eyes shut to curves, the jaw slack), which
 * overrides the rest as it drops.
 */
export class Face {
  readonly root = new THREE.Group();
  private readonly shape: FaceShape;
  private readonly r: number;
  /** Things that move with the gaze: open eyes, shut eyes, lash frames. */
  private readonly gazers: Feature[] = [];
  private readonly eyesOpen: THREE.Mesh[] = [];
  private readonly eyesShut: THREE.Mesh[] = [];
  private readonly brows: { mesh: THREE.Mesh; side: number; base: THREE.Quaternion; x: number; y: number }[] = [];
  /** Per eye: a frame lying flat on the face at the eye's centre, holding its lashes. */
  private readonly lashSets: { frame: THREE.Group; lashes: THREE.Mesh[]; side: number }[] = [];
  private readonly cheeks: THREE.Mesh[] = [];
  private readonly smile: THREE.Mesh;
  private readonly frown: THREE.Mesh;
  /** One mouth: a flat line that opens into an "o" (smile and frown arcs replace it). */
  private readonly mouth: THREE.Mesh;
  private readonly tilt = new THREE.Quaternion();
  private readonly zAxis = new THREE.Vector3(0, 0, 1);
  /**
   * Where each feature sits before the goo moves it: set when placed, and every frame
   * for the ones that move about the face (eyes with the gaze, brows up and down).
   */
  private readonly bases = new Map<THREE.Object3D, THREE.Vector3>();
  /** The goo surface the features ride on, which vertex each one rides, and the face's scale. */
  private goo: GooHead | null = null;
  private readonly riding = new Map<THREE.Object3D, number>();
  private gooScale = 1;

  constructor(r: number, shape: FaceShape = DEFAULT_FACE) {
    this.shape = shape;
    this.r = r;
    const flatOnFace = (m: THREE.Object3D) => m.lookAt(m.position.clone().multiplyScalar(2));
    const place = (m: THREE.Object3D, x: number, y: number, inset: number) => {
      m.position.set(x, y, this.onSurface(x, y) - inset);
      flatOnFace(m);
      this.root.add(m);
      this.bases.set(m, m.position.clone());
    };
    const eyeY = 0.02 + shape.eyeHeight * r;
    for (const sx of [1, -1]) {
      const x = sx * 0.072 * shape.eyeSpacing, y = eyeY;
      const open = new THREE.Mesh(eyeGeometry, faceMaterial);
      place(open, x, y, 0.004);
      this.eyesOpen.push(open);
      this.gazers.push({ obj: open, x, y, inset: 0.004 });
      // Shut: a little downward curve, lower than the open eye's middle, like a sleeping face.
      const shut = new THREE.Mesh(arcGeometry, faceMaterial);
      place(shut, x, y - 0.004, 0.001);
      this.eyesShut.push(shut);
      this.gazers.push({ obj: shut, x, y: y - 0.004, inset: 0.001 });
      // Lashes: a frame flat on the face at the eye's centre; the lashes are placed on the
      // eye's outline every frame, so they ride the lid as it blinks or squints.
      const frame = new THREE.Group();
      place(frame, x, y, 0);
      const lashes = LASHES.map(() => new THREE.Mesh(lashGeometry, faceMaterial));
      for (const l of lashes) frame.add(l);
      this.lashSets.push({ frame, lashes, side: sx });
      this.gazers.push({ obj: frame, x, y, inset: 0 });
      // Blush: a rosy patch on each cheek, below and outside the eye.
      const cheek = new THREE.Mesh(eyeGeometry, blushMaterial);
      place(cheek, sx * 0.112 * shape.eyeSpacing, eyeY - 0.06, 0.002);
      this.cheeks.push(cheek);
      // Brows: hidden unless a mood or reaction shows them (the drawing has none).
      const brow = new THREE.Mesh(browGeometry, faceMaterial);
      const bx = sx * 0.07 * shape.eyeSpacing, by = eyeY + 0.058 * shape.eyeSize;
      place(brow, bx, by, 0.001);
      this.brows.push({ mesh: brow, side: sx, base: brow.quaternion.clone(), x: bx, y: by });
    }
    this.smile = new THREE.Mesh(arcGeometry, faceMaterial);
    this.smile.position.set(0, -0.03, this.onSurface(0, -0.06) - 0.002);
    this.root.add(this.smile);
    this.bases.set(this.smile, this.smile.position.clone());
    // Frown: the same arc turned upside down.
    this.frown = new THREE.Mesh(arcGeometry, faceMaterial);
    this.frown.rotation.z = Math.PI;
    this.frown.position.set(0, -0.085, this.onSurface(0, -0.06) - 0.002);
    this.root.add(this.frown);
    this.bases.set(this.frown, this.frown.position.clone());
    // The mouth: a flat line that opens into a round "o" in place.
    this.mouth = new THREE.Mesh(eyeGeometry, faceMaterial);
    place(this.mouth, 0, -0.058, 0.003);
    this.setExpression(1, NEUTRAL);
  }

  /**
   * Rides the face on a goo head: each feature follows the goo vertex under it, so the
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

  /** Puts every feature at its base spot plus the goo's offset there. */
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

  private onSurface(x: number, y: number): number {
    return Math.sqrt(Math.max(0, this.r * this.r - x * x - y * y));
  }

  /** Puts each eye's lashes on the upper-outer edge of its current (squashed) oval. */
  private placeLashes(halfW: number, halfH: number, show: number): void {
    const len = 0.02 * this.shape.lashes * this.shape.eyeSize;
    for (const set of this.lashSets) {
      set.frame.visible = this.shape.lashes > 0.01 && show > 0.05;
      if (!set.frame.visible) continue;
      set.lashes.forEach((l, i) => {
        const [a, k] = LASHES[i];
        // Point on the oval (outward = +x for the eye on +x, mirrored for the other)...
        const cx = set.side * Math.cos(a) * halfW, cy = Math.sin(a) * halfH;
        l.position.set(cx, cy, 0.002);
        // ...pointing out from it, flicked a little further outward.
        l.rotation.z = Math.atan2(Math.sin(a) * halfW, set.side * Math.cos(a) * halfH) + set.side * -0.25;
        l.scale.set(len * k * show, 0.004, 0.004);
      });
    }
  }

  /**
   * @param awake 1 = awake, 0 = out cold (eyes shut, jaw slack). Blends in between.
   * @param f the face letters (see mood.ts).
   */
  setExpression(awake: number, f: Letters): void {
    const { smoothstep } = THREE.MathUtils;
    // Eyes: the open ovals squash shut, and the closed curves appear only near the end,
    // so a blink reads as the lid coming down rather than two shapes crossfading.
    const open = smoothstep(awake, 0.1, 0.9);
    const shut = 1 - smoothstep(awake, 0, 0.25);
    // Feelings only show while it's awake: blend every letter back toward neutral as it drops.
    const alert = smoothstep(awake, 0.3, 0.9);
    const L = (k: FaceLetter) => NEUTRAL[k] + (f[k] - NEUTRAL[k]) * alert;

    // Gaze: everything eye-shaped slides together across the face.
    const gx = L('gazeX') * 0.016, gy = L('gazeY') * 0.012;
    for (const g of this.gazers) {
      const x = g.x + gx, y = g.y + gy;
      this.bases.get(g.obj)!.set(x, y, this.onSurface(x, y) - g.inset);
    }

    const es = this.shape.eyeSize;
    const eo = L('eyeOpen');
    // Wide: taller and much rounder. Narrowed: half-lidded down to a slit.
    const eyeW = EYE_OPEN.x * es * (1 + 0.4 * Math.max(0, eo));
    const eyeH = EYE_OPEN.y * es * open * (eo >= 0 ? 1 + 0.1 * eo : 1 + 0.6 * eo);
    for (const m of this.eyesOpen) {
      m.scale.set(eyeW, eyeH, EYE_OPEN.z);
      m.visible = open > 0.02;
    }
    for (const m of this.eyesShut) {
      m.scale.setScalar(0.022 * es * shut);
      m.visible = shut > 0.02;
    }
    this.placeLashes(eyeW, eyeH, Math.max(open, 0.6 * shut));

    // Brows: height and angle. A positive turn about the face's z drops the inner (−x)
    // end of the +x brow (cross); negative lifts it (sad/worried). Mirrored per side.
    const browShow = L('browShow');
    for (const b of this.brows) {
      this.tilt.setFromAxisAngle(this.zAxis, b.side * 0.5 * L('browAngle'));
      b.mesh.quaternion.copy(b.base).multiply(this.tilt);
      const y = b.y + 0.016 * L('browHeight');
      this.bases.get(b.mesh)!.set(b.x, y, this.onSurface(b.x, y) - 0.001);
      b.mesh.scale.set(BROW.x * browShow, BROW.y * browShow, BROW.z);
      b.mesh.visible = browShow > 0.02;
    }

    // Blush: the character's own, plus any from the mood.
    const blush = Math.min(1.2, this.shape.blush + L('blush'));
    for (const c of this.cheeks) {
      c.scale.set(0.03 * blush, 0.019 * blush, 0.004);
      c.visible = blush > 0.02;
    }

    // Mouth: smile ↔ straight line ↔ frown, plus an open "o" (slack when out cold).
    const mw = this.shape.mouthWidth;
    const sm = L('smile') * smoothstep(awake, 0.3, 1);
    const smile = Math.max(0, sm), frown = Math.max(0, -sm);
    const line = Math.max(0, 1 - 2 * Math.abs(sm)) * open;
    this.smile.scale.set(SMILE_SCALE * mw * (0.6 + 0.4 * smile), SMILE_SCALE * smile, SMILE_SCALE);
    this.smile.visible = smile > 0.02;
    this.frown.scale.set(SMILE_SCALE * mw * 0.9 * frown, SMILE_SCALE * 0.7 * frown, SMILE_SCALE);
    this.frown.visible = frown > 0.02;
    // The line and the "o" are one shape: it opens from a flat line into an oval, in place,
    // and the line part fades as a smile or frown takes over.
    const slack = 1 - smoothstep(awake, 0, 0.6);
    const oh = Math.min(1, Math.max(slack, L('mouthOpen')));
    const ox = THREE.MathUtils.lerp(SLACK_MOUTH.x, OPEN_MOUTH.x, 1 - slack) * Math.sqrt(mw);
    const oy = THREE.MathUtils.lerp(SLACK_MOUTH.y, OPEN_MOUTH.y, 1 - slack);
    const lx = LINE_MOUTH.x * mw * line, ly = LINE_MOUTH.y * line;
    this.mouth.scale.set(Math.max(lx * (1 - oh), 0) + ox * oh, Math.max(ly * (1 - oh), 0) + oy * oh, 0.008);
    this.mouth.visible = Math.max(line, oh) > 0.02;
    this.followSurface();
  }
}
