import { boxCornerStyle, maxBoxFloor, maxBoxWall, MIN_BOX_WALL, type BoxCornerStyle } from "@/lib/boxGeometry";
import { cylinderHollowFloor, cylinderHollowWall } from "@/lib/cylinderGeometry";
import type { MeshPoint } from "@/lib/meshCoordinates";
import type { OpenScadInputFile } from "@/lib/openscadTypes";
import { cadSketchRegions } from "@/lib/sketchCadProfile";
import { exportMeshesToStl } from "@/lib/stlExport";
import { mirrorSign, resizedImportedMeshPositions, shapeDepth, shapeHasTaper, shapeTaperScaleAt, shapeWidth } from "@/lib/workplaneShapes";
import type { WorkplaneShape } from "@/types/sketchforge";

/**
 * Scene → OpenSCAD source generation.
 *
 * Frame mapping (see meshCoordinates.ts): SketchForge is Y-up, OpenSCAD is Z-up.
 *   SketchForge (x, y, z)  →  OpenSCAD (x, -z, y)
 * So a shape's width maps to X, its depth to Y, and its height to Z.
 *
 * Every shape is emitted as `translate(center) rotate(...) scale(mirror) <centered primitive>`,
 * mirroring how WorkplaneViewport positions a shape group at its centre and offsets the
 * geometry by -height/2. Rotation order follows three.js Euler "XYZ" (Rx·Ry·Rz in the
 * Y-up frame), which becomes Rx(rx)·Rz(ry)·Ry(-rz) in the Z-up frame.
 *
 * Shapes without a clean analytic equivalent (gears, text, fillets, imported meshes, tapers,
 * curved sketches…) are written as binary STL files in the shape's local frame and imported
 * with `import("meshes/<name>.stl")`, so their transform stays editable in code.
 */

export type OpenScadLocalMesh = {
  vertices: readonly MeshPoint[];
  faces: readonly (readonly [number, number, number])[];
};

export type OpenScadCodegenOptions = {
  /**
   * Tessellates a native (non-mesh) shape in its local Y-up frame with y in [0, height],
   * i.e. the same convention the STL exporter uses before `transformMesh`.
   * Without it, unsupported native kinds are emitted as a placeholder cube.
   */
  localMeshForShape?: (shape: WorkplaneShape) => OpenScadLocalMesh | null;
  /** Default `$fn` written at the top of the script. */
  defaultFn?: number;
};

export type OpenScadCodegenResult = {
  source: string;
  /** STL files the script imports; pass them to renderOpenScad(). */
  files: OpenScadInputFile[];
  /** Ids of the top-level shapes the source was generated from. */
  shapeIds: string[];
  warnings: string[];
};

type Stmt = string[];

const PRECISION = 4;
const INDENT = "  ";

function num(value: number) {
  const rounded = Number(value.toFixed(PRECISION));
  return Object.is(rounded, -0) || rounded === 0 ? "0" : String(rounded);
}

function vec(values: number[]) {
  return `[${values.map(num).join(", ")}]`;
}

function indent(lines: string[]) {
  return lines.map((line) => `${INDENT}${line}`);
}

function prefix(head: string, stmt: Stmt): Stmt {
  return [`${head} ${stmt[0]}`, ...stmt.slice(1)];
}

function block(head: string, stmts: Stmt[]): Stmt {
  return [`${head} {`, ...indent(stmts.flat()), "}"];
}

function comment(text: string, stmt: Stmt): Stmt {
  return [`// ${text.replace(/[\r\n]+/g, " ")}`, ...stmt];
}

function nearly(a: number, b: number) {
  return Math.abs(a - b) < 1e-6;
}

function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "shape";
}

/** Centred solid box with the fork's corner styles (see boxGeometry.ts). */
function boxSolid(w: number, d: number, h: number, radius: number, corners: BoxCornerStyle): Stmt {
  const r = Math.min(radius, w / 2, d / 2, corners === "all" ? h / 2 : Number.POSITIVE_INFINITY);
  if (!(r > 0)) return [`cube(${vec([w, d, h])}, center = true);`];
  if (corners === "vertical") {
    return [`linear_extrude(height = ${num(h)}, center = true) offset(r = ${num(r)}) square(${vec([w - 2 * r, d - 2 * r])}, center = true);`];
  }
  return [
    "hull() for (sx = [-1, 1], sy = [-1, 1], sz = [-1, 1])",
    `${INDENT}translate([sx * ${num(w / 2 - r)}, sy * ${num(d / 2 - r)}, sz * ${num(h / 2 - r)}]) sphere(r = ${num(r)});`,
  ];
}

