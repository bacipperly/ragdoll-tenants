// Expressive accents: what shows for each trigger, that they go when the feeling does,
// and what they cost with 13 tenants all showing something.
import * as THREE from 'three';
import { Accents, RagdollPhysics, RAPIER, type AccentKind } from '../src/ragdoll';
const phys = await RagdollPhysics.create();
phys.world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 100);
camera.position.set(0, 1, 3); camera.lookAt(0, 0.3, 0); camera.updateMatrixWorld();
const accents = new Accents(scene);
const r = phys.createRagdoll();
const tenants = [r];
const step = (s: number) => { for (let t = 0; t < s; t += 1 / 60) { phys.step(1 / 60); scene.updateMatrixWorld(); accents.update(1 / 60, camera, tenants); } };
const showing = () => {
  const n = new Map<AccentKind, number>();
  for (const sl of (accents as any).slots) if (sl.track && sl.mesh.visible) n.set(sl.kind, (n.get(sl.kind) ?? 0) + 1);
  return [...n].map(([k, c]) => `${k}×${c}`).join(' ') || '—';
};
let bad = 0;
const check = (label: string, want: string | null) => {
  const s = showing();
  const ok = want === null ? s === '—' : s.includes(want);
  if (!ok) bad++;
  console.log(`${ok ? 'OK ' : 'BAD'} ${label.padEnd(28)} ${s}`);
};
step(1.5);
check('calm: nothing', null);
r.setExpression('love'); step(1.2); check('love → hearts', 'heart');
r.setExpression('thinking'); step(1.2); check('thinking → ellipsis (3 dots)', 'ellipsis×3');
r.setExpression(null); step(1); check('back to calm: gone', null);
r.setExpression('embarrassed'); step(0.5); check('embarrassed → blush', 'blush×2');
r.setExpression(null); step(0.6);
r.activity = 'music'; step(1.2); check('music → notes', 'note');
r.activity = null; step(2);
r.playGesture('celebrate'); step(0.6); check('celebrate → sparkles', 'sparkle');
step(2);
r.setKnockedOut(true); step(1); check('knocked out → Zs', 'zzz');
r.setKnockedOut(false); step(4); check('up again: gone', null);
r.push(new THREE.Vector3(2.5, 0.3, 0)); step(0.3); check('shoved → surprise rays', 'rays');
step(3);
accents.burst(r, 'bulb'); step(0.4); check('idea → lightbulb', 'bulb');
step(3);
r.setMoveInput(0, 1); step(1.5); check(`running ${r.runSpeed.toFixed(1)} u/s → speed lines`, 'speed');
r.setMoveInput(0, 1, true); step(1); check('strolling: no speed lines', null);
r.setMoveInput(0, 0); step(1);

// Cost: 13 tenants each showing something busy.
const kinds = ['love', 'starstruck', 'thinking', 'angry', 'sleepy', 'anxious', 'curious', 'nervous', 'relieved', 'excited', 'focused', 'embarrassed', 'delighted'] as const;
for (let i = 1; i < 13; i++) tenants.push(phys.createRagdoll({ position: new THREE.Vector3((i % 5) * 1.5, 0, Math.floor(i / 5) * 1.5) }));
tenants.forEach((t, i) => t.setExpression(kinds[i]));
for (let k = 0; k < 120; k++) { scene.updateMatrixWorld(); accents.update(1 / 60, camera, tenants); }
const t0 = performance.now();
for (let k = 0; k < 600; k++) accents.update(1 / 60, camera, tenants);
console.log(`13 tenants with accents: ${((performance.now() - t0) / 600).toFixed(3)} ms/frame, ${(accents as any).slots.filter((s: any) => s.track).length} symbols live`);
console.log(bad ? `${bad} BAD` : 'all OK');
