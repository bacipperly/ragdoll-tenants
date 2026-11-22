/*
 * Accessories: the little extras from the character sheets, several of which tell an
 * age at a glance (a baby's pacifier, a kid's backpack, a teen's headphones, an elder's
 * glasses, whiskers and cane).
 *
 * Face things (glasses, bow, headphones, pacifier, whiskers) are laid out in the face's
 * own units (head radius 0.2, +z out of the face) and worn by the Face, so they ride the
 * squishy goo head like the eyes do. Body things hang off a bone: the backpack off the
 * chest, the bag off the belly, the cane off a fin, kept upright every frame.
 *
 * Everything is built once when the outfit changes; per frame only the cane moves.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { BodyDims } from './proportions';
import type { Outfit } from './outfit';
import { MOUTH_Y, type Face } from './skin';
import { profileRadius } from './garments';

/** Height of the drawn head's front surface above (x, y) (radius 0.2). */
const surf = (x: number, y: number) => Math.sqrt(Math.max(0, 0.04 - x * x - y * y));

function mat(color: THREE.ColorRepresentation, roughness = 0.6, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, ...extra });
}
function mesh(geo: THREE.BufferGeometry, material: THREE.Material, at?: THREE.Vector3): THREE.Mesh {
  const m = new THREE.Mesh(geo, material);
  if (at) m.position.copy(at);
  m.castShadow = true;
  return m;
}
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const tube = (pts: THREE.Vector3[], r: number, closed = false) =>
  new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, closed), pts.length * 6, r, 6, closed);

// ---------------------------------------------------------------- face things

/** Glasses over the eyes: two rims (round, or squared off), a bridge, arms back to the ears. */
function glasses(o: NonNullable<Outfit['glasses']>, D: BodyDims): THREE.Group {
  const F = D.face, ex = 0.072 * F.eyeSpacing, ey = 0.02 + F.eyeHeight * 0.2;
  const R = 0.05 * Math.max(0.85, F.eyeSize), tube1 = 0.0065;
  const frame = mat(o.color, 0.35), glass = mat('#d8ecff', 0.1, { transparent: true, opacity: 0.18, depthWrite: false });
  const g = new THREE.Group();
  const zc = surf(ex, ey) + 0.016;
  g.position.set(0, ey, zc);
  for (const sx of [1, -1]) {
    const square = o.style === 'square';
    const rim = mesh(new THREE.TorusGeometry(R, tube1, 8, square ? 4 : 40), frame);
    if (square) rim.rotation.z = Math.PI / 4;
    rim.scale.set(square ? 1.1 : 1, square ? 0.95 : 1.08, 1);
    const lens = mesh(new THREE.CircleGeometry(R, square ? 4 : 32), glass);
    if (square) lens.rotation.z = Math.PI / 4;
    lens.scale.copy(rim.scale);
    const eye = new THREE.Group();
    eye.position.set(sx * ex, 0, 0);
    eye.rotation.y = sx * 0.32; // wrapping round the head a little
    eye.add(rim, lens);
    g.add(eye);
    // Arms: from the rim's outer edge back over the head's side to the ear.
    const ox = sx * (ex + R * Math.cos(0.32)), oz = zc - R * Math.sin(0.32);
    const pts: THREE.Vector3[] = [v(ox, 0, oz - zc)];
    const rr = Math.sqrt(0.212 * 0.212 - ey * ey), a0 = Math.atan2(Math.abs(ox), oz);
    for (let k = 1; k <= 4; k++) {
      const a = a0 + (1.75 - a0) * (k / 4);
      pts.push(v(sx * rr * Math.sin(a), -0.006 * k, rr * Math.cos(a) - zc));
    }
    g.add(mesh(tube(pts, 0.005), frame));
  }
  // The bridge between the rims, arching a touch.
  const inner = ex - R * Math.cos(0.32) * 0.98;
  g.add(mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(v(-inner, 0.006, 0.004), v(0, 0.022, 0.012), v(inner, 0.006, 0.004)), 8, 0.0055, 6), frame));
  return g;
}

/** A bow perched on top of the head, off to one side. */
function bow(o: NonNullable<Outfit['bow']>): THREE.Group {
  const m = mat(o.color, 0.5), g = new THREE.Group();
  const d = v(0.42, 0.88, 0.2).normalize().multiplyScalar(0.205);
  g.position.copy(d);
  g.rotation.z = -0.45;
  for (const sx of [1, -1]) {
    const lobe = mesh(new THREE.SphereGeometry(0.04, 16, 10), m, v(sx * 0.045, 0.004, 0));
    lobe.scale.set(1.25, 0.85, 0.45);
    lobe.rotation.z = sx * 0.18;
    g.add(lobe);
    const tail = mesh(new THREE.ConeGeometry(0.014, 0.05, 8), m, v(sx * 0.018, -0.03, 0));
    tail.rotation.z = Math.PI + sx * 0.35;
    g.add(tail);
  }
  g.add(mesh(new THREE.SphereGeometry(0.02, 12, 8), mat(new THREE.Color(o.color).multiplyScalar(0.85), 0.5)));
  return g;
}

