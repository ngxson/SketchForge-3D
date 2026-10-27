import { createLocalId } from "@/lib/localIds";
import type { SlidingLidBoxMesh, SlidingLidBoxParams, SlidingLidBoxPart } from "@/lib/slidingLidBox";
import type { WorkplaneShape } from "@/types/sketchforge";

/** Stored on each generated part so the inspector can edit the parameters again (fork feature, see FORK.md). */
export type SlidingLidBoxShapeData = {
  /** Shared by the body and lid created together, so edits rebuild both. */
  setId: string;
  part: SlidingLidBoxPart;
  params: SlidingLidBoxParams;
};

export const SLIDING_LID_BOX_BODY_COLOR = "#5d8fbf";
export const SLIDING_LID_BOX_LID_COLOR = "#e0a458";

const MIN_DIMENSION = 0.01;

export function isSlidingLidBoxShape(shape: WorkplaneShape | null | undefined): shape is WorkplaneShape & { slidingLidBox: SlidingLidBoxShapeData } {
  return Boolean(shape?.slidingLidBox && typeof shape.slidingLidBox === "object" && shape.slidingLidBox.params);
}

export function meshBounds(positions: number[]) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], positions[i + axis]);
      max[axis] = Math.max(max[axis], positions[i + axis]);
    }
  }
  return { min, max };
}

/**
 * Turns a generated part (Y-up triangle soup) into a scene mesh shape, stored X/Z centred with
 * its base at y = 0 like every imported mesh. On re-generation the placement comes from
 * `existing`; on creation from `placement` (the caller works out where each part goes).
 */
export function slidingLidBoxShapeFromMesh(
  part: SlidingLidBoxPart,
  mesh: SlidingLidBoxMesh,
  data: { setId: string; params: SlidingLidBoxParams },
  options: { existing?: WorkplaneShape | null; placement?: { x: number; z: number; elevation: number } } = {},
): WorkplaneShape {
  const count = mesh.positions.length / 3;
  if (count < 3) throw new Error(`The sliding lid box ${part} has no geometry`);
  const { min, max } = meshBounds(mesh.positions);
  const centerX = (min[0] + max[0]) / 2;
  const centerZ = (min[2] + max[2]) / 2;
  const positions = mesh.positions.map((value, index) => {
    const axis = index % 3;
    return axis === 0 ? value - centerX : axis === 1 ? value - min[1] : value - centerZ;
  });
  const width = Math.max(MIN_DIMENSION, max[0] - min[0]);
  const height = Math.max(MIN_DIMENSION, max[1] - min[1]);
  const depth = Math.max(MIN_DIMENSION, max[2] - min[2]);
  const existing = options.existing ?? null;
  const placement = options.placement ?? { x: 0, z: 0, elevation: 0 };

  return {
    id: existing?.id ?? createLocalId(`sliding-lid-box-${part}`),
    name: existing?.name ?? (part === "body" ? "Sliding lid box" : "Sliding lid"),
    kind: "mesh",
    color: existing?.color ?? (part === "body" ? SLIDING_LID_BOX_BODY_COLOR : SLIDING_LID_BOX_LID_COLOR),
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
      baseWidth: width,
      baseDepth: depth,
      baseHeight: height,
      triangleCount: Math.floor(count / 3),
      sourceFormat: "json",
    },
    slidingLidBox: { setId: data.setId, part, params: data.params },
    locked: existing?.locked ?? false,
    hidden: existing?.hidden ?? false,
  };
}
