import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { createLocalId } from "@/lib/localIds";
import { zUpToSketchForge } from "@/lib/meshCoordinates";
import type { WorkplaneShape } from "@/types/sketchforge";

const stlLoader = new STLLoader();

export const OPENSCAD_SHAPE_COLOR = "#5b8def";

export type OpenScadShapeOptions = {
  /** The script that produced the mesh; stored on the shape so it can be edited again later. */
  source: string;
  /** When re-rendering a code-backed shape, keeps its id, name, colour and lock state. */
  existing?: WorkplaneShape | null;
  name?: string;
};

/**
 * Turns the binary STL that OpenSCAD wrote into a scene shape. OpenSCAD output is
 * always Z-up and in world coordinates, so unlike the generic STL importer this does
 * not guess the up axis, and it places the shape where the script put it instead of at
 * the default import position.
 */
export function openScadShapeFromStl(stl: ArrayBuffer, options: OpenScadShapeOptions): WorkplaneShape {
  const rawGeometry = stlLoader.parse(stl);
  const geometry = rawGeometry.index ? rawGeometry.toNonIndexed() : rawGeometry;
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  if (!position || position.count < 3) {
    throw new Error("OpenSCAD produced an empty mesh");
  }

  const box = new THREE.Box3();
  const converted: number[] = [];
  const normals: number[] = [];
  const point = new THREE.Vector3();
  for (let i = 0; i < position.count; i += 1) {
    const [x, y, z] = zUpToSketchForge([position.getX(i), position.getY(i), position.getZ(i)]);
    converted.push(x, y, z);
    box.expandByPoint(point.set(x, y, z));
    if (normal) {
      normals.push(...zUpToSketchForge([normal.getX(i), normal.getY(i), normal.getZ(i)]));
    }
  }

  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  if (![size.x, size.y, size.z].every(Number.isFinite)) {
    throw new Error("OpenSCAD produced a mesh with invalid coordinates");
  }

  const positions: number[] = [];
  for (let i = 0; i < converted.length; i += 3) {
    positions.push(converted[i] - center.x, converted[i + 1] - box.min.y, converted[i + 2] - center.z);
  }

  const width = Math.max(0.01, size.x);
  const height = Math.max(0.01, size.y);
  const depth = Math.max(0.01, size.z);
  const existing = options.existing ?? null;

  return {
    id: existing?.id ?? createLocalId("openscad"),
    name: existing?.name ?? options.name ?? "OpenSCAD",
    kind: "mesh",
    color: existing?.color ?? OPENSCAD_SHAPE_COLOR,
    hole: existing?.hole,
    x: center.x,
    z: center.z,
    elevation: box.min.y,
    size: Math.max(width, depth),
    width,
    depth,
    height,
    rotation: 0,
    rotationX: 0,
    rotationZ: 0,
    importedMesh: {
      positions,
      normals: normals.length === positions.length ? normals : undefined,
      baseWidth: width,
      baseDepth: depth,
      baseHeight: height,
      triangleCount: Math.floor(position.count / 3),
      sourceFormat: "json",
    },
    openscadSource: options.source,
    locked: existing?.locked ?? false,
    hidden: false,
  };
}

export function isOpenScadShape(shape: WorkplaneShape | null | undefined): shape is WorkplaneShape & { openscadSource: string } {
  return typeof shape?.openscadSource === "string" && shape.openscadSource.length > 0;
}

export const DEFAULT_OPENSCAD_SOURCE = `// OpenSCAD mode
// Press Ctrl/Cmd+Enter (or Render) to build this script into the scene.
// "From scene" / "From selection" turn existing shapes into code.
// Axes: X = right, Y = back, Z = up. Units: mm.
$fn = 64;

difference() {
  cube([40, 30, 20], center = true);
  cylinder(h = 30, d = 12, center = true);
}
`;
