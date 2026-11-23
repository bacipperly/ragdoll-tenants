// Writes a body model as a single OBJ mesh (positions, normals, triangles), e.g. to
// upload to an auto-rigger like Mixamo, which takes OBJ or FBX but not GLB.
//   npx tsx scripts/export-obj.ts <in.glb> <out.obj>
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { readGlb } from './glb';
const [, , inFile, outFile] = process.argv;
if (!inFile || !outFile) { console.log('usage: npx tsx scripts/export-obj.ts <in.glb> <out.obj>'); process.exit(1); }
const g = readGlb(inFile);
const lines: string[] = ['# exported from ' + inFile.split('/').pop()];
for (let i = 0; i < g.positions.length; i += 3) lines.push(`v ${g.positions[i].toFixed(6)} ${g.positions[i + 1].toFixed(6)} ${g.positions[i + 2].toFixed(6)}`);
for (let i = 0; i < g.normals.length; i += 3) lines.push(`vn ${g.normals[i].toFixed(5)} ${g.normals[i + 1].toFixed(5)} ${g.normals[i + 2].toFixed(5)}`);
for (let t = 0; t < g.index.length; t += 3) { const [a, b, c] = [g.index[t] + 1, g.index[t + 1] + 1, g.index[t + 2] + 1]; lines.push(`f ${a}//${a} ${b}//${b} ${c}//${c}`); }
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, lines.join('\n') + '\n');
let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < g.positions.length; i++) { min[i % 3] = Math.min(min[i % 3], g.positions[i]); max[i % 3] = Math.max(max[i % 3], g.positions[i]); }
console.log(`${outFile}: ${g.index.length / 3} triangles, ${g.positions.length / 3} vertices, ${g.meshes} mesh(es); size ${max.map((v, i) => (v - min[i]).toFixed(3)).join(' × ')}`);
