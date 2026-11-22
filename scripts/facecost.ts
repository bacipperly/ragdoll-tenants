// What drawing 13 faces costs per frame, plain and with the busiest expressions.
import { Face } from '../src/ragdoll/skin';
import { EXPRESSIONS, NEUTRAL, type Letters, type Word } from '../src/ragdoll/mood';
const faces = Array.from({ length: 13 }, (_, i) => new Face(0.2, undefined, i % 2 ? -1 : 1));
const as = (w: Word): Letters => ({ ...NEUTRAL, ...w } as Letters);
for (const [name, l] of [['plain', NEUTRAL], ['starstruck', as(EXPRESSIONS.starstruck)], ['nervous', as(EXPRESSIONS.nervous)], ['baffled', as(EXPRESSIONS.baffled)]] as const) {
  for (let k = 0; k < 200; k++) for (const f of faces) f.setExpression(1, l);
  const t0 = performance.now();
  for (let k = 0; k < 600; k++) for (const f of faces) f.setExpression(1, l, (k % 60) / 60);
  console.log(`${name.padEnd(11)} 13 faces: ${((performance.now() - t0) / 600).toFixed(3)} ms/frame`);
}
