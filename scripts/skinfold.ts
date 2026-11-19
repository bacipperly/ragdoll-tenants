// Folds: skin the mesh on the CPU in live poses and count triangles that flipped over
// (their skinned face normal points against their skinned vertex normals).
import * as THREE from 'three';
import { RagdollPhysics, RAPIER } from '../src/ragdoll';
const phys = await RagdollPhysics.create();
phys.world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0));
const r = phys.createRagdoll(); const m = r.skin;
const g = m.geometry; const idx = g.index!.array; const n = g.getAttribute('position').count;
const P = Array.from({ length: n }, () => new THREE.Vector3());
const step = (s: number) => { for (let t = 0; t < s; t += 1 / 60) { phys.step(1 / 60); r.syncMeshes(1 / 60); } };
const folds = (label: string) => {
  r.group.updateMatrixWorld(true); m.skeleton.update();
  for (let i = 0; i < n; i++) m.getVertexPosition(i, P[i]);
  const si = g.getAttribute('skinIndex'); const byBone: Record<number, number> = {}; let flipped = 0; const fin = new Set([3, 4, 7, 8]); let finF = 0;
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), rest = new THREE.Vector3(), ra = new THREE.Vector3(), rb = new THREE.Vector3(), rc = new THREE.Vector3();
  const pos = g.getAttribute('position');
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
    ab.subVectors(P[b], P[a]); ac.subVectors(P[c], P[a]); ab.cross(ac);
    ra.fromBufferAttribute(pos, a); rb.fromBufferAttribute(pos, b).sub(ra); rc.fromBufferAttribute(pos, c).sub(ra); rest.crossVectors(rb, rc);
    // Compare with the rest-pose face turned by the dominant bone: cheap proxy = sign vs rest when areas are sane.
    if (ab.lengthSq() < 1e-14 || rest.lengthSq() < 1e-14) continue;
    const bone = m.skeleton.bones[si.getX(a)]; const q = bone.quaternion;
    rest.applyQuaternion(q);
    if (ab.dot(rest) < 0) { flipped++; byBone[si.getX(a)] = (byBone[si.getX(a)] ?? 0) + 1; if (fin.has(si.getX(a))) finF++; }
  }
  console.log(label.padEnd(14), 'flipped tris', flipped, '(fin', finF + ')', JSON.stringify(byBone));
};
step(1.5); folds('standing');
r.setMoveInput(0, 1); step(0.7); folds('walking'); step(0.35); folds('walking 2'); r.setMoveInput(0, 0);
r.setMood?.('proud'); step(1); folds('proud');
r.setMood?.('sad'); step(1); folds('sad');
