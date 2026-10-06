import { createLocalId } from "@/lib/localIds";
import { zUpToSketchForge } from "@/lib/meshCoordinates";
import type { LatchBoxParams, LatchBoxPart } from "@/lib/latchBox";
import type { LatchBoxPartMesh, LatchBoxShapeData } from "@/lib/latchBoxTypes";
import type { WorkplaneShape } from "@/types/sketchforge";

export const LATCH_BOX_BODY_COLOR = "#7d93b8";
export const LATCH_BOX_COVER_COLOR = "#d9a066";
/** Gap between the body and the cover when both are placed side by side. */
export const LATCH_BOX_PART_GAP = 6;

const MIN_DIMENSION = 0.01;

export function isLatchBoxShape(shape: WorkplaneShape | null | undefined): shape is WorkplaneShape & { latchBox: LatchBoxShapeData } {
  return Boolean(shape?.latchBox && typeof shape.latchBox === "object" && shape.latchBox.params);
}

/**
 * Turns a generated part (Z-up generator coordinates) into a scene mesh shape. The mesh is
 * stored X/Z centred with its base at y = 0 like every imported mesh; the shape's placement
 * comes from `existing` (re-generation) or `placement` (first creation).
 */
export function latchBoxShapeFromMesh(
  part: LatchBoxPart,
  mesh: LatchBoxPartMesh,
  data: { setId: string; params: LatchBoxParams },
  options: { existing?: WorkplaneShape | null; placement?: { x: number; z: number; elevation: number } } = {},
): WorkplaneShape {
  const count = mesh.positions.length / 3;
  if (count < 3) throw new Error(`The latch box ${part} has no geometry`);
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  const converted = new Float32Array(mesh.positions.length);
  const normals = new Float32Array(mesh.normals.length);
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const [x, y, z] = zUpToSketchForge([mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]]);
    converted[i] = x;
    converted[i + 1] = y;
    converted[i + 2] = z;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
    if (mesh.normals.length >= i + 3) {
      const [nx, ny, nz] = zUpToSketchForge([mesh.normals[i], mesh.normals[i + 1], mesh.normals[i + 2]]);
      normals[i] = nx;
      normals[i + 1] = ny;
      normals[i + 2] = nz;
    }
  }
  const centerX = (minX + maxX) / 2;
  const centerZ = (minZ + maxZ) / 2;
  const positions: number[] = new Array(converted.length);
  for (let i = 0; i < converted.length; i += 3) {
    positions[i] = converted[i] - centerX;
    positions[i + 1] = converted[i + 1] - minY;
    positions[i + 2] = converted[i + 2] - centerZ;
  }
  const width = Math.max(MIN_DIMENSION, maxX - minX);
  const height = Math.max(MIN_DIMENSION, maxY - minY);
  const depth = Math.max(MIN_DIMENSION, maxZ - minZ);
  const existing = options.existing ?? null;
  const placement = options.placement ?? { x: 0, z: 0, elevation: 0 };

  return {
    id: existing?.id ?? createLocalId(`latch-box-${part}`),
    name: existing?.name ?? (part === "body" ? "Latch box body" : "Latch box cover"),
    kind: "mesh",
    color: existing?.color ?? (part === "body" ? LATCH_BOX_BODY_COLOR : LATCH_BOX_COVER_COLOR),
    hole: existing?.hole,
    x: existing?.x ?? placement.x,
    z: existing?.z ?? placement.z,
    elevation: existing?.elevation ?? placement.elevation,
    size: Math.max(width, depth),
    width,
    depth,
    height,
    rotation: existing?.rotation ?? 0,
    rotationX: existing?.rotationX ?? 0,
    rotationZ: existing?.rotationZ ?? 0,
    mirrorX: existing?.mirrorX,
    mirrorY: existing?.mirrorY,
    mirrorZ: existing?.mirrorZ,
    importedMesh: {
      positions,
      normals: normals.length === positions.length ? Array.from(normals) : undefined,
      baseWidth: width,
      baseDepth: depth,
      baseHeight: height,
      triangleCount: Math.floor(count / 3),
      sourceFormat: "json",
    },
    latchBox: { setId: data.setId, part, params: data.params },
    locked: existing?.locked ?? false,
    hidden: existing?.hidden ?? false,
  };
}
