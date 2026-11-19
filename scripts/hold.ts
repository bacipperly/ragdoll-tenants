// Holding things: picking each thing up (even one off the crate stack) leaves the carrier
// steady, and jumping with it doesn't wrench it around.
import * as THREE from 'three';
import { RagdollPhysics, RAPIER } from '../src/ragdoll';
import { Carry, Things } from '../src/things';
const phys = await RagdollPhysics.create();
phys.world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0));
const things = new Things(phys.world, new THREE.Scene());
const carry = new Carry(phys.world);
const a: any = phys.createRagdoll({ position: new THREE.Vector3(0, 0, 0), facing: 0 });
const all = [a];
const step = (n: number, f?: () => void) => { for (let i = 0; i < n; i++) { phys.step(1 / 60); things.update(1 / 60, all); carry.update(1 / 60, all); f?.(); } };
const tilt = () => { const o = a.bellyBody.rotation(); return Math.acos(Math.min(1, 1 - 2 * (o.x * o.x + o.z * o.z))) * 57.3; };
const watch = (n: number) => { let t = 0, up = 0; const g = a.bellyBody.translation().y; step(n, () => { t = Math.max(t, tilt()); up = Math.max(up, a.bellyBody.translation().y - g); }); return { t, up }; };
a.reset(new THREE.Vector3(3, 0, 3), 0); step(60); a.jump();
console.log(`empty-handed jump: max tilt ${watch(120).t.toFixed(0)}°`);
let ok = true;
for (const th of things.list) {
  carry.release(new THREE.Vector3()); things.reset();
  const p = th.body.translation();
  a.reset(new THREE.Vector3(p.x, 0, p.z - 0.25 - th.size), 0); step(40);
  const got = carry.grab(a, things, all);
  const hold = watch(120);
  step(30); a.jump();
  const jump = watch(120);
  const good = !!got && hold.t < 6 && hold.up < 0.05 && jump.t < 20 && !!carry.held;
  ok &&= good;
  console.log(good ? 'OK  ' : 'FAIL', `${th.name} (grabbed ${got}): holding tilt ${hold.t.toFixed(0)}°, lifted ${hold.up.toFixed(2)} | jump tilt ${jump.t.toFixed(0)}° | still holding ${!!carry.held}`);
}
// Carrying another tenant overhead: walking and turning with it barely more wobbly
// than empty-handed, and it stays up there.
{
  carry.release(new THREE.Vector3());
  const b: any = phys.createRagdoll({ position: new THREE.Vector3(6, 0, 6.4), facing: Math.PI });
  const both = [a, b];
  a.reset(new THREE.Vector3(6, 0, 6), 0); step(60);
  const got = carry.grab(a, things, both);
  let t = 0, drift = 0;
  const near = () => { const w = new THREE.Vector3(); (carry as any).holdWorld(a, b.dims.bellyR + 0.02, w, 'overhead'); const p = b.bellyBody.translation(); return w.distanceTo(new THREE.Vector3(p.x, p.y, p.z)); };
  const go = (x: number, z: number, n: number) => { a.setMoveInput(x, z); for (let i = 0; i < n; i++) { phys.step(1 / 60); things.update(1 / 60, both); carry.update(1 / 60, both); t = Math.max(t, tilt()); drift = Math.max(drift, near()); } };
  go(0, 0, 60); go(0, 1, 90); go(1, 0, 90); go(0, 0, 60);
  const good = !!got && b.isCarried && t < 40 && drift < 0.12;
  ok &&= good;
  console.log(good ? 'OK  ' : 'FAIL', `carrying ${got} overhead, walking and turning: carrier max tilt ${t.toFixed(0)}°, held tenant within ${drift.toFixed(2)} of the spot`);
}
console.log(ok ? 'all OK' : 'SOME FAILED');
