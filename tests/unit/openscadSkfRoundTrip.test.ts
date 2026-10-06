import { describe, expect, it } from "vitest";
import { editorHistoryEntry } from "@/lib/editorHistory";
import { LATCH_BOX_DEFAULTS } from "@/lib/latchBox";
import { openScadShapeFromStl } from "@/lib/openscadImport";
import { exportSkfProject, importSkfProject } from "@/lib/skfProject";
import { exportMeshesToStl } from "@/lib/stlExport";
import { DEFAULT_SNAP_GRID, DEFAULT_WORKPLANE_WORKSPACE } from "@/lib/workplaneSettings";
import { canonicalizeShape } from "@/lib/workplaneShapes";

const SOURCE = "$fn = 32;\ntranslate([5, -3, 0]) cylinder(h = 4, r = 2);\n";

function triangleStl() {
  return exportMeshesToStl([{ vertices: [[3, 0, -5], [7, 0, -5], [5, 4, -1]], faces: [[0, 1, 2]] }]);
}

describe("OpenSCAD shapes in .skf projects", () => {
  it("keeps openscadSource through export and import", async () => {
    const shape = canonicalizeShape(openScadShapeFromStl(triangleStl(), { source: SOURCE }));
    const history = [editorHistoryEntry([shape], [shape.id])];
    const bytes = await exportSkfProject({
      projectId: "openscad-project",
      projectName: "OpenSCAD round trip",
      createdAt: 1_700_000_000_000,
      modifiedAt: 1_700_000_100_000,
      shapes: [shape],
      history,
      historyIndex: 0,
      assets: [],
      workspace: DEFAULT_WORKPLANE_WORKSPACE,
      snapGrid: DEFAULT_SNAP_GRID,
      placementElevation: 0,
    });
    const restored = await importSkfProject(bytes);
    expect(restored.shapes).toHaveLength(1);
    expect(restored.shapes[0].id).toBe(shape.id);
    expect(restored.shapes[0].openscadSource).toBe(SOURCE);
    expect(restored.shapes[0].kind).toBe("mesh");
    expect(restored.shapes[0].importedMesh?.triangleCount).toBe(1);
    expect(restored.shapes[0].x).toBeCloseTo(shape.x);
    expect(restored.shapes[0].elevation).toBeCloseTo(shape.elevation ?? 0);
    expect(restored.history[0].shapes[0].openscadSource).toBe(SOURCE);
  });

  it("keeps box options and latch box parameters through export and import", async () => {
    const box = canonicalizeShape({
      id: "box-1",
      name: "Box",
      kind: "box",
      color: "#d41721",
      x: 0,
      z: 0,
      size: 20,
      width: 20,
      depth: 10,
      height: 6,
      rotation: 0,
      radius: 2,
      boxCorners: "vertical",
      boxWall: 1.5,
      boxFloor: 1,
    });
    const part = canonicalizeShape({
      ...openScadShapeFromStl(triangleStl(), { source: "" }),
      id: "latch-body",
      openscadSource: undefined,
      latchBox: { setId: "set-1", part: "body", params: { ...LATCH_BOX_DEFAULTS, W: 50 } },
    });
    const bytes = await exportSkfProject({
      projectId: "box-project",
      projectName: "Box options",
      createdAt: 1_700_000_000_000,
      modifiedAt: 1_700_000_100_000,
      shapes: [box, part],
      history: [editorHistoryEntry([box, part], [])],
      historyIndex: 0,
      assets: [],
      workspace: DEFAULT_WORKPLANE_WORKSPACE,
      snapGrid: DEFAULT_SNAP_GRID,
      placementElevation: 0,
    });
    const restored = await importSkfProject(bytes);
    const restoredBox = restored.shapes.find((shape) => shape.id === "box-1")!;
    expect(restoredBox.boxCorners).toBe("vertical");
    expect(restoredBox.boxWall).toBe(1.5);
    expect(restoredBox.boxFloor).toBe(1);
    const restoredPart = restored.shapes.find((shape) => shape.id === "latch-body")!;
    expect(restoredPart.latchBox?.part).toBe("body");
    expect(restoredPart.latchBox?.params.W).toBe(50);
  });
});
