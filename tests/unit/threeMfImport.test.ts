import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { importExtensionSupported } from "@/lib/importExtensions";
import { editorHistoryEntry } from "@/lib/editorHistory";
import { attachProjectAsset, projectAssetFromBytes, sourceFormatForFileName } from "@/lib/projectAssets";
import { exportSkfProject, importSkfProject } from "@/lib/skfProject";
import { DEFAULT_SNAP_GRID, DEFAULT_WORKPLANE_WORKSPACE } from "@/lib/workplaneSettings";
import { importedShapeFrom3mf } from "@/lib/threeMfImport";

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>`;
const RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;

/** Axis-aligned box mesh from (0,0,0) to (w,d,h), outward-facing, as 3MF XML. */
function boxMesh(w: number, d: number, h: number) {
  const v = [[0, 0, 0], [w, 0, 0], [w, d, 0], [0, d, 0], [0, 0, h], [w, 0, h], [w, d, h], [0, d, h]];
  const t = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  return `<mesh><vertices>${v.map(([x, y, z]) => `<vertex x="${x}" y="${y}" z="${z}"/>`).join("")}</vertices>`
    + `<triangles>${t.map(([a, b, c]) => `<triangle v1="${a}" v2="${b}" v3="${c}"/>`).join("")}</triangles></mesh>`;
}

function model(body: string, unit = "millimeter", extraNs = "") {
  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="${unit}" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"${extraNs}>${body}</model>`;
}

function threeMf(files: Record<string, string>) {
  return zipSync(Object.fromEntries(Object.entries({ "[Content_Types].xml": CONTENT_TYPES, "_rels/.rels": RELS, ...files }).map(([path, text]) => [path, strToU8(text)])));
}

function signedVolume(positions: number[]) {
  let volume = 0;
  for (let i = 0; i < positions.length; i += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = positions.slice(i, i + 9);
    volume += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return volume;
}

describe("3MF import", () => {
  it("is offered as an import format", () => {
    expect(importExtensionSupported("part.3MF")).toBe(true);
    expect(sourceFormatForFileName("part.3mf")).toBe("3mf");
  });

  it("imports a mesh object with its build transform, Z-up to Y-up", () => {
    const bytes = threeMf({
      "3D/3dmodel.model": model(`<resources><object id="1" type="model">${boxMesh(20, 10, 5)}</object></resources>`
        + `<build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 100 50 0"/></build>`),
    });
    const shape = importedShapeFrom3mf("bracket.3mf", bytes);
    // 3MF x = width, y = depth, z = height; SketchForge y is up.
    expect(shape).toMatchObject({ name: "bracket", kind: "mesh", width: 20, depth: 10, height: 5 });
    expect(shape.importedMesh).toMatchObject({ sourceFormat: "3mf", triangleCount: 12 });
    expect(signedVolume(shape.importedMesh!.positions)).toBeCloseTo(1000, 6);
  });

  it("converts the model unit to millimetres", () => {
    const bytes = threeMf({
      "3D/3dmodel.model": model(`<resources><object id="1">${boxMesh(1, 2, 0.5)}</object></resources><build><item objectid="1"/></build>`, "inch"),
    });
    expect(importedShapeFrom3mf("in.3mf", bytes)).toMatchObject({ width: 25.4, depth: 50.8, height: 12.7 });
  });

  it("follows components into other model parts (slicer production extension)", () => {
    const ns = ' xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06"';
    const bytes = threeMf({
      "3D/3dmodel.model": model(
        `<resources><object id="5" type="model"><components>`
          + `<component p:path="/3D/Objects/object_1.model" objectid="1"/>`
          + `<component p:path="/3D/Objects/object_1.model" objectid="1" transform="1 0 0 0 1 0 0 0 1 30 0 0"/>`
          + `</components></object></resources><build><item objectid="5"/></build>`,
        "millimeter",
        ns,
      ),
      "3D/Objects/object_1.model": model(`<resources><object id="1" type="model">${boxMesh(10, 10, 10)}</object></resources><build/>`),
    });
    const shape = importedShapeFrom3mf("plate.3mf", bytes);
    expect(shape).toMatchObject({ width: 40, depth: 10, height: 10 });
    expect(shape.importedMesh?.triangleCount).toBe(24);
    expect(signedVolume(shape.importedMesh!.positions)).toBeCloseTo(2000, 6);
  });

  it("keeps faces outward under a mirroring transform", () => {
    const bytes = threeMf({
      "3D/3dmodel.model": model(`<resources><object id="1">${boxMesh(10, 10, 10)}</object></resources>`
        + `<build><item objectid="1" transform="-1 0 0 0 1 0 0 0 1 0 0 0"/></build>`),
    });
    expect(signedVolume(importedShapeFrom3mf("m.3mf", bytes).importedMesh!.positions)).toBeCloseTo(1000, 6);
  });

  it("uses the base material colour and skips support objects", () => {
    const bytes = threeMf({
      "3D/3dmodel.model": model(`<resources><basematerials id="9"><base name="Red PLA" displaycolor="#C81E1EFF"/></basematerials>`
        + `<object id="1" pid="9" pindex="0">${boxMesh(10, 10, 10)}</object>`
        + `<object id="2" type="support">${boxMesh(50, 50, 50)}</object></resources>`
        + `<build><item objectid="1"/><item objectid="2"/></build>`),
    });
    expect(importedShapeFrom3mf("c.3mf", bytes)).toMatchObject({ color: "#c81e1e", width: 10, depth: 10, height: 10 });
  });

  it("reports unreadable files", () => {
    expect(() => importedShapeFrom3mf("x.3mf", strToU8("not a zip"))).toThrow(/zip/);
    expect(() => importedShapeFrom3mf("x.3mf", zipSync({ "readme.txt": strToU8("hi") }))).toThrow(/no 3D model/);
    expect(() => importedShapeFrom3mf("x.3mf", threeMf({ "3D/3dmodel.model": model("<resources/><build/>") }))).toThrow(/no printable mesh/);
    const sliced = threeMf({ "3D/3dmodel.model": model("<resources/><build/>"), "Metadata/plate_1.gcode": "G28" });
    expect(() => importedShapeFrom3mf("x.gcode.3mf", sliced)).toThrow(/sliced print file/);
  });

  it("keeps the original 3MF in .skf projects and rebuilds the mesh from it", async () => {
    const bytes = threeMf({
      "3D/3dmodel.model": model(`<resources><object id="1">${boxMesh(20, 10, 5)}</object></resources><build><item objectid="1"/></build>`),
    });
    const asset = await projectAssetFromBytes("part.3mf", "3mf", bytes);
    const shape = attachProjectAsset(importedShapeFrom3mf("part.3mf", bytes), asset.id);
    const exported = await exportSkfProject({
      projectId: "three-mf-project",
      projectName: "3MF round trip",
      createdAt: 1_700_000_000_000,
      modifiedAt: 1_700_000_100_000,
      shapes: [shape],
      history: [editorHistoryEntry([shape], [shape.id])],
      historyIndex: 0,
      assets: [asset],
      workspace: DEFAULT_WORKPLANE_WORKSPACE,
      snapGrid: DEFAULT_SNAP_GRID,
      placementElevation: 0,
    });
    // No custom source importer: the default one must read the stored 3MF.
    const restored = await importSkfProject(exported);
    expect(restored.assets[0].sourceFormat).toBe("3mf");
    expect(restored.shapes[0]).toMatchObject({ width: 20, depth: 10, height: 5 });
    expect(restored.shapes[0].importedMesh).toMatchObject({ sourceFormat: "3mf", triangleCount: 12 });
  });
});

