/*
 * Tuned values, layered over the defaults in config.ts.
 *
 * tuning.json holds only the values that differ from config.ts, keyed by path, e.g.
 *   { "MUSCLES.shoulder.frequency": 12, "GAIT.armSwing": 0.4 }
 * It's applied once when the module loads, so the game gets the tuned feel too. The
 * sandbox's tuning panel writes it with "Save to project"; it can also be edited by hand.
 *
 * Only plain numbers in the objects below can be tuned. Anything else in the file is
 * ignored with a console warning, so a typo can't break the ragdoll.
 */
import { BUTT, CLUMSY, EMOTION, GAIT, GOO, GRAVITY_COMP, JUMP, MUSCLES, PROPORTIONS, TRAITS } from './config';
import { MOODS } from './mood';
import saved from './tuning.json';

export type Tuning = Record<string, number>;

type Num = Record<string, unknown>;
const ROOTS: Record<string, Num> = {
  BUTT,
  CLUMSY,
  MUSCLES: MUSCLES as unknown as Num,
  GAIT: GAIT as unknown as Num,
  EMOTION: EMOTION as unknown as Num,
  JUMP: JUMP as unknown as Num,
  GOO: GOO as unknown as Num,
  PROPORTIONS: PROPORTIONS as unknown as Num,
  MOODS: MOODS as unknown as Num,
  TRAITS: TRAITS as unknown as Num,
};

/** The fins' gravity support is four config values (both segments, both sides) tuned as one. */
const FIN_PARTS = ['upperArmL', 'upperArmR', 'forearmL', 'forearmR'];
const FINS_PATH = 'GRAVITY_COMP.fins';

/** Finds the object and key a path points at, if it's a tunable number. */
function resolve(path: string): { obj: Num; key: string } | null {
  const parts = path.split('.');
  let obj: unknown = ROOTS[parts[0]];
  for (let i = 1; i < parts.length - 1; i++) obj = (obj as Num | undefined)?.[parts[i]];
  const key = parts[parts.length - 1];
  if (!obj || typeof obj !== 'object' || typeof (obj as Num)[key] !== 'number') return null;
  return { obj: obj as Num, key };
}

export function isTunable(path: string): boolean {
  return path === FINS_PATH || resolve(path) !== null;
}

export function getTunable(path: string): number {
  if (path === FINS_PATH) return GRAVITY_COMP.upperArmL ?? 0;
  const r = resolve(path);
  return r ? (r.obj[r.key] as number) : NaN;
}

export function setTunable(path: string, value: number): void {
  if (!Number.isFinite(value)) return;
  if (path === FINS_PATH) { for (const k of FIN_PARTS) GRAVITY_COMP[k] = value; return; }
  const r = resolve(path);
  if (r) r.obj[r.key] = value;
}

/** Every tunable path with its value in config.ts, captured before any tuning is applied. */
const codeDefaults = new Map<string, number>();
function snapshot(): void {
  const walk = (prefix: string, obj: Num) => {
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'number') codeDefaults.set(`${prefix}.${k}`, v);
      else if (v && typeof v === 'object') walk(`${prefix}.${k}`, v as Num);
    }
  };
  for (const [name, obj] of Object.entries(ROOTS)) walk(name, obj);
  codeDefaults.set(FINS_PATH, getTunable(FINS_PATH));
}
snapshot();

export function codeDefault(path: string): number | undefined {
  return codeDefaults.get(path);
}

/** What tuning.json currently says (the last saved tuning). */
let savedTuning: Tuning = {};
export function getSavedTuning(): Tuning { return { ...savedTuning }; }

/**
 * Look (PROPORTIONS, TRAITS) vs feel (everything else). A tenant's look lives in its
 * recipe (recipe.ts), so tuning.json only keeps the feel; look entries already in an
 * older tuning.json are still read at startup, so nothing changes for it.
 */
export const isLookPath = (path: string) => path.startsWith('PROPORTIONS.') || path.startsWith('TRAITS.');

/** Just the feel part of a tuning. */
export function feelOnly(t: Tuning): Tuning {
  return Object.fromEntries(Object.entries(t).filter(([p]) => !isLookPath(p)));
}

/**
 * Puts every tunable back to config.ts, then applies `tuning` on top. Returns paths it
 * didn't recognise. With `keepLook`, the current look (PROPORTIONS, TRAITS) is left as it is.
 */
export function applyTuning(tuning: Tuning, keepLook = false): string[] {
  for (const [path, v] of codeDefaults) if (!(keepLook && isLookPath(path))) setTunable(path, v);
  const unknown: string[] = [];
  for (const [path, v] of Object.entries(tuning)) {
    if (path.startsWith('_')) continue; // room for notes, e.g. "_comment"
    if (typeof v !== 'number' || !isTunable(path)) { unknown.push(path); continue; }
    if (keepLook && isLookPath(path)) continue;
    setTunable(path, v);
  }
  return unknown;
}

/** The current feel values that differ from config.ts: what "Save" writes. */
export function currentTuning(): Tuning {
  const out: Tuning = {};
  for (const [path, def] of codeDefaults) {
    if (isLookPath(path)) continue;
    const v = getTunable(path);
    if (Math.abs(v - def) > 1e-9) out[path] = Math.round(v * 1e4) / 1e4;
  }
  return out;
}

const listeners = new Set<() => void>();
/** Called when tuning.json changes on disk (after a save, or a hand edit) and has been applied. */
export function onSavedTuningChanged(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function loadSaved(data: unknown, keepLook: boolean): void {
  savedTuning = data && typeof data === 'object' ? { ...(data as Tuning) } : {};
  const unknown = applyTuning(savedTuning, keepLook);
  if (unknown.length) console.warn('[ragdoll] tuning.json: ignored unknown or non-number entries:', unknown);
}
loadSaved(saved, false);

// In the dev server, pick up changes to tuning.json without reloading the page.
if (import.meta.hot) {
  import.meta.hot.accept('./tuning.json', (mod) => {
    if (!mod) return;
    // Saving the feel mustn't reshape whoever's on screen.
    loadSaved((mod as unknown as { default: unknown }).default, true);
    for (const cb of listeners) cb();
  });
}
