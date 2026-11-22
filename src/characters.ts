/*
 * Sandbox: characters and the crowd (not part of the ragdoll module).
 *
 * - The CROWD: every tenant on screen, each built from its own recipe. One is selected:
 *   WASD drives it, the camera follows it, and the tuning panel's look sliders (Traits,
 *   Proportions, Silhouette, Face) edit it. Click any tenant to select it. The others
 *   wander about on their own, now and then waving, sighing or changing mood.
 * - The LIBRARY: named recipes in characters.json at the project root, saved through the
 *   dev server. One can be the default, which is who you start as.
 */
import * as THREE from 'three';
import type GUI from 'lil-gui';
import type { ActiveRagdoll, RagdollPhysics, Recipe } from './ragdoll';
import { GLASSES_STYLES, HAT_STYLES, SHIRT_PATTERNS, NO_OUTFIT, TATTOO_SHAPES, TATTOO_SPOTS, loadIntoEditor, parseRecipe, randomOutfit, randomRecipe, recipeFromEditor, type GlassesStyle, type HatStyle, type Outfit, type ShirtPattern } from './ragdoll';
import { GESTURE_NAMES, type GestureName } from './ragdoll/gestures';
import { HAIR_ACCENTS, HAIR_COLORS, HAIR_PARTS, HAIR_STYLES, HAIR_TEXTURES, type HairAccent, type HairPart, type HairStyle, type HairTexture } from './ragdoll/hair';
import { MOOD_NAMES } from './ragdoll/mood';
import { pasteBox } from './tuner';

/** Where a wandering tenant is heading, and how long it's pausing or has been trying. */
interface Wander { target: THREE.Vector3; wait: number; tried: number; stroll: boolean }

export class Crowd {
  readonly tenants: ActiveRagdoll[] = [];
  selected: ActiveRagdoll;
  private readonly wander = new Map<ActiveRagdoll, Wander>();
  private readonly ring: THREE.Mesh;
  private readonly tmp = new THREE.Vector3();
  private readonly raycaster = new THREE.Raycaster();
  /** Called whenever the selected tenant changes (or is rebuilt). */
  onSelect: (r: ActiveRagdoll) => void = () => {};