function sidesFn(shape: WorkplaneShape, fallback?: number) {
  const sides = shape.sides ?? fallback;
  return sides ? `, $fn = ${Math.max(3, Math.round(sides))}` : "";
}

class Emitter {
  readonly files: OpenScadInputFile[] = [];
  readonly warnings: string[] = [];
  private readonly usedFileNames = new Set<string>();

  constructor(private readonly options: OpenScadCodegenOptions) {}

  /** Wraps a centred primitive with the shape's placement, rotation and mirror. */
  private transformed(shape: WorkplaneShape, body: Stmt): Stmt {
    const height = shape.height;
    const heads: string[] = [];
    heads.push(`translate(${vec([shape.x, -shape.z, (shape.elevation ?? 0) + height / 2])})`);
    const rx = shape.rotationX ?? 0;
    const ry = shape.rotation ?? 0;
    const rz = shape.rotationZ ?? 0;
    if (!nearly(rx, 0)) heads.push(`rotate(${vec([rx, 0, 0])})`);
    if (!nearly(ry, 0)) heads.push(`rotate(${vec([0, 0, ry])})`);
    if (!nearly(rz, 0)) heads.push(`rotate(${vec([0, -rz, 0])})`);
    if (shape.mirrorX || shape.mirrorY || shape.mirrorZ) {
      heads.push(`scale(${vec([mirrorSign(shape.mirrorX), mirrorSign(shape.mirrorZ), mirrorSign(shape.mirrorY)])})`);
    }
    return prefix(heads.join(" "), body);
  }

  private meshFile(shape: WorkplaneShape, local: OpenScadLocalMesh | null): Stmt {
    if (!local || local.vertices.length < 3 || local.faces.length < 1) {
      this.warnings.push(`${shape.name}: no geometry available, emitted a placeholder cube`);
      return [`cube(${vec([shapeWidth(shape), shapeDepth(shape), shape.height])}, center = true);`];
    }
    const tapered = shapeHasTaper(shape);
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    if (tapered) {
      local.vertices.forEach(([, y]) => {
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      });
    }
    const span = Math.max(1e-6, maxY - minY);
    const centerY = shape.height / 2;
    const vertices: MeshPoint[] = local.vertices.map(([x, y, z]) => {
      if (!tapered) return [x, y - centerY, z];
      const normalized = (y - minY) / span;
      return [x * shapeTaperScaleAt(shape, normalized, "width"), y - centerY, z * shapeTaperScaleAt(shape, normalized, "depth")];
    });
    let fileName = slugify(shape.name);
    let suffix = 1;
    while (this.usedFileNames.has(fileName)) {
      suffix += 1;
      fileName = `${slugify(shape.name)}-${suffix}`;
    }
    this.usedFileNames.add(fileName);
    const path = `meshes/${fileName}.stl`;
    this.files.push({ path, bytes: new Uint8Array(exportMeshesToStl([{ vertices, faces: local.faces }])) });
    return [`import("${path}");`];
  }

  private importedLocalMesh(shape: WorkplaneShape): OpenScadLocalMesh | null {
    const mesh = shape.importedMesh;
    if (!mesh || mesh.positions.length < 9) return null;
    const positions = resizedImportedMeshPositions(shape);
    const vertices: MeshPoint[] = [];
    for (let i = 0; i + 2 < positions.length; i += 3) vertices.push([positions[i], positions[i + 1], positions[i + 2]]);
    const faces: [number, number, number][] = [];
    for (let i = 0; i + 2 < vertices.length; i += 3) faces.push([i, i + 1, i + 2]);
    return { vertices, faces };
  }

  private nativeLocalMesh(shape: WorkplaneShape): OpenScadLocalMesh | null {
    try {
      return this.options.localMeshForShape?.(shape) ?? null;
    } catch {
      return null;
    }
  }

