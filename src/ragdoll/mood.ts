/*
 * Body language as an alphabet.
 *
 * LETTERS are single dials that each bend one part of the pose or face: how slumped
 * the spine is, where the head points, what the fins do, how bouncy the walk is, how
 * open the eyes are... Each has a neutral value (the plain, happy character as drawn).
 *
 * WORDS (moods) are spellings: a few letters set away from neutral. "Proud" is chest
 * out, chin up, fins back, a strut and a smug smile. Words blend: switching mood
 * crossfades, and quick reactions (anger at being shoved, surprise, the jump's game
 * face) are words too, laid over the mood while they last.
 *
 * The ragdoll reads the blended letters every step (ActiveRagdoll.poseLimbs and
 * friends) and the face reads its letters (Face.setExpression). Nothing here touches
 * physics directly, so a mood never makes it fall over: it only moves pose targets.
 */

/** Posture letters: −1..1 (two-sided) or 0..1 (amounts). */
export const POSTURE_LETTERS = [
  'spine', // −1 slumped forward ↔ +1 chest puffed out
  'lean', // −1 leaning back ↔ +1 leaning forward
  'headPitch', // −1 head hanging ↔ +1 chin up
  'headTilt', // −1 ↔ +1 head cocked to one side or the other
  'headTurn', // −1 ↔ +1 head turned away to one side or the other
  'finsLift', // −1 drooping ↔ +1 raised up high
  'finsSpread', // −1 tucked in ↔ +1 flared out
  'finsBack', // −1 held forward ↔ +1 pulled back
  'elbowBend', // −1 straight ↔ +1 fins bent forward at the elbow
  'energy', // −1 sluggish ↔ +1 bouncy: tempo, bob, walk speed, an idle bounce
  'stride', // −1 shuffle ↔ +1 strut: how big the steps are
  'tension', // −1 loose and floppy ↔ +1 tight and stiff (muscle speed)
  'sway', // 0..1 slow side-to-side rocking
  'tremble', // 0..1 fast shaking
  'fidget', // 0..1 restless little head and fin motions, darting eyes
] as const;

/** Face letters. */
export const FACE_LETTERS = [
  'smile', // −1 frown ↔ 0 flat line ↔ +1 smile (the drawing's)
  'mouthOpen', // 0..1 an open "o"
  'eyeOpen', // −1 half-lidded / squint ↔ +1 wide
  'browShow', // 0..1 brows (the drawing has none)
  'browHeight', // −1 low ↔ +1 raised
  'browAngle', // −1 sad (inner ends up) ↔ +1 cross (inner ends down)
  'gazeX', // −1 ↔ +1 eyes looking to one side or the other
  'gazeY', // −1 down ↔ +1 up
  'blush', // 0..1 rosy cheeks (on top of any blush in the character's look)
  'lopsided', // −1..1 one eye squints harder and its brow drops, the other opens and lifts (concentrating)
  'mouthShift', // −1..1 the mouth slides off to one side, scrunched and tilted
  'tongue', // 0..1 the tip of the tongue pokes out (of the corner the mouth slid to, or the middle)
  'eyeSmile', // 0..1 eyes squeezed shut into happy upward arcs (^ ^)
  'eyeClose', // 0..1 eyes gently shut in relaxed downward curves (‿ ‿)
  'wink', // −1..1 one eye shut in a happy arc: +1 its left eye (on the viewer's right), −1 its right
  'squeeze', // 0..1 eyes screwed shut into chevrons (> <)
  'heartEyes', // 0..1 the eyes become red hearts
  'starEyes', // 0..1 the eyes become outlined stars
  'spiralEyes', // 0..1 the eyes become dizzy spirals
  'sparkleEyes', // 0..1 each eye's glint grows into a big four-pointed sparkle (in awe)
  'teeth', // 0..1 a boxy grimace showing gritted teeth
  'wavy', // 0..1 a wobbly, queasy mouth
] as const;

export type PostureLetter = (typeof POSTURE_LETTERS)[number];
export type FaceLetter = (typeof FACE_LETTERS)[number];
export type Letter = PostureLetter | FaceLetter;
export const LETTERS: readonly Letter[] = [...POSTURE_LETTERS, ...FACE_LETTERS];

/** A mood: the letters it sets (absolute values); any it leaves out stay neutral. */
export type Word = Partial<Record<Letter, number>>;
export type Letters = Record<Letter, number>;

/** The plain, content character as drawn. */
export const NEUTRAL: Letters = Object.fromEntries(LETTERS.map((l) => [l, l === 'smile' ? 1 : 0])) as Letters;

const UNSIGNED: readonly Letter[] = [
  'sway', 'tremble', 'fidget', 'mouthOpen', 'browShow', 'blush', 'tongue',
  'eyeSmile', 'eyeClose', 'squeeze', 'heartEyes', 'starEyes', 'spiralEyes', 'sparkleEyes', 'teeth', 'wavy',
];

