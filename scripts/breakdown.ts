// Where a frame goes with 13 walking tenants, piece by piece (timers wrapped round each part).
import * as THREE from 'three';
import { ActiveRagdoll, RagdollPhysics, RAPIER, randomRecipe, recipeFromEditor } from '../src/ragdoll';
const phys = await RagdollPhysics.create();
phys.world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0));
let seed = 42; const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const base = recipeFromEditor('Base', '#3a86ff', 'calm');
const rs = Array.from({ length: 13 }, (_, i) => phys.createRagdoll({ recipe: randomRecipe(base, rand), position: new THREE.Vector3((i % 5) * 1.6, 0, Math.floor(i / 5) * 1.6) }));
for (let i = 0; i < 120; i++) phys.step(1 / 60);
rs.forEach((r, i) => r.setMoveInput(Math.sin(i), Math.cos(i)));
for (let i = 0; i < 60; i++) phys.step(1 / 60);

const times = new Map<string, number>();
function wrap(obj: any, name: string, label = name) {
  const f = obj[name];
  obj[name] = function (this: unknown, ...a: unknown[]) {
    const t = performance.now(); const out = f.apply(this, a); times.set(label, (times.get(label) ?? 0) + performance.now() - t); return out;
  };
}
const P = ActiveRagdoll.prototype as any;
for (const m of ['fixedUpdate', 'syncMeshes', 'updateClumsy', 'poseLimbs', 'applyMotors', 'updateFace', 'trackHead', 'applyUpright', 'applyMove', 'applyHover', 'applyGravityCompensation', 'rememberPose']) wrap(P, m);
wrap(ActiveRagdoll, 'checkBump');
wrap(phys.world, 'step', 'rapier world.step');
const r0 = rs[0] as any;
wrap(Object.getPrototypeOf(r0.goo), 'update', 'goo.update');
wrap(Object.getPrototypeOf(r0.face), 'setExpression', 'face.setExpression');
wrap(P, 'jiggleButt');
const N = 600;
const t0 = performance.now(); for (let f = 0; f < N; f++) phys.step(1 / 60); const total = (performance.now() - t0) / N;
console.log(`total ${total.toFixed(3)} ms/frame (with timer overhead)`);
for (const [k, v] of [...times].sort((a, b) => b[1] - a[1])) console.log(`${(v / N).toFixed(3).padStart(7)}  ${k}`);
