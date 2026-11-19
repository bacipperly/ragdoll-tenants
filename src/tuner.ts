/*
 * On-screen tuning panel for the sandbox (not part of the ragdoll module).
 *
 * Sliders edit the live config values (src/ragdoll/config.ts), which the ragdoll reads
 * every physics step, so changes show immediately.
 *
 * Keeping settings:
 *   💾 Save to project   writes the changed values to src/ragdoll/tuning.json, which is
 *                        loaded on startup everywhere (sandbox and game). The reliable way.
 *   📋 Copy / 📥 Paste    the same values as text: to share in chat, or move between copies.
 *   ↶ Revert to saved    back to what tuning.json says.
 *   ↺ Reset to code      back to config.ts's own defaults (save to make it stick).
 */
import GUI from 'lil-gui';
import { MUSCLES } from './ragdoll/config';
import type { ActiveRagdoll } from './ragdoll';
import { FACE_LETTERS, LETTER_RANGE, MOOD_NAMES, MOODS, NEUTRAL, POSTURE_LETTERS, type Letter, type MoodName } from './ragdoll/mood';
import { TRAITS } from './ragdoll/config';
import { ageName, TRAIT_PRESETS } from './ragdoll/traits';
import { GESTURE_NAMES } from './ragdoll/gestures';
import {
  applyTuning, codeDefault, currentTuning, feelOnly, getSavedTuning, getTunable, isTunable, onSavedTuningChanged,
  setTunable, type Tuning,
} from './ragdoll/tuning';

/** One slider: which config value it edits (by path, as in tuning.json), and its range. */
interface Entry {
  /** e.g. "MUSCLES.shoulder.frequency"; the same name is used in tuning.json and copied text. */
  path: string;
  label: string;
  min: number;
  max: number;
  step: number;
}

/** Where the panel used to keep tweaks (per browser and port). Migrated once, then cleared. */
const OLD_STORAGE_KEY = 'ragdoll-tuning-v1';

