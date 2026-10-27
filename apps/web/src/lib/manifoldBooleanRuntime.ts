import type { ManifoldBooleanFailureReason, ManifoldBooleanRequest, ManifoldBooleanResponse, ManifoldBooleanStage } from "@/lib/manifoldBooleanTypes";
import { manifoldOperandTransferables } from "@/lib/manifoldOperands";

/**
 * Fork (see FORK.md, "Cutting without freezing the editor"). Client for `manifoldBoolean.worker.ts`
 * plus the duration model behind the progress dialog's ETA.
 */

export const MANIFOLD_BOOLEAN_TIMEOUT_MS = 10 * 60_000;

export class ManifoldBooleanError extends Error {
  constructor(message: string, readonly reason: ManifoldBooleanFailureReason | "cancelled" | "timeout") {
    super(message);
    this.name = "ManifoldBooleanError";
  }
}

export type ManifoldBooleanResult = { positions: Float32Array; durationMs: number };

type Pending = {
  resolve: (result: ManifoldBooleanResult) => void;
  reject: (error: Error) => void;
  onProgress?: (stage: ManifoldBooleanStage) => void;
  timer: number;
};

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

function dropWorker() {
  worker?.terminate();
  worker = null;
}

function ensureWorker() {
  if (worker) return worker;
  const next = new Worker(new URL("../workers/manifoldBoolean.worker.ts", import.meta.url), { type: "module" });
  next.onmessage = (event: MessageEvent<ManifoldBooleanResponse>) => {
    const message = event.data;
    const entry = pending.get(message.requestId);
    if (!entry) return;
    if (message.type === "progress") {
      entry.onProgress?.(message.stage);
      return;
    }
    window.clearTimeout(entry.timer);
    pending.delete(message.requestId);
    if (message.type === "done") entry.resolve({ positions: message.positions, durationMs: message.durationMs });
    else entry.reject(new ManifoldBooleanError(message.message, message.reason));
  };
  next.onerror = () => {
    failAll(new ManifoldBooleanError("The boolean worker failed to start", "runtime"));
    dropWorker();
  };
  worker = next;
  return next;
}

export function canUseManifoldBooleanWorker() {
  return typeof Worker !== "undefined" && typeof window !== "undefined" && window.location.protocol !== "file:";
}

export function manifoldAssetBase() {
  return new URL(".", window.location.href).href;
}

/** Runs `union(solids) - union(cutters)` in the worker. Aborting the signal terminates the worker. */
export function subtractInManifoldWorker(
  request: Omit<ManifoldBooleanRequest, "type" | "requestId">,
  options: { signal?: AbortSignal; onProgress?: (stage: ManifoldBooleanStage) => void } = {},
): Promise<ManifoldBooleanResult> {
  const target = ensureWorker();
  const requestId = ++requestCounter;
  return new Promise<ManifoldBooleanResult>((resolve, reject) => {
    const settle = (error: Error) => {
      const entry = pending.get(requestId);
      if (!entry) return;
      window.clearTimeout(entry.timer);
      pending.delete(requestId);
      // The WASM call cannot be interrupted, so cancelling means killing the worker.
      dropWorker();
      failAll(error);
      entry.reject(error);
    };
    const timer = window.setTimeout(() => settle(new ManifoldBooleanError("The boolean timed out", "timeout")), MANIFOLD_BOOLEAN_TIMEOUT_MS);
    pending.set(requestId, { resolve, reject, onProgress: options.onProgress, timer });
    options.signal?.addEventListener("abort", () => settle(new ManifoldBooleanError("The cut was cancelled", "cancelled")), { once: true });
    const message: ManifoldBooleanRequest = { type: "subtract", requestId, ...request };
    target.postMessage(message, manifoldOperandTransferables([...request.solids, ...request.cutters]));
  });
}

// ---- duration model for the ETA ----

/** Nanoseconds of boolean time per input triangle; refined after every run. */
export const DEFAULT_MANIFOLD_BOOLEAN_RATE = 3000;
const MIN_RATE = 100;
const MAX_RATE = 100_000;
const RATE_STORAGE_KEY = "sketchForge.booleanRateNsPerTriangle";
/** Worker start-up, message transfer and reading the result back. */
const FIXED_OVERHEAD_MS = 250;

export function estimateManifoldBooleanMs(triangles: number, rate = DEFAULT_MANIFOLD_BOOLEAN_RATE) {
  const safeRate = Number.isFinite(rate) && rate > 0 ? Math.min(MAX_RATE, Math.max(MIN_RATE, rate)) : DEFAULT_MANIFOLD_BOOLEAN_RATE;
  return FIXED_OVERHEAD_MS + (Math.max(0, triangles) * safeRate) / 1_000_000;
}

/** Blends a measured run into the stored rate (exponential moving average, half weight on the new run). */
export function updateManifoldBooleanRate(triangles: number, durationMs: number, previous = DEFAULT_MANIFOLD_BOOLEAN_RATE) {
  if (!(triangles > 0) || !Number.isFinite(durationMs) || durationMs <= 0) return previous;
  const measured = (Math.max(0, durationMs - FIXED_OVERHEAD_MS) * 1_000_000) / triangles;
  const base = Number.isFinite(previous) && previous > 0 ? previous : DEFAULT_MANIFOLD_BOOLEAN_RATE;
  return Math.min(MAX_RATE, Math.max(MIN_RATE, base * 0.5 + measured * 0.5));
}

export function loadManifoldBooleanRate() {
  try {
    const stored = Number(window.localStorage.getItem(RATE_STORAGE_KEY));
    return Number.isFinite(stored) && stored > 0 ? stored : DEFAULT_MANIFOLD_BOOLEAN_RATE;
  } catch {
    return DEFAULT_MANIFOLD_BOOLEAN_RATE;
  }
}

export function saveManifoldBooleanRate(rate: number) {
  try {
    window.localStorage.setItem(RATE_STORAGE_KEY, String(rate));
  } catch {
    // storage unavailable; the default rate is used next time
  }
}

export const MANIFOLD_BOOLEAN_STAGE_LABELS: Record<ManifoldBooleanStage, string> = {
  loading: "Loading the geometry kernel…",
  solid: "Preparing the solid…",
  cutter: "Preparing the hole…",
  subtract: "Cutting…",
  result: "Reading the result…",
};