  private sketchExtrusion(shape: WorkplaneShape): Stmt | null {
    const profile = shape.sketchProfile;
    const mesh = shape.importedMesh;
    if (!profile || !mesh || shape.sketchOperation !== "extrude" || shapeHasTaper(shape)) return null;
    if (profile.segments.some((segment) => segment.kind && segment.kind !== "line")) return null;
    const regions = cadSketchRegions(profile);
    if (!regions.length) return null;
    const allPoints = regions.flatMap((region) => [region.outer, ...region.holes]).flatMap((path) => path.points);
    const minX = Math.min(...allPoints.map((point) => point.x));
    const maxX = Math.max(...allPoints.map((point) => point.x));
    const minZ = Math.min(...allPoints.map((point) => point.z));
    const maxZ = Math.max(...allPoints.map((point) => point.z));
    const centerX = (minX + maxX) / 2;
    const centerZ = (minZ + maxZ) / 2;
    const polygons: Stmt[] = regions.map((region) => {
      const points: string[] = [];
      const paths: number[][] = [];
      [region.outer, ...region.holes].forEach((path) => {
        const start = points.length;
        path.points.forEach((point) => points.push(vec([point.x - centerX, -(point.z - centerZ)])));
        paths.push(Array.from({ length: path.points.length }, (_, index) => start + index));
      });
      const pathsArgument = region.holes.length ? `, paths = [${paths.map((path) => `[${path.join(", ")}]`).join(", ")}]` : "";
      return [`polygon(points = [${points.join(", ")}]${pathsArgument});`];
    });
    const extrude = `linear_extrude(height = ${num(shape.height)}, center = true)`;
    const body: Stmt = polygons.length === 1 ? prefix(extrude, polygons[0]) : block(extrude, polygons);
    const sx = shapeWidth(shape) / Math.max(1e-6, mesh.baseWidth);
    const sz = shapeDepth(shape) / Math.max(1e-6, mesh.baseDepth);
    return nearly(sx, 1) && nearly(sz, 1) ? body : prefix(`scale(${vec([sx, sz, 1])})`, body);
  }

