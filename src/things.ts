/*
 * Sandbox: things to play with, and picking things (and tenants) up.
 *
 * THINGS: a beach ball, a stack of crates, a cushion (all free to push, kick, carry and
 * throw), and a trampoline that bounces anyone who steps on it.
 *
 * CARRYING: the selected tenant picks up whatever's nearest in front of it: a thing is
 * hugged in front of its chest, another tenant is hoisted overhead; either way on a ball
 * joint from its chest. A held thing is weightless and stops
 * bumping the carrier; a held tenant floats, kicks and flails (ActiveRagdoll.setCarried).
 * Throwing lets go with a fling; a thrown tenant goes limp, tumbles, lands, and gets up
 * a moment later, the way the game's throws are meant to play.
 */
import * as THREE from 'three';
import type { ActiveRagdoll } from './ragdoll';
import { RAPIER } from './ragdoll';

export interface Thing {
  name: string;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  mesh: THREE.Object3D;
  /** Rough radius, for reach and for holding it clear of the carrier's head. */
  size: number;
  /** Where it starts, for "reset things". */
  home: THREE.Vector3;
  /** Its pose before the latest physics step (see rememberPose). */
  prevPos: THREE.Vector3;
  prevRot: THREE.Quaternion;
}

interface Trampoline { center: THREE.Vector3; radius: number; top: number }

export class Things {
  readonly list: Thing[] = [];
  private readonly trampolines: Trampoline[] = [];
  /** When each tenant last got bounced, so it bounces once per landing, not every step. */
  private readonly lastBounce = new Map<ActiveRagdoll, number>();
  private time = 0;
  private readonly tmp = new THREE.Vector3();
  private readonly tmpQ = new THREE.Quaternion();

  constructor(private readonly world: RAPIER.World, private readonly scene: THREE.Scene) {
    this.addBall(new THREE.Vector3(1.1, 0.4, 1.3));
    for (let i = 0; i < 3; i++) this.addCrate(new THREE.Vector3(-1.3 + (i === 2 ? 0.05 : 0), 0.16 + i * 0.33, -1.3 + i * 0.02));
    this.addCushion(new THREE.Vector3(2.0, 0.1, -1.6));
    this.addTrampoline(new THREE.Vector3(-1.4, 0, 2.6), 0.6);
  }

  // ---- making things ----

