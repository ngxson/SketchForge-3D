import { beforeAll, describe, expect, it } from "vitest";
import manifoldModule, { type ManifoldToplevel } from "manifold-3d";
import {
  buildSlidingLidBox,
  DEFAULT_SLIDING_LID_BOX_PARAMS,
  normalizeSlidingLidBoxParams,
  slidingLidBoxOuterSize,
  validateSlidingLidBoxParams,
  type SlidingLidBoxParams,
} from "@/lib/slidingLidBox";

let runtime: ManifoldToplevel;

beforeAll(async () => {
  runtime = await manifoldModule();
  runtime.setup();
});

/** Rebuilds a closed solid from a triangle soup (Y-up) so Manifold can measure and combine it. */
function solidFrom(positions: number[]) {
  const mesh = new runtime.Mesh({ numProp: 3, vertProperties: new Float32Array(positions), triVerts: Uint32Array.from({ length: positions.length / 3 }, (_, i) => i) });
  mesh.merge();
  return new runtime.Manifold(mesh);
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

const outerDepth = (params: SlidingLidBoxParams) => slidingLidBoxOuterSize(params).depth;

const variants: Array<[string, Partial<SlidingLidBoxParams>]> = [
  ["default (rounded)", {}],
  ["square corners", { radius: 0 }],
  ["small radius", { radius: 1 }],
  ["large, thick walls", { width: 120, depth: 80, height: 40, radius: 12, wallThickness: 5 }],
  ["internal dimensions", { dimensionType: "internal" }],
  ["large radius, deep lip", { radius: 12, depth: 75 }],
  ["low box", { height: 10 }],
];

describe("sliding lid box", () => {
  it.each(variants)("builds closed body and lid that fit together: %s", (_name, overrides) => {
    const params = { ...DEFAULT_SLIDING_LID_BOX_PARAMS, ...overrides };
    const assembled = buildSlidingLidBox(runtime, params, { assembled: true });
    const body = solidFrom(assembled.body.positions);
    const lid = solidFrom(assembled.lid.positions);
    try {
      expect(body.status()).toBe("NoError");
      expect(lid.status()).toBe("NoError");
      expect(body.volume()).toBeGreaterThan(0);
      expect(lid.volume()).toBeGreaterThan(0);
      // Closed, the lid sits clear (the snap ridge rests in the dent under its lip). Sliding out
      // through the front (SketchForge +Z) its flat underside rides over the ridge, then clears it.
      const overlapAt = (distance: number) => {
        const moved = lid.translate([0, 0, distance]);
        const overlap = body.intersect(moved);
        const volume = overlap.volume();
        overlap.delete();
        moved.delete();
        return volume;
      };
      expect(overlapAt(0)).toBeLessThan(0.01);
      expect(overlapAt(2)).toBeGreaterThan(0.5);
      expect(overlapAt(outerDepth(params))).toBeLessThan(0.01);
      // The dovetail rails hold the lid down and the back wall stops it.
      for (const offset of [[0, 1, 0], [0, 0, -1]] as const) {
        const moved = lid.translate([...offset]);
        const overlap = body.intersect(moved);
        expect(overlap.volume()).toBeGreaterThan(20);
        overlap.delete();
        moved.delete();
      }

      // Outside size matches the parameters (Y-up: x = width, y = height, z = depth).
      const outer = slidingLidBoxOuterSize(params);
      const size = bounds(assembled.body.positions).size;
      expect(size[0]).toBeCloseTo(outer.width, 3);
      expect(size[1]).toBeCloseTo(outer.height, 3);
      expect(size[2]).toBeCloseTo(outer.depth, 3);
    } finally {
      body.delete();
      lid.delete();
    }
  });

  it("lays the lid out on the bed in front of the box", () => {
    const { body, lid } = buildSlidingLidBox(runtime, DEFAULT_SLIDING_LID_BOX_PARAMS);
    const bodyBounds = bounds(body.positions);
    const lidBounds = bounds(lid.positions);
    expect(lidBounds.min[1]).toBeCloseTo(0, 3);
    expect(bodyBounds.min[1]).toBeCloseTo(0, 3);
    // In front of the box (SketchForge +Z is the original's −Y).
    expect(lidBounds.min[2]).toBeGreaterThanOrEqual(bodyBounds.max[2] - 1e-3);
  });

  it("normalizes and validates parameters", () => {
    expect(normalizeSlidingLidBoxParams({ width: 5, wallThickness: 99, dimensionType: "x" as never })).toMatchObject({ width: 30, wallThickness: 10, dimensionType: "external" });
    expect(validateSlidingLidBoxParams(DEFAULT_SLIDING_LID_BOX_PARAMS)).toEqual([]);
    expect(validateSlidingLidBoxParams({ ...DEFAULT_SLIDING_LID_BOX_PARAMS, height: 15, wallThickness: 8 })[0]).toMatch(/Height/);
  });

  it("scales the snap latch with Latch Depth and can turn it off", () => {
    const build = (latchDepth: number) => {
      const assembled = buildSlidingLidBox(runtime, { ...DEFAULT_SLIDING_LID_BOX_PARAMS, latchDepth }, { assembled: true });
      return { body: solidFrom(assembled.body.positions), lid: solidFrom(assembled.lid.positions) };
    };
    /** Overlap once the lid has slid 10 mm: the ridge riding on the lid's underside. */
    const riding = ({ body, lid }: ReturnType<typeof build>) => {
      const moved = lid.translate([0, 0, 10]);
      const overlap = body.intersect(moved);
      const volume = overlap.volume();
      overlap.delete();
      moved.delete();
      return volume;
    };
    const off = build(0);
    const standard = build(0.25);
    const strong = build(1);
    try {
      expect(riding(off)).toBeLessThan(0.01);
      expect(riding(standard)).toBeGreaterThan(1);
      expect(riding(strong)).toBeGreaterThan(riding(standard));
      // The lid's underside stays flat: the only material removed is the small dent.
      expect(off.lid.volume() - standard.lid.volume()).toBeGreaterThan(1);
      expect(off.lid.volume() - standard.lid.volume()).toBeLessThan(30);
    } finally {
      for (const part of [off, standard, strong]) {
        part.body.delete();
        part.lid.delete();
      }
    }
  });

  it("keeps the lid flat on the bed for printing", () => {
    const { lid } = buildSlidingLidBox(runtime, DEFAULT_SLIDING_LID_BOX_PARAMS);
    const bottom = bounds(lid.positions).min[1];
    expect(bottom).toBeCloseTo(0, 6);
  });
});