/** Each letter's range, for sliders. */
export const LETTER_RANGE: Record<Letter, [number, number]> = Object.fromEntries(
  LETTERS.map((l) => [l, l === 'wink' || !UNSIGNED.includes(l) ? [-1, 1] : [0, 1]]),
) as Record<Letter, [number, number]>;

/** The moods. Spelled with letters; tweak these to change how a mood reads. */
export const MOODS = {
  calm: {},
  proud: {
    spine: 1, headPitch: 0.7, finsBack: 0.7, finsSpread: 0.3, elbowBend: 0.2, lean: -0.15,
    energy: 0.3, stride: 1, tension: 0.3,
    smile: 0.7, eyeOpen: -0.4, browShow: 0.5, browHeight: 0.5,
  },
  sulking: {
    spine: -0.8, headPitch: -0.8, headTurn: 0.5, finsLift: -1, finsSpread: -0.4, lean: 0.15,
    energy: -0.7, stride: -1, tension: -0.4, fidget: 0.2,
    smile: -0.7, eyeOpen: -0.4, browShow: 0.7, browHeight: -0.3, browAngle: 0.5, gazeX: 0.6, gazeY: -0.6,
  },
  shy: {
    spine: -0.4, headPitch: -0.5, headTilt: 0.6, headTurn: 0.35, finsSpread: -1, finsBack: -0.7, elbowBend: 0.8,
    energy: -0.3, stride: -0.6, tension: 0.2, fidget: 0.5,
    smile: 0.45, gazeX: 0.7, gazeY: -0.5, blush: 1,
  },
  excited: {
    spine: 0.5, headPitch: 0.4, finsLift: 1, finsSpread: 0.4, elbowBend: 0.3,
    energy: 1, stride: 0.6, tension: 0.3, fidget: 0.4,
    smile: 1, mouthOpen: 0.55, eyeOpen: 0.6, browShow: 0.5, browHeight: 0.8,
  },
  tired: {
    spine: -0.6, headPitch: -0.6, finsLift: -0.7, energy: -1, stride: -0.8, tension: -0.8, sway: 0.6,
    smile: 0, mouthOpen: 0.2, eyeOpen: -0.65, gazeY: -0.4,
  },
  nervous: {
    spine: -0.3, finsSpread: -0.6, finsBack: -0.4, elbowBend: 0.6,
    energy: 0.3, stride: -0.4, tension: 1, tremble: 0.35, fidget: 1,
    smile: -0.15, eyeOpen: 0.5, browShow: 0.8, browHeight: 0.4, browAngle: -0.7,
  },
  sad: {
    spine: -0.7, headPitch: -0.7, finsLift: -0.8, finsSpread: -0.3,
    energy: -0.7, stride: -0.7, tension: -0.4,
    smile: -0.8, eyeOpen: -0.2, browShow: 0.9, browAngle: -1, gazeY: -0.5,
  },
  curious: {
    lean: 0.35, headTilt: 0.8, headPitch: 0.15, finsBack: -0.2, elbowBend: 0.3, energy: 0.2, stride: -0.2,
    smile: 0.3, mouthOpen: 0.2, eyeOpen: 0.45, browShow: 0.5, browHeight: 0.5,
  },
  /** Yours to spell: edit its letters in the tuning panel (they're saved with the rest). */
  custom: { ...NEUTRAL } as Word,
} satisfies Record<string, Word>;

export type MoodName = keyof typeof MOODS;
export const MOOD_NAMES = Object.keys(MOODS) as MoodName[];

/** Quick reactions, laid over the mood while they last. */
export const REACTIONS = {
  /** Shoved one time too many. */
  angry: {
    spine: -0.5, lean: 0.25, finsBack: 0.5, finsSpread: 0.9, tension: 0.8, tremble: 1, stride: 0.4, energy: 0.2,
    smile: -1, eyeOpen: -0.45, browShow: 1, browHeight: -0.6, browAngle: 1,
  },
  /** Just got shoved. */
  surprised: {
    spine: 0.4, finsLift: 0.35, finsSpread: 0.4, energy: 0.3,
    smile: 0, mouthOpen: 1, eyeOpen: 1, browShow: 1, browHeight: 1, browAngle: -0.4,
  },
  /** On the edge of a drop: windmilling fins, wide eyes, mouth open. */
  teetering: {
    finsLift: 0.9, finsSpread: 1, finsBack: -0.3, tremble: 0.7, tension: 0.5,
    smile: -0.2, mouthOpen: 0.7, eyeOpen: 1, browShow: 1, browHeight: 1, browAngle: -0.6,
  },
  /**
   * The game face, while jumping: concentrating hard. Lopsided squint, knitted brows, the
   * mouth scrunched off to one side with the tongue poking out of the corner.
   */
  focused: {
    smile: 0, eyeOpen: -0.3, browShow: 1, browHeight: -0.35, browAngle: 0.45, gazeY: -0.25,
    lopsided: 0.75, mouthShift: 0.8, tongue: 1,
  },
} satisfies Record<string, Word>;

