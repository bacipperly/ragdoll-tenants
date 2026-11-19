import * as THREE from 'three';

/*
 * One blended skin surface from several lathed shapes (belly, legs, fins).
 *
 * Each shape is a surface of revolution round a vertical axis, given as a radius
 * profile, the same as the drawing's outlines in config.ts. Instead of meshing each one
 * separately and letting them poke through each other (a hard crease where a leg goes
 * into the belly), the shapes are turned into distance fields and joined with a SMOOTH
 * union, which grows a soft fillet wherever a limb meets the body, like clay smoothed
 * over with a thumb. The result is polygonised once (surface nets) and shared by every
 * ragdoll with the same proportions, so none of this costs anything per frame.
 *
 * Limbs blend only into the body, not into each other, so the legs stay two legs.
 *
 * Fins hang inside the belly's outline in the rest pose, so a fin is blended in a
 * "build pose" swung out from the shoulder by `splay`; the finished vertices are then
 * swung back by their skin weights, which is exactly what skinning undoes again when the
 * physics swings the fin out.
 */

/** Up to two bone influences: [boneA, boneB, weightA, weightB]. */
export type Influence = [number, number, number, number];

export interface Shape {
  /** [height, radius] from bottom to top; closes to a point where the radius is 0. */
  profile: readonly (readonly [number, number])[];
  /** Axis position, and a height offset added to the profile's heights. */
  cx: number; cz: number; yOffset: number;
  /** Flattens the cross-section front to back (fins), 1 = round. */
  squashZ: number;
  /** Which group it's in: limbs blend into 'body' with `blend`, not into each other. */
  group: 'body' | 'limb';
  /** Fillet size where this limb meets the body (world units). */
  blend: number;
  /** Bones by height, in the shape's own rest frame. */
  influence: (y: number) => Influence;
  /**
   * Only blend near this point (build space), fading out between `radius` and twice
   * that: a fin melts into the shoulder at its root, not all along the side.
   */
  root?: { x: number; y: number; z: number; radius: number };
  /** Build pose: swung about the z axis through (px, py) by `angle` (rad); `bones` swing with it. */
  swing?: { px: number; py: number; angle: number; bones: number[] };
}

const LUT = 96;

/** A shape prepared for fast distance queries. */
class Field {
  readonly r = new Float32Array(LUT);
  readonly h0: number;
  readonly h1: number;
  readonly dh: number;
  readonly cosA: number;
  readonly sinA: number;
  readonly invSquash: number;
  // Bounds in build space, with a margin.
  min = new THREE.Vector3(Infinity, Infinity, Infinity);
  max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  // Scratch outputs from `local`.
  lx = 0; ly = 0; lz = 0;
  // Exact signed distance to the outline in the (radius, height) half-plane, tabulated
  // and read back with bilinear interpolation: smooth and right even at the pointy ends.
  private table!: Float32Array;
  private tq = 0; // table step
  private tRho = 0; // columns (radius)
  private tH = 0; // rows (height)
  private tH0 = 0; // height of row 0

  constructor(readonly s: Shape, private readonly margin: number) {
    // Sample the smooth curve through the profile, then resample evenly in height.
    const curve = new THREE.SplineCurve(s.profile.map(([h, r]) => new THREE.Vector2(h, r)));
    const pts = curve.getPoints(400);
    this.h0 = pts[0].x;
    this.h1 = pts[pts.length - 1].x;
    this.dh = (this.h1 - this.h0) / (LUT - 1);
    let k = 0;
    for (let i = 0; i < LUT; i++) {
      const h = this.h0 + i * this.dh;
      while (k < pts.length - 2 && pts[k + 1].x < h) k++;
      const a = pts[k], b = pts[k + 1];
      const t = b.x > a.x ? THREE.MathUtils.clamp((h - a.x) / (b.x - a.x), 0, 1) : 0;
      this.r[i] = Math.max(0, a.y + (b.y - a.y) * t);
    }
    this.r[0] = 0;
    this.r[LUT - 1] = 0;
    let rMax = 0;
    for (let i = 0; i < LUT; i++) rMax = Math.max(rMax, this.r[i]);
    this.buildTable(rMax, margin);
    this.cosA = Math.cos(s.swing?.angle ?? 0);
    this.sinA = Math.sin(s.swing?.angle ?? 0);
    this.invSquash = 1 / s.squashZ;
    // Bounds: the rest-frame box (bulges up to ×1.8), swung into the build pose.
    const R = rMax * 1.8 + margin;
    const y0 = this.h0 + s.yOffset - margin, y1 = this.h1 + s.yOffset + margin;
    for (const x of [s.cx - R, s.cx + R]) for (const y of [y0, y1]) for (const z of [s.cz - R, s.cz + R]) {
      const p = this.toBuild(x, y, z);
      this.min.min(p);
      this.max.max(p);
    }
  }

