/*
 * Reactions and gestures: short one-off moves played over the mood.
 *
 * Each is a little animation of LETTERS (the same alphabet as moods, see mood.ts), plus
 * a few EXTRAS for things the symmetric letters can't say: one fin waving, one leg
 * stomping, spinning round, bowing low, sinking down. Some also fire EVENTS (a hop, a
 * stomp's thump) at a moment in the move.
 *
 * Everything is a function of progress p (0..1) and seconds t, so the game can drive a
 * gesture by progress (BodyDrive.gestureProgress in the spec) as easily as by time.
 * Frames are written into a reused object, so playing one allocates nothing per step.
 */
import type { Letter, Word } from './mood';

/** Things only gestures do, all 0 at rest. Angles in radians. */
export interface Extras {
  yaw: number; // turn the whole body (a spin)
  finRaiseL: number; finRaiseR: number; // raise one fin (out and up)
  finFwdL: number; finFwdR: number; // swing one fin forward
  elbowL: number; elbowR: number; // bend one fin forward at the elbow
  legLiftL: number; legLiftR: number; // lift one leg (knee up)
  chestRoll: number; // roll the chest side to side
  bellyRoll: number; // roll the whole body side to side
  bow: number; // tip the whole body forward (the legs swing to keep the feet put)
  waist: number; // bend forward at the waist (the chest over the belly)
  headDown: number; // hang the head further forward
  eyesShut: number; // 0..1 lids down (a bow's closed eyes)
  dip: number; // sink the body down (units)
}

export type GestureEvent = 'hop' | 'littleHop' | 'smallHop' | 'thump' | 'recoil';

export interface Frame {
  letters: Word;
  extras: Extras;
}

export interface GestureDef {
  seconds: number;
  /** How long it takes to blend in and out, as shares of the whole. */
  blendIn: number;
  blendOut: number;
  events?: readonly { at: number; event: GestureEvent }[];
  /** Letters held for the whole move. */
  letters?: Word;
  /** Writes what changes over the move, at progress p (0..1), t seconds in. */
  frame?(p: number, t: number, out: Frame): void;
}

const TAU = Math.PI * 2;
const smooth = (p: number, a: number, b: number) => {
  const x = Math.max(0, Math.min(1, (p - a) / (b - a)));
  return x * x * (3 - 2 * x);
};
const bell = (p: number, c: number, w: number) => Math.exp(-(((p - c) / w) ** 2));
const osc = (t: number, hz: number, phase = 0) => Math.sin(TAU * hz * t + phase);
/** 0 → 1 → 0: rise over [a, b], hold, fall over [c, d]. */
const hold = (p: number, a: number, b: number, c: number, d: number) => smooth(p, a, b) * (1 - smooth(p, c, d));

