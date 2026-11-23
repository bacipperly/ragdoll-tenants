// How much the limbs actually move while walking: the physics bones (swing of each
// fin and thigh, bend of each knee) and the skin over them (how far vertices that
// should follow each limb really move, against how far the limb's tip moves).
//   npx tsx scripts/limbmotion.ts [model.glb] [ours|rig]
import * as THREE from 'three';
import { RagdollPhysics, RAPIER, recipeFromEditor, prepareBodyModel, setBodyModel, calibrate, setProportionCalibration } from '../src/ragdoll';
import { loadModelFile } from './modelfile';
const file = process.argv[2], weights = (process.argv[3] ?? 'ours') as 'ours' | 'rig';
if (file) {
  const m = loadModelFile(file, { weights });
  setBodyModel(m); setProportionCalibration(calibrate(m) ?? {}, m.kneeHeight);
}
const phys = await RagdollPhysics.create();
phys.world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0));
const r = phys.createRagdoll({ recipe: recipeFromEditor('T', '#ffcb00', 'calm') }) as any;
const names: string[] = [...r.parts.keys()];
const geo: THREE.BufferGeometry = r.skin.geometry;
const si = geo.attributes.skinIndex.array as Uint16Array, sw = geo.attributes.skinWeight.array as Float32Array;
// The vertex most owned by each limb's lower bone, lowest down (the fin tip, the foot).
const tipVertex = (bone: string) => {
  const b = names.indexOf(bone); let best = -1, low = Infinity;
  const p = geo.attributes.position.array as Float32Array;
  for (let v = 0; v < p.length / 3; v++) for (let k = 0; k < 4; k++) if (si[v * 4 + k] === b && sw[v * 4 + k] > 0.5 && p[v * 3 + 1] < low) { low = p[v * 3 + 1]; best = v; }
  return best;
};
const tips = { finL: tipVertex('forearmL'), legL: tipVertex('shinL') };
const ownership = (prefix: string[]) => { let n = 0, w = 0; for (let v = 0; v < sw.length / 4; v++) for (let k = 0; k < 4; k++) if (prefix.includes(names[si[v * 4 + k]])) { w += sw[v * 4 + k]; n++; } return w; };
console.log(`${file ?? 'generated body'} (${weights}): skin weight on fins ${ownership(['upperArmL', 'forearmL', 'upperArmR', 'forearmR']).toFixed(0)}, legs ${ownership(['thighL', 'shinL', 'thighR', 'shinR']).toFixed(0)}, body ${ownership(['torso', 'chest']).toFixed(0)}`);
const step = (s: number, f?: () => void) => { for (let t = 0; t < s; t += 1 / 60) { phys.step(1 / 60); r.syncMeshes(1 / 60, 1); f?.(); } };
step(1.5);
r.setMoveInput(0, 1);
const range = () => ({ lo: Infinity, hi: -Infinity });
const finSwing = range(), knee = range(), finTipZ = range(), skinFinZ = range(), footY = range(), skinFootY = range();
const q = new THREE.Quaternion(), q2 = new THREE.Quaternion(), v = new THREE.Vector3(), torsoP = new THREE.Vector3();
const upd = (rr: { lo: number; hi: number }, x: number) => { rr.lo = Math.min(rr.lo, x); rr.hi = Math.max(rr.hi, x); };
step(1);
step(2, () => {
  r.group.updateMatrixWorld(true);
  const body = (n: string) => r.parts.get(n).body;
  const tp = body('torso').translation(); torsoP.set(tp.x, tp.y, tp.z);
  const rq = body('torso').rotation(); q.set(rq.x, rq.y, rq.z, rq.w).invert();
  // Fin swing: the upper fin's down axis in the belly's frame, its forward lean.
  const ua = body('upperArmL').rotation(); q2.set(ua.x, ua.y, ua.z, ua.w);
  v.set(0, -1, 0).applyQuaternion(q2).applyQuaternion(q); upd(finSwing, Math.atan2(v.z, -v.y) * 57.3);
  const th = body('thighL').rotation(), sh = body('shinL').rotation();
  q2.set(th.x, th.y, th.z, th.w); const a = new THREE.Vector3(0, -1, 0).applyQuaternion(q2);
  q2.set(sh.x, sh.y, sh.z, sh.w); const b = new THREE.Vector3(0, -1, 0).applyQuaternion(q2);
  upd(knee, a.angleTo(b) * 57.3);
  // Skin: the tip vertices, skinned, relative to the belly, against the bone tips.
  const fa = body('forearmL').translation(); upd(finTipZ, new THREE.Vector3(fa.x, fa.y, fa.z).sub(torsoP).applyQuaternion(q).z);
  const sk = new THREE.Vector3(); r.skin.getVertexPosition(tips.finL, sk); r.skin.localToWorld(sk);
  upd(skinFinZ, sk.sub(torsoP).applyQuaternion(q).z);
  const sb = body('shinL').translation(); upd(footY, sb.y);
  const sk2 = new THREE.Vector3(); r.skin.getVertexPosition(tips.legL, sk2); r.skin.localToWorld(sk2); upd(skinFootY, sk2.y);
});
const span = (rr: { lo: number; hi: number }, d = 1) => (rr.hi - rr.lo).toFixed(d);
console.log(`  physics: fin swings ${span(finSwing)}° fore-aft, knee bends ${knee.lo.toFixed(0)}–${knee.hi.toFixed(0)}°`);
console.log(`  fin:  bone tip moves ${(Number(span(finTipZ, 4)) * 100).toFixed(1)} cm fore-aft, the skin's fin tip ${(Number(span(skinFinZ, 4)) * 100).toFixed(1)} cm`);
console.log(`  foot: shin rises ${(Number(span(footY, 4)) * 100).toFixed(1)} cm per step, the skin's foot ${(Number(span(skinFootY, 4)) * 100).toFixed(1)} cm`);
