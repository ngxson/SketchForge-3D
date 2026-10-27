import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { offsetTriangleSoup, triangleSoupVolume } from "@/lib/meshOffset";

function soup(geometry: THREE.BufferGeometry) {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  return Array.from(flat.getAttribute("position").array as ArrayLike<number>);
}

function lShape() {
  const shape = new THREE.Shape([[0, 0], [20, 0], [20, 6], [6, 6], [6, 14], [0, 14]].map(([x, y]) => new THREE.Vector2(x, y)));
  return soup(new THREE.ExtrudeGeometry(shape, { depth: 5, bevelEnabled: false }));
}

/** Largest error of any offset triangle corner from its source face plane moved by `distance`. */
function planeError(source: number[], offset: number[], distance: number) {
  let worst = 0;
  for (let i = 0; i < source.length; i += 9) {
    const a = new THREE.Vector3().fromArray(source, i);
    const b = new THREE.Vector3().fromArray(source, i + 3);
    const c = new THREE.Vector3().fromArray(source, i + 6);
    const normal = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    if (normal.lengthSq() < 1e-20) continue;
    normal.normalize();
    for (let k = 0; k < 3; k += 1) {
      const moved = new THREE.Vector3().fromArray(offset, i + k * 3);
      worst = Math.max(worst, Math.abs(normal.dot(moved) - normal.dot(a) - distance));
    }
  }
  return worst;
}

function bounds(positions: number[]) {
  const box = new THREE.Box3();
  for (let i = 0; i < positions.length; i += 3) box.expandByPoint(new THREE.Vector3().fromArray(positions, i));
  return box.getSize(new THREE.Vector3());
}

describe("surface offset", () => {
  it.each([
    ["box", () => soup(new THREE.BoxGeometry(10, 10, 10)), 0.1],
    ["box shrink", () => soup(new THREE.BoxGeometry(10, 10, 10)), -0.5],
    ["L-shape (inside corner)", lShape, 0.2],
    ["cylinder", () => soup(new THREE.CylinderGeometry(3, 3, 12, 48)), 0.1],
    ["cylinder shrink", () => soup(new THREE.CylinderGeometry(3, 3, 12, 48)), -0.15],
  ] as const)("moves every face exactly by the distance: %s", (_name, build, distance) => {
    const source = build();
    const offset = offsetTriangleSoup(source, distance);
    expect(offset).toHaveLength(source.length);
    expect(planeError(source, offset, distance)).toBeLessThan(1e-9);
  });

  it("grows a box to the expected size and volume", () => {
    const offset = offsetTriangleSoup(soup(new THREE.BoxGeometry(10, 10, 10)), 0.1);
    const size = bounds(offset);
    expect([size.x, size.y, size.z].map((v) => +v.toFixed(9))).toEqual([10.2, 10.2, 10.2]);
    expect(triangleSoupVolume(offset)).toBeCloseTo(10.2 ** 3, 6);
  });

  it("turns a shaft into its hole: radius + distance, flat ends moved too", () => {
    const shaft = soup(new THREE.CylinderGeometry(3, 3, 12, 64));
    const hole = offsetTriangleSoup(shaft, 0.1);
    const size = bounds(hole);
    expect(size.y).toBeCloseTo(12.2, 9);
    // Facet planes moved 0.1 mm: the inscribed radius grows by exactly 0.1.
    const inscribed = (r: number) => r * Math.cos(Math.PI / 64);
    let minRadius = Infinity;
    for (let i = 0; i < hole.length; i += 9) {
      const centre = new THREE.Vector3().fromArray(hole, i).add(new THREE.Vector3().fromArray(hole, i + 3)).add(new THREE.Vector3().fromArray(hole, i + 6)).multiplyScalar(1 / 3);
      if (Math.abs(centre.y) < 5.9) minRadius = Math.min(minRadius, Math.hypot(centre.x, centre.z));
    }
    expect(minRadius).toBeGreaterThan(inscribed(3.1) - 0.01);
  });

  it("grows a tessellated sphere by about the distance", () => {
    const offset = offsetTriangleSoup(soup(new THREE.SphereGeometry(5, 48, 32)), 0.2);
    let worst = 0;
    for (let i = 0; i < offset.length; i += 3) worst = Math.max(worst, Math.abs(Math.hypot(offset[i], offset[i + 1], offset[i + 2]) - 5.2));
    expect(worst).toBeLessThan(0.02);
  });

  it("returns an unchanged copy for a zero distance and rejects partial triangles", () => {
    const box = soup(new THREE.BoxGeometry(2, 2, 2));
    expect(offsetTriangleSoup(box, 0)).toEqual(box);
    expect(() => offsetTriangleSoup([0, 0, 0, 1, 0, 0], 0.1)).toThrow();
  });
});
