// How floppy are the fins? Measures how far the shoulder and elbow stray from their
// pose targets (overshoot / wobble) while walking, stopping and after a turn.
import * as THREE from 'three';
import { RagdollPhysics, RAPIER } from '../src/ragdoll';
const phys = await RagdollPhysics.create();
phys.world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0));
const r = phys.createRagdoll(); const R = r as any;
const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), e = new THREE.Euler();
// Joint angle (rotation vector) of child relative to parent.
const rel = (p: string, c: string, out: THREE.Vector3) => {
  const a = R.parts.get(p).body.rotation(), b = R.parts.get(c).body.rotation();
  qa.set(a.x, a.y, a.z, a.w).invert(); qb.set(b.x, b.y, b.z, b.w).premultiply(qa);
  if (qb.w < 0) qb.set(-qb.x, -qb.y, -qb.z, -qb.w);
  const s = Math.sqrt(Math.max(0, 1 - qb.w * qb.w)); const k = s < 1e-6 ? 2 : 2 * Math.acos(Math.min(1, qb.w)) / s;
  return out.set(qb.x * k, qb.y * k, qb.z * k);
};
const tgt = (n: string) => R.joints.find((j: any) => j.def.name === n).target as THREE.Vector3;
const v = new THREE.Vector3();
let worstS = 0, worstE = 0, sumS = 0, sumE = 0, n = 0;
const ax = { s: new THREE.Vector3(), e: new THREE.Vector3() }; const w = new THREE.Vector3();
const sample = () => { ax.s.add(w.copy(rel('chest', 'upperArmL', v)).sub(tgt('upperArmL')).set(Math.abs(w.x), Math.abs(w.y), Math.abs(w.z))); ax.e.add(w.copy(rel('upperArmL', 'forearmL', v)).sub(tgt('forearmL')).set(Math.abs(w.x), Math.abs(w.y), Math.abs(w.z))); const s = rel('chest', 'upperArmL', v).distanceTo(tgt('upperArmL')); const el = rel('upperArmL', 'forearmL', v).distanceTo(tgt('forearmL'));
  worstS = Math.max(worstS, s); worstE = Math.max(worstE, el); sumS += s; sumE += el; n++; };
const run = (sec: number) => { for (let t = 0; t < sec; t += 1 / 60) { phys.step(1 / 60); sample(); } };
run(1);
r.setMoveInput(0, 1); run(2);
r.setMoveInput(1, 0); run(1);
r.setMoveInput(0, 0); run(1.5);
const d = (x: number) => (x * 57.3).toFixed(0) + '°';
console.log(`shoulder off-target: avg ${d(sumS / n)} worst ${d(worstS)} | elbow off-target: avg ${d(sumE / n)} worst ${d(worstE)}`);
const ax3 = (a: THREE.Vector3) => `swing-fwd ${d(a.x / n)} twist ${d(a.y / n)} swing-out ${d(a.z / n)}`;
console.log(`  shoulder avg by axis: ${ax3(ax.s)}\n  elbow avg by axis:    ${ax3(ax.e)}`);
