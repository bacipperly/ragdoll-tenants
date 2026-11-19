/**
 * Every tunable number for the active ragdoll lives here, so tuning never means
 * hunting through the controller code.
 *
 * World conventions (from the Tiny Tenants brief): 1 unit = 1 grid square,
 * y up, +x east, +z north. The body faces +z at yaw 0. About 0.9 units tall.
 *
 * Proportions follow the character drawing (source/IMG_5251.heic): a big round
 * head floating just above a small teardrop body that forks into two short pointed
 * legs, with long tapered fin arms from right by the neck.
 */

/**
 * The physics skeleton, in the rest pose (standing, arms hanging straight down;
 * the motors splay the arms out). Heights are above the leg tips. These are the
 * "bones" the skin is draped over; the skin's own shape is in SKIN below.
 */
export const BODY = {
  // Belly: the round lower body, and the root the hover and balance act on.
  bellyY: 0.2,
  bellyR: 0.085,
  bellyLen: 0.18, // 0.11 .. 0.29

  // Chest: the narrow upper body, on a springy "spine" so the body can bend.
  spineY: 0.29,
  chestR: 0.055,
  chestLen: 0.17, // 0.29 .. 0.46

  // Head: a big sphere floating just above the body (the drawing has no neck).
  neckY: 0.47,
  headY: 0.69,
  headR: 0.2,
  headColliderR: 0.19,

  // Legs: short stubs that fork out of the bottom of the body and end in points.
  hipX: 0.045,
  hipY: 0.17,
  thighLen: 0.085,
  thighR: 0.04,
  shinLen: 0.085,
  shinR: 0.03,

  // Arms: long fins from right by the neck, in two segments so they can noodle.
  shoulderX: 0.05,
  shoulderY: 0.44,
  upperArmLen: 0.16,
  upperArmR: 0.035,
  forearmLen: 0.16,
  forearmR: 0.028,

  density: 1000,
  /** The belly is the heavy anchor (like a pelvis) that balance acts on; the rest hangs off it. */
  bellyDensity: 3000,
  /** The head is mostly "air": a light head keeps it bobbly instead of top-heavy. */
  headDensity: 60,
  limbFriction: 0.15,
} as const;

/**
 * Proportion multipliers over BODY and SKIN (1 = as drawn). The layout is worked out
 * from these in proportions.ts, stacking legs, belly, chest, shoulders and head so the
 * parts always stay connected. Changing them needs the ragdoll rebuilt (the sandbox
 * does this automatically); they don't change a ragdoll that already exists.
 */
export const PROPORTIONS = {
  headSize: 1,
  headFloat: 1, // the gap between the body and the floating head
  bodyWidth: 1,
  bodyHeight: 1,
  legLength: 1,
  legThickness: 1,
  finLength: 1,
  finWidth: 1,
  // Silhouette: neutral dials that combine into broader or curvier builds.
  shoulderWidth: 1, // broadens the upper body and sets the fins further apart
  hipWidth: 1, // widens the lower body and sets the legs further apart
  waist: 0, // 0 = the drawn teardrop; higher pinches in the middle
  butt: 0.8, // 0 = smooth back; higher = two round, bouncy cheeks low on the back
  // Face (scaled with the head).
  eyeSize: 1,
  eyeSpacing: 1,
  eyeHeight: 0, // moves the eyes up (+) or down (−), in head radii
  lashes: 0, // 0 = none; up to 1 = long lashes flicking out from each eye
  blush: 0, // 0 = none; up to 1 = rosy cheeks
  mouthWidth: 1,
}; // not `as const`: the sandbox tuning panel edits these live

/**
 * Traits: age, weight and fitness. Each drives many other settings at once; see
 * traits.ts. Like PROPORTIONS they're fixed when a ragdoll is built.
 */
