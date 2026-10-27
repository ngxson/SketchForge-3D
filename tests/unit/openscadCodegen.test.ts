import { describe, expect, it } from "vitest";
import { generateOpenScadFromShapes } from "@/lib/openscadCodegen";
import type { WorkplaneShape } from "@/types/sketchforge";

function shape(overrides: Partial<WorkplaneShape>): WorkplaneShape {
  return {
    id: overrides.id ?? "shape",
    name: overrides.name ?? "Shape",
    kind: overrides.kind ?? "box",
    color: "#ff0000",
    x: 0,
    z: 0,
    size: 10,
    width: 10,
    depth: 10,
    height: 10,
    rotation: 0,
    ...overrides,
  };
}

describe("generateOpenScadFromShapes", () => {
  it("places a box at its centre in the Z-up frame", () => {
    const result = generateOpenScadFromShapes([shape({ id: "a", name: "Box", x: 5, z: 7, elevation: 2, width: 20, depth: 10, height: 4 })]);
    expect(result.source).toContain("// Box");
    expect(result.source).toContain("translate([5, -7, 4]) cube([20, 10, 4], center = true);");
    expect(result.shapeIds).toEqual(["a"]);
    expect(result.files).toEqual([]);
    expect(result.source).toContain("$fn = 64;");
  });

  it("maps SketchForge rotations and mirrors onto OpenSCAD axes", () => {
    const result = generateOpenScadFromShapes([shape({ rotation: 30, rotationX: 10, rotationZ: 20, mirrorX: true, mirrorY: true })]);
    expect(result.source).toContain("rotate([10, 0, 0]) rotate([0, 0, 30]) rotate([0, -20, 0]) scale([-1, 1, -1]) cube(");
  });

  it("subtracts hole shapes from solids", () => {
    const result = generateOpenScadFromShapes([
      shape({ id: "solid", name: "Body" }),
      shape({ id: "cut", name: "Cut", kind: "cylinder", hole: true, sides: 48 }),
    ]);
    expect(result.source).toMatch(/difference\(\) \{\n  \/\/ Body\n  translate\(\[0, 0, 5\]\) cube\(\[10, 10, 10\], center = true\);\n  \/\/ Cut\n  translate\(\[0, 0, 5\]\) cylinder\(h = 10, d = 10, center = true, \$fn = 48\);\n\}/);
  });

  it("skips hidden shapes", () => {
    const result = generateOpenScadFromShapes([shape({ id: "visible" }), shape({ id: "hidden", hidden: true })]);
    expect(result.shapeIds).toEqual(["visible"]);
  });

  it("emits grouped children inside the group's transform", () => {
    const group = shape({
      id: "group",
      name: "Group",
      kind: "mesh",
      x: 100,
      width: 40,
      depth: 20,
      height: 10,
      groupedBaseWidth: 20,
      groupedBaseDepth: 20,
      groupedBaseHeight: 10,
      groupedShapes: [
        shape({ id: "c1", name: "Child A", x: -5, width: 10, depth: 20, height: 10 }),
        shape({ id: "c2", name: "Child B", kind: "cylinder", hole: true, x: 5, width: 4, depth: 4, height: 10 }),
      ],
    });
    const result = generateOpenScadFromShapes([group]);
    expect(result.source).toContain("translate([100, 0, 5]) scale([2, 1, 1]) translate([0, 0, -5]) difference() {");
    expect(result.source).toContain("// Child A");
    expect(result.source).toContain("translate([-5, 0, 5]) cube([10, 20, 10], center = true);");
    expect(result.source).toContain("// Child B");
    expect(result.files).toEqual([]);
  });

  it("writes mesh-backed shapes to STL files and imports them in local space", () => {
    const positions = [
      0, 0, 0, 4, 0, 0, 0, 0, 4,
      0, 6, 0, 0, 6, 4, 4, 6, 0,
    ];
    const result = generateOpenScadFromShapes([
      shape({
        id: "mesh",
        name: "My Gear!",
        kind: "mesh",
        x: 3,
        z: -2,
        width: 4,
        depth: 4,
        height: 6,
        importedMesh: { positions, baseWidth: 4, baseDepth: 4, baseHeight: 6, triangleCount: 2, sourceFormat: "json" },
      }),
    ]);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].path).toBe("meshes/my-gear.stl");
    expect(result.source).toContain('translate([3, 2, 3]) import("meshes/my-gear.stl");');
    const view = new DataView(result.files[0].bytes.buffer, result.files[0].bytes.byteOffset);
    expect(view.getUint32(80, true)).toBe(2);
    // First vertex (0,0,0) is centred vertically (-3 in Y-up) and written as Z-up: [0, 0, -3].
    expect(view.getFloat32(84 + 12, true)).toBe(0);
    expect(view.getFloat32(84 + 16, true)).toBe(-0);
    expect(view.getFloat32(84 + 20, true)).toBe(-3);
  });

  it("uses the tessellation callback for native kinds without an analytic form", () => {
    let asked: string | null = null;
    const result = generateOpenScadFromShapes([shape({ id: "gear", name: "Gear", kind: "gear" })], {
      localMeshForShape: (candidate) => {
        asked = candidate.id;
        return { vertices: [[0, 0, 0], [1, 0, 0], [0, 10, 0]], faces: [[0, 1, 2]] };
      },
    });
    expect(asked).toBe("gear");
    expect(result.source).toContain('import("meshes/gear.stl");');
    expect(result.warnings).toEqual([]);
  });

  it("turns straight-line sketch extrusions into polygons", () => {
    const profile = {
      points: [
        { id: "p1", x: 0, z: 0 },
        { id: "p2", x: 10, z: 0 },
        { id: "p3", x: 10, z: 6 },
        { id: "p4", x: 0, z: 6 },
      ],
      segments: [
        { id: "s1", startId: "p1", endId: "p2", kind: "line" as const },
        { id: "s2", startId: "p2", endId: "p3", kind: "line" as const },
        { id: "s3", startId: "p3", endId: "p4", kind: "line" as const },
        { id: "s4", startId: "p4", endId: "p1", kind: "line" as const },
      ],
    };
    const result = generateOpenScadFromShapes([
      shape({
        id: "sketch",
        name: "Sketch",
        kind: "mesh",
        width: 10,
        depth: 6,
        height: 3,
        sketchProfile: profile,
        sketchOperation: "extrude",
        importedMesh: { positions: new Array(9).fill(0), baseWidth: 10, baseDepth: 6, baseHeight: 3, triangleCount: 1, sourceFormat: "json" },
      }),
    ]);
    expect(result.files).toEqual([]);
    expect(result.source).toContain("linear_extrude(height = 3, center = true) polygon(points = [");
    expect(result.source).toContain("[-5, 3], [5, 3], [5, -3], [-5, -3]");
  });

  it("emits vertical-edge rounding and hollow boxes", () => {
    const rounded = generateOpenScadFromShapes([shape({ radius: 2, boxCorners: "vertical", width: 20, depth: 10, height: 6 })]);
    expect(rounded.source).toContain("linear_extrude(height = 6, center = true) offset(r = 2) square([16, 6], center = true);");
    const hollow = generateOpenScadFromShapes([shape({ width: 20, depth: 10, height: 6, boxWall: 2, boxFloor: 1 })]);
    expect(hollow.source).toContain("difference() {");
    expect(hollow.source).toContain("cube([20, 10, 6], center = true);");
    expect(hollow.source).toContain("translate([0, 0, 1]) cube([16, 6, 6], center = true);");
  });

  it("emits hollow cylinders with a floor or open bottom", () => {
    const cup = generateOpenScadFromShapes([shape({ kind: "cylinder", width: 20, depth: 20, height: 10, sides: 32, cylinderWall: 2, cylinderFloor: 3 })]);
    expect(cup.source).toContain("difference() {");
    expect(cup.source).toContain("cylinder(h = 10, d = 20, center = true, $fn = 32);");
    // Hole from z = -5 + 3 up to 1 mm above the top (z = 6): 8 mm tall, centred at z = 2.
    expect(cup.source).toContain("translate([0, 0, 2]) cylinder(h = 8, d = 16, center = true, $fn = 32);");
    const tube = generateOpenScadFromShapes([shape({ kind: "cylinder", width: 20, depth: 20, height: 10, sides: 32, cylinderWall: 2, cylinderFloor: 0 })]);
    expect(tube.source).toContain("translate([0, 0, 0]) cylinder(h = 12, d = 16, center = true, $fn = 32);");
  });

  it("describes an empty scene", () => {
    const result = generateOpenScadFromShapes([]);
    expect(result.source).toContain("// The scene is empty.");
    expect(result.shapeIds).toEqual([]);
  });
});
