import type { OpenScadInputFile, OpenScadRenderRequest, OpenScadRenderResult, OpenScadWorkerResponse } from "@/lib/openscadTypes";

export const OPENSCAD_RENDER_TIMEOUT_MS = 120_000;

type Pending = {
  resolve: (result: OpenScadRenderResult) => void;
  reject: (error: Error) => void;
  onLog?: (line: string) => void;
  log: string[];
  timer: number;
};

let worker: Worker | null = null;
let requestCounter = 0;
let pending: { requestId: number; entry: Pending } | null = null;

/** The runtime is fetched over HTTP from /openscad/, so it cannot run from a file:// page. */
export function openScadRuntimeAvailable() {
  return typeof window !== "undefined" && typeof Worker !== "undefined" && window.location.protocol !== "file:";
}

function settlePending(error: Error | null, result?: OpenScadRenderResult) {
  if (!pending) return;
  const { entry } = pending;
  pending = null;
  window.clearTimeout(entry.timer);
  if (error) entry.reject(error);
  else if (result) entry.resolve(result);
}

function terminateWorker() {
  worker?.terminate();
  worker = null;
}

function ensureWorker() {
  if (worker) return worker;
  const next = new Worker(new URL("../workers/openscad.worker.ts", import.meta.url), { type: "module" });
  next.onmessage = (event: MessageEvent<OpenScadWorkerResponse>) => {
    const message = event.data;
    if (!pending || message.requestId !== pending.requestId) return;
    if (message.type === "log") {
      pending.entry.log.push(message.line);
      pending.entry.onLog?.(message.line);
      return;
    }
    if (message.type === "rendered") {
      settlePending(null, { stl: message.stl, log: pending.entry.log, durationMs: message.durationMs });
      return;
    }
    const error = new Error(message.message);
    settlePending(error);
  };
  next.onerror = () => {
    settlePending(new Error("The OpenSCAD worker failed to start"));
    terminateWorker();
  };
  worker = next;
  return next;
}

/**
 * Cancels the in-flight render, if any. The worker is terminated because a
 * running OpenSCAD evaluation cannot be interrupted; the next render starts a
 * fresh worker (the compiled WASM is cached by the browser's HTTP cache).
 */
export function cancelOpenScadRender() {
  if (!pending) return;
  settlePending(new Error("OpenSCAD render cancelled"));
  terminateWorker();
}

export function renderOpenScad(
  source: string,
  options: { files?: OpenScadInputFile[]; timeoutMs?: number; onLog?: (line: string) => void } = {},
): Promise<OpenScadRenderResult> {
  if (!openScadRuntimeAvailable()) {
    return Promise.reject(new Error("OpenSCAD rendering needs the app to be served over http(s)"));
  }
  // Latest request wins: a new render supersedes a running one.
  cancelOpenScadRender();
  const target = ensureWorker();
  const requestId = ++requestCounter;
  return new Promise<OpenScadRenderResult>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      settlePending(new Error(`OpenSCAD timed out after ${Math.round((options.timeoutMs ?? OPENSCAD_RENDER_TIMEOUT_MS) / 1000)} s`));
      terminateWorker();
    }, options.timeoutMs ?? OPENSCAD_RENDER_TIMEOUT_MS);
    pending = { requestId, entry: { resolve, reject, onLog: options.onLog, log: [], timer } };
    const request: OpenScadRenderRequest = { type: "render", requestId, source, files: options.files ?? [] };
    target.postMessage(request);
  });
}
