// Crawling babies: on all fours at rest (belly tipped, knees and fins down on the
// floor), crawl along steadily with diagonal pairs, cope with a shove and a knockout
// (getting back onto all fours), and toddlers still walk upright.
import * as THREE from 'three';
import { RagdollPhysics, RAPIER, recipeFromEditor } from '../src/ragdoll';
const phys = await RagdollPhysics.create();
phys.world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0));
let bad = 0;
const ok = (good: boolean, label: string) => { if (!good) bad++; console.log(`${good ? 'OK ' : 'BAD'} ${label}`); };
const make = (age: number) => {
  const rc = recipeFromEditor('B', '#ffcb00', 'calm'); rc.traits = { age, weight: 0.1, fitness: 0 };
  return phys.createRagdoll({ recipe: rc }) as any;
};
const step = (s: number, f?: () => void) => { for (let t = 0; t < s; t += 1 / 60) { phys.step(1 / 60); f?.(); } };
const deg = (r: number) => (r * 57.3).toFixed(0);
const tiltOf = (r: any) => { const q = r.parts.get('torso').body.rotation(); return Math.acos(Math.min(1, 1 - 2 * (q.x * q.x + q.z * q.z))); };
const lowest = (r: any, name: string) => { const b = r.parts.get(name); const p = b.body.translation(); return p.y - b.def.halfHeight - b.def.radius; };

const b = make(0.02);
step(2);
const y = b.parts.get('torso').body.translation().y;
ok(b.crawling > 0.99, `baby crawls (${b.crawling.toFixed(2)})`);
ok(Math.abs(y - b.restHeight) < 0.02 && Math.abs(tiltOf(b) - b.restTilt) < 0.2,
  `at rest on all fours: belly ${y.toFixed(3)} (wants ${b.restHeight.toFixed(3)}), tipped ${deg(tiltOf(b))}° (wants ${deg(b.restTilt)}°)`);
const shins = Math.min(lowest(b, 'shinL'), lowest(b, 'shinR')), fins = Math.min(lowest(b, 'forearmL'), lowest(b, 'forearmR'));
ok(shins < 0.02 && fins < 0.03, `knees down (lowest shin ${shins.toFixed(3)}), fins down (lowest fin ${fins.toFixed(3)})`);
const head = b.parts.get('head').body.translation().y;
ok(head > y, `head held up (${head.toFixed(3)} over belly ${y.toFixed(3)})`);

// Crawl forward.
b.setMoveInput(0, 1, true);
let worst = 0, diag = 0, n = 0;
const x0 = b.parts.get('torso').body.translation().z;
step(3, () => {
  worst = Math.max(worst, Math.abs(tiltOf(b) - b.restTilt));
  // Diagonal pairs: the left thigh and right fin swing forward together.
  const j = (name: string) => b.joints.find((q: any) => q.def.name === name).target.x;
  const legL = -j('thighL'), finR = -j('upperArmR');
  if (b.gaitWeight > 0.5) { n++; if (Math.sign(legL - 1.3) === Math.sign(finR - 0.8)) diag++; }
});
const v = (b.parts.get('torso').body.translation().z - x0) / 3;
ok(v > 0.2, `crawls along at ${v.toFixed(2)} u/s`);
ok(worst < 0.5, `steady: tilt stays within ${deg(worst)}° of the crawl`);
ok(n > 0 && diag / n > 0.8, `diagonal pairs move together (${((100 * diag) / Math.max(1, n)).toFixed(0)}% of the time)`);
b.setMoveInput(0, 0); step(1);

b.push(new THREE.Vector3(2, 0.3, 0)); step(3);
ok(!b.isKnockedOut && Math.abs(tiltOf(b) - b.restTilt) < 0.3, `shoved: back on all fours (tilt ${deg(tiltOf(b))}°)`);
b.setKnockedOut(true); step(2); b.setKnockedOut(false);
let back = -1;
step(8, () => { if (back < 0 && b.getUp === 'none' && Math.abs(tiltOf(b) - b.restTilt) < 0.25 && Math.abs(b.parts.get('torso').body.translation().y - b.restHeight) < 0.03) back = 1; });
ok(back > 0, 'knocked out: gets back onto all fours');
b.jump(); step(2.5);
ok(Math.abs(tiltOf(b) - b.restTilt) < 0.3, `jumps and lands back on all fours (tilt ${deg(tiltOf(b))}°)`);
phys.removeRagdoll(b);

const t = make(0.12);
step(2);
ok(t.crawling < 0.01 && tiltOf(t) < 0.15, `toddler walks upright (crawl ${t.crawling.toFixed(2)}, tilt ${deg(tiltOf(t))}°)`);
console.log(bad ? `${bad} BAD` : 'all OK');