export const TRAITS = {
  age: 0.5, // 0 baby · 0.25 kid · 0.5 adult · 1 senior
  weight: 0, // −1 slim ↔ +1 heavy
  fitness: 0, // −1 out of shape ↔ +1 athletic
}; // not `as const`: the sandbox tuning panel edits these live

/**
 * The skin's shape: radius profiles for each part, drawn over the bones above.
 * `[height, radius]` pairs from bottom to top; the mesh is a smooth surface through
 * them, closing to a point where the radius is 0. Leg heights are above the leg tip;
 * arm heights are relative to the shoulder (negative = below it).
 */
export const SKIN = {
  /** Teardrop body: round belly, narrowing to a point at the neck. */
  body: [
    [0.095, 0], [0.105, 0.05], [0.13, 0.075], [0.18, 0.089], [0.24, 0.088],
    [0.3, 0.076], [0.36, 0.058], [0.42, 0.038], [0.46, 0.02], [0.478, 0],
  ],
  /** Legs: taper to a sharp point at the floor, and start hidden inside the belly. */
  leg: [
    [0, 0], [0.03, 0.022], [0.08, 0.036], [0.13, 0.044], [0.19, 0.04], [0.21, 0],
  ],
  /** Fins: thin at the shoulder, widest a third of the way down, then a long taper to a point. */
  arm: [
    [-0.33, 0], [-0.28, 0.014], [-0.18, 0.034], [-0.1, 0.042], [-0.03, 0.03], [0.015, 0.016], [0.025, 0],
  ],
  /** Fins are flat: this squashes their cross-section front-to-back. */
  armThickness: 0.5,
  /** Fins are blended into the body swung out this far (rad), roughly how they're held. */
  finSplay: 0.9,
  radialSegments: 14,
  /** Smoothing samples per profile segment. */
  samplesPerSegment: 4,
} as const satisfies Record<string, unknown>;

/** The butt's jiggle: a spring the cheeks ride on, chasing the belly. */
export const BUTT = {
  frequency: 4, // Hz: lower is a slower, heavier wobble
  dampingRatio: 0.14, // lower = bouncier, keeps wobbling longer
  travel: 0.45, // the furthest the cheeks swing from rest, in cheek radii
  walkBounce: 0.3, // how hard each footstep bounces and sways them while walking, in cheek radii
};

/**
 * Joint "muscles". Each is a spring-damper toward the pose target, given as:
 *   frequency     rad/s: how quickly the joint snaps to its target (higher = snappier)
 *   dampingRatio  1 = settles with no overshoot, lower = springier and wobblier
 * Stiffness and damping are worked out per joint from the inertia of the whole limb
 * below it, so the same numbers mean the same feel everywhere.
 *
 * The noodle comes from here: a soft, underdamped spine and a bobbly neck. The fins
 * swing and lag at a soft shoulder, but the elbow is firm and fully damped so the
 * lower fin follows through instead of whipping about (at elbow 9 / 0.22 it strayed
 * ~46° from its pose on average). Legs stay firmer so the walk still reads.
 */
export const MUSCLES = {
  spine: { frequency: 16, dampingRatio: 0.35 },
  neck: { frequency: 20, dampingRatio: 0.4 },
  hip: { frequency: 26, dampingRatio: 0.7 },
  knee: { frequency: 26, dampingRatio: 0.8 },
  shoulder: { frequency: 16, dampingRatio: 0.6 },
  elbow: { frequency: 30, dampingRatio: 1.0 },
  /** Damping ratio left on every joint while knocked out, like joint friction, so a limp body flops and settles. */
  limpDamping: 0.03,
}; // not `as const`: the sandbox tuning panel edits these live

/**
 * Gravity compensation while active: the share of each part's weight that is lifted off
 * it (and carried by the belly instead), so muscles move parts rather than hold them up.
 * Fins mostly, leaving a little weight so they still hang and sway.
 */
