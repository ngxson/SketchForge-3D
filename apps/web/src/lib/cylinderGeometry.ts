import * as THREE from "three";
import type { WorkplaneShape } from "@/types/sketchforge";

/**
 * Hollow cylinders (fork feature, see FORK.md). `cylinderWall` > 0 hollows the cylinder with
 * an open top; `cylinderFloor` is the bottom thickness (defaults to the wall; 0 leaves the
 * bottom open too, giving a tube). Oval cylinders keep a wall of the same thickness on both
 * axes (inner radii = outer radii − wall).
 */
export const MIN_CYLINDER_WALL = 0.2;

export function cylinderHollowWall(shape: Pick<WorkplaneShape, "kind" | "cylinderWall" | "width" | "depth" | "size">) {
  if (shape.kind !== "cylinder") return 0;
  const width = shape.width ?? shape.size;
  const depth = shape.depth ?? shape.size;
  const wall = Math.min(Math.max(0, shape.cylinderWall ?? 0), maxCylinderWall(width, depth));
  return wall >= MIN_CYLINDER_WALL ? wall : 0;
}

/** True when the cylinder is solid, so the viewport can scale one shared unit cylinder. */
export function cylinderIsPlain(shape: Pick<WorkplaneShape, "kind" | "cylinderWall" | "width" | "depth" | "size">) {
  return shape.kind === "cylinder" && cylinderHollowWall(shape) === 0;
}

/** Largest wall that still leaves a hole. */
export function maxCylinderWall(width: number, depth: number) {
  return Math.max(0, Math.min(width, depth) / 2 - MIN_CYLINDER_WALL);
}

export function maxCylinderFloor(height: number) {
  return Math.max(0, height - MIN_CYLINDER_WALL);
}

export function cylinderHollowFloor(shape: Pick<WorkplaneShape, "cylinderFloor" | "height">, wall: number) {
  return Math.min(Math.max(0, shape.cylinderFloor ?? wall), maxCylinderFloor(shape.height));
}

export type HollowCylinderOptions = {
  width: number;
  depth: number;
  height: number;
  sides: number;
  wall: number;
  floor: number;
};

/**
 * Hollow cylinder centred on the origin (y from −height/2 to +height/2), built face by face:
 * outer wall, inner wall, top rim, and either a floor (bottom disc + inner floor disc) or an
 * open bottom rim. Angles follow THREE.CylinderGeometry (x = r·sin θ, z = r·cos θ).
 */
export function buildHollowCylinderGeometry(options: HollowCylinderOptions): THREE.BufferGeometry {
  const sides = Math.max(3, Math.round(options.sides));
  const rx = Math.max(0.001, options.width / 2);
  const rz = Math.max(0.001, options.depth / 2);
  const height = Math.max(0.001, options.height);
  const wall = Math.min(Math.max(MIN_CYLINDER_WALL, options.wall), maxCylinderWall(rx * 2, rz * 2));
  const floor = Math.min(Math.max(0, options.floor), maxCylinderFloor(height));
  const irx = Math.max(0.001, rx - wall);
  const irz = Math.max(0.001, rz - wall);
  const y0 = -height / 2;
  const y1 = height / 2;
  const yf = y0 + floor;

  const positions: number[] = [];
  const normals: number[] = [];
  type V = [number, number, number];
  const tri = (a: V, b: V, c: V, na: V, nb: V, nc: V) => {
    positions.push(...a, ...b, ...c);
    normals.push(...na, ...nb, ...nc);
  };
  const angle = (i: number) => ((i % sides) / sides) * Math.PI * 2;
  const ring = (radiusX: number, radiusZ: number, i: number, y: number): V => [radiusX * Math.sin(angle(i)), y, radiusZ * Math.cos(angle(i))];
  const wallNormal = (radiusX: number, radiusZ: number, i: number, sign: number): V => {
    const nx = Math.sin(angle(i)) / radiusX;
    const nz = Math.cos(angle(i)) / radiusZ;
    const length = Math.hypot(nx, nz) || 1;
    return [(sign * nx) / length, 0, (sign * nz) / length];
  };
  const up: V = [0, 1, 0];
  const down: V = [0, -1, 0];

  for (let i = 0; i < sides; i += 1) {
    const j = i + 1;
    // Outer wall, facing out.
    const oa = ring(rx, rz, i, y0);
    const ob = ring(rx, rz, j, y0);
    const oc = ring(rx, rz, j, y1);
    const od = ring(rx, rz, i, y1);
    const oni = wallNormal(rx, rz, i, 1);
    const onj = wallNormal(rx, rz, j, 1);
    tri(oa, ob, oc, oni, onj, onj);
    tri(oa, oc, od, oni, onj, oni);
    // Inner wall, facing the hole.
    const ia = ring(irx, irz, i, yf);
    const ib = ring(irx, irz, j, yf);
    const ic = ring(irx, irz, j, y1);
    const id = ring(irx, irz, i, y1);
    const ini = wallNormal(irx, irz, i, -1);
    const inj = wallNormal(irx, irz, j, -1);
    tri(ia, ic, ib, ini, inj, inj);
    tri(ia, id, ic, ini, ini, inj);
    // Top rim.
    tri(od, oc, ic, up, up, up);
    tri(od, ic, id, up, up, up);
    if (floor > 0) {
      // Bottom disc and the floor inside the hole.
      tri([0, y0, 0], ob, oa, down, down, down);
      tri([0, yf, 0], ia, ib, up, up, up);
    } else {
      // Open bottom: a rim like the top one, facing down.
      const ba = ring(irx, irz, i, y0);
      const bb = ring(irx, irz, j, y0);
      tri(oa, bb, ob, down, down, down);
      tri(oa, ba, bb, down, down, down);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  return geometry;
}

export function hollowCylinderOptionsFromShape(shape: WorkplaneShape, width: number, depth: number, height: number): HollowCylinderOptions | null {
  const wall = cylinderHollowWall({ ...shape, width, depth });
  if (!wall) return null;
  return { width, depth, height, sides: shape.sides ?? 96, wall, floor: cylinderHollowFloor({ cylinderFloor: shape.cylinderFloor, height }, wall) };
}
