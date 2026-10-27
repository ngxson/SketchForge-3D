import type { WorkplaneShape } from "@/types/sketchforge";

/**
 * Surface offset ("Grow / Shrink", fork feature, see FORK.md): moves every face of a closed,
 * outward-facing triangle mesh along its normal by `distance` (negative shrinks), e.g. to turn a
 * shaft into the hole it fits in, plus a printing tolerance.
 *
 * Vertices are welded, then each one moves to the point that is `distance` from every distinct
 * face plane meeting there: the least-squares solution of n·v = distance over those planes,
 * lightly regularised so it is also the smallest such move when the planes don't pin it down
 * (an edge, a flat area). Where at most three planes meet (box corners, cylinder rims, the
 * corners of most CAD shapes), every face ends up exactly `distance` away; on smooth tessellated
 * surfaces the move is the right distance to within the facet angle. Topology and triangle count
 * are kept. Offsets larger than a feature (shrinking a wall thinner than twice the distance,
 * growing into a narrow slot) self-intersect, as any mesh offset does.
 */

const WELD_TOLERANCE = 1e-5;
/** Normals closer than this (dot product) count as the same plane at a vertex. */
const SAME_PLANE_DOT = 0.99999;
const REGULARISATION = 1e-6;
/** Cap on a vertex's move, as a multiple of the distance, against needle-sharp vertices. */
const MAX_MOVE_FACTOR = 6;

type Vec3 = [number, number, number];

function solve3(m: number[], b: Vec3): Vec3 | null {
  const [a, b1, c, d, e, f, g, h, i] = m;
  const det = a * (e * i - f * h) - b1 * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-18) return null;
  const inv = [
    (e * i - f * h) / det, (c * h - b1 * i) / det, (b1 * f - c * e) / det,
    (f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det,
    (d * h - e * g) / det, (b1 * g - a * h) / det, (a * e - b1 * d) / det,
  ];
  return [
    inv[0] * b[0] + inv[1] * b[1] + inv[2] * b[2],
    inv[3] * b[0] + inv[4] * b[1] + inv[5] * b[2],
    inv[6] * b[0] + inv[7] * b[1] + inv[8] * b[2],
  ];
}

/**
 * With up to three independent planes: the smallest move v with n·v = distance for each of
 * them, v = Σ aᵢnᵢ where the Gram system G a = distance·1 is solved exactly. Null when the
 * planes are dependent or there are more than three.
 */
function exactMove(normals: Vec3[], distance: number): Vec3 | null {
  const k = normals.length;
  if (k > 3) return null;
  if (k === 1) return [normals[0][0] * distance, normals[0][1] * distance, normals[0][2] * distance];
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  let weights: number[] | null;
  if (k === 2) {
    const g = dot(normals[0], normals[1]);
    const det = 1 - g * g;
    if (det < 1e-10) return null;
    // [1 g; g 1] a = d·[1 1] → a₁ = a₂ = d / (1 + g)
    weights = [distance / (1 + g), distance / (1 + g)];
  } else {
    const gram = [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => dot(normals[r], normals[c])));
    const solved = solve3(gram, [distance, distance, distance]);
    if (!solved) return null;
    weights = solved;
  }
  const move: Vec3 = [0, 0, 0];
  normals.forEach((n, i) => {
    move[0] += weights![i] * n[0];
    move[1] += weights![i] * n[1];
    move[2] += weights![i] * n[2];
  });
  return move;
}

/** Least squares over all planes, (Σ n nᵀ) v = distance · Σ n, regularised only if singular. */
function leastSquaresMove(normals: Vec3[], distance: number): Vec3 {
  const m = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  const rhs: Vec3 = [0, 0, 0];
  for (const n of normals) {
    for (let r = 0; r < 3; r += 1) {
      for (let c = 0; c < 3; c += 1) m[r * 3 + c] += n[r] * n[c];
      rhs[r] += distance * n[r];
    }
  }
  const plain = solve3(m, rhs);
  if (plain) return plain;
  const regularised = m.map((value, i) => (i % 4 === 0 ? value + REGULARISATION : value));
  return solve3(regularised, rhs) ?? [rhs[0] / normals.length, rhs[1] / normals.length, rhs[2] / normals.length];
}