  private addBall(at: THREE.Vector3): void {
    const r = 0.17;
    // A beach ball: six coloured segments around it.
    const geo = new THREE.SphereGeometry(r, 24, 16);
    const colors = ['#ff595e', '#ffffff', '#1982c4', '#ffca3a', '#ffffff', '#8ac926'].map((c) => new THREE.Color(c));
    const pos = geo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const a = (Math.atan2(pos.getZ(i), pos.getX(i)) + Math.PI) / (Math.PI * 2);
      const c = Math.abs(pos.getY(i)) > r * 0.93 ? colors[1] : colors[Math.min(5, Math.floor(a * 6))];
      col.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45 }));
    this.add('beach ball', mesh, at, r,
      RAPIER.RigidBodyDesc.dynamic().setLinearDamping(0.2).setAngularDamping(0.3),
      RAPIER.ColliderDesc.ball(r).setDensity(60).setRestitution(0.75).setFriction(0.5));
  }

  private addCrate(at: THREE.Vector3): void {
    const s = 0.32;
    const mesh = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), new THREE.MeshStandardMaterial({ color: '#c08552', roughness: 0.9 }));
    // Darker slats on the faces, so it reads as a crate.
    const slatMat = new THREE.MeshStandardMaterial({ color: '#8c5a33', roughness: 0.9 });
    for (const y of [-0.1, 0.1]) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(s * 1.02, 0.045, s * 1.02), slatMat);
      slat.position.y = y;
      mesh.add(slat);
    }
    mesh.add(box);
    this.add('crate', mesh, at, s * 0.6,
      RAPIER.RigidBodyDesc.dynamic().setAngularDamping(0.5),
      RAPIER.ColliderDesc.cuboid(s / 2, s / 2, s / 2).setDensity(250).setFriction(0.8));
  }

  private addCushion(at: THREE.Vector3): void {
    const geo = new THREE.BoxGeometry(0.5, 0.14, 0.5, 6, 2, 6);
    // Puff it up a bit so it's soft-looking rather than a slab.
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i) / 0.25, z = p.getZ(i) / 0.25;
      p.setY(i, p.getY(i) * (1.25 - 0.45 * (x * x + z * z) / 2));
    }
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#f4a6c6', roughness: 1 }));
    this.add('cushion', mesh, at, 0.3,
      RAPIER.RigidBodyDesc.dynamic().setLinearDamping(0.6).setAngularDamping(1.5),
      RAPIER.ColliderDesc.cuboid(0.25, 0.07, 0.25).setDensity(80).setRestitution(0).setFriction(1.2));
  }

  private addTrampoline(at: THREE.Vector3, radius: number): void {
    const h = 0.12;
    const group = new THREE.Group();
    const mat = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.86, radius * 0.86, 0.02, 32), new THREE.MeshStandardMaterial({ color: '#2b2d42', roughness: 0.7 }));
    mat.position.y = h - 0.01;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.93, 0.05, 10, 36).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#3a86ff', roughness: 0.5 }));
    rim.position.y = h - 0.02;
    for (let i = 0; i < 6; i++) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, h, 6), new THREE.MeshStandardMaterial({ color: '#8d99ae' }));
      const a = (i / 6) * Math.PI * 2;
      leg.position.set(Math.cos(a) * radius * 0.85, h / 2, Math.sin(a) * radius * 0.85);
      group.add(leg);
    }
    group.add(mat, rim);
    group.position.copy(at);
    group.traverse((o) => { o.castShadow = o.receiveShadow = true; });
    this.scene.add(group);
    // Springy for balls (restitution above 1, and the bouncier of the two wins).
    this.world.createCollider(
      RAPIER.ColliderDesc.cylinder(h / 2, radius).setTranslation(at.x, h / 2, at.z)
        .setRestitution(1.15).setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max),
    );
    this.trampolines.push({ center: at.clone(), radius, top: h });
  }

  private add(name: string, mesh: THREE.Object3D, at: THREE.Vector3, size: number, bodyDesc: RAPIER.RigidBodyDesc, colliderDesc: RAPIER.ColliderDesc): void {
    const body = this.world.createRigidBody(bodyDesc.setTranslation(at.x, at.y, at.z).setCanSleep(true));
    const collider = this.world.createCollider(colliderDesc, body);
    mesh.traverse((o) => { o.castShadow = o.receiveShadow = true; });
    this.scene.add(mesh);
    this.list.push({ name, body, collider, mesh, size, home: at.clone(), prevPos: at.clone(), prevRot: new THREE.Quaternion() });
  }

  // ---- per frame ----

  /**
   * Call before each physics step (RagdollPhysics.beforeStep): keeps every thing's pose,
   * so update() can draw it between the last two steps instead of stuttering.
   */
  rememberPose(): void {
    for (const th of this.list) {
      const p = th.body.translation(), q = th.body.rotation();
      th.prevPos.set(p.x, p.y, p.z);
      th.prevRot.set(q.x, q.y, q.z, q.w);
    }
  }

  /**
   * Bounces tenants standing on a trampoline, and moves the meshes to their bodies.
   * `alpha` is RagdollPhysics.alpha; 1 draws the latest step as it is.
   */
  update(dt: number, tenants: readonly ActiveRagdoll[], alpha = 1): void {
    this.time += dt;
    for (const r of tenants) {
      if (r.isKnockedOut || r.isCarried) continue;
      r.middle(this.tmp);
      for (const t of this.trampolines) {
        const onIt = Math.hypot(this.tmp.x - t.center.x, this.tmp.z - t.center.z) < t.radius * 0.85
          && Math.abs(r.debugState().groundY - t.top) < 0.03;
        // Only count bounces that happened: one refused in the air mustn't hold off the
        // rebound when it lands.
        if (onIt && this.time - (this.lastBounce.get(r) ?? -9) > 0.25 && r.launch(4.6)) {
          this.lastBounce.set(r, this.time);
        }
      }
    }
    for (const th of this.list) {
      const p = th.body.translation(), q = th.body.rotation();
      th.mesh.position.set(p.x, p.y, p.z).sub(th.prevPos).multiplyScalar(alpha).add(th.prevPos);
      th.mesh.quaternion.slerpQuaternions(th.prevRot, this.tmpQ.set(q.x, q.y, q.z, q.w), alpha);
    }
  }

  /** Everything back where it started, still. */
  reset(): void {
    for (const th of this.list) {
      th.body.setTranslation(th.home, true);
      th.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      th.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      th.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
    this.rememberPose(); // a teleport: don't draw them sliding back
  }
}

