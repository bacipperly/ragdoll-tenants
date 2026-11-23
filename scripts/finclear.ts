// Fins against legs: how deep a fin pushes into a leg (skin thickness included)
// during a jump and other moves, from the physics capsules. Above 0: they overlap.
//   npx tsx scripts/finclear.ts [model.glb]
import * as THREE from 'three';
import { RagdollPhysics, RAPIER, recipeFromEditor, prepareBodyModel, setBodyModel, calibrate, setProportionCalibration, bodyModel } from '../src/ragdoll';
import { loadModelFile } from './modelfile';
const file = process.argv[2];
if (file) {
  const m = loadModelFile(file, {});
  setBodyModel(m); setProportionCalibration(calibrate(m) ?? {}, m.kneeHeight);
}
const phys = await RagdollPhysics.create();
phys.world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0));
const r = phys.createRagdoll({ recipe: recipeFromEditor('T', '#ffcb00', 'calm') }) as any;
const D = r.dims, M = bodyModel()?.measures;
// Skin thickness round each bone: the model's (scaled to this tenant) or the generated skin's.
const scale = M ? D.height / M.height : 1;
const finR = M ? M.finHalfWidth * scale : Math.max(...D.skin.arm.map((p: number[]) => p[1]));
const legR = M ? M.legHalfWidth * scale : Math.max(...D.skin.leg.map((p: number[]) => p[1]));
const seg = (name: string) => {
  const p = r.parts.get(name), b = p.body, t = b.translation(), q = b.rotation();
  const ax = new THREE.Vector3(0, p.def.halfHeight, 0).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w));
  const c = new THREE.Vector3(t.x, t.y, t.z);
  return [c.clone().sub(ax), c.clone().add(ax)] as const;
};
const segDist = (a: readonly [THREE.Vector3, THREE.Vector3], b: readonly [THREE.Vector3, THREE.Vector3]) => {
  let best = Infinity; const pa = new THREE.Vector3(), pb = new THREE.Vector3();
  for (let i = 0; i <= 10; i++) { pa.lerpVectors(a[0], a[1], i / 10); for (let j = 0; j <= 10; j++) { pb.lerpVectors(b[0], b[1], j / 10); best = Math.min(best, pa.distanceTo(pb)); } }
  return best;
};
let where = '';
const depth = () => {
  let worst = -Infinity;
  for (const sd of ['L', 'R']) for (const fin of ['forearm', 'upperArm']) for (const leg of ['thigh', 'shin']) {
    const d = finR + legR - segDist(seg(fin + sd), seg(leg + sd));
    if (d > worst) { worst = d; where = `${fin}${sd}/${leg}${sd} (${r.jumpPhase}${r.air ? ` air ${r.air.toFixed(2)}` : ''})`; }
  }
  return worst;
};
let at = '';
const step = (s: number) => { let w = -Infinity; for (let t = 0; t < s; t += 1 / 60) { phys.step(1 / 60); const d = depth(); if (d > w) { w = d; at = where; } } return w; };
const out: string[] = [];
const run = (label: string, s: number, go?: () => void) => { go?.(); const w = step(s); out.push(`${label} ${(w / legR * 100).toFixed(0)}%${process.env.WHERE ? ` [${at}]` : ''}`); };
step(1.5);
run('standing', 1);
run('walking', 2, () => r.setMoveInput(0, 1, true));
run('running', 2, () => r.setMoveInput(0, 1));
r.setMoveInput(0, 0); step(1);
run('jump', 1.6, () => r.jump());
run('stomp', 1.6, () => r.playGesture('stomp'));
run('celebrate', 2, () => r.playGesture('celebrate'));
console.log(`${file ?? 'generated body'}: deepest fin-into-leg overlap, as a share of the leg's thickness (≤0: clear)\n  ${out.join(' · ')}`);
