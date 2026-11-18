// Playdough dent: peak flattening on a knockout fall and a big drop, the resting sag,
// and that it plumps back once up again.
import * as THREE from 'three';
import { RagdollPhysics, RAPIER } from '../src/ragdoll';
import { applyTuning } from '../src/ragdoll/tuning';
if (process.env.CODE === '1') applyTuning({});
const phys = await RagdollPhysics.create();
phys.world.numInternalPgsIterations = 3;
phys.world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0));
const r = phys.createRagdoll(); const R = r as any;
const watch = (s: number, label: string) => { let peak = 0; for (let t = 0; t < s; t += 1 / 60) { phys.step(1 / 60); peak = Math.max(peak, R.dent); }
  const a = R.dentAxis; console.log(label.padEnd(22), `peak ${(peak * 100).toFixed(0)}%  now ${(R.dent * 100).toFixed(0)}%  axis (${a.x.toFixed(1)}, ${a.y.toFixed(1)}, ${a.z.toFixed(1)})`); };
watch(1, 'standing');
r.setKnockedOut(true); watch(1.5, 'knockout fall'); watch(2, 'lying there');
r.setKnockedOut(false); watch(3, 'back up');
r.reset(new THREE.Vector3(0, 1.5, 0)); r.setKnockedOut(true); watch(2.5, 'dropped from 1.5');
r.setKnockedOut(false); watch(3, 'back up');
