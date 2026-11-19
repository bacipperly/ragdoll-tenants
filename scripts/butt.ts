// The butt: how far the back of the belly sticks out at cheek height, at the crease and on a cheek.
import { acquireSkin } from '../src/ragdoll/skin';
import { bodyDims } from '../src/ragdoll/proportions';
import { PROPORTIONS, TRAITS } from '../src/ragdoll/config';
for (const butt of [0, 0.6, 1.5]) {
  const D = bodyDims({ ...PROPORTIONS, butt }, { ...TRAITS });
  const g = acquireSkin(() => 0, D);
  const pos = g.getAttribute('position');
  // Body vertices come first: 24 per ring. Find the ring with the deepest back.
  let best = { back: 0, crease: 0, front: 0, y: 0 };
  for (let i = 0; i + 24 <= pos.count && i < 24 * 40; i += 24) {
    const z = (j: number) => pos.getZ(i + j);
    const cheek = Math.min(z(17), z(19)); // ±15° round from straight back (j = 18)
    if (-cheek > best.back) best = { back: -cheek, crease: -z(18), front: z(6), y: pos.getY(i) };
  }
  console.log(`butt ${butt}: cheeks ${best.back.toFixed(3)} behind, crease ${best.crease.toFixed(3)}, front ${best.front.toFixed(3)} at y ${best.y.toFixed(2)} (hip y ${D.hipY.toFixed(2)})`);
}