  constructor(private readonly physics: RagdollPhysics, private readonly scene: THREE.Scene, first: ActiveRagdoll) {
    this.tenants.push(first);
    this.selected = first;
    // A soft ring on the floor under whoever's selected.
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.85, 1, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.7, depthWrite: false }),
    );
    this.ring.renderOrder = 5;
    scene.add(this.ring);
  }

  /** Adds a tenant built from `recipe` where its feet should be. */
  add(recipe: Recipe, position: THREE.Vector3, facing = Math.random() * Math.PI * 2): ActiveRagdoll {
    const r = this.physics.createRagdoll({ recipe, position, facing });
    this.scene.add(r.group);
    this.tenants.push(r);
    return r;
  }

  /** Rebuilds a tenant from a new recipe where it stands (keeping selection, mood and skeleton view). */
  replace(old: ActiveRagdoll, recipe: Recipe, keepMood = true): ActiveRagdoll {
    const s = old.debugState();
    old.middle(this.tmp);
    this.tmp.y = s.groundY;
    const next = this.physics.createRagdoll({ recipe, position: this.tmp.clone(), facing: s.facing });
    if (keepMood) next.setMood(old.mood);
    next.setShowSkeleton(old.showingSkeleton);
    this.scene.add(next.group);
    this.tenants[this.tenants.indexOf(old)] = next;
    this.wander.delete(old);
    this.physics.removeRagdoll(old);
    if (old === this.selected) this.select(next);
    return next;
  }

  /** Everyone but the selected tenant leaves. */
  clearOthers(): void {
    for (const r of [...this.tenants]) {
      if (r === this.selected) continue;
      this.physics.removeRagdoll(r);
      this.wander.delete(r);
    }
    this.tenants.length = 0;
    this.tenants.push(this.selected);
  }

  select(r: ActiveRagdoll): void {
    if (this.selected !== r) this.selected.setMoveInput(0, 0);
    this.selected = r;
    this.wander.delete(r);
    this.onSelect(r);
  }

  /** The tenant under a screen point (normalised device coords), if any. */
  pick(ndc: THREE.Vector2, camera: THREE.Camera): ActiveRagdoll | null {
    this.raycaster.setFromCamera(ndc, camera);
    let best: ActiveRagdoll | null = null, bestDist = Infinity;
    for (const r of this.tenants) {
      const hit = this.raycaster.intersectObjects(r.hitMeshes, false)[0];
      if (hit && hit.distance < bestDist) { best = r; bestDist = hit.distance; }
    }
    return best;
  }

  /** Steers the wanderers and moves the selection ring. Call once per frame. */
  update(dt: number): void {
    for (const r of this.tenants) {
      if (r === this.selected || r.isKnockedOut) continue;
      let w = this.wander.get(r);
      if (!w) { w = { target: randomSpot(), wait: Math.random() * 2, tried: 0, stroll: Math.random() < 0.85 }; this.wander.set(r, w); }
      r.middle(this.tmp);
      if (w.wait > 0) {
        w.wait -= dt;
        r.setMoveInput(0, 0);
        continue;
      }
      const dx = w.target.x - this.tmp.x, dz = w.target.z - this.tmp.z;
      const dist = Math.hypot(dx, dz);
      w.tried += dt;
      if (dist < 0.35 || w.tried > 8) {
        // Arrived (or stuck behind something): pause, maybe do something, pick a new spot.
        w.target = randomSpot();
        w.wait = 1 + Math.random() * 3;
        w.tried = 0;
        w.stroll = Math.random() < 0.85; // mostly walking; running now and then (with speed lines)
        const roll = Math.random();
        if (roll < 0.25) r.playGesture(IDLE_GESTURES[Math.floor(Math.random() * IDLE_GESTURES.length)]);
        else if (roll < 0.33) r.setMood(MOOD_NAMES[Math.floor(Math.random() * (MOOD_NAMES.length - 1))]);
        r.setMoveInput(0, 0);
        continue;
      }
      r.setMoveInput(dx / dist, dz / dist, w.stroll);
    }
    // The ring sits on the floor under the selected tenant, sized to it.
    const s = this.selected;
    s.middle(this.tmp);
    this.ring.position.set(this.tmp.x, s.debugState().groundY + 0.006, this.tmp.z);
    this.ring.scale.setScalar(Math.max(0.18, s.dims.bellyR * 2.6));
  }
}

const IDLE_GESTURES: GestureName[] = GESTURE_NAMES.filter((g) => !['flinch', 'startle', 'stomp', 'slump'].includes(g));

function randomSpot(): THREE.Vector3 {
  const a = Math.random() * Math.PI * 2, d = 1 + Math.random() * 6;
  return new THREE.Vector3(Math.cos(a) * d, 0, Math.sin(a) * d);
}

// ---------------------------------------------------------------- the library

export interface Library { default?: string; characters: Recipe[] }

export async function loadLibrary(): Promise<Library> {
  try {
    // The dev server's live library; on a static copy of the site (no dev server), the
    // characters.json shipped next to the page instead, read-only.
    let res = await fetch('/__ragdoll/characters').catch(() => null);
    if (!res?.ok || !(res.headers.get('content-type') ?? '').includes('json')) res = await fetch('./characters.json');
    const data = (await res.json()) as { default?: unknown; characters?: unknown[] };
    const characters = (data.characters ?? []).map((c) => parseRecipe(c)).filter((c): c is Recipe => c !== null);
    return { default: typeof data.default === 'string' ? data.default : undefined, characters };
  } catch {
    return { characters: [] };
  }
}

