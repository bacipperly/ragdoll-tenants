/*
 * The accent symbols' shapes (see accents.ts): soft, slightly dimensional little molded
 * shapes, as in the expressive accents spec. Each is built once, on first use, as one
 * geometry with its colours baked into the vertices, normalised to 1 across its larger
 * side and centred, so every accent can share one kind of material.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export type ShapeName =
  | 'heart' | 'sparkle' | 'blush' | 'anger' | 'puff' | 'scribble' | 'zzz' | 'note' | 'noteB'
  | 'book' | 'controller' | 'sprout' | 'ray' | 'focus' | 'question' | 'bulb' | 'dot' | 'sweat' | 'speed';

const v = (x: number, y: number, z = 0) => new THREE.Vector3(x, y, z);

/** Keeps just what every piece shares, unindexed, and paints it one colour. */
function paint(g: THREE.BufferGeometry, color: THREE.ColorRepresentation): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  for (const name of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(name)) geo.deleteAttribute(name);
  if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
  const c = new THREE.Color(color), n = geo.attributes.position.count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

/** A flat shape puffed into a soft, bevelled slab. */
function slab(shape: THREE.Shape, color: THREE.ColorRepresentation, depth = 0.16, bevel = 0.07): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 3, curveSegments: 12,
  });
  g.translate(0, 0, -depth / 2);
  return paint(g, color);
}

/** A rounded stroke along a path, with round ends. */
function tube(points: THREE.Vector3[], r: number, color: THREE.ColorRepresentation, smooth = true): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = [];
  if (smooth) {
    parts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), points.length * 8, r, 8, false));
  } else {
    for (let i = 1; i < points.length; i++) parts.push(new THREE.TubeGeometry(new THREE.LineCurve3(points[i - 1], points[i]), 1, r, 8, false));
  }
  const joints = smooth ? [points[0], points[points.length - 1]] : points;
  for (const p of joints) parts.push(new THREE.SphereGeometry(r, 10, 8).translate(p.x, p.y, p.z));
  return parts.map((g) => paint(g, color));
}

function ball(r: number, color: THREE.ColorRepresentation, at: THREE.Vector3, squash = v(1, 1, 1)): THREE.BufferGeometry {
  return paint(new THREE.SphereGeometry(r, 16, 12).scale(squash.x, squash.y, squash.z).translate(at.x, at.y, at.z), color);
}

/** Merges the pieces, centres them and scales the larger side to 1. */
function finish(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts)!;
  g.computeBoundingBox();
  const b = g.boundingBox!, c = b.getCenter(v(0, 0)), s = b.getSize(v(0, 0));
  g.translate(-c.x, -c.y, -c.z);
  g.scale(1 / Math.max(s.x, s.y), 1 / Math.max(s.x, s.y), 1 / Math.max(s.x, s.y));
  g.computeBoundingSphere();
  return g;
}

/** A stroke that tapers from a round end of radius r1 at y1 down to r0 at y0 (as a flat shape). */
function taper(y0: number, r0: number, y1: number, r1: number): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-r0, y0);
  s.lineTo(-r1, y1);
  s.absarc(0, y1, r1, Math.PI, 0, true);
  s.lineTo(r0, y0);
  s.absarc(0, y0, r0, 0, Math.PI, true);
  return s;
}

