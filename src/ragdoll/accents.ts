/*
 * Expressive accents (source/expressive-accents-spec.md): little floating symbols —
 * hearts, sparkles, Zs, a "?", music notes… — that make a tenant's feelings visible in
 * the air round its head for a moment, then fade.
 *
 * Every accent goes through the spec's four phases:
 *   trigger   something about the tenant calls for it (see wanted()): its expression, a
 *             reaction, a mood, a gesture starting, an activity, a knockout, running;
 *   enter     it pops in from ~15% size with a soft elastic overshoot (105–115%),
 *             several in a row when there are a few;
 *   active    it does its own thing: hearts float up swaying, anger marks jitter, the
 *             "?" tilts, the dots of an ellipsis pulse left to right…;
 *   exit      it fades, drifting up and shrinking a little, when its time is up or the
 *             feeling that brought it on has passed.
 *
 * A tenant shows one main kind at a time (its strongest reason wins), with one to three
 * symbols. Symbols face the camera, sit up beside the head on that tenant's side, and
 * follow it with a slight floating lag. Speed lines while running are separate.
 *
 * One Accents per scene drives everyone. It keeps a fixed pool of meshes and allocates
 * nothing per frame.
 */
import * as THREE from 'three';
import { accentShape, type ShapeName } from './accentShapes';
import type { ExpressionName, MoodName, ReactionName } from './mood';
import type { GestureName } from './gestures';

export const ACCENT_KINDS = [
  'heart', 'sparkle', 'blush', 'anger', 'puff', 'scribble', 'zzz', 'note', 'book', 'controller', 'sprout',
  'rays', 'question', 'bulb', 'focus', 'speed', 'ellipsis', 'sweat',
] as const;
export type AccentKind = (typeof ACCENT_KINDS)[number];

/** Things a tenant can be busy doing, each shown by its own accent. */
export const ACTIVITIES = ['music', 'reading', 'gaming', 'gardening'] as const;
export type Activity = (typeof ACTIVITIES)[number];

/** What the accents need to know about a tenant (ActiveRagdoll provides it). */
export interface AccentSubject {
  readonly expression: ExpressionName | null;
  readonly mood: MoodName;
  readonly reaction: ReactionName | null;
  readonly gesture: GestureName | null;
  readonly isKnockedOut: boolean;
  readonly activity: Activity | null;
  /** Ground speed while running (not strolling), else 0. */
  readonly runSpeed: number;
  /** The head's radius, in world units. */
  readonly headRadius: number;
  headCenter(out: THREE.Vector3): THREE.Vector3;
  bodyCenter(out: THREE.Vector3): THREE.Vector3;
  velocity(out: THREE.Vector3): THREE.Vector3;
  /** A point on the face, in the drawn face's units (head radius 0.2), in the world. */
  facePoint(x: number, y: number, out: THREE.Vector3): THREE.Vector3;
  faceQuaternion(out: THREE.Quaternion): THREE.Quaternion;
}

type Place = 'side' | 'top' | 'topSide' | 'around' | 'cheek' | 'mouth' | 'temple' | 'rays' | 'focus' | 'ellipsis' | 'behind';
type Motion = 'float' | 'twinkle' | 'static' | 'jitter' | 'puff' | 'wobble' | 'zig' | 'bounce' | 'hover' | 'grow' | 'burst' | 'tilt' | 'glow' | 'streak' | 'dots' | 'slide';

interface Style {
  shape: ShapeName;
  /** Across, as a share of the head's diameter (the spec: 10–25%). */
  size: number;
  place: Place;
  motion: Motion;
  /** Symbols per burst, and the delay between them. */
  count: number;
  stagger: number;
  /** Seconds each lives (Infinity: until the feeling passes). */
  life: number;
  /** While wanted, a new burst this often (0: just the one burst). */
  every: number;
  enter: number;
  exit: number;
  /** How far the entrance overshoots (1.7 ≈ 110%; more for a sudden surprise). */
  overshoot: number;
  /** Shrinks right away on its way out, rather than drifting off. */
  snap?: boolean;
  emissive?: number;
}

