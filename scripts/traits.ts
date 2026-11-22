// Every trait preset (and the extreme corners): stable, and does it move its age/build?
import * as THREE from 'three';
import { RagdollPhysics, RAPIER } from '../src/ragdoll';
import { TRAITS } from '../src/ragdoll/config';
import { TRAIT_PRESETS } from '../src/ragdoll/traits';
import { applyTuning } from '../src/ragdoll/tuning';
if (process.env.CODE === '1') applyTuning({});
const cases: [string, typeof TRAITS][] = [
  ...Object.entries(TRAIT_PRESETS).map(([k, v]) => [k, { ...v }] as [string, typeof TRAITS]),
  ['baby + heavy', { age: 0, weight: 1, fitness: -1 }],
  ['senior + heavy', { age: 1, weight: 1, fitness: -1 }],
  ['senior + fit', { age: 1, weight: -1, fitness: 1 }],
  ['baby + slim', { age: 0, weight: -1, fitness: 1 }],
];
for (const [label, t] of cases) {
  Object.assign(TRAITS, t);
  const phys = await RagdollPhysics.create();
  phys.world.numInternalPgsIterations = 3;
  phys.world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0));
  const r = phys.createRagdoll(); const R = r as any;
  const belly = () => R.parts.get('torso').body;
  const tilt = () => { const o = belly().rotation(); return Math.abs(Math.acos(Math.min(1, 1 - 2 * (o.x * o.x + o.z * o.z))) - R.restTilt) * 57.3; }; // from its resting tilt (a crawling baby's is ~75°)
  let bad = false;
  const run = (s: number) => { for (let k = 0; k < s; k += 1 / 60) { phys.step(1 / 60); if (!Number.isFinite(belly().translation().y)) bad = true; } };
  run(2);
  const z0 = belly().translation().z; r.setMoveInput(0, 1); run(2); const speed = (belly().translation().z - z0) / 2; r.setMoveInput(0, 0); run(1);
  const y0 = belly().translation().y; let top = y0; r.jump(); for (let k = 0; k < 1.5; k += 1 / 60) { phys.step(1 / 60); top = Math.max(top, belly().translation().y); }
  r.push(new THREE.Vector3(2.5, 0.4, 0)); run(2);
  r.setKnockedOut(true); run(2); r.setKnockedOut(false);
  let up = 0; for (; up < 6; up += 1 / 60) { phys.step(1 / 60); if (Math.abs(belly().translation().y - r.restHeight) < 0.01 && tilt() < 5 && R.muscle >= 1) break; }
  run(1);
  const ok = !bad && Math.abs(belly().translation().y - r.restHeight) < 0.03 && tilt() < 12;
  console.log(`${ok ? 'OK ' : 'BAD'} ${label.padEnd(15)} height ${r.dims.height.toFixed(2)}  walk ${speed.toFixed(2)} u/s  jump ${(top - y0).toFixed(2)}  up again in ${up.toFixed(1)}s  end tilt ${tilt().toFixed(1)}°`);
}
