import { booleans, extrusions, geometries, primitives, transforms } from "@jscad/modeling";

/**
 * Latch & screw box generator (fork feature, see FORK.md).
 *
 * This is a TypeScript port of the "Latch & screw box generator" page's BoxGen core.
 * It builds an open-back enclosure with hook-under-lip latches along the top edge and
 * a single screw boss at the bottom, plus the matching cover, using @jscad/modeling
 * CSG. The geometry algorithm is kept verbatim so the output matches the page.
 *
 * Generator coordinates: the box is centred on XY, z = 0 is the front (closed) face,
 * z = D is the open back rim; "top" is +Y (latches), "bottom" is -Y (screw). The cover
 * is generated in its print orientation: outer face on z = 0, features rising in +z.
 * Both parts are Z-up; convert with `zUpToSketchForge` before putting them in a scene.
 */

const { cuboid, cylinder, roundedRectangle, polygon } = primitives;
const { union, subtract } = booleans;
const { extrudeLinear } = extrusions;
const { translate, rotateY, rotateZ } = transforms;

type Geom3 = ReturnType<typeof cuboid>;
type Geom2 = ReturnType<typeof roundedRectangle>;

export type LatchBoxHookStyle = "solid" | "tab" | "thin";
export type LatchBoxPart = "body" | "cover";

export type LatchBoxParams = {
  /** Outer width (x), height (y) and depth (z). */
  W: number;
  H: number;
  D: number;
  wall: number;
  front: number;
  radius: number;
  latchCount: number;
  latchWidth: number;
  lipIn: number;
  lipHeight: number;
  lipChamfer: number;
  undercut: number;
  pocketDepth: number;
  hookDrop: number;
  hookStyle: LatchBoxHookStyle;
  padOn: boolean;
  padGap: number;
  padLength: number;
  padRamp: number;
  hookNeck: number;
  barbHeight: number;
  /** Metric screw size; the hole is 0.83× and the clearance +0.4. */
  screw: number;
  screwEdge: number;
  bossWidth: number;
  bossLength: number;
  holeDepth: number;
  countersink: boolean;
  csDia: number;
  coverBoss: boolean;
  bossDrop: number;
  coverThick: number;
  coverRim: boolean;
  coverRimWidth: number;
  coverRimHeight: number;
  clearance: number;
  segments: number;
};

type ResolvedParams = LatchBoxParams & { screwHole: number; screwClearance: number };

/** Defaults measured from the reference 3MF (Xiaomi AAA sensor case body + battery cover). */
export const LATCH_BOX_DEFAULTS: LatchBoxParams = {
  W: 43, H: 55, D: 19,
  wall: 2.0,
  front: 1.0,
  radius: 4.0,
  latchCount: 1,
  latchWidth: 12,
  lipIn: 1.0,
  lipHeight: 1.0,
  lipChamfer: 1.0,
  undercut: 1.0,
  pocketDepth: 6.6,
  hookDrop: 3.8,
  hookStyle: "solid",
  padOn: true,
  padGap: 3.5,
  padLength: 3.0,
  padRamp: 4.8,
  hookNeck: 2.0,
  barbHeight: 1.5,
  screw: 3,
  screwEdge: 8.5,
  bossWidth: 8,
  bossLength: 10,
  holeDepth: 10,
  countersink: true,
  csDia: 6.6,
  coverBoss: true,
  bossDrop: 3.8,
  coverThick: 1.4,
  coverRim: true,
  coverRimWidth: 1.5,
  coverRimHeight: 1.0,
  clearance: 0.2,
  segments: 48,
};

const HOOK_STYLES: LatchBoxHookStyle[] = ["solid", "tab", "thin"];

export function normalizeLatchBoxParams(input?: Partial<LatchBoxParams> | null): LatchBoxParams {
  const next: LatchBoxParams = { ...LATCH_BOX_DEFAULTS };
  if (!input) return next;
  (Object.keys(LATCH_BOX_DEFAULTS) as Array<keyof LatchBoxParams>).forEach((key) => {
    const value = input[key];
    const fallback = LATCH_BOX_DEFAULTS[key];
    if (typeof fallback === "number") {
      if (typeof value === "number" && Number.isFinite(value)) (next as Record<string, unknown>)[key] = value;
    } else if (typeof fallback === "boolean") {
      if (typeof value === "boolean") (next as Record<string, unknown>)[key] = value;
    } else if (key === "hookStyle") {
      if (HOOK_STYLES.includes(value as LatchBoxHookStyle)) next.hookStyle = value as LatchBoxHookStyle;
    }
  });
  next.latchCount = Math.max(0, Math.min(12, Math.round(next.latchCount)));
  next.segments = Math.max(16, Math.min(128, Math.round(next.segments)));
  return next;
}

