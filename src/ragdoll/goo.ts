/*
 * The head as a ball of thick, non-Newtonian glop (visual only; the physics head stays
 * a rigid sphere).
 *
 * Every vertex of the head mesh is a little blob of goo with its own offset and
 * velocity, in the head's own frame:
 *   - a weak spring pulls it back toward the head's rest shape, strongest near the neck
 *     (where the goo is "held") and weakest on top, so the top sags and sloshes most;
 *   - gravity and the head's own acceleration push the goo about: it droops, and when
 *     the body lurches the goo lags, smears and sloshes back;
 *   - neighbours pull on each other (surface tension), so it deforms in smooth flowing
 *     lumps rather than per-vertex noise;
 *   - viscosity is SHEAR-THICKENING: the faster the goo moves, the thicker it gets. A
 *     sudden hit barely dents it at first, then it slowly oozes and spreads, and it
 *     never bounces back; like cornflour slime;
 *   - it keeps its volume: flatten one side and the rest bulges out;
 *   - against a surface it can't pass through, it flattens and spreads, with friction.
 *
 * It runs once per rendered frame on ~400 vertices with a stable (implicitly damped)
 * step, and allocates nothing while running.
 */
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { GOO } from './config';

/** A plane the head is touching, in world space: points p with n·(p − head) ≥ −reach. */
export interface GooContact {
  active: boolean;
  /** Out of the surface, into the head. */
  normal: THREE.Vector3;
  /** How far from the head's centre the surface is (the physics sphere's radius). */
  reach: number;
}

/** Goo steps per second. */
const GOO_RATE = 30;

export class GooHead {
  readonly mesh: THREE.Mesh;
  /** Rest positions (head frame), and unit rest normals. */
  readonly rest: Float32Array;
  private readonly restN: Float32Array;
  /** Offsets from rest, and their velocities. Read by the face to ride the surface. */
  readonly offset: Float32Array;
  private readonly vel: Float32Array;
  /** How firmly each vertex is held: 1 at the neck, less on top. */
  private readonly anchor: Float32Array;
  /** Neighbours of each vertex, packed: indices nbr[nbrStart[i] .. nbrStart[i+1]). */
  private readonly nbrStart: Uint32Array;
  private readonly nbr: Uint32Array;
  private readonly count: number;
  private readonly radius: number;
  private readonly positions: THREE.BufferAttribute;
  private readonly normals: THREE.BufferAttribute;
  private readonly tris: ArrayLike<number>;
  // Scratch.
  private readonly qInv = new THREE.Quaternion();
  private readonly push = new THREE.Vector3();
  private readonly nLocal = new THREE.Vector3();
  /**
   * Resting: the goo has settled and nothing's pushing it, so updates are skipped (most
   * of the time an idle tenant's head costs nothing). Woken by any lurch, touch or kick.
   */
  private resting = false;
  /**
   * Time saved up toward the next goo step. The goo steps at most 30 times a second
   * (thick glop moves slowly, so that's plenty), and each head starts at a random point
   * in that cycle so a crowd's heads take turns rather than all updating on one frame.
   */
  private pending = Math.random() / GOO_RATE;
  private wasTouching = false;
  private lastTone = 1;