  private buildTable(rMax: number, margin: number): void {
    const q = (this.tq = Math.max(0.0015, margin / 12));
    this.tRho = Math.ceil((rMax + margin) / q) + 2;
    this.tH0 = this.h0 - margin;
    this.tH = Math.ceil((this.h1 - this.h0 + 2 * margin) / q) + 2;
    const T = (this.table = new Float32Array(this.tRho * this.tH));
    for (let j = 0; j < this.tH; j++) {
      const h = this.tH0 + j * q;
      // Inside if within the height range and closer to the axis than the outline.
      let rAt = -1;
      if (h > this.h0 && h < this.h1) {
        const u = (h - this.h0) / this.dh, i = Math.min(LUT - 2, Math.floor(u));
        rAt = this.r[i] + (this.r[i + 1] - this.r[i]) * (u - i);
      }
      for (let c = 0; c < this.tRho; c++) {
        const rho = c * q;
        let best = Infinity;
        for (let i = 0; i < LUT - 1; i++) {
          // Distance from (rho, h) to the segment (r_i, h_i)–(r_i+1, h_i+1).
          const ax = this.r[i], ay = this.h0 + i * this.dh;
          const bx = this.r[i + 1] - ax, by = this.dh;
          const px = rho - ax, py = h - ay;
          const t = Math.max(0, Math.min(1, (px * bx + py * by) / (bx * bx + by * by)));
          const dx = px - bx * t, dy = py - by * t;
          const d2 = dx * dx + dy * dy;
          if (d2 < best) best = d2;
        }
        T[j * this.tRho + c] = rho < rAt ? -Math.sqrt(best) : Math.sqrt(best);
      }
    }
  }

  private toBuild(x: number, y: number, z: number): THREE.Vector3 {
    const w = this.s.swing;
    if (!w) return new THREE.Vector3(x, y, z);
    const dx = x - w.px, dy = y - w.py;
    return new THREE.Vector3(w.px + this.cosA * dx - this.sinA * dy, w.py + this.sinA * dx + this.cosA * dy, z);
  }

  /** Build-space point → the shape's rest frame, into lx, ly, lz. */
  local(x: number, y: number, z: number): void {
    const w = this.s.swing;
    if (!w) { this.lx = x; this.ly = y; this.lz = z; return; }
    const dx = x - w.px, dy = y - w.py;
    this.lx = w.px + this.cosA * dx + this.sinA * dy;
    this.ly = w.py - this.sinA * dx + this.cosA * dy;
    this.lz = z;
  }

