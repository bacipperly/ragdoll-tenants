import { RagdollPhysics, RAPIER } from '../src/ragdoll';
const phys = await RagdollPhysics.create();
phys.world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0));
const r = phys.createRagdoll();
const parts = (r as any).parts;
const tilt = (n: string) => { const q = parts.get(n).body.rotation(); return Math.acos(Math.min(1, 1 - 2 * (q.x * q.x + q.z * q.z))) * 57.3; };
const peak = (s: number, l: string, fdt = 1 / 60) => { let h = 0, t = 0; for (let x = 0; x < s; x += fdt) { phys.step(fdt); h = Math.max(h, tilt('head')); t = Math.max(t, tilt('torso')); } console.log(l.padEnd(10), 'head max', h.toFixed(1), 'torso max', t.toFixed(1)); };
peak(2, 'idle'); r.setMoveInput(0, 1); peak(1.5, 'walk'); r.setMoveInput(0, 0); peak(1.5, 'stop');
r.setMoveInput(0, 1); peak(1.5, 'walk 20fps', 0.05); r.setMoveInput(0, 0); peak(1.5, 'stop 20fps', 0.05);