export const GRAVITY_COMP: Partial<Record<string, number>> = {
  chest: 1, head: 1,
  thighL: 1, thighR: 1, shinL: 1, shinR: 1,
  upperArmL: 0.85, upperArmR: 0.85, forearmL: 0.85, forearmR: 0.85,
};

/** Knee and fin-elbow limits, in radians of bend (0 = straight). */
export const LIMITS = {
  kneeBend: [0, 2.0] as const,
  /** Fin elbows hinge forward, like a flipper; a little give backward. */
  finBend: [-0.25, 1.8] as const,
};

/** Hover: a downward raycast from the belly feeds a PID that holds it at standing height. */
export const HOVER = {
  // Standing height and ray length depend on the proportions: see proportions.ts.
  // Gains are accelerations (scaled by total mass), so they don't depend on density.
  kp: 140,
  ki: 30,
  kd: 18,
  integralLimit: 0.15,
  /** Upward-only, capped force (in g's), so it can't yank the body down or launch it. */
  maxAccel: 3 * 9.81,
} as const;

/** Upright: a PD torque on the belly toward "standing, facing the move direction, leaning a little". */
export const UPRIGHT = {
  kp: 600,
  kd: 34,
  /**
   * Belly inertia alone undersells the chest, head and fins on top; this fattens it.
   * Keep kd · inertiaBoost · timestep around 1 or below (here 34 · 3 / 90 ≈ 1.13, at the 90 Hz step), or the
   * explicit torque overshoots each step and blows up.
   */
  inertiaBoost: 3,
  turnRate: 11, // rad/s the facing target can slew at
  leanPerSpeed: 0.05, // rad of forward lean per unit/s
  leanPerAccelError: 0.07, // rad of lean per unit/s of (wanted − actual) speed: leans into starts, back on stops
  maxLean: 0.4,
} as const;

/** WASD movement: a force that steers the belly's horizontal velocity toward the wanted one. */
export const MOVE = {
  walkSpeed: 2.5, // squares per second, as in the game
  strollSpeed: 1.5,
  response: 7, // 1/s: how hard it chases the wanted velocity
  maxAccel: 14,
} as const;

/** Procedural walk cycle. The legs are short stubs, so it's a quick waddle. */
export const GAIT = {
  /** Steps per second (full cycles × 2) grow with speed, then cap so legs don't blur at this scale. */
  baseCycleHz: 1.6,
  cycleHzPerSpeed: 1.0,
  maxCycleHz: 3.6,
  hipSwing: 0.7, // rad, at full walk speed
  kneeLift: 1.1, // rad of extra knee bend while a leg swings forward
  kneeBase: 0.08,
  armSwing: 0.5, // rad of fin swing at the shoulder
  armOut: 0.5, // rad the fins splay out from the body, as in the drawing
  finCurl: 0.2, // rad the lower fin bends forward at rest, so the fin reads as one soft curve
  finFollow: 0.4, // rad of extra forward bend as the fin swings forward (follow-through)
  bob: 0.025, // units of hover bob per step: dips as the legs split, rises as they pass
  stepRoll: 0.09, // rad the belly rocks side to side onto each stance leg (a waddle)
  stepTwist: 0.12, // rad the belly twists against the stride
  chestCounterRoll: 0.8, // share of the belly's rock the chest swings back against: the noodly wiggle
  /** Below this speed (units/s) the gait fades out to idle. */
  fadeSpeed: 0.35,
}; // not `as const`: the sandbox tuning panel edits these live

/** Knockout + recovery. */
export const KNOCKOUT = {
  recoverSeconds: 1.4, // muscles ramp back over this long, so getting up is wobbly
} as const;

/**
 * Clumsiness: physics with consequences. At a ledge it teeters, windmilling, and then
 * either catches itself or slips off; a hard landing sometimes trips it over. Each
 * chance is per occasion, and × `amount` × the tenant's own clumsiness (from its traits:
 * babies, seniors, the heavy and the out of shape are clumsier, the athletic less so).
 */
