// Design-spec check for a look: head share of height (target ~55%), and floor clearance
// (belly capsule bottom, fin tips) across body types. Usage: tsx scripts/clearance.ts '{"legLength":0.7}'
import { bodyDims } from '../src/ragdoll/proportions';
import { BODY, PROPORTIONS, TRAITS } from '../src/ragdoll/config';
import { applyTuning } from '../src/ragdoll/tuning';
import tuning from '../src/ragdoll/tuning.json';
applyTuning(tuning as Record<string, number>);
const p = { ...PROPORTIONS, ...JSON.parse(process.argv[2] ?? '{}') };
for (const [label, w, f, age] of [['adult', 0, 0, 0.5], ['heavy', 1, -1, 0.5], ['heavy fit', 1, 1, 0.5], ['thin', -1, 0, 0.5], ['baby', 0, 0, 0], ['elder', 0, 0, 1], ['heavy elder', 1, -1, 1]] as const) {
  const d = bodyDims(p, { ...TRAITS, weight: w, fitness: f, age });
  const half = Math.max(0, d.bellyLen / 2 - d.bellyR);
  console.log(`${label.padEnd(12)} head ${(200 * d.headR / d.height).toFixed(0)}%  height ${d.height.toFixed(3)}  belly clear ${(d.bellyY - half - d.bellyR).toFixed(3)}  fin tip ${(d.shoulderY - d.upperArmLen - d.forearmLen).toFixed(3)} (hip ${d.hipY.toFixed(3)})`);
}
void BODY;