function resolve(params: LatchBoxParams): ResolvedParams {
  const p = normalizeLatchBoxParams(params);
  return {
    ...p,
    screwHole: Number((p.screw * 0.83).toFixed(2)),
    screwClearance: Number((p.screw + 0.4).toFixed(2)),
  };
}

export function validateLatchBoxParams(params: LatchBoxParams): string[] {
  const p = resolve(params);
  const e: string[] = [];
  if (p.wall - p.undercut < 0.6) e.push("Wall must be at least 0.6 mm thicker than the undercut.");
  if (p.front < 0.4) e.push("Front plate too thin.");
  if (p.W - 2 * p.wall < 4 || p.H - 2 * p.wall < 4) e.push("Box is too small for that wall thickness.");
  if (p.D <= p.front + p.pocketDepth + 0.5) e.push("Depth must exceed front + pocket depth.");
  if (p.latchCount > 0 && p.latchCount * (p.latchWidth + 2) > p.W - 2 * (p.wall + p.radius)) {
    e.push("Latches do not fit across the top edge — reduce count/width or corner radius.");
  }
  const minDrop = p.hookStyle === "tab" ? 1.5 : p.hookStyle === "thin" ? p.lipHeight + p.lipChamfer + p.barbHeight + 0.2 : p.lipHeight + p.lipChamfer + p.clearance + 1.0;
  if (p.hookDrop < minDrop) e.push(`Hook length must be at least ${minDrop.toFixed(1)} mm for this lip.`);
  if (p.hookDrop > p.pocketDepth - 0.3) e.push("Hook drop must be shorter than the pocket depth.");
  if (p.padOn && p.latchCount > 0 && p.padGap + p.padLength + p.padRamp > p.H / 2 - p.wall - 4) e.push("Support pad does not fit inside the cover.");
  if (p.bossWidth + 2 * p.clearance > p.W - 2 * (p.wall + p.radius)) e.push("Screw boss too wide.");
  if (p.screwEdge - p.wall < p.screwHole / 2 + 0.6) e.push("Screw is too close to the wall.");
  if (p.screwEdge - p.wall + p.screwHole / 2 + 1 > p.bossLength) e.push("Boss length must cover the hole.");
  if (p.coverBoss && p.bossDrop + p.clearance + p.front + 2 > p.D) e.push("Cover boss is too tall for this depth.");
  if (p.countersink && p.csDia / 2 + 0.6 > p.bossWidth / 2) e.push("Countersink is wider than the boss.");
  return e;
}

const rrect = (w: number, h: number, r: number, seg: number): Geom2 =>
  roundedRectangle({ size: [w, h], roundRadius: Math.max(Math.min(r, w / 2 - 0.01, h / 2 - 0.01), 0.01), segments: seg });

function latchXs(p: ResolvedParams) {
  const usable = p.W - 2 * (p.wall + p.radius);
  const xs: number[] = [];
  for (let i = 0; i < p.latchCount; i += 1) xs.push(((i + 0.5) / p.latchCount - 0.5) * usable);
  return xs;
}

/** Maps a (y, z) profile polygon extruded along +z into a solid extruded along world x. */
function profileAlongX(points: number[][], length: number, x0: number): Geom3 {
  let solid = extrudeLinear({ height: length }, polygon({ points: points as [number, number][] }));
  solid = rotateY(Math.PI / 2, rotateZ(Math.PI / 2, solid));
  return translate([x0, 0, 0], solid);
}

