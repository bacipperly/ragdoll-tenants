// Head goo: sag standing, slosh walking/stopping, flatten + spread on a fall, ooze back.
import * as THREE from 'three';
import { RagdollPhysics, RAPIER } from '../src/ragdoll';
import { applyTuning } from '../src/ragdoll/tuning';
if (process.env.CODE === '1') applyTuning({});
const phys = await RagdollPhysics.create(); phys.world.numInternalPgsIterations = 3;
phys.world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0));
const r = phys.createRagdoll(); const R = r as any; const goo = R.goo;
const R0 = r.dims.headR;
// Biggest offset, and the head's width/height in world terms (from the mesh, local frame ≈ world when upright).
const stats = () => { const u: Float32Array = goo.offset, rest: Float32Array = goo.rest; let max = 0, minY = 9, maxY = -9, minX = 9, maxX = -9;
  for (let i = 0; i < u.length; i += 3) { max = Math.max(max, Math.hypot(u[i], u[i + 1], u[i + 2])); const y = rest[i + 1] + u[i + 1], x = rest[i] + u[i]; minY = Math.min(minY, y); maxY = Math.max(maxY, y); minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
  return { max: max / R0, h: (maxY - minY) / (2 * R0), w: (maxX - minX) / (2 * R0) }; };
const watch = (s: number, label: string) => { let peak = 0; for (let t = 0; t < s; t += 1 / 60) { phys.step(1 / 60); peak = Math.max(peak, stats().max); } const st = stats();
  console.log(label.padEnd(18), `peak deform ${(peak * 100).toFixed(0).padStart(3)}%  now ${(st.max * 100).toFixed(0).padStart(3)}%  (head local: tall ${(st.h * 100).toFixed(0)}%, wide ${(st.w * 100).toFixed(0)}%)`); };
watch(2, 'standing');
r.setMoveInput(0, 1); watch(1.5, 'walking'); r.setMoveInput(0, 0); watch(0.6, 'stopping'); watch(2, 'settled');
r.reset(new THREE.Vector3(0, 1.0, 0)); r.setKnockedOut(true); watch(2.5, 'dropped, lying');
watch(2, 'still lying');
r.setKnockedOut(false); watch(1, 'getting up'); watch(3, 'up again');
const t0 = performance.now(); for (let i = 0; i < 300; i++) goo.update(1 / 60, R.part('head').bone.quaternion, new THREE.Vector3(3, 0, 0), R.gooContact, 1);
console.log('goo cost per head per frame:', ((performance.now() - t0) / 300).toFixed(3), 'ms');