export const CLUMSY = {
  amount: 1, // × every chance: 0 = never clumsy, 2 = twice as often
  teeterSeconds: 0.55, // how long it wobbles at an edge before it slips or catches itself
  teeterLean: 0.4, // rad it tips toward the drop while teetering
  edgeSlip: 0.35, // chance a teeter ends in a slip (more when moving toward the drop)
  edgeCooldown: 1.8, // s after catching itself before it can teeter again
  dropSafe: 0.55, // a fall from this high (units) never stumbles; a jump on the flat rises ~0.48
  dropSure: 1.6, // a fall from this high stumbles nearly always (× clumsiness)
  landTrip: 0.6, // share of stumbles that trip it right over (the rest just stagger)
  tumbleSeconds: 1.1, // s it lies there after a slip or trip before getting up
};

/** Moods: how it reacts to being shoved. */
export const EMOTION = {
  /** A shove startles it: wide eyes and an "o" mouth for this long. */
  surpriseSeconds: 0.9,
  /** Each shove adds 1 to an annoyance meter; reaching this many makes it angry. */
  shovesToAnger: 3,
  /**
   * The meter only starts draining this long after the last shove, so any run of shoves
   * each within this many seconds of the previous one counts toward getting angry.
   */
  annoyanceGraceSeconds: 3,
  /** After the grace period, the meter drains this much per second. */
  annoyanceDrainPerSecond: 0.5,
  /** How long it stays angry. Each shove while angry starts this over. */
  angrySeconds: 6,
  /** Angry, it flushes toward this colour by this much, so it reads at game distance. */
  flushColor: '#ff2a1f',
  flushAmount: 0.7,
  // The angry body language (hunch, puffed fins, trembling) is the "angry" reaction word in mood.ts.
}; // not `as const`: the sandbox tuning panel edits these live

/** Jumping: a quick crouch, a launch, a tucked, flailing hang in the air, and a squashy landing. */
export const JUMP = {
  /** Upward speed at take-off, units/s. 3.2 clears about half a unit. */
  velocity: 3.2,
  crouchSeconds: 0.09,
  crouchDepth: 0.05, // how far it dips before take-off
  landSquash: 0.06, // how far it dips on a hard landing
  /** Share of normal steering it keeps in the air. */
  airControl: 0.35,
  tuck: 0.9, // extra knee bend in the air, rad
  kneesUp: 0.35, // hips swing the legs forward in the air, rad
  finsUp: 0.7, // fins fling up and out in the air, rad
}; // not `as const`: the sandbox tuning panel edits these live

/**
 * The head is a ball of thick, non-Newtonian glop (visual only; see goo.ts). It sags a
 * little, lags and sloshes when the body lurches, and flattens and spreads against
 * whatever it lands on, then oozes slowly back into shape. Its viscosity is
 * shear-thickening: the faster it's pushed, the stiffer it gets, so a sudden knock
 * barely dents it at first and then it slowly gives.
 */
export const GOO = {
  firmness: 45, // how strongly it pulls back into a ball (lower = floppier glop)
  viscosity: 5, // baseline thickness: higher oozes slower
  thickening: 30, // extra thickness per unit/s of speed: the non-Newtonian part
  sag: 0.02, // how much gravity drags it down (share of g)
  slosh: 0.05, // how much it lags and sloshes when the head speeds up or slows down
  // Out cold, the head loses its tone and puddles: it keeps only (1 − limpLoss) of its
  // firmness, and sags (1 + limpSag)× as much. It firms back up as the muscles return.
  limpLoss: 0.75,
  limpSag: 3,
  surfaceTension: 25, // how strongly neighbouring goo moves together (smooth lumps, not noise)
  keepVolume: 0.6, // squash one side and the rest bulges out
  friction: 0.35, // how much it grips a surface it's pressed against
  maxStretch: 0.45, // never deforms further than this share of its radius
}; // not `as const`: the sandbox tuning panel edits these live
