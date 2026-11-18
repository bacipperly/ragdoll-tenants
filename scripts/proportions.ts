// Stability across proportions: stand, walk, jump, shove, knockout + recovery.
import * as THREE from 'three';
import { RagdollPhysics, RAPIER } from '../src/ragdoll';
import { PROPORTIONS } from '../src/ragdoll/config';
import { applyTuning } from '../src/ragdoll/tuning';
// CODE=1 tests config.ts's own defaults; otherwise the saved tuning.json is in effect.
if (process.env.CODE === '1') applyTuning({});
const base = { ...PROPORTIONS };
const cases: [string, Partial<typeof PROPORTIONS>][] = [
  ['as drawn', {}],
  ['big head 1.8', { headSize: 1.8 }],
  ['tiny head 0.5', { headSize: 0.5 }],
  ['long legs 2.5', { legLength: 2.5 }],
  ['stubby legs 0.4', { legLength: 0.4 }],
  ['wide body 1.8', { bodyWidth: 1.8 }],
  ['tall body 1.8', { bodyHeight: 1.8 }],
  ['long fins 1.8', { finLength: 1.8, finWidth: 2.2 }],
  ['fin length 1.8', { finLength: 1.8 }],
  ['fin length 1.5', { finLength: 1.5 }],
  ['fin width 2.2', { finWidth: 2.2 }],
  ['broad shoulders', { shoulderWidth: 2 }],
  ['wide hips', { hipWidth: 2 }],
  ['narrow both', { shoulderWidth: 0.5, hipWidth: 0.5 }],
  ['waist pinch', { waist: 0.6, hipWidth: 1.6, shoulderWidth: 1.3 }],
  ['all max', { headSize: 1.8, headFloat: 4, bodyWidth: 1.8, bodyHeight: 1.8, legLength: 2.5, legThickness: 1.8, finLength: 1.8, finWidth: 2.2 }],
  ['all min', { headSize: 0.5, headFloat: 0, bodyWidth: 0.5, bodyHeight: 0.5, legLength: 0.4, legThickness: 0.5, finLength: 0.4, finWidth: 0.4 }],
];
for (const [label, p] of cases) {
  Object.assign(PROPORTIONS, base, p);
  const phys = await RagdollPhysics.create();
  phys.world.numInternalPgsIterations = 4;
  phys.world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0));
  const r = phys.createRagdoll(); const R = r as any;
  const belly = () => R.parts.get('torso').body;
  const tilt = () => { const q = belly().rotation(); return Math.acos(Math.min(1, 1 - 2 * (q.x * q.x + q.z * q.z))) * 57.3; };
  let worst = 0, bad = false;
  const run = (s: number) => { for (let t = 0; t < s; t += 1 / 60) { phys.step(1 / 60); const y = belly().translation().y; if (!Number.isFinite(y)) bad = true; worst = Math.max(worst, tilt()); } };
  run(1.5); const stand = Math.abs(belly().translation().y - r.dims.hoverHeight);
  r.setMoveInput(0, 1); run(2); const walkTilt = worst; r.setMoveInput(0, 0); run(1);
  worst = 0; r.jump(); run(1.5); const jumpTilt = worst;
  r.push(new THREE.Vector3(2.5, 0.4, 0)); run(2);
  r.setKnockedOut(true); run(2); r.setKnockedOut(false); run(3);
  const end = Math.abs(belly().translation().y - r.dims.hoverHeight);
  const ok = !bad && stand < 0.02 && end < 0.02 && tilt() < 10;
  console.log(`${ok ? 'OK ' : 'BAD'} ${label.padEnd(16)} height ${r.dims.height.toFixed(2)}  stand err ${stand.toFixed(3)}  walk tilt ${walkTilt.toFixed(0)}°  jump tilt ${jumpTilt.toFixed(0)}°  after KO err ${end.toFixed(3)} tilt ${tilt().toFixed(1)}°`);
  phys.removeRagdoll(r);
}
