/*
 * Clothes: what a tenant wears, as plain data in its recipe, and how it's drawn.
 *
 * Most clothes are PAINTED onto the skin by its shader: shirt, pants, socks, shoes,
 * gloves and tattoos cost no extra meshes and fit every body, because the skin knows,
 * for every point, which part it's on (belly, leg, fin, butt), how far along a limb it
 * is, its height on the body and its angle round it (see blendskin.ts: clothA, clothB).
 * Each garment is then just a few numbers: where its edges are.
 *
 * The hat is a real mesh (hat.ts): it rides the goo head and can fall off.
 *
 * Every number is 0..1 and blends smoothly, so outfits can be tweened and sliders can
 * edit them live.
 */
import * as THREE from 'three';
import type { BodyDims } from './proportions';

export type HatStyle = 'beanie' | 'cap' | 'tophat';
export const HAT_STYLES: HatStyle[] = ['beanie', 'cap', 'tophat'];
export type ShirtPattern = 'plain' | 'stripes' | 'pinstripes' | 'dots' | 'gingham' | 'zigzag' | 'hearts' | 'stars';
export const SHIRT_PATTERNS: ShirtPattern[] = ['plain', 'stripes', 'pinstripes', 'dots', 'gingham', 'zigzag', 'hearts', 'stars'];
/** How big one repeat of each pattern is (world units). */
const PATTERN_CELL: Record<ShirtPattern, number> = {
  plain: 0.028, stripes: 0.028, pinstripes: 0.022, dots: 0.03, gingham: 0.03, zigzag: 0.03, hearts: 0.038, stars: 0.038,
};
export type TattooShape = 'heart' | 'star' | 'ring';
export const TATTOO_SHAPES: TattooShape[] = ['heart', 'star', 'ring'];
/** Where a tattoo goes. L/R are the tenant's own left and right. */
export type TattooSpot = 'belly' | 'back' | 'finL' | 'finR' | 'legL' | 'legR';
export const TATTOO_SPOTS: TattooSpot[] = ['belly', 'back', 'finL', 'finR', 'legL', 'legR'];

export interface Outfit {
  /** length: 0 a crop top … 1 down over the hips. sleeves: 0 none … 1 to the fin tips. patternColor: the pattern's second colour. */
  shirt: { color: string; length: number; sleeves: number; pattern: ShirtPattern; patternColor: string } | null;
  /** rise: 0 low on the hips … 1 high-waisted. legs: 0 briefs … 1 to the ankles. */
  pants: { color: string; rise: number; legs: number } | null;
  /** height: 0 ankle socks … 1 knee-high. */
  socks: { color: string; height: number } | null;
  /** height: 0 low shoes … 1 boots. */
  shoes: { color: string; height: number } | null;
  /** length: 0 just the tips … 1 long gloves. */
  gloves: { color: string; length: number } | null;
  hat: { style: HatStyle; color: string } | null;
  /** Up to two. size: 0 small … 1 big. */
  tattoos: { shape: TattooShape; spot: TattooSpot; color: string; size: number }[];
}

export const NO_OUTFIT: Outfit = { shirt: null, pants: null, socks: null, shoes: null, gloves: null, hat: null, tattoos: [] };
export const MAX_TATTOOS = 2;

// ---------------------------------------------------------------- reading recipes

const HEX = /^#[0-9a-f]{6}$/i;
const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback);
const col = (v: unknown, fallback: string) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : fallback);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const pick = <T extends string>(v: unknown, from: readonly T[], fallback: T): T => (from.includes(v as T) ? (v as T) : fallback);