/** Headphones: a band over the top, round cups on the sides of the head. */
function headphones(o: NonNullable<Outfit['headphones']>): THREE.Group {
  const m = mat(o.color, 0.4), pad = mat('#3d2f7a', 0.8), g = new THREE.Group();
  g.position.set(0, 0, -0.01);
  g.rotation.x = -0.12;
  g.add(mesh(new THREE.TorusGeometry(0.222, 0.012, 8, 40, Math.PI), m));
  for (const sx of [1, -1]) {
    const cup = mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.034, 24), m, v(sx * 0.222, 0, 0));
    cup.rotation.z = Math.PI / 2;
    const cushion = mesh(new THREE.TorusGeometry(0.04, 0.012, 8, 24), pad, v(sx * 0.203, 0, 0));
    cushion.rotation.y = Math.PI / 2;
    g.add(cup, cushion);
  }
  return g;
}

/** A dummy in the mouth: a shield, a ring to hold it by, a nub in the middle. */
function pacifier(o: NonNullable<Outfit['pacifier']>): THREE.Group {
  const m = mat(o.color, 0.35), g = new THREE.Group();
  g.position.set(0, MOUTH_Y, surf(0, MOUTH_Y) + 0.004);
  const shield = mesh(new THREE.SphereGeometry(0.032, 20, 12), m);
  shield.scale.set(1.35, 1, 0.35);
  const ring = mesh(new THREE.TorusGeometry(0.02, 0.006, 8, 24), mat('#ffffff', 0.3), v(0, -0.004, 0.016));
  ring.rotation.x = 0.35;
  g.add(shield, ring, mesh(new THREE.SphereGeometry(0.01, 10, 8), m, v(0, 0, 0.012)));
  return g;
}

/** Bushy facial hair: a mustache over the mouth and/or brows over the eyes. */
function whiskers(o: NonNullable<Outfit['whiskers']>, D: BodyDims): THREE.Group {
  const F = D.face, ex = 0.072 * F.eyeSpacing, ey = 0.02 + F.eyeHeight * 0.2;
  const m = mat(o.color, 0.95), g = new THREE.Group();
  for (const sx of [1, -1]) {
    if (o.mustache) {
      const x = sx * 0.026, y = MOUTH_Y + 0.022;
      const lobe = mesh(new THREE.SphereGeometry(0.026, 14, 10), m, v(x, y, surf(x, y) + 0.002));
      lobe.scale.set(1.5, 0.7, 0.6);
      lobe.rotation.z = -sx * 0.32;
      g.add(lobe);
    }
    if (o.brows) {
      const x = sx * ex, y = ey + 0.072 * F.eyeSize;
      const brow = mesh(new THREE.SphereGeometry(0.022, 14, 10), m, v(x, y, surf(x, y) + 0.002));
      brow.scale.set(1.65, 0.62, 0.6);
      brow.rotation.z = -sx * 0.2;
      g.add(brow);
    }
  }
  return g;
}

// ---------------------------------------------------------------- body things

/** A backpack on the back with straps over the shoulders. Built in the chest bone's frame. */
function backpack(o: NonNullable<Outfit['backpack']>, D: BodyDims, chestY: number): THREE.Group {
  const m = mat(o.color, 0.75), dark = mat(new THREE.Color(o.color).multiplyScalar(0.75), 0.8);
  const g = new THREE.Group();
  const top = D.shoulderY - 0.1 * (D.shoulderY - D.hipY), bottom = D.hipY + 0.15 * (D.shoulderY - D.hipY);
  const h = top - bottom, w = 1.45 * D.bellyR, d = 0.6 * D.bellyR, yc = (top + bottom) / 2;
  const back = Math.max(profileRadius(D.skin.body, yc), profileRadius(D.skin.body, bottom + 0.2 * h));
  const pack = mesh(new RoundedBoxGeometry(w, h, d, 3, Math.min(w, h, d) * 0.3), m, v(0, yc - chestY, -(back + d / 2 - 0.006)));
  const pocket = mesh(new RoundedBoxGeometry(w * 0.7, h * 0.4, d * 0.4, 3, d * 0.15), dark, v(0, yc - h * 0.2 - chestY, -(back + d + d * 0.1)));
  g.add(pack, pocket);
  // Straps: from the pack's top, over the shoulder, down the front.
  for (const sx of [1, -1]) {
    const x = sx * w * 0.28, pts: THREE.Vector3[] = [];
    const out = (y: number, front: number) => {
      const r = profileRadius(D.skin.body, y) * 1.06 + 0.004;
      return v(x, y - chestY, front * Math.sqrt(Math.max(0, r * r - x * x)));
    };
    pts.push(v(x, top - 0.05 * h - chestY, -(back + 0.004)));
    const crest = D.shoulderY + 0.25 * (D.neckY - D.shoulderY);
    pts.push(v(x, crest - chestY, -0.25 * profileRadius(D.skin.body, crest)));
    pts.push(v(x, crest - chestY, 0.25 * profileRadius(D.skin.body, crest)));
    pts.push(out(D.shoulderY - 0.25 * h, 1));
    pts.push(out(yc - 0.1 * h, 1));
    g.add(mesh(tube(pts, 0.006), dark));
  }
  return g;
}

