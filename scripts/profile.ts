// Where does a frame go with 13 walking tenants? Splits Rapier's step, our per-step
// controllers, the head contact queries, and the per-frame goo + mesh sync.
import * as THREE from 'three';
import { RagdollPhysics, RAPIER, randomRecipe, recipeFromEditor } from '../src/ragdoll';
import { FIXED_DT } from '../src/ragdoll';
const phys = await RagdollPhysics.create(); phys.world.numInternalPgsIterations = 4;
phys.world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0));
let seed = 42; const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const base = recipeFromEditor('Base', '#3a86ff', 'calm');
const rs = Array.from({ length: 13 }, (_, i) => phys.createRagdoll({ recipe: randomRecipe(base, rand), position: new THREE.Vector3((i % 5) * 1.6, 0, Math.floor(i / 5) * 1.6) }));
for (let i = 0; i < 120; i++) phys.step(1 / 60);
rs.forEach((r, i) => r.setMoveInput(Math.sin(i), Math.cos(i)));
for (let i = 0; i < 60; i++) phys.step(1 / 60);
const N = 600;
// Whole frames as the game runs them (fixed steps + goo + sync), at 60 fps.
let t = performance.now(); for (let f = 0; f < N; f++) phys.step(1 / 60); const total = (performance.now() - t) / N;
// The same without the goo heads, to see their share.
const R = rs as any[]; const saved = R.map((r) => r.goo.update); R.forEach((r) => { r.goo.update = () => {}; });
t = performance.now(); for (let f = 0; f < N; f++) phys.step(1 / 60); const noGoo = (performance.now() - t) / N;
R.forEach((r, i) => { r.goo.update = saved[i]; });
console.log(`13 walking: total ${total.toFixed(3)} ms/frame | physics + controllers ${noGoo.toFixed(3)} | goo heads ${(total - noGoo).toFixed(3)}`);