const BUILD: Record<ShapeName, () => THREE.BufferGeometry> = {
  heart: () => {
    const s = new THREE.Shape(); // the classic heart, drawn point-down
    s.moveTo(5, -5);
    s.bezierCurveTo(5, -5, 4, 0, 0, 0);
    s.bezierCurveTo(-6, 0, -6, -7, -6, -7);
    s.bezierCurveTo(-6, -11, -3, -15.4, 5, -19);
    s.bezierCurveTo(12, -15.4, 16, -11, 16, -7);
    s.bezierCurveTo(16, -7, 16, 0, 10, 0);
    s.bezierCurveTo(7, 0, 5, -5, 5, -5);
    return finish([slab(s, '#ff4d6d', 4, 2.2)]);
  },
  sparkle: () => {
    const s = new THREE.Shape(), k = 0.14;
    s.moveTo(0, 1);
    s.quadraticCurveTo(k, k, 1, 0);
    s.quadraticCurveTo(k, -k, 0, -1);
    s.quadraticCurveTo(-k, -k, -1, 0);
    s.quadraticCurveTo(-k, k, 0, 1);
    return finish([slab(s, '#ffbe1a', 0.18, 0.07)]);
  },
  blush: () => finish([0, 1, 2].flatMap((k) => tube([v(k * 0.32 - 0.4, -0.16), v(k * 0.32 - 0.24, 0.16)], 0.06, '#ff7a85', false))),
  anger: () => {
    const parts: THREE.BufferGeometry[] = [];
    for (const [sx, sy] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
      // A bracket bowing in toward the middle, at each corner.
      const pts: THREE.Vector3[] = [];
      const a0 = Math.atan2(-sy, -sx);
      for (let i = 0; i <= 6; i++) {
        const a = a0 - 0.75 + (1.5 * i) / 6;
        pts.push(v(sx * 0.62 + 0.42 * Math.cos(a), sy * 0.62 + 0.42 * Math.sin(a)));
      }
      parts.push(...tube(pts, 0.1, '#ff3b3b'));
    }
    return finish(parts);
  },
  puff: () => finish([
    ball(0.3, '#f2f5fc', v(-0.36, -0.04), v(1, 1, 0.55)),
    ball(0.4, '#f7f9ff', v(0, 0.1), v(1, 1, 0.6)),
    ball(0.3, '#eef2fb', v(0.36, -0.02), v(1, 1, 0.55)),
    ball(0.28, '#e9eef9', v(0.06, -0.14), v(1.3, 0.9, 0.55)),
  ]),
  scribble: () => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 16; i++) {
      // Loops wandering left to right: a tangle you could draw without lifting the pen.
      const a = i * 2.1, r = 0.22 + 0.08 * Math.sin(i * 1.7);
      pts.push(v(-0.6 + i * 0.075 + r * Math.cos(a), r * Math.sin(a) * 0.9, 0.04 * Math.sin(i * 2.1)));
    }
    return finish(tube(pts, 0.04, '#4b3ca8'));
  },
  zzz: () => finish(tube([v(-0.4, 0.4), v(0.4, 0.4), v(-0.4, -0.4), v(0.4, -0.4)], 0.11, '#6b5cff', false)),
  note: () => finish([
    ball(0.21, '#3346b8', v(-0.12, -0.45), v(1.3, 0.95, 0.6)),
    ...tube([v(0.14, -0.42), v(0.14, 0.5)], 0.055, '#3346b8', false),
    ...tube([v(0.14, 0.5), v(0.34, 0.33), v(0.4, 0.08)], 0.055, '#3346b8'),
  ]),
  noteB: () => finish([
    ball(0.2, '#7b4fd6', v(-0.42, -0.45), v(1.3, 0.95, 0.6)),
    ball(0.2, '#7b4fd6', v(0.3, -0.33), v(1.3, 0.95, 0.6)),
    ...tube([v(-0.18, -0.42), v(-0.18, 0.42)], 0.055, '#7b4fd6', false),
    ...tube([v(0.54, -0.3), v(0.54, 0.54)], 0.055, '#7b4fd6', false),
    ...tube([v(-0.18, 0.42), v(0.54, 0.54)], 0.085, '#7b4fd6', false),
  ]),
  book: () => {
    const page = (side: number, color: string, w: number, h: number, d: number, z: number) => {
      const g = new RoundedBoxGeometry(w, h, d, 2, 0.03);
      g.rotateY(-side * 0.38);
      g.translate(side * 0.27, 0, z);
      return paint(g, color);
    };
    return finish([
      page(1, '#4f86f7', 0.6, 0.82, 0.07, -0.05), page(-1, '#4f86f7', 0.6, 0.82, 0.07, -0.05),
      page(1, '#fffaf0', 0.54, 0.74, 0.07, 0.02), page(-1, '#fffaf0', 0.54, 0.74, 0.07, 0.02),
      ...[-1, 1].flatMap((side) => [0.18, 0.04, -0.1].flatMap((y) =>
        tube([v(side * 0.12, y, 0.08 + 0.02), v(side * 0.4, y, 0.08 - 0.08)], 0.016, '#9fb3d9', false))),
    ]);
  },
  controller: () => {
    const s = new THREE.Shape(), w = 0.55, h = 0.24, r = 0.22;
    s.moveTo(-w + r, -h);
    s.lineTo(w - r, -h);
    s.absarc(w - r, -h + r, r, -Math.PI / 2, 0, false);
    s.lineTo(w, h - r);
    s.absarc(w - r, h - r, r, 0, Math.PI / 2, false);
    s.lineTo(-w + r, h);
    s.absarc(-w + r, h - r, r, Math.PI / 2, Math.PI, false);
    s.lineTo(-w, -h + r);
    s.absarc(-w + r, -h + r, r, Math.PI, 1.5 * Math.PI, false);
    const front = 0.2;
    return finish([
      slab(s, '#8e6cff', 0.2, 0.08),
      ball(0.22, '#8e6cff', v(-0.38, -0.24), v(1, 1.2, 0.8)),
      ball(0.22, '#8e6cff', v(0.38, -0.24), v(1, 1.2, 0.8)),
      ball(0.065, '#ff5c8a', v(0.3, 0.07, front)), ball(0.065, '#2ec4b6', v(0.44, -0.05, front)),
      ball(0.065, '#ffd23f', v(0.16, -0.05, front)), ball(0.065, '#4f86f7', v(0.3, -0.17, front)),
      paint(new RoundedBoxGeometry(0.26, 0.08, 0.06, 2, 0.02).translate(-0.3, -0.03, front), '#3d2f7a'),
      paint(new RoundedBoxGeometry(0.08, 0.26, 0.06, 2, 0.02).translate(-0.3, -0.03, front), '#3d2f7a'),
    ]);
  },
  sprout: () => {
    const leaf = (dir: number) => {
      const s = new THREE.Shape();
      s.moveTo(0, 0);
      s.quadraticCurveTo(dir * 0.22, 0.26, dir * 0.52, 0.08);
      s.quadraticCurveTo(dir * 0.26, -0.16, 0, 0);
      const g = slab(s, '#6fd35b', 0.05, 0.03);
      g.translate(0, 0.08, 0);
      return g;
    };
    return finish([...tube([v(0, -0.55), v(0.03, -0.2), v(0, 0.1)], 0.05, '#3fa34d'), leaf(1), leaf(-1)]);
  },
  ray: () => finish([slab(taper(-0.45, 0.04, 0.35, 0.13), '#ff9f1c', 0.12, 0.05)]),
  focus: () => finish([slab(taper(-0.45, 0.035, 0.35, 0.09), '#2b3a8c', 0.1, 0.04)]),
  question: () => finish([
    ...tube([v(-0.3, 0.22), v(-0.22, 0.45), v(0, 0.53), v(0.24, 0.45), v(0.3, 0.24), v(0.14, 0.06), v(0, -0.04), v(0, -0.2)], 0.095, '#8e5cf0'),
    ball(0.105, '#8e5cf0', v(0, -0.46)),
  ]),
  bulb: () => finish([
    ball(0.34, '#ffe066', v(0, 0.12)),
    paint(new THREE.CylinderGeometry(0.16, 0.14, 0.24, 16).translate(0, -0.3, 0), '#9aa3ad'),
    paint(new THREE.TorusGeometry(0.16, 0.025, 6, 16).rotateX(Math.PI / 2).translate(0, -0.25, 0), '#7d8691'),
    paint(new THREE.TorusGeometry(0.15, 0.025, 6, 16).rotateX(Math.PI / 2).translate(0, -0.34, 0), '#7d8691'),
    ball(0.07, '#6b737d', v(0, -0.44)),
    ...[0.55, Math.PI / 2, Math.PI - 0.55].flatMap((a) =>
      tube([v(0.5 * Math.cos(a), 0.12 + 0.5 * Math.sin(a)), v(0.68 * Math.cos(a), 0.12 + 0.68 * Math.sin(a))], 0.04, '#ffbf1f', false)),
  ]),
  dot: () => finish([ball(0.5, '#8e5cf0', v(0, 0), v(1, 1, 0.7))]),
  sweat: () => {
    const s = new THREE.Shape();
    s.moveTo(0, 0.5);
    s.bezierCurveTo(0.1, 0.25, 0.3, 0.05, 0.3, -0.2);
    s.absarc(0, -0.2, 0.3, 0, Math.PI, true);
    s.bezierCurveTo(-0.3, 0.05, -0.1, 0.25, 0, 0.5);
    return finish([slab(s, '#6ec6ff', 0.14, 0.06)]);
  },
  speed: () => {
    // A streak along x: round and thick at +x (nearest the body), fading to a point at −x.
    const g = slab(taper(-0.5, 0.012, 0.42, 0.06), '#8aa8ff', 0.06, 0.025);
    g.rotateZ(-Math.PI / 2);
    return finish([g]);
  },
};

const built = new Map<ShapeName, THREE.BufferGeometry>();
export function accentShape(name: ShapeName): THREE.BufferGeometry {
  let g = built.get(name);
  if (!g) { g = BUILD[name](); built.set(name, g); }
  return g;
}