function body(p: ResolvedParams): Geom3 {
  const seg = p.segments;
  const yi = p.H / 2 - p.wall; // inner wall face (top)
  let g = extrudeLinear({ height: p.D }, rrect(p.W, p.H, p.radius, seg));
  const cav = translate([0, 0, p.front], extrudeLinear({ height: p.D }, rrect(p.W - 2 * p.wall, p.H - 2 * p.wall, p.radius - p.wall, seg)));
  g = subtract(g, cav);
  // --- latches on the top wall
  const lipTop = p.D;
  const lipBot = p.D - p.lipHeight;
  const chamBot = lipBot - p.lipChamfer;
  for (const x of latchXs(p)) {
    const pocket = cuboid({
      center: [x, yi + p.undercut / 2, (p.D + 1 + (p.D - p.pocketDepth)) / 2],
      size: [p.latchWidth, p.undercut, p.D + 1 - (p.D - p.pocketDepth)],
    });
    g = subtract(g, pocket);
    // lip profile in (y,z), extruded along x
    const lip = profileAlongX(
      [[yi + p.undercut + 0.01, lipTop], [yi - p.lipIn, lipTop], [yi - p.lipIn, lipBot], [yi + p.undercut + 0.01, chamBot]],
      p.latchWidth,
      x - p.latchWidth / 2,
    );
    g = union(g, lip);
  }
  // --- screw boss on the bottom wall
  const yb = -(p.H / 2 - p.wall);
  const bossY0 = -p.H / 2 + 0.5;
  const bossY1 = yb + p.bossLength;
  const bossTop = p.D - (p.coverBoss ? p.bossDrop + p.clearance : 0);
  let boss = extrudeLinear({ height: bossTop - p.front }, rrect(p.bossWidth, bossY1 - bossY0, 1.5, 16));
  boss = translate([0, (bossY0 + bossY1) / 2, p.front], boss);
  g = union(g, boss);
  const hy = -p.H / 2 + p.screwEdge;
  const hd = Math.min(p.holeDepth, bossTop - p.front - 0.8);
  const hole = translate([0, hy, bossTop - hd / 2 + 0.5], cylinder({ radius: p.screwHole / 2, height: hd + 1, segments: 32 }));
  g = subtract(g, hole);
  return g;
}

function cover(p: ResolvedParams): Geom3 {
  const seg = p.segments;
  const c = p.clearance;
  const t = p.coverThick;
  const yi = p.H / 2 - p.wall;
  let g = extrudeLinear({ height: t }, rrect(p.W, p.H, p.radius, seg));
  // two side rails along the long (x) sides, inset by wall + clearance, clear of the rounded corners
  if (p.coverRim) {
    const xIn = p.W / 2 - p.wall - c;
    const len = p.H - 2 * (p.wall + Math.max(p.radius - p.wall, 0) + c + 0.5);
    if (len > 2) {
      for (const sx of [-1, 1]) {
        const rail = cuboid({ center: [sx * (xIn - p.coverRimWidth / 2), 0, t - 0.01 + p.coverRimHeight / 2], size: [p.coverRimWidth, len, p.coverRimHeight + 0.01] });
        g = union(g, rail);
      }
    }
  }
  // hooks (cover x = -body x after the flip about Y; latch layout is symmetric anyway)
  const w = p.latchWidth - 2 * c;
  const neckIn = yi - p.lipIn - c; // neck outer face
  const neckY0 = neckIn - p.hookNeck;
  const barbOut = yi + p.undercut - c;
  const zTop = t + p.hookDrop;
  for (const x of latchXs(p)) {
    const bz0 = zTop - p.barbHeight;
    const ch = Math.min(p.barbHeight * 0.7, barbOut - neckIn);
    let pts: number[][];
    if (p.hookStyle === "tab") {
      // plain block sitting inside the lip, chamfered outer tip — exactly the reference cover
      const tOut = neckIn;
      const tIn = tOut - Math.max(p.hookNeck, 3.7);
      const chY = 1.3;
      const chZ = Math.min(2.8, p.hookDrop - 0.5);
      pts = [[tIn, t - 0.01], [tOut, t - 0.01], [tOut, zTop - chZ], [tOut - chY, zTop], [tIn, zTop]];
    } else if (p.hookStyle === "thin") {
      // L-hook: thin neck, barb at the tip
      pts = [[neckY0, t - 0.01], [neckIn, t - 0.01], [neckIn, bz0], [barbOut, bz0], [barbOut, zTop - ch], [barbOut - ch, zTop], [neckY0, zTop]];
    } else {
      // solid wedge (as in the reference model): full-thickness block, notched only where the lip sits
      const zn1 = t + p.lipHeight + c;
      const zn2 = t + p.lipHeight + p.lipChamfer + c;
      pts = [[neckY0, t - 0.01], [neckIn, t - 0.01], [neckIn, zn1], [barbOut, zn2], [barbOut, zTop - ch], [barbOut - ch, zTop], [neckY0, zTop]];
    }
    g = union(g, profileAlongX(pts, w, -x - w / 2));
    if (p.padOn) {
      const inner = p.hookStyle === "tab" ? neckIn - Math.max(p.hookNeck, 3.7) : neckY0;
      const py1 = inner - p.padGap;
      const py0 = py1 - p.padLength;
      const py2 = py0 - p.padRamp;
      g = union(g, profileAlongX([[py2, t - 0.01], [py1, t - 0.01], [py1, zTop], [py0, zTop]], w, -x - w / 2));
    }
  }

  // screw boss on the inside of the cover, sitting on the body boss
  const hy = -p.H / 2 + p.screwEdge;
  const yb = -(p.H / 2 - p.wall);
  const totalT = t + (p.coverBoss ? p.bossDrop : 0);
  if (p.coverBoss) {
    const by0 = yb + c;
    const by1 = yb + p.bossLength - c;
    const cb = extrudeLinear({ height: p.bossDrop + 0.01 }, rrect(p.bossWidth - 2 * c, by1 - by0, 1.2, 16));
    g = union(g, translate([0, (by0 + by1) / 2, t - 0.01], cb));
  }
  // through-hole + 90° countersink on the outer face (z = 0)
  g = subtract(g, translate([0, hy, totalT / 2], cylinder({ radius: p.screwClearance / 2, height: totalT + 2, segments: 32 })));
  if (p.countersink && p.csDia > p.screwClearance + 0.2) {
    const csR = p.csDia / 2;
    const depth = Math.min(csR - p.screwClearance / 2, totalT - 0.4);
    const rBot = csR - depth;
    // cylinderElliptic: startRadius at -h/2, endRadius at +h/2 -> wide at z=0 (outer face), narrow at z=depth
    const cone = primitives.cylinderElliptic({ height: depth + 0.02, startRadius: [csR, csR], endRadius: [rBot, rBot], segments: 32 });
    g = subtract(g, translate([0, hy, depth / 2 - 0.01], cone));
  }
  return g;
}

