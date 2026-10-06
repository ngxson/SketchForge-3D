import { describe, expect, it } from "vitest";
import { editorHistoryEntry } from "@/lib/editorHistory";
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
});