export const GESTURES = {
  /** One fin up, waving. */
  wave: {
    seconds: 1.6, blendIn: 0.12, blendOut: 0.2,
    letters: { headTilt: 0.35, smile: 1, eyeOpen: 0.2, browShow: 0.3, browHeight: 0.5 },
    frame(_p, t, o) {
      // The whole fin, held straight, swings side to side from the shoulder.
      o.extras.finRaiseR = 1.55 + 0.28 * osc(t, 2.5);
      o.extras.finFwdR = 0.3;
      o.extras.elbowR = -0.4; // undoes the fin's resting curl
    },
  },
  /** A happy little jump. */
  hop: {
    seconds: 0.9, blendIn: 0.08, blendOut: 0.25, events: [{ at: 0, event: 'littleHop' }],
    letters: { smile: 1, mouthOpen: 0.4, eyeOpen: 0.3 },
    frame(p, _t, o) {
      o.extras.finRaiseL = o.extras.finRaiseR = 0.5 * bell(p, 0.4, 0.2);
    },
  },
  /** A full turn on the spot, fins flung out. */
  spin: {
    seconds: 1.1, blendIn: 0.08, blendOut: 0.15,
    letters: { finsSpread: 1, smile: 1, mouthOpen: 0.5, eyeOpen: -0.35, headPitch: 0.3 },
    frame(p, _t, o) {
      o.extras.yaw = TAU * smooth(p, 0.05, 0.9);
      o.extras.finRaiseL = o.extras.finRaiseR = 0.8;
    },
  },
  /** A full-body jiggle. */
  wiggle: {
    seconds: 1.2, blendIn: 0.1, blendOut: 0.2,
    letters: { smile: 1, mouthOpen: 0.3, eyeOpen: -0.4 },
    frame(_p, t, o) {
      const w = osc(t, 3.5);
      o.extras.chestRoll = 0.35 * w;
      o.extras.bellyRoll = -0.15 * w;
      o.extras.finRaiseL = 0.4 + 0.35 * w;
      o.extras.finRaiseR = 0.4 - 0.35 * w;
      o.letters.headTilt = 0.6 * osc(t, 3.5, Math.PI / 2);
    },
  },
  /** A low, polite bow. */
  bow: {
    seconds: 1.8, blendIn: 0.1, blendOut: 0.25,
    letters: { finsBack: -0.3, finsSpread: -0.6, elbowBend: 0.2, smile: 0.5 },
    frame(p, _t, o) {
      // Feet planted: the belly tips only a little (the legs swing to stay under it), and
      // the real bend is at the waist, head down, eyes closed.
      const b = hold(p, 0.05, 0.35, 0.65, 0.92);
      o.extras.bow = 0.3 * b;
      o.extras.waist = 0.75 * b;
      o.extras.headDown = 0.6 * b;
      o.letters.headPitch = -0.8 * b;
      o.extras.eyesShut = smooth(p, 0.15, 0.3) * (1 - smooth(p, 0.7, 0.85));
      o.letters.lean = 0;
    },
  },
  /** Everything droops: a big deflating slump. */
  slump: {
    seconds: 2.1, blendIn: 0.15, blendOut: 0.4,
    letters: {
      spine: -1, headPitch: -1, finsLift: -1, finsSpread: -0.3, tension: -0.8, energy: -1,
      eyeOpen: -0.5, smile: -0.3, mouthOpen: 0.2,
    },
    frame(_p, _t, o) {
      o.extras.dip = 0.03;
    },
  },
  /** Boom, boom, boom: left, right, left, each knee up then STOMP. */
  stomp: {
    seconds: 1.5, blendIn: 0.06, blendOut: 0.2,
    events: [{ at: 0.24, event: 'thump' }, { at: 0.49, event: 'thump' }, { at: 0.74, event: 'thump' }],
    letters: {
      browShow: 1, browAngle: 0.9, browHeight: -0.4, smile: -0.7, finsBack: 0.5, finsSpread: 0.5, spine: -0.2, lean: 0.15,
    },
    frame(p, _t, o) {
      // The legs are short stubs, so the knee has to come right up for it to read.
      // Each stomp: knee up over 0.14, a beat, then slammed down by the thump.
      const lift = (at: number) => 1.5 * smooth(p, at - 0.2, at - 0.07) * (1 - smooth(p, at - 0.035, at));
      o.extras.legLiftL = lift(0.24) + lift(0.74);
      o.extras.legLiftR = lift(0.49);
      o.extras.dip = 0.025 * (bell(p, 0.27, 0.04) + bell(p, 0.52, 0.04) + bell(p, 0.77, 0.04));
      o.extras.bellyRoll = 0.08 * (smooth(p, 0.04, 0.17) - 2 * smooth(p, 0.29, 0.42) + 2 * smooth(p, 0.54, 0.67) - smooth(p, 0.8, 0.95));
    },
  },
  /** Something's coming at its face: steps back, head jerks back, fins up in front, eyes squeezed shut. */
  flinch: {
    seconds: 0.9, blendIn: 0.05, blendOut: 0.45, events: [{ at: 0, event: 'recoil' }],
    letters: {
      spine: 0.5, headPitch: 0.9, lean: -1, finsSpread: -0.4, finsBack: -1, elbowBend: 0.3, finsLift: 0.6, tension: 0.6,
      eyeOpen: -1, smile: -0.6, browShow: 0.8, browAngle: -0.6,
    },
    frame(_p, _t, o) {
      o.extras.finFwdL = o.extras.finFwdR = 0.5;
      o.extras.headDown = -0.25;
    },
  },
  /** Jumps out of its skin. */
  startle: {
    seconds: 1.4, blendIn: 0.04, blendOut: 0.35, events: [{ at: 0, event: 'smallHop' }],
    letters: {
      spine: 0.7, headPitch: 0.4, lean: -0.3, finsSpread: 0.5, tremble: 0.3,
      eyeOpen: 1, mouthOpen: 0.6, browShow: 1, browHeight: 1, browAngle: -0.3, smile: -0.25, tongue: 0, gazeY: 0,
    },
    frame(p, _t, o) {
      // Hands thrown up, held up while it gets over it, then lowered.
      const up = hold(p, 0, 0.05, 0.6, 0.9);
      o.extras.finRaiseL = o.extras.finRaiseR = 1.5 * up;
      o.extras.elbowL = o.extras.elbowR = 0.3 * up;
    },
  },
  /** "YES!": winds up, springs up with both fins thrown up in a V, then two fist pumps. */
  celebrate: {
    seconds: 2.0, blendIn: 0.06, blendOut: 0.18, events: [{ at: 0.14, event: 'hop' }],
    letters: { smile: 1, eyeOpen: -0.6, energy: 1 },
    frame(p, _t, o) {
      // Wind-up: a crouch with the fins pulled down and back, head down.
      const windUp = hold(p, 0, 0.08, 0.1, 0.15);
      // The V: straight fins thrown up, held, then two pumps (down a little, back up).
      const v = hold(p, 0.12, 0.2, 0.8, 0.95);
      const pumps = bell(p, 0.55, 0.05) + bell(p, 0.7, 0.05);
      o.extras.finRaiseL = o.extras.finRaiseR = -0.15 * windUp + v * (1.75 - 0.7 * pumps); // (a small wind-up keeps the fins clear of the bending knees)
      o.extras.elbowL = o.extras.elbowR = -0.4 * v + 0.9 * pumps;
      o.extras.dip = 0.04 * windUp + 0.02 * pumps;
      o.letters.headPitch = -0.5 * windUp + 0.6 * v;
      o.letters.spine = -0.4 * windUp + 0.7 * v;
      o.letters.finsBack = 0.8 * windUp;
      o.letters.mouthOpen = 0.8 * v + 0.2 * pumps;
    },
  },
  /** "Dunno": fins out, elbows bent, head cocked, brows up. */
  shrug: {
    seconds: 1.1, blendIn: 0.2, blendOut: 0.3,
    letters: {
      finsSpread: 0.9, finsLift: 0.35, elbowBend: 0.9, finsBack: -0.3, headTilt: 0.5, spine: 0.1,
      browShow: 0.7, browHeight: 0.8, smile: 0, gazeY: 0.3,
    },
  },
  /** Breathes in... and lets it all out. */
  sigh: {
    seconds: 1.8, blendIn: 0.1, blendOut: 0.3,
    letters: { eyeOpen: -0.5, smile: 0 },
    frame(p, _t, o) {
      const inhale = bell(p, 0.22, 0.12), exhale = smooth(p, 0.35, 0.55);
      o.extras.dip = -0.012 * inhale + 0.025 * exhale;
      o.letters.spine = 0.4 * inhale - 0.7 * exhale;
      o.letters.headPitch = 0.3 * inhale - 0.5 * exhale;
      o.letters.finsLift = -0.6 * exhale;
      // The mouth opens for the breath in and stays open while it's let out.
      o.letters.mouthOpen = 0.35 * smooth(p, 0.04, 0.16);
    },
  },
  /** Yes, yes. */
  nod: {
    seconds: 0.9, blendIn: 0.1, blendOut: 0.2,
    letters: { smile: 0.9, eyeOpen: -0.2 },
    frame(p, _t, o) {
      // Two smooth dips: the head does the work, gently enough not to rock the body.
      o.letters.headPitch = -0.6 * (0.5 - 0.5 * Math.cos(2 * TAU * p));
    },
  },
  /** No, no. */
  shake: {
    seconds: 1.0, blendIn: 0.1, blendOut: 0.2,
    letters: { smile: -0.3, browShow: 0.5, browAngle: 0.3 },
    frame(p, _t, o) {
      o.letters.headTurn = 0.7 * Math.sin(3 * TAU * p);
    },
  },
} satisfies Record<string, GestureDef>;