function buildEntries(): Record<string, Entry[]> {
  const muscle = (joint: keyof typeof MUSCLES, label: string): Entry[] => {
    return [
      { path: `MUSCLES.${joint}.frequency`, label: `${label} speed`, min: 2, max: 60, step: 0.5 },
      { path: `MUSCLES.${joint}.dampingRatio`, label: `${label} damping`, min: 0.02, max: 1.5, step: 0.01 },
    ];
  };
  return {
    'Muscles': [
      ...muscle('shoulder', 'shoulder'),
      ...muscle('elbow', 'elbow'),
      ...muscle('spine', 'spine'),
      ...muscle('hip', 'hip'),
      ...muscle('knee', 'knee'),
      { path: 'MUSCLES.limpDamping', label: 'limp damping (KO)', min: 0, max: 0.3, step: 0.005 },
    ],
    'Proportions': [
      { path: 'PROPORTIONS.headSize', label: 'head size', min: 0.5, max: 1.8, step: 0.01 },
      { path: 'PROPORTIONS.headFloat', label: 'head float gap', min: 0, max: 4, step: 0.05 },
      { path: 'PROPORTIONS.bodyWidth', label: 'body width', min: 0.5, max: 1.8, step: 0.01 },
      { path: 'PROPORTIONS.bodyHeight', label: 'body height', min: 0.5, max: 1.8, step: 0.01 },
      { path: 'PROPORTIONS.legLength', label: 'leg length', min: 0.4, max: 2.5, step: 0.01 },
      { path: 'PROPORTIONS.legThickness', label: 'leg thickness', min: 0.5, max: 1.8, step: 0.01 },
      { path: 'PROPORTIONS.finLength', label: 'fin length', min: 0.4, max: 1.8, step: 0.01 },
      { path: 'PROPORTIONS.finWidth', label: 'fin width', min: 0.4, max: 2.2, step: 0.01 },
    ],
    'Silhouette': [
      { path: 'PROPORTIONS.shoulderWidth', label: 'shoulder width', min: 0.5, max: 2, step: 0.01 },
      { path: 'PROPORTIONS.hipWidth', label: 'hip width', min: 0.5, max: 2, step: 0.01 },
      { path: 'PROPORTIONS.waist', label: 'waist pinch', min: 0, max: 0.6, step: 0.01 },
      { path: 'PROPORTIONS.butt', label: 'butt', min: 0, max: 1.5, step: 0.01 },
    ],
    'Face': [
      { path: 'PROPORTIONS.eyeSize', label: 'eye size', min: 0.5, max: 1.8, step: 0.01 },
      { path: 'PROPORTIONS.eyeSpacing', label: 'eye spacing', min: 0.6, max: 1.5, step: 0.01 },
      { path: 'PROPORTIONS.eyeHeight', label: 'eye height', min: -0.3, max: 0.3, step: 0.005 },
      { path: 'PROPORTIONS.lashes', label: 'lashes', min: 0, max: 1, step: 0.01 },
      { path: 'PROPORTIONS.blush', label: 'blush', min: 0, max: 1, step: 0.01 },
      { path: 'PROPORTIONS.mouthWidth', label: 'mouth width', min: 0.5, max: 2, step: 0.01 },
    ],
    'Butt jiggle': [
      { path: 'BUTT.frequency', label: 'wobble speed (Hz)', min: 1.5, max: 10, step: 0.1 },
      { path: 'BUTT.dampingRatio', label: 'settle (low = bouncier)', min: 0.05, max: 1, step: 0.01 },
      { path: 'BUTT.travel', label: 'max wobble', min: 0, max: 0.8, step: 0.01 },
      { path: 'BUTT.walkBounce', label: 'walk bounce', min: 0, max: 0.8, step: 0.01 },
    ],
    'Face drawing': [
      { path: 'FACE.line', label: 'line thickness', min: 0.001, max: 0.006, step: 0.0002 },
      { path: 'FACE.mouthWidth', label: 'mouth width', min: 0.012, max: 0.045, step: 0.001 },
      { path: 'FACE.smileDepth', label: 'smile depth', min: 0, max: 0.03, step: 0.001 },
      { path: 'FACE.mouthOpen', label: 'open mouth drop', min: 0.01, max: 0.07, step: 0.001 },
      { path: 'FACE.glint', label: 'eye sparkle', min: 0, max: 0.6, step: 0.01 },
    ],
    'Carrying': [
      { path: 'CARRY.loadFeel', label: 'feels the weight (sag)', min: 0, max: 1, step: 0.01 },
      { path: 'CARRY.wobble', label: 'rocks under it (rad)', min: 0, max: 0.4, step: 0.005 },
      { path: 'CARRY.slowdown', label: 'slowed by the load', min: 0, max: 0.8, step: 0.01 },
    ],
    'Clumsiness': [
      { path: 'CLUMSY.amount', label: 'how clumsy (× all chances)', min: 0, max: 3, step: 0.05 },
      { path: 'CLUMSY.teeterSeconds', label: 'teeter time (s)', min: 0.15, max: 1.5, step: 0.05 },
      { path: 'CLUMSY.teeterLean', label: 'teeter lean (rad)', min: 0, max: 0.9, step: 0.01 },
      { path: 'CLUMSY.edgeSlip', label: 'slip off edges', min: 0, max: 1, step: 0.01 },
      { path: 'CLUMSY.edgeCooldown', label: 'after catching itself (s)', min: 0.3, max: 5, step: 0.1 },
      { path: 'CLUMSY.dropSafe', label: 'safe fall height', min: 0.2, max: 2, step: 0.05 },
      { path: 'CLUMSY.dropSure', label: 'sure-stumble fall height', min: 0.5, max: 4, step: 0.05 },
      { path: 'CLUMSY.landTrip', label: 'stumbles that trip over', min: 0, max: 1, step: 0.01 },
      { path: 'CLUMSY.tumbleSeconds', label: 'lie there (s)', min: 0.3, max: 4, step: 0.1 },
      { path: 'CLUMSY.bumpSafe', label: 'bump: gentle below (u/s)', min: 0, max: 4, step: 0.05 },
      { path: 'CLUMSY.bumpSure', label: 'bump: full-on at (u/s)', min: 1, max: 8, step: 0.05 },
      { path: 'CLUMSY.bumpTrip', label: 'bump: chance to knock over', min: 0, max: 1, step: 0.01 },
      { path: 'CLUMSY.bumpCooldown', label: 'bump: cooldown (s)', min: 0, max: 3, step: 0.05 },
    ],
    'Head': [
      { path: 'GOO.firmness', label: 'firmness', min: 5, max: 150, step: 1 },
      { path: 'GOO.viscosity', label: 'thickness (ooze)', min: 0.5, max: 30, step: 0.5 },
      { path: 'GOO.thickening', label: 'thickens when hit', min: 0, max: 150, step: 1 },
      { path: 'GOO.sag', label: 'sag', min: 0, max: 0.1, step: 0.001 },
      { path: 'GOO.slosh', label: 'slosh', min: 0, max: 0.12, step: 0.001 },
      { path: 'GOO.surfaceTension', label: 'surface tension', min: 0, max: 80, step: 1 },
      { path: 'GOO.keepVolume', label: 'keep volume', min: 0, max: 1, step: 0.01 },
      { path: 'GOO.friction', label: 'grip on surfaces', min: 0, max: 0.9, step: 0.01 },
      { path: 'GOO.maxStretch', label: 'max deform', min: 0.05, max: 0.7, step: 0.01 },
      { path: 'GOO.limpLoss', label: 'puddles when out cold', min: 0, max: 0.95, step: 0.01 },
      { path: 'GOO.limpSag', label: 'out-cold sag', min: 0, max: 8, step: 0.1 },
      ...muscle('neck', 'neck'),
    ],
    'Fins': [
      { path: 'GAIT.armSwing', label: 'swing', min: 0, max: 1.5, step: 0.01 },
      { path: 'GAIT.armOut', label: 'splay out', min: -0.2, max: 1.2, step: 0.01 },
      { path: 'GAIT.finCurl', label: 'elbow bend fwd', min: -0.25, max: 1.5, step: 0.01 },
      { path: 'GAIT.finFollow', label: 'follow-through', min: 0, max: 1.5, step: 0.01 },
      { path: 'GRAVITY_COMP.fins', label: 'gravity support', min: 0, max: 1, step: 0.01 },
    ],
    'Walk': [
      { path: 'GAIT.hipSwing', label: 'stride', min: 0, max: 1.4, step: 0.01 },
      { path: 'GAIT.kneeLift', label: 'knee lift', min: 0, max: 2, step: 0.01 },
      { path: 'GAIT.maxCycleHz', label: 'max steps/sec ÷2', min: 1, max: 6, step: 0.1 },
      { path: 'GAIT.bob', label: 'bounce', min: 0, max: 0.08, step: 0.001 },
      { path: 'GAIT.stepRoll', label: 'waddle', min: 0, max: 0.4, step: 0.005 },
      { path: 'GAIT.stepTwist', label: 'twist', min: 0, max: 0.5, step: 0.005 },
      { path: 'GAIT.chestCounterRoll', label: 'chest wiggle', min: 0, max: 2, step: 0.01 },
    ],
    'Jump': [
      { path: 'JUMP.velocity', label: 'jump power', min: 1, max: 7, step: 0.1 },
      { path: 'JUMP.crouchSeconds', label: 'crouch time (s)', min: 0, max: 0.4, step: 0.01 },
      { path: 'JUMP.crouchDepth', label: 'crouch depth', min: 0, max: 0.12, step: 0.002 },
      { path: 'JUMP.landSquash', label: 'landing squash', min: 0, max: 0.15, step: 0.002 },
      { path: 'JUMP.airControl', label: 'air steering', min: 0, max: 1, step: 0.01 },
      { path: 'JUMP.tuck', label: 'knee tuck', min: 0, max: 2, step: 0.01 },
      { path: 'JUMP.kneesUp', label: 'legs forward', min: -0.5, max: 1.2, step: 0.01 },
      { path: 'JUMP.finsUp', label: 'fins fling up', min: 0, max: 1.5, step: 0.01 },
    ],
    'Anger': [
      { path: 'EMOTION.shovesToAnger', label: 'shoves to anger', min: 1, max: 8, step: 1 },
      { path: 'EMOTION.annoyanceGraceSeconds', label: 'shove window (s)', min: 0.5, max: 10, step: 0.5 },
      { path: 'EMOTION.angrySeconds', label: 'angry for (s)', min: 1, max: 20, step: 0.5 },
      { path: 'EMOTION.flushAmount', label: 'red flush', min: 0, max: 1, step: 0.01 },
    ],
  };
}

