// A small .glb reader and writer for scripts (no browser needed): reads every mesh's
// positions, normals and triangles, placed by the node transforms; writes one mesh.
import * as THREE from 'three';
import { readFileSync, writeFileSync } from 'node:fs';

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface GlbInfo {
  json: any;
  positions: Float32Array;
  normals: Float32Array;
  index: Uint32Array;
  meshes: number;
  primitives: number;
  /** Each vertex's part (which mesh it came from), when there's more than one. */
  part?: Int32Array;
  /** The model's own rig, when its meshes are skinned. */
  rig?: { joints: Uint16Array; weights: Float32Array; names: string[]; bones?: { name: string; x: number; y: number; z: number }[] };
}

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

export function readGlb(file: string): GlbInfo {
  const buf = readFileSync(file);
  if (buf.toString('utf8', 0, 4) !== 'glTF') throw new Error(`${file}: not a .glb`);
  let off = 12, json: any = null, bin: Buffer | null = null;
  while (off < buf.length) {
    const len = buf.readUInt32LE(off), type = buf.toString('utf8', off + 4, off + 8);
    const body = buf.subarray(off + 8, off + 8 + len);
    if (type === 'JSON') json = JSON.parse(body.toString('utf8'));
    else if (type.startsWith('BIN')) bin = body;
    off += 8 + len;
  }
  if (!json) throw new Error(`${file}: no JSON chunk`);
  const compressed = (json.extensionsUsed ?? []).filter((e: string) => /draco|meshopt/i.test(e));
  if (compressed.length) throw new Error(`${file}: compressed with ${compressed.join(', ')}; export it uncompressed`);

  const read = (accIndex: number): Float32Array | Uint32Array => {
    const acc = json.accessors[accIndex], view = json.bufferViews[acc.bufferView];
    const n = COMPONENTS[acc.type], count = acc.count;
    const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    const size = { 5126: 4, 5125: 4, 5123: 2, 5121: 1 }[acc.componentType as 5126]!;
    const stride = view.byteStride ?? n * size;
    const out = acc.componentType === 5126 || acc.normalized ? new Float32Array(count * n) : new Uint32Array(count * n);
    const norm = acc.normalized ? (acc.componentType === 5121 ? 255 : acc.componentType === 5123 ? 65535 : 1) : 1;
    for (let i = 0; i < count; i++) {
      for (let k = 0; k < n; k++) {
        const at = base + i * stride + k * size;
        out[i * n + k] = acc.componentType === 5126 ? bin!.readFloatLE(at)
          : acc.componentType === 5125 ? bin!.readUInt32LE(at)
          : (acc.componentType === 5123 ? bin!.readUInt16LE(at) : bin!.readUInt8(at)) / norm;
      }
    }
    return out;
  };

  const pos: number[] = [], nrm: number[] = [], idx: number[] = [], part: number[] = [];
  const joints: number[] = [], weights: number[] = [], names: string[] = [];
  let meshes = 0, primitives = 0, rigged = true;
  const nodeAt = new Map<string, THREE.Vector3>(); // every node's rest position in the world (for the rig's bones)
  const v = new THREE.Vector3(), nm = new THREE.Matrix3();
  const visit = (nodeIndex: number, parent: THREE.Matrix4) => {
    const node = json.nodes[nodeIndex];
    const local = new THREE.Matrix4();
    if (node.matrix) local.fromArray(node.matrix);
    else local.compose(new THREE.Vector3(...(node.translation ?? [0, 0, 0])), new THREE.Quaternion(...(node.rotation ?? [0, 0, 0, 1])), new THREE.Vector3(...(node.scale ?? [1, 1, 1])));
    const world = parent.clone().multiply(local);
    if (node.name) nodeAt.set(node.name, new THREE.Vector3().setFromMatrixPosition(world));
    if (node.mesh !== undefined) {
      meshes++;
      nm.getNormalMatrix(world);
      for (const prim of json.meshes[node.mesh].primitives) {
        if ((prim.mode ?? 4) !== 4) continue; // triangles only
        primitives++;
        const p = read(prim.attributes.POSITION) as Float32Array;
        const n = prim.attributes.NORMAL !== undefined ? read(prim.attributes.NORMAL) as Float32Array : null;
        const base = pos.length / 3;
        for (let i = 0; i < p.length / 3; i++) part.push(meshes - 1);
        // The rig: joints are indices into the skin's joint list, which names nodes.
        if (node.skin !== undefined && prim.attributes.JOINTS_0 !== undefined && prim.attributes.WEIGHTS_0 !== undefined) {
          const sj = json.skins[node.skin].joints as number[];
          const J = read(prim.attributes.JOINTS_0), W = read(prim.attributes.WEIGHTS_0);
          for (let i = 0; i < J.length; i++) {
            const nm = json.nodes[sj[J[i]]]?.name ?? '';
            let j = names.indexOf(nm);
            if (j < 0) { j = names.length; names.push(nm); }
            joints.push(j); weights.push(W[i]);
          }
        } else rigged = false;
        for (let i = 0; i < p.length; i += 3) {
          v.set(p[i], p[i + 1], p[i + 2]).applyMatrix4(world); pos.push(v.x, v.y, v.z);
          if (n) { v.set(n[i], n[i + 1], n[i + 2]).applyMatrix3(nm).normalize(); nrm.push(v.x, v.y, v.z); } else nrm.push(0, 0, 0);
        }
        if (prim.indices !== undefined) for (const i of read(prim.indices)) idx.push(base + i);
        else for (let i = 0; i < p.length / 3; i++) idx.push(base + i);
      }
    }
    for (const c of node.children ?? []) visit(c, world);
  };
  for (const root of json.scenes[json.scene ?? 0].nodes) visit(root, new THREE.Matrix4());
  // Missing normals: from the triangles.
  if (nrm.some((x, i) => i % 3 === 0 && x === 0 && nrm[i + 1] === 0 && nrm[i + 2] === 0)) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const cn = g.attributes.normal.array;
    for (let i = 0; i < nrm.length; i++) if (nrm[i - (i % 3)] === 0 && nrm[i - (i % 3) + 1] === 0 && nrm[i - (i % 3) + 2] === 0) nrm[i] = cn[i];
  }
  return {
    json, positions: Float32Array.from(pos), normals: Float32Array.from(nrm), index: Uint32Array.from(idx), meshes, primitives,
    part: meshes > 1 ? Int32Array.from(part) : undefined,
    rig: rigged && names.length ? {
      joints: Uint16Array.from(joints), weights: Float32Array.from(weights), names,
      bones: [...new Set((json.skins ?? []).flatMap((sk: any) => sk.joints.map((j: number) => json.nodes[j].name as string)))]
        .filter((n) => nodeAt.has(n as string)).map((n) => { const p = nodeAt.get(n as string)!; return { name: n as string, x: p.x, y: p.y, z: p.z }; }),
    } : undefined,
  };
}

