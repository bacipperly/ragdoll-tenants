// Bow: do the feet stay down and behind/under the body? Flinch: does it lean back and step back?
// Nod: how much does the belly move?
import * as THREE from 'three';
import { RagdollPhysics, RAPIER } from '../src/ragdoll';
import { GESTURES, type GestureName } from '../src/ragdoll/gestures';
const q = new THREE.Quaternion(), up = new THREE.Vector3();
for (const name of ['bow', 'flinch', 'nod', 'startle', 'celebrate'] as GestureName[]) {
  const phys = await RagdollPhysics.create();
  phys.world.numInternalPgsIterations = 3;
  phys.world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0));
  const r = phys.createRagdoll(); const R = r as any;
  const b = (n: string) => R.parts.get(n).body;
  for (let t = 0; t < 1.5; t += 1 / 60) phys.step(1 / 60);
  const z0 = b('torso').translation().z;
  let footUp = 0, footBack = 0, chestFwd = 0, leanFwd = 0, leanBack = 0, bellyMove = 0;
  const p0 = b('torso').translation();
  r.playGesture(name);
  for (let t = 0; t < GESTURES[name].seconds; t += 1 / 60) {
    phys.step(1 / 60);
    const tz = b('torso').translation();
    for (const s of ['shinL', 'shinR']) {
      const sh = b(s).translation();
      footUp = Math.max(footUp, sh.y);
      footBack = Math.max(footBack, tz.z - sh.z); // facing +z: positive = foot behind
    }
    const c = b('chest').translation();
    chestFwd = Math.max(chestFwd, c.z - tz.z);
    const o = b('torso').rotation(); q.set(o.x, o.y, o.z, o.w); up.set(0, 1, 0).applyQuaternion(q);
    leanFwd = Math.max(leanFwd, up.z); leanBack = Math.min(leanBack, up.z);
    bellyMove = Math.max(bellyMove, Math.hypot(tz.x - p0.x, tz.z - p0.z));
  }
  const moved = b('torso').translation().z - z0;
  console.log(`${name.padEnd(9)} shin max y ${(footUp * 100).toFixed(1)}cm  shin behind ${(footBack * 100).toFixed(1)}cm  chest ahead ${(chestFwd * 100).toFixed(1)}cm  belly lean fwd ${(Math.asin(leanFwd) * 57.3).toFixed(0)}° back ${(Math.asin(leanBack) * 57.3).toFixed(0)}°  slid ${(moved * 100).toFixed(1)}cm  belly wander ${(bellyMove * 100).toFixed(1)}cm`);
}