export type ReactionName = keyof typeof REACTIONS;

/**
 * The expression library (the character sheet's faces): face-only words. One can be laid
 * over the mood, replacing its face (any face letter an expression leaves out goes back
 * to the plain face); the body keeps the mood's posture. Reactions still show on top.
 */
export const EXPRESSIONS = {
  // Foundational
  neutral: {},
  happy: { eyeSmile: 1, smile: 1, mouthOpen: 0.8 },
  excited: { eyeOpen: 0.6, smile: 1, mouthOpen: 0.8, browShow: 0.6, browHeight: 0.8 },
  surprised: { eyeOpen: 0.8, smile: 0, mouthOpen: 0.55, browShow: 0.7, browHeight: 1 },
  delighted: { eyeSmile: 1, smile: 1, blush: 0.25 },
  laughing: { eyeSmile: 1, smile: 1, mouthOpen: 1, browShow: 0.4, browHeight: 0.6 },
  winkLeft: { wink: 1, smile: 0.9 },
  winkRight: { wink: -1, smile: 0.9 },
  content: { eyeClose: 1, smile: 0.9 },
  relaxed: { eyeClose: 1, smile: 1, mouthOpen: 0.65 },
  // Cognitive
  thinking: { gazeX: 0.6, gazeY: 0.8, smile: 0.5, eyeOpen: 0.2, browShow: 0.6, browHeight: 0.5, lopsided: -0.25 },
  curious: { eyeOpen: 0.5, gazeX: -0.3, gazeY: 0.6, smile: 0, mouthOpen: 0.35, browShow: 0.7, browHeight: 0.7 },
  confused: { lopsided: 0.6, browShow: 1, browAngle: 0.3, mouthShift: 0.6, smile: -0.3, gazeY: 0.3 },
  puzzled: { eyeOpen: 0.3, gazeX: 0.4, gazeY: 0.4, smile: -0.5, browShow: 0.9, browHeight: 0.3, browAngle: -0.6 },
  determined: { eyeOpen: -0.1, smile: 0.8, browShow: 1, browHeight: -0.4, browAngle: 1 },
  focused: { eyeOpen: -0.2, smile: 0, browShow: 1, browHeight: -0.5, browAngle: 0.8 },
  serious: { eyeOpen: -0.1, smile: 0 },
  // Emotional
  concerned: { eyeOpen: 0.4, smile: -0.6, browShow: 0.9, browHeight: 0.4, browAngle: -0.8 },
  worried: { eyeOpen: 0.3, smile: -0.7, mouthOpen: 0.45, browShow: 1, browHeight: 0.4, browAngle: -0.9 },
  anxious: { eyeOpen: 0.5, smile: -0.8, mouthOpen: 0.6, wavy: 0.8, browShow: 1, browHeight: 0.6, browAngle: -1 },
  sad: { eyeOpen: -0.2, gazeY: -0.4, smile: -0.9, browShow: 1, browAngle: -1 },
  disappointed: { eyeClose: 1, smile: -0.8, browShow: 0.4, browAngle: -0.6 },
  frustrated: { squeeze: 1, smile: -0.8 },
  angry: { eyeOpen: -0.2, smile: -0.8, mouthOpen: 0.55, browShow: 1, browHeight: -0.6, browAngle: 1 },
  furious: { eyeOpen: -0.35, smile: -1, mouthOpen: 1, browShow: 1, browHeight: -0.8, browAngle: 1 },
  embarrassed: { eyeOpen: 0.1, gazeX: 0.5, gazeY: -0.3, smile: 0.6, wavy: 0.5, blush: 1 },
  proud: { eyeClose: 1, smile: 0.8, mouthShift: 0.35, browShow: 0.8, browHeight: 0.8 },
  smug: { eyeOpen: -0.55, gazeX: 0.3, smile: 0.6, mouthShift: 0.5, browShow: 0.6, browHeight: -0.1, browAngle: 0.3 },
  love: { heartEyes: 1, smile: 1, mouthOpen: 0.75 },
  // Playful and reactive
  silly: { eyeOpen: 0.3, smile: 0.9, tongue: 1 },
  amazed: { eyeOpen: 0.9, smile: 0, mouthOpen: 0.7, browShow: 0.6, browHeight: 1 },
  inAwe: { sparkleEyes: 1, eyeOpen: 0.6, smile: 0, mouthOpen: 0.5 },
  starstruck: { starEyes: 1, smile: 1, mouthOpen: 0.8 },
  sleepy: { eyeClose: 1, gazeY: -0.3, smile: 0, mouthOpen: 0.35 },
  tired: { eyeOpen: -0.7, gazeY: -0.2, smile: 0 },
  relieved: { eyeClose: 1, smile: 0.8 },
  sick: { eyeOpen: -0.4, gazeY: -0.3, smile: -0.3, wavy: 1, browShow: 0.7, browAngle: -0.7 },
  nervous: { eyeOpen: 0.4, smile: -0.2, teeth: 1, browShow: 0.9, browHeight: 0.5, browAngle: -0.8 },
  baffled: { spiralEyes: 1, smile: 0, mouthOpen: 0.5 },
  playful: { eyeSmile: 1, smile: 1, tongue: 1 },
} satisfies Record<string, Word>;

