// Every gesture: does it do its thing, and is it standing steady afterwards?
import * as THREE from 'three';
import { RagdollPhysics, RAPIER } from '../src/ragdoll';
import { GESTURE_NAMES, GESTURES } from '../src/ragdoll/gestures';
import { applyTuning } from '../src/ragdoll/tuning';
if (process.env.CODE === '1') applyTuning({});
const q = new THREE.Quaternion(), f = new THREE.Vector3();
for (const name of GESTURE_NAMES) {
  const phys = await RagdollPhysics.create();
  phys.world.numInternalPgsIterations = 3;
  phys.world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0));
  const r = phys.createRagdoll(); const R = r as any;
  const b = (n: string) => R.parts.get(n).body;
  const tilt = () => { const o = b('torso').rotation(); return Math.acos(Math.min(1, 1 - 2 * (o.x * o.x + o.z * o.z))) * 57.3; };
  const yawOf = () => { const o = b('torso').rotation(); q.set(o.x, o.y, o.z, o.w); f.set(0, 0, 1).applyQuaternion(q); return Math.atan2(f.x, f.z); };
  for (let t = 0; t < 1.5; t += 1 / 60) phys.step(1 / 60);
  const y0 = b('torso').translation().y;
  let finL = -9, finR = -9, rise = 0, maxTilt = 0, knee = -9, turned = 0, lastYaw = yawOf();
  r.playGesture(name);
  const secs = GESTURES[name].seconds;
  for (let t = 0; t < secs + 0.1; t += 1 / 60) {
    phys.step(1 / 60);
    const ty = b('torso').translation().y;
    finL = Math.max(finL, b('forearmL').translation().y - ty); finR = Math.max(finR, b('forearmR').translation().y - ty);
    knee = Math.max(knee, b('shinR').translation().y - b('shinL').translation().y);
    rise = Math.max(rise, ty - y0); maxTilt = Math.max(maxTilt, tilt());
    const yw = yawOf(); let d = yw - lastYaw; d = Math.atan2(Math.sin(d), Math.cos(d)); turned += d; lastYaw = yw;
  }
  for (let t = 0; t < 1.5; t += 1 / 60) phys.step(1 / 60);
  const ok = Math.abs(b('torso').translation().y - r.dims.hoverHeight) < 0.03 && tilt() < 8 && r.gesture === null;
  console.log(`${ok ? 'OK ' : 'BAD'} ${name.padEnd(10)} finL ${(finL * 100).toFixed(0).padStart(4)}cm finR ${(finR * 100).toFixed(0).padStart(4)}cm  R-knee up ${(knee * 100).toFixed(0).padStart(3)}cm  rise ${(rise * 100).toFixed(0).padStart(3)}cm  turned ${(turned * 57.3).toFixed(0).padStart(4)}°  max tilt ${maxTilt.toFixed(0).padStart(3)}°  after ${tilt().toFixed(1)}°`);
}
