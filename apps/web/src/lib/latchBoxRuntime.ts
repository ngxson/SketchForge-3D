import type { LatchBoxParams } from "@/lib/latchBox";
import type { LatchBoxBuildRequest, LatchBoxBuildResponse, LatchBoxPartMesh } from "@/lib/latchBoxTypes";

export const LATCH_BOX_BUILD_TIMEOUT_MS = 60_000;

export type LatchBoxBuildResult = { body: LatchBoxPartMesh; cover: LatchBoxPartMesh; durationMs: number };

type Pending = { resolve: (result: LatchBoxBuildResult) => void; reject: (error: Error) => void; timer: number };

let worker: Worker | null = null;
let requestCounter = 0;
const pending = new Map<number, Pending>();

function failAll(error: Error) {
  pending.forEach((entry) => {
    window.clearTimeout(entry.timer);
    entry.reject(error);
  });
  pending.clear();
}

function ensureWorker() {
  if (worker) return worker;
  const next = new Worker(new URL("../workers/latchBox.worker.ts", import.meta.url), { type: "module" });
  next.onmessage = (event: MessageEvent<LatchBoxBuildResponse>) => {
    const message = event.data;
    const entry = pending.get(message.requestId);
    if (!entry) return;
    window.clearTimeout(entry.timer);
    pending.delete(message.requestId);
    if (message.type === "built") entry.resolve({ body: message.body, cover: message.cover, durationMs: message.durationMs });
    else entry.reject(new Error(message.message));
  };
  next.onerror = () => {
    failAll(new Error("The latch box worker failed to start"));
    next.terminate();
    worker = null;
  };
  worker = next;
  return next;
}

/** Builds both latch box parts in the worker. Falls back to the main thread where workers are unavailable (tests). */
export async function buildLatchBoxParts(params: LatchBoxParams): Promise<LatchBoxBuildResult> {
  if (typeof Worker === "undefined" || typeof window === "undefined") {
    const started = Date.now();
    const { buildLatchBox } = await import("@/lib/latchBox");
    const { body, cover } = buildLatchBox(params);
    return { body, cover, durationMs: Date.now() - started };
  }
  const target = ensureWorker();
  const requestId = ++requestCounter;
  return new Promise<LatchBoxBuildResult>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pending.delete(requestId);
      reject(new Error("Building the latch box timed out"));
      worker?.terminate();
      worker = null;
    }, LATCH_BOX_BUILD_TIMEOUT_MS);
    pending.set(requestId, { resolve, reject, timer });
    const request: LatchBoxBuildRequest = { type: "build", requestId, params };
    target.postMessage(request);
  });
}