export type ExpressionName = keyof typeof EXPRESSIONS;
export const EXPRESSION_NAMES = Object.keys(EXPRESSIONS) as ExpressionName[];
/** The sheet's name for each expression ("winkLeft" → "Wink (left)"). */
export function expressionLabel(n: ExpressionName): string {
  if (n === 'winkLeft') return 'Wink (left)';
  if (n === 'winkRight') return 'Wink (right)';
  if (n === 'inAwe') return 'In awe';
  return n[0].toUpperCase() + n.slice(1);
}
const REACTION_NAMES = Object.keys(REACTIONS) as ReactionName[];

/**
 * Blends moods and reactions into one set of letters. Moods crossfade over about half
 * a second; reactions come in at whatever weight the ragdoll gives them, and push the
 * mood mostly aside while they're on (an angry sulker reads as angry).
 */
export class MoodBlender {
  /** The blended result, read every step. */
  readonly letters: Letters = { ...NEUTRAL };
  private readonly weights = new Map<MoodName, number>(MOOD_NAMES.map((m) => [m, m === 'calm' ? 1 : 0]));
  mood: MoodName = 'calm';
  /** How strongly the mood shows, 0..1. */
  strength = 1;
  /**
   * The character's resting posture from its traits (a stooped senior, a wobbly baby):
   * the base layer every mood is added on top of.
   */
  base: Word = {};
  /** An expression laid over the mood's face, or null for the mood's own. */
  expression: ExpressionName | null = null;
  private readonly exprWeights = new Map<ExpressionName, number>(EXPRESSION_NAMES.map((e) => [e, 0]));

  /**
   * Runs every physics step for every ragdoll, so it only visits moods and reactions
   * that are actually showing, and only the letters each one sets, and allocates nothing.
   */
  update(dt: number, reactions: Record<ReactionName, number>): void {
    const fade = Math.min(1, dt * 4);
    let reactionMax = 0;
    for (const r of REACTION_NAMES) reactionMax = Math.max(reactionMax, reactions[r]);
    const moodShare = 1 - 0.85 * reactionMax;

    const out = this.letters;
    for (const l of LETTERS) out[l] = NEUTRAL[l];
    // Traits are relative to neutral (they nudge it), not absolute like mood words.
    for (const l in this.base) out[l as Letter] += this.base[l as Letter]!;
    for (const m of MOOD_NAMES) {
      const want = m === this.mood ? this.strength : 0;
      let w = this.weights.get(m)!;
      w += (want - w) * fade;
      if (w < 1e-4 && want === 0) w = 0;
      this.weights.set(m, w);
      if (w === 0) continue;
      const word = MOODS[m] as Word;
      for (const l in word) out[l as Letter] += (word[l as Letter]! - NEUTRAL[l as Letter]) * w * moodShare;
    }
    // The expression replaces the mood's face (crossfading like a mood does).
    for (const e of EXPRESSION_NAMES) {
      const want = e === this.expression ? 1 : 0;
      let w = this.exprWeights.get(e)!;
      w += (want - w) * Math.min(1, dt * 8);
      if (w < 1e-4 && want === 0) w = 0;
      this.exprWeights.set(e, w);
      if (w === 0) continue;
      const word = EXPRESSIONS[e] as Word;
      const k = w * moodShare;
      for (const l of FACE_LETTERS) out[l] += ((word[l] ?? NEUTRAL[l]) - out[l]) * k;
    }
    for (const r of REACTION_NAMES) {
      const w = reactions[r];
      if (w < 1e-4) continue;
      const word = REACTIONS[r] as Word;
      for (const l in word) out[l as Letter] += (word[l as Letter]! - NEUTRAL[l as Letter]) * w;
    }
    for (const l of LETTERS) {
      const [lo, hi] = LETTER_RANGE[l];
      out[l] = Math.min(hi, Math.max(lo, out[l]));
    }
  }
}
