// Clumsiness: at a ledge it teeters and sometimes slips off (sometimes catches itself);
// in the middle of a platform, or jumping on the flat, never; a drop from a height
// sometimes trips it; and whatever knocks it over, it gets back up.
import * as THREE from 'three';
import { RagdollPhysics, RAPIER } from '../src/ragdoll';
const TRIALS = 24;
const phys = await RagdollPhysics.create();
phys.world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0));
// A platform 0.3 high, its +z edge at z = 0.5.
phys.world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 0.15, 0.5).setTranslation(0, 0.15, 0));
const r: any = phys.createRagdoll({ position: new THREE.Vector3(5, 0, 5) });
const step = (s: number, f?: () => void) => { for (let t = 0; t < s; t += 1 / 60) { phys.step(1 / 60); f?.(); } };

function trial(at: THREE.Vector3, seconds: number, setup?: () => void) {
  r.reset(at, 0); setup?.();
  let teetered = false, tumbled = false;
  step(seconds, () => { teetered ||= r.teeter > 0.5; tumbled ||= r.isTumbling; });
  r.setMoveInput(0, 0);
  // Up again afterwards?
  let up = !r.isKnockedOut;
  if (!up) step(5, () => { up ||= !r.isKnockedOut && r.muscle > 0.9; });
  return { teetered, tumbled, up };
}
const run = (name: string, at: THREE.Vector3, seconds: number, setup?: () => void) => {
  let teeter = 0, tumble = 0, up = 0;
  for (let i = 0; i < TRIALS; i++) { const o = trial(at, seconds, setup); teeter += +o.teetered; tumble += +o.tumbled; up += +o.up; }
  return { name, teeter, tumble, up };
};
const report = (o: { name: string; teeter: number; tumble: number; up: number }, ok: boolean) =>
  console.log(ok ? 'OK  ' : 'FAIL', `${o.name.padEnd(28)} teetered ${o.teeter}/${TRIALS}  fell ${o.tumble}/${TRIALS}  back up ${o.up}/${TRIALS}`);

const mid = run('middle of the platform', new THREE.Vector3(0, 0.3, 0), 3);
report(mid, mid.teeter === 0 && mid.tumble === 0);
const edge = run('standing at the edge', new THREE.Vector3(0, 0.3, 0.47), 3);
report(edge, edge.teeter > TRIALS * 0.8 && edge.tumble > 0 && edge.tumble < TRIALS && edge.up === TRIALS);
const creep = run('creeping up to the edge', new THREE.Vector3(0, 0.3, 0.1), 3, () => r.setMoveInput(0, 0.25, true));
report(creep, creep.teeter > 0 && creep.up === TRIALS);
const jump = run('jumping on the flat', new THREE.Vector3(3, 0, 3), 2, () => { step(0.5); r.jump(); });
report(jump, jump.tumble === 0);
const bench = run('jumping off a 0.3 platform', new THREE.Vector3(0, 0.3, 0.2), 2.5, () => { step(0.4); r.setMoveInput(0, 1); step(0.1); r.jump(); });
report(bench, bench.up === TRIALS);
const drop = run('dropped from 1.0 up', new THREE.Vector3(3, 1.0, 3), 2.5);
report(drop, drop.tumble > 0 && drop.tumble < TRIALS && drop.up === TRIALS);