// ---------------------------------------------------------------- carrying

type Held =
  | { kind: 'thing'; thing: Thing; joint: RAPIER.ImpulseJoint; groups: number }
  | { kind: 'tenant'; tenant: ActiveRagdoll; joint: RAPIER.ImpulseJoint };

/** One tenant (the selected one) carrying one thing or tenant at a time. */
export class Carry {
  carrier: ActiveRagdoll | null = null;
  held: Held | null = null;
  /** Thrown tenants, and how long since they landed, so they get back up. */
  private readonly flying = new Map<ActiveRagdoll, { t: number; landedFor: number }>();
  private readonly v = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();

  constructor(private readonly world: RAPIER.World) {}

  get heldName(): string {
    if (!this.held) return '';
    return this.held.kind === 'thing' ? this.held.thing.name : this.held.tenant.recipe.name;
  }

  /** Picks up the nearest thing or tenant in front of `who`, within reach. */
  grab(who: ActiveRagdoll, things: Things, tenants: readonly ActiveRagdoll[]): string | null {
    if (this.held || who.isKnockedOut || who.isCarried) return null;
    const me = new THREE.Vector3(); who.middle(me);
    const facing = who.debugState().facing;
    const fx = Math.sin(facing), fz = Math.cos(facing);
    const reach = 0.45 + who.dims.bellyR;
    let best: { score: number; pick: () => Held } | null = null;
    const consider = (pos: THREE.Vector3, size: number, pick: () => Held) => {
      const dx = pos.x - me.x, dz = pos.z - me.z, d = Math.hypot(dx, dz);
      if (d > reach + size || pos.y > me.y + 0.6) return;
      const ahead = d > 1e-3 ? (dx * fx + dz * fz) / d : 1;
      if (ahead < -0.2) return; // not behind it
      const score = d - 0.3 * ahead;
      if (!best || score < best.score) best = { score, pick };
    };
    for (const th of things.list) {
      const p = th.body.translation();
      consider(new THREE.Vector3(p.x, p.y, p.z), th.size, () => this.attachThing(who, th));
    }
    for (const r of tenants) {
      if (r === who || r.isCarried) continue;
      const p = new THREE.Vector3(); r.middle(p);
      consider(p, r.dims.bellyR, () => this.attachTenant(who, r));
    }
    if (!best) return null;
    this.held = (best as { pick: () => Held }).pick();
    this.carrier = who;
    // Things are hugged in front; another tenant is hoisted overhead.
    who.setHolding(true, (this.held as Held).kind === 'tenant' ? 'overhead' : 'front');
    return this.heldName;
  }

  /** Where the held thing's centre goes, in the world: above the carrier's head. */
  private holdWorld(who: ActiveRagdoll, extra: number, out: THREE.Vector3, style: 'front' | 'overhead' = 'front'): THREE.Vector3 {
    const c = who.chestBody;
    const hp = who.holdPoint(extra, style);
    const r = c.rotation(), t = c.translation();
    this.q.set(r.x, r.y, r.z, r.w);
    return out.set(hp.x, hp.y, hp.z).applyQuaternion(this.q).add(this.v.set(t.x, t.y, t.z));
  }

