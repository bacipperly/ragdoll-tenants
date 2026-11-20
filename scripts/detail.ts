// What drawing detail saves: 13 walking tenants at full, far and hidden detail.
import * as THREE from 'three';
import { RagdollPhysics, RAPIER, randomRecipe, recipeFromEditor } from '../src/ragdoll';
const phys = await RagdollPhysics.create();
phys.world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0));
let seed = 42; const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const base = recipeFromEditor('Base', '#3a86ff', 'calm');
const rs = Array.from({ length: 13 }, (_, i) => phys.createRagdoll({ recipe: randomRecipe(base, rand), position: new THREE.Vector3((i % 5) * 1.6, 0, Math.floor(i / 5) * 1.6) }));
for (let i = 0; i < 120; i++) phys.step(1 / 60);
rs.forEach((r, i) => r.setMoveInput(Math.sin(i), Math.cos(i)));
const N = 600;
const res: Record<string, number[]> = { full: [], far: [], hidden: [] };
for (let round = 0; round < 3; round++) {
  for (const d of ['full', 'far', 'hidden'] as const) {
    rs.forEach((r) => { r.detail = d; });
    for (let i = 0; i < 60; i++) phys.step(1 / 60);
    const t = performance.now(); for (let f = 0; f < N; f++) phys.step(1 / 60);
    res[d].push((performance.now() - t) / N);
  }
}
for (const d in res) console.log(`${d.padEnd(7)} ${Math.min(...res[d]).toFixed(3)} ms/frame (best of 3)`);
