// Spikes: triangle edges much longer than a grid cell, and tris facing against their normals.
import * as THREE from 'three';
import { RagdollPhysics } from '../src/ragdoll';
const phys = await RagdollPhysics.create();
const r = phys.createRagdoll();
const g = r.skin.geometry; const idx = g.index!.array; const pos = g.getAttribute('position'); const nor = g.getAttribute('normal');
const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
let long = 0, against = 0, maxE = 0; const cell = 0.006 * r.dims.bellyR / 0.089;
for (let t = 0; t < idx.length; t += 3) {
  a.fromBufferAttribute(pos, idx[t]); b.fromBufferAttribute(pos, idx[t + 1]); c.fromBufferAttribute(pos, idx[t + 2]);
  const e = Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)); maxE = Math.max(maxE, e); if (e > 3 * cell) long++;
  n.fromBufferAttribute(nor, idx[t]); const f = b.clone().sub(a).cross(c.clone().sub(a)); if (f.dot(n) < 0 && f.length() > 1e-9) against++;
}
console.log('tris', idx.length / 3, '| edges > 3 cells', long, '| longest', (maxE / cell).toFixed(1), 'cells | tris facing against vertex normal', against);
const sk = g.getAttribute('skinIndex'); const hist: Record<string, number> = {};
for (let t = 0; t < idx.length; t += 3) {
  a.fromBufferAttribute(pos, idx[t]); b.fromBufferAttribute(pos, idx[t + 1]); c.fromBufferAttribute(pos, idx[t + 2]);
  const e = Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)); if (e <= 3 * cell) continue;
  const key = `y${a.y.toFixed(2)} bone${sk.getX(idx[t])}`; hist[key] = (hist[key] ?? 0) + 1;
}
console.log(Object.entries(hist).sort((x, y) => y[1] - x[1]).slice(0, 15).map(([k, v]) => k + ':' + v).join('  '));