  /** Roughly the signed distance to the surface (negative inside). */
  distance(x: number, y: number, z: number): number {
    // Far outside its box: the distance to the box is a fine lower bound.
    const ox = Math.max(this.min.x - x, 0, x - this.max.x);
    const oy = Math.max(this.min.y - y, 0, y - this.max.y);
    const oz = Math.max(this.min.z - z, 0, z - this.max.z);
    // Outside its box (the shape padded by `margin`): at least margin + the box distance away,
    // and margin is bigger than any fillet, so far shapes never blend or weigh in.
    if (ox + oy + oz > 0) return Math.sqrt(ox * ox + oy * oy + oz * oz) + this.margin;
    this.local(x, y, z);
    const s = this.s;
    const dx = this.lx - s.cx, dz = (this.lz - s.cz) * this.invSquash;
    const rho = Math.sqrt(dx * dx + dz * dz);
    const h = this.ly - s.yOffset;
    const fx = rho / this.tq, fy = (h - this.tH0) / this.tq;
    if (fx >= this.tRho - 1 || fy <= 0 || fy >= this.tH - 1) {
      // Beyond the table, which covers the shape plus the margin: at least that far.
      const over = Math.max(fx - (this.tRho - 1), -fy, fy - (this.tH - 1), 0) * this.tq;
      return this.margin + over;
    }
    const c = Math.floor(fx), j = Math.floor(fy), tx = fx - c, ty = fy - j;
    const T = this.table, w = this.tRho, i0 = j * w + c;
    const d0 = T[i0] + (T[i0 + 1] - T[i0]) * tx;
    const d1 = T[i0 + w] + (T[i0 + w + 1] - T[i0 + w]) * tx;
    return d0 + (d1 - d0) * ty;
  }
}

/** How much of a shape's fillet applies at (x, y, z): 1 near its root (or if it has none), fading to 0. */
function rootFade(s: Shape, x: number, y: number, z: number): number {
  const r = s.root;
  if (!r) return 1;
  const d = Math.sqrt((x - r.x) ** 2 + (y - r.y) ** 2 + (z - r.z) ** 2);
  const t = Math.min(1, Math.max(0, (d - r.radius) / r.radius));
  return 1 - t * t * (3 - 2 * t);
}

