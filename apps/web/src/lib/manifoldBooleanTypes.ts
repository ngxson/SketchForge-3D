import type { ManifoldOperand } from "@/lib/manifoldOperands";

export type ManifoldBooleanStage = "loading" | "solid" | "cutter" | "subtract" | "result";

export type ManifoldBooleanRequest = {
  type: "subtract";
  requestId: number;
  /** Page base URL; the worker loads `manifold.js` / `manifold.wasm` relative to it. */
  assetBase: string;
  solids: ManifoldOperand[];
  cutters: ManifoldOperand[];
};

export type ManifoldBooleanFailureReason = "notClosed" | "empty" | "runtime";

export type ManifoldBooleanResponse =
  | { type: "progress"; requestId: number; stage: ManifoldBooleanStage }
  | { type: "done"; requestId: number; positions: Float32Array; durationMs: number }
  | { type: "error"; requestId: number; reason: ManifoldBooleanFailureReason; message: string };
