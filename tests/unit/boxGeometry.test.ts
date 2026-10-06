import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { boxIsPlain, createBoxGeometry, maxBoxWall } from "@/lib/boxGeometry";

function bounds(geometry: THREE.BufferGeometry) {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  return { min: box.min.toArray(), max: box.max.toArray() };
}

function triangles(geometry: THREE.BufferGeometry) {
  const index = geometry.getIndex();
  return Math.floor((index ? index.count : geometry.getAttribute("position").count) / 3);
}

/** Casts a ray straight down the Y axis at (x, z) and returns the hit heights. */
function verticalHits(geometry: THREE.BufferGeometry, x: number, z: number) {
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  const raycaster = new THREE.Raycaster(new THREE.Vector3(x, 100, z), new THREE.Vector3(0, -1, 0));
  return raycaster.intersectObject(mesh).map((hit) => Number(hit.point.y.toFixed(3)));
}

describe("createBoxGeometry", () => {
  it("builds a plain centred cuboid", () => {
    const geometry = createBoxGeometry({ width: 20, depth: 10, height: 6 });
    expect(bounds(geometry)).toEqual({ min: [-10, -3, -5], max: [10, 3, 5] });
    expect(triangles(geometry)).toBe(12);
  });

  it("rounds only the vertical edges when asked", () => {
    const geometry = createBoxGeometry({ width: 20, depth: 10, height: 6, radius: 3, corners: "vertical", steps: 8 });
    const { min, max } = bounds(geometry);
    expect(min[0]).toBeCloseTo(-10, 3);
    expect(max[0]).toBeCloseTo(10, 3);
    expect(min[1]).toBeCloseTo(-3, 3);
    expect(max[1]).toBeCloseTo(3, 3);
    expect(min[2]).toBeCloseTo(-5, 3);
    expect(max[2]).toBeCloseTo(5, 3);
    // The top face is flat all the way to the rounded corner (no vertical rounding) …
    expect(verticalHits(geometry, 9.9, 0)[0]).toBeCloseTo(3, 3);
    // … but the footprint corner itself is cut away.
    expect(verticalHits(geometry, 9.9, 4.9)).toHaveLength(0);
  });

  it("rounds every edge in the default style", () => {
    const geometry = createBoxGeometry({ width: 20, depth: 10, height: 6, radius: 2, corners: "all", steps: 4 });
    // Near the edge the surface curves down from the top face.
    const nearEdge = verticalHits(geometry, 9.9, 0)[0];
    expect(nearEdge).toBeLessThan(3);
    expect(nearEdge).toBeGreaterThan(1);
  });

  it("hollows the box with an open top and a floor", () => {
    const geometry = createBoxGeometry({ width: 20, depth: 10, height: 6, wall: 2, floor: 1 });
    expect(bounds(geometry).max[1]).toBeCloseTo(3, 3);
    // Through the middle: the ray enters at the floor top (-2) and exits at the bottom (-3).
    const middle = verticalHits(geometry, 0, 0);
    expect(middle[0]).toBeCloseTo(-2, 3);
    expect(middle[middle.length - 1]).toBeCloseTo(-3, 3);
    // Through the wall: solid from top to bottom.
    const wall = verticalHits(geometry, 9, 0);
    expect(wall[0]).toBeCloseTo(3, 3);
    expect(wall[wall.length - 1]).toBeCloseTo(-3, 3);
  });

  it("keeps the floor by default equal to the wall and clamps impossible walls", () => {
    expect(maxBoxWall(20, 10)).toBeCloseTo(4.8);
    const geometry = createBoxGeometry({ width: 20, depth: 10, height: 6, wall: 50 });
    const middle = verticalHits(geometry, 0, 0);
    // Wall clamped to 4.8 leaves a 0.4 mm cavity; floor = clamped wall → floor top at -3 + 4.8.
    expect(middle[0]).toBeCloseTo(1.8, 3);
  });

  it("reports plain boxes", () => {
    expect(boxIsPlain({ kind: "box" })).toBe(true);
    expect(boxIsPlain({ kind: "box", radius: 2 })).toBe(false);
    expect(boxIsPlain({ kind: "box", boxWall: 1 })).toBe(false);
    expect(boxIsPlain({ kind: "cylinder" })).toBe(false);
  });
});