  /** Centred primitive in the OpenSCAD frame (X = width, Y = depth, Z = height). */
  private primitive(shape: WorkplaneShape): Stmt {
    const w = shapeWidth(shape);
    const d = shapeDepth(shape);
    const h = shape.height;
    const size = Math.min(w, d);

    if (shape.importedMesh) {
      return this.sketchExtrusion(shape) ?? this.meshFile(shape, this.importedLocalMesh(shape));
    }
    if (shapeHasTaper(shape)) {
      return this.meshFile(shape, this.nativeLocalMesh(shape));
    }

    switch (shape.kind) {
      case "box": {
        const radius = Math.max(0, shape.radius ?? 0);
        const corners = boxCornerStyle(shape);
        const outer = boxSolid(w, d, h, radius, corners);
        const wall = Math.min(Math.max(0, shape.boxWall ?? 0), maxBoxWall(w, d));
        if (wall >= MIN_BOX_WALL) {
          const floor = Math.min(Math.max(0, shape.boxFloor ?? wall), maxBoxFloor(h));
          const inner = boxSolid(w - 2 * wall, d - 2 * wall, h, Math.max(0, radius - wall), corners);
          return block("difference()", [outer, prefix(`translate([0, 0, ${num(floor)}])`, inner)]);
        }
        return outer;
      }
      case "cylinder": {
        const ellipse = (cw: number, cd: number, ch: number): Stmt => {
          const body: Stmt = [`cylinder(h = ${num(ch)}, d = ${num(cw)}, center = true${sidesFn(shape)});`];
          return nearly(cw, cd) ? body : prefix(`scale(${vec([1, cd / cw, 1])})`, body);
        };
        // Hollow cylinder (fork feature, see cylinderGeometry.ts): cut the hole from the top,
        // down to the floor; with floor 0 it runs through. The cut overshoots open faces by 1 mm.
        const wall = cylinderHollowWall({ ...shape, width: w, depth: d });
        if (wall > 0) {
          const floor = cylinderHollowFloor({ cylinderFloor: shape.cylinderFloor, height: h }, wall);
          const bottom = floor > 0 ? -h / 2 + floor : -h / 2 - 1;
          const top = h / 2 + 1;
          const inner = ellipse(w - 2 * wall, d - 2 * wall, top - bottom);
          return block("difference()", [ellipse(w, d, h), prefix(`translate([0, 0, ${num((top + bottom) / 2)}])`, inner)]);
        }
        return ellipse(w, d, h);
      }
      case "sphere":
        return nearly(w, d) && nearly(w, h)
          ? [`sphere(d = ${num(w)});`]
          : prefix(`scale(${vec([w / 2, d / 2, h / 2])})`, ["sphere(r = 1);"]);
      case "cone": {
        const r1 = shape.baseRadius ?? w / 2;
        const r2 = shape.topRadius ?? 0;
        const body: Stmt = [`cylinder(h = ${num(h)}, r1 = ${num(r1)}, r2 = ${num(r2)}, center = true${sidesFn(shape)});`];
        return nearly(w, d) ? body : prefix(`scale(${vec([1, d / w, 1])})`, body);
      }
      case "pyramid": {
        const sides = Math.max(3, Math.round(shape.sides ?? 4));
        if (sides === 4) {
          const body: Stmt = [`rotate([0, 0, 45]) cylinder(h = ${num(h)}, r1 = ${num((w / 2) * Math.SQRT2)}, r2 = 0, center = true, $fn = 4);`];
          return nearly(w, d) ? body : prefix(`scale(${vec([1, d / w, 1])})`, body);
        }
        const body: Stmt = [`rotate([0, 0, -90]) cylinder(h = ${num(h)}, r1 = ${num(w / 2)}, r2 = 0, center = true, $fn = ${sides});`];
        return nearly(w, d) ? body : prefix(`scale(${vec([1, d / w, 1])})`, body);
      }
      case "polygon": {
        const body: Stmt = [`rotate([0, 0, -90]) cylinder(h = ${num(h)}, d = ${num(w)}, center = true, $fn = 6);`];
        return nearly(w, d) ? body : prefix(`scale(${vec([1, d / w, 1])})`, body);
      }
      case "roof":
        return prefix(
          `rotate([90, 0, 0]) linear_extrude(height = ${num(d)}, center = true)`,
          [`polygon([${vec([-w / 2, -h / 2])}, ${vec([w / 2, -h / 2])}, ${vec([0, h / 2])}]);`],
        );
      case "wedge":
        return prefix(
          `rotate([90, 0, 0]) linear_extrude(height = ${num(d)}, center = true)`,
          [`polygon([${vec([-w / 2, -h / 2])}, ${vec([w / 2, -h / 2])}, ${vec([w / 2, h / 2])}]);`],
        );
      case "roundRoof":
        return prefix(
          `rotate([90, 0, 0]) linear_extrude(height = ${num(d)}, center = true) translate([0, ${num(-h / 2)}]) scale(${vec([w / 2, h])})`,
          block("intersection()", [[`circle(r = 1${sidesFn(shape, 64)});`], ["translate([-1, 0]) square([2, 1]);"]]),
        );
      case "halfSphere":
        return prefix(
          `translate([0, 0, ${num(-h / 2)}]) scale(${vec([w / 2, d / 2, h])})`,
          block("difference()", [["sphere(r = 1);"], ["translate([0, 0, -1]) cube(2, center = true);"]]),
        );
      case "torus": {
        const tube = Math.max(0.1, h / 2);
        const major = Math.max(0.2, size / 2 - tube);
        const outer = (major + tube) * 2;
        const body: Stmt = [`rotate_extrude() translate([${num(major)}, 0]) circle(r = ${num(tube)});`];
        return nearly(w, outer) && nearly(d, outer) ? body : prefix(`scale(${vec([w / outer, d / outer, 1])})`, body);
      }
      case "ring":
      case "tube": {
        const outerX = w / 2;
        const outerY = d / 2;
        const thickness = Math.min(Math.max(shape.bevel ?? 4, 0.1), Math.max(0.1, Math.min(outerX, outerY) - 0.1));
        const innerX = Math.max(0.1, outerX - thickness);
        const innerY = Math.max(0.1, outerY - thickness);
        return block("difference()", [
          [`scale(${vec([outerX, outerY, 1])}) cylinder(h = ${num(h)}, r = 1, center = true);`],
          [`scale(${vec([innerX, innerY, 1])}) cylinder(h = ${num(h + 2)}, r = 1, center = true);`],
        ]);
      }
      default:
        // gear, text, icosahedron, scribble, placeholder sketch, mesh without data
        return this.meshFile(shape, this.nativeLocalMesh(shape));
    }
  }

