// How long does each of 13 random tenants take to stand after a knockout?
import * as THREE from 'three';
import { RagdollPhysics, RAPIER, randomRecipe, recipeFromEditor } from '../src/ragdoll';
const phys = await RagdollPhysics.create(); phys.world.numInternalPgsIterations = Number(process.env.PGS ?? 4);
phys.world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0));
let seed = 42; const m = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const base = recipeFromEditor('Base', '#3a86ff', 'calm');
const crowd = Array.from({ length: 13 }, (_, i) => phys.createRagdoll({ recipe: randomRecipe(base, m), position: new THREE.Vector3((i % 5) * 1.6, 0, Math.floor(i / 5) * 1.6) }));
const step = (s: number) => { for (let t = 0; t < s; t += 1 / 60) phys.step(1 / 60); };
step(2); crowd.forEach((r) => r.setKnockedOut(true)); step(2); crowd.forEach((r) => r.setKnockedOut(false));
const tilt = (r: any) => { const o = r.parts.get('torso').body.rotation(); return Math.acos(Math.min(1, 1 - 2 * (o.x * o.x + o.z * o.z))) * 57.3; };
const up = new Map<string, number>();
for (let t = 0; t < 10; t += 1 / 60) { phys.step(1 / 60); crowd.forEach((r: any, i) => { const k = `${i}:${r.recipe.name}`; if (!up.has(k) && Math.abs(r.parts.get('torso').body.translation().y - r.dims.hoverHeight) < 0.02 && tilt(r) < 8) up.set(k, t); }); }
const times = crowd.map((r, i) => up.get(`${i}:${r.recipe.name}`));
console.log('seconds to stand:', times.map((t) => (t === undefined ? 'never' : t.toFixed(1))).join(' '), '| slowest', Math.max(...times.map((t) => t ?? 99)).toFixed(1));