/** Rounds away float noise from slider steps, so saved numbers are clean. */
const tidy = (v: number) => Math.round(v * 1e4) / 1e4;

/** Sorted JSON, so two tunings compare equal regardless of key order. */
const same = (a: Tuning, b: Tuning) =>
  JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

/**
 * Reads settings out of pasted text. Accepts what "Copy" produces
 * (`MUSCLES.shoulder.frequency = 12   // was 16`), tuning.json's own format, or a mix:
 * anything that looks like `PATH = number` or `"PATH": number` counts.
 */
function parseSettings(text: string): { tuning: Tuning; unknown: string[] } {
  const tuning: Tuning = {};
  const unknown: string[] = [];
  const re = /["']?([A-Z_]+(?:\.[A-Za-z]+){1,2})["']?\s*[=:]\s*(-?\d*\.?\d+(?:[eE][-+]?\d+)?)/g;
  for (const m of text.matchAll(re)) {
    if (isTunable(m[1])) tuning[m[1]] = Number(m[2]);
    else unknown.push(m[1]);
  }
  return { tuning, unknown };
}

/** A small box to paste text into. Resolves with the text, or null if cancelled. */
export function pasteBox(title = 'Paste settings (from <b>Copy settings</b>, or tuning.json):'): Promise<string | null> {
  return new Promise((done) => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:1000;font:13px system-ui,sans-serif';
    wrap.innerHTML = `
      <div style="background:#1f2329;color:#eceff1;padding:14px;border-radius:10px;width:min(520px,calc(100vw - 32px));box-shadow:0 10px 40px rgba(0,0,0,.4)">
        <div style="margin-bottom:8px">${title}</div>
        <textarea style="width:100%;height:180px;box-sizing:border-box;font:12px ui-monospace,monospace;background:#111418;color:#eceff1;border:1px solid #3a4048;border-radius:6px;padding:8px"></textarea>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px">
          <button data-act="cancel" style="padding:6px 12px">Cancel</button>
          <button data-act="apply" style="padding:6px 12px;font-weight:600">Apply</button>
        </div>
      </div>`;
    const area = wrap.querySelector('textarea')!;
    const close = (value: string | null) => { wrap.remove(); done(value); };
    wrap.addEventListener('click', (ev) => {
      const act = (ev.target as HTMLElement).dataset.act;
      if (act === 'apply') close(area.value);
      else if (act === 'cancel' || ev.target === wrap) close(null);
    });
    area.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') close(null); });
    document.body.appendChild(wrap);
    area.focus();
  });
}