  private groupBody(group: WorkplaneShape): Stmt {
    const children = (group.groupedShapes ?? []).filter((child) => !child.hidden);
    const solids = children.filter((child) => !child.hole).map((child) => this.shape(child));
    const holes = children.filter((child) => child.hole).map((child) => this.shape(child));
    let combined: Stmt;
    if (group.groupOperation === "intersection") {
      combined = block("intersection()", [
        solids.length === 1 ? solids[0] : block("union()", solids),
        holes.length === 1 ? holes[0] : block("union()", holes),
      ]);
    } else if (holes.length) {
      combined = block("difference()", [solids.length === 1 ? solids[0] : block("union()", solids), ...holes]);
    } else {
      combined = solids.length === 1 ? solids[0] : block("union()", solids);
    }
    const baseWidth = group.groupedBaseWidth ?? shapeWidth(group);
    const baseDepth = group.groupedBaseDepth ?? shapeDepth(group);
    const baseHeight = group.groupedBaseHeight ?? group.height;
    const sx = shapeWidth(group) / Math.max(1e-6, baseWidth);
    const sy = group.height / Math.max(1e-6, baseHeight);
    const sz = shapeDepth(group) / Math.max(1e-6, baseDepth);
    const heads = [`translate([0, 0, ${num(-group.height / 2)}])`];
    if (!nearly(sx, 1) || !nearly(sy, 1) || !nearly(sz, 1)) heads.unshift(`scale(${vec([sx, sz, sy])})`);
    return prefix(heads.join(" "), combined);
  }

  shape(shape: WorkplaneShape): Stmt {
    const hasGroupChildren = Boolean(shape.groupedShapes?.length);
    const body = hasGroupChildren && !shapeHasTaper(shape) ? this.groupBody(shape) : this.primitive(shape);
    return comment(shape.name, this.transformed(shape, body));
  }
}

const MESH_IMPORT_PATTERN = /import\(\s*"(meshes\/[^"]+\.stl)"/g;

/** Paths of `import("meshes/….stl")` statements referenced by a script. */
export function referencedOpenScadMeshPaths(source: string) {
  const paths = new Set<string>();
  for (const match of source.matchAll(MESH_IMPORT_PATTERN)) paths.add(match[1]);
  return [...paths];
}

/**
 * Collects the STL files a script needs. Files produced by the generation that created the
 * script are reused; anything else referenced (for example after the script was reloaded
 * from a rendered shape, or hand-edited to import another shape) is regenerated from the
 * current scene, where file names derive from shape names.
 */
export function resolveOpenScadImports(
  source: string,
  knownFiles: OpenScadInputFile[],
  sceneShapes: WorkplaneShape[],
  options: OpenScadCodegenOptions = {},
): OpenScadInputFile[] {
  const referenced = referencedOpenScadMeshPaths(source);
  if (!referenced.length) return [];
  const resolved = knownFiles.filter((file) => referenced.includes(file.path));
  const missing = referenced.filter((path) => !resolved.some((file) => file.path === path));
  if (!missing.length) return resolved;
  const emitter = new Emitter(options);
  sceneShapes.forEach((shape) => emitter.shape(shape));
  return [...resolved, ...emitter.files.filter((file) => missing.includes(file.path))];
}

export function generateOpenScadFromShapes(shapes: WorkplaneShape[], options: OpenScadCodegenOptions = {}): OpenScadCodegenResult {
  const emitter = new Emitter(options);
  const visible = shapes.filter((shape) => !shape.hidden);
  const solids = visible.filter((shape) => !shape.hole).map((shape) => emitter.shape(shape));
  const holes = visible.filter((shape) => shape.hole).map((shape) => emitter.shape(shape));

  const header = [
    `// Generated by SketchForge from ${visible.length} shape${visible.length === 1 ? "" : "s"}.`,
    "// Axes: X = right, Y = back (SketchForge -Z), Z = up. Units: mm.",
    "// Mesh-backed shapes are imported from meshes/*.stl, which SketchForge",
    "// writes next to this script when it renders.",
    `$fn = ${options.defaultFn ?? 64};`,
    "",
  ];

  let body: string[];
  if (!visible.length) {
    body = ["// The scene is empty."];
  } else if (holes.length) {
    body = block("difference()", [solids.length === 1 ? solids[0] : block("union()", solids), ...holes]);
  } else {
    body = solids.flatMap((stmt, index) => (index ? ["", ...stmt] : stmt));
  }

  return {
    source: `${[...header, ...body].join("\n")}\n`,
    files: emitter.files,
    shapeIds: visible.map((shape) => shape.id),
    warnings: emitter.warnings,
  };
}
