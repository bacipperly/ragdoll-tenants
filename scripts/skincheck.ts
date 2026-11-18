// Checks the skin: bounds match the drawing's proportions and normals face outward.
import * as THREE from 'three';
import { skinGeometry } from '../src/ragdoll/skin';
const names = ['torso','chest','head','upperArmL','forearmL','thighL','shinL','upperArmR','forearmR','thighR','shinR'];
const g = skinGeometry((n) => names.indexOf(n));
g.computeBoundingBox(); const b = g.boundingBox!;
console.log('verts', g.attributes.position.count, 'bounds y', b.min.y.toFixed(3), '..', b.max.y.toFixed(3), 'x', b.min.x.toFixed(3), '..', b.max.x.toFixed(3));
const pos = g.attributes.position, nor = g.attributes.normal; let out = 0, inn = 0;
const p = new THREE.Vector3(), n = new THREE.Vector3();
for (let i = 0; i < pos.count; i++) { p.fromBufferAttribute(pos, i); n.fromBufferAttribute(nor, i); const c = new THREE.Vector3(0, p.y, 0); if (p.y > 0.49) c.set(0, 0.69, 0); else if (Math.abs(p.x) > 0.1 || (Math.abs(p.x) > 0.02 && p.y < 0.1)) c.set(Math.sign(p.x) * (p.y < 0.2 ? 0.045 : 0.05), p.y, 0); const d = p.clone().sub(c); if (d.length() < 1e-4) continue; d.dot(n) > 0 ? out++ : inn++; }
console.log('normals outward', out, 'inward', inn);
const sw = g.attributes.skinWeight; let bad = 0; for (let i = 0; i < sw.count; i++) { const s = sw.getX(i) + sw.getY(i) + sw.getZ(i) + sw.getW(i); if (Math.abs(s - 1) > 1e-4) bad++; } console.log('weights not summing to 1:', bad);
