// Jump check: how high the belly rises, how long in the air, and that it lands upright.
import { RagdollPhysics, RAPIER } from '../src/ragdoll';
const phys = await RagdollPhysics.create();
phys.world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0));
const r = phys.createRagdoll(); const R = r as any;
const belly = () => R.parts.get('torso').body;
const tilt = () => { const q = belly().rotation(); return Math.acos(Math.min(1, 1 - 2 * (q.x * q.x + q.z * q.z))) * 57.3; };
const step = (s: number) => { for (let t = 0; t < s; t += 1 / 60) phys.step(1 / 60); };
const tryJump = (label: string) => {
  const y0 = belly().translation().y; let maxY = y0, air = 0, maxTilt = 0;
  r.jump();
  for (let t = 0; t < 2; t += 1 / 60) { phys.step(1 / 60); maxY = Math.max(maxY, belly().translation().y); if (R.jumpPhase === 'air') air += 1 / 60; maxTilt = Math.max(maxTilt, tilt()); }
  console.log(label.padEnd(16), 'rise', (maxY - y0).toFixed(2), 'air', air.toFixed(2) + 's', 'max tilt', maxTilt.toFixed(0) + '°', 'phase', R.jumpPhase, 'end y', belly().translation().y.toFixed(3), 'end tilt', tilt().toFixed(1) + '°');
};
step(1);
tryJump('standing');
tryJump('again');
r.setMoveInput(0, 1); step(1); tryJump('running'); r.setMoveInput(0, 0); step(1);
r.setKnockedOut(true); step(1); r.jump(); step(0.5); console.log('KO jump ignored:', R.jumpPhase === 'ground');
