/*
 * The body's actual dimensions, worked out from BODY/SKIN (the drawing) and the
 * PROPORTIONS multipliers. Everything that needs a size (physics bodies, joints, the
 * skin, the hover height) reads it from here, so changing a proportion moves every
 * dependent part together: longer legs lift the body, a taller body lifts the
 * shoulders and the head, and so on.
 */
import * as THREE from 'three';
import { BODY, PROPORTIONS, SKIN, TRAITS } from './config';
import { traitEffects } from './traits';

type Proportions = typeof PROPORTIONS;

type Traits = { age: number; weight: number; fitness: number };

/** Proportions with the traits (age, weight, fitness) applied on top. */
function effectiveProportions(P: Proportions, T: Traits): Proportions {
  const t = traitEffects(T).proportions;
  // Overall size scales every length and thickness (the face scales with the head).
  const s = t.size;
  return {
    ...P,
    headSize: P.headSize * t.headSize * s,
    headFloat: P.headFloat * s,
    bodyWidth: P.bodyWidth * t.bodyWidth * s,
    bodyHeight: P.bodyHeight * t.bodyHeight * s,
    legLength: P.legLength * t.legLength * s,
    legThickness: P.legThickness * t.legThickness * s,
    finLength: P.finLength * t.finLength * s,
    finWidth: P.finWidth * t.finWidth * s,
    shoulderWidth: P.shoulderWidth * t.shoulderWidth,
    hipWidth: P.hipWidth * t.hipWidth,
    eyeSize: P.eyeSize * t.eyeSize,
    butt: P.butt * t.butt,
    waist: Math.max(0, P.waist * t.waistKeep + t.waistAdd),
    eyeHeight: P.eyeHeight + t.eyeHeightAdd,
  };
}

type Profile = readonly (readonly [number, number])[];

export interface FaceShape {
  eyeSize: number;
  eyeSpacing: number;
  eyeHeight: number;
  lashes: number;
  blush: number;
  mouthWidth: number;
}

/** A smooth bump centred at `c` with half-width about `w` (both 0..1 up the body). */
const bump = (u: number, c: number, w: number) => Math.exp(-(((u - c) / w) ** 2));

/**
 * The body's outline with the silhouette dials applied: shoulders broaden the upper
 * third, hips the lower third, the waist pinches between. The drawn profile is resampled
 * densely first so the bumps land smoothly wherever they fall, and the ends stay closed.
 */
function shapeBody(P: Proportions, bh: number, bw: number, bellyBottom: number, bellyBottom0: number): Profile {
  const curve = new THREE.SplineCurve(SKIN.body.map(([h, r]) => new THREE.Vector2(h, r)));
  const h0 = SKIN.body[0][0], h1 = SKIN.body[SKIN.body.length - 1][0];
  const n = 28;
  const out: [number, number][] = [];
  const p = new THREE.Vector2();
  for (let i = 0; i <= n; i++) {
    curve.getPoint(i / n, p);
    const u = (p.x - h0) / (h1 - h0);
    const ends = Math.sqrt(Math.max(0, Math.sin(Math.PI * u))); // fades the dials to 0 at the poles
    let r = Math.max(0, p.y);
    r += (P.hipWidth - 1) * BODY.bellyR * 0.6 * bump(u, 0.3, 0.2) * ends;
    r += (P.shoulderWidth - 1) * BODY.bellyR * 0.75 * bump(u, 0.78, 0.13) * ends;
    r *= 1 - P.waist * bump(u, 0.55, 0.13);
    if (i === 0 || i === n) r = 0;
    out.push([bellyBottom + (p.x - bellyBottom0) * bh, Math.max(0, r) * bw]);
  }
  return out;
}

export interface BodyDims {
  hipY: number; hipX: number;
  thighLen: number; thighR: number; shinLen: number; shinR: number;
  bellyY: number; bellyR: number; bellyLen: number;
  spineY: number; chestR: number; chestLen: number;
  neckY: number; headY: number; headR: number; headColliderR: number;
  /** Uniform scale of the head (for the face, and to keep a big head light). */
  headScale: number;
  /** Fin width multiplier (to keep wide fins light). */
  finWidthScale: number;
  shoulderX: number; shoulderY: number;
  upperArmLen: number; upperArmR: number; forearmLen: number; forearmR: number;
  /** Belly centre height when standing, for the hover. */
  hoverHeight: number;
  /** How far down the hover ray reaches from the belly centre. */
  rayLength: number;
  /** Total height, leg tips to top of head. */
  height: number;
  skin: { body: Profile; leg: Profile; arm: Profile };
  /** The butt: two cheek balls at (±x, y, z) of radius r, in the rest pose (r 0 = none). */
  cheeks: { x: number; y: number; z: number; r: number };
  /** Face features, in the drawn head's units (the face is scaled with the head). */
  face: FaceShape;
  /** Identifies this set of dimensions (for sharing skin geometry). */
  key: string;
}