/** Reads an outfit from anything, keeping only what it understands (missing = not worn). */
export function parseOutfit(data: unknown): Outfit {
  const d = obj(data);
  if (!d) return structuredClone(NO_OUTFIT);
  const s = obj(d.shirt), p = obj(d.pants), so = obj(d.socks), sh = obj(d.shoes), g = obj(d.gloves), h = obj(d.hat);
  return {
    shirt: s && {
      color: col(s.color, '#ffffff'), length: num(s.length, 0.6), sleeves: num(s.sleeves, 0.3),
      // Older recipes had stripes: colour ('' for plain).
      ...(typeof s.stripes === 'string' && HEX.test(s.stripes) && s.pattern === undefined
        ? { pattern: 'stripes' as const, patternColor: s.stripes.toLowerCase() }
        : { pattern: pick(s.pattern, SHIRT_PATTERNS, 'plain'), patternColor: col(s.patternColor, '#2b2d42') }),
    },
    pants: p && { color: col(p.color, '#3d5a80'), rise: num(p.rise, 0.4), legs: num(p.legs, 0.8) },
    socks: so && { color: col(so.color, '#ffffff'), height: num(so.height, 0.3) },
    shoes: sh && { color: col(sh.color, '#333333'), height: num(sh.height, 0.2) },
    gloves: g && { color: col(g.color, '#ffffff'), length: num(g.length, 0.3) },
    hat: h && { style: pick(h.style, HAT_STYLES, 'beanie'), color: col(h.color, '#e63946') },
    tattoos: (Array.isArray(d.tattoos) ? d.tattoos : []).slice(0, MAX_TATTOOS).map(obj).filter((t) => t !== null).map((t) => ({
      shape: pick(t.shape, TATTOO_SHAPES, 'heart'), spot: pick(t.spot, TATTOO_SPOTS, 'finL'),
      color: col(t.color, '#2b2d42'), size: num(t.size, 0.5),
    })),
  };
}

const CLOTH_COLORS = [
  '#ffffff', '#2b2d42', '#e63946', '#f1faee', '#a8dadc', '#457b9d', '#1d3557', '#ffb703', '#fb8500',
  '#8ecae6', '#219ebc', '#606c38', '#283618', '#fefae0', '#dda15e', '#bc6c25', '#cdb4db', '#ffafcc',
  '#bde0fe', '#9b5de5', '#f15bb5', '#00bbf9', '#00f5d4', '#3a3a3a', '#7f5539',
];

/** A random outfit: most wear a shirt and pants, some socks, shoes, a hat, now and then a tattoo. */
export function randomOutfit(rand: () => number = Math.random): Outfit {
  const r = rand;
  const c = () => CLOTH_COLORS[Math.floor(r() * CLOTH_COLORS.length)];
  const round = (v: number) => Math.round(v * 100) / 100;
  const between = (a: number, b: number) => round(a + (b - a) * r());
  const tattoos: Outfit['tattoos'] = [];
  if (r() < 0.25) {
    for (let i = 0, n = r() < 0.3 ? 2 : 1; i < n; i++) {
      tattoos.push({
        shape: TATTOO_SHAPES[Math.floor(r() * TATTOO_SHAPES.length)], spot: TATTOO_SPOTS[Math.floor(r() * TATTOO_SPOTS.length)],
        color: r() < 0.6 ? '#2b2d42' : c(), size: between(0.3, 0.8),
      });
    }
  }
  return {
    shirt: r() < 0.7 ? { color: c(), length: between(0.3, 0.9), sleeves: r() < 0.5 ? 0 : between(0.25, 1), pattern: r() < 0.4 ? SHIRT_PATTERNS[1 + Math.floor(r() * (SHIRT_PATTERNS.length - 1))] : 'plain', patternColor: c() } : null,
    pants: r() < 0.65 ? { color: c(), rise: between(0.1, 0.7), legs: r() < 0.3 ? 0 : between(0.3, 1) } : null,
    socks: r() < 0.3 ? { color: c(), height: between(0, 1) } : null,
    shoes: r() < 0.5 ? { color: c(), height: between(0, 0.6) } : null,
    gloves: r() < 0.1 ? { color: c(), length: between(0, 0.8) } : null,
    hat: r() < 0.35 ? { style: HAT_STYLES[Math.floor(r() * HAT_STYLES.length)], color: c() } : null,
    tattoos,
  };
}

// ---------------------------------------------------------------- painting the skin

const SPOT = { belly: [1, 0], back: [1, 0], finL: [3, 1], finR: [3, -1], legL: [2, 1], legR: [2, -1] } as const;

/**
 * Paints an outfit onto a tenant's skin material. The garments are uniforms, so a new
 * outfit (or a slider) changes them on the spot, with no rebuild.
 */