/** Offsets a triangle soup (x, y, z per corner, outward winding). Returns a new soup. */
export function offsetTriangleSoup(positions: number[], distance: number): number[] {
  if (positions.length % 9 !== 0) throw new Error("Offset needs whole triangles");
  if (!distance) return [...positions];

  // Weld corners that share a position.
  const keyOf = (x: number, y: number, z: number) =>
    `${Math.round(x / WELD_TOLERANCE)},${Math.round(y / WELD_TOLERANCE)},${Math.round(z / WELD_TOLERANCE)}`;
  const vertexIndex = new Map<string, number>();
  const vertices: Vec3[] = [];
  const corners: number[] = [];
  for (let i = 0; i < positions.length; i += 3) {
    const key = keyOf(positions[i], positions[i + 1], positions[i + 2]);
    let index = vertexIndex.get(key);
    if (index === undefined) {
      index = vertices.length;
      vertexIndex.set(key, index);
      vertices.push([positions[i], positions[i + 1], positions[i + 2]]);
    }
    corners.push(index);
  }

  // Distinct face planes (unit normals) around each vertex.
  const planes: Vec3[][] = vertices.map(() => []);
  for (let t = 0; t < corners.length; t += 3) {
    const [a, b, c] = [vertices[corners[t]], vertices[corners[t + 1]], vertices[corners[t + 2]]];
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz);
    if (length < 1e-12) continue; // degenerate triangle: no plane to keep
    const normal: Vec3 = [nx / length, ny / length, nz / length];
    for (const corner of [corners[t], corners[t + 1], corners[t + 2]]) {
      const list = planes[corner];
      if (!list.some((n) => n[0] * normal[0] + n[1] * normal[1] + n[2] * normal[2] > SAME_PLANE_DOT)) list.push(normal);
    }
  }

  const moved: Vec3[] = vertices.map((vertex, index) => {
    const list = planes[index];
    if (!list.length) return vertex;
    let move = exactMove(list, distance) ?? leastSquaresMove(list, distance);
    const length = Math.hypot(...move);
    const limit = Math.abs(distance) * MAX_MOVE_FACTOR;
    if (length > limit) move = move.map((value) => (value / length) * limit) as Vec3;
    return [vertex[0] + move[0], vertex[1] + move[1], vertex[2] + move[2]];
  });

  const result = new Array<number>(positions.length);
  for (let i = 0; i < corners.length; i += 1) {
    const [x, y, z] = moved[corners[i]];
    result[i * 3] = x;
    result[i * 3 + 1] = y;
    result[i * 3 + 2] = z;
  }
  return result;
}

/** Signed volume of a closed triangle soup (positive when faces point outward). */
export function triangleSoupVolume(positions: number[]) {
  let volume = 0;
  for (let i = 0; i < positions.length; i += 9) {
    const ax = positions[i], ay = positions[i + 1], az = positions[i + 2];
    const bx = positions[i + 3], by = positions[i + 4], bz = positions[i + 5];
    const cx = positions[i + 6], cy = positions[i + 7], cz = positions[i + 8];
    volume += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return volume;
}

/**
 * Replaces `source` with a mesh shape holding `positions` (world space, Y-up): same id, name,
 * colour, hole mode and visibility; transform and any parametric settings are baked in.
 */
export function meshShapeFromWorldPositions(source: WorkplaneShape, positions: number[]): WorkplaneShape {
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    minX = Math.min(minX, positions[i]); maxX = Math.max(maxX, positions[i]);
    minY = Math.min(minY, positions[i + 1]); maxY = Math.max(maxY, positions[i + 1]);
    minZ = Math.min(minZ, positions[i + 2]); maxZ = Math.max(maxZ, positions[i + 2]);
  }
  const centerX = (minX + maxX) / 2;
  const centerZ = (minZ + maxZ) / 2;
  const width = Math.max(0.01, maxX - minX);
  const height = Math.max(0.01, maxY - minY);
  const depth = Math.max(0.01, maxZ - minZ);
  const local = new Array<number>(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    local[i] = positions[i] - centerX;
    local[i + 1] = positions[i + 1] - minY;
    local[i + 2] = positions[i + 2] - centerZ;
  }
  return {
    id: source.id,
    name: source.name,
    kind: "mesh",
    color: source.color,
    hole: source.hole,
    x: centerX,
    z: centerZ,
    elevation: minY,
    size: Math.max(width, depth),
    width,
    depth,
    height,
    rotation: 0,
    rotationX: 0,
    rotationZ: 0,
    importedMesh: {
      positions: local,
      baseWidth: width,
      baseDepth: depth,
      baseHeight: height,
      triangleCount: positions.length / 9,
      sourceFormat: "json",
    },
    locked: source.locked ?? false,
    hidden: source.hidden ?? false,
  };
}
