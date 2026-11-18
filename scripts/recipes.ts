// Recipes: safe parsing, round trip, and a crowd of 13 random tenants (stable + cost).
import * as THREE from 'three';
import { RagdollPhysics, RAPIER, parseRecipe, randomRecipe, recipeFromEditor } from '../src/ragdoll';
import { applyTuning } from '../src/ragdoll/tuning';
if (process.env.CODE === '1') applyTuning({});
const base = recipeFromEditor('Base', '#3a86ff', 'calm');

// Parsing: junk in, safe recipe (or null) out.
console.log('null for junk:', parseRecipe(42) === null, parseRecipe({ hello: 1 }) === null);
const hostile = parseRecipe({ name: 'x'.repeat(99), color: 'red; evil', mood: 'furious', traits: { age: 99, weight: 'heavy' }, proportions: { headSize: -5, nope: 3 } }, base)!;
console.log('clamped:', hostile.name.length, hostile.color, hostile.mood, hostile.traits.age, hostile.traits.weight, hostile.proportions.headSize, 'nope' in hostile.proportions);
const r0 = randomRecipe(base, mulberry(7));
console.log('round trip equal:', JSON.stringify(parseRecipe(JSON.parse(JSON.stringify(r0)), base)) === JSON.stringify(r0));

// A crowd of 13, each from its own random recipe.
const phys = await RagdollPhysics.create(); phys.world.numInternalPgsIterations = 3;
phys.world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0));
const rand = mulberry(42);
const crowd = Array.from({ length: 13 }, (_, i) => phys.createRagdoll({ recipe: randomRecipe(base, rand), position: new THREE.Vector3((i % 5) * 1.6, 0, Math.floor(i / 5) * 1.6) }));
const heights = crowd.map((r) => r.dims.height.toFixed(2));
console.log('13 different looks:', new Set(crowd.map((r) => r.dims.key)).size, '| heights', heights.join(' '));
console.log('names/moods:', crowd.map((r) => `${r.recipe.name}(${r.mood})`).join(' '));
const step = (s: number) => { for (let t = 0; t < s; t += 1 / 60) phys.step(1 / 60); };
step(2);
crowd.forEach((r, i) => r.setMoveInput(Math.sin(i), Math.cos(i)));
const t0 = performance.now(); step(4); const ms = (performance.now() - t0) / 240;
crowd.forEach((r) => { r.setMoveInput(0, 0); r.push(new THREE.Vector3(2, 0.3, 0)); }); step(2);
crowd.forEach((r) => r.setKnockedOut(true)); step(2); // Up to 7 s to stand: after walking through each other and a shove, the odd tenant
// lands in an awkward heap and takes a few seconds longer (getup.ts times clean get-ups).
crowd.forEach((r) => r.setKnockedOut(false)); step(7);
const tilt = (r: any) => { const o = r.parts.get('torso').body.rotation(); return Math.acos(Math.min(1, 1 - 2 * (o.x * o.x + o.z * o.z))) * 57.3; };
const bad = crowd.filter((r: any) => Math.abs(r.parts.get('torso').body.translation().y - r.dims.hoverHeight) > 0.03 || tilt(r) > 12);
console.log('all 13 back on their feet after walk, shove, knockout:', bad.length === 0, bad.map((r: any) => `${r.recipe.name} age ${r.recipe.traits.age} w ${r.recipe.traits.weight} f ${r.recipe.traits.fitness} height ${r.dims.height.toFixed(2)} err ${(r.parts.get('torso').body.translation().y - r.dims.hoverHeight).toFixed(3)} tilt ${tilt(r).toFixed(1)} muscle ${r.muscle.toFixed(2)}`));
console.log('13 walking tenants, physics + goo heads:', ms.toFixed(3), 'ms/frame');

function mulberry(seed: number) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
