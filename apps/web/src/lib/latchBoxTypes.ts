import type { LatchBoxParams, LatchBoxPart } from "@/lib/latchBox";

export type LatchBoxBuildRequest = {
  type: "build";
  requestId: number;
  params: LatchBoxParams;
};

export type LatchBoxPartMesh = {
  positions: Float32Array;
  normals: Float32Array;
};

export type LatchBoxBuildResponse =
  | { type: "built"; requestId: number; body: LatchBoxPartMesh; cover: LatchBoxPartMesh; durationMs: number }
  | { type: "error"; requestId: number; message: string };

/** Stored on each generated shape so the inspector can edit the parameters again. */
export type LatchBoxShapeData = {
  /** Shared by the body and cover created together, so edits regenerate both. */
  setId: string;
  part: LatchBoxPart;
  params: LatchBoxParams;
};
