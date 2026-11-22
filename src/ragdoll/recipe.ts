/*
 * Character recipes: everything that makes one tenant look like itself, as plain data.
 *
 *   { version, name, color, mood, traits: { age, weight, fitness },
 *     proportions: { headSize, ..., lashes, blush, mouthWidth }, outfit: { shirt, pants, ... } }
 *
 * The game keeps one per tenant (save it with the tenant; it's small JSON) and passes it
 * when it creates a body. Everything else, how the body MOVES (muscles, gait, moods,
 * goo...), is shared by all tenants and lives in config.ts + tuning.json.
 *
 * Recipes are read defensively: unknown keys are dropped, numbers are clamped to sane
 * ranges, and anything missing falls back to the default look, so an old or hand-edited
 * recipe can't break a body.
 */
import { PROPORTIONS, TRAITS } from './config';
import { MOOD_NAMES, type MoodName } from './mood';
import { NO_OUTFIT, parseOutfit, randomOutfit, type Outfit } from './outfit';

export type Traits = { age: number; weight: number; fitness: number };
export type Proportions = { [K in keyof typeof PROPORTIONS]: number };

export interface Recipe {
  version: 1;
  name: string;
  /** Body colour, '#rrggbb'. */
  color: string;
  /** The mood it's in when it appears. */
  mood: MoodName;
  traits: Traits;
  proportions: Proportions;
  /** What it wears (see outfit.ts). */
  outfit: Outfit;
}

/** Every tenant's default body colour (the design spec's "Simpson yellow"). */
export const TENANT_YELLOW = '#ffcb00';

/** Sensible limits for every number in a recipe (the sandbox sliders use the same). */
export const RECIPE_LIMITS: Record<string, [number, number]> = {
  age: [0, 1], weight: [-1, 1], fitness: [-1, 1],
  headSize: [0.5, 1.8], headFloat: [0, 4], bodyWidth: [0.5, 1.8], bodyHeight: [0.3, 1.8],
  legLength: [0.4, 2.5], legThickness: [0.5, 1.8], finLength: [0.3, 1.8], finWidth: [0.4, 2.2],
  shoulderWidth: [0.5, 2], hipWidth: [0.5, 2], waist: [0, 0.6], butt: [0, 1.5],
  eyeSize: [0.5, 1.8], eyeSpacing: [0.6, 1.5], eyeHeight: [-0.3, 0.3], lashes: [0, 1], blush: [0, 1], mouthWidth: [0.5, 2],
};

const clamp = (key: string, v: number) => {
  const [lo, hi] = RECIPE_LIMITS[key] ?? [-Infinity, Infinity];
  return Math.min(hi, Math.max(lo, v));
};

/** The look the sandbox's sliders are editing right now (TRAITS + PROPORTIONS), as a recipe. */
export function recipeFromEditor(name: string, color: string, mood: MoodName, outfit: Outfit = NO_OUTFIT): Recipe {
  return {
    version: 1, name, color, mood,
    traits: { ...TRAITS },
    proportions: { ...PROPORTIONS },
    outfit: structuredClone(outfit),
  };
}

/** Puts a recipe's look into TRAITS + PROPORTIONS (what the sandbox's sliders edit). */
export function loadIntoEditor(r: Recipe): void {
  Object.assign(TRAITS, r.traits);
  Object.assign(PROPORTIONS, r.proportions);
}

/**
 * Reads a recipe from anything (parsed JSON, a pasted object), keeping only what it
 * understands. Returns null if it isn't recognisably a recipe at all.
 * @param fallback the look to fill gaps from (defaults to the current editor look)
 */
export function parseRecipe(data: unknown, fallback?: Recipe): Recipe | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const base = fallback ?? recipeFromEditor('Tenant', TENANT_YELLOW, 'calm');
  const nums = <T extends Record<string, number>>(src: unknown, into: T): T => {
    const out = { ...into };
    if (src && typeof src === 'object') {
      for (const k of Object.keys(into)) {
        const v = (src as Record<string, unknown>)[k];
        if (typeof v === 'number' && Number.isFinite(v)) (out as Record<string, number>)[k] = clamp(k, v);
      }
    }
    return out;
  };
  if (!('traits' in d) && !('proportions' in d)) return null;
  return {
    version: 1,
    name: typeof d.name === 'string' && d.name.trim() ? d.name.trim().slice(0, 40) : base.name,
    color: typeof d.color === 'string' && /^#[0-9a-f]{6}$/i.test(d.color) ? d.color.toLowerCase() : base.color,
    mood: typeof d.mood === 'string' && (MOOD_NAMES as string[]).includes(d.mood) ? (d.mood as MoodName) : base.mood,
    traits: nums(d.traits, base.traits),
    proportions: nums(d.proportions, base.proportions),
    // Older recipes have no outfit: they wear nothing, as before.
    outfit: parseOutfit(d.outfit),
  };
}

