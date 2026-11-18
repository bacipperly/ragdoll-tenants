// Every mood: is it stable (stand, walk, jump, shove, knockout), and does it read?
// Reports head pitch (+ = chin up), chest pitch (+ = puffed back), fin height, walk speed.
import * as THREE from 'three';
import { RagdollPhysics, RAPIER } from '../src/ragdoll';
import { MOOD_NAMES } from '../src/ragdoll/mood';
import { applyTuning } from '../src/ragdoll/tuning';
if (process.env.CODE === '1') applyTuning({});
const fwd = new THREE.Vector3(), up = new THREE.Vector3(), q = new THREE.Quaternion();
for (const mood of MOOD_NAMES) {
  const phys = await RagdollPhysics.create();
  phys.world.numInternalPgsIterations = 3;
  phys.world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0));
  const r = phys.createRagdoll(); const R = r as any;
  const body = (n: string) => R.parts.get(n).body;
  const pitch = (n: string) => { const o = body(n).rotation(); q.set(o.x, o.y, o.z, o.w); up.set(0, 1, 0).applyQuaternion(q); return Math.atan2(-up.z, up.y) * 57.3; }; // + = top tipped back (−z)
  const tilt = () => { const o = body('torso').rotation(); return Math.acos(Math.min(1, 1 - 2 * (o.x * o.x + o.z * o.z))) * 57.3; };
  let bad = false;
  const run = (s: number) => { for (let t = 0; t < s; t += 1 / 60) { phys.step(1 / 60); if (!Number.isFinite(body('torso').translation().y)) bad = true; } };
  r.setMood(mood); run(2.5);
  const headP = pitch('head'), chestP = pitch('chest');
  const finY = (body('forearmL').translation().y + body('forearmR').translation().y) / 2 - body('torso').translation().y;
  const z0 = body('torso').translation().z; r.setMoveInput(0, 1); run(2); const speed = (body('torso').translation().z - z0) / 2; let walkTilt = tilt(); r.setMoveInput(0, 0); run(1);
  r.jump(); run(1.5); r.push(new THREE.Vector3(2.5, 0.4, 0)); run(2);
  r.setKnockedOut(true); run(2); r.setKnockedOut(false); run(3);
  const err = Math.abs(body('torso').translation().y - r.dims.hoverHeight);
  const ok = !bad && err < 0.03 && tilt() < 12;
  console.log(`${ok ? 'OK ' : 'BAD'} ${mood.padEnd(8)} head ${headP.toFixed(0).padStart(4)}°  chest ${chestP.toFixed(0).padStart(4)}°  fins ${(finY * 100).toFixed(0).padStart(4)}cm  walk ${speed.toFixed(2)} u/s  end tilt ${tilt().toFixed(1)}°`);
}