export function latchBoxBody(params: LatchBoxParams): Geom3 {
  return body(resolve(params));
}

export function latchBoxCover(params: LatchBoxParams): Geom3 {
  return cover(resolve(params));
}

/** Transform that places the cover onto the body (assembled view). */
export function assembleLatchBoxCover(params: LatchBoxParams, coverGeom: Geom3): Geom3 {
  const p = resolve(params);
  return translate([0, 0, p.D + p.coverThick], rotateY(Math.PI, coverGeom));
}

// ---- mesh clean-up: weld vertices, split T-junctions, drop degenerate triangles.
// CSG output has many edges that end in the middle of a neighbouring face; slicers tolerate
// that but mesh checkers do not. Returns a flat Float32Array of triangle positions.
function cleanMesh(geom: Geom3): Float32Array {
  const polys = geometries.geom3.toPolygons(geom);
  const Q = 1e-4;
  const verts: number[][] = [];
  const vmap = new Map<string, number>();
  const vid = (p: ArrayLike<number>) => {
    const x = Math.round(p[0] / Q) * Q;
    const y = Math.round(p[1] / Q) * Q;
    const z = Math.round(p[2] / Q) * Q;
    const k = `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
    let i = vmap.get(k);
    if (i === undefined) {
      i = verts.length;
      verts.push([x, y, z]);
      vmap.set(k, i);
    }
    return i;
  };
  // faces as index rings (drop consecutive duplicates)
  const faces: number[][] = [];
  for (const poly of polys) {
    const ring: number[] = [];
    for (const v of poly.vertices) {
      const i = vid(v);
      if (ring.length === 0 || ring[ring.length - 1] !== i) ring.push(i);
    }
    while (ring.length > 1 && ring[0] === ring[ring.length - 1]) ring.pop();
    if (ring.length >= 3) faces.push(ring);
  }
  // spatial hash of vertices for edge queries
  const cell = 1.0;
  const grid = new Map<string, number[]>();
  const ck = (x: number, y: number, z: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  verts.forEach((v, i) => {
    const k = ck(v[0], v[1], v[2]);
    let list = grid.get(k);
    if (!list) {
      list = [];
      grid.set(k, list);
    }
    list.push(i);
  });
  const onSegment = (a: number, b: number) => {
    const A = verts[a];
    const B = verts[b];
    const dx = B[0] - A[0];
    const dy = B[1] - A[1];
    const dz = B[2] - A[2];
    const L2 = dx * dx + dy * dy + dz * dz;
    if (L2 < 1e-12) return [] as number[];
    const hits: Array<[number, number]> = [];
    const x0 = Math.min(A[0], B[0]) - cell;
    const x1 = Math.max(A[0], B[0]) + cell;
    const y0 = Math.min(A[1], B[1]) - cell;
    const y1 = Math.max(A[1], B[1]) + cell;
    const z0 = Math.min(A[2], B[2]) - cell;
    const z1 = Math.max(A[2], B[2]) + cell;
    for (let gx = Math.floor(x0 / cell); gx <= Math.floor(x1 / cell); gx += 1) {
      for (let gy = Math.floor(y0 / cell); gy <= Math.floor(y1 / cell); gy += 1) {
        for (let gz = Math.floor(z0 / cell); gz <= Math.floor(z1 / cell); gz += 1) {
          const list = grid.get(`${gx},${gy},${gz}`);
          if (!list) continue;
          for (const i of list) {
            if (i === a || i === b) continue;
            const P = verts[i];
            const t = ((P[0] - A[0]) * dx + (P[1] - A[1]) * dy + (P[2] - A[2]) * dz) / L2;
            if (t <= 1e-6 || t >= 1 - 1e-6) continue;
            const px = A[0] + t * dx - P[0];
            const py = A[1] + t * dy - P[1];
            const pz = A[2] + t * dz - P[2];
            if (px * px + py * py + pz * pz < 1e-6) hits.push([t, i]);
          }
        }
      }
    }
    hits.sort((u, v) => u[0] - v[0]);
    return hits.map((h) => h[1]);
  };
  const out: number[] = [];
  const tri = (i: number, j: number, k: number) => {
    const A = verts[i];
    const B = verts[j];
    const C = verts[k];
    const ux = B[0] - A[0];
    const uy = B[1] - A[1];
    const uz = B[2] - A[2];
    const vx = C[0] - A[0];
    const vy = C[1] - A[1];
    const vz = C[2] - A[2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    if (nx * nx + ny * ny + nz * nz < 1e-14) return; // degenerate
    out.push(A[0], A[1], A[2], B[0], B[1], B[2], C[0], C[1], C[2]);
  };
  for (const ring of faces) {
    // insert T-junction vertices along each edge
    const full: number[] = [];
    const split: boolean[] = []; // split[e] = true if edge e (from ring[e]) received T-vertices
    const startIdx: number[] = [];
    for (let e = 0; e < ring.length; e += 1) {
      const a = ring[e];
      const b = ring[(e + 1) % ring.length];
      startIdx.push(full.length);
      full.push(a);
      const m = onSegment(a, b);
      split.push(m.length > 0);
      for (const v of m) full.push(v);
    }
    // apex: an original vertex whose two adjacent edges were not split
    let apex = -1;
    for (let e = 0; e < ring.length; e += 1) {
      const prev = (e + ring.length - 1) % ring.length;
      if (!split[e] && !split[prev]) {
        apex = startIdx[e];
        break;
      }
    }
    if (apex >= 0) {
      const n = full.length;
      for (let i = 1; i + 1 < n; i += 1) tri(full[apex], full[(apex + i) % n], full[(apex + i + 1) % n]);
    } else {
      // every corner touches a split edge: fan around an interior centroid
      let cx = 0;
      let cy = 0;
      let cz = 0;
      for (const i of ring) {
        cx += verts[i][0];
        cy += verts[i][1];
        cz += verts[i][2];
      }
      const ci = verts.length;
      verts.push([cx / ring.length, cy / ring.length, cz / ring.length]);
      for (let i = 0; i < full.length; i += 1) tri(ci, full[i], full[(i + 1) % full.length]);
    }
  }
  return new Float32Array(out);
}

export type LatchBoxTriangles = { positions: Float32Array; normals: Float32Array };

/** Cleaned triangle soup (Z-up generator coordinates) with flat per-face normals. */
export function latchBoxTriangles(geom: Geom3): LatchBoxTriangles {
  const positions = cleanMesh(geom);
  const n = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 9) {
    const a = positions.subarray(i, i + 3);
    const b = positions.subarray(i + 3, i + 6);
    const c = positions.subarray(i + 6, i + 9);
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    for (let k = 0; k < 9; k += 3) {
      n[i + k] = nx;
      n[i + k + 1] = ny;
      n[i + k + 2] = nz;
    }
  }
  return { positions, normals: n };
}

/** Builds both parts. Throws when the parameters fail validation. */
export function buildLatchBox(params: LatchBoxParams): { body: LatchBoxTriangles; cover: LatchBoxTriangles } {
  const errors = validateLatchBoxParams(params);
  if (errors.length) throw new Error(errors[0]);
  return { body: latchBoxTriangles(latchBoxBody(params)), cover: latchBoxTriangles(latchBoxCover(params)) };
}