/** A same-look check (ignores name, colour and mood). */
export function sameLook(a: Recipe, b: Recipe): boolean {
  return JSON.stringify([a.traits, a.proportions]) === JSON.stringify([b.traits, b.proportions]);
}

// ---------------------------------------------------------------- random tenants

const NAMES = [
  'Pip', 'Mo', 'Bun', 'Tuck', 'Lulu', 'Ozzie', 'Fig', 'Nell', 'Bo', 'Juniper', 'Wren', 'Biscuit', 'Moss',
  'Poppy', 'Gus', 'Tilly', 'Rufus', 'Sprout', 'Mabel', 'Otto', 'Dot', 'Basil', 'Clover', 'Hank',
];

/**
 * A random tenant around a base look: mostly adults with some kids, babies and
 * seniors; a spread of builds; small nudges to the shape and face; a few with lashes
 * or blush; a cheerful colour; usually calm. `rand` can be seeded for repeatable crowds.
 */
export function randomRecipe(base: Recipe, rand: () => number = Math.random): Recipe {
  const r = rand;
  const between = (a: number, b: number) => a + (b - a) * r();
  const near = (v: number, spread: number) => v * (1 + (r() * 2 - 1) * spread);
  const bell = () => (r() + r() + r()) / 1.5 - 1; // roughly −1..1, most near 0
  const roll = r();
  const age = roll < 0.08 ? between(0, 0.1) : roll < 0.22 ? between(0.18, 0.35) : roll < 0.85 ? between(0.4, 0.7) : between(0.8, 1);
  const P = base.proportions;
  const proportions: Proportions = {
    ...P,
    headSize: near(P.headSize, 0.1), bodyWidth: near(P.bodyWidth, 0.1), bodyHeight: near(P.bodyHeight, 0.1),
    legLength: near(P.legLength, 0.15), legThickness: near(P.legThickness, 0.1),
    finLength: near(P.finLength, 0.12), finWidth: near(P.finWidth, 0.15),
    shoulderWidth: near(P.shoulderWidth, 0.15), hipWidth: near(P.hipWidth, 0.15),
    waist: Math.max(0, P.waist + between(-0.05, 0.2) * (r() < 0.4 ? 1 : 0)),
    butt: Math.max(0, P.butt + between(-0.25, 0.35)),
    eyeSize: near(P.eyeSize, 0.15), eyeSpacing: near(P.eyeSpacing, 0.08), eyeHeight: P.eyeHeight + between(-0.05, 0.05),
    lashes: r() < 0.3 ? between(0.4, 0.9) : 0,
    blush: r() < 0.35 ? between(0.3, 0.8) : 0,
    mouthWidth: near(P.mouthWidth, 0.15),
  };
  for (const k of Object.keys(proportions) as (keyof Proportions)[]) proportions[k] = Math.round(clamp(k, proportions[k]) * 1000) / 1000;
  // Everyone is yellow by default (the design spec); colour is a customization, not chance.
  const color = TENANT_YELLOW;
  const moods: MoodName[] = ['calm', 'calm', 'calm', 'calm', 'proud', 'shy', 'excited', 'tired', 'curious', 'sulking', 'nervous', 'sad'];
  const round = (v: number) => Math.round(v * 100) / 100;
  return {
    version: 1,
    name: NAMES[Math.floor(r() * NAMES.length)],
    color,
    mood: moods[Math.floor(r() * moods.length)],
    traits: { age: round(age), weight: round(Math.max(-1, Math.min(1, bell() * 0.7))), fitness: round(Math.max(-1, Math.min(1, bell() * 0.7))) },
    proportions,
    outfit: randomOutfit(r),
  };
}