/** Each accent's look and behaviour, following the spec's library and its tone table. */
const STYLES: Record<AccentKind, Style> = {
  // Emotional
  heart: { shape: 'heart', size: 0.22, place: 'side', motion: 'float', count: 3, stagger: 0.22, life: 1.7, every: 1.6, enter: 0.3, exit: 0.4, overshoot: 1.3 },
  sparkle: { shape: 'sparkle', size: 0.2, place: 'around', motion: 'twinkle', count: 3, stagger: 0.14, life: 0.9, every: 1.3, enter: 0.18, exit: 0.25, overshoot: 2 },
  blush: { shape: 'blush', size: 0.17, place: 'cheek', motion: 'static', count: 2, stagger: 0, life: Infinity, every: 0, enter: 0.15, exit: 0.3, overshoot: 1.2 },
  anger: { shape: 'anger', size: 0.22, place: 'topSide', motion: 'jitter', count: 1, stagger: 0, life: Infinity, every: 0, enter: 0.12, exit: 0.18, overshoot: 2.4, snap: true },
  puff: { shape: 'puff', size: 0.24, place: 'mouth', motion: 'puff', count: 1, stagger: 0, life: 0.9, every: 2.6, enter: 0.15, exit: 0.5, overshoot: 1.4 },
  scribble: { shape: 'scribble', size: 0.36, place: 'top', motion: 'wobble', count: 1, stagger: 0, life: Infinity, every: 0, enter: 0.2, exit: 0.35, overshoot: 1.7 },
  // Activity
  zzz: { shape: 'zzz', size: 0.15, place: 'side', motion: 'zig', count: 1, stagger: 0, life: 2.1, every: 0.85, enter: 0.3, exit: 0.45, overshoot: 1.2 },
  note: { shape: 'note', size: 0.2, place: 'side', motion: 'bounce', count: 1, stagger: 0, life: 1.6, every: 0.7, enter: 0.18, exit: 0.35, overshoot: 1.8 },
  book: { shape: 'book', size: 0.34, place: 'side', motion: 'hover', count: 1, stagger: 0, life: Infinity, every: 0, enter: 0.25, exit: 0.3, overshoot: 1.7 },
  controller: { shape: 'controller', size: 0.34, place: 'side', motion: 'bounce', count: 1, stagger: 0, life: Infinity, every: 0, enter: 0.22, exit: 0.3, overshoot: 1.9 },
  sprout: { shape: 'sprout', size: 0.3, place: 'side', motion: 'grow', count: 1, stagger: 0, life: 2.6, every: 4, enter: 0.45, exit: 0.4, overshoot: 1.4 },
  // Emphasis
  rays: { shape: 'ray', size: 0.2, place: 'rays', motion: 'burst', count: 3, stagger: 0.05, life: 0.55, every: 2.4, enter: 0.15, exit: 0.2, overshoot: 2.8, snap: true },
  question: { shape: 'question', size: 0.26, place: 'topSide', motion: 'tilt', count: 1, stagger: 0, life: Infinity, every: 0, enter: 0.25, exit: 0.3, overshoot: 1.8 },
  bulb: { shape: 'bulb', size: 0.3, place: 'top', motion: 'glow', count: 1, stagger: 0, life: 1.8, every: 0, enter: 0.2, exit: 0.35, overshoot: 2.2, emissive: 0xffc933 },
  focus: { shape: 'focus', size: 0.16, place: 'focus', motion: 'static', count: 3, stagger: 0.06, life: Infinity, every: 0, enter: 0.14, exit: 0.2, overshoot: 1.3 },
  speed: { shape: 'speed', size: 0.55, place: 'behind', motion: 'streak', count: 1, stagger: 0, life: 0.3, every: 0, enter: 0.06, exit: 0.16, overshoot: 1 },
  ellipsis: { shape: 'dot', size: 0.09, place: 'ellipsis', motion: 'dots', count: 3, stagger: 0.22, life: Infinity, every: 0, enter: 0.18, exit: 0.25, overshoot: 1.6 },
  sweat: { shape: 'sweat', size: 0.15, place: 'temple', motion: 'slide', count: 1, stagger: 0, life: 1.3, every: 1.9, enter: 0.2, exit: 0.3, overshoot: 1.6 },
};

