/*
 * A hat on a goo head. It hugs the goo: each point of a beanie or a cap's crown follows
 * the goo point under it, so it squashes and wobbles with the head; solid bits (a
 * pompom, a visor, a top hat) ride the goo at one spot.
 *
 * A knockout can knock it off: it becomes a loose physics object, rolling where it
 * lands, until its tenant walks over it and puts it back on.
 */
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { GooHead } from './goo';
import type { HatStyle } from './outfit';

/** How a hat falls off. */
export const HAT = {
  fallChance: 0.6, // of a knockout or tumble knocking it off
  popSpeed: 1.4, // how hard it pops up off the head (u/s)
  pickupReach: 2, // × the belly's radius: walk this close to put it back on
  pickupDelay: 1.0, // seconds on the ground before it can be picked up
};

/** A part that hugs the goo: its rest points (head frame) and the goo point each one rides. */
interface Hugger { geo: THREE.BufferGeometry; rest: Float32Array; ride: Uint16Array }

export class Hat {
  /** On the head bone while worn; in the tenant's world group while loose. */
  readonly root = new THREE.Group();
  private readonly huggers: Hugger[] = [];
  /** Solid parts, and the goo point each rides, with their rest positions. */
  private readonly riders: { obj: THREE.Object3D; ride: number; rest: THREE.Vector3 }[] = [];
  private readonly material: THREE.MeshStandardMaterial;
  private readonly trim: THREE.MeshStandardMaterial;
  private body: RAPIER.RigidBody | null = null;
  private looseTime = 0;
  private readonly prevPos = new THREE.Vector3();
  private readonly prevRot = new THREE.Quaternion();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();

  /** How far round it's turned about the head's up axis (π: on backwards). */
  private readonly turn: number;

