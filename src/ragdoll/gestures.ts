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
  bow: number; // tip the whole body forward
  dip: number; // sink the body down (units)
}

export type GestureEvent = 'hop' | 'smallHop' | 'thump';

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
      o.extras.finRaiseR = 1.5 + 0.3 * osc(t, 2.5);
      o.extras.finFwdR = 0.3;
      o.extras.elbowR = 0.5 + 0.4 * osc(t, 2.5, 1.2);
    },
  },
  /** A happy little jump. */
  hop: {
    seconds: 1.0, blendIn: 0.08, blendOut: 0.25, events: [{ at: 0, event: 'hop' }],
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
    seconds: 1.5, blendIn: 0.1, blendOut: 0.25,
    letters: { spine: -0.8, headPitch: -0.6, finsBack: -0.5, elbowBend: 0.5, eyeOpen: -0.7, smile: 0.6 },
    frame(p, _t, o) {
      o.extras.bow = 0.55 * hold(p, 0.05, 0.35, 0.65, 0.95);
    },
  },
  /** Everything droops: a big deflating slump. */
  slump: {
    seconds: 1.6, blendIn: 0.15, blendOut: 0.4,
    letters: {
      spine: -1, headPitch: -1, finsLift: -1, finsSpread: -0.3, tension: -0.8, energy: -1,
      eyeOpen: -0.5, smile: -0.3, mouthOpen: 0.2,
    },
    frame(_p, _t, o) {
      o.extras.dip = 0.03;
    },
  },
  /** Knee up, then STOMP. */
  stomp: {
    seconds: 1.0, blendIn: 0.08, blendOut: 0.3, events: [{ at: 0.46, event: 'thump' }],
    letters: {
      browShow: 1, browAngle: 0.9, browHeight: -0.4, smile: -0.7, finsBack: 0.5, finsSpread: 0.5, spine: -0.2, lean: 0.15,
    },
    frame(p, _t, o) {
      // The legs are short stubs, so the knee has to come right up for it to read.
      o.extras.legLiftR = 1.6 * smooth(p, 0, 0.35) * (1 - smooth(p, 0.4, 0.46));
      o.extras.dip = 0.03 * bell(p, 0.55, 0.08);
    },
  },
  /** Recoils from something: hunched, fins up in front of the face, eyes squeezed shut. */
  flinch: {
    seconds: 0.7, blendIn: 0.06, blendOut: 0.5,
    letters: {
      spine: -0.7, headPitch: -0.6, lean: -0.35, finsSpread: -1, finsBack: -0.9, elbowBend: 1, finsLift: 0.3, tension: 0.6,
      eyeOpen: -1, smile: -0.6, browShow: 0.8, browAngle: -0.6,
    },
    frame(_p, _t, o) {
      o.extras.dip = 0.02;
    },
  },
  /** Jumps out of its skin. */
  startle: {
    seconds: 0.9, blendIn: 0.04, blendOut: 0.5, events: [{ at: 0, event: 'smallHop' }],
    letters: {
      spine: 0.7, finsLift: 1, finsSpread: 1, tremble: 0.3,
      eyeOpen: 1, mouthOpen: 1, browShow: 1, browHeight: 1, browAngle: -0.3, smile: 0,
    },
  },
  /** Jumps for joy, pumping both fins. */
  celebrate: {
    seconds: 1.6, blendIn: 0.08, blendOut: 0.2, events: [{ at: 0.05, event: 'hop' }],
    letters: { smile: 1, mouthOpen: 0.7, eyeOpen: -0.45, headPitch: 0.4, spine: 0.6, energy: 1 },
    frame(_p, t, o) {
      o.extras.finRaiseL = o.extras.finRaiseR = 1.6 + 0.35 * osc(t, 3);
      o.extras.elbowL = o.extras.elbowR = 0.3;
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
      o.letters.mouthOpen = 0.35 * exhale;
    },
  },
  /** Yes, yes. */
  nod: {
    seconds: 0.9, blendIn: 0.1, blendOut: 0.2,
    letters: { smile: 0.9, eyeOpen: -0.2 },
    frame(p, _t, o) {
      o.letters.headPitch = -0.7 * Math.max(0, Math.sin(2 * TAU * p));
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
  'chestRoll', 'bellyRoll', 'bow', 'dip',
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
