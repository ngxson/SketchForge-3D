import { describe, expect, it } from "vitest";
import {
  asteriskOutline,
  asteriskPositions,
  asteriskShapePatch,
  DEFAULT_ASTERISK_PARAMS,
  maxAsteriskThickness,
  normalizeAsteriskParams,
  type AsteriskParams,
} from "@/lib/asterisk";
import { ASTERISK_ASSET_ID, makeShapeFromAsset, toolbarShapeAssets } from "@/lib/shapeCatalog";

function polygonArea(points: Array<[number, number]>) {
  return Math.abs(points.reduce((sum, [x, z], i) => {
    const [nx, nz] = points[(i + 1) % points.length];
    return sum + (x * nz - nx * z) / 2;
  }, 0));
}

/** Union of N arms: the central N-gon through the inner corners plus N strips out to the ends. */
function expectedArea({ diameter, arms, thickness }: AsteriskParams) {
  const radius = diameter / 2;
  if (arms === 2) return diameter * thickness;
  const half = Math.PI / arms;
  const corner = thickness / 2 / Math.sin(half);
  const along = thickness / 2 / Math.tan(half);
  return (arms / 2) * corner ** 2 * Math.sin(2 * half) + arms * thickness * (radius - along);
}

function signedVolume(positions: number[]) {
  let volume = 0;
  for (let i = 0; i < positions.length; i += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = positions.slice(i, i + 9);
    volume += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return volume;
}

describe("asterisk", () => {
  it.each([
    ["default (6 arms)", DEFAULT_ASTERISK_PARAMS],
    ["5 arms", { ...DEFAULT_ASTERISK_PARAMS, arms: 5 }],
    ["8 thin arms", { diameter: 40, arms: 8, thickness: 2, height: 3 }],
    ["2 arms (a bar)", { diameter: 20, arms: 2, thickness: 4, height: 2 }],
  ] as const)("builds an exact, closed, outward-facing solid: %s", (_name, params) => {
    const outline = asteriskOutline(params);
    expect(outline).toHaveLength(params.arms === 2 ? 4 : params.arms * 3);
    expect(polygonArea(outline)).toBeCloseTo(expectedArea(params), 6);
    expect(signedVolume(asteriskPositions(params))).toBeCloseTo(expectedArea(params) * params.height, 3);
  });

  it("measures the diameter across the end faces, with a vertical first arm", () => {
    const { width, depth, height } = asteriskShapePatch(DEFAULT_ASTERISK_PARAMS);
    // Vertical arms span the full diameter in depth (Z); the slanted ones set the width.
    expect(depth).toBeCloseTo(30, 6);
    expect(width).toBeCloseTo(2 * (15 * Math.cos(Math.PI / 6) + 3 * Math.sin(Math.PI / 6)), 6);
    expect(height).toBe(5);
  });

  it("centres odd arm counts on their bounding box", () => {
    const { importedMesh } = asteriskShapePatch({ ...DEFAULT_ASTERISK_PARAMS, arms: 5 });
    const xs = importedMesh!.positions.filter((_, i) => i % 3 === 0);
    const zs = importedMesh!.positions.filter((_, i) => i % 3 === 2);
    expect(Math.min(...xs) + Math.max(...xs)).toBeCloseTo(0, 6);
    expect(Math.min(...zs) + Math.max(...zs)).toBeCloseTo(0, 6);
  });

  it("clamps the thickness so every arm still has an end", () => {
    const params = normalizeAsteriskParams({ diameter: 30, arms: 12, thickness: 50 });
    expect(params.thickness).toBeCloseTo(maxAsteriskThickness(30, 12), 6);
    expect(normalizeAsteriskParams({ arms: 99 }).arms).toBe(80);
  });

  it("is added from the Shapes menu", () => {
    const asset = toolbarShapeAssets.find((entry) => entry.id === ASTERISK_ASSET_ID)!;
    expect(makeShapeFromAsset(asset)).toMatchObject({ name: "Asterisk", kind: "mesh", asterisk: DEFAULT_ASTERISK_PARAMS, height: 5 });
  });

  describe("showing only some arms", () => {
    /**
     * Reference area by sampling: inside one of the shown arm rectangles (from the centre to the
     * end), or within half the arm width of the centre when the blank sector is 180° or more.
     */
    function sampledArea(params: AsteriskParams) {
      const { diameter, arms, thickness } = normalizeAsteriskParams(params);
      const shown = normalizeAsteriskParams(params).visibleArms ?? arms;
      const radius = diameter / 2;
      const step = (Math.PI * 2) / arms;
      const roundBack = Math.PI * 2 - (shown - 1) * step >= Math.PI - 1e-9;
      const axes = Array.from({ length: shown }, (_, i) => -Math.PI / 2 + i * step).map((a) => [Math.cos(a), Math.sin(a)]);
      const cell = 0.05;
      let count = 0;
      for (let x = -radius; x <= radius; x += cell) {
        for (let z = -radius; z <= radius; z += cell) {
          const inArm = axes.some(([ux, uz]) => {
            const along = x * ux + z * uz;
            return along >= 0 && along <= radius && Math.abs(-x * uz + z * ux) <= thickness / 2;
          });
          if (inArm || (roundBack && Math.hypot(x, z) <= thickness / 2)) count += 1;
        }
      }
      return count * cell * cell;
    }

    it.each([
      ["10 of 24", { diameter: 30, arms: 24, thickness: 1.5, height: 2, visibleArms: 10 }],
      ["1 of 6 (rounded back)", { ...DEFAULT_ASTERISK_PARAMS, visibleArms: 1 }],
      ["2 of 6", { ...DEFAULT_ASTERISK_PARAMS, visibleArms: 2 }],
      ["4 of 6 (blank sector under 180°)", { ...DEFAULT_ASTERISK_PARAMS, visibleArms: 4 }],
      ["3 of 4 (exactly 180°)", { ...DEFAULT_ASTERISK_PARAMS, arms: 4, visibleArms: 3 }],
      ["40 of 80", { diameter: 60, arms: 80, thickness: 1, height: 2, visibleArms: 40 }],
    ] as const)("draws a simple outline matching the shown arms: %s", (_name, params) => {
      const area = polygonArea(asteriskOutline(params));
      expect(Math.abs(area - sampledArea(params)) / area).toBeLessThan(0.02);
      expect(signedVolume(asteriskPositions(params))).toBeCloseTo(area * params.height, 2);
    });

    it("treats showing all arms as the full asterisk", () => {
      expect(normalizeAsteriskParams({ ...DEFAULT_ASTERISK_PARAMS, visibleArms: 6 }).visibleArms).toBeUndefined();
      expect(normalizeAsteriskParams({ ...DEFAULT_ASTERISK_PARAMS, visibleArms: 0 }).visibleArms).toBe(1);
      expect(asteriskOutline({ ...DEFAULT_ASTERISK_PARAMS, visibleArms: 6 })).toEqual(asteriskOutline(DEFAULT_ASTERISK_PARAMS));
    });
  });

  describe("rounding", () => {
    const base: AsteriskParams = { diameter: 40, arms: 6, thickness: 6, height: 6 };
    /** Area cut from (or added to) a corner of angle θ between its edges by an arc of radius r. */
    const cornerArea = (r: number, theta: number) => r * r * (1 / Math.tan(theta / 2) - (Math.PI - theta) / 2);

    it("keeps the sharp shape without rounding", () => {
      expect(asteriskOutline({ ...base })).toEqual(asteriskOutline({ ...base, roundingRadius: 2 }));
    });




    /** (x, y) of the vertices on the flat end face of the first arm (it points to −Z). */
    const endFace = (positions: number[], radius: number) => {
      const points: Array<[number, number]> = [];
      for (let i = 0; i < positions.length; i += 3) {
        if (Math.abs(positions[i + 2] + radius) < 1e-9) points.push([positions[i], positions[i + 1]]);
      }
      return points;
    };

    it("rounds the long edges of every arm: the arm cross-section is a rounded rectangle (Outward faces)", () => {
      const params = { ...base, thickness: 6, height: 4, rounding: "arms" as const, roundingRadius: 1.5 };
      const positions = asteriskPositions(params);
      const face = endFace(positions, params.diameter / 2);
      expect(face.length).toBeGreaterThan(8);
      const half = params.thickness / 2;
      for (const [x, y] of face) {
        expect(Math.abs(x)).toBeLessThanOrEqual(half + 1e-9);
        expect(y).toBeGreaterThanOrEqual(-1e-9);
        expect(y).toBeLessThanOrEqual(params.height + 1e-9);
        const inCorner = Math.abs(x) > half - 1.5 + 1e-9 && (y < 1.5 - 1e-9 || y > params.height - 1.5 + 1e-9);
        if (inCorner) {
          const cy = y < params.height / 2 ? 1.5 : params.height - 1.5;
          expect(Math.hypot(Math.abs(x) - (half - 1.5), y - cy)).toBeCloseTo(1.5, 9);
        }
      }
      // Full width at mid-height and full arm length: the footprint is unchanged.
      const sharp = asteriskShapePatch({ ...params, rounding: undefined });
      const rounded = asteriskShapePatch(params);
      expect(rounded.width).toBeCloseTo(sharp.width, 5); // the sharp mesh comes from three.js in 32-bit floats
      expect(rounded.depth).toBeCloseTo(sharp.depth, 5);
      expect(rounded.height).toBe(4);
      expect(signedVolume(positions)).toBeLessThan(signedVolume(asteriskPositions({ ...params, rounding: undefined })));
      expect(signedVolume(positions)).toBeGreaterThan(0);
    });

    it("cuts round holes when thickness = height and the radius is half of it", () => {
      const params = { ...base, thickness: 6, height: 6, rounding: "arms" as const, roundingRadius: 3 };
      const face = endFace(asteriskPositions(params), params.diameter / 2);
      // Capped at 98% of half the thickness so the caps stay proper polygons: within 0.07 mm of a circle.
      for (const [x, y] of face) expect(Math.abs(Math.hypot(x, y - 3) - 3)).toBeLessThan(0.07);
    });

    it("rounds arm ends and fills inside corners (All edges, plan view)", () => {
      const r = 1.5;
      const area = polygonArea(asteriskOutline({ ...base, rounding: "all", roundingRadius: r }));
      const step = (Math.PI * 2) / base.arms;
      const expected = expectedArea(base) - 2 * base.arms * cornerArea(r, Math.PI / 2) + base.arms * cornerArea(r, step);
      expect(Math.abs(area - expected) / expected).toBeLessThan(2e-3);
    });



    it.each(["all", "topBottom"] as const)("rounds the top and bottom edges without changing the size: %s", (rounding) => {
      const sharp = asteriskShapePatch(base);
      const rounded = asteriskShapePatch({ ...base, rounding, roundingRadius: 1 });
      expect(rounded.height).toBe(6);
      const ys = rounded.importedMesh!.positions.filter((_, i) => i % 3 === 1);
      expect(Math.min(...ys)).toBeCloseTo(0, 6);
      expect(Math.max(...ys)).toBeCloseTo(6, 6);
      if (rounding === "topBottom") {
        expect(rounded.width).toBeCloseTo(sharp.width, 6);
        expect(rounded.depth).toBeCloseTo(sharp.depth, 6);
      }
      const roundedVolume = signedVolume(rounded.importedMesh!.positions);
      expect(roundedVolume).toBeGreaterThan(0);
      expect(roundedVolume).toBeLessThan(signedVolume(sharp.importedMesh!.positions));
    });

    it("works with partial fans and odd arm counts", () => {
      for (const params of [
        { ...base, arms: 24, thickness: 3, visibleArms: 10, rounding: "all" as const, roundingRadius: 1 },
        { ...base, arms: 5, rounding: "all" as const, roundingRadius: 2 },
        { ...base, arms: 2, rounding: "arms" as const, roundingRadius: 3 },
        { ...base, arms: 24, thickness: 3, visibleArms: 10, rounding: "arms" as const, roundingRadius: 1.4 },
      ]) {
        const volume = signedVolume(asteriskPositions(params));
        const prism = polygonArea(asteriskOutline(params)) * params.height;
        expect(volume).toBeGreaterThan(0);
        // "all" also rounds the top and bottom edges and "arms" the long edges of the arms,
        // which take a little off the plain prism.
        if (params.rounding === "all" || params.rounding === "arms") {
          expect(volume).toBeLessThan(prism);
          expect(volume).toBeGreaterThan(prism * 0.7);
        } else {
          expect(volume).toBeCloseTo(prism, 1);
        }
      }
    });
  });
});

