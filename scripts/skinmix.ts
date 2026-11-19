// Vertices whose weights mix a fin bone with a non-fin bone: where are they (rest pose)?
import { RagdollPhysics } from '../src/ragdoll';
const phys = await RagdollPhysics.create();
const r = phys.createRagdoll();
const g = r.skin.geometry; const pos = g.getAttribute('position'); const si = g.getAttribute('skinIndex'), sw = g.getAttribute('skinWeight');
const fin = new Set([3, 4, 7, 8]); const hist: Record<string, number> = {}; let mixed = 0;
for (let v = 0; v < pos.count; v++) {
  let f = 0; const bones: string[] = [];
  for (let t = 0; t < 4; t++) { const b = [si.getX(v), si.getY(v), si.getZ(v), si.getW(v)][t], w = [sw.getX(v), sw.getY(v), sw.getZ(v), sw.getW(v)][t]; if (w > 0.01) bones.push(b + ''); if (fin.has(b)) f += w; }
  if (f > 0.05 && f < 0.95) { mixed++; const k = `y${pos.getY(v).toFixed(2)}[${bones.join(',')}]`; hist[k] = (hist[k] ?? 0) + 1; }
}
console.log('mixed fin/non-fin vertices', mixed); console.log(Object.entries(hist).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => k + ':' + v).join('  '));