  constructor(readonly style: HatStyle | 'hood', color: string, private readonly R: number, private readonly goo: GooHead, backwards = false) {
    this.turn = backwards ? Math.PI : 0;
    this.material = new THREE.MeshStandardMaterial({ color, roughness: style === 'tophat' ? 0.45 : 0.85 });
    // Trim: a cuff, a band or a button, a little darker (a top hat's band is dark).
    this.trim = new THREE.MeshStandardMaterial({ color: style === 'tophat' ? '#1b1b2f' : color, roughness: 0.8 });
    if (style !== 'tophat') this.trim.color.multiplyScalar(0.82);
    const r = R;
    if (style === 'hood') {
      // A hoodie's hood, up: a loose shell round the back and sides of the head, open at
      // the face, pulled a little forward. Seen from inside through the opening.
      this.material.side = THREE.DoubleSide;
      // A shell down past the jaw with a round hole cut out for the face (a cone round
      // `face`, slightly below level, the way a hood frames the face).
      const R1 = r * 1.2, cone = 0.8;
      const face = new THREE.Vector3(0, -0.14, 1).normalize();
      const shell = new THREE.SphereGeometry(R1, 34, 18, 0, Math.PI * 2, 0, 2.45).toNonIndexed();
      const src = shell.attributes.position.array as Float32Array;
      const kept: number[] = [];
      const c = new THREE.Vector3();
      for (let i = 0; i < src.length; i += 9) {
        c.set(src[i] + src[i + 3] + src[i + 6], src[i + 1] + src[i + 4] + src[i + 7], src[i + 2] + src[i + 5] + src[i + 8]).normalize();
        if (c.angleTo(face) > cone) for (let k = 0; k < 9; k++) kept.push(src[i + k]);
      }
      shell.dispose();
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(kept, 3));
      geo.computeVertexNormals();
      this.hug(geo, this.material, 0);
      // A rolled edge right round the opening.
      this.trim.color.set(color).multiplyScalar(0.9);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(R1 * Math.sin(cone) * 0.99, r * 0.045, 6, 32), this.trim);
      rim.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), face);
      this.ride(rim, this.v.copy(face).multiplyScalar(R1 * Math.cos(cone)));
    } else if (style === 'beanie') {
      // A dome pulled down to the brows, a rolled cuff round its edge, a pompom on top.
      this.hug(new THREE.SphereGeometry(r * 1.07, 26, 10, 0, Math.PI * 2, 0, 0.98), this.material, -0.12);
      this.hug(new THREE.SphereGeometry(r * 1.1, 26, 3, 0, Math.PI * 2, 0.74, 0.27), this.trim, -0.12);
      const pom = new THREE.Mesh(new THREE.IcosahedronGeometry(r * 0.25, 1), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, flatShading: true }));
      this.ride(pom, this.v.set(0, r * 1.2, 0).applyAxisAngle(X, -0.12));
    } else if (style === 'cap') {
      // A rounded crown, a stiff visor out front, a button on top.
      this.hug(new THREE.SphereGeometry(r * 1.05, 26, 10, 0, Math.PI * 2, 0, 1.02), this.material, 0.06);
      const visor = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.72, r * 0.72, r * 0.05, 24, 1, false, -Math.PI / 2, Math.PI), this.trim);
      visor.scale.set(1, 1, 0.8);
      visor.rotation.x = 0.22;
      this.ride(visor, this.v.set(0, r * 0.6, r * 0.78));
      const button = new THREE.Mesh(new THREE.SphereGeometry(r * 0.08, 10, 6), this.trim);
      this.ride(button, this.v.set(0, r * 1.06, 0).applyAxisAngle(X, 0.06));
    } else {
      // A tall crown on a wide brim, with a band, worn at a jaunty tilt.
      const crown = new THREE.Group();
      const c = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.6, r * 0.56, r * 1.05, 24), this.material);
      c.position.y = r * 0.52;
      const band = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.575, r * 0.575, r * 0.2, 24), this.trim);
      band.position.y = r * 0.13;
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.0, r * 1.0, r * 0.05, 28), this.material);
      crown.add(c, band, brim);
      crown.rotation.z = 0.14;
      for (const m of [c, band, brim]) { m.castShadow = true; m.receiveShadow = true; }
      this.ride(crown, this.v.set(-r * 0.1, r * 0.8, 0));
    }
    this.conform();
  }

  get isLoose(): boolean { return this.body !== null; }

  /** A part that hugs the goo, tipped back (−) or forward (+) about x. */
  private hug(geo: THREE.BufferGeometry, material: THREE.Material, tip: number): void {
    geo.rotateX(tip);
    if (this.turn) geo.rotateY(this.turn);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const rest = new Float32Array(pos.array as Float32Array);
    const ride = new Uint16Array(pos.count);
    for (let i = 0; i < pos.count; i++) ride[i] = this.goo.nearestVertex(this.v.fromArray(rest, i * 3));
    pos.setUsage(THREE.DynamicDrawUsage);
    const mesh = new THREE.Mesh(geo, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    this.root.add(mesh);
    this.huggers.push({ geo, rest, ride });
  }

  private ride(obj: THREE.Object3D, at: THREE.Vector3): void {
    if (this.turn) {
      at.applyAxisAngle(Y, this.turn);
      obj.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(Y, this.turn));
    }
    obj.position.copy(at);
    obj.traverse((o) => { o.castShadow = true; });
    this.root.add(obj);
    this.riders.push({ obj, ride: this.goo.nearestVertex(at), rest: at.clone() });
  }

  /** Follows the goo: every hugging point, and each solid part, moved by the goo under it. */
  conform(): void {
    if (this.body) return;
    const u = this.goo.offset;
    for (const h of this.huggers) {
      const pos = h.geo.attributes.position as THREE.BufferAttribute;
      const a = pos.array as Float32Array;
      for (let i = 0; i < pos.count; i++) {
        const k = h.ride[i] * 3;
        a[i * 3] = h.rest[i * 3] + u[k];
        a[i * 3 + 1] = h.rest[i * 3 + 1] + u[k + 1];
        a[i * 3 + 2] = h.rest[i * 3 + 2] + u[k + 2];
      }
      pos.needsUpdate = true;
    }
    for (const r of this.riders) {
      const k = r.ride * 3;
      r.obj.position.set(r.rest.x + u[k], r.rest.y + u[k + 1], r.rest.z + u[k + 2]);
    }
  }

  /**
   * Knocked off: from the head bone into `group` (world space) as a loose body, popping
   * up and away with the head's velocity plus `pop`.
   */
  knockOff(world: RAPIER.World, group: THREE.Object3D, groups: number, headVel: RAPIER.Vector, pop: THREE.Vector3): void {
    if (this.body) return;
    this.root.updateWorldMatrix(true, true);
    this.root.getWorldPosition(this.prevPos);
    this.root.getWorldQuaternion(this.prevRot);
    group.add(this.root);
    this.root.position.copy(this.prevPos);
    this.root.quaternion.copy(this.prevRot);
    // Its shape: shrink-wrapped round the hat itself (gathered before it leaves the head,
    // in the hat's own frame), so it rests on its brim or rolls on its crown.
    const shape = RAPIER.ColliderDesc.convexHull(this.hullPoints()) ?? RAPIER.ColliderDesc.ball(this.R * 0.75);
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(this.prevPos.x, this.prevPos.y, this.prevPos.z)
        .setRotation(this.prevRot)
        .setLinvel(headVel.x + pop.x, headVel.y + pop.y, headVel.z + pop.z)
        .setAngvel({ x: pop.z * 8, y: 0, z: -pop.x * 8 })
        .setLinearDamping(0.3).setAngularDamping(0.6),
    );
    world.createCollider(shape.setDensity(30).setFriction(0.8).setRestitution(0.2).setCollisionGroups(groups), this.body);
    this.looseTime = 0;
  }

  /** Points over the hat's surface, in its own frame (every few vertices: plenty for a hull). */
  private hullPoints(): Float32Array {
    const pts: number[] = [];
    const inv = new THREE.Matrix4().copy(this.root.matrixWorld).invert();
    const m = new THREE.Matrix4();
    this.root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      m.multiplyMatrices(inv, o.matrixWorld);
      const pos = o.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i += 3) {
        this.v.fromBufferAttribute(pos, i).applyMatrix4(m);
        pts.push(this.v.x, this.v.y, this.v.z);
      }
    });
    return new Float32Array(pts);
  }

  /** Back on the head (on `headBone`), back in shape. */
  putOn(world: RAPIER.World, headBone: THREE.Object3D): void {
    if (this.body) { world.removeRigidBody(this.body); this.body = null; }
    headBone.add(this.root);
    this.root.position.set(0, 0, 0);
    this.root.quaternion.identity();
    this.conform();
  }

  /** Before each physics step, while loose: keep the pose to draw from. */
  rememberPose(): void {
    if (!this.body) return;
    const t = this.body.translation(), q = this.body.rotation();
    this.prevPos.set(t.x, t.y, t.z);
    this.prevRot.set(q.x, q.y, q.z, q.w);
  }

  /** While loose: draw it between its last two physics poses. Returns how long it's been loose. */
  sync(dt: number, alpha: number): number {
    if (!this.body) return 0;
    this.looseTime += dt;
    const t = this.body.translation(), q = this.body.rotation();
    this.root.position.set(t.x, t.y, t.z).sub(this.prevPos).multiplyScalar(alpha).add(this.prevPos);
    this.tmpQ.set(q.x, q.y, q.z, q.w);
    this.root.quaternion.slerpQuaternions(this.prevRot, this.tmpQ, alpha);
    return this.looseTime;
  }

  /** Where it lies while loose (the middle of the hat), or null if it's being worn. */
  where(): RAPIER.Vector | null {
    return this.body ? this.body.worldCom() : null;
  }

  get canBePickedUp(): boolean { return this.body !== null && this.looseTime > HAT.pickupDelay; }

  dispose(world: RAPIER.World): void {
    if (this.body) { world.removeRigidBody(this.body); this.body = null; }
    this.root.removeFromParent();
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
    });
  }
}

const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
