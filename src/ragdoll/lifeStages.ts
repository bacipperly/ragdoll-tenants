/*
 * Life stages, from the character lifecycle sheet: the same tenant from baby to elder,
 * each stage an age (the age trait does the body: size, proportions, posture, gait) and
 * the accessories that tell it at a glance.
 */
import type { Outfit } from './outfit';
import { ACCESSORY_KEYS } from './outfit';

export interface LifeStage {
  name: string;
  /** The sheet's age range, for labels. */
  years: string;
  traits: { age: number; weight: number; fitness: number };
  /** Accessories (and the odd garment) put on for the stage; other accessories come off. */
  wear: Partial<Outfit>;
}

export const LIFE_STAGES: readonly LifeStage[] = [
  {
    name: 'baby', years: '0–2', traits: { age: 0.02, weight: 0.15, fitness: 0 },
    wear: { pacifier: { color: '#8ecae6' }, pants: { color: '#ffffff', rise: 0.35, legs: 0 } },
  },
  { name: 'toddler', years: '2–4', traits: { age: 0.12, weight: 0.05, fitness: 0.1 }, wear: {} },
  { name: 'child', years: '5–12', traits: { age: 0.24, weight: -0.1, fitness: 0.2 }, wear: { backpack: { color: '#3a86ff' } } },
  {
    name: 'teen', years: '13–17', traits: { age: 0.35, weight: -0.1, fitness: 0.2 },
    wear: { hat: { style: 'cap', color: '#e63946', backwards: true }, headphones: { color: '#9b5de5' } },
  },
  { name: 'young adult', years: '18–29', traits: { age: 0.45, weight: 0, fitness: 0.1 }, wear: { bag: { color: '#7f5539' } } },
  { name: 'adult', years: '30–44', traits: { age: 0.55, weight: 0, fitness: 0 }, wear: {} },
  {
    name: 'middle-aged', years: '45–64', traits: { age: 0.74, weight: 0.15, fitness: -0.1 },
    wear: { glasses: { style: 'square', color: '#1b1b2f' } },
  },
  {
    name: 'elderly', years: '65+', traits: { age: 1, weight: 0, fitness: -0.2 },
    wear: {
      glasses: { style: 'round', color: '#3a3a3a' },
      whiskers: { color: '#f4f4f4', mustache: true, brows: true },
      cane: { color: '#7f5539' },
    },
  },
];

/** The stage an age falls in (halfway between the stages' ages). */
export function lifeStage(age: number): LifeStage {
  for (let i = 0; i < LIFE_STAGES.length - 1; i++) {
    if (age < (LIFE_STAGES[i].traits.age + LIFE_STAGES[i + 1].traits.age) / 2) return LIFE_STAGES[i];
  }
  return LIFE_STAGES[LIFE_STAGES.length - 1];
}

/** An outfit dressed for a stage: its accessories swapped for the stage's. */
export function dressForStage(o: Outfit, stage: LifeStage): Outfit {
  const out = structuredClone(o);
  for (const k of ACCESSORY_KEYS) (out as unknown as Record<string, unknown>)[k] = null;
  if (out.hat?.backwards) out.hat = null; // a teen's cap goes when they grow up
  if (out.pants && out.pants.legs === 0 && out.pants.color === '#ffffff') out.pants = null; // and a baby's nappy
  // Elders go white: their hair whitens, or they get an elder's tufts.
  if (stage.name === 'elderly') {
    out.hair = out.hair ? { ...out.hair, color: '#f2f2f2', accent: 'none' }
      : { style: 'tufts', color: '#f2f2f2', texture: 'straight', part: 'left', accent: 'none', accentColor: '#f2f2f2', fade: false };
  }
  return { ...out, ...structuredClone(stage.wear) };
}
