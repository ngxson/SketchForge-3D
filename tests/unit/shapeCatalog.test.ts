import { describe, expect, it } from "vitest";
import type { ShapeAsset } from "@/types/sketchforge";
import { TETRAHEDRON_ASSET_ID, makeShapeFromAsset, sceneShape, toolbarShapeAssets } from "@/lib/shapeCatalog";

describe("shape catalog", () => {
  it("does not expose removed decorative shapes in the toolbar catalog", () => {
    const kinds = toolbarShapeAssets.map((asset) => asset.kind);

    expect(kinds).not.toContain("star");
    expect(kinds).not.toContain("heart");
  });

  it("creates placed shapes from toolbar assets", () => {
    const asset: ShapeAsset = { id: "box", name: "Box", src: "box.png", kind: "box", color: "#d41721" };
    const placed = makeShapeFromAsset(asset, { x: 12, z: -8, elevation: 4 });

    expect(placed.id).toMatch(/^box-/);
    expect(placed).toMatchObject({
      name: "Box",
      kind: "box",
      color: "#d41721",
      x: 12,
      z: -8,
      elevation: 4,
      size: 20,
      width: 20,
      depth: 20,
      height: 20,
      radius: 0,
      steps: 10,
      locked: false,
      hidden: false,
    });
  });

  it("uses shape-specific defaults for text and round profiles", () => {
    const text = makeShapeFromAsset({ id: "text", name: "Text", src: "text.png", kind: "text", color: "#cf101b" });
    const torus = makeShapeFromAsset({ id: "torus", name: "Torus", src: "torus.png", kind: "torus", color: "#0098c7" });
    const gear = makeShapeFromAsset({ id: "gear", name: "Gear", src: "gear.svg", kind: "gear", color: "#6f7f8d" });

    expect(text).toMatchObject({ width: 86, depth: 28, height: 10, text: "TEXT", font: "Multilanguage" });
    expect(torus).toMatchObject({ size: 22, width: 22, depth: 22, height: 5 });
    expect(gear).toMatchObject({
      size: 30,
      width: 30,
      depth: 30,
      height: 6,
      teeth: 12,
      toothSize: 2.5,
      centerHoleSize: 6,
      gearType: "spur",
      helixAngle: 22.5,
      helixQuality: 16,
    });
  });

  it("applies only explicitly customized creation dimensions", () => {
    const asset: ShapeAsset = { id: "cone", name: "Cone", src: "cone.png", kind: "cone", color: "#6e2786" };
    const appDefault = makeShapeFromAsset(asset);
    const customized = makeShapeFromAsset(asset, undefined, { width: 320, depth: 240, height: 180 });

    expect(appDefault).toMatchObject({ width: 20, depth: 20, height: 20, baseRadius: 10 });
    expect(customized).toMatchObject({ width: 320, depth: 240, height: 180, size: 320, baseRadius: 160 });
  });

  it("applies shape-specific creation defaults only when customized", () => {
    const cone = makeShapeFromAsset(
      { id: "cone", name: "Cone", src: "cone.png", kind: "cone", color: "#6e2786" },
      undefined,
      { topRadius: 3, baseRadius: 18, sides: 48 },
    );
    const text = makeShapeFromAsset(
      { id: "text", name: "Text", src: "text.png", kind: "text", color: "#cf101b" },
      undefined,
      { text: "HELLO", font: "Serif", bevel: 2, segments: 6 },
    );
    const gear = makeShapeFromAsset(
      { id: "gear", name: "Gear", src: "gear.svg", kind: "gear", color: "#6f7f8d" },
      undefined,
      { gearType: "helical", teeth: 24, toothSize: 3, toothWidth: 2, centerHoleSize: 10, helixAngle: 30, helixQuality: 24 },
    );

    expect(cone).toMatchObject({ topRadius: 3, baseRadius: 18, sides: 48 });
    expect(text).toMatchObject({ text: "HELLO", font: "Serif", bevel: 2, segments: 6 });
    expect(gear).toMatchObject({ gearType: "helical", teeth: 24, toothSize: 3, toothWidth: 2, centerHoleSize: 10, helixAngle: 30, helixQuality: 24 });
  });

  it("creates canonical scene shapes with stable defaults", () => {
    const created = sceneShape({
      name: "Part",
      kind: "box",
      color: "#d41721",
      width: 12,
      depth: 18,
      rotation: 359.9,
      mirrorX: false,
    });

    expect(created.id).toMatch(/^shape-/);
    expect(created).toMatchObject({
      name: "Part",
      kind: "box",
      color: "#d41721",
      x: 0,
      z: 0,
      elevation: 0,
      width: 12,
      depth: 18,
      height: 20,
      size: 18,
      rotation: 0,
      locked: false,
      hidden: false,
    });
    expect(created.mirrorX).toBeUndefined();
  });

  it("creates the tetrahedron as a closed 4-face mesh with the tip at the bottom", () => {
    const asset = toolbarShapeAssets.find((entry) => entry.id === TETRAHEDRON_ASSET_ID)!;
    const shape = makeShapeFromAsset(asset);
    expect(shape).toMatchObject({ name: "Tetrahedron", kind: "mesh", width: 20, depth: 20, height: 20 });
    const positions = shape.importedMesh!.positions;
    expect(positions).toHaveLength(4 * 9);
    const points = Array.from({ length: 12 }, (_, i) => positions.slice(i * 3, i * 3 + 3));
    // One vertex at the bottom (the tip), three on the top.
    const distinct = new Set(points.map((p) => p.join(",")));
    expect(distinct.size).toBe(4);
    expect([...distinct].filter((key) => key.split(",")[1] === "0")).toEqual(["-10,0,-10"]);
    // Every face winds outward: positive signed volume equals the tetrahedron volume (cube / 6).
    let volume = 0;
    for (let i = 0; i < 12; i += 3) {
      const [a, b, c] = [points[i], points[i + 1], points[i + 2]];
      volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    }
    expect(volume).toBeCloseTo(8000 / 6, 6);
  });
});
