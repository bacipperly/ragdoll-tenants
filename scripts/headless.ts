// Headless smoke test: stands, walks, knocks out, recovers. Prints torso height/tilt.
import * as THREE from 'three';
import { RagdollPhysics, RAPIER } from '../src/ragdoll';

const phys = await RagdollPhysics.create();
phys.world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0));
const r = phys.createRagdoll();
const up = new THREE.Vector3(), q = new THREE.Quaternion(), m = new THREE.Vector3();
const report = (label: string) => {
  const torso = (r as any).parts.get('torso').body;
  const rot = torso.rotation(); q.set(rot.x, rot.y, rot.z, rot.w); up.set(0, 1, 0).applyQuaternion(q);
  const v = torso.linvel();
  r.middle(m);
  console.log(label.padEnd(14), 'y', m.y.toFixed(3), 'x', m.x.toFixed(2), 'z', m.z.toFixed(2), 'tilt°', (Math.acos(Math.min(1, up.y)) * 57.3).toFixed(1), 'speed', Math.hypot(v.x, v.z).toFixed(2), JSON.stringify(r.debugState(), (_, x) => typeof x === 'number' ? +x.toFixed(2) : x));
};
const run = (sec: number, label: string) => { for (let t = 0; t < sec; t += 1 / 60) phys.step(1 / 60); report(label); };
run(1, 'settle'); run(2, 'idle');
r.setMoveInput(0, 1); run(0.3, 'walk start'); run(2, 'walking N');
r.setMoveInput(1, 0); run(0.5, 'turn E'); run(1, 'walking E');
r.setMoveInput(0, 0); run(1.5, 'stopped');
r.push(new THREE.Vector3(3, 0, 0)); run(0.3, 'shoved'); run(2, 'after shove');
r.setKnockedOut(true); run(2, 'KO');
r.setKnockedOut(false); run(1, 'recover 1s'); run(2, 'recover 3s');
phys.step(1000); report('huge dt');
const t0 = performance.now(); for (let i = 0; i < 600; i++) phys.step(1 / 60); console.log('ms/frame (1 ragdoll, 2 substeps):', ((performance.now() - t0) / 600).toFixed(3));