/** A shoulder bag at one hip, on a strap slung across the body. Built in the belly bone's frame. */
function bag(o: NonNullable<Outfit['bag']>, D: BodyDims, bellyY: number): THREE.Group {
  const m = mat(o.color, 0.6), dark = mat(new THREE.Color(o.color).multiplyScalar(0.7), 0.6);
  const g = new THREE.Group();
  const span = D.shoulderY - D.hipY, yc = D.hipY + 0.55 * span, amp = 0.42 * span;
  // The strap: a loop round the body, low at the bag's hip (+x), high at the other shoulder.
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2, y = yc - amp * Math.sin(a);
    const r = profileRadius(D.skin.body, y) * 1.07 + 0.004;
    pts.push(v(r * Math.sin(a), y - bellyY, r * Math.cos(a)));
  }
  g.add(mesh(tube(pts, 0.0055, true), dark));
  const w = 0.95 * D.bellyR, h = 0.75 * D.bellyR, d = 0.35 * D.bellyR, y = yc - amp - 0.35 * h;
  const side = profileRadius(D.skin.body, y) * 1.05;
  const body = mesh(new RoundedBoxGeometry(d, h, w, 3, d * 0.3), m, v(side + d / 2, y - bellyY, 0.15 * w));
  const flap = mesh(new RoundedBoxGeometry(d * 0.35, h * 0.55, w * 1.02, 2, d * 0.12), dark, v(side + d * 0.95, y + h * 0.2 - bellyY, 0.15 * w));
  g.add(body, flap);
  return g;
}

/** A walking cane with a crook, held at a fin's tip and kept upright, reaching the ground. */
class Cane {
  readonly root = new THREE.Group();
  private readonly shaft: THREE.Mesh;
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();

  constructor(o: NonNullable<Outfit['cane']>, D: BodyDims) {
    const m = mat(o.color, 0.5), r = 0.0065;
    this.shaft = mesh(new THREE.CylinderGeometry(r, r * 0.9, 1, 10).translate(0, -0.5, 0), m);
    const crook = mesh(new THREE.TorusGeometry(0.018, r, 8, 16, Math.PI), m, v(0.018, 0.0, 0));
    const tip = mesh(new THREE.CylinderGeometry(r * 1.4, r * 1.4, 0.012, 10), mat('#2b2d42', 0.8));
    this.root.add(this.shaft, crook);
    this.shaft.add(tip);
    tip.position.y = -1;
    tip.scale.y = 1;
    this.root.position.set(0, -D.forearmLen * 0.45, 0.012);
  }

  /** Upright in the world, from the hand down to the ground. */
  update(groundY: number): void {
    const parent = this.root.parent;
    if (!parent) return;
    parent.getWorldQuaternion(this.q).invert();
    this.root.quaternion.copy(this.q);
    this.root.getWorldPosition(this.p);
    const len = Math.max(0.002, this.p.y - groundY); // a crawling baby's hand is nearly on the floor
    this.shaft.scale.set(1, len, 1);
    (this.shaft.children[0] as THREE.Mesh).scale.y = 1 / len; // keep the rubber tip its size
  }
}

// ---------------------------------------------------------------- the set

export interface AccessoryBones { chest: THREE.Object3D; belly: THREE.Object3D; hand: THREE.Object3D }

/** Everything accessory a tenant has on, built from its outfit. */
export class Accessories {
  private readonly onFace: THREE.Object3D[] = [];
  private readonly onBody: THREE.Object3D[] = [];
  private readonly cane: Cane | null = null;

  constructor(o: Outfit, D: BodyDims, private readonly face: Face, bones: AccessoryBones) {
    const wear = (obj: THREE.Object3D) => { face.wear(obj); this.onFace.push(obj); };
    if (o.glasses) wear(glasses(o.glasses, D));
    if (o.bow) wear(bow(o.bow));
    if (o.headphones) wear(headphones(o.headphones));
    if (o.pacifier) wear(pacifier(o.pacifier));
    if (o.whiskers && (o.whiskers.mustache || o.whiskers.brows)) wear(whiskers(o.whiskers, D));
    const hang = (obj: THREE.Object3D, bone: THREE.Object3D) => { bone.add(obj); this.onBody.push(obj); };
    if (o.backpack) hang(backpack(o.backpack, D, D.spineY + D.chestLen / 2), bones.chest);
    if (o.bag) hang(bag(o.bag, D, D.bellyY), bones.belly);
    if (o.cane) { this.cane = new Cane(o.cane, D); hang(this.cane.root, bones.hand); }
  }

  /** Once per rendered frame. */
  update(groundY: number): void {
    this.cane?.update(groundY);
  }

  dispose(): void {
    for (const obj of this.onFace) this.face.unwear(obj);
    for (const obj of this.onBody) obj.removeFromParent();
    for (const obj of [...this.onFace, ...this.onBody]) {
      obj.traverse((c) => {
        if (c instanceof THREE.Mesh) { c.geometry.dispose(); (c.material as THREE.Material).dispose(); }
      });
    }
  }
}
