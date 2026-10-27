import { describe, expect, it } from "vitest";
import {
  DEFAULT_DOVETAIL_PARAMS,
  dovetailPositions,
  dovetailProfile,
  dovetailShapePatch,
  normalizeDovetailParams,
  validateDovetailParams,
  type DovetailParams,
} from "@/lib/dovetail";
import { editorHistoryEntry } from "@/lib/editorHistory";
import { DOVETAIL_ASSET_ID, makeShapeFromAsset, toolbarShapeAssets } from "@/lib/shapeCatalog";
import { exportSkfProject, importSkfProject } from "@/lib/skfProject";
import { DEFAULT_SNAP_GRID, DEFAULT_WORKPLANE_WORKSPACE } from "@/lib/workplaneSettings";
import { canonicalizeShape } from "@/lib/workplaneShapes";

const male = DEFAULT_DOVETAIL_PARAMS;
const female: DovetailParams = { ...DEFAULT_DOVETAIL_PARAMS, side: "female" };

function signedVolume(positions: number[]) {
  let volume = 0;
  for (let i = 0; i < positions.length; i += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = positions.slice(i, i + 9);
    volume += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return volume;
}

function polygonArea(points: Array<[number, number]>) {
  return points.reduce((sum, [x, y], i) => {
    const [nx, ny] = points[(i + 1) % points.length];
    return sum + (x * ny - nx * y) / 2;
  }, 0);
}

/** Half-width of the slot or tail at height y, from a profile's flank vertices. */
function halfWidthAt(a: [number, number], b: [number, number], y: number) {
  return a[0] + ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]);
}

describe("dovetail", () => {
  it("builds the male tail on a base plate", () => {
    const profile = dovetailProfile(male);
    const neck = 14 - 2 * 6 * Math.tan((15 * Math.PI) / 180);
    expect(profile).toHaveLength(8);
    expect(profile[3][0]).toBeCloseTo(neck / 2, 6);
    expect(profile[4]).toEqual([7, 11]);
    expect(Math.max(...profile.map(([, y]) => y))).toBe(11);
  });

  it("builds the female slot narrow at the top and grown by the clearance", () => {
    const profile = dovetailProfile(female);
    const tail = dovetailProfile(male);
    // Female block is base + tail depth tall; the slot floor sits clearance below the tail depth.
    expect(profile[2][1]).toBe(11);
    expect(profile[4][1]).toBeCloseTo(11 - 6.2, 6);
    // Male flipped into the slot: its tail (neck at the opening, wide end at the bottom) keeps
    // at least the clearance to the slot flank everywhere.
    const cos = Math.cos((15 * Math.PI) / 180);
    for (const depth of [0, 3, 6]) {
      const slotHalf = halfWidthAt(profile[3], profile[4], 11 - depth);
      const tailHalf = halfWidthAt(tail[3], tail[4], 5 + depth);
      expect((slotHalf - tailHalf) * cos).toBeCloseTo(0.2, 6);
    }
  });

  it("produces closed, outward-facing meshes for both sides", () => {
    for (const params of [male, female, { ...male, base: 0 }]) {
      const positions = dovetailPositions(params);
      expect(signedVolume(positions)).toBeCloseTo(polygonArea(dovetailProfile(params)) * params.length, 3);
      expect(polygonArea(dovetailProfile(params))).toBeGreaterThan(0);
    }
  });

  it("sizes the shape from the parameters", () => {
    expect(dovetailShapePatch(male)).toMatchObject({ width: 30, depth: 30, height: 11 });
    expect(dovetailShapePatch({ ...male, base: 0 })).toMatchObject({ width: 14, height: 6 });
    expect(dovetailShapePatch({ ...female, width: 40, length: 50 })).toMatchObject({ width: 40, depth: 50, height: 11 });
  });

  it("normalizes and validates parameters", () => {
    expect(normalizeDovetailParams({ side: "x" as never, angle: 90, length: -4 })).toMatchObject({ side: "male", angle: 40, length: 1 });
    expect(validateDovetailParams(male)).toEqual([]);
    expect(validateDovetailParams(female)).toEqual([]);
    expect(validateDovetailParams({ ...male, angle: 40, tailDepth: 10 })[0]).toMatch(/neck/);
    expect(validateDovetailParams({ ...female, width: 15 })[0]).toMatch(/Width must be at least/);
    expect(validateDovetailParams({ ...female, base: 0.3 })[0]).toMatch(/Floor must be at least/);
  });

  it("is added from the Shapes menu as a male dovetail", () => {
    const asset = toolbarShapeAssets.find((entry) => entry.id === DOVETAIL_ASSET_ID)!;
    const shape = makeShapeFromAsset(asset);
    expect(shape).toMatchObject({ name: "Dovetail", kind: "mesh", width: 30, depth: 30, height: 11, dovetail: male });
    expect(shape.importedMesh?.triangleCount).toBeGreaterThan(0);
  });

  it("keeps its parameters in .skf projects", async () => {
    const asset = toolbarShapeAssets.find((entry) => entry.id === DOVETAIL_ASSET_ID)!;
    const shape = canonicalizeShape({ ...makeShapeFromAsset(asset), ...dovetailShapePatch(female) });
    const bytes = await exportSkfProject({
      projectId: "dovetail-project",
      projectName: "Dovetail round trip",
      createdAt: 1_700_000_000_000,
      modifiedAt: 1_700_000_100_000,
      shapes: [shape],
      history: [editorHistoryEntry([shape], [shape.id])],
      historyIndex: 0,
      assets: [],
      workspace: DEFAULT_WORKPLANE_WORKSPACE,
      snapGrid: DEFAULT_SNAP_GRID,
      placementElevation: 0,
    });
    const restored = await importSkfProject(bytes);
    expect(restored.shapes[0].dovetail).toEqual(female);
    expect(restored.shapes[0].importedMesh?.triangleCount).toBe(shape.importedMesh?.triangleCount);
  });
});
