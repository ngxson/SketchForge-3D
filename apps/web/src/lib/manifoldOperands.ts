import type { ManifoldToplevel } from "manifold-3d";
import { repairTJunctions } from "@/lib/meshRepair";

/**
 * Fork (see FORK.md, "Cutting without freezing the editor"). Boolean operands in a form that can be
 * posted to a worker: analytic primitives stay analytic (the same Manifold primitives the editor
 * built on the main thread), everything else is a triangle soup.
 */

export type ManifoldSolid = ReturnType<ManifoldToplevel["Manifold"]["cube"]>;

export type ManifoldPrimitiveOperand =
  | { kind: "cube"; matrix: number[] }
  | { kind: "sphere"; segments: number; matrix: number[] }
  | { kind: "cylinder"; segments: number; topRadiusScale: number; matrix: number[] };

export type ManifoldOperand =
  | ManifoldPrimitiveOperand
  | { kind: "bounds"; min: [number, number, number]; size: [number, number, number] }
  | { kind: "mesh"; positions: Float32Array };

const MESH_TOLERANCE = 0.0001;

function deleteSolid(value: { delete(): void } | null | undefined) {
  try {
    value?.delete();
  } catch {
    // already freed
  }
}

/** Builds a solid from a triangle soup; retries after T-junction repair when Manifold rejects it. */
export function manifoldSolidFromPositions(runtime: ManifoldToplevel, positions: Float32Array | number[]): ManifoldSolid | null {
  const attempt = (soup: Float32Array | number[]) => {
    const vertProperties = soup instanceof Float32Array ? soup : new Float32Array(soup);
    const mesh = new runtime.Mesh({
      numProp: 3,
      vertProperties,
      triVerts: Uint32Array.from({ length: vertProperties.length / 3 }, (_, index) => index),
      tolerance: MESH_TOLERANCE,
    });
    mesh.merge();
    try {
      const solid = runtime.Manifold.ofMesh(mesh);
      if (solid.status() === "NoError" && solid.numTri() > 0) return solid;
      deleteSolid(solid);
      return null;
    } catch {
      return null;
    }
  };
  if (positions.length < 9) return null;
  return attempt(positions) ?? attempt(repairTJunctions(Array.from(positions)).positions);
}

export function buildManifoldOperand(runtime: ManifoldToplevel, operand: ManifoldOperand): ManifoldSolid | null {
  if (operand.kind === "mesh") {
    return manifoldSolidFromPositions(runtime, operand.positions);
  }
  if (operand.kind === "bounds") {
    if (operand.size.some((value) => value <= 0.0001)) return null;
    const box = runtime.Manifold.cube(operand.size);
    const moved = box.translate(operand.min);
    if (moved !== box) deleteSolid(box);
    return moved;
  }
  const primitive =
    operand.kind === "cube"
      ? runtime.Manifold.cube(1, true)
      : operand.kind === "sphere"
        ? runtime.Manifold.sphere(1, operand.segments)
        : runtime.Manifold.cylinder(1, 1, operand.topRadiusScale, operand.segments, true);
  const transformed = primitive.transform(operand.matrix as unknown as Parameters<ManifoldSolid["transform"]>[0]);
  if (transformed !== primitive) deleteSolid(primitive);
  return transformed;
}

export function manifoldOperandTransferables(operands: ManifoldOperand[]): ArrayBuffer[] {
  return operands.flatMap((operand) => (operand.kind === "mesh" && operand.positions.buffer instanceof ArrayBuffer ? [operand.positions.buffer] : []));
}
