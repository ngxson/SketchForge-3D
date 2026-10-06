/// <reference lib="webworker" />

import { buildLatchBox } from "@/lib/latchBox";
import type { LatchBoxBuildRequest, LatchBoxBuildResponse } from "@/lib/latchBoxTypes";

// Runs the @jscad/modeling CSG for the latch box off the main thread. Each build takes
// tens to a few hundred milliseconds depending on `segments`.

function post(message: LatchBoxBuildResponse, transfer: Transferable[] = []) {
  self.postMessage(message, { transfer });
}

self.onmessage = (event: MessageEvent<LatchBoxBuildRequest>) => {
  const request = event.data;
  if (request.type !== "build") return;
  const started = performance.now();
  try {
    const { body, cover } = buildLatchBox(request.params);
    post(
      { type: "built", requestId: request.requestId, body, cover, durationMs: performance.now() - started },
      [body.positions.buffer, body.normals.buffer, cover.positions.buffer, cover.normals.buffer],
    );
  } catch (error) {
    post({ type: "error", requestId: request.requestId, message: error instanceof Error ? error.message : "Could not build the latch box" });
  }
};