  private attachThing(who: ActiveRagdoll, th: Thing): Held {
    const at = this.holdWorld(who, th.size, new THREE.Vector3());
    // Lift it straight to the spot first, so the joint doesn't yank anyone across the room.
    th.body.setTranslation(at, true);
    th.prevPos.copy(at); // a teleport: don't draw it sliding up
    th.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    th.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    th.body.setGravityScale(0, true); // weightless while held
    const groups = th.collider.collisionGroups();
    th.collider.setCollisionGroups(who.collisionGroups); // no bumping the carrier's head
    const hp = who.holdPoint(th.size);
    const joint = this.world.createImpulseJoint(RAPIER.JointData.spherical(hp, { x: 0, y: 0, z: 0 }), who.chestBody, th.body, true);
    return { kind: 'thing', thing: th, joint, groups };
  }

  private attachTenant(who: ActiveRagdoll, r: ActiveRagdoll): Held {
    // Lift the whole tenant so its belly is above the carrier's head, then hold it there.
    const extra = r.dims.bellyR + 0.02;
    const at = this.holdWorld(who, extra, new THREE.Vector3(), 'overhead');
    const feet = at.clone(); feet.y -= r.dims.bellyY;
    r.reset(feet, r.debugState().facing);
    r.setCarried(true);
    r.shareCollisionWith(who); // held overhead, it mustn't bump its carrier's head
    this.flying.delete(r);
    const joint = this.world.createImpulseJoint(
      RAPIER.JointData.spherical(who.holdPoint(extra, 'overhead'), { x: 0, y: 0, z: 0 }), who.chestBody, r.bellyBody, true,
    );
    return { kind: 'tenant', tenant: r, joint };
  }

  /** Lets go. `fling` is the throw velocity (world, units/s); zero puts it down gently. */
  release(fling: THREE.Vector3): void {
    const h = this.held;
    if (!h) return;
    if (h.joint.isValid()) this.world.removeImpulseJoint(h.joint, true);
    if (h.kind === 'thing') {
      const b = h.thing.body;
      b.setGravityScale(1, true);
      h.thing.collider.setCollisionGroups(h.groups);
      b.setLinvel(fling, true);
      b.setAngvel({ x: (Math.random() - 0.5) * 6, y: (Math.random() - 0.5) * 6, z: (Math.random() - 0.5) * 6 }, true);
    } else {
      const r = h.tenant;
      r.setCarried(false);
      r.shareCollisionWith(null);
      if (fling.lengthSq() > 0.5) {
        // Thrown: limp in the air, tumbling, then up again a moment after landing.
        r.setKnockedOut(true);
        r.push(fling);
        this.flying.set(r, { t: 0, landedFor: 0 });
      }
    }
    this.carrier?.setHolding(false);
    this.held = null;
    this.carrier = null;
  }

  /** Throws the held thing forward and up, from the way the carrier faces. */
  throw(power = 1): void {
    if (!this.carrier) return;
    const f = this.carrier.debugState().facing;
    const v = this.carrier.bellyBody.linvel();
    this.release(new THREE.Vector3(Math.sin(f) * 3.4 * power + v.x, 2.6 * power, Math.cos(f) * 3.4 * power + v.z));
  }

  /** Per frame: let go if anything's changed under us, and get thrown tenants back up. */
  update(dt: number, tenants: readonly ActiveRagdoll[]): void {
    const h = this.held;
    if (h && this.carrier) {
      const gone = !tenants.includes(this.carrier) || (h.kind === 'tenant' && !tenants.includes(h.tenant)) || !h.joint.isValid();
      if (gone || this.carrier.isKnockedOut) this.release(new THREE.Vector3());
    }
    for (const [r, f] of this.flying) {
      if (!tenants.includes(r)) { this.flying.delete(r); continue; }
      f.t += dt;
      const v = r.bellyBody.linvel();
      // Landed (slow, after a moment in the air)? Lie there flopped a bit, then get up.
      if (f.t > 0.6 && Math.hypot(v.x, v.y, v.z) < 0.4) f.landedFor += dt; else f.landedFor = 0;
      if (f.landedFor > 1.2 || f.t > 6) { r.setKnockedOut(false); this.flying.delete(r); }
    }
  }
}
