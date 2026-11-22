// Hair: every style in every texture builds (with and without a hat) to a sane size,
// a knocked-off hat shows the hair it hid, it survives a recipe round trip, and what
// 13 long-haired tenants cost per frame.
import * as THREE from 'three';
import { RagdollPhysics, RAPIER, recipeFromEditor, parseRecipe, HAT } from '../src/ragdoll';
import { Hair, HAIR_STYLES, HAIR_TEXTURES, type HairSpec } from '../src/ragdoll/hair';
let bad = 0;
const ok = (good: boolean, label: string) => { if (!good) bad++; console.log(`${good ? 'OK ' : 'BAD'} ${label}`); };
const spec = (style: HairSpec['style'], texture: HairSpec['texture'] = 'straight'): HairSpec =>
  ({ style, texture, color: '#7a4a2a', part: 'left', accent: 'highlights', accentColor: '#e8c35a', fade: true });
let most = 0, mostName = '', broken = '';
for (const style of HAIR_STYLES) {
  for (const texture of HAIR_TEXTURES) {
    for (const underHat of [false, true]) {
      const h = new Hair(spec(style, texture), 0.14, null, underHat);
      const a = h.mesh.geometry.attributes.position.array as Float32Array;
      for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) { broken = `${style}/${texture}`; break; }
      if (h.vertexCount > most) { most = h.vertexCount; mostName = `${style}/${texture}`; }
      h.dispose();
    }
  }
}
ok(!broken, `all ${HAIR_STYLES.length} styles × ${HAIR_TEXTURES.length} textures × hat/no hat build cleanly${broken ? ` (NaN in ${broken})` : ''}`);
ok(most < 9000, `biggest: ${mostName}, ${most} vertices`);
const knot = new Hair(spec('topknot'), 0.14, null, false).vertexCount, knotHat = new Hair(spec('topknot'), 0.14, null, true).vertexCount;
ok(knotHat < knot * 0.75, `under a hat a topknot shrinks to what shows: ${knot} → ${knotHat} vertices`);

const phys = await RagdollPhysics.create();
phys.world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0));
const base = recipeFromEditor('T', '#ffcb00', 'calm');
base.outfit.hair = spec('long', 'wavy');
base.outfit.hat = { style: 'beanie', color: '#2bb3a3', backwards: false };
const sorted = (o: object) => JSON.stringify(Object.fromEntries(Object.entries(o).sort()));
ok(sorted(parseRecipe(JSON.parse(JSON.stringify(base)))!.outfit.hair!) === sorted(base.outfit.hair!), 'recipe round trip keeps the hair');
const r = phys.createRagdoll({ recipe: base }) as any;
const verts = () => r.hair?.vertexCount ?? 0;
const step = (s: number) => { for (let t = 0; t < s; t += 1 / 60) { phys.step(1 / 60); r.syncMeshes?.(1 / 60, 1); } };
step(1);
const underHat = verts();
HAT.fallChance = 1;
r.setKnockedOut(true); step(0.3);
const hatOff = verts();
ok(r.hatOff && hatOff > underHat, `hat knocked off: hair grows back from ${underHat} to ${hatOff} vertices`);
r.setKnockedOut(false); step(3);
// Shake it about: nothing flies off.
r.push(new THREE.Vector3(2.5, 0.4, 0)); r.playGesture('bow');
let far = 0;
const head = new THREE.Vector3(), p = new THREE.Vector3();
for (let t = 0; t < 3; t += 1 / 60) {
  phys.step(1 / 60); r.syncMeshes?.(1 / 60, 1);
  r.group.updateMatrixWorld(true);
  r.parts.get('head').bone.getWorldPosition(head);
  const a = r.hair.mesh.geometry.attributes.position.array as Float32Array;
  for (let i = 0; i < a.length; i += 30) { p.set(a[i], a[i + 1], a[i + 2]).applyMatrix4(r.hair.mesh.matrixWorld); far = Math.max(far, p.distanceTo(head)); }
}
ok(far < 0.14 * 2.6, `shoved and bowing: hair stays within ${(far / 0.14).toFixed(2)} head radii of the head`);
phys.removeRagdoll(r);

// Cost: 13 tenants with long hair, all close up.
const crowd = Array.from({ length: 13 }, (_, i) => {
  const rc = recipeFromEditor('T', '#ffcb00', 'calm'); rc.outfit.hair = spec('long');
  return phys.createRagdoll({ recipe: rc, position: new THREE.Vector3((i % 5) * 1.5, 0, Math.floor(i / 5) * 1.5) }) as any;
});
for (const c of crowd) c.setMoveInput(0, 1);
for (let k = 0; k < 60; k++) phys.step(1 / 60);
const t0 = performance.now();
for (let k = 0; k < 300; k++) for (const c of crowd) c.hair.update(1 / 60, c.parts.get('head').bone);
console.log(`    13 long-haired tenants: hair ${((performance.now() - t0) / 300).toFixed(3)} ms/frame (${crowd[0].hair.vertexCount} vertices each)`);
console.log(bad ? `${bad} BAD` : 'all OK');
