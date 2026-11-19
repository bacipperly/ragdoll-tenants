/*
 * Face lab (dev only, face-lab.html): tenant heads seen face-on, for working on the face.
 *   #moods        every mood and reaction, plus asleep and mid-blink
 *   #transitions  strips from calm into each expression, to see how pieces appear and go
 *   #live         one big head drifting through the moods and blinking, as in the game
 */
import * as THREE from 'three';
import { Face } from './ragdoll/skin';
import { BODY } from './ragdoll/config';
import { MOODS, NEUTRAL, REACTIONS, LETTERS, type Letters, type Word } from './ragdoll/mood';
import type { FaceShape } from './ragdoll/proportions';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xcfd8dc);
scene.add(new THREE.HemisphereLight(0xffffff, 0x8a9aa0, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(1, 2, 3);
scene.add(sun);
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 50);
camera.position.set(0, 0, 10);
const labels = document.getElementById('labels')!;

const R = BODY.headR;
const headGeometry = new THREE.SphereGeometry(R, 48, 32);
const COLORS = [0x4f86f7, 0xffb4a2, 0x7bd389, 0xf4a259, 0xb28dff, 0xf2d0a4];
const SHAPES: FaceShape[] = [
  { eyeSize: 1, eyeSpacing: 1, eyeHeight: 0, lashes: 0, blush: 0, mouthWidth: 1 },
  { eyeSize: 1.2, eyeSpacing: 0.9, eyeHeight: 0.05, lashes: 1, blush: 0.6, mouthWidth: 0.8 },
];

interface Head { group: THREE.Group; face: Face; letters: Letters; awake: number; label: string }
let heads: Head[] = [];

function letters(word: Word): Letters {
  const out = { ...NEUTRAL };
  for (const k in word) out[k as keyof Letters] = word[k as keyof Word]!;
  return out;
}
function mix(a: Letters, b: Letters, t: number): Letters {
  const out = { ...NEUTRAL };
  for (const l of LETTERS) out[l] = a[l] + (b[l] - a[l]) * t;
  return out;
}

function addHead(x: number, y: number, size: number, label: string, l: Letters, awake = 1, i = 0): Head {
  const group = new THREE.Group();
  group.position.set(x, y, 0);
  group.scale.setScalar(size);
  const head = new THREE.Mesh(headGeometry, new THREE.MeshStandardMaterial({ color: COLORS[i % COLORS.length], roughness: 0.7 }));
  group.add(head);
  const face = new Face(R, SHAPES[0], i % 2 ? -1 : 1);
  group.add(face.root);
  face.setExpression(awake < 0 ? 1 : awake, l, awake < 0 ? 0.85 : 0); // awake −1: a blink
  scene.add(group);
  const h = { group, face, letters: l, awake, label };
  heads.push(h);
  return h;
}

function clear(): void {
  for (const h of heads) scene.remove(h.group);
  heads = [];
  labels.innerHTML = '';
}

/** Lays heads out in a grid that fills the window. */
function grid(items: { label: string; l: Letters; awake?: number }[], cols: number): void {
  const rows = Math.ceil(items.length / cols);
  const cell = 2.2 * R;
  items.forEach((it, k) => {
    const c = k % cols, r = Math.floor(k / cols);
    addHead((c - (cols - 1) / 2) * cell, ((rows - 1) / 2 - r) * cell * 1.15, 1, it.label, it.l, it.awake ?? 1, k);
  });
  fit(cols * cell, rows * cell * 1.15);
}

let view = { w: 1, h: 1 };
function fit(w: number, h: number): void {
  view = { w, h };
  resize();
}
function resize(): void {
  const a = window.innerWidth / window.innerHeight;
  const halfH = Math.max(view.h / 2, view.w / 2 / a) * 1.02;
  camera.left = -halfH * a; camera.right = halfH * a; camera.top = halfH; camera.bottom = -halfH;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  placeLabels();
}
window.addEventListener('resize', resize);

function placeLabels(): void {
  labels.innerHTML = '';
  const v = new THREE.Vector3();
  for (const h of heads) {
    if (!h.label) continue;
    v.copy(h.group.position).setY(h.group.position.y - R * 1.05 * h.group.scale.y).project(camera);
    const d = document.createElement('div');
    d.textContent = h.label;
    d.style.left = `${(v.x + 1) / 2 * window.innerWidth}px`;
    d.style.top = `${(1 - v.y) / 2 * window.innerHeight}px`;
    labels.appendChild(d);
  }
}

const EXPRESSIONS: { label: string; word: Word; awake?: number }[] = [
  ...Object.entries(MOODS).filter(([n]) => n !== 'custom').map(([label, word]) => ({ label, word })),
  ...Object.entries(REACTIONS).map(([label, word]) => ({ label: `${label} (reaction)`, word })),
  { label: 'mid-blink', word: {}, awake: -1 },
  { label: 'out cold', word: {}, awake: 0 },
];

let live: Head | null = null;
function show(page: string): void {
  clear();
  live = null;
  if (page === 'strips') {
    const targets = [
      ['sad', MOODS.sad], ['angry', REACTIONS.angry], ['surprised', REACTIONS.surprised], ['focused', REACTIONS.focused],
      ['excited', MOODS.excited], ['proud', MOODS.proud],
    ] as const;
    const steps = 9;
    const items: { label: string; l: Letters; awake?: number }[] = [];
    for (const [name, word] of targets) {
      for (let s = 0; s < steps; s++) {
        const t = s / (steps - 1);
        items.push({ label: s === 0 ? `calm → ${name}` : `${t.toFixed(2)}`, l: mix(NEUTRAL, letters(word), t) });
      }
    }
    for (let s = 0; s < steps; s++) {
      const t = s / (steps - 1);
      items.push({ label: s === 0 ? 'awake 1 → 0' : `${(1 - t).toFixed(2)}`, l: NEUTRAL, awake: 1 - t });
    }
    grid(items, steps);
  } else if (page === 'live') {
    live = addHead(0, 0, 4, '', { ...NEUTRAL });
    fit(4 * 2.4 * R, 4 * 2.4 * R);
  } else {
    grid(EXPRESSIONS.map((e) => ({ label: e.label, l: letters(e.word), awake: e.awake })), 5);
  }
  for (const b of document.querySelectorAll<HTMLButtonElement>('#controls button')) {
    b.style.fontWeight = b.dataset.page === page ? '700' : '400';
  }
}
for (const b of document.querySelectorAll<HTMLButtonElement>('#controls button')) {
  b.onclick = () => { location.hash = b.dataset.page!; };
}
window.addEventListener('hashchange', () => show(location.hash.slice(1)));
show(location.hash.slice(1) || 'moods');

// Live: drift from one expression to the next, with blinks, at the game's pace.
const order = EXPRESSIONS.filter((e) => e.awake === undefined).map((e) => letters(e.word));
let from = { ...NEUTRAL }, to = order[0], t = 0, idx = 0, blink = 0, nextBlink = 2, time = 0;
let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  time += dt;
  if (live) {
    t += dt / 0.5;
    if (t >= 2.5) { from = to; idx = (idx + 1) % order.length; to = order[idx]; t = 0; }
    const k = THREE.MathUtils.smoothstep(Math.min(1, t), 0, 1);
    let lids = 0;
    if (time >= nextBlink) { if (time - nextBlink < 0.09) lids = 1; else nextBlink = time + 2.5 + Math.random() * 4; }
    blink += (lids - blink) * Math.min(1, dt * (lids > blink ? 40 : 18));
    live.face.setExpression(1, mix(from, to, k), blink);
    live.group.rotation.y = 0.25 * Math.sin(time * 0.6);
  }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
