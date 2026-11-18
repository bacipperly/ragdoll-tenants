// Compares the walk cycle's leg targets with what the legs actually do.
import * as THREE from 'three';
import { RagdollPhysics, RAPIER } from '../src/ragdoll';
const phys = await RagdollPhysics.create();
phys.world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0));
phys.world.numSolverIterations = Number(process.env.ITERS ?? phys.world.numSolverIterations);
const r = phys.createRagdoll();
const R = r as any;
const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), v = new THREE.Vector3();
// Swing of a child relative to its parent about the parent's x axis (forward = negative), via the child's down vector.
const rel = (p: string, c: string) => {
  const a = R.parts.get(p).body.rotation(), b = R.parts.get(c).body.rotation();
  qa.set(a.x, a.y, a.z, a.w).invert(); qb.set(b.x, b.y, b.z, b.w).premultiply(qa);
  v.set(0, -1, 0).applyQuaternion(qb); return Math.atan2(-v.z, -v.y); // + = foot behind
};
const tgt = (n: string) => R.joints.find((j: any) => j.def.name === n).target.x;
for (let t = 0; t < 1; t += 1 / 60) phys.step(1 / 60);
r.setMoveInput(0, 1);
for (let t = 0; t < 1; t += 1 / 60) phys.step(1 / 60);
let tMin = 9, tMax = -9, aMin = 9, aMax = -9, kMax = 0, kaMax = 0;
for (let t = 0; t < 2; t += 1 / 60) {
  phys.step(1 / 60);
  const T = tgt('thighL'), A = rel('torso', 'thighL');
  tMin = Math.min(tMin, T); tMax = Math.max(tMax, T); aMin = Math.min(aMin, A); aMax = Math.max(aMax, A);
  kMax = Math.max(kMax, tgt('shinL')); kaMax = Math.max(kaMax, rel('thighL', 'shinL'));
}
const d = (x: number) => (x * 57.3).toFixed(0) + '°';
console.log('hip target range', d(tMin), '..', d(tMax), '| actual', d(aMin), '..', d(aMax));
console.log('knee target max', d(kMax), '| actual max', d(kaMax));