// ---- Triggers: what each feeling, reaction and activity shows ----
const BY_REACTION: Partial<Record<ReactionName, AccentKind>> = { angry: 'anger', surprised: 'rays', teetering: 'sweat' };
const BY_EXPRESSION: Partial<Record<ExpressionName, AccentKind>> = {
  love: 'heart', delighted: 'sparkle', proud: 'sparkle', starstruck: 'sparkle', inAwe: 'sparkle', amazed: 'sparkle',
  embarrassed: 'blush', angry: 'anger', furious: 'anger', frustrated: 'anger', relieved: 'puff',
  anxious: 'scribble', baffled: 'scribble', nervous: 'sweat', worried: 'sweat', sleepy: 'zzz', tired: 'zzz',
  excited: 'rays', surprised: 'rays', curious: 'question', confused: 'question', puzzled: 'question',
  thinking: 'ellipsis', focused: 'focus', determined: 'focus',
};
/** Moods stay quiet, apart from the ones whose state is the point. */
const BY_MOOD: Partial<Record<MoodName, AccentKind>> = { tired: 'zzz', nervous: 'sweat' };
const BY_ACTIVITY: Record<Activity, AccentKind> = { music: 'note', reading: 'book', gaming: 'controller', gardening: 'sprout' };
/** One-off accents as a gesture plays: [kind, seconds in]. */
const ON_GESTURE: Partial<Record<GestureName, readonly [AccentKind, number]>> = {
  celebrate: ['sparkle', 0.35], startle: ['rays', 0], sigh: ['puff', 0.75], stomp: ['anger', 0.2],
  shrug: ['question', 0.3], flinch: ['sweat', 0.1],
};
/** Speed lines start above this running speed (units/s). */
const SPEED_LINES_FROM = 1.6;

function wanted(s: AccentSubject): AccentKind | null {
  if (s.isKnockedOut) return 'zzz';
  return (s.reaction && BY_REACTION[s.reaction])
    || (s.expression && BY_EXPRESSION[s.expression])
    || (s.activity && BY_ACTIVITY[s.activity])
    || BY_MOOD[s.mood]
    || null;
}

/** A tenant the accents are following. */
interface Track {
  subject: AccentSubject;
  /** +1 or −1: which side of the head its accents sit (upper left or right on screen). */
  side: number;
  primary: AccentKind | null;
  next: number;
  gesture: GestureName | null;
  pending: AccentKind | null;
  pendingAt: number;
  speedNext: number;
  speedLane: number;
  seen: number;
}

/** One symbol in the pool. */
interface Slot {
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  track: Track | null;
  kind: AccentKind;
  style: Style;
  /** Seconds since it was due to appear (negative while it waits its turn in a burst). */
  age: number;
  life: number;
  exitAge: number;
  index: number;
  phase: number;
  /** Where it sits, in head radii in the camera's plane (x right, y up). */
  ox: number;
  oy: number;
  rot: number;
  /** The head (or body) it's following, smoothed: the floating lag. */
  anchor: THREE.Vector3;
  /** Speed lines: the direction of travel on screen. */
  dir: number;
}

const POOL = 96;
/** The smallest an accent gets on screen, as a share of the view's height (legible from afar). */
const MIN_SCREEN = 0.026;
const R = new THREE.Vector3(), UP = new THREE.Vector3(), TOWARD = new THREE.Vector3();
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), qz = new THREE.Quaternion();
const Z = new THREE.Vector3(0, 0, 1);

