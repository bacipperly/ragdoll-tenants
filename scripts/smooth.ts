// Drawn motion is even from frame to frame: a walking tenant on 60 Hz and 144 Hz screens,
// compared with drawing only the latest physics step (what it did before interpolation).
import * as THREE from 'three';
import { RagdollPhysics, RAPIER } from '../src/ragdoll';
for (const hz of [60, 144]) {
  const phys = await RagdollPhysics.create();
  phys.world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0));
  const r = phys.createRagdoll({ position: new THREE.Vector3(0, 0, 0), facing: 0 });
  for (let i = 0; i < hz; i++) phys.step(1 / hz);
  r.setMoveInput(0, 1);
  for (let i = 0; i < hz; i++) phys.step(1 / hz); // up to speed
  const drawn: number[] = [], latest: number[] = [];
  const v = new THREE.Vector3();
  let pd = r.drawnMiddle(v).z, pl = r.middle(v).z;
  for (let i = 0; i < hz; i++) {
    phys.step(1 / hz);
    const d = r.drawnMiddle(v).z, l = r.middle(v).z;
    drawn.push(d - pd); latest.push(l - pl); pd = d; pl = l;
  }
  // How uneven the per-frame movement is: spread of frame steps over their mean.
  const uneven = (xs: number[]) => {
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length) / Math.abs(m);
  };
  const u = uneven(drawn);
  console.log(u < 0.15 ? 'OK  ' : 'FAIL', `${hz} Hz screen: frame-to-frame unevenness ${(100 * u).toFixed(0)}% (latest step only: ${(100 * uneven(latest)).toFixed(0)}%)`);
}

// A prop in flight: the beach ball, thrown sideways, drawn at 60 Hz.
{
  const { Things } = await import('../src/things');
  const phys = await RagdollPhysics.create();
  phys.world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0));
  const things = new Things(phys.world, new THREE.Scene());
  phys.beforeStep.push(() => things.rememberPose());
  const ball = things.list.find((t) => t.name === 'beach ball')!;
  ball.body.setTranslation({ x: 0, y: 2, z: 5 }, true);
  ball.body.setLinvel({ x: 3, y: 0, z: 0 }, true);
  const xs: number[] = [];
  let px = ball.body.translation().x;
  for (let i = 0; i < 30; i++) {
    phys.step(1 / 60); things.update(1 / 60, [], phys.alpha);
    xs.push(ball.mesh.position.x - px); px = ball.mesh.position.x;
  }
  xs.shift(); // the first frame blends from where it was before the teleport
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const u = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length) / Math.abs(m);
  console.log(u < 0.15 ? 'OK  ' : 'FAIL', `thrown ball, 60 Hz screen: frame-to-frame unevenness ${(100 * u).toFixed(0)}%`);
}