export class OutfitPainter {
  private readonly u = {
    uShirt: { value: new THREE.Vector4() }, // on, bottom y, sleeve t, pattern (index in SHIRT_PATTERNS; 0 plain)
    uPattern: { value: new THREE.Vector4() }, // repeats round the body, repeats round a fin, repeat size
    uShirtTop: { value: 0 },
    uShirtColor: { value: new THREE.Color() },
    uStripeColor: { value: new THREE.Color() },
    uPants: { value: new THREE.Vector4() }, // on, top y, leg t, 0
    uPantsColor: { value: new THREE.Color() },
    uSocks: { value: new THREE.Vector4() }, // on, from t
    uSocksColor: { value: new THREE.Color() },
    uShoes: { value: new THREE.Vector4() }, // on, from t
    uShoesColor: { value: new THREE.Color() },
    uGloves: { value: new THREE.Vector4() }, // on, from t
    uGlovesColor: { value: new THREE.Color() },
    // Tattoos: [region (0 none, 1 body, 2 leg, 3 fin), side, along, angle], [shape, size], colour.
    uTatA: { value: [new THREE.Vector4(), new THREE.Vector4()] },
    uTatB: { value: [new THREE.Vector4(), new THREE.Vector4()] },
    uTatC: { value: [new THREE.Color(), new THREE.Color()] },
    // The body's measurements, to turn angles and limb fractions into real distances.
    uSizes: { value: new THREE.Vector4() }, // body radius, leg radius, fin radius, 0
    uLengths: { value: new THREE.Vector4() }, // leg length, fin length
  };

  constructor(material: THREE.MeshStandardMaterial, private readonly dims: BodyDims) {
    const extent = (p: readonly (readonly [number, number])[]) => {
      let lo = Infinity, hi = -Infinity, r = 0;
      for (const [h, rr] of p) { lo = Math.min(lo, h); hi = Math.max(hi, h); r = Math.max(r, rr); }
      return { len: hi - lo, r };
    };
    const leg = extent(dims.skin.leg), fin = extent(dims.skin.arm);
    this.u.uSizes.value.set(dims.bellyR, leg.r, fin.r * 0.8, 0);
    this.u.uLengths.value.set(leg.len, fin.len, 0, 0);
    this.u.uShirtTop.value = dims.neckY - 0.012;
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.u);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${VERTEX_DECL}`)
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvClothA = clothA; vClothB = clothB; vRest = position;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${FRAGMENT_DECL}`)
        .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAGMENT_PAINT}`);
    };
    // All tenants share one compiled shader; only their uniforms differ.
    material.customProgramCacheKey = () => 'tenant-outfit-2';
  }

  /** Wear this outfit (live: the next frame shows it). */
  set(o: Outfit): void {
    const D = this.dims, U = this.u;
    const lerp = THREE.MathUtils.lerp;
    if (o.shirt) {
      // Bottom: from a crop top just under the chest to down over the hips.
      const bottom = lerp(D.spineY + 0.35 * (D.shoulderY - D.spineY), D.hipY - 0.03, o.shirt.length);
      U.uShirt.value.set(1, bottom, o.shirt.sleeves * 0.97, SHIRT_PATTERNS.indexOf(o.shirt.pattern));
      // A whole number of repeats round the body and the fins, so there's no seam at the back.
      const cell = PATTERN_CELL[o.shirt.pattern];
      const round = (r: number) => Math.max(3, Math.round((2 * Math.PI * r) / cell));
      U.uPattern.value.set(round(D.bellyR), round(U.uSizes.value.z), cell, 0);
      U.uShirtColor.value.set(o.shirt.color);
      U.uStripeColor.value.set(o.shirt.patternColor);
    } else U.uShirt.value.set(0, 0, 0, 0);
    if (o.pants) {
      U.uPants.value.set(1, lerp(D.hipY + 0.01, D.spineY + 0.01, o.pants.rise), o.pants.legs < 0.02 ? -1 : lerp(0.12, 0.9, o.pants.legs), 0);
      U.uPantsColor.value.set(o.pants.color);
    } else U.uPants.value.set(0, 0, 0, 0);
    if (o.socks) {
      U.uSocks.value.set(1, 1 - lerp(0.22, 0.62, o.socks.height), 0, 0);
      U.uSocksColor.value.set(o.socks.color);
    } else U.uSocks.value.set(0, 0, 0, 0);
    if (o.shoes) {
      U.uShoes.value.set(1, 1 - lerp(0.15, 0.42, o.shoes.height), 0, 0);
      U.uShoesColor.value.set(o.shoes.color);
    } else U.uShoes.value.set(0, 0, 0, 0);
    if (o.gloves) {
      U.uGloves.value.set(1, 1 - lerp(0.14, 0.6, o.gloves.length), 0, 0);
      U.uGlovesColor.value.set(o.gloves.color);
    } else U.uGloves.value.set(0, 0, 0, 0);
    for (let i = 0; i < MAX_TATTOOS; i++) {
      const t = o.tattoos[i];
      if (!t) { U.uTatA.value[i].set(0, 0, 0, 0); continue; }
      const [region, side] = SPOT[t.spot];
      // Where along it sits: the belly's middle (or back), a third of the way down a limb.
      const along = region === 1 ? lerp(D.hipY, D.spineY, 0.6) : region === 2 ? 0.45 : 0.4;
      U.uTatA.value[i].set(region, side, along, t.spot === 'back' ? Math.PI : 0);
      U.uTatB.value[i].set(TATTOO_SHAPES.indexOf(t.shape), lerp(0.016, 0.034, t.size) * (region === 1 ? 1.3 : 1), 0, 0);
      U.uTatC.value[i].set(t.color);
    }
  }
}

const VERTEX_DECL = /* glsl */ `
attribute vec4 clothA;
attribute vec4 clothB;
varying vec4 vClothA;
varying vec4 vClothB;
varying vec3 vRest;
`;

const FRAGMENT_DECL = /* glsl */ `
varying vec4 vClothA; // how much of this point is belly, leg, fin, butt
varying vec4 vClothB; // height on the body, fraction along a limb (0 root … 1 tip), angle round the body, angle round the limb
varying vec3 vRest;   // rest-pose position: its x says which side a limb is on
uniform vec4 uShirt; uniform vec4 uPattern; uniform float uShirtTop; uniform vec3 uShirtColor; uniform vec3 uStripeColor;
uniform vec4 uPants; uniform vec3 uPantsColor;
uniform vec4 uSocks; uniform vec3 uSocksColor;
uniform vec4 uShoes; uniform vec3 uShoesColor;
uniform vec4 uGloves; uniform vec3 uGlovesColor;
uniform vec4 uTatA[2]; uniform vec4 uTatB[2]; uniform vec3 uTatC[2];
uniform vec4 uSizes; uniform vec4 uLengths;

