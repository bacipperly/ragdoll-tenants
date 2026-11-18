import * as THREE from 'three';
import { RagdollPhysics, RAPIER } from '../src/ragdoll';
const phys = await RagdollPhysics.create();
phys.world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0));
phys.world.numSolverIterations = Number(process.env.ITERS ?? 4);
phys.world.numInternalPgsIterations = Number(process.env.PGS ?? 1);
const r = phys.createRagdoll(); const R = r as any;
const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), v = new THREE.Vector3();
const rel = (p: string, c: string) => { const a = R.parts.get(p).body.rotation(), b = R.parts.get(c).body.rotation();
  qa.set(a.x, a.y, a.z, a.w).invert(); qb.set(b.x, b.y, b.z, b.w).premultiply(qa); v.set(0, -1, 0).applyQuaternion(qb); return Math.atan2(-v.z, -v.y); };
const tgt = (n: string) => R.joints.find((j: any) => j.def.name === n).target.x;
for (let t = 0; t < 1; t += 1 / 60) phys.step(1 / 60);
const STILL = process.env.STILL === '1';
if (!STILL) r.setMoveInput(0, 1);
for (let t = 0; t < 1; t += 1 / 60) phys.step(1 / 60);
if (STILL) { R.gaitWeight = 1; R.updateGait = function () { this.gaitWeight = 1; this.gaitRate = 2 * Math.PI * 1.5; this.gaitPhase = (this.gaitPhase + this.gaitRate / 120) % (2 * Math.PI); }; }
for (let i = 0; i < 24; i++) { phys.step(1 / 60 * (STILL ? 2 : 1)); console.log('hipL tgt', (tgt('thighL') * 57.3).toFixed(0).padStart(4), 'act', (rel('torso', 'thighL') * 57.3).toFixed(0).padStart(4), '| kneeL tgt', (tgt('shinL') * 57.3).toFixed(0).padStart(4), 'act', (rel('thighL', 'shinL') * 57.3).toFixed(0).padStart(4)); }