const easeOutBack = (x: number, c1: number) => {
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export class Accents {
  readonly group = new THREE.Group();
  /** Turn them all off (and clear what's showing). */
  enabled = true;
  private readonly slots: Slot[] = [];
  private readonly tracks: Track[] = [];
  private time = 0;
  private frame = 0;
  private cursor = 0;

  constructor(parent: THREE.Object3D) {
    this.group.name = 'accents';
    parent.add(this.group);
    for (let i = 0; i < POOL; i++) {
      const material = new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.42, metalness: 0, transparent: true, emissive: 0x000000,
      });
      const mesh = new THREE.Mesh(accentShape('dot'), material);
      mesh.visible = false;
      mesh.renderOrder = 2;
      this.group.add(mesh);
      this.slots.push({
        mesh, material, track: null, kind: 'heart', style: STYLES.heart, age: 0, life: 0, exitAge: Infinity,
        index: 0, phase: 0, ox: 0, oy: 0, rot: 0, anchor: new THREE.Vector3(), dir: 0,
      });
    }
  }

  /** A one-off accent on a tenant, now (a lightbulb for an idea, say). */
  burst(subject: AccentSubject, kind: AccentKind): void {
    const t = this.trackFor(subject);
    this.emit(t, kind, Number.isFinite(STYLES[kind].life) ? undefined : 1.4);
  }

  /** Once per rendered frame, after the tenants have moved and before rendering. */
  update(dt: number, camera: THREE.Camera, subjects: readonly AccentSubject[]): void {
    this.time += dt;
    this.frame++;
    R.set(1, 0, 0).applyQuaternion(camera.quaternion);
    UP.set(0, 1, 0).applyQuaternion(camera.quaternion);
    TOWARD.set(0, 0, 1).applyQuaternion(camera.quaternion);
    const now = this.time;

    if (this.enabled) {
      for (const s of subjects) {
        const t = this.trackFor(s);
        t.seen = this.frame;
        // The main accent: when the reason changes, the old one fades and the new one starts.
        const want = wanted(s);
        if (want !== t.primary) {
          if (t.primary) this.retire(t, t.primary);
          t.primary = want;
          t.next = now;
        }
        if (want && now >= t.next) {
          this.emit(t, want);
          const every = STYLES[want].every;
          t.next = every > 0 ? now + every * (0.85 + 0.3 * Math.random()) : Infinity;
        }
        // One-offs as a gesture starts.
        if (s.gesture !== t.gesture) {
          t.gesture = s.gesture;
          const g = s.gesture && ON_GESTURE[s.gesture];
          if (g) { t.pending = g[0]; t.pendingAt = now + g[1]; }
        }
        if (t.pending && now >= t.pendingAt) {
          const k = t.pending;
          t.pending = null;
          if (k !== t.primary) this.emit(t, k, Number.isFinite(STYLES[k].life) ? undefined : 1.2);
        }
        // Speed lines while running, in alternating lanes.
        if (s.runSpeed > SPEED_LINES_FROM && now >= t.speedNext) {
          t.speedLane = (t.speedLane + 1) % 3;
          this.emit(t, 'speed');
          t.speedNext = now + 0.1;
        }
      }
    }
    // Tenants that have gone: their accents go too.
    for (let i = this.tracks.length - 1; i >= 0; i--) {
      const t = this.tracks[i];
      if (t.seen === this.frame && this.enabled) continue;
      for (const sl of this.slots) if (sl.track === t) this.free(sl);
      if (t.seen !== this.frame) this.tracks.splice(i, 1);
      else t.primary = null;
    }

    for (const sl of this.slots) if (sl.track) this.animate(sl, dt, camera);
  }

  dispose(): void {
    for (const sl of this.slots) sl.material.dispose();
    this.group.removeFromParent();
  }

  // ------------------------------------------------------------------ internals

  private trackFor(s: AccentSubject): Track {
    for (const t of this.tracks) if (t.subject === s) return t;
    const t: Track = {
      subject: s, side: this.tracks.length % 2 ? -1 : 1, primary: null, next: 0, gesture: s.gesture,
      pending: null, pendingAt: 0, speedNext: 0, speedLane: 0, seen: this.frame,
    };
    this.tracks.push(t);
    return t;
  }

  /** The feeling behind `kind` has passed: its symbols on this tenant start to go. */
  private retire(t: Track, kind: AccentKind): void {
    for (const sl of this.slots) {
      if (sl.track === t && sl.kind === kind && sl.exitAge > sl.age) sl.exitAge = Math.max(0, sl.age);
    }
  }

  private emit(t: Track, kind: AccentKind, life?: number): void {
    const st = STYLES[kind];
    for (let k = 0; k < st.count; k++) {
      const sl = this.take();
      if (!sl) return;
      sl.track = t;
      sl.kind = kind;
      sl.style = st;
      sl.age = -k * st.stagger;
      sl.life = life ?? st.life;
      sl.exitAge = sl.life;
      sl.index = k;
      sl.phase = Math.random() * Math.PI * 2;
      sl.rot = 0;
      const shape = kind === 'note' && Math.random() < 0.45 ? 'noteB' : st.shape;
      sl.mesh.geometry = accentShape(shape);
      sl.material.emissive.setHex(st.emissive ?? 0x000000);
      sl.material.emissiveIntensity = 0;
      this.place(sl, t, k);
      this.anchorOf(sl, sl.anchor);
    }
  }

  /** A free slot (or the oldest one going, if the pool's full). */
  private take(): Slot | null {
    for (let n = 0; n < POOL; n++) {
      const sl = this.slots[(this.cursor + n) % POOL];
      if (!sl.track) { this.cursor = (this.cursor + n + 1) % POOL; return sl; }
    }
    return null;
  }

  private free(sl: Slot): void {
    sl.track = null;
    sl.mesh.visible = false;
  }

  /** Where in the air round the head it starts (head radii, camera plane), by its kind's place. */
  private place(sl: Slot, t: Track, k: number): void {
    const s = t.side, j = () => (Math.random() - 0.5) * 0.35;
    switch (sl.style.place) {
      case 'side': sl.ox = s * (1.2 + j()); sl.oy = 0.75 + j(); break;
      case 'top': sl.ox = s * 0.25; sl.oy = 1.5; break;
      case 'topSide': sl.ox = s * 0.95; sl.oy = 1.15; break;
      case 'around': {
        const a = s * (0.25 + 0.55 * k + 0.2 * Math.random());
        sl.ox = 1.35 * Math.sin(a); sl.oy = 1.35 * Math.cos(a);
        break;
      }
      case 'temple': sl.ox = -s * 0.95; sl.oy = 0.7; break;
      case 'rays': case 'focus': {
        // Fanned out round the top of the head on its side (focus lines on the other).
        const side = sl.style.place === 'rays' ? s : -s;
        const a = side * (sl.style.place === 'rays' ? 0.3 + 0.45 * k : 0.75 + 0.35 * k);
        sl.ox = 1.42 * Math.sin(a); sl.oy = 1.42 * Math.cos(a); sl.rot = -a;
        break;
      }
      case 'ellipsis': sl.ox = s * 1.05 + (k - 1) * 0.34; sl.oy = 1.25; break;
      case 'behind': sl.ox = 0; sl.oy = (t.speedLane - 1) * 0.55 + j() * 0.4; break;
      case 'mouth': sl.ox = s * 0.6; sl.oy = -0.15; break; // beside the mouth, then drifting out
      case 'cheek': sl.ox = 0; sl.oy = 0; break;
    }
  }

  /** The point it follows: the head, a spot on the face, or the body. */
  private anchorOf(sl: Slot, out: THREE.Vector3): THREE.Vector3 {
    const s = sl.track!.subject;
    switch (sl.style.place) {
      case 'cheek': return s.facePoint(sl.index ? -0.118 : 0.118, -0.05, out);
      case 'mouth': return s.facePoint(0.04 * sl.track!.side, -0.06, out);
      case 'behind': return s.bodyCenter(out);
      default: return s.headCenter(out);
    }
  }

  private animate(sl: Slot, dt: number, camera: THREE.Camera): void {
    const st = sl.style, t = sl.track!, s = t.subject, mesh = sl.mesh;
    sl.age += dt;
    if (sl.age < 0) { mesh.visible = false; return; }
    if (sl.age > sl.exitAge + st.exit) { this.free(sl); return; }

    // Follow, with a slight floating lag.
    this.anchorOf(sl, tmp);
    sl.anchor.lerp(tmp, 1 - Math.exp(-dt * 12));

    const a = sl.age;
    const enter = clamp01(a / st.enter);
    let scale = 0.15 + 0.85 * easeOutBack(enter, st.overshoot);
    let alpha = Math.min(1, enter / 0.6);
    let ox = sl.ox, oy = sl.oy, rot = sl.rot, sx = 1;
    const side = t.side;
    switch (st.motion) {
      case 'float': ox += 0.18 * Math.sin(2.4 * a + sl.phase); oy += 0.55 * a; rot = 0.2 * Math.sin(2.4 * a + sl.phase); break;
      case 'twinkle': scale *= 1 + 0.18 * Math.sin(9 * a + sl.phase); rot = side * 0.9 * a; break;
      case 'jitter': {
        const k = Math.max(0, 1 - a / 0.7); // vibrates hard as it pops, then simmers
        ox += (0.05 * k + 0.012) * Math.sin(61 * a); oy += (0.05 * k + 0.012) * Math.cos(53 * a);
        scale *= 1 + 0.1 * Math.sin(14 * a);
        break;
      }
      case 'puff': scale *= 1 + 0.7 * a / sl.life; ox += side * 0.9 * a; oy += 0.3 * a; break;
      case 'wobble': rot = 0.45 * Math.sin(3.1 * a) + 0.25 * Math.sin(5.3 * a + 1); scale *= 1 + 0.05 * Math.sin(4.7 * a); break;
      case 'zig': ox += side * 0.45 * a; oy += 0.55 * a; scale *= 1 + 0.5 * a / sl.life; rot = -side * 0.2; break;
      case 'bounce': ox += side * 0.35 * a; oy += 0.35 * a + 0.14 * Math.abs(Math.sin(5 * a + sl.phase)); rot = 0.22 * Math.sin(5 * a); break;
      case 'hover': oy += 0.06 * Math.sin(2.1 * a); rot = 0.12 * Math.sin(1.3 * a + sl.phase); break;
      case 'grow': oy += 0.05 * Math.sin(2 * a); break;
      case 'burst': { const out = 0.25 * clamp01(a / sl.life); ox += out * Math.sin(-sl.rot); oy += out * Math.cos(-sl.rot); break; }
      case 'tilt': rot = side * -0.25 + 0.14 * Math.sin(2 * a); oy += 0.05 * Math.sin(2.3 * a); break;
      case 'glow': {
        const g = Math.max(0, Math.sin(Math.min(1, a / 0.6) * Math.PI)) * 0.8 + 0.35;
        sl.material.emissiveIntensity = g;
        oy += 0.04 * Math.sin(3 * a);
        break;
      }
      case 'streak': sx = 1 + 1.6 * clamp01(a / sl.life); break;
      case 'dots': scale *= 1 + 0.35 * Math.max(0, Math.sin(4.2 * a - 1.1 * sl.index)); break;
      case 'slide': oy -= 0.35 * a; break;
      case 'static': if (st.place === 'focus') scale *= 1 + 0.06 * Math.sin(6 * a + sl.index); break;
    }
    // Leaving: fade, shrink and drift up (or snap smaller, for the sharp ones).
    if (sl.age > sl.exitAge) {
      const e = clamp01((sl.age - sl.exitAge) / st.exit);
      alpha *= 1 - e;
      scale *= st.snap ? 1 - 0.85 * e : 1 - 0.35 * e;
      if (st.motion !== 'slide' && st.place !== 'cheek') oy += 0.35 * e;
    }

    // Far away (the game's view), grow to stay legible, and stand off a bit further.
    const H = s.headRadius;
    const viewH = (camera as THREE.OrthographicCamera).isOrthographicCamera
      ? ((camera as THREE.OrthographicCamera).top - (camera as THREE.OrthographicCamera).bottom) / (camera as THREE.OrthographicCamera).zoom
      : 2 * Math.tan(THREE.MathUtils.degToRad((camera as THREE.PerspectiveCamera).fov) / 2) * camera.position.distanceTo(sl.anchor);
    const boost = Math.min(3, Math.max(1, (MIN_SCREEN * viewH) / (st.size * 2 * H)));
    const spread = 1 + 0.6 * (boost - 1);
    ox *= spread; oy *= spread;
    const size = st.size * 2 * H * boost * Math.max(0.001, scale);
    mesh.visible = alpha > 0.01;
    sl.material.opacity = alpha;
    if (st.place === 'cheek') {
      // Lying on the cheek, facing out of the face.
      s.faceQuaternion(mesh.quaternion);
      tmp.copy(sl.anchor).sub(s.headCenter(tmp2)).setLength(0.012 * H / 0.1);
      mesh.position.copy(sl.anchor).add(tmp);
      mesh.scale.set(size, size, size);
      return;
    }
    if (st.place === 'behind') {
      // Behind the body, along the way it's going (on screen), stretched out back.
      s.velocity(tmp);
      const vx = tmp.dot(R), vy = tmp.dot(UP), l = Math.hypot(vx, vy) || 1;
      rot = Math.atan2(vy, vx);
      const back = 1.6 + 0.6 * clamp01(a / sl.life);
      mesh.position.copy(sl.anchor)
        .addScaledVector(R, (-vx / l) * back * H - (vy / l) * oy * H)
        .addScaledVector(UP, (-vy / l) * back * H + (vx / l) * oy * H);
    } else {
      mesh.position.copy(sl.anchor).addScaledVector(R, ox * H).addScaledVector(UP, oy * H).addScaledVector(TOWARD, 0.5 * H);
    }
    mesh.quaternion.copy(camera.quaternion).multiply(qz.setFromAxisAngle(Z, rot));
    mesh.scale.set(size * sx, size, size);
  }
}