/** What the panel needs from the sandbox: the current ragdoll (it's rebuilt when reshaped). */
export interface TunerHost {
  ragdoll(): ActiveRagdoll;
  /** Lets the sandbox add its own sections near the top of the panel. */
  addSections?(gui: GUI): void;
}

/**
 * The Traits section: age, weight and fitness, which each drive many other settings
 * (see traits.ts), with one-click starting points. Changing them rebuilds the ragdoll.
 */
function addTraitsSection(gui: GUI, refresh: () => void): void {
  const folder = gui.addFolder('Traits');
  const t = TRAITS as Record<string, number>;
  const age = folder.add(t, 'age', 0, 1, 0.01);
  const nameAge = () => age.name(`age: ${ageName(t.age)}`);
  age.onChange(() => { nameAge(); refresh(); });
  nameAge();
  folder.add(t, 'weight', -1, 1, 0.01).name('weight: slim ↔ heavy').onChange(refresh);
  folder.add(t, 'fitness', -1, 1, 0.01).name('fitness: soft ↔ athletic').onChange(refresh);
  const presets = folder.addFolder('Presets');
  for (const [name, values] of Object.entries(TRAIT_PRESETS)) {
    presets.add({ go: () => { Object.assign(t, values); nameAge(); refresh(); } }, 'go').name(name);
  }
}

