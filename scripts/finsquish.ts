// Fin elbow bend direction (forward vs sideways) and head squish amounts.
import * as THREE from 'three';
import { RagdollPhysics, RAPIER } from '../src/ragdoll';
import { SQUISH } from '../src/ragdoll/config';
const phys = await RagdollPhysics.create();
phys.world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0));
const r = phys.createRagdoll(); const R = r as any;
const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), v = new THREE.Vector3();
const elbow = () => { const a = R.parts.get('upperArmL').body.rotation(), b = R.parts.get('forearmL').body.rotation();
  qa.set(a.x, a.y, a.z, a.w).invert(); qb.set(b.x, b.y, b.z, b.w).premultiply(qa); v.set(0, -1, 0).applyQuaternion(qb);
  return { fwd: Math.atan2(v.z, -v.y) * 57.3, side: Math.atan2(v.x, -v.y) * 57.3 }; }; // + fwd = tip forward
const stretch = () => 1 + Math.min(SQUISH.maxStretch, R.jiggle.length() * SQUISH.amount);
const run = (sec: number, label: string) => { let f0 = 99, f1 = -99, sMax = 0, st = 1;
  for (let t = 0; t < sec; t += 1 / 60) { phys.step(1 / 60); const e = elbow(); f0 = Math.min(f0, e.fwd); f1 = Math.max(f1, e.fwd); sMax = Math.max(sMax, Math.abs(e.side)); st = Math.max(st, stretch()); }
  console.log(label.padEnd(10), `elbow fwd ${f0.toFixed(0)}°..${f1.toFixed(0)}°  sideways max ${sMax.toFixed(0)}°  head stretch max ${((st - 1) * 100).toFixed(0)}%`); };
run(1.5, 'idle');
r.setMoveInput(0, 1); run(2, 'walking'); r.setMoveInput(0, 0); run(1, 'stopping');
r.jump(); run(1.2, 'jump');
r.push(new THREE.Vector3(2.5, 0.4, 0)); run(1, 'shove');
run(2, 'settled');
