// A stand-in for the TripoAI model, to test the import pipeline before the real one
// arrives: a rough mascot built the way an exported model would come, in its own
// units (1.8 tall, feet at 0), its own head, fins held out 30°, legs in a slight V.
//   npx tsx scripts/make-standin.ts   → public/models/stand-in.glb
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { writeGlb } from './glb';

const parts: THREE.BufferGeometry[] = [];
const add = (g: THREE.BufferGeometry) => { g.deleteAttribute('uv'); parts.push(g.index ? g.toNonIndexed() : g); };
// Head: a big ball (about 55% of the height).
add(new THREE.SphereGeometry(0.5, 32, 20).translate(0, 1.3, 0));
// Body: a pear, narrow at the top under the head, round at the hips.
add(new THREE.LatheGeometry([[0, 0.38], [0.2, 0.4], [0.3, 0.5], [0.32, 0.62], [0.27, 0.74], [0.18, 0.82], [0, 0.86]].map(([r, y]) => new THREE.Vector2(r, y)), 32));
// Fins: teardrops from the shoulders, held 30° out.
for (const sx of [1, -1]) {
  const fin = new THREE.CapsuleGeometry(0.08, 0.32, 6, 12).translate(0, -0.2, 0);
  fin.rotateZ(sx * 0.52);
  add(fin.translate(sx * 0.27, 0.78, 0));
}
// Legs: short, tapered, in a slight V.
for (const sx of [1, -1]) {
  const leg = new THREE.CylinderGeometry(0.11, 0.07, 0.42, 14, 3).translate(0, -0.21, 0);
  leg.rotateZ(sx * 0.1);
  add(leg.translate(sx * 0.13, 0.44, 0));
}
const g = mergeVertices(mergeGeometries(parts)!, 1e-4); // weld, so the normals come out smooth
g.computeVertexNormals();
writeGlb('public/models/stand-in.glb', g.attributes.position.array as Float32Array, g.attributes.normal.array as Float32Array, Uint32Array.from(g.index!.array));
console.log(`public/models/stand-in.glb: ${g.index!.count / 3} triangles, ${g.attributes.position.count} vertices`);
