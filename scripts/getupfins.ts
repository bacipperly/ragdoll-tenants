// Knocked over forward, backward and sideways: do tenants get up with their fins?
// Checks how they land, that the get-up uses the push (fins on the floor), and how long it takes.
import * as THREE from 'three';
import { RagdollPhysics, RAPIER, randomRecipe, recipeFromEditor } from '../src/ragdoll';
const phys = await RagdollPhysics.create();
phys.world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0));
let seed = 7; const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const base = recipeFromEditor('Base', '#3a86ff', 'calm');
const dirs = [['forward', 0, 1], ['backward', 0, -1], ['left side', 1, 0], ['right side', -1, 0]] as const;
const crowd = Array.from({ length: 12 }, (_, i) => phys.createRagdoll({ recipe: randomRecipe(base, rand), position: new THREE.Vector3((i % 4) * 2, 0, Math.floor(i / 4) * 2) }));
const step = (s: number, each?: () => void) => { for (let t = 0; t < s; t += 1 / 60) { phys.step(1 / 60); each?.(); } };
step(2);
crowd.forEach((r: any, i) => {
  const [, dx, dz] = dirs[i % 4];
  r.setKnockedOut(true);
  // Shove the chest that way so it falls over in that direction.
  const c = r.parts.get('chest').body; const m = c.mass();
  c.applyImpulse({ x: dx * m * 2.5, y: 0, z: dz * m * 2.5 }, true);
});
step(2.5);
const up = (r: any) => { const o = r.parts.get('torso').body.rotation(); return new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion(o.x, o.y, o.z, o.w)); };
const fwd = (r: any) => { const o = r.parts.get('torso').body.rotation(); return new THREE.Vector3(0, 0, 1).applyQuaternion(new THREE.Quaternion(o.x, o.y, o.z, o.w)); };
const landed = crowd.map((r) => { const f = fwd(r); return f.y < -0.4 ? 'face down' : f.y > 0.4 ? 'face up' : 'on side'; });
crowd.forEach((r) => r.setKnockedOut(false));
const phases = crowd.map(() => new Set<string>());
const finLow = crowd.map(() => 9);
const stood = crowd.map(() => -1);
let t = 0;
step(6, () => {
  t += 1 / 60;
  crowd.forEach((r: any, i) => {
    phases[i].add(r.getUp);
    if (r.getUp === 'push' && r.getUpProgress < 0.6) {
      for (const s of ['L', 'R']) {
        const p = r.parts.get(`forearm${s}`).body.translation();
        finLow[i] = Math.min(finLow[i], p.y);
      }
    }
    const tilt = Math.abs(Math.acos(Math.min(1, up(r).y)) - r.restTilt) * 57.3; // from its resting tilt (crawling babies)
    if (stood[i] < 0 && r.getUp === 'none' && tilt < 10 && Math.abs(r.parts.get('torso').body.translation().y - r.restHeight) < 0.03) stood[i] = t;
  });
});
let ok = true;
crowd.forEach((r: any, i) => {
  const used = [...phases[i]].filter((p) => p !== 'none').join('+') || 'none';
  const good = stood[i] > 0 && (landed[i] === 'face down' || landed[i] === 'face up' || landed[i] === 'on side' ? used.includes('push') : true);
  if (!good) ok = false;
  console.log(`${good ? 'OK ' : 'BAD'} shoved ${dirs[i % 4][0].padEnd(10)} landed ${landed[i].padEnd(9)} | ${used.padEnd(9)} | fin centre lowest ${finLow[i] < 9 ? finLow[i].toFixed(3) : '—'} | stood after ${stood[i] > 0 ? stood[i].toFixed(1) + ' s' : 'NEVER'} | ${r.recipe.name}`);
});
console.log(ok ? 'all OK' : 'SOME FAILED');
