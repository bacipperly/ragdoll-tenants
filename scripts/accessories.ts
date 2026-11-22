// Accessories: every one builds on every life stage and comes off cleanly, the cane stays
// upright and reaches the floor, outfits round-trip, and random tenants dress their age.
import * as THREE from 'three';
import { RagdollPhysics, RAPIER, LIFE_STAGES, dressForStage, randomRecipe, recipeFromEditor, parseRecipe } from '../src/ragdoll';
const phys = await RagdollPhysics.create();
phys.world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0));
let bad = 0;
const ok = (good: boolean, label: string) => { if (!good) bad++; console.log(`${good ? 'OK ' : 'BAD'} ${label}`); };
const all = { glasses: { style: 'round', color: '#000000' }, bow: { color: '#ff0000' }, headphones: { color: '#9b5de5' },
  pacifier: { color: '#8ecae6' }, whiskers: { color: '#ffffff', mustache: true, brows: true }, backpack: { color: '#3a86ff' },
  bag: { color: '#7f5539' }, cane: { color: '#7f5539' } } as const;
for (const st of LIFE_STAGES) {
  const base = recipeFromEditor('T', '#ffcb00', 'calm');
  base.traits = { ...st.traits };
  base.outfit = { ...dressForStage(base.outfit, st), ...structuredClone(all) } as typeof base.outfit;
  const r = phys.createRagdoll({ recipe: base });
  for (let t = 0; t < 2; t += 1 / 60) { phys.step(1 / 60); (r as any).syncMeshes?.(1 / 60, 1); }
  const meshes: THREE.Mesh[] = [];
  r.group.traverse((o) => { if (o instanceof THREE.Mesh) meshes.push(o); });
  const cane = (r as any).accessories.cane;
  const p = new THREE.Vector3(); cane.root.getWorldPosition(p);
  const q = new THREE.Quaternion(); cane.root.getWorldQuaternion(q);
  const upright = new THREE.Vector3(0, 1, 0).applyQuaternion(q).y;
  const reach = p.y - cane.shaft.scale.y - (r as any).groundY;
  ok(upright > 0.99 && Math.abs(reach) < 0.005, `${st.name.padEnd(12)} all accessories on: cane upright ${upright.toFixed(3)}, reaches floor ±${Math.abs(reach).toFixed(3)}`);
  const before = meshes.length;
  r.setOutfit(dressForStage(r.recipe.outfit, LIFE_STAGES[5])); // adult: nothing extra
  let after = 0; r.group.traverse((o) => { if (o instanceof THREE.Mesh) after++; });
  ok(after < before - 15, `${st.name.padEnd(12)} taking them off: ${before} → ${after} meshes`);
  phys.removeRagdoll(r);
}
const rt = recipeFromEditor('T', '#ffcb00', 'calm');
rt.outfit = { ...rt.outfit, ...structuredClone(all), hat: { style: 'cap', color: '#e63946', backwards: true } } as typeof rt.outfit;
ok(JSON.stringify(parseRecipe(JSON.parse(JSON.stringify(rt)))!.outfit) === JSON.stringify(rt.outfit), 'recipe round trip keeps accessories');
let seed = 7; const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const tally: Record<string, Record<string, number>> = {};
for (let i = 0; i < 400; i++) {
  const r = randomRecipe(recipeFromEditor('T', '#ffcb00', 'calm'), rand);
  const stage = LIFE_STAGES.reduce((a, s) => Math.abs(s.traits.age - r.traits.age) < Math.abs(a.traits.age - r.traits.age) ? s : a).name;
  const t = (tally[stage] ??= { n: 0 });
  t.n++;
  for (const k of ['pacifier', 'backpack', 'headphones', 'bag', 'glasses', 'whiskers', 'cane'] as const) if (r.outfit[k]) t[k] = (t[k] ?? 0) + 1;
}
for (const [s, t] of Object.entries(tally)) console.log(`    random ${s.padEnd(12)} ${Object.entries(t).map(([k, n]) => `${k} ${n}`).join(', ')}`);
ok((tally.elderly?.cane ?? 0) > 0 && !tally.adult?.pacifier && !tally.baby?.cane, 'random accessories suit the age');
console.log(bad ? `${bad} BAD` : 'all OK');