export type GestureName = keyof typeof GESTURES;
export const GESTURE_NAMES = Object.keys(GESTURES) as GestureName[];

const EXTRA_KEYS: (keyof Extras)[] = [
  'yaw', 'finRaiseL', 'finRaiseR', 'finFwdL', 'finFwdR', 'elbowL', 'elbowR', 'legLiftL', 'legLiftR',
  'chestRoll', 'bellyRoll', 'bow', 'waist', 'headDown', 'eyesShut', 'dip',
];

export function emptyExtras(): Extras {
  return Object.fromEntries(EXTRA_KEYS.map((k) => [k, 0])) as unknown as Extras;
}

/**
 * Plays one gesture at a time. Starting another cuts over to it (each blends in, so it
 * stays smooth). `extras` is the current frame's extras already scaled by the blend.
 */
export class GesturePlayer {
  name: GestureName | null = null;
  private t = 0;
  private nextEvent = 0;
  private readonly frame: Frame = { letters: {}, extras: emptyExtras() };
  /** This step's extras, faded by the blend (all 0 when nothing's playing). */
  readonly extras: Extras = emptyExtras();
  /** This step's blend weight, 0..1. */
  weight = 0;

  play(name: GestureName): void {
    this.name = name;
    this.t = 0;
    this.nextEvent = 0;
  }

