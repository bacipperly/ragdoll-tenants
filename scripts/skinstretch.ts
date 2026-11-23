// Tearing check for an imported body: runs a tenant through walking, running, turns,
// gestures, a shove and a knockout, skinning every vertex as it goes, and reports how
// far the worst triangle edges stretch from their rest length (a torn, shredded spot
// is an edge stretched many times over), and which bones they're on.
//   npx tsx scripts/skinstretch.ts [model.glb] [ours|rig]
import * as THREE from 'three';
import { RagdollPhysics, RAPIER, recipeFromEditor, prepareBodyModel, setBodyModel, calibrate, setProportionCalibration } from '../src/ragdoll';
import { loadModelFile } from './modelfile';
const file = process.argv[2], weights = (process.argv[3] ?? 'ours') as 'ours' | 'rig';
if (file) {
  const m = loadModelFile(file, { weights });
  setBodyModel(m); setProportionCalibration(calibrate(m) ?? {}, m.kneeHeight);
}
const phys = await RagdollPhysics.create();
phys.world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0));
const r = phys.createRagdoll({ recipe: recipeFromEditor('T', '#ffcb00', 'calm') }) as any;
const names: string[] = [...r.parts.keys(), 'butt'];
const geo: THREE.BufferGeometry = r.skin.geometry;
const idx = geo.index!.array, n = geo.attributes.position.count;
const si = geo.attributes.skinIndex.array as Uint16Array, sw = geo.attributes.skinWeight.array as Float32Array;
const rest = geo.attributes.position.array as Float32Array;
const edges: [number, number, number][] = [];
for (let t = 0; t < idx.length; t += 3) for (const [a, b] of [[idx[t], idx[t + 1]], [idx[t + 1], idx[t + 2]], [idx[t + 2], idx[t]]]) {
  const l = Math.hypot(rest[a * 3] - rest[b * 3], rest[a * 3 + 1] - rest[b * 3 + 1], rest[a * 3 + 2] - rest[b * 3 + 2]);
  if (l > 1e-5) edges.push([a, b, l]);
}
const worst = new Float32Array(edges.length), least = new Float32Array(edges.length).fill(Infinity);
const foldBy = new Map<string, number>();
const capFrom: number = geo.userData.capFrom ?? Infinity;
// Seams: vertices that start at the same spot (parts cut from one mesh) should stay together.
const seamGroups: number[][] = [];
{
  const map = new Map<string, number[]>();
  for (let i = 0; i < n; i++) { const k = `${Math.round(rest[i * 3] * 1e4)},${Math.round(rest[i * 3 + 1] * 1e4)},${Math.round(rest[i * 3 + 2] * 1e4)}`; (map.get(k) ?? map.set(k, []).get(k)!).push(i); }
  for (const g of map.values()) if (g.length > 1) seamGroups.push(g);
}
const growBy = new Map<string, number>();
let seamAt = '', seamGap = 0, finGap = 0, grow = 0, growAt = '';
const onFin = (i: number) => [0, 1, 2, 3].some((k) => sw[i * 4 + k] > 0.2 && /Arm/.test(names[si[i * 4 + k]] ?? ''));
const P = new Float32Array(n * 3), v = new THREE.Vector3();
let label = '';
const worstBy = new Map<string, number>();
const sample = () => {
  r.group.updateMatrixWorld(true); r.skin.skeleton.update();
  for (let i = 0; i < n; i++) { r.skin.getVertexPosition(i, v); P.set([v.x, v.y, v.z], i * 3); }
  let m = 0;
  for (let e = 0; e < edges.length; e++) {
    const [a, b, l] = edges[e];
    const s = Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2]) / l;
    if (s > worst[e]) worst[e] = s;
    if (s < least[e]) least[e] = s;
    if (s < 0.3 && !(a >= capFrom && b >= capFrom)) foldBy.set(label, (foldBy.get(label) ?? 0) + 1);
    if (!(a >= capFrom && b >= capFrom)) growBy.set(label, Math.max(growBy.get(label) ?? 0, (s - 1) * l));
    if ((s - 1) * l > grow) { grow = (s - 1) * l; growAt = `${label}, at y ${rest[a * 3 + 1].toFixed(3)}${a >= capFrom && b >= capFrom ? ', a cap edge (inside the body)' : ''}`; }
    m = Math.max(m, s);
  }
  worstBy.set(label, Math.max(worstBy.get(label) ?? 0, m));
  for (const g of seamGroups) for (let k = 1; k < g.length; k++) {
    const a = g[0], b = g[k];
    const gap = Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2]);
    if (g.some(onFin)) finGap = Math.max(finGap, gap);
    else if (gap > seamGap) { seamGap = gap; seamAt = `${label}: ${g.map((i) => [0, 1, 2, 3].filter((k) => sw[i * 4 + k] > 0.05).map((k) => `${names[si[i * 4 + k]]} ${sw[i * 4 + k].toFixed(2)}`).join('+')).join(' | ')} at y ${rest[g[0] * 3 + 1].toFixed(3)}`; }
  }
};
const step = (s: number) => { for (let t = 0; t < s; t += 1 / 60) { phys.step(1 / 60); r.syncMeshes(1 / 60, 1); if (Math.round(t * 60) % 3 === 0) sample(); } };
label = 'standing'; step(1.5);
label = 'walking'; r.setMoveInput(0, 1, true); step(2);
label = 'running'; r.setMoveInput(0, 1); step(2);
label = 'sharp turn'; r.setMoveInput(0, -1); step(1.5); r.setMoveInput(0, 0); step(0.5);
for (const gname of ['wave', 'celebrate', 'stomp', 'bow', 'shrug', 'flinch']) { label = gname; r.playGesture(gname); step(2); }
label = 'jump'; r.jump(); step(1.5);
label = 'shoved'; r.push(new THREE.Vector3(2.5, 0.4, 0)); step(2);
label = 'knocked out'; r.setKnockedOut(true); step(2);
label = 'getting up'; r.setKnockedOut(false); step(4);
console.log(`${file ?? 'generated body'} (${weights}): worst edge stretch per activity (1 = unstretched)`);
console.log('  ' + [...worstBy].map(([k, s]) => `${k} ${s.toFixed(1)}×`).join(' · '));
const order = [...worst.keys()].sort((a, b) => worst[b] - worst[a]);
const bonesOf = (i: number) => [0, 1, 2, 3].filter((k) => sw[i * 4 + k] > 0.05).map((k) => `${names[si[i * 4 + k]]} ${sw[i * 4 + k].toFixed(2)}`).join(', ');
console.log('  most a surface edge grows (mm, caps aside): ' + [...growBy].map(([k, g]) => `${k} ${(g * 1000).toFixed(0)}`).join(' · '));
console.log(`  most any one edge grows: ${(grow * 1000).toFixed(1)} mm (${((grow / r.dims.height) * 100).toFixed(1)}% of the height; ${growAt})`);
const folded = [...least.keys()].filter((e) => least[e] < 0.3 && !(edges[e][0] >= capFrom && edges[e][1] >= capFrom)).length;
console.log(`  folding (edges crushed under 30%, caps aside): ${folded} edges · ` + [...foldBy].map(([k, c]) => `${k} ${c}`).join(' · '));
{
  const where = new Map<string, number>();
  const fam = (i: number) => { let b = 0; for (let k = 1; k < 4; k++) if (sw[i * 4 + k] > sw[i * 4 + b]) b = k; const n = names[si[i * 4 + b]] ?? '?'; return n.replace(/[LR]$/, ''); };
  for (let e = 0; e < edges.length; e++) if (least[e] < 0.3 && !(edges[e][0] >= capFrom && edges[e][1] >= capFrom)) { const f = fam(edges[e][0]); where.set(f, (where.get(f) ?? 0) + 1); }
  console.log('  folding by part: ' + [...where].sort((a, b) => b[1] - a[1]).map(([k, c]) => `${k} ${c}`).join(' · '));
}
console.log(`  seams: ${seamGroups.length} shared points, widest gap ${(seamGap * 1000).toFixed(1)} mm at the legs and body, ${(finGap * 1000).toFixed(1)} mm where fins come away from the body (capped)`);
console.log(`  widest seam: ${seamAt}`);
console.log(`  edges over 2× : ${[...worst].filter((s) => s > 2).length} of ${edges.length}; over 4×: ${[...worst].filter((s) => s > 4).length}`);
for (const e of order.slice(0, 6)) {
  const [a, b] = edges[e];
  console.log(`  ${worst[e].toFixed(1)}×  [${bonesOf(a)}] — [${bonesOf(b)}]  at y ${rest[a * 3 + 1].toFixed(3)}`);
}