/** 0 below edge, 1 above it, with a soft antialiased step. */
float above(float x, float edge) { float aa = fwidth(x) * 0.75 + 1e-5; return smoothstep(edge - aa, edge + aa, x); }
/** Sharpens a region weight so garments end crisply where a limb meets the body. */
float part(float w) { return smoothstep(0.35, 0.65, w); }
float wrapAngle(float a) { return mod(a + PI, 2.0 * PI) - PI; }
float dot2(vec2 v) { return dot(v, v); }
float sdHeart(vec2 p) {
  p.y += 0.55; p.x = abs(p.x);
  if (p.y + p.x > 1.0) return sqrt(dot2(p - vec2(0.25, 0.75))) - sqrt(2.0) / 4.0;
  return sqrt(min(dot2(p - vec2(0.0, 1.0)), dot2(p - 0.5 * max(p.x + p.y, 0.0)))) * sign(p.x - p.y);
}
float sdStar(vec2 p) {
  const vec2 k1 = vec2(0.809016994375, -0.587785252292);
  const vec2 k2 = vec2(-k1.x, k1.y);
  p.x = abs(p.x);
  p -= 2.0 * max(dot(k1, p), 0.0) * k1;
  p -= 2.0 * max(dot(k2, p), 0.0) * k2;
  p.x = abs(p.x);
  p.y -= 0.85;
  vec2 ba = 0.45 * vec2(-k1.y, k1.x) - vec2(0.0, 1.0);
  float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, 0.85);
  return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
}
`;

const FRAGMENT_PAINT = /* glsl */ `
{
  float body = part(vClothA.x), leg = part(vClothA.y), fin = part(vClothA.z), butt = part(vClothA.w);
  float y = vClothB.x, t = vClothB.y;
  vec3 col = diffuseColor.rgb;
  float side = vRest.x >= 0.0 ? 1.0 : -1.0;

  // Tattoos, under any clothes.
  for (int i = 0; i < 2; i++) {
    vec4 A = uTatA[i];
    if (A.x < 0.5) continue;
    vec2 p; float w;
    if (A.x < 1.5) { // on the body: round it by angle, up it by height
      p = vec2(wrapAngle(atan(vRest.x, vRest.z) - A.w) * uSizes.x, y - A.z);
      w = body;
    } else { // on a limb: round it, and along it (up toward the root)
      float r = A.x < 2.5 ? uSizes.y : uSizes.z, len = A.x < 2.5 ? uLengths.x : uLengths.y;
      p = vec2(wrapAngle(vClothB.w * side - A.w) * r, (A.z - t) * len);
      w = (A.x < 2.5 ? leg : fin) * step(0.0, side * A.y);
    }
    p /= uTatB[i].y;
    float d = uTatB[i].x < 0.5 ? sdHeart(p) : uTatB[i].x < 1.5 ? sdStar(p) : abs(length(p) - 0.7) - 0.17;
    float aa = fwidth(d) * 0.75 + 1e-4;
    col = mix(col, uTatC[i], (1.0 - smoothstep(-aa, aa, d)) * w);
  }

  // Socks, then pants over them, the shirt over the pants' top, shoes and gloves last.
  if (uSocks.x > 0.5) col = mix(col, uSocksColor, leg * above(t, uSocks.y));
  if (uPants.x > 0.5) {
    // Covered weight summed over the parts before sharpening: sharpening each part on its
    // own left a half-covered ring where the butt blends into the body and legs.
    float m = part(vClothA.x * (1.0 - above(y, uPants.y)) + vClothA.w + vClothA.y * (1.0 - above(t, uPants.z)));
    // A darker hem at the leg openings.
    float hem = leg * above(t, uPants.z - 0.05) * 0.18;
    col = mix(col, uPantsColor * (1.0 - hem), m);
  }
  if (uShirt.x > 0.5) {
    float onBody = body * above(y, uShirt.y) * (1.0 - above(y, uShirtTop));
    float onFin = fin * (1.0 - above(t, uShirt.z));
    // As for pants: summed, then sharpened, so the shoulder seam has no gap.
    float m = part(vClothA.x * above(y, uShirt.y) * (1.0 - above(y, uShirtTop)) + vClothA.z * (1.0 - above(t, uShirt.z)));
    vec3 c = uShirtColor;
    if (uShirt.w > 0.5) {
      // Pattern coordinates in repeats: round (a whole number of them) and up.
      bool onF = onFin > onBody;
      // The body's angle comes from the rest position, per pixel: an angle passed from the
      // vertices would sweep the whole way round on the triangles across the back.
      float a = onF ? wrapAngle(vClothB.w * side) : atan(vRest.x, vRest.z), n = onF ? uPattern.y : uPattern.x;
      vec2 q = vec2(a / (2.0 * PI) * n, (onF ? -t * uLengths.y : y) / uPattern.z);
      // One pixel, in repeats (from the rest position, which has no jump anywhere).
      float aa = 0.75 * length(fwidth(vRest)) / uPattern.z + 1e-4;
      int P = int(uShirt.w + 0.5);
      // Rows of spots and motifs are staggered by half a repeat.
      vec2 f = fract(vec2(q.x + 0.5 * mod(floor(q.y), 2.0), q.y)) - 0.5;
      // d: distance to the pattern's edge in repeats (negative inside).
      float d;
      if (P == 1) d = abs(fract(q.y) - 0.5) - 0.25;                                   // stripes
      else if (P == 2) d = abs(fract(q.x) - 0.5) - 0.07;                               // pinstripes
      else if (P == 3) d = length(f) - 0.24;                                           // dots
      else if (P == 4) d = 0.0;                                                        // gingham (below)
      else if (P == 5) d = abs(fract(q.y + 1.2 * abs(fract(q.x) - 0.5)) - 0.5) - 0.2; // zigzag
      else if (P == 6) d = sdHeart(f / 0.42) * 0.42;                                   // hearts
      else d = sdStar(f / 0.42) * 0.42;                                                // stars
      float k = 1.0 - smoothstep(-aa, aa, d);
      if (P == 4) { // two crossing bands: half where one crosses, full where both do
        float bx = 1.0 - smoothstep(-aa, aa, abs(fract(q.x) - 0.5) - 0.25);
        float by = 1.0 - smoothstep(-aa, aa, abs(fract(q.y) - 0.5) - 0.25);
        k = 0.5 * (bx + by);
      }
      c = mix(c, uStripeColor, k);
    }
    float hem = max(body * (1.0 - above(y, uShirt.y + 0.006)), fin * above(t, uShirt.z - 0.04)) * 0.15;
    col = mix(col, c * (1.0 - hem), m);
  }
  if (uShoes.x > 0.5) {
    // A paler sole band right at the tip.
    vec3 c = mix(uShoesColor, vec3(0.92), above(t, 0.94) * 0.7);
    col = mix(col, c, leg * above(t, uShoes.y));
  }
  if (uGloves.x > 0.5) col = mix(col, uGlovesColor, fin * above(t, uGloves.y));
  diffuseColor.rgb = col;
}
`;
