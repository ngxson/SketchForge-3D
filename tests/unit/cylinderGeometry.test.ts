import { describe, expect, it } from "vitest";
import { buildHollowCylinderGeometry, cylinderHollowFloor, cylinderHollowWall, cylinderIsPlain } from "@/lib/cylinderGeometry";
import type { WorkplaneShape } from "@/types/sketchforge";

function cylinder(overrides: Partial<WorkplaneShape> = {}): WorkplaneShape {
  return { id: "c", name: "Cylinder", kind: "cylinder", color: "#d97813", x: 0, z: 0, elevation: 0, size: 20, width: 20, depth: 20, height: 20, rotation: 0, sides: 32, ...overrides };
}

function analyse(options: Parameters<typeof buildHollowCylinderGeometry>[0]) {
  const geometry = buildHollowCylinderGeometry(options);
  const p = geometry.getAttribute("position").array;
  const n = geometry.getAttribute("normal").array;
  let volume = 0;
  let facingWrong = 0;
  for (let i = 0; i < p.length; i += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = Array.from(p.slice(i, i + 9));
    volume += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    // Face normal from the winding must agree with the stored vertex normal.
    const fx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
    const fy = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    const fz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (fx * n[i] + fy * n[i + 1] + fz * n[i + 2] <= 0) facingWrong += 1;
  }
  return { volume, facingWrong };
}

/** Area of the regular polygon (sides) inscribed in an ellipse with radii rx, rz. */
const polygonArea = (rx: number, rz: number, sides: number) => (sides / 2) * rx * rz * Math.sin((2 * Math.PI) / sides);

describe("hollow cylinder", () => {
  it("is plain until a wall is set", () => {
    expect(cylinderIsPlain(cylinder())).toBe(true);
    expect(cylinderIsPlain(cylinder({ cylinderWall: 2 }))).toBe(false);
    expect(cylinderIsPlain(cylinder({ cylinderWall: 0.1 }))).toBe(true);
    expect(cylinderHollowWall(cylinder({ cylinderWall: 50 }))).toBeCloseTo(9.8, 6);
  });

  it("defaults the floor to the wall and keeps an explicit 0", () => {
    expect(cylinderHollowFloor(cylinder(), 2)).toBe(2);
    expect(cylinderHollowFloor(cylinder({ cylinderFloor: 0 }), 2)).toBe(0);
    expect(cylinderHollowFloor(cylinder({ cylinderFloor: 40 }), 2)).toBeCloseTo(19.8, 6);
  });

  it.each([
    ["cup", { floor: 3 }],
    ["open tube", { floor: 0 }],
  ])("builds a closed, outward-facing %s", (_name, { floor }) => {
    const options = { width: 20, depth: 30, height: 12, sides: 32, wall: 2, floor };
    const { volume, facingWrong } = analyse(options);
    const expected = polygonArea(10, 15, 32) * 12 - polygonArea(8, 13, 32) * (12 - floor);
    expect(facingWrong).toBe(0);
    expect(volume).toBeCloseTo(expected, 3);
  });
});
