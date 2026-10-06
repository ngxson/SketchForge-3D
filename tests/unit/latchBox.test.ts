import { describe, expect, it } from "vitest";
import { buildLatchBox, LATCH_BOX_DEFAULTS, normalizeLatchBoxParams, validateLatchBoxParams } from "@/lib/latchBox";
import { latchBoxShapeFromMesh } from "@/lib/latchBoxShapes";

function bounds(positions: Float32Array | number[]) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], positions[i + axis]);
      max[axis] = Math.max(max[axis], positions[i + axis]);
    }
  }
  return { min, max };
}

describe("latch box generator", () => {
  it("accepts the measured defaults", () => {
    expect(validateLatchBoxParams(LATCH_BOX_DEFAULTS)).toEqual([]);
  });

  it("reports impossible parameters", () => {
    expect(validateLatchBoxParams({ ...LATCH_BOX_DEFAULTS, wall: 1.2 })).toContain("Wall must be at least 0.6 mm thicker than the undercut.");
    expect(validateLatchBoxParams({ ...LATCH_BOX_DEFAULTS, latchCount: 6 })[0]).toMatch(/Latches do not fit/);
  });

  it("normalizes partial input", () => {
    const params = normalizeLatchBoxParams({ W: 60, latchCount: 2.4, hookStyle: "thin", segments: 1000, padOn: false });
    expect(params.W).toBe(60);
    expect(params.H).toBe(LATCH_BOX_DEFAULTS.H);
    expect(params.latchCount).toBe(2);
    expect(params.hookStyle).toBe("thin");
    expect(params.segments).toBe(128);
    expect(params.padOn).toBe(false);
  });

  it("builds a body and a cover with the expected extents", () => {
    const { body, cover } = buildLatchBox({ ...LATCH_BOX_DEFAULTS, segments: 16 });
    expect(body.positions.length).toBeGreaterThan(9);
    expect(body.positions.length % 9).toBe(0);
    expect(body.normals.length).toBe(body.positions.length);
    const b = bounds(body.positions);
    expect(b.max[0] - b.min[0]).toBeCloseTo(43, 2);
    expect(b.max[1] - b.min[1]).toBeCloseTo(55, 2);
    expect(b.min[2]).toBeCloseTo(0, 2);
    expect(b.max[2]).toBeCloseTo(19, 2);
    const c = bounds(cover.positions);
    expect(c.max[0] - c.min[0]).toBeCloseTo(43, 2);
    expect(c.min[2]).toBeCloseTo(0, 2);
    expect(c.max[2]).toBeCloseTo(1.4 + 3.8, 2);
  }, 60_000);

  it("throws for invalid parameters", () => {
    expect(() => buildLatchBox({ ...LATCH_BOX_DEFAULTS, front: 0.1 })).toThrow(/Front plate/);
  });

  it("turns a part into a Y-up scene shape", () => {
    const { body } = buildLatchBox({ ...LATCH_BOX_DEFAULTS, segments: 16 });
    const shape = latchBoxShapeFromMesh("body", body, { setId: "set-1", params: LATCH_BOX_DEFAULTS }, { placement: { x: 5, z: -4, elevation: 0 } });
    expect(shape.kind).toBe("mesh");
    expect(shape.width).toBeCloseTo(43, 2);
    expect(shape.depth).toBeCloseTo(55, 2);
    expect(shape.height).toBeCloseTo(19, 2);
    expect(shape.x).toBe(5);
    expect(shape.z).toBe(-4);
    expect(shape.latchBox?.part).toBe("body");
    expect(shape.latchBox?.setId).toBe("set-1");
    const local = bounds(shape.importedMesh!.positions);
    expect(local.min[1]).toBeCloseTo(0, 3);
    expect(local.max[1]).toBeCloseTo(19, 2);
    expect(local.min[0]).toBeCloseTo(-21.5, 2);
  }, 60_000);
});