/**
 * Dimensions for a look: by default the shared PROPORTIONS and TRAITS (what the sandbox
 * sliders edit); pass a recipe's to build a particular tenant.
 */
export function bodyDims(base: Proportions = PROPORTIONS, traits: Traits = TRAITS): BodyDims {
  const P = effectiveProportions(base, traits);
  const B = BODY;
  const ll = P.legLength, bh = P.bodyHeight, bw = P.bodyWidth, hs = P.headSize;
  const lt = P.legThickness, fl = P.finLength, fw = P.finWidth;

  // Vertical stack, from the leg tips up. Offsets are the drawing's, scaled.
  const bellyBottom0 = B.bellyY - B.bellyLen / 2;
  const hipY = B.hipY * ll;
  const bellyBottom = hipY - (B.hipY - bellyBottom0) * bh; // hips sit a little way up inside the belly
  const bellyLen = B.bellyLen * bh;
  const bellyY = bellyBottom + bellyLen / 2;
  const spineY = bellyBottom + (B.spineY - bellyBottom0) * bh;
  const neckY = spineY + (B.neckY - B.spineY) * bh;
  const shoulderY = spineY + (B.shoulderY - B.spineY) * bh;
  const headR = B.headR * hs;
  const headY = neckY + (B.headY - B.headR - B.neckY) * P.headFloat + headR;

  const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
  const bellyR = B.bellyR * bw * (1 + 0.5 * (P.hipWidth - 1));
  const dims: Omit<BodyDims, 'key'> = {
    // Wider hips set the legs further apart; wider shoulders the fins.
    hipY, hipX: (B.hipX + (P.hipWidth - 1) * 0.03) * bw,
    thighLen: B.thighLen * ll, thighR: B.thighR * lt,
    shinLen: B.shinLen * ll, shinR: B.shinR * lt,
    bellyY, bellyR, bellyLen,
    spineY, chestR: B.chestR * bw * (1 + 0.5 * (P.shoulderWidth - 1)), chestLen: B.chestLen * bh,
    neckY, headY, headR, headColliderR: B.headColliderR * hs, headScale: hs,
    shoulderX: (B.shoulderX + (P.shoulderWidth - 1) * 0.04) * bw, shoulderY,
    upperArmLen: B.upperArmLen * fl, upperArmR: B.upperArmR * fw,
    forearmLen: B.forearmLen * fl, forearmR: B.forearmR * fw, finWidthScale: fw,
    hoverHeight: bellyY + 0.004,
    rayLength: bellyY + 0.25,
    height: headY + headR,
    skin: {
      // Body profile heights follow the belly/chest stack; radii the body width and silhouette.
      body: shapeBody(P, bh, bw, bellyBottom, bellyBottom0),
      leg: SKIN.leg.map(([h, r]) => [h * ll, r * lt] as const),
      arm: SKIN.arm.map(([h, r]) => [h * fl, r * fw] as const),
    },
    // Bigger butts are bigger balls set further back: they bulge out round and full.
    cheeks: P.butt > 0.01 ? {
      x: (0.36 + 0.08 * P.butt) * bellyR, y: hipY + 0.12 * bellyR,
      z: -(0.42 + 0.22 * P.butt) * bellyR, r: (0.38 + 0.28 * P.butt) * bellyR,
    } : { x: 0, y: 0, z: 0, r: 0 },
    face: {
      eyeSize: P.eyeSize, eyeSpacing: P.eyeSpacing, eyeHeight: P.eyeHeight,
      lashes: P.lashes, blush: P.blush, mouthWidth: P.mouthWidth,
    },
  };
  // Identifies the shape: the tuned proportions plus the traits.
  const key = [...Object.values(base), traits.age, traits.weight, traits.fitness].map(r4).join(',');
  return { ...dims, key };
}
