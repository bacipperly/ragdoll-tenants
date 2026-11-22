/*
 * Clothes that are real meshes rather than paint (see outfit.ts for the painted ones,
 * hat.ts for hats and a hood that's up):
 *
 * - SKIRT: a lathed tube from the waist, flaring to its hem. It rides the belly, and
 *   every frame its lower rings are pushed out of the way of the legs, so a lifted knee
 *   bulges it rather than poking through. It trails a little behind when walking.
 * - HOOD DOWN: a hoodie's hood lying on the upper back, riding the chest.
 *
 * Neither allocates per frame.
 */
import * as THREE from 'three';
import type { BodyDims } from './proportions';
import type { Outfit } from './outfit';

const RINGS = 7;
const AROUND = 36;

/** The skin's radius at height y (its profile is [height, radius] pairs, bottom up). */
export function profileRadius(profile: readonly (readonly [number, number])[], y: number): number {
  for (let i = 1; i < profile.length; i++) {
    const [h0, r0] = profile[i - 1], [h1, r1] = profile[i];
    if (y >= h0 && y <= h1) return r0 + (r1 - r0) * ((y - h0) / Math.max(1e-6, h1 - h0));
  }
  return 0;
}

export interface LegBones { thigh: THREE.Object3D; shin: THREE.Object3D }

export class Skirt {
  readonly mesh: THREE.Mesh;
  private readonly rest: Float32Array;
  /** 0 at the waist … 1 at the hem, per vertex. */
  private readonly depth: Float32Array;
  private readonly legR: number;
  private readonly torsoInv = new THREE.Quaternion();
  private readonly prevTorso = new THREE.Vector3();
  private readonly lag = new THREE.Vector3();
  private readonly lagVel = new THREE.Vector3();
  private readonly segs = Array.from({ length: 4 }, () => [new THREE.Vector3(), new THREE.Vector3()] as const);
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private started = false;

