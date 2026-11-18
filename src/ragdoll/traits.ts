/*
 * Traits: who the character is, as three high-level dials that each drive many of the
 * low-level ones (proportions, muscles, gait, posture).
 *
 *   age      0 baby · 0.25 kid · 0.5 adult · 1 senior
 *   weight   −1 slim ↔ +1 heavy
 *   fitness  −1 out of shape ↔ +1 athletic
 *
 * Weight and fitness combine: heavy + athletic reads "thick"; heavy + out of shape reads
 * "fat"; slim + athletic reads "fit"; slim + out of shape reads "frail".
 *
 * Traits are modifiers ON TOP of the base tuning (config.ts + tuning.json), not
 * replacements, so a tuned character stays recognisably itself at every age and build.
 * They're fixed when a ragdoll is built, like proportions (the sandbox rebuilds it when
 * they change).
 */
import { TRAITS } from './config';
import type { Word } from './mood';

/** Multipliers (×) and nudges (+) the traits apply. 1 / 0 = no change. */
export interface TraitEffects {
  /** Proportion multipliers (× the tuned value); `waist` and `eyeHeight` are added instead. */
  proportions: {
    /** Overall size: every length and thickness scales by this (a baby is small all over). */
    size: number;
    headSize: number; bodyWidth: number; bodyHeight: number; legLength: number; legThickness: number;
    finLength: number; finWidth: number; shoulderWidth: number; hipWidth: number; eyeSize: number;
    waistAdd: number; waistKeep: number; eyeHeightAdd: number;
  };
  /** All muscles: × speed and × damping. The neck gets its own (a baby's head bobbles). */
  muscleSpeed: number; muscleDamping: number;
  neckSpeed: number; neckDamping: number;
  /** Walk: × step tempo, × stride size, × bounce, × waddle, × chosen walking speed. */
  cadence: number; stride: number; bob: number; waddle: number; speed: number;
  /** × jump power, × time to get back up after a knockout, × head squish. */
  jump: number; recover: number; squish: number;
  /** Resting posture, as letters (see mood.ts): moods are layered on top of this. */
  posture: Word;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function traitEffects(t: { age: number; weight: number; fitness: number } = TRAITS): TraitEffects {
  // Split each dial into its two directions, 0..1 each.
  const young = clamp01((0.5 - t.age) / 0.5); // 1 = baby
  const old = clamp01((t.age - 0.5) / 0.5); // 1 = senior
  const heavy = clamp01(t.weight), slim = clamp01(-t.weight);
  const fit = clamp01(t.fitness), unfit = clamp01(-t.fitness);

  return {
    proportions: {
      // Babies: big head and eyes, short legs, fins and body. Seniors: a little smaller
      // and slighter. Heavy: wider everywhere, no waist. Athletic: broad shoulders, a taper.
      size: 1 - 0.3 * young - 0.04 * old,
      headSize: 1 + 0.35 * young - 0.03 * old,
      bodyWidth: 1 + 0.05 * young + 0.35 * heavy - 0.25 * slim,
      bodyHeight: 1 - 0.25 * young - 0.06 * old,
      legLength: 1 - 0.35 * young,
      legThickness: 1 + 0.1 * young - 0.1 * old + 0.35 * heavy - 0.25 * slim + 0.15 * fit,
      finLength: 1 - 0.3 * young,
      finWidth: 1 - 0.1 * old + 0.3 * heavy - 0.2 * slim + 0.15 * fit,
      shoulderWidth: 1 + 0.1 * heavy + 0.3 * fit - 0.1 * unfit,
      hipWidth: 1 + 0.25 * heavy - 0.1 * slim + 0.1 * unfit,
      eyeSize: 1 + 0.3 * young - 0.12 * old,
      waistAdd: 0.15 * fit,
      waistKeep: 1 - heavy, // a heavy build loses the waist
      eyeHeightAdd: -0.08 * young, // eyes low on the face reads as babyish
    },
    // Babies: soft and wobbly. Seniors: stiffer and slower to react. Fit: snappier.
    muscleSpeed: 1 - 0.2 * young - 0.15 * old + 0.15 * fit - 0.12 * unfit,
    muscleDamping: 1 - 0.3 * young + 0.4 * old,
    neckSpeed: 1 - 0.35 * young - 0.1 * old,
    neckDamping: 1 - 0.35 * young + 0.3 * old,
    // Babies toddle: quick little bouncy waddling steps. Seniors shuffle slowly. Heavy
    // waddles and bounces. Fit strides out.
    cadence: 1 + 0.35 * young - 0.3 * old - 0.1 * heavy + 0.1 * fit,
    stride: 1 - 0.25 * young - 0.35 * old - 0.1 * heavy + 0.2 * fit,
    bob: 1 + 0.5 * young - 0.4 * old + 0.5 * heavy,
    waddle: 1 + 0.6 * young + 0.9 * heavy - 0.2 * fit,
    speed: 1 - 0.15 * young - 0.35 * old - 0.2 * heavy + 0.15 * fit - 0.1 * unfit,
    // Never below 30%: stacked penalties (old + heavy + unfit) would otherwise leave it
    // too weak to leave the ground at all.
    jump: Math.max(0.3, 1 - 0.15 * young - 0.45 * old - 0.25 * heavy + 0.2 * fit - 0.15 * unfit),
    recover: 1 + 0.8 * old + 0.4 * heavy - 0.3 * fit + 0.2 * unfit,
    squish: 1 + 0.5 * young + 0.4 * heavy,
    posture: {
      // Baby: loose, wobbly, a bit bouncy, fins out for balance, looking up.
      // Senior: stooped, leaning in, slow, short steps, a slight tremble.
      // Heavy: fins held out around the belly, a little leaned back, less energy.
      // Athletic: chest up, chin up, springy. Out of shape: a slouch, low energy.
      spine: -0.45 * old + 0.3 * fit - 0.2 * unfit,
      lean: 0.15 * old - 0.1 * heavy,
      headPitch: 0.1 * young - 0.1 * old + 0.15 * fit,
      finsLift: 0.15 * young,
      finsSpread: 0.45 * heavy,
      finsBack: -0.1 * old,
      elbowBend: 0.2 * young + 0.3 * old,
      energy: 0.2 * young - 0.35 * old - 0.2 * heavy + 0.25 * fit - 0.2 * unfit,
      stride: -0.4 * old,
      tension: -0.3 * young + 0.15 * fit - 0.1 * unfit,
      sway: 0.25 * young,
      tremble: 0.08 * old,
    },
  };
}

/** A friendly name for an age value. */
export function ageName(age: number): string {
  return age < 0.12 ? 'baby' : age < 0.38 ? 'kid' : age < 0.72 ? 'adult' : 'senior';
}

/** Starting points for the sandbox's trait buttons. */
export const TRAIT_PRESETS = {
  baby: { age: 0, weight: 0.1, fitness: 0 },
  kid: { age: 0.25, weight: -0.1, fitness: 0.2 },
  adult: { age: 0.5, weight: 0, fitness: 0 },
  senior: { age: 1, weight: 0, fitness: -0.2 },
  fit: { age: 0.5, weight: -0.5, fitness: 1 },
  fat: { age: 0.5, weight: 1, fitness: -0.6 },
  thick: { age: 0.5, weight: 0.8, fitness: 0.8 },
  slim: { age: 0.5, weight: -1, fitness: 0 },
} as const;
