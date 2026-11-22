// Inspects a body model (.glb) before it goes into the game: what's in it, how big,
// how it stands, and what the importer (src/ragdoll/bodyModel.ts) makes of it.
//   npx tsx scripts/inspect-model.ts public/models/tenant.glb
import { existsSync, readFileSync } from 'node:fs';
import { readGlb } from './glb';
import { calibrate, ourBoneForRigBone, prepareBodyModel, slices, type BodyModelSettings } from '../src/ragdoll/bodyModel';

const file = process.argv[2];
if (!file) { console.log('usage: npx tsx scripts/inspect-model.ts <model.glb>'); process.exit(1); }
const settingsFile = file.replace(/\.glb$/i, '.json');
const settings: BodyModelSettings = existsSync(settingsFile) ? JSON.parse(readFileSync(settingsFile, 'utf8')) : {};
const g = readGlb(file);
const J = g.json;
const tris = g.index.length / 3, verts = g.positions.length / 3;
const ok = (good: boolean, label: string) => console.log(`${good ? 'OK  ' : 'NOTE'} ${label}`);

console.log(`\n${file}${existsSync(settingsFile) ? ` (+ ${settingsFile})` : ''}`);
console.log(`  meshes ${g.meshes}, primitives ${g.primitives}, ${tris} triangles, ${verts} vertices`);
console.log(`  materials ${J.materials?.length ?? 0}, textures ${J.textures?.length ?? 0}, images ${J.images?.length ?? 0}, skins ${J.skins?.length ?? 0}, animations ${J.animations?.length ?? 0}`);
if (J.extensionsUsed?.length) console.log(`  extensions: ${J.extensionsUsed.join(', ')}`);

let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < g.positions.length; i++) { min[i % 3] = Math.min(min[i % 3], g.positions[i]); max[i % 3] = Math.max(max[i % 3], g.positions[i]); }
const size = max.map((v, i) => v - min[i]);
console.log(`  size  x ${size[0].toFixed(3)}  y ${size[1].toFixed(3)}  z ${size[2].toFixed(3)}  (feet at y ${min[1].toFixed(3)})`);

console.log('\nAgainst the brief:');
ok(tris <= 15000, `triangles: ${tris} (aim for 5,000–15,000; 13 tenants share the screen)`);
ok(size[1] >= size[0] && size[1] >= size[2], 'stands up along +y');
ok(true, g.rig ? `has its own rig (${g.rig.names.length} bones used): usable with "weights": "rig" in the .json` : 'no rig (our own weights are used)');
ok(!(J.textures?.length), J.textures?.length ? 'has textures: ignored (the tenant material colours it; check no face is painted on)' : 'no textures');
ok(true, g.part ? `${g.meshes} parts: used to place the head, fins and legs exactly` : '1 mesh, not segmented: parts are guessed from the shape');

const m = prepareBodyModel('inspect', g.positions, g.normals, g.index, settings, { part: g.part, rig: g.rig });
const H = m.landmarks.top - m.landmarks.feet;
console.log('\nLandmarks (model units, share of height, how found):');
for (const k of ['top', 'neck', 'shoulder', 'crotch', 'feet'] as const) {
  console.log(`  ${k.padEnd(9)} ${m.landmarks[k].toFixed(3)}  ${(((m.landmarks[k] - m.landmarks.feet) / H) * 100).toFixed(0).padStart(3)}%  ${m.found[k]}`);
}
console.log(`  head = ${(((m.landmarks.top - m.landmarks.neck) / H) * 100).toFixed(0)}% of the height (the brief: ~55%)`);
console.log(`  fins held out ${(m.armAngle * 57.3).toFixed(0)}°, legs ${(m.legAngle * 57.3).toFixed(0)}°`);
if (m.part) {
  console.log('\nParts:');
  const counts = new Map<number, number>();
  for (const p of m.part) counts.set(p, (counts.get(p) ?? 0) + 1);
  m.roles.forEach((r, i) => console.log(`  part ${i}: ${r.padEnd(6)} ${counts.get(i)} vertices`));
}
if (m.measures) {
  const M = m.measures, H = M.height;
  console.log(`\nMeasured: head ${M.headWidth.toFixed(3)} wide × ${M.headHeight.toFixed(3)} tall (${((M.headWidth / M.headHeight - 1) * 100).toFixed(0)}% wider than tall), diameter ${((2 * M.headRadius / H) * 100).toFixed(0)}% of the height`);
  console.log(`  hips at ${((M.hip / H) * 100).toFixed(0)}%, body ${((2 * M.torsoHalfWidth / H) * 100).toFixed(0)}% wide, fins ${((M.finLength / H) * 100).toFixed(0)}% long`);
  const f = calibrate(m);
  if (f) console.log(`Calibration (× our proportions): ${Object.entries(f).map(([k, v]) => `${k} ${v}`).join(', ')}`);
}
if (g.rig) {
  const map = new Map<string, string[]>();
  for (const n of g.rig.names) { const o = ourBoneForRigBone(n); map.set(o, [...(map.get(o) ?? []), n.replace(/^.*:/, '')]); }
  console.log('\nRig bones → ours:');
  for (const [o, ns] of map) console.log(`  ${o.padEnd(10)} ← ${ns.slice(0, 8).join(', ')}${ns.length > 8 ? `, … (${ns.length})` : ''}`);
}
console.log('\nProfile (width, and pieces across: 1 body, 2 legs, 3+ body and fins):');
const S = slices(m.positions, m.index, 24);
const wMax = Math.max(...S.map((s) => s.maxX - s.minX));
for (let k = S.length - 1; k >= 0; k--) {
  const s = S[k], w = s.maxX - s.minX;
  const mark = (['neck', 'shoulder', 'crotch'] as const).find((l) => Math.abs(m.landmarks[l] - s.y) < H / 48);
  console.log(`  ${s.y.toFixed(3).padStart(7)} ${'#'.repeat(Math.round((w / wMax) * 40)).padEnd(40)} ${s.pieces.length}${mark ? `  ← ${mark}` : ''}`);
}
console.log(`\nAnything wrong? Override it in ${settingsFile}, e.g. {"yaw": 180, "landmarks": {"neck": 1.02}, "armAngle": 25}`);
