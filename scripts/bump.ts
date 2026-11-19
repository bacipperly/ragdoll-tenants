// Tenants bump into each other: two walk head-on, then one walks into a standing one.
import * as THREE from 'three';
import { RagdollPhysics, RAPIER } from '../src/ragdoll';
const phys = await RagdollPhysics.create();
phys.world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0));
const a = phys.createRagdoll({ position: new THREE.Vector3(0, 0, -1), facing: 0 });
const b = phys.createRagdoll({ position: new THREE.Vector3(0, 0, 1), facing: Math.PI });
const step = (s: number) => { for (let t = 0; t < s; t += 1 / 60) phys.step(1 / 60); };
const pos = (r: any) => { const v = new THREE.Vector3(); r.middle(v); return v; };
const tilt = (r: any) => { const o = r.bellyBody.rotation(); return Math.acos(Math.min(1, 1 - 2 * (o.x * o.x + o.z * o.z))) * 57.3; };
step(1);
a.setMoveInput(0, 1); b.setMoveInput(0, -1);
// Heads are the widest part: two heads should never overlap much.
const head = (r: any) => r.parts.get('head').body.translation();
const headR = (r: any) => r.parts.get('head').def.radius;
let minHeads = 9, maxTilt = 0;
for (let t = 0; t < 2.5; t += 1 / 60) {
  step(1 / 60);
  const ha = head(a), hb = head(b);
  minHeads = Math.min(minHeads, Math.hypot(ha.x - hb.x, ha.y - hb.y, ha.z - hb.z));
  maxTilt = Math.max(maxTilt, tilt(a), tilt(b));
}
a.setMoveInput(0, 0); b.setMoveInput(0, 0); step(2);
const touch = headR(a) + headR(b);
const ok = minHeads > 0.85 * touch;
console.log(ok ? 'OK  ' : 'FAIL', 'head-on: closest heads', minHeads.toFixed(3), 'touching at', touch.toFixed(3), '| max tilt', maxTilt.toFixed(0) + '°',
  '| sidestepped', Math.abs(pos(a).x - pos(b).x).toFixed(2), '| after: tilts', tilt(a).toFixed(0) + '°', tilt(b).toFixed(0) + '°');