/** Writes one mesh (positions, normals, triangles) as a .glb. */
export function writeGlb(file: string, positions: Float32Array, normals: Float32Array, index: Uint32Array): void {
  const pad = (n: number) => (n + 3) & ~3;
  const pBytes = positions.byteLength, nBytes = normals.byteLength, iBytes = index.byteLength;
  const bin = Buffer.alloc(pad(pBytes + nBytes + iBytes));
  Buffer.from(positions.buffer, positions.byteOffset, pBytes).copy(bin, 0);
  Buffer.from(normals.buffer, normals.byteOffset, nBytes).copy(bin, pBytes);
  Buffer.from(index.buffer, index.byteOffset, iBytes).copy(bin, pBytes + nBytes);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i++) { min[i % 3] = Math.min(min[i % 3], positions[i]); max[i % 3] = Math.max(max[i % 3], positions[i]); }
  const json = {
    asset: { version: '2.0', generator: 'ragdoll scripts/glb.ts' },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: 'body' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2 }] }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: pBytes, target: 34962 },
      { buffer: 0, byteOffset: pBytes, byteLength: nBytes, target: 34962 },
      { buffer: 0, byteOffset: pBytes + nBytes, byteLength: iBytes, target: 34963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: positions.length / 3, type: 'VEC3', min, max },
      { bufferView: 1, componentType: 5126, count: normals.length / 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5125, count: index.length, type: 'SCALAR' },
    ],
  };
  let jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(pad(jsonBuf.length) - jsonBuf.length, 0x20)]);
  const header = Buffer.alloc(12);
  header.write('glTF', 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + bin.length, 8);
  const chunk = (len: number, type: string) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.write(type, 4); return b; };
  writeFileSync(file, Buffer.concat([header, chunk(jsonBuf.length, 'JSON'), jsonBuf, chunk(bin.length, 'BIN\0'), bin]));
}
