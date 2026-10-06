import { describe, expect, it } from "vitest";
import { isOpenScadShape, openScadShapeFromStl } from "@/lib/openscadImport";
import { exportMeshesToStl } from "@/lib/stlExport";
import type { WorkplaneShape } from "@/types/sketchforge";

// A 10 × 4 × 6 box (SketchForge Y-up) whose centre is at x=20, z=-5 and whose base sits at y=3.
function boxStl() {
  const x0 = 15, x1 = 25, y0 = 3, y1 = 7, z0 = -8, z1 = -2;
  const vertices: [number, number, number][] = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ];
  const faces: [number, number, number][] = [
    [0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7],
    [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5],
    [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7],
  ];
  // exportMeshesToStl converts to Z-up, exactly what OpenSCAD emits.
  return exportMeshesToStl([{ vertices, faces }]);
}

describe("openScadShapeFromStl", () => {
  it("keeps the world placement OpenSCAD produced", () => {
    const shape = openScadShapeFromStl(boxStl(), { source: "cube(1);" });
    expect(shape.kind).toBe("mesh");
    expect(shape.x).toBeCloseTo(20);
    expect(shape.z).toBeCloseTo(-5);
    expect(shape.elevation).toBeCloseTo(3);
    expect(shape.width).toBeCloseTo(10);
    expect(shape.height).toBeCloseTo(4);
    expect(shape.depth).toBeCloseTo(6);
    expect(shape.importedMesh?.triangleCount).toBe(12);
    expect(shape.importedMesh?.sourceFormat).toBe("json");
    expect(shape.openscadSource).toBe("cube(1);");
    expect(isOpenScadShape(shape)).toBe(true);
    // Local positions are X/Z centred with the base at y = 0.
    const positions = shape.importedMesh!.positions;
    const ys = positions.filter((_, index) => index % 3 === 1);
    expect(Math.min(...ys)).toBeCloseTo(0);
    expect(Math.max(...ys)).toBeCloseTo(4);
  });

  it("keeps identity fields when re-rendering an existing code-backed shape", () => {
    const existing = {
      id: "keep-me",
      name: "Bracket",
      kind: "mesh",
      color: "#123456",
      x: 0,
      z: 0,
      size: 1,
      width: 1,
      depth: 1,
      height: 1,
      rotation: 45,
      locked: true,
      groupedShapes: [],
    } as WorkplaneShape;
    const shape = openScadShapeFromStl(boxStl(), { source: "cube(2);", existing });
    expect(shape.id).toBe("keep-me");
    expect(shape.name).toBe("Bracket");
    expect(shape.color).toBe("#123456");
    expect(shape.locked).toBe(true);
    expect(shape.rotation).toBe(0);
    expect(shape.groupedShapes).toBeUndefined();
  });

  it("rejects empty output", () => {
    expect(() => openScadShapeFromStl(exportMeshesToStl([]), { source: "" })).toThrow(/empty/);
  });
});
