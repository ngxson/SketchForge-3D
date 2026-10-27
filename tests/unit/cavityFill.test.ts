import { beforeAll, describe, expect, it } from "vitest";
import manifoldModule, { type ManifoldToplevel } from "manifold-3d";
import * as THREE from "three";
import { createBoxGeometry } from "@/lib/boxGeometry";
import { cavityFillPositions } from "@/lib/cavityFill";
import { repairTJunctions } from "@/lib/meshRepair";

let runtime: ManifoldToplevel;
beforeAll(async () => {
  runtime = await manifoldModule();
  runtime.setup();
});

type Solid = InstanceType<ManifoldToplevel["Manifold"]>;

function soupOf(solid: Solid) {
  const mesh = solid.getMesh();
  const out: number[] = [];
  for (let i = 0; i < mesh.triVerts.length; i += 1) {
    const o = mesh.triVerts[i] * mesh.numProp;
    out.push(mesh.vertProperties[o], mesh.vertProperties[o + 1], mesh.vertProperties[o + 2]);
  }
  return out;
}

function bounds(positions: number[]) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let a = 0; a < 3; a += 1) {
      min[a] = Math.min(min[a], positions[i + a]);
      max[a] = Math.max(max[a], positions[i + a]);
    }
  }
  return { min, max, size: max.map((v, a) => v - min[a]) };
}

/** Open-top box, 20 × 10 tall × 20, wall 2, floor 2 (Y up). */
function openBox() {
  const { Manifold } = runtime;
  const outer = Manifold.cube([20, 10, 20]);
  const inner = Manifold.cube([16, 9, 16]).translate([2, 2, 2]);
  return outer.subtract(inner);
}

describe("fill hollow", () => {
  it("fills an open box exactly", () => {
    const result = cavityFillPositions(runtime, soupOf(openBox()));
    if (!result.ok) throw new Error(result.reason);
    const { min, size } = bounds(result.positions);
    expect(size.map((v) => +v.toFixed(6))).toEqual([16, 8, 16]);
    expect(min.map((v) => +v.toFixed(6))).toEqual([2, 2, 2]);
    expect(result.volume).toBeCloseTo(16 * 8 * 16, 3);
  });

  it("shrinks the fill by the clearance so it fits", () => {
    const result = cavityFillPositions(runtime, soupOf(openBox()), 0.1);
    if (!result.ok) throw new Error(result.reason);
    const { min, size } = bounds(result.positions);
    expect(size.map((v) => +v.toFixed(6))).toEqual([15.8, 7.8, 15.8]);
    expect(min.map((v) => +v.toFixed(6))).toEqual([2.1, 2.1, 2.1]);
  });

  it("fills a hollow profile like an arched cover (hollow running through)", () => {
    const { CrossSection } = runtime;
    // Outer: flat bottom, slanted sides, arched top. Inner: the same, smaller, flat top.
    const arc = Array.from({ length: 33 }, (_, i) => {
      const a = Math.PI * (0.15 + 0.7 * (i / 32));
      return [30 * Math.cos(a), 30 * Math.sin(a) - 16] as [number, number];
    });
    const outer = [[-12, 0], [12, 0], ...arc.map(([x, y]) => [x, y] as [number, number]).filter(([x]) => Math.abs(x) <= 24.6)];
    // Kept inside the walls everywhere (the arc is at y ≈ 9.4 above x = ±16, ≈ 12.3 above x = ±10).
    const hole: Array<[number, number]> = [[-10, 2], [10, 2], [16, 5], [10, 9], [-10, 9], [-16, 5]];
    const profile = new CrossSection([outer as Array<[number, number]>]).subtract(new CrossSection([hole]));
    const part = profile.extrude(40);
    const result = cavityFillPositions(runtime, soupOf(part));
    if (!result.ok) throw new Error(result.reason);
    const holeArea = Math.abs(new CrossSection([hole]).area());
    expect(result.volume).toBeCloseTo(holeArea * 40, 1);
    expect(bounds(result.positions).size[2]).toBeCloseTo(40, 6);
  });

  it("uses the largest empty region when there are several", () => {
    const { Manifold } = runtime;
    // An open box with a small notch cut into the outside of one wall.
    const notched = openBox().subtract(Manifold.cube([1, 3, 4]).translate([-0.01, 4, 8]));
    const result = cavityFillPositions(runtime, soupOf(notched));
    if (!result.ok) throw new Error(result.reason);
    expect(result.regions).toBe(2);
    expect(result.volume).toBeCloseTo(16 * 8 * 16, 3);
  });

  it("reports when there is nothing to fill or the clearance is too big", () => {
    const solid = cavityFillPositions(runtime, soupOf(runtime.Manifold.cube([10, 10, 10])));
    expect(solid).toMatchObject({ ok: false });
    expect(!solid.ok && solid.reason).toMatch(/no hollow/);
    const tooBig = cavityFillPositions(runtime, soupOf(openBox()), 5);
    expect(tooBig.ok).toBe(false);
  });

  it("fills a hollow box built by three-bvh-csg (T-junctions repaired first)", () => {
    const geometry = createBoxGeometry({ width: 20, depth: 20, height: 20, wall: 2, floor: 2 });
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    const positions = Array.from(flat.getAttribute("position").array as ArrayLike<number>);
    // Confirm the input really needs the repair.
    expect(repairTJunctions(positions).splitTriangles).toBeGreaterThan(0);
    const result = cavityFillPositions(runtime, positions, 0.1);
    if (!result.ok) throw new Error(result.reason);
    const { min, size } = bounds(result.positions);
    // Inside: x, z ±8 and y from −10 + floor 2 up to the open top at +10; minus 0.1 on each face.
    expect(size.map((v) => +v.toFixed(5))).toEqual([15.8, 17.8, 15.8]);
    expect(min.map((v) => +v.toFixed(5))).toEqual([-7.9, -7.9, -7.9]);
  });

  it("repairs a T-junction so the mesh becomes edge-manifold", () => {
    // A unit cube whose top face is split into two triangles plus a third that puts a vertex in
    // the middle of the shared diagonal's neighbour edge: build it from a box and split one
    // top-face triangle at the midpoint of its outer edge only (the neighbour face keeps it whole).
    const box = Array.from((new THREE.BoxGeometry(2, 2, 2).toNonIndexed().getAttribute("position").array) as ArrayLike<number>);
    const top = box.slice(2 * 18, 2 * 18 + 9); // first +Y triangle
    const [a, b, c] = [top.slice(0, 3), top.slice(3, 6), top.slice(6, 9)];
    const mid = a.map((v, i) => (v + b[i]) / 2);
    const withT = [...box.slice(0, 2 * 18), ...a, ...mid, ...c, ...mid, ...b, ...c, ...box.slice(2 * 18 + 9)];
    const repaired = repairTJunctions(withT);
    expect(repaired.splitTriangles).toBe(1);
    const mesh = new runtime.Mesh({ numProp: 3, vertProperties: new Float32Array(repaired.positions), triVerts: Uint32Array.from({ length: repaired.positions.length / 3 }, (_, i) => i) });
    mesh.merge();
    const solid = new runtime.Manifold(mesh);
    expect(solid.status()).toBe("NoError");
    expect(solid.volume()).toBeCloseTo(8, 6);
    solid.delete();
  });
});