  stop(): void {
    this.name = null;
    this.weight = 0;
    for (const k of EXTRA_KEYS) this.extras[k] = 0;
  }

  /** Progress of the current gesture, 0..1 (0 when none). */
  get progress(): number {
    return this.name ? Math.min(1, this.t / GESTURES[this.name].seconds) : 0;
  }

  /**
   * Advances, lays the gesture's letters over `letters` (in place), fills `extras`,
   * and calls `fire` for any events it passed.
   */
  update(dt: number, letters: Record<Letter, number>, fire: (e: GestureEvent) => void): void {
    if (!this.name) return;
    const def: GestureDef = GESTURES[this.name];
    this.t += dt;
    const p = this.t / def.seconds;
    if (p >= 1) { this.stop(); return; }

    const events = def.events ?? [];
    while (this.nextEvent < events.length && events[this.nextEvent].at <= p) fire(events[this.nextEvent++].event);

    const f = this.frame;
    for (const k in f.letters) delete f.letters[k as Letter];
    for (const k of EXTRA_KEYS) f.extras[k] = 0;
    if (def.letters) for (const k in def.letters) f.letters[k as Letter] = def.letters[k as Letter];
    def.frame?.(p, this.t, f);

    const w = smooth(p, 0, def.blendIn) * (1 - smooth(p, 1 - def.blendOut, 1));
    this.weight = w;
    for (const k in f.letters) {
      const l = k as Letter;
      letters[l] += (f.letters[l]! - letters[l]) * w;
    }
    for (const k of EXTRA_KEYS) this.extras[k] = f.extras[k] * w;
    // A turn isn't faded: fading a finished 360° spin back to 0° would spin it backwards.
    // Wrapped to ±180°, a full turn simply ends where it started.
    this.extras.yaw = Math.atan2(Math.sin(f.extras.yaw), Math.cos(f.extras.yaw));
  }
}