/** Polynomial smooth minimum: a fillet of about size k where a and b meet. */
function smin(a: number, b: number, k: number): number {
  if (k <= 1e-6) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

/**
 * Meshes the smooth union of `shapes` with cells of size `cell`, skinned to `boneCount`
 * bones. Returns a geometry in the rest pose with position, normal, skinIndex, skinWeight.
 */
export function blendedSkin(shapes: Shape[], cell: number, boneCount: number): THREE.BufferGeometry {
  const margin = 3 * cell + Math.max(...shapes.map((s) => s.blend));
  const fields = shapes.map((s) => new Field(s, margin));
  const body = fields.filter((f) => f.s.group === 'body');
  const limbs = fields.filter((f) => f.s.group === 'limb');
  const dist = new Float32Array(fields.length);

  const sdf = (x: number, y: number, z: number): number => {
    let d = Infinity;
    for (const f of body) d = Math.min(d, f.distance(x, y, z));
    // Each limb blends into the body; limbs only meet each other with a plain union.
    let out = d;
    for (const f of limbs) {
      const dl = f.distance(x, y, z);
      out = Math.min(out, smin(d, dl, f.s.blend * rootFade(f.s, x, y, z)));
    }
    return out;
  };

  // ---- Sample the field on a grid round all the shapes.
  const lo = new THREE.Vector3(Infinity, Infinity, Infinity), hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (const f of fields) { lo.min(f.min); hi.max(f.max); }
  const nx = Math.ceil((hi.x - lo.x) / cell) + 1;
  const ny = Math.ceil((hi.y - lo.y) / cell) + 1;
  const nz = Math.ceil((hi.z - lo.z) / cell) + 1;
  const grid = new Float32Array(nx * ny * nz);
  const at = (i: number, j: number, k: number) => i + nx * (j + ny * k);
  // Coarse pass first (every other point); a fine point is only worked out exactly when
  // its coarse neighbour says the surface might be close. Elsewhere only the sign matters.
  for (let k = 0; k < nz; k += 2) for (let j = 0; j < ny; j += 2) for (let i = 0; i < nx; i += 2) {
    grid[at(i, j, k)] = sdf(lo.x + i * cell, lo.y + j * cell, lo.z + k * cell);
  }
  const far = 2.5 * cell;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (!(i & 1) && !(j & 1) && !(k & 1)) continue;
    const c = grid[at(i & ~1, j & ~1, k & ~1)];
    grid[at(i, j, k)] = Math.abs(c) > far ? c : sdf(lo.x + i * cell, lo.y + j * cell, lo.z + k * cell);
  }

  // ---- Surface nets: one vertex per cell the surface passes through.
  const cellVert = new Int32Array(nx * ny * nz).fill(-1);
  const pos: number[] = [];
  const corner = new Float32Array(8);
  const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let inside = 0;
    for (let c = 0; c < 8; c++) {
      corner[c] = grid[at(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1))];
      if (corner[c] < 0) inside++;
    }
    if (inside === 0 || inside === 8) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of EDGES) {
      const da = corner[a], db = corner[b];
      if ((da < 0) === (db < 0)) continue;
      const t = da / (da - db);
      sx += (a & 1) + (((b & 1) - (a & 1)) * t);
      sy += ((a >> 1) & 1) + ((((b >> 1) & 1) - ((a >> 1) & 1)) * t);
      sz += ((a >> 2) & 1) + ((((b >> 2) & 1) - ((a >> 2) & 1)) * t);
      n++;
    }
    cellVert[at(i, j, k)] = pos.length / 3;
    pos.push(lo.x + (i + sx / n) * cell, lo.y + (j + sy / n) * cell, lo.z + (k + sz / n) * cell);
  }

  // Quads across every grid edge the surface crosses, joining the four cells round it.
  const index: number[] = [];
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) index.push(a, c, b, a, d, c); else index.push(a, b, c, a, c, d);
  };
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const g0 = grid[at(i, j, k)] < 0;
    if (g0 !== (grid[at(i + 1, j, k)] < 0)) {
      quad(cellVert[at(i, j - 1, k - 1)], cellVert[at(i, j, k - 1)], cellVert[at(i, j, k)], cellVert[at(i, j - 1, k)], !g0);
    }
    if (g0 !== (grid[at(i, j + 1, k)] < 0)) {
      quad(cellVert[at(i - 1, j, k - 1)], cellVert[at(i - 1, j, k)], cellVert[at(i, j, k)], cellVert[at(i, j, k - 1)], !g0);
    }
    if (g0 !== (grid[at(i, j, k + 1)] < 0)) {
      quad(cellVert[at(i - 1, j - 1, k)], cellVert[at(i, j - 1, k)], cellVert[at(i, j, k)], cellVert[at(i - 1, j, k)], !g0);
    }
  }

  // ---- Settle each vertex onto the surface, take its normal from the field, and skin it.
  const count = pos.length / 3;
  const normals = new Float32Array(count * 3);
  const skinIndex = new Uint16Array(count * 4);
  const skinWeight = new Float32Array(count * 4);
  const weights = new Float32Array(boneCount);
  const e = cell * 0.3;
  const g = new THREE.Vector3();
  /** Field gradient by forward differences (from the value d at the point), unnormalised. */
  const grad = (x: number, y: number, z: number, d: number) => g.set(
    (sdf(x + e, y, z) - d) / e, (sdf(x, y + e, z) - d) / e, (sdf(x, y, z + e) - d) / e,
  );
  // Swinging back to the rest pose, per bone: shapes that swing say which bones they carry.
  const swingOf = new Array<Shape['swing']>(boneCount).fill(undefined);
  for (const f of fields) if (f.s.swing) for (const b of f.s.swing.bones) swingOf[b] = f.s.swing;
  const p = new THREE.Vector3(), n = new THREE.Vector3(), rp = new THREE.Vector3(), rn = new THREE.Vector3();
  const top = [0, 0, 0, 0], topW = [0, 0, 0, 0];
  for (let v = 0; v < count; v++) {
    p.set(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
    // A Newton step onto the surface (smoother than the cell average alone), then the
    // normal from the field there.
    let d = sdf(p.x, p.y, p.z);
    grad(p.x, p.y, p.z, d);
    const gl = g.lengthSq();
    // (Capped at half a cell: where the field is rough, better to stay put than fly off.)
    if (gl > 1e-12) { const k = THREE.MathUtils.clamp(-d / gl, -0.5 * cell / Math.sqrt(gl), 0.5 * cell / Math.sqrt(gl)); p.addScaledVector(g, k); }
    d = sdf(p.x, p.y, p.z);
    n.copy(grad(p.x, p.y, p.z, d)).normalize();

    // Bone weights: each shape counts by how close the point is to it (so a fillet
    // between a leg and the belly follows both), then by its own bones at that height.
    weights.fill(0);
    let dMin = Infinity;
    for (let s = 0; s < fields.length; s++) { dist[s] = fields[s].distance(p.x, p.y, p.z); dMin = Math.min(dMin, dist[s]); }
    for (let s = 0; s < fields.length; s++) {
      const f = fields[s];
      const span = Math.max(f.s.blend * rootFade(f.s, p.x, p.y, p.z), cell);
      const w = Math.max(0, 1 - (dist[s] - dMin) / span) ** 2;
      if (w <= 0) continue;
      f.local(p.x, p.y, p.z);
      const inf = f.s.influence(f.ly);
      weights[inf[0]] += w * inf[2];
      weights[inf[1]] += w * inf[3];
    }
    // Keep the four strongest.
    for (let t = 0; t < 4; t++) { top[t] = 0; topW[t] = 0; }
    for (let b = 0; b < boneCount; b++) {
      const w = weights[b];
      if (w <= topW[3]) continue;
      let t = 3;
      while (t > 0 && topW[t - 1] < w) { topW[t] = topW[t - 1]; top[t] = top[t - 1]; t--; }
      topW[t] = w; top[t] = b;
    }
    const sum = topW[0] + topW[1] + topW[2] + topW[3] || 1;

    // Back to the rest pose. Skinning will put this vertex at (w_still + w_swung·R)·rest
    // when the fin is at its build angle, so solve that exactly: in the swing plane it's a
    // complex multiply by (w_still + w_swung·e^{iθ}), undone by dividing by it.
    let ws = 0;
    let sw: Shape['swing'] = undefined;
    for (let t = 0; t < 4; t++) {
      const w = topW[t] / sum;
      skinIndex[v * 4 + t] = top[t];
      skinWeight[v * 4 + t] = w;
      const ss = swingOf[top[t]];
      if (ss && w > 0) { ws += w; sw = ss; }
    }
    rp.copy(p); rn.copy(n);
    if (sw && ws > 0) {
      const ar = 1 - ws + ws * Math.cos(sw.angle), ai = ws * Math.sin(sw.angle);
      const m2 = ar * ar + ai * ai;
      const dx = p.x - sw.px, dy = p.y - sw.py;
      // (dx + i·dy) / (ar + i·ai)
      rp.x = sw.px + (dx * ar + dy * ai) / m2;
      rp.y = sw.py + (dy * ar - dx * ai) / m2;
      const m = Math.sqrt(m2);
      rn.x = (n.x * ar + n.y * ai) / m;
      rn.y = (n.y * ar - n.x * ai) / m;
    }
    pos[v * 3] = rp.x; pos[v * 3 + 1] = rp.y; pos[v * 3 + 2] = rp.z;
    rn.normalize();
    normals[v * 3] = rn.x; normals[v * 3 + 1] = rn.y; normals[v * 3 + 2] = rn.z;
  }

  // Wind every triangle to face along its normals (outward).
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let t = 0; t < index.length; t += 3) {
    const i0 = index[t], i1 = index[t + 1], i2 = index[t + 2];
    a.fromArray(pos, i0 * 3); b.fromArray(pos, i1 * 3); c.fromArray(pos, i2 * 3);
    b.sub(a); c.sub(a); b.cross(c);
    const nx0 = normals[i0 * 3] + normals[i1 * 3] + normals[i2 * 3];
    const ny0 = normals[i0 * 3 + 1] + normals[i1 * 3 + 1] + normals[i2 * 3 + 1];
    const nz0 = normals[i0 * 3 + 2] + normals[i1 * 3 + 2] + normals[i2 * 3 + 2];
    if (b.x * nx0 + b.y * ny0 + b.z * nz0 < 0) { index[t + 1] = i2; index[t + 2] = i1; }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
  geo.setIndex(index);
  return geo;
}
