// Trampoline: a tenant standing on it bounces, and rebounds the moment it comes down
// (no squash-and-settle pause between bounces), the whole body leaving together.
import * as THREE from 'three';
import { RagdollPhysics, RAPIER } from '../src/ragdoll';
import { Things } from '../src/things';
const phys = await RagdollPhysics.create();
phys.world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0));
const things = new Things(phys.world, new THREE.Scene());
const r: any = phys.createRagdoll({ position: new THREE.Vector3(-1.4, 0.13, 2.6), facing: 0 }); // standing on the mat
const all = [r];
// A rebound: the belly goes from falling to rising. Its delay: from when the falling
// belly gets back down to standing height above the mat, to when it's rising again.
const standAt = 0.12 + r.dims.hoverHeight;
let bounces = 0, downSince = -1, longestGround = 0, maxBellyVy = 0, lastVy = 0;
for (let i = 0; i < 60 * 4; i++) {
  phys.step(1 / 60); things.update(1 / 60, all);
  const vy = r.bellyBody.linvel().y, y = r.bellyBody.translation().y;
  if (vy < 0 && y < standAt + 0.02 && downSince < 0) downSince = i;
  if (lastVy < -1 && vy > 1) {
    bounces++;
    if (downSince >= 0) longestGround = Math.max(longestGround, (i - downSince) / 60);
  }
  if (vy > 0) downSince = -1;
  maxBellyVy = Math.max(maxBellyVy, vy);
  lastVy = vy;
}
const ok = bounces >= 3 && longestGround < 0.05 && maxBellyVy < 5;
console.log(ok ? 'OK  ' : 'FAIL', `${bounces} bounces in 4 s | longest from landing to rebound ${(1000 * longestGround).toFixed(0)} ms | fastest belly ${maxBellyVy.toFixed(2)} u/s (launch 4.6)`);