  /**
   * @param torsoY the belly bone's rest height (the mesh is built in its frame).
   */
  constructor(o: NonNullable<Outfit['skirt']>, private readonly dims: BodyDims, torsoY: number) {
    const D = dims;
    const top = D.hipY + 0.5 * (D.spineY - D.hipY);
    const bottom = THREE.MathUtils.lerp(D.hipY - 0.3 * D.thighLen, D.hipY - D.thighLen - 0.35 * D.shinLen, o.length);
    this.legR = Math.max(D.thighR, D.shinR) * 1.1 + 0.006;
    const C = D.cheeks;
    const count = (RINGS + 1) * (AROUND + 1);
    const pos = new Float32Array(count * 3);
    this.depth = new Float32Array(count);
    const uv = new Float32Array(count * 2);
    let widest = 0;
    for (let j = 0; j <= RINGS; j++) {
      const t = j / RINGS;
      const y = THREE.MathUtils.lerp(top, bottom, t);
      // Wide enough for everything between here and the waist (a skirt hangs over the belly).
      for (let k = 0; k <= 8; k++) widest = Math.max(widest, profileRadius(D.skin.body, THREE.MathUtils.lerp(y, top, k / 8)));
      const r0 = widest * 1.1 + 0.005 + D.bellyR * (0.12 + 0.75 * o.flare) * t;
      for (let i = 0; i <= AROUND; i++) {
        const ang = (i / AROUND) * Math.PI * 2;
        const r = r0 * (o.pleats ? 1 + 0.05 * t * Math.cos(ang * 16) : 1);
        const v = j * (AROUND + 1) + i;
        let x = Math.sin(ang) * r, z = Math.cos(ang) * r;
        // Out round the butt.
        if (C.r > 0) {
          for (const sx of [1, -1]) {
            const dx = x - sx * C.x, dy = y - C.y, dz = z - C.z;
            const d = Math.hypot(dx, dy, dz), need = C.r * 1.06 + 0.004;
            if (d < need) { const h = Math.hypot(dx, dz) || 1; x += (dx / h) * (need - d); z += (dz / h) * (need - d); }
          }
        }
        pos.set([x, y - torsoY, z], v * 3);
        this.depth[v] = t;
        uv.set([i / AROUND, t], v * 2);
      }
    }
    const index: number[] = [];
    for (let j = 0; j < RINGS; j++) {
      for (let i = 0; i < AROUND; i++) {
        const a = j * (AROUND + 1) + i, b = a + AROUND + 1;
        index.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(index);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    geo.boundingSphere!.radius *= 1.5;
    this.rest = new Float32Array(pos);
    const color = new THREE.Color(o.color);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.85, side: THREE.DoubleSide }));
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    // Its waistband: a slightly darker band round the top ring.
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, 1, AROUND, 1, true),
      new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(0.8), roughness: 0.85, side: THREE.DoubleSide }),
    );
    const bandR = profileRadius(D.skin.body, top) * 1.1 + 0.006;
    band.scale.set(bandR, 0.012, bandR);
    band.position.y = top - torsoY - 0.004;
    this.mesh.add(band);
  }

  /**
   * Once per rendered frame: trail behind the belly's motion and get out of the legs' way.
   * `torso` is the belly bone (the skirt's parent).
   */
  update(dt: number, torso: THREE.Object3D, legs: readonly LegBones[]): void {
    const D = this.dims;
    this.torsoInv.copy(torso.quaternion).invert();
    // The belly's velocity in its own frame; the hem lags it (a soft spring), so it swings
    // back when walking off and forward when stopping.
    if (!this.started) { this.prevTorso.copy(torso.position); this.started = true; }
    this.a.copy(torso.position).sub(this.prevTorso).divideScalar(Math.max(1e-3, dt)).applyQuaternion(this.torsoInv);
    this.prevTorso.copy(torso.position);
    this.b.set(-this.a.x, 0.3 * Math.max(0, -this.a.y), -this.a.z).multiplyScalar(0.025);
    if (this.b.length() > 0.03) this.b.setLength(0.03);
    const k = 180, c = 2 * 0.45 * Math.sqrt(k);
    this.lagVel.addScaledVector(this.b.sub(this.lag), k * dt).addScaledVector(this.lagVel, -c * dt);
    this.lag.addScaledVector(this.lagVel, dt);

    // Each leg as two segments (hip → knee → tip), in the belly's frame.
    let n = 0;
    for (const leg of legs) {
      const [h, kn] = this.segs[n++], [k2, tip] = this.segs[n++];
      this.toLocal(leg.thigh, D.thighLen / 2, torso, h);
      this.toLocal(leg.thigh, -D.thighLen / 2, torso, kn);
      k2.copy(kn);
      this.toLocal(leg.shin, -D.shinLen / 2, torso, tip);
    }

    const pos = this.mesh.geometry.attributes.position as THREE.BufferAttribute;
    const p = pos.array as Float32Array, rest = this.rest, R = this.legR;
    for (let v = 0; v < this.depth.length; v++) {
      const t = this.depth[v], o = v * 3;
      let x = rest[o], y = rest[o + 1], z = rest[o + 2];
      if (t > 0) {
        const w = t * t;
        x += this.lag.x * w; y += this.lag.y * w; z += this.lag.z * w;
        for (let s = 0; s < this.segs.length; s++) {
          const [s0, s1] = this.segs[s];
          // Closest point on the segment.
          const ex = s1.x - s0.x, ey = s1.y - s0.y, ez = s1.z - s0.z;
          const l2 = ex * ex + ey * ey + ez * ez || 1;
          const u = Math.max(0, Math.min(1, ((x - s0.x) * ex + (y - s0.y) * ey + (z - s0.z) * ez) / l2));
          const dx = x - (s0.x + ex * u), dy = y - (s0.y + ey * u), dz = z - (s0.z + ez * u);
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (d < R) {
            // Out, sideways from the leg (or straight out from the middle if it's dead on).
            let hx = dx, hz = dz, hl = Math.hypot(hx, hz);
            if (hl < 1e-5) { hx = x; hz = z; hl = Math.hypot(hx, hz) || 1; }
            x += (hx / hl) * (R - d); z += (hz / hl) * (R - d);
          }
        }
      }
      p[o] = x; p[o + 1] = y; p[o + 2] = z;
    }
    pos.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
  }

  /** A point `along` a limb bone's axis (its local y), in the belly's frame. */
  private toLocal(bone: THREE.Object3D, along: number, torso: THREE.Object3D, out: THREE.Vector3): void {
    out.set(0, along, 0).applyQuaternion(bone.quaternion).add(bone.position)
      .sub(torso.position).applyQuaternion(this.torsoInv);
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.traverse((o) => {
      if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
    });
  }
}

/** A hoodie's hood, down: a soft hollow lying on the upper back. Built in the chest's frame. */
export function hoodDown(color: string, dims: BodyDims, chestY: number): THREE.Mesh {
  const D = dims;
  const r = Math.max(D.chestR * 1.35, 0.055);
  const geo = new THREE.SphereGeometry(r, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  geo.rotateX(-Math.PI / 2); // the dome bulges out backwards
  geo.scale(1.1, 0.85, 0.5);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    color: new THREE.Color(color).multiplyScalar(0.92), roughness: 0.9, side: THREE.DoubleSide,
  }));
  mesh.position.set(0, D.shoulderY - chestY - 0.012, -profileRadius(D.skin.body, D.shoulderY - 0.012) * 0.85);
  mesh.rotation.x = 0.25; // tipped to lie against the back
  mesh.castShadow = true;
  return mesh;
}

export function disposeMesh(m: THREE.Mesh | null): void {
  if (!m) return;
  m.removeFromParent();
  m.geometry.dispose();
  (m.material as THREE.Material).dispose();
}
