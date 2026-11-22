/*
 * Sandbox for the active ragdoll POC: a grid floor, a few props, tenants (one selected,
 * the rest wandering), keyboard controls and a camera. Everything ragdoll-specific lives
 * in src/ragdoll/; characters.ts has the crowd and the character library.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Accents, ACCENT_KINDS, ACTIVITIES, ActiveRagdoll, RagdollPhysics, RAPIER, type Activity } from './ragdoll';
import { bodyDims } from './ragdoll/proportions';
import { TRAITS } from './ragdoll/config';
import { ageName } from './ragdoll/traits';
import { createTuner } from './tuner';
import { addCharactersSection, Crowd, loadLibrary, saveLibrary } from './characters';
import { loadIntoEditor, recipeFromEditor, TENANT_YELLOW } from './ragdoll';
import { Carry, Things } from './things';

const hud = document.getElementById('hud')!;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap; // PCFSoftShadowMap was removed in three r187
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#e9e7e3'); // clean, neutral, near white (the design spec)

// Soft studio lighting (the design spec): a warm key that casts the shadows, a sky/floor
// fill whose floor side bounces warm light up under chins, a cool fill from the far side
// so nothing goes muddy, and a rim from behind to lift the silhouette off the background.
// None but the key casts shadows, so the extra lights cost next to nothing.
scene.add(new THREE.HemisphereLight('#ffffff', '#c9b79a', 1.7));
const sun = new THREE.DirectionalLight('#fff1dc', 2.0);
sun.position.set(4, 8, 3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.radius = 3; // softer contact shadows
const fill = new THREE.DirectionalLight('#e6efff', 0.7);
fill.position.set(-5, 3, -4);
const rim = new THREE.DirectionalLight('#ffffff', 0.9);
rim.position.set(-2, 5, 7);
scene.add(fill, rim);

// Floating symbols that show feelings (hearts, Zs, a "?"…), for every tenant.
const accents = new Accents(scene);
const sc = sun.shadow.camera;
sc.left = -6; sc.right = 6; sc.top = 6; sc.bottom = -6; sc.near = 0.5; sc.far = 30;
scene.add(sun, sun.target);

// ---- Cameras: close-up perspective follow, and the game's far orthographic view ----
const persp = new THREE.PerspectiveCamera(40, 1, 0.05, 100);
const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
let useOrtho = true; // start in the game's view; C switches to the close-up
let camYaw = 0; // which way the camera looks on the ground; 0 = looking north. Read back from the orbit.
const ORTHO_HALF_HEIGHT = 4.5;

// Start positions, relative to the ragdoll: close-up behind it, and the game's far view
// at a true isometric angle (45° around, looking down 35.26°, i.e. along (1, -1, 1)).
persp.position.set(0, 1.8, -2.6);
ortho.position.set(-15, 15, -15);

/**
 * Mouse orbit on both cameras: drag to orbit, wheel to zoom. Panning is off because
 * the orbit centre follows the ragdoll every frame.
 */
function makeOrbit(camera: THREE.Camera): OrbitControls {
  const c = new OrbitControls(camera, renderer.domElement);
  c.enableDamping = true;
  c.dampingFactor = 0.12;
  c.enablePan = false;
  c.maxPolarAngle = 1.48; // never below the floor
  c.target.set(0, 0.5, 0);
  return c;
}
const perspOrbit = makeOrbit(persp);
perspOrbit.minDistance = 0.35;
perspOrbit.maxDistance = 18;
const orthoOrbit = makeOrbit(ortho);
orthoOrbit.minZoom = 0.25;
orthoOrbit.maxZoom = 10;
perspOrbit.enabled = !useOrtho;
orthoOrbit.enabled = useOrtho;

