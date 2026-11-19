// Where do the fins point while hoisting another tenant overhead? (and while hugging a ball)
import * as THREE from 'three';
import { RagdollPhysics, RAPIER, recipeFromEditor } from '../src/ragdoll';
import { Carry, Things } from '../src/things';
const phys = await RagdollPhysics.create();
phys.world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0));
const things = new Things(phys.world, new THREE.Scene());
const carry = new Carry(phys.world);
const a = phys.createRagdoll({ position: new THREE.Vector3(0, 0, -1.55), facing: Math.PI });
const b = phys.createRagdoll({ recipe: recipeFromEditor('B', '#ff0000', 'calm'), position: new THREE.Vector3(0, 0, -2) });
const all = [a, b];
const step = (s: number) => { for (let t = 0; t < s; t += 1 / 60) { phys.step(1 / 60); things.update(1 / 60, all); carry.update(1 / 60, all); } };
const report = (label: string) => {
  const P = (a as any).parts;
  const head = P.get('head').body.translation(); const R = a.dims.headR;
  for (const s of ['L', 'R']) {
    const up = P.get('upperArm' + s).body, fo = P.get('forearm' + s).body;
    // forearm tip = centre + local −y * (len/2)
    const q = fo.rotation(); const tip = new THREE.Vector3(0, -a.dims.forearmLen / 2, 0).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w)).add(fo.translation() as any);
    const uq = up.rotation(); const dir = new THREE.Vector3(0, -1, 0).applyQuaternion(new THREE.Quaternion(uq.x, uq.y, uq.z, uq.w));
    const side = Math.hypot(tip.x - head.x, tip.z - head.z);
    console.log(label, s, 'upper fin angle from hanging', (Math.acos(dir.y * -1) * 57.3).toFixed(0) + '°',
      '| tip above head centre', (tip.y - head.y).toFixed(2), '| tip out from head axis', side.toFixed(2), '(head r', R.toFixed(2) + ')', side > R ? 'VISIBLE beside head' : 'hidden behind head');
  }
};
step(1);
console.log('grab →', carry.grab(a, things, all)); step(1.5); report('hoist');
a.setMoveInput(0, 1); step(1); a.setMoveInput(0, 0); report('hoist+walk');
carry.release(new THREE.Vector3()); step(1);
// Isolate: same pose with nothing held, standing then walking.
a.reset(new THREE.Vector3(3, 0, 3), 0); step(1);
a.setHolding(true, 'overhead'); step(1.5); report('empty pose');
a.setMoveInput(0, 1); for (let i = 0; i < 4; i++) { step(0.25); report('empty walk t' + i); } a.setMoveInput(0, 0);
