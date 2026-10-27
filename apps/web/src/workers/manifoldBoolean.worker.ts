/// <reference lib="webworker" />

import type manifoldModule from "manifold-3d";
import type { ManifoldToplevel } from "manifold-3d";
import type { ManifoldBooleanRequest, ManifoldBooleanResponse, ManifoldBooleanStage } from "@/lib/manifoldBooleanTypes";
import { buildManifoldOperand, type ManifoldOperand, type ManifoldSolid } from "@/lib/manifoldOperands";

// Fork (see FORK.md, "Cutting without freezing the editor"): runs the Manifold subtraction for
// imported-mesh cuts off the main thread, so the editor can keep rendering and show progress.

let runtimePromise: Promise<ManifoldToplevel> | null = null;

function getRuntime(assetBase: string) {
  runtimePromise ??= import(/* webpackIgnore: true */ new URL("manifold.js", assetBase).href)
    .then((module) =>
      (module as { default: typeof manifoldModule }).default({
        locateFile: ((file: string) => new URL(file.endsWith(".wasm") ? "manifold.wasm" : file, assetBase).href) as () => string,
      }),
    )
    .then((runtime) => {
      runtime.setup();
      return runtime;
    });
  return runtimePromise;
}

function post(message: ManifoldBooleanResponse, transfer: Transferable[] = []) {
  self.postMessage(message, { transfer });
}

function dispose(solids: Iterable<ManifoldSolid | null>) {
  for (const solid of new Set(solids)) {
    try {
      solid?.delete();
    } catch {
      // already freed
    }
  }
}

function unionOf(runtime: ManifoldToplevel, operands: ManifoldOperand[], created: ManifoldSolid[]): ManifoldSolid | null {
  const parts: ManifoldSolid[] = [];
  for (const operand of operands) {
    const part = buildManifoldOperand(runtime, operand);
    if (!part || part.status() !== "NoError" || part.numTri() < 1) {
      dispose([part]);
      return null;
    }
    parts.push(part);
    created.push(part);
  }
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];
  const union = runtime.Manifold.union(parts);
  created.push(union);
  return union.status() === "NoError" && union.numTri() > 0 ? union : null;
}

self.onmessage = async (event: MessageEvent<ManifoldBooleanRequest>) => {
  const request = event.data;
  if (request.type !== "subtract") return;
  const { requestId } = request;
  const progress = (stage: ManifoldBooleanStage) => post({ type: "progress", requestId, stage });
  const created: ManifoldSolid[] = [];
  try {
    progress("loading");
    const runtime = await getRuntime(request.assetBase);
    const started = performance.now();
    progress("solid");
    const solid = unionOf(runtime, request.solids, created);
    progress("cutter");
    const cutter = solid ? unionOf(runtime, request.cutters, created) : null;
    if (!solid || !cutter) {
      post({ type: "error", requestId, reason: "notClosed", message: "An operand is not a closed solid" });
      return;
    }
    progress("subtract");
    const result = solid.subtract(cutter);
    created.push(result);
    if (result.status() !== "NoError" || result.numTri() < 1) {
      post({ type: "error", requestId, reason: "empty", message: "The subtraction produced no solid" });
      return;
    }
    progress("result");
    const mesh = result.getMesh();
    const positions = new Float32Array(mesh.triVerts.length * 3);
    for (let i = 0; i < mesh.triVerts.length; i += 1) {
      const offset = mesh.triVerts[i] * mesh.numProp;
      positions[i * 3] = mesh.vertProperties[offset];
      positions[i * 3 + 1] = mesh.vertProperties[offset + 1];
      positions[i * 3 + 2] = mesh.vertProperties[offset + 2];
    }
    post({ type: "done", requestId, positions, durationMs: performance.now() - started }, [positions.buffer]);
  } catch (error) {
    post({ type: "error", requestId, reason: "runtime", message: error instanceof Error ? error.message : "The boolean failed" });
  } finally {
    dispose(created);
  }
};