function resize() {
  const w = window.innerWidth, h = window.innerHeight, a = w / h;
  renderer.setSize(w, h);
  persp.aspect = a;
  persp.updateProjectionMatrix();
  ortho.left = -ORTHO_HALF_HEIGHT * a; ortho.right = ORTHO_HALF_HEIGHT * a;
  ortho.top = ORTHO_HALF_HEIGHT; ortho.bottom = -ORTHO_HALF_HEIGHT;
  ortho.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ---- Physics + world ----
const physics = await RagdollPhysics.create();
const world = physics.world;

const floorMat = new THREE.MeshStandardMaterial({ color: '#e8e1d5', roughness: 0.95 });
const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), floorMat);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
const grid = new THREE.GridHelper(40, 40, '#b9ae9c', '#cfc6b6');
grid.position.y = 0.001;
scene.add(grid);
world.createCollider(RAPIER.ColliderDesc.cuboid(20, 0.5, 20).setTranslation(0, -0.5, 0).setFriction(0.8));

/** Static props: a box mesh plus a matching cuboid collider. */
function prop(x: number, y: number, z: number, sx: number, sy: number, sz: number, color: string) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), new THREE.MeshStandardMaterial({ color, roughness: 0.85 }));
  mesh.position.set(x, y + sy / 2, z);
  mesh.castShadow = mesh.receiveShadow = true;
  scene.add(mesh);
  world.createCollider(RAPIER.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2).setTranslation(x, y + sy / 2, z));
}
prop(3, 0, 2, 2, 0.12, 2, '#a3b18a'); // low platform: the hover ray steps it up onto this
prop(-3, 0, 1, 1, 0.9, 1, '#e76f51'); // counter-height box to bump into
prop(-2, 0, -3, 3, 0.45, 1, '#8ecae6'); // sofa-seat height bench
prop(1.5, 0, -4, 1, 0.25, 1, '#ffb703');

let ragdoll = physics.createRagdoll({ color: TENANT_YELLOW, position: new THREE.Vector3(0, 0, 0) });
scene.add(ragdoll.group);

// Things to play with, and picking things (and tenants) up.
const things = new Things(world, scene);
physics.beforeStep.push(() => things.rememberPose());
const carry = new Carry(world);

// Everyone on screen; `ragdoll` is always the selected one (WASD, camera, look sliders).
const crowd = new Crowd(physics, scene, ragdoll);
let syncCharacterFields = () => {};
let refreshPanel = () => {};
crowd.onSelect = (r) => {
  const changedWho = r.recipe.name !== ragdoll.recipe.name || r !== ragdoll;
  // Switching to someone else puts down whatever you were holding.
  if (carry.carrier && carry.carrier !== r && crowd.tenants.includes(carry.carrier)) carry.release(new THREE.Vector3());
  ragdoll = r;
  // Its look goes into the sliders, so they edit this tenant.
  loadIntoEditor(r.recipe);
  if (changedWho) { refreshPanel(); syncCharacterFields(); }
  Object.assign(window, { ragdoll });
};

// The character library (characters.json). The first time, your current look becomes
// its first character; after that you start as the library's default.
const library = await loadLibrary();
if (library.characters.length === 0) {
  const first = recipeFromEditor('My tenant', TENANT_YELLOW, 'calm');
  library.characters.push(first);
  library.default = first.name;
  void saveLibrary(library);
} else {
  const start = library.characters.find((c) => c.name === library.default) ?? library.characters[0];
  loadIntoEditor(start);
  crowd.replace(ragdoll, structuredClone(start), false);
}

/**
 * Proportions are fixed when a ragdoll is built, so when they change (a slider, Paste,
 * Revert, or tuning.json changing) rebuild it where it stands, facing the same way.
 * Waits until the values have been still briefly, so dragging a slider doesn't rebuild
 * it every frame.
 */
let pendingShape = '';
let pendingSince = 0;
function rebuildIfReshaped(now: number) {
  const key = bodyDims().key;
  if (key === ragdoll.dims.key) { pendingShape = ''; return; }
  if (key !== pendingShape) { pendingShape = key; pendingSince = now; return; }
  if (now - pendingSince < 150) return;
  // The selected tenant takes the sliders' look, keeping its name, colour and mood.
  crowd.replace(ragdoll, recipeFromEditor(ragdoll.recipe.name, ragdoll.recipe.color, ragdoll.mood, ragdoll.recipe.outfit));
  pendingShape = '';
}

