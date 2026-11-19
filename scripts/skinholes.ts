// Holes in the blended skin: edges used by only one triangle, and where they are.
import { RagdollPhysics } from '../src/ragdoll';
const phys = await RagdollPhysics.create();
const r = phys.createRagdoll();
const g = r.skin.geometry; const idx = g.index!.array; const pos = g.getAttribute('position');
const edges = new Map<string, number>();
for (let t = 0; t < idx.length; t += 3) for (let e = 0; e < 3; e++) {
  const a = idx[t + e], b = idx[t + (e + 1) % 3]; const k = a < b ? a + ',' + b : b + ',' + a; edges.set(k, (edges.get(k) ?? 0) + 1);
}
let open = 0, over = 0; const ys: number[] = [];
for (const [k, n] of edges) { if (n === 1) { open++; ys.push(+pos.getY(+k.split(',')[0]).toFixed(2)); } if (n > 2) over++; }
console.log('verts', pos.count, 'open edges', open, 'edges shared by >2 tris', over);
const hist: Record<string, number> = {}; for (const y of ys) hist[y] = (hist[y] ?? 0) + 1; console.log(JSON.stringify(hist));
