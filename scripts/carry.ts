// Carrying: pick up a thing and a tenant, walk, throw; thrown tenant gets up; trampoline bounce.
import * as THREE from 'three';
import { RagdollPhysics, RAPIER, randomRecipe, recipeFromEditor } from '../src/ragdoll';
import { Carry, Things } from '../src/things';
const phys = await RagdollPhysics.create();
phys.world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0));
const scene = new THREE.Scene();
const things = new Things(phys.world, scene);
const carry = new Carry(phys.world);
const a = phys.createRagdoll({ position: new THREE.Vector3(1.1, 0, 0.9), facing: 0 }); // facing the ball (at 1.1, _, 1.3)
const b = phys.createRagdoll({ recipe: randomRecipe(recipeFromEditor('B', '#ff0000', 'calm')), position: new THREE.Vector3(0, 0, -2) });
const all = [a, b];
const step = (s: number) => { for (let t = 0; t < s; t += 1 / 60) { phys.step(1 / 60); things.update(1 / 60, all); carry.update(1 / 60, all); } };
const tilt = (r: any) => { const o = r.bellyBody.rotation(); return Math.acos(Math.min(1, 1 - 2 * (o.x * o.x + o.z * o.z))) * 57.3; };
const pos = (r: any) => { const v = new THREE.Vector3(); r.middle(v); return v; };
const ball = things.list.find((t) => t.name === 'beach ball')!;
step(1.5);
console.log('grab →', carry.grab(a, things, all));
step(0.5);
const headTop = (a as any).parts.get('head').body.translation().y + a.dims.headR;
const chest = a.chestBody.translation(); const bp = ball.body.translation(); const f0 = a.debugState().facing;
console.log('ball in front of chest:', ((bp.x - chest.x) * Math.sin(f0) + (bp.z - chest.z) * Math.cos(f0)).toFixed(2), 'ahead,', (bp.y - chest.y).toFixed(2), 'up from chest; below head top', bp.y < headTop);
console.log('ball above head:', (ball.body.translation().y - headTop).toFixed(2), 'units; carrier tilt', tilt(a).toFixed(1) + '°');
a.setMoveInput(0, 1); step(1.5); a.setMoveInput(0, 0); step(0.5);
console.log('walked with it: ball still overhead', (ball.body.translation().y - headTop) > 0, '| carrier tilt', tilt(a).toFixed(1) + '°');
const before = ball.body.translation(); carry.throw(); step(2);
const after = ball.body.translation();
console.log('threw ball:', Math.hypot(after.x - before.x, after.z - before.z).toFixed(2), 'units away; carrier holding?', a.isHolding);
// Pick up tenant b: walk a next to b, facing it.
a.reset(new THREE.Vector3(0, 0, -1.55), Math.PI); step(1);
console.log('grab →', carry.grab(a, things, all), '| b carried:', b.isCarried);
step(1.5);
console.log('b held overhead: belly', (pos(b).y - pos(a).y).toFixed(2), 'above carrier belly | carrier tilt', tilt(a).toFixed(1) + '°, carrier height ok', Math.abs(pos(a).y - a.dims.hoverHeight) < 0.03);
const b0 = pos(b); carry.throw(); step(0.4);
console.log('thrown: b knocked out (limp)', b.isKnockedOut);
let upAt = -1; for (let t = 0; t < 8; t += 1 / 60) { step(1 / 60); if (upAt < 0 && !b.isKnockedOut && Math.abs(pos(b).y - b.dims.hoverHeight) < 0.03 && tilt(b) < 8) upAt = t; }
console.log('b flew', pos(b).distanceTo(b0).toFixed(2), 'units, landed and was back on its feet after', upAt.toFixed(1), 's');
// Trampoline at (-1.4, 0, 2.6): walk b onto it.
b.reset(new THREE.Vector3(-1.4, 0, 1.6), 0); step(1); let top = 0; b.setMoveInput(0, 1); for (let t = 0; t < 1.2; t += 1 / 60) { step(1 / 60); top = Math.max(top, pos(b).y); } b.setMoveInput(0, 0);
console.log('trampoline: belly rose to', top.toFixed(2), '(standing height', b.dims.hoverHeight.toFixed(2) + ')');
