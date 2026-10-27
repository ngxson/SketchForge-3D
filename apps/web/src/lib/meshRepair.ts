/**
 * T-junction repair (fork, see FORK.md). Some meshes, notably three-bvh-csg results such as
 * hollow boxes, have vertices lying in the middle of a neighbouring triangle's edge. The surface
 * is closed, but not edge-manifold, so Manifold rejects it. This splits every such edge at the
 * vertices on it and re-triangulates the affected triangles as a fan around their centroid
 * (every edge vertex is used and no triangle is degenerate). Input and output are triangle
 * soups (x, y, z per corner); untouched triangles are copied as they are.
 */

const WELD = 1e-5;
const ON_EDGE = 1e-5;

type Vec3 = [number, number, number];

export function repairTJunctions(positions: number[]): { positions: number[]; splitTriangles: number } {
  const keyOf = (x: number, y: number, z: number) => `${Math.round(x / WELD)},${Math.round(y / WELD)},${Math.round(z / WELD)}`;
  const index = new Map<string, number>();
  const vertices: Vec3[] = [];
  const corners: number[] = [];
  for (let i = 0; i < positions.length; i += 3) {
    const key = keyOf(positions[i], positions[i + 1], positions[i + 2]);
    let id = index.get(key);
    if (id === undefined) {
      id = vertices.length;
      index.set(key, id);
      vertices.push([positions[i], positions[i + 1], positions[i + 2]]);
    }
    corners.push(id);
  }

  // Uniform grid over the vertices, sized for a handful per cell.
  let min: Vec3 = [Infinity, Infinity, Infinity];
  let max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const v of vertices) {
    min = [Math.min(min[0], v[0]), Math.min(min[1], v[1]), Math.min(min[2], v[2])];
    max = [Math.max(max[0], v[0]), Math.max(max[1], v[1]), Math.max(max[2], v[2])];
  }
  const extent = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2], 1e-6);
  const cell = Math.max(extent / Math.cbrt(Math.max(1, vertices.length / 4)), 1e-4);
  const cellOf = (value: number, axis: number) => Math.floor((value - min[axis]) / cell);
  const grid = new Map<string, number[]>();
  vertices.forEach((v, id) => {
    const key = `${cellOf(v[0], 0)},${cellOf(v[1], 1)},${cellOf(v[2], 2)}`;
    const bucket = grid.get(key);
    if (bucket) bucket.push(id);
    else grid.set(key, [id]);
  });

  /** Vertices strictly inside segment a→b (within ON_EDGE), ordered from a to b. */
  const onEdge = (a: number, b: number): number[] => {
    const [ax, ay, az] = vertices[a];
    const [bx, by, bz] = vertices[b];
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const lengthSq = dx * dx + dy * dy + dz * dz;
    if (lengthSq < ON_EDGE * ON_EDGE) return [];
    const found: Array<[number, number]> = [];
    const lo = [Math.min(ax, bx), Math.min(ay, by), Math.min(az, bz)].map((v, axis) => cellOf(v - ON_EDGE, axis));
    const hi = [Math.max(ax, bx), Math.max(ay, by), Math.max(az, bz)].map((v, axis) => cellOf(v + ON_EDGE, axis));
    for (let x = lo[0]; x <= hi[0]; x += 1) {
      for (let y = lo[1]; y <= hi[1]; y += 1) {
        for (let z = lo[2]; z <= hi[2]; z += 1) {
          for (const id of grid.get(`${x},${y},${z}`) ?? []) {
            if (id === a || id === b) continue;
            const [px, py, pz] = vertices[id];
            const t = ((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / lengthSq;
            if (t <= 1e-9 || t >= 1 - 1e-9) continue;
            const ex = ax + dx * t - px, ey = ay + dy * t - py, ez = az + dz * t - pz;
            if (ex * ex + ey * ey + ez * ez <= ON_EDGE * ON_EDGE) found.push([t, id]);
          }
        }
      }
    }
    return found.sort((p, q) => p[0] - q[0]).map(([, id]) => id);
  };

  const out: number[] = [];
  let splitTriangles = 0;
  for (let t = 0; t < corners.length; t += 3) {
    const tri = [corners[t], corners[t + 1], corners[t + 2]];
    if (tri[0] === tri[1] || tri[1] === tri[2] || tri[0] === tri[2]) continue; // collapsed by welding
    const ring: number[] = [];
    let split = false;
    for (let e = 0; e < 3; e += 1) {
      const a = tri[e];
      const b = tri[(e + 1) % 3];
      ring.push(a);
      const extra = onEdge(a, b);
      if (extra.length) {
        split = true;
        ring.push(...extra);
      }
    }
    if (!split) {
      for (const id of tri) out.push(...vertices[id]);
      continue;
    }
    splitTriangles += 1;
    const [a, b, c] = tri.map((id) => vertices[id]);
    const centre: Vec3 = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
    for (let i = 0; i < ring.length; i += 1) {
      out.push(...centre, ...vertices[ring[i]], ...vertices[ring[(i + 1) % ring.length]]);
    }
  }
  return { positions: out, splitTriangles };
}