/**
 * The Mood section: pick a mood and its strength, and spell your own "custom" mood
 * letter by letter (those letters are saved like any other setting).
 */
function addMoodSection(gui: GUI, host: TunerHost, refresh: () => void, onChange: () => void): void {
  const folder = gui.addFolder('Mood');
  const state = {
    mood: host.ragdoll().mood as MoodName,
    strength: 1,
    copyToCustom: () => {
      const from = MOODS[state.mood] as Partial<Record<Letter, number>>;
      const custom = MOODS.custom as Record<Letter, number>;
      for (const l of [...POSTURE_LETTERS, ...FACE_LETTERS]) custom[l] = from[l] ?? NEUTRAL[l];
      state.mood = 'custom';
      host.ragdoll().setMood('custom', state.strength);
      refresh();
      onChange();
    },
  };
  const apply = () => host.ragdoll().setMood(state.mood, state.strength);
  folder.add(state, 'mood', MOOD_NAMES).name('mood (M key cycles)').onChange(apply).listen();
  folder.add(state, 'strength', 0, 1, 0.01).name('strength').onChange(apply);
  folder.add(state, 'copyToCustom').name('✎ Start custom from this mood');

  // The letters of the custom mood. Pick "custom" above to see them.
  const custom = MOODS.custom as Record<Letter, number>;
  for (const [title, letters] of [['Custom: body letters', POSTURE_LETTERS], ['Custom: face letters', FACE_LETTERS]] as const) {
    const sub = folder.addFolder(title);
    for (const l of letters) {
      const [lo, hi] = LETTER_RANGE[l];
      sub.add(custom, l, lo, hi, 0.01).name(l).onChange(onChange);
    }
    sub.close();
  }
  // Keep the dropdown in step when the mood changes elsewhere (the M key).
  setInterval(() => { state.mood = host.ragdoll().mood; }, 250);
}

