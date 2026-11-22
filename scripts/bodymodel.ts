// Imported body models (src/ragdoll/bodyModel.ts), tested with the stand-in
// (scripts/make-standin.ts) or any .glb: it fits adults, babies and elders, the skin
// data is sound, the fins hang straight after swinging back, the model's head is
// replaced by the goo head, and the tenants still walk, fall and get up.
//   npx tsx scripts/bodymodel.ts [model.glb]
import * as THREE from 'three';
import { RagdollPhysics, RAPIER, recipeFromEditor, prepareBodyModel, setBodyModel } from '../src/ragdoll';
import { readGlb } from './glb';
const file = process.argv[2] ?? 'public/models/stand-in.glb';
const g = readGlb(file);
const model = prepareBodyModel('test', g.positions, g.normals, g.index);
setBodyModel(model);
let bad = 0;
const ok = (good: boolean, label: string) => { if (!good) bad++; console.log(`${good ? 'OK ' : 'BAD'} ${label}`); };
const phys = await RagdollPhysics.create();
phys.world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0));
const tiltOf = (r: any) => { const q = r.parts.get('torso').body.rotation(); return Math.abs(Math.acos(Math.min(1, 1 - 2 * (q.x * q.x + q.z * q.z))) - r.restTilt) * 57.3; };
for (const [label, age] of [['adult', 0.55], ['baby', 0.02], ['elder', 1]] as const) {
  const rc = recipeFromEditor('T', '#ffcb00', 'calm'); rc.traits = { age, weight: 0, fitness: 0 };
  const r = phys.createRagdoll({ recipe: rc }) as any;
  const geo: THREE.BufferGeometry = r.skin.geometry, D = r.dims;
  const pos = geo.attributes.position.array as Float32Array, sw = geo.attributes.skinWeight.array as Float32Array;
  const cA = geo.attributes.clothA.array as Float32Array;
  let finite = true, wOk = true, cOk = true, top = -Infinity, low = Infinity;
  for (let v = 0; v < pos.length / 3; v++) {
    if (![pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]].every(Number.isFinite)) finite = false;
    if (Math.abs(sw[v * 4] + sw[v * 4 + 1] + sw[v * 4 + 2] + sw[v * 4 + 3] - 1) > 1e-3) wOk = false;
    if (Math.abs(cA[v * 4] + cA[v * 4 + 1] + cA[v * 4 + 2] + cA[v * 4 + 3] - 1) > 1e-3) cOk = false;
    top = Math.max(top, pos[v * 3 + 1]); low = Math.min(low, pos[v * 3 + 1]);
  }
  ok(finite && wOk && cOk, `${label}: ${pos.length / 3} vertices, weights and clothes data sound`);
  ok(top <= D.headY - D.headR + 0.02 * D.height && low < 0.03 * D.height, `${label}: head cut at the neck (top ${top.toFixed(3)}, goo head from ${(D.headY - D.headR).toFixed(3)}), feet at ${low.toFixed(3)}`);
  // Fins swung back: the vertices mostly on a fin hang below its shoulder, not out to the side.
  const si = geo.attributes.skinIndex.array as Uint16Array;
  const finBones = new Set(['upperArmL', 'forearmL'].map((n) => r.joints ? [...r.parts.keys()].indexOf(n) : -1));
  let out = 0, n = 0;
  for (let v = 0; v < pos.length / 3; v++) {
    if (!finBones.has(si[v * 4]) || sw[v * 4] < 0.6 || pos[v * 3 + 1] > D.shoulderY - 0.5 * D.upperArmLen) continue;
    out = Math.max(out, pos[v * 3] - D.shoulderX); n++;
  }
  ok(n > 0 && out < 2.5 * D.upperArmR, `${label}: fin hangs straight after swinging back (reaches ${(out / D.upperArmR).toFixed(1)} fin-widths out from the shoulder, ${n} vertices)`);
  // Physics as usual.
  const step = (s: number) => { for (let t = 0; t < s; t += 1 / 60) { phys.step(1 / 60); r.syncMeshes(1 / 60, 1); } };
  step(1.5); r.setMoveInput(0, 1); step(2); r.setMoveInput(0, 0); step(1);
  r.setKnockedOut(true); step(2); r.setKnockedOut(false); step(5);
  ok(tiltOf(r) < 10 && Math.abs(r.parts.get('torso').body.translation().y - r.restHeight) < 0.03, `${label}: walks, falls, gets up (tilt ${tiltOf(r).toFixed(1)}° from rest)`);
  phys.removeRagdoll(r);
}
setBodyModel(null);
console.log(bad ? `${bad} BAD` : 'all OK');
