// Hats: knocked off by knockouts (sometimes), loose on the floor, and back on when walked over.
import * as THREE from 'three';
import { RagdollPhysics, RAPIER, randomRecipe, recipeFromEditor, HAT } from '../src/ragdoll';
const phys = await RagdollPhysics.create();
phys.world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0));
let seed = 3; const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const base = recipeFromEditor('Base', '#3a86ff', 'calm');
const styles = ['beanie', 'cap', 'tophat'] as const;
const crowd = Array.from({ length: 12 }, (_, i) => {
  const r = randomRecipe(base, rand);
  r.outfit.hat = { style: styles[i % 3], color: '#e63946' };
  r.outfit.hoodie = null; // a hood that's up takes the hat's place (and never falls)
  return phys.createRagdoll({ recipe: r, position: new THREE.Vector3((i % 4) * 2.5, 0, Math.floor(i / 4) * 2.5) });
});
const step = (s: number) => { for (let t = 0; t < s; t += 1 / 60) phys.step(1 / 60); };
step(1.5);
HAT.fallChance = 1;
crowd.forEach((r) => r.setKnockedOut(true));
step(0.05);
const off = crowd.filter((r) => r.hatOff).length;
step(2.5);
const lying = crowd.map((r: any) => r.hat.where());
const fine = lying.every((w) => w && Number.isFinite(w.y) && w.y > -0.1 && w.y < 0.6);
crowd.forEach((r) => r.setKnockedOut(false));
step(3);
// Walk each tenant to its hat.
for (let t = 0; t < 8; t += 1 / 60) {
  crowd.forEach((r: any) => {
    const w = r.hat.where();
    if (!w) { r.setMoveInput(0, 0); return; }
    const p = r.parts.get('torso').body.translation();
    const dx = w.x - p.x, dz = w.z - p.z, d = Math.hypot(dx, dz);
    r.setMoveInput(dx / d, dz / d, d < 0.5);
  });
  phys.step(1 / 60);
}
const back = crowd.filter((r) => !r.hatOff).length;
crowd.forEach((r: any, i) => { if (r.hatOff) { const w = r.hat.where(), p = r.parts.get('torso').body.translation(); console.log(`  #${i} ${r.hat.style} still off: ${Math.hypot(w.x - p.x, w.z - p.z).toFixed(2)} away, hat y ${w.y.toFixed(2)}, knocked ${r.isKnockedOut}, getUp ${r.getUp}`); } });
console.log(`${off === 12 ? 'OK ' : 'BAD'} knocked off: ${off}/12`);
console.log(`${fine ? 'OK ' : 'BAD'} hats lie on the floor: ${lying.map((w) => (w ? w.y.toFixed(2) : '—')).join(' ')}`);
console.log(`${back === 12 ? 'OK ' : 'BAD'} back on after walking over them: ${back}/12`);
// And none fall when the chance is 0.
HAT.fallChance = 0;
const offBefore = crowd.filter((r) => r.hatOff).length;
crowd.forEach((r) => r.setKnockedOut(true)); step(0.1);
console.log(`${crowd.filter((r) => r.hatOff).length === offBefore ? 'OK ' : 'BAD'} chance 0: none fall`);
crowd.forEach((r) => r.dispose());
console.log('disposed cleanly, bodies left:', phys.world.bodies.len());