  constructor(radius: number, material: THREE.Material) {
    this.radius = radius;
    let geo: THREE.BufferGeometry = new THREE.SphereGeometry(radius, 22, 14); // ~290 points: smooth enough at this size, cheap enough for 13
    geo.deleteAttribute('uv');
    geo.deleteAttribute('normal');
    geo = mergeVertices(geo); // weld the seam and poles so the goo is one connected surface
    geo.computeVertexNormals();
    // No clothes painted on the head (it shares the skin's material; see outfit.ts).
    geo.setAttribute('clothA', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 4), 4));
    geo.setAttribute('clothB', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 4), 4));
    const pos = geo.attributes.position as THREE.BufferAttribute;
    this.positions = pos;
    this.normals = geo.attributes.normal as THREE.BufferAttribute;
    this.tris = geo.index!.array;
    const n = pos.count;
    this.count = n;
    this.rest = new Float32Array(pos.array as Float32Array);
    this.restN = new Float32Array(n * 3);
    this.anchor = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = this.rest[3 * i], y = this.rest[3 * i + 1], z = this.rest[3 * i + 2];
      const len = Math.hypot(x, y, z) || 1;
      this.restN[3 * i] = x / len; this.restN[3 * i + 1] = y / len; this.restN[3 * i + 2] = z / len;
      // Held at the bottom (by the neck), loose on top.
      const fromNeck = (1 - y / len) / 2; // 1 at the bottom, 0 at the top
      this.anchor[i] = 0.2 + 0.8 * fromNeck ** 1.5;
    }
    this.offset = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);

    // Neighbour lists from the triangles.
    const sets: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
    const idx = geo.index!.array;
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t], b = idx[t + 1], c = idx[t + 2];
      sets[a].add(b); sets[a].add(c); sets[b].add(a); sets[b].add(c); sets[c].add(a); sets[c].add(b);
    }
    this.nbrStart = new Uint32Array(n + 1);
    let total = 0;
    for (let i = 0; i < n; i++) { this.nbrStart[i] = total; total += sets[i].size; }
    this.nbrStart[n] = total;
    this.nbr = new Uint32Array(total);
    for (let i = 0, k = 0; i < n; i++) for (const j of sets[i]) this.nbr[k++] = j;

    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false; // it moves with the body; its rest bounds don't
  }

  /** Back to a perfect ball, still. */
  reset(): void {
    this.pending = 0;
    this.offset.fill(0);
    this.vel.fill(0);
    this.resting = false;
    this.writeMesh();
  }

  /** A jolt (world space, units/s) to every bit of goo, e.g. a stomp's thump. */
  kick(worldVel: THREE.Vector3, headRotation: THREE.Quaternion): void {
    this.push.copy(worldVel).applyQuaternion(this.qInv.copy(headRotation).invert());
    for (let i = 0; i < this.count; i++) {
      const loose = 1 - 0.7 * this.anchor[i];
      this.vel[3 * i] += this.push.x * loose;
      this.vel[3 * i + 1] += this.push.y * loose;
      this.vel[3 * i + 2] += this.push.z * loose;
    }
    this.resting = false;
  }

  /**
   * One step of goo.
   * @param headRotation the head's world rotation
   * @param accel the head's world acceleration (the goo lags behind it)
   * @param softness from the character's traits (a baby's head is softer)
   * @param tone 1 = awake and holding itself together, 0 = out cold: the goo loses its
   *   firmness and puddles under its own weight
   */
  update(
    dt: number, headRotation: THREE.Quaternion, accel: THREE.Vector3, contact: GooContact,
    softness: number, tone: number,
  ): void {
    if (dt <= 0) return;
    this.pending += dt;
    if (this.pending < 1 / GOO_RATE) return;
    dt = Math.min(this.pending, 0.1);
    this.pending = 0;
    // Asleep until something changes: a lurch, a new touch, or the muscles going or coming back.
    const woken = accel.lengthSq() > 0.25 || contact.active !== this.wasTouching || Math.abs(tone - this.lastTone) > 0.01;
    this.wasTouching = contact.active;
    this.lastTone = tone;
    if (this.resting && !woken) return;
    // Long frames are split so the goo stays stable.
    const steps = Math.min(4, Math.ceil(dt / (1 / GOO_RATE) - 1e-6));
    const h = dt / steps;
    this.qInv.copy(headRotation).invert();
    // Gravity and the lurch of the head, as an acceleration felt by the goo, in head frame.
    const limp = 1 - tone;
    this.push.set(0, -9.81 * GOO.sag * softness * (1 + GOO.limpSag * limp), 0)
      .addScaledVector(accel, -GOO.slosh * softness).applyQuaternion(this.qInv);
    if (contact.active) this.nLocal.copy(contact.normal).applyQuaternion(this.qInv);
    const k = (GOO.firmness / softness) * (1 - GOO.limpLoss * limp), kSurf = GOO.surfaceTension;
    const R = this.radius, maxOff = GOO.maxStretch * R;
    const u = this.offset, v = this.vel, rest = this.rest, rn = this.restN;

    for (let s = 0; s < steps; s++) {
      let radial = 0;
      let fastest = 0;
      for (let i = 0; i < this.count; i++) {
        const i3 = 3 * i, a = this.anchor[i];
        // Surface tension: pull toward the neighbours' average offset.
        let mx = 0, my = 0, mz = 0;
        const b = this.nbrStart[i], e = this.nbrStart[i + 1];
        for (let j = b; j < e; j++) { const n3 = 3 * this.nbr[j]; mx += u[n3]; my += u[n3 + 1]; mz += u[n3 + 2]; }
        const inv = 1 / (e - b);
        const loose = 1 - 0.75 * a;
        const ax = -k * a * u[i3] + kSurf * (mx * inv - u[i3]) + this.push.x * loose;
        const ay = -k * a * u[i3 + 1] + kSurf * (my * inv - u[i3 + 1]) + this.push.y * loose;
        const az = -k * a * u[i3 + 2] + kSurf * (mz * inv - u[i3 + 2]) + this.push.z * loose;
        // Shear-thickening viscosity: thicker the faster it's moving. Applied implicitly
        // (divide rather than subtract), so even very thick goo can't blow up.
        const speed = Math.sqrt(v[i3] * v[i3] + v[i3 + 1] * v[i3 + 1] + v[i3 + 2] * v[i3 + 2]);
        if (speed > fastest) fastest = speed;
        const damp = 1 / (1 + (GOO.viscosity + GOO.thickening * speed) * h);
        v[i3] = (v[i3] + ax * h) * damp;
        v[i3 + 1] = (v[i3 + 1] + ay * h) * damp;
        v[i3 + 2] = (v[i3 + 2] + az * h) * damp;
        u[i3] += v[i3] * h; u[i3 + 1] += v[i3 + 1] * h; u[i3 + 2] += v[i3 + 2] * h;
        radial += u[i3] * rn[i3] + u[i3 + 1] * rn[i3 + 1] + u[i3 + 2] * rn[i3 + 2];
      }
      this.resting = fastest < 2e-4;
      // Keep the volume: if it's been squashed in on average, push everything back out
      // along its normal (so a flattened side makes the rest bulge).
      const fix = (radial / this.count) * GOO.keepVolume;
      for (let i = 0; i < this.count; i++) {
        const i3 = 3 * i;
        u[i3] -= rn[i3] * fix; u[i3 + 1] -= rn[i3 + 1] * fix; u[i3 + 2] -= rn[i3 + 2] * fix;
      }
      // Against a surface: no goo past it; it flattens there, and friction stops it sliding.
      if (contact.active) {
        const nl = this.nLocal, reach = -contact.reach;
        for (let i = 0; i < this.count; i++) {
          const i3 = 3 * i;
          const d = (rest[i3] + u[i3]) * nl.x + (rest[i3 + 1] + u[i3 + 1]) * nl.y + (rest[i3 + 2] + u[i3 + 2]) * nl.z;
          if (d >= reach) continue;
          const pen = reach - d;
          u[i3] += nl.x * pen; u[i3 + 1] += nl.y * pen; u[i3 + 2] += nl.z * pen;
          const vn = v[i3] * nl.x + v[i3 + 1] * nl.y + v[i3 + 2] * nl.z;
          const f = 1 - GOO.friction;
          v[i3] = (v[i3] - (vn < 0 ? vn : 0) * nl.x) * f;
          v[i3 + 1] = (v[i3 + 1] - (vn < 0 ? vn : 0) * nl.y) * f;
          v[i3 + 2] = (v[i3 + 2] - (vn < 0 ? vn : 0) * nl.z) * f;
        }
      }
      // Never stretch past the limit (keeps a hard knock from turning it inside out).
      for (let i = 0; i < this.count; i++) {
        const i3 = 3 * i;
        const len = Math.sqrt(u[i3] * u[i3] + u[i3 + 1] * u[i3 + 1] + u[i3 + 2] * u[i3 + 2]);
        if (len > maxOff) { const sc = maxOff / len; u[i3] *= sc; u[i3 + 1] *= sc; u[i3 + 2] *= sc; }
      }
    }
    this.writeMesh();
  }

  /**
   * Writes the deformed positions and fresh normals. The normals are summed straight
   * from the fixed triangle list over raw arrays: about 3× faster than three.js's
   * general computeVertexNormals, which was most of the goo's cost.
   */
  private writeMesh(): void {
    const p = this.positions.array as Float32Array;
    for (let i = 0; i < p.length; i++) p[i] = this.rest[i] + this.offset[i];
    const nrm = this.normals.array as Float32Array;
    nrm.fill(0);
    const idx = this.tris;
    for (let t = 0; t < idx.length; t += 3) {
      const a = 3 * idx[t], b = 3 * idx[t + 1], c = 3 * idx[t + 2];
      const e1x = p[b] - p[a], e1y = p[b + 1] - p[a + 1], e1z = p[b + 2] - p[a + 2];
      const e2x = p[c] - p[a], e2y = p[c + 1] - p[a + 1], e2z = p[c + 2] - p[a + 2];
      // Cross product, area-weighted, added to all three corners.
      const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      nrm[a] += nx; nrm[a + 1] += ny; nrm[a + 2] += nz;
      nrm[b] += nx; nrm[b + 1] += ny; nrm[b + 2] += nz;
      nrm[c] += nx; nrm[c + 1] += ny; nrm[c + 2] += nz;
    }
    for (let i = 0; i < nrm.length; i += 3) {
      const l = Math.sqrt(nrm[i] * nrm[i] + nrm[i + 1] * nrm[i + 1] + nrm[i + 2] * nrm[i + 2]) || 1;
      nrm[i] /= l; nrm[i + 1] /= l; nrm[i + 2] /= l;
    }
    this.positions.needsUpdate = true;
    this.normals.needsUpdate = true;
  }

  /** The vertex nearest a direction from the centre (for pinning face features to the goo). */
  nearestVertex(dir: THREE.Vector3): number {
    let best = 0, bestDot = -Infinity;
    const d = dir.clone().normalize();
    for (let i = 0; i < this.count; i++) {
      const dot = this.restN[3 * i] * d.x + this.restN[3 * i + 1] * d.y + this.restN[3 * i + 2] * d.z;
      if (dot > bestDot) { bestDot = dot; best = i; }
    }
    return best;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
  }
}