export async function saveLibrary(lib: Library): Promise<boolean> {
  try {
    const res = await fetch('/__ragdoll/characters', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(lib),
    });
    // A static host may answer a POST with an HTML page; only the dev server's JSON counts.
    return res.ok && (res.headers.get('content-type') ?? '').includes('json');
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- the panel

/**
 * The Characters section: name and colour, the library (save, load, delete, default),
 * random tenants, copy/paste a recipe as text, and filling the room with a crowd.
 * @param refreshLook call after the editor's look changes, to update the sliders
 */
export function addCharactersSection(gui: GUI, crowd: Crowd, lib: Library, refreshLook: () => void): () => void {
  const folder = gui.addFolder('Characters');
  const state = {
    name: crowd.selected.recipe.name,
    color: crowd.selected.recipe.color,
    pick: lib.characters[0]?.name ?? '',
    status: '',
  };
  const say = (t: string) => { state.status = t; statusCtrl.updateDisplay(); };
  const current = (): Recipe => recipeFromEditor(state.name, state.color, crowd.selected.mood, crowd.selected.recipe.outfit);
  /** Rebuild the selected tenant as `recipe` and put its look in the sliders. */
  const become = (recipe: Recipe) => {
    loadIntoEditor(recipe);
    state.name = recipe.name;
    state.color = recipe.color;
    crowd.replace(crowd.selected, recipe, false);
    refreshLook();
    syncFromSelected();
  };
  const save = async (msg: string) => say((await saveLibrary(lib)) ? msg : "Couldn't save: is this the dev server?");
  let pickCtrl = folder.add(state, 'pick', lib.characters.map((c) => c.name)).name('library');
  const refreshPick = () => {
    const names = lib.characters.map((c) => c.name);
    if (!names.includes(state.pick)) state.pick = names[0] ?? '';
    pickCtrl = pickCtrl.options(names).name('library');
  };

  folder.add(state, 'name').name('name').onFinishChange(() => { crowd.selected.recipe.name = state.name; });
  folder.addColor(state, 'color').name('colour').onChange(() => crowd.selected.setColor(state.color));
  const actions = {
    save: async () => {
      const r = current();
      const i = lib.characters.findIndex((c) => c.name === r.name);
      if (i >= 0) lib.characters[i] = r; else lib.characters.push(r);
      state.pick = r.name;
      refreshPick();
      await save(`Saved "${r.name}" to characters.json`);
    },
    makeDefault: async () => {
      const r = current();
      if (!lib.characters.some((c) => c.name === r.name)) lib.characters.push(r);
      lib.default = r.name;
      refreshPick();
      await save(`"${r.name}" is who you start as`);
    },
    load: () => {
      const r = lib.characters.find((c) => c.name === state.pick);
      if (r) { become(structuredClone(r)); say(`Loaded "${r.name}"`); }
    },
    remove: async () => {
      lib.characters = lib.characters.filter((c) => c.name !== state.pick);
      if (lib.default === state.pick) lib.default = undefined;
      refreshPick();
      await save('Deleted from the library');
    },
    randomize: () => { become(randomRecipe(current())); say('A new random look: Save to keep it'); },
    copy: async () => {
      const text = JSON.stringify(current(), null, 2);
      try { await navigator.clipboard.writeText(text); say('Recipe copied'); } catch { window.prompt('Copy this recipe:', text.replace(/\n\s*/g, ' ')); }
    },
    paste: async () => {
      const text = await pasteBox('Paste a character recipe (from Copy recipe, or characters.json):');
      if (text === null) return;
      let data: unknown = null;
      try { data = JSON.parse(text); } catch { /* handled below */ }
      const r = parseRecipe(data, current());
      if (!r) { say("That doesn't look like a recipe"); return; }
      become(r);
      say(`Pasted "${r.name}": Save to keep it`);
    },
    crowdRandom: () => {
      const base = current();
      for (let i = 0; i < 12; i++) crowd.add(randomRecipe(base), spawnSpot(i));
      say(`${crowd.tenants.length} tenants`);
    },
    crowdLibrary: () => {
      lib.characters.forEach((r, i) => crowd.add(structuredClone(r), spawnSpot(i)));
      say(`${crowd.tenants.length} tenants`);
    },
    clear: () => { crowd.clearOthers(); say('Just you now'); },
  };
  folder.add(actions, 'load').name('↳ Load the one picked above');
  folder.add(actions, 'save').name('💾 Save to library');
  folder.add(actions, 'makeDefault').name('⭐ Make this who I start as');
  folder.add(actions, 'remove').name('🗑 Delete the one picked above');
  folder.add(actions, 'randomize').name('🎲 Random look');
  folder.add(actions, 'copy').name('📋 Copy recipe');
  folder.add(actions, 'paste').name('📥 Paste recipe');
  folder.add(actions, 'crowdRandom').name('👥 Add 12 random tenants');
  folder.add(actions, 'crowdLibrary').name('👥 Add everyone in the library');
  folder.add(actions, 'clear').name('✕ Remove the others');
  const statusCtrl = folder.add(state, 'status').name('').disable();
  const syncOutfit = addOutfitFolder(folder, crowd);

  // Keep the name, colour and outfit fields in step with whoever's selected.
  const syncFromSelected = () => {
    state.name = crowd.selected.recipe.name;
    state.color = crowd.selected.recipe.color;
    syncOutfit();
    folder.controllersRecursive().forEach((c) => c.updateDisplay());
  };
  return syncFromSelected;
}

/**
 * The Outfit folder: each garment on or off, its colour and its shape, worn by the
 * selected tenant on the spot (Save to library keeps it with the character).
 */
function addOutfitFolder(parent: GUI, crowd: Crowd): () => void {
  const f = parent.addFolder('Outfit');
  // Every garment's settings stay here while it's off, so switching it back on restores them.
  const w = {
    shirt: false, shirtColor: '#ffffff', shirtLength: 0.6, sleeves: 0.3, pattern: 'plain' as ShirtPattern, patternColor: '#2b2d42',
    hoodie: false, hoodieColor: '#8d99ae', hoodUp: false, pocket: true,
    skirt: false, skirtColor: '#e63946', skirtLength: 0.4, flare: 0.5, pleats: false,
    pants: false, pantsColor: '#3d5a80', rise: 0.4, legs: 0.8,
    socks: false, socksColor: '#ffffff', socksHeight: 0.3,
    shoes: false, shoesColor: '#333333', shoesHeight: 0.2,
    gloves: false, glovesColor: '#ffffff', glovesLength: 0.3,
    hat: false, hatStyle: 'beanie' as HatStyle, hatColor: '#e63946', backwards: false,
    glasses: false, glassesStyle: 'round' as GlassesStyle, glassesColor: '#2b2d42',
    bow: false, bowColor: '#e63946', headphones: false, headphonesColor: '#9b5de5',
    pacifier: false, pacifierColor: '#8ecae6',
    whiskers: false, whiskersColor: '#f4f4f4', mustache: true, brows: true,
    backpack: false, backpackColor: '#3a86ff', bag: false, bagColor: '#7f5539', cane: false, caneColor: '#7f5539',
    hair: false, hairStyle: 'short' as HairStyle, hairColor: HAIR_COLORS.brown as string, texture: 'straight' as HairTexture,
    part: 'left' as HairPart, accent: 'none' as HairAccent, accentColor: '#f48fb1', fade: false,
    tat1: false, tat1Shape: 'heart', tat1Spot: 'finL', tat1Color: '#2b2d42', tat1Size: 0.5,
    tat2: false, tat2Shape: 'star', tat2Spot: 'belly', tat2Color: '#2b2d42', tat2Size: 0.5,
  };
  const build = (): Outfit => ({
    shirt: w.shirt ? { color: w.shirtColor, length: w.shirtLength, sleeves: w.sleeves, pattern: w.pattern, patternColor: w.patternColor } : null,
    hoodie: w.hoodie ? { color: w.hoodieColor, hoodUp: w.hoodUp, pocket: w.pocket } : null,
    skirt: w.skirt ? { color: w.skirtColor, length: w.skirtLength, flare: w.flare, pleats: w.pleats } : null,
    pants: w.pants ? { color: w.pantsColor, rise: w.rise, legs: w.legs } : null,
    socks: w.socks ? { color: w.socksColor, height: w.socksHeight } : null,
    shoes: w.shoes ? { color: w.shoesColor, height: w.shoesHeight } : null,
    gloves: w.gloves ? { color: w.glovesColor, length: w.glovesLength } : null,
    hat: w.hat ? { style: w.hatStyle, color: w.hatColor, backwards: w.backwards } : null,
    glasses: w.glasses ? { style: w.glassesStyle, color: w.glassesColor } : null,
    bow: w.bow ? { color: w.bowColor } : null,
    headphones: w.headphones ? { color: w.headphonesColor } : null,
    pacifier: w.pacifier ? { color: w.pacifierColor } : null,
    whiskers: w.whiskers ? { color: w.whiskersColor, mustache: w.mustache, brows: w.brows } : null,
    backpack: w.backpack ? { color: w.backpackColor } : null,
    bag: w.bag ? { color: w.bagColor } : null,
    cane: w.cane ? { color: w.caneColor } : null,
    hair: w.hair ? { style: w.hairStyle, color: w.hairColor, texture: w.texture, part: w.part, accent: w.accent, accentColor: w.accentColor, fade: w.fade } : null,
    tattoos: [
      ...(w.tat1 ? [{ shape: w.tat1Shape, spot: w.tat1Spot, color: w.tat1Color, size: w.tat1Size }] : []),
      ...(w.tat2 ? [{ shape: w.tat2Shape, spot: w.tat2Spot, color: w.tat2Color, size: w.tat2Size }] : []),
    ] as Outfit['tattoos'],
  });
  const apply = () => crowd.selected.setOutfit(build());
  const sync = () => {
    const o = crowd.selected.recipe.outfit;
    w.shirt = !!o.shirt; if (o.shirt) { w.shirtColor = o.shirt.color; w.shirtLength = o.shirt.length; w.sleeves = o.shirt.sleeves; w.pattern = o.shirt.pattern; w.patternColor = o.shirt.patternColor; }
    w.hoodie = !!o.hoodie; if (o.hoodie) { w.hoodieColor = o.hoodie.color; w.hoodUp = o.hoodie.hoodUp; w.pocket = o.hoodie.pocket; }
    w.skirt = !!o.skirt; if (o.skirt) { w.skirtColor = o.skirt.color; w.skirtLength = o.skirt.length; w.flare = o.skirt.flare; w.pleats = o.skirt.pleats; }
    w.pants = !!o.pants; if (o.pants) { w.pantsColor = o.pants.color; w.rise = o.pants.rise; w.legs = o.pants.legs; }
    w.socks = !!o.socks; if (o.socks) { w.socksColor = o.socks.color; w.socksHeight = o.socks.height; }
    w.shoes = !!o.shoes; if (o.shoes) { w.shoesColor = o.shoes.color; w.shoesHeight = o.shoes.height; }
    w.gloves = !!o.gloves; if (o.gloves) { w.glovesColor = o.gloves.color; w.glovesLength = o.gloves.length; }
    w.hat = !!o.hat; if (o.hat) { w.hatStyle = o.hat.style; w.hatColor = o.hat.color; w.backwards = o.hat.backwards; }
    w.glasses = !!o.glasses; if (o.glasses) { w.glassesStyle = o.glasses.style; w.glassesColor = o.glasses.color; }
    w.bow = !!o.bow; if (o.bow) w.bowColor = o.bow.color;
    w.headphones = !!o.headphones; if (o.headphones) w.headphonesColor = o.headphones.color;
    w.pacifier = !!o.pacifier; if (o.pacifier) w.pacifierColor = o.pacifier.color;
    w.whiskers = !!o.whiskers; if (o.whiskers) { w.whiskersColor = o.whiskers.color; w.mustache = o.whiskers.mustache; w.brows = o.whiskers.brows; }
    w.backpack = !!o.backpack; if (o.backpack) w.backpackColor = o.backpack.color;
    w.bag = !!o.bag; if (o.bag) w.bagColor = o.bag.color;
    w.cane = !!o.cane; if (o.cane) w.caneColor = o.cane.color;
    w.hair = !!o.hair; if (o.hair) { w.hairStyle = o.hair.style; w.hairColor = o.hair.color; w.texture = o.hair.texture; w.part = o.hair.part; w.accent = o.hair.accent; w.accentColor = o.hair.accentColor; w.fade = o.hair.fade; }
    const [t1, t2] = o.tattoos;
    w.tat1 = !!t1; if (t1) { w.tat1Shape = t1.shape; w.tat1Spot = t1.spot; w.tat1Color = t1.color; w.tat1Size = t1.size; }
    w.tat2 = !!t2; if (t2) { w.tat2Shape = t2.shape; w.tat2Spot = t2.spot; w.tat2Color = t2.color; w.tat2Size = t2.size; }
    f.controllersRecursive().forEach((c) => c.updateDisplay());
  };
  const actions = {
    random: () => { crowd.selected.setOutfit(randomOutfit()); sync(); },
    none: () => { crowd.selected.setOutfit(structuredClone(NO_OUTFIT)); sync(); },
  };
  f.add(actions, 'random').name('🎲 Random outfit');
  f.add(actions, 'none').name('Take everything off');
  const group = (title: string, add: (g: GUI) => void) => { const g = f.addFolder(title); add(g); g.close(); };
  group('Shirt', (g) => {
    g.add(w, 'shirt').name('wearing one');
    g.addColor(w, 'shirtColor').name('colour');
    g.add(w, 'shirtLength', 0, 1, 0.01).name('length');
    g.add(w, 'sleeves', 0, 1, 0.01).name('sleeves');
    const names: Record<ShirtPattern, string> = {
      plain: 'Plain', stripes: 'Stripes', pinstripes: 'Pinstripes', dots: 'Polka dots',
      gingham: 'Gingham', zigzag: 'Zigzag', hearts: 'Hearts', stars: 'Stars',
    };
    g.add(w, 'pattern', Object.fromEntries(SHIRT_PATTERNS.map((p) => [names[p], p]))).name('pattern');
    g.addColor(w, 'patternColor').name('pattern colour');
  });
  group('Hoodie', (g) => {
    g.add(w, 'hoodie').name('wearing one');
    g.addColor(w, 'hoodieColor').name('colour');
    g.add(w, 'hoodUp').name('hood up');
    g.add(w, 'pocket').name('front pocket');
  });
  group('Skirt', (g) => {
    g.add(w, 'skirt').name('wearing one');
    g.addColor(w, 'skirtColor').name('colour');
    g.add(w, 'skirtLength', 0, 1, 0.01).name('length: mini ↔ knee');
    g.add(w, 'flare', 0, 1, 0.01).name('flare');
    g.add(w, 'pleats').name('pleated');
  });
  group('Pants', (g) => {
    g.add(w, 'pants').name('wearing some');
    g.addColor(w, 'pantsColor').name('colour');
    g.add(w, 'rise', 0, 1, 0.01).name('waist: low ↔ high');
    g.add(w, 'legs', 0, 1, 0.01).name('legs: briefs ↔ long');
  });
  group('Socks & shoes', (g) => {
    g.add(w, 'socks').name('socks');
    g.addColor(w, 'socksColor').name('sock colour');
    g.add(w, 'socksHeight', 0, 1, 0.01).name('sock height');
    g.add(w, 'shoes').name('shoes');
    g.addColor(w, 'shoesColor').name('shoe colour');
    g.add(w, 'shoesHeight', 0, 1, 0.01).name('shoes ↔ boots');
  });
  group('Gloves', (g) => {
    g.add(w, 'gloves').name('wearing them');
    g.addColor(w, 'glovesColor').name('colour');
    g.add(w, 'glovesLength', 0, 1, 0.01).name('length');
  });
  group('Hat', (g) => {
    g.add(w, 'hat').name('wearing one');
    g.add(w, 'hatStyle', HAT_STYLES).name('style');
    g.addColor(w, 'hatColor').name('colour');
    g.add(w, 'backwards').name('worn backwards (caps)');
  });
  group('Hair', (g) => {
    g.add(w, 'hair').name('has hair');
    g.add(w, 'hairStyle', HAIR_STYLES).name('style');
    g.add(w, 'texture', HAIR_TEXTURES).name('texture');
    g.addColor(w, 'hairColor').name('colour');
    const swatches = { hairColor: '' };
    g.add(swatches, 'hairColor', { '(pick a natural colour)': '', ...Object.fromEntries(Object.entries(HAIR_COLORS).map(([k, v]) => [k, v])) })
      .name('…or a shade').onChange((v: string) => { if (v) { w.hairColor = v; apply(); sync(); } });
    g.add(w, 'part', HAIR_PARTS).name('part');
    g.add(w, 'accent', HAIR_ACCENTS).name('highlights / streak');
    g.addColor(w, 'accentColor').name('accent colour');
    g.add(w, 'fade').name('faded sides');
  });
  group('Accessories', (g) => {
    g.add(w, 'glasses').name('glasses');
    g.add(w, 'glassesStyle', GLASSES_STYLES).name('frames');
    g.addColor(w, 'glassesColor').name('frame colour');
    g.add(w, 'bow').name('bow');
    g.addColor(w, 'bowColor').name('bow colour');
    g.add(w, 'headphones').name('headphones');
    g.addColor(w, 'headphonesColor').name('headphone colour');
    g.add(w, 'pacifier').name('pacifier');
    g.addColor(w, 'pacifierColor').name('pacifier colour');
    g.add(w, 'whiskers').name('whiskers');
    g.addColor(w, 'whiskersColor').name('whisker colour');
    g.add(w, 'mustache').name('…mustache');
    g.add(w, 'brows').name('…bushy brows');
    g.add(w, 'backpack').name('backpack');
    g.addColor(w, 'backpackColor').name('backpack colour');
    g.add(w, 'bag').name('shoulder bag');
    g.addColor(w, 'bagColor').name('bag colour');
    g.add(w, 'cane').name('cane');
    g.addColor(w, 'caneColor').name('cane colour');
  });
  group('Tattoos', (g) => {
    for (const n of [1, 2] as const) {
      g.add(w, `tat${n}`).name(`tattoo ${n}`);
      g.add(w, `tat${n}Shape`, TATTOO_SHAPES).name('shape');
      g.add(w, `tat${n}Spot`, TATTOO_SPOTS).name('where');
      g.addColor(w, `tat${n}Color`).name('colour');
      g.add(w, `tat${n}Size`, 0, 1, 0.01).name('size');
    }
  });
  for (const c of f.controllersRecursive()) if (c.property in w) c.onChange(apply);
  f.close();
  sync();
  return sync;
}

function spawnSpot(i: number): THREE.Vector3 {
  const a = i * 2.39996, d = 1.5 + 0.45 * i; // a golden-angle spiral, so nobody lands on anybody
  return new THREE.Vector3(Math.cos(a) * d, 0, Math.sin(a) * d);
}
