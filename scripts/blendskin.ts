// The blended skin: build time, size, weights and normals; and the butt jiggle.
import * as THREE from 'three';
import { RagdollPhysics, RAPIER, randomRecipe, recipeFromEditor } from '../src/ragdoll';
const phys = await RagdollPhysics.create();
phys.world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0));
let t0 = performance.now();
const r = phys.createRagdoll();
console.log('first tenant built in', (performance.now() - t0).toFixed(0), 'ms');
const g = r.skin.geometry; const pos = g.getAttribute('position'), nor = g.getAttribute('normal'), sw = g.getAttribute('skinWeight');
let bad = 0, nan = 0; for (let i = 0; i < sw.count; i++) { const s = sw.getX(i) + sw.getY(i) + sw.getZ(i) + sw.getW(i); if (Math.abs(s - 1) > 1e-3) bad++; if (!Number.isFinite(pos.getX(i) + nor.getX(i))) nan++; }
g.computeBoundingBox();
console.log('verts', pos.count, 'tris', g.index!.count / 3, '| weights off', bad, '| NaN', nan, '| bounds y', g.boundingBox!.min.y.toFixed(3), '..', g.boundingBox!.max.y.toFixed(3), 'x ±', g.boundingBox!.max.x.toFixed(3), 'z', g.boundingBox!.min.z.toFixed(3), '..', g.boundingBox!.max.z.toFixed(3));
t0 = performance.now();
const base = recipeFromEditor('x', '#ffffff', 'calm'); let s = 1; const rand = () => (s = (s * 16807) % 2147483647) / 2147483647;
for (let i = 0; i < 12; i++) phys.createRagdoll({ recipe: randomRecipe(base, rand), position: new THREE.Vector3(i - 6, 0, 3) });
console.log('12 more random tenants built in', (performance.now() - t0).toFixed(0), 'ms');
// Jiggle: walk, stop, and see the butt bone swing and settle.
const B = (r as any).buttBone as THREE.Bone; const step = (sec: number, cb?: () => void) => { for (let t = 0; t < sec; t += 1 / 60) { phys.step(1 / 60); r.syncMeshes(1 / 60); cb?.(); } };
step(1);
const off = () => { const tq = (r as any).torso.bone; const tgt = (r as any).buttFromTorso.clone().applyQuaternion(tq.quaternion).add(tq.position); return B.position.distanceTo(tgt); };
let mx = 0; r.setMoveInput(0, 1); step(1.5, () => { mx = Math.max(mx, off()); }); r.setMoveInput(0, 0);
let mx2 = 0; step(0.4, () => { mx2 = Math.max(mx2, off()); }); step(2);
console.log('butt wobble walking max', (mx * 1000).toFixed(1), 'mm, on stopping', (mx2 * 1000).toFixed(1), 'mm, settled', (off() * 1000).toFixed(2), 'mm (cheek r', (r.dims.cheeks.r * 1000).toFixed(0), 'mm)');