export function createTuner(host: TunerHost): GUI {
  const sections = buildEntries();
  const gui = new GUI({ title: 'Tuning' });
  gui.domElement.style.setProperty('--width', '310px');

  const status = { text: '' };
  const say = (text: string) => { status.text = text; statusCtrl.updateDisplay(); };
  /** Refresh every slider, and mark the title when there are changes not saved to the project. */
  const refresh = () => {
    gui.controllersRecursive().forEach((c) => c.updateDisplay());
    // Compare only settings that still exist (old ones left in tuning.json don't count).
    const saved = Object.fromEntries(Object.entries(feelOnly(getSavedTuning())).filter(([p]) => isTunable(p)));
    gui.title(same(currentTuning(), saved) ? 'Tuning' : 'Tuning • unsaved changes');
  };

  const actions = {
    save: async () => {
      const tuning = currentTuning();
      try {
        const res = await fetch('/__ragdoll/tuning', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(tuning),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        try { localStorage.removeItem(OLD_STORAGE_KEY); } catch { /* fine */ }
        say(`Saved ${Object.keys(tuning).length} setting(s) to src/ragdoll/tuning.json`);
        // The dev server reloads tuning.json and onSavedTuningChanged refreshes the title.
      } catch (err) {
        say(`Couldn't save (${String(err)}): is this the dev server? Use Copy instead.`);
      }
    },
    copy: async () => {
      const tuning = currentTuning();
      const lines = Object.entries(tuning).map(([p, v]) => `${p} = ${v}   // was ${tidy(codeDefault(p) ?? NaN)}`);
      const text = lines.length
        ? `Ragdoll tuning (changed from config.ts):\n${lines.join('\n')}`
        : 'Ragdoll tuning: nothing changed from config.ts.';
      try {
        await navigator.clipboard.writeText(text);
        say(`Copied ${lines.length} setting(s)`);
      } catch {
        window.prompt('Copy these settings:', text.replace(/\n/g, '  |  '));
        say('Shown in a box to copy by hand');
      }
    },
    paste: async () => {
      const text = await pasteBox();
      if (text === null) return;
      const { tuning, unknown } = parseSettings(text);
      if (!Object.keys(tuning).length) { say('Found no settings in that text'); return; }
      applyTuning(tuning, true); // config.ts defaults + exactly what was pasted (the look is the character's)
      refresh();
      say(`Applied ${Object.keys(tuning).length} setting(s)${unknown.length ? `, skipped ${unknown.length} unknown` : ''}: Save to keep`);
      if (unknown.length) console.warn('[tuner] unknown settings skipped:', unknown);
    },
    revert: () => {
      applyTuning(getSavedTuning(), true);
      refresh();
      say('Back to the saved settings');
    },
    reset: () => {
      applyTuning({}, true);
      refresh();
      say('Back to config.ts defaults: Save to make it stick');
    },
  };

  gui.add(actions, 'save').name('💾 Save to project');
  gui.add(actions, 'copy').name('📋 Copy settings');
  gui.add(actions, 'paste').name('📥 Paste settings');
  gui.add(actions, 'revert').name('↶ Revert to saved');
  gui.add(actions, 'reset').name('↺ Reset to code defaults');
  const statusCtrl = gui.add(status, 'text').name('').disable();

  host.addSections?.(gui);
  addTraitsSection(gui, refresh);
  addMoodSection(gui, host, refresh, refresh);
  // Reactions: one button per gesture (number keys play the common ones).
  const reactions = gui.addFolder('Reactions');
  for (const name of GESTURE_NAMES) reactions.add({ play: () => host.ragdoll().playGesture(name) }, 'play').name(name);

  for (const [name, entries] of Object.entries(sections)) {
    const folder = gui.addFolder(name);
    for (const en of entries) {
      // A tiny proxy so the slider reads and writes the live config value by path.
      const proxy = { get v() { return getTunable(en.path); }, set v(x: number) { setTunable(en.path, x); } };
      folder.add(proxy, 'v', en.min, en.max, en.step).name(en.label).onChange(refresh);
    }
    if (!['Proportions', 'Silhouette', 'Face'].includes(name)) folder.close();
  }

  // Tweaks the old panel kept in this browser: bring them back as unsaved changes, so
  // nothing in progress is lost. Saving to the project then clears them.
  try {
    const old = JSON.parse(localStorage.getItem(OLD_STORAGE_KEY) ?? 'null') as Tuning | null;
    if (old && Object.keys(old).length) {
      for (const [p, v] of Object.entries(old)) if (isTunable(p) && typeof v === 'number') setTunable(p, v);
      status.text = 'Restored unsaved tweaks from this browser: Save to keep them';
    }
  } catch { /* no storage */ }

  onSavedTuningChanged(refresh);
  refresh();
  return gui;
}