// Click a tenant to select it (a click, not the end of an orbit drag).
const downAt = new THREE.Vector2();
const ndc = new THREE.Vector2();
renderer.domElement.addEventListener('pointerdown', (e) => downAt.set(e.clientX, e.clientY));
renderer.domElement.addEventListener('pointerup', (e) => {
  if (Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 5) return;
  ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  const hit = crowd.pick(ndc, useOrtho ? ortho : persp);
  if (hit && hit !== ragdoll) crowd.select(hit);
});

// ---- Input ----
const keys = new Set<string>();
/** Number keys 1–9, 0 play these; the rest are in the tuning panel's Reactions section. */
const KEY_GESTURES = ['wave', 'hop', 'spin', 'bow', 'celebrate', 'shrug', 'stomp', 'sigh', 'nod', 'shake'] as const;
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  // Typing into the tuning panel (or Space on a focused panel button) shouldn't walk
  // the ragdoll or press shortcuts.
  if (e.target instanceof HTMLElement && e.target.closest('.lil-gui, input, textarea')) return;
  keys.add(e.code);
  switch (e.code) {
    case 'KeyK': ragdoll.setKnockedOut(!ragdoll.isKnockedOut); break;
    case 'KeyF': {
      // Shove from the camera's side, a bit randomised.
      const a = camYaw + (Math.random() - 0.5) * 1.2;
      ragdoll.push(new THREE.Vector3(Math.sin(a) * 3, 0.6, Math.cos(a) * 3));
      break;
    }
    case 'KeyR': ragdoll.reset(new THREE.Vector3(0, 0, 0), 0); break;
    case 'KeyB': ragdoll.setShowSkeleton(!ragdoll.showingSkeleton); break;
    case 'KeyG':
      // Pick up whatever's in front (a thing or a tenant); if already holding, throw it.
      if (carry.held && carry.carrier === ragdoll) carry.throw();
      else carry.grab(ragdoll, things, crowd.tenants);
      break;
    case 'KeyV': if (carry.carrier === ragdoll) carry.release(new THREE.Vector3()); break;
    case 'Space': e.preventDefault(); ragdoll.jump(); break;
    case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4': case 'Digit5':
    case 'Digit6': case 'Digit7': case 'Digit8': case 'Digit9': case 'Digit0':
      ragdoll.playGesture(KEY_GESTURES[(Number(e.code.slice(5)) + 9) % 10]);
      break;
    case 'KeyM': {
      const names = ActiveRagdoll.moodNames;
      ragdoll.setMood(names[(names.indexOf(ragdoll.mood) + 1) % names.length]);
      break;
    }
    case 'KeyX': {
      // Cycle the expression library (after the last, back to the mood's own face).
      const names = ActiveRagdoll.expressionNames, cur = ragdoll.expression;
      const i = cur ? names.indexOf(cur) + 1 : 0;
      ragdoll.setExpression(i < names.length ? names[i] : null);
      break;
    }
    case 'KeyI': accents.burst(ragdoll, 'bulb'); break; // an idea!
    case 'KeyC':
      useOrtho = !useOrtho;
      perspOrbit.enabled = !useOrtho;
      orthoOrbit.enabled = useOrtho;
      break;
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

const camForward = new THREE.Vector2();
const camRight = new THREE.Vector2();
const move = new THREE.Vector2();

function readMoveInput(dt: number) {
  const orbit = useOrtho ? orthoOrbit : perspOrbit;
  // Q/E orbit too, by turning the camera around the orbit centre.
  const turn = (keys.has('KeyQ') ? -1 : 0) + (keys.has('KeyE') ? 1 : 0);
  if (turn) {
    orbit.object.position.sub(orbit.target).applyAxisAngle(THREE.Object3D.DEFAULT_UP, turn * 1.8 * dt).add(orbit.target);
  }
  // The camera sits at azimuth `a` from the target, so it looks the opposite way.
  camYaw = orbit.getAzimuthalAngle() + Math.PI;
  // Camera-relative WASD on the ground plane (x east, z north).
  camForward.set(Math.sin(camYaw), Math.cos(camYaw));
  camRight.set(-Math.cos(camYaw), Math.sin(camYaw));
  move.set(0, 0);
  if (keys.has('KeyW')) move.add(camForward);
  if (keys.has('KeyS')) move.sub(camForward);
  if (keys.has('KeyD')) move.add(camRight);
  if (keys.has('KeyA')) move.sub(camRight);
  if (move.lengthSq() > 0) move.normalize();
  // Walks by default; holding Shift runs (full speed).
  ragdoll.setMoveInput(move.x, move.y, !(keys.has('ShiftLeft') || keys.has('ShiftRight')));
}

// ---- Loop ----
const focus = new THREE.Vector3();
const camPos = new THREE.Vector3();
const followDelta = new THREE.Vector3();
ragdoll.middle(focus);
let last = performance.now();
let physicsMsAvg = 0;
let frameMsAvg = 16;

/**
 * Detail per tenant: off-screen ones skip the goo and face entirely; ones whose head is
 * too small on screen to read a face get the cheap version. Uses last frame's camera.
 */
const HEAD_PX_FOR_FULL = 30;
const frustum = new THREE.Frustum();
const viewProj = new THREE.Matrix4();
const headSphere = new THREE.Sphere();
function setDetail(cam: THREE.Camera): void {
  viewProj.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  frustum.setFromProjectionMatrix(viewProj);
  for (const t of crowd.tenants) {
    const r = t.headSpot(headSphere.center);
    headSphere.radius = r * 1.3; // a little slack, so a head peeking in at the edge counts
    if (!frustum.intersectsSphere(headSphere)) { t.detail = 'hidden'; continue; }
    const px = cam instanceof THREE.OrthographicCamera
      ? (2 * r * cam.zoom) / (cam.top - cam.bottom) * window.innerHeight
      : (2 * r) / (2 * headSphere.center.distanceTo(cam.position) * Math.tan(THREE.MathUtils.degToRad((cam as THREE.PerspectiveCamera).fov) / 2)) * window.innerHeight;
    t.detail = px >= HEAD_PX_FOR_FULL ? 'full' : 'far';
  }
}

function frame(now: number) {
  rebuildIfReshaped(now);
  const dt = (now - last) / 1000;
  last = now;
  readMoveInput(Math.min(dt, 0.1));
  crowd.update(Math.min(dt, 0.1));

  setDetail(useOrtho ? ortho : persp);
  const t0 = performance.now();
  physics.step(dt);
  const physicsMs = performance.now() - t0;
  things.update(Math.min(dt, 0.1), crowd.tenants, physics.alpha);
  carry.update(Math.min(dt, 0.1), crowd.tenants);
  physicsMsAvg += (physicsMs - physicsMsAvg) * 0.05;
  frameMsAvg += (dt * 1000 - frameMsAvg) * 0.05;

  // Follow the torso, smoothed so the camera doesn't inherit the wobble. Both cameras
  // move by the same amount as the orbit centre, so the orbit angle and zoom are kept.
  ragdoll.drawnMiddle(camPos);
  followDelta.copy(focus);
  focus.lerp(camPos, 1 - Math.exp(-Math.min(dt, 0.1) * 6));
  followDelta.subVectors(focus, followDelta);
  for (const orbit of [perspOrbit, orthoOrbit]) {
    orbit.target.copy(focus);
    orbit.object.position.add(followDelta);
    orbit.update();
  }
  const cam = useOrtho ? ortho : persp;
  sun.position.set(focus.x + 4, 8, focus.z + 3);
  sun.target.position.copy(focus);

  accents.update(Math.min(dt, 0.1), cam, crowd.tenants);
  renderer.render(scene, cam);

  const s = ragdoll.debugState();
  hud.innerHTML =
    `<b>Active ragdoll POC</b>   you: <b>${ragdoll.recipe.name}</b>   tenants: ${crowd.tenants.length}\n` +
    `Click a tenant to be them\n` +
    `WASD  walk (camera-relative)   Shift  run\n` +
    `K     knockout / get up        F      shove\n` +
    `Drag  orbit   Wheel zoom   Q/E  orbit   C  ${useOrtho ? 'close-up camera' : 'game (ortho) camera'}\n` +
    `Space jump                     B      ${ragdoll.showingSkeleton ? 'hide' : 'show'} skeleton\n` +
    `M     next mood                R      reset\n` +
    `X     next expression          I      idea (lightbulb)\n` +
    `G     pick up / throw          V      put down\n` +
    `1–0   ${KEY_GESTURES.join(' ')}\n\n` +
    `state     ${s.knockedOut ? 'KNOCKED OUT' : s.muscle < 1 ? 'recovering' : 'active'}\n` +
    `muscle    ${(s.muscle * 100).toFixed(0)}%\n` +
    `mood      ${s.mood}${s.expression ? ` · face: ${s.expression}` : ''}${s.reaction ? ` + ${s.reaction}` : ''}${s.gesture ? ` · ${s.gesture}` : ''}   annoyance ${'●'.repeat(Math.ceil(s.annoyance - 0.001))}${'○'.repeat(Math.max(0, 3 - Math.ceil(s.annoyance - 0.001)))}\n` +
    `grounded  ${s.grounded ? 'yes' : 'no'}\n` +
    `height    ${ragdoll.dims.height.toFixed(2)} units (game tenant: 0.9)\n` +
    `traits    ${ageName(TRAITS.age)} · weight ${TRAITS.weight.toFixed(1)} · fitness ${TRAITS.fitness.toFixed(1)}\n` +
    // The spec's budget is the whole crowd's physics; the goo heads are drawn on top.
    `crowd     ${crowd.tenants.length} tenant${crowd.tenants.length === 1 ? '' : 's'}\n` +
    `holding   ${carry.carrier === ragdoll ? carry.heldName : '—'}${s.carried ? '   (being carried!)' : ''}\n` +
    `physics   ${physicsMsAvg.toFixed(2)} ms / frame (${frameMsAvg.toFixed(1)} ms frame)`;

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Fade the loading screen out once the first frame is on screen.
requestAnimationFrame(() => requestAnimationFrame(() => {
  const loading = document.getElementById('loading');
  if (!loading) return;
  loading.classList.add('done');
  loading.addEventListener('transitionend', () => loading.remove(), { once: true });
  setTimeout(() => loading.remove(), 1000);
}));

// Slider panel: the feel (saved to tuning.json) and the selected tenant's look (saved
// as a character recipe in characters.json).
const gui = createTuner({
  ragdoll: () => ragdoll,
  addSections: (g) => { syncCharacterFields = addCharactersSection(g, crowd, library, () => refreshPanel()); },
});
refreshPanel = () => gui.controllersRecursive().forEach((c) => c.updateDisplay());
const thingsFolder = gui.addFolder('Things');
thingsFolder.add({ reset: () => { carry.release(new THREE.Vector3()); things.reset(); } }, 'reset').name('↺ Put the things back');
thingsFolder.close();

// Expressive accents: what you're doing, and every accent on demand to look at.
const accentFolder = gui.addFolder('Accents');
const accentState = { on: true, activity: '' };
accentFolder.add(accentState, 'on').name('show accents').onChange((v: boolean) => { accents.enabled = v; });
accentFolder.add(accentState, 'activity', { '(nothing)': '', ...Object.fromEntries(ACTIVITIES.map((a) => [a, a])) })
  .name('busy with').listen().onChange((v: string) => { ragdoll.activity = (v || null) as Activity | null; });
setInterval(() => { accentState.activity = ragdoll.activity ?? ''; }, 250);
const showOne = accentFolder.addFolder('Show one');
for (const k of ACCENT_KINDS) showOne.add({ [k]: () => accents.burst(ragdoll, k) }, k);
showOne.close();
accentFolder.close();

// Exposed for poking at from the console.
Object.assign(window, { ragdoll, physics, perspOrbit, crowd, things, carry, accents });
