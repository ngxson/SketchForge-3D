/// <reference lib="webworker" />

import { OPENSCAD_RUNTIME_BASE, type OpenScadRenderRequest, type OpenScadWorkerResponse } from "@/lib/openscadTypes";

// The OpenSCAD runtime is a plain Emscripten program: `callMain` runs the CLI once
// and the module cannot be reused after it exits (a second call reports "program
// has already aborted"). We therefore create a fresh Module instance per render,
// but compile the 9.6 MB WASM binary only once and reinstantiate the compiled
// module through Emscripten's `instantiateWasm` hook, which keeps subsequent
// renders fast.

type EmscriptenFS = {
  writeFile(path: string, data: string | Uint8Array): void;
  readFile(path: string, options?: { encoding?: "binary" | "utf8" }): Uint8Array | string;
  mkdir(path: string): void;
  analyzePath(path: string): { exists: boolean };
};

type OpenScadModule = {
  callMain(args: string[]): number;
  FS: EmscriptenFS;
};

type OpenScadModuleOptions = {
  noInitialRun: boolean;
  print(text: string): void;
  printErr(text: string): void;
  locateFile(path: string): string;
  instantiateWasm(imports: WebAssembly.Imports, receive: (instance: WebAssembly.Instance) => void): Record<string, never>;
};

type OpenScadFactory = (options: OpenScadModuleOptions) => Promise<OpenScadModule>;

const SCRIPT_DIR = "/work";
const INPUT_PATH = `${SCRIPT_DIR}/input.scad`;
const OUTPUT_PATH = "/output.stl";
// Emscripten prints this because there is no fontconfig/locale tree in the VFS.
const NOISE_PATTERNS = [/^Could not initialize localization/];

let factoryPromise: Promise<OpenScadFactory> | null = null;
let compiledModulePromise: Promise<WebAssembly.Module> | null = null;

function loadFactory() {
  const moduleUrl = `${OPENSCAD_RUNTIME_BASE}/openscad.js`;
  factoryPromise ??= import(/* webpackIgnore: true */ moduleUrl)
    .then((imported: { default: OpenScadFactory }) => imported.default)
    .catch((error: unknown) => {
      factoryPromise = null;
      throw new Error(
        `OpenSCAD runtime is not available at ${moduleUrl}. Run \`npm run copy:openscad\` (it runs automatically before dev/build). ${describe(error)}`,
      );
    });
  return factoryPromise;
}

function loadCompiledModule() {
  const wasmUrl = `${OPENSCAD_RUNTIME_BASE}/openscad.wasm`;
  compiledModulePromise ??= (async () => {
    const response = await fetch(wasmUrl);
    if (!response.ok) throw new Error(`Could not download ${wasmUrl} (HTTP ${response.status})`);
    if (typeof WebAssembly.compileStreaming === "function" && response.headers.get("content-type")?.includes("application/wasm")) {
      return WebAssembly.compileStreaming(response);
    }
    return WebAssembly.compile(await response.arrayBuffer());
  })().catch((error: unknown) => {
    compiledModulePromise = null;
    throw error;
  });
  return compiledModulePromise;
}

function describe(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "";
}

function post(message: OpenScadWorkerResponse, transfer: Transferable[] = []) {
  self.postMessage(message, { transfer });
}

function ensureDirectory(fs: EmscriptenFS, path: string) {
  const parts = path.split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current += `/${part}`;
    if (!fs.analyzePath(current).exists) fs.mkdir(current);
  }
}

async function render(request: OpenScadRenderRequest) {
  const log: string[] = [];
  const started = performance.now();
  const emit = (line: string) => {
    if (NOISE_PATTERNS.some((pattern) => pattern.test(line))) return;
    log.push(line);
    post({ type: "log", requestId: request.requestId, line });
  };

  const [factory, compiled] = await Promise.all([loadFactory(), loadCompiledModule()]);
  const instance = await factory({
    noInitialRun: true,
    print: emit,
    printErr: emit,
    locateFile: (path) => `${OPENSCAD_RUNTIME_BASE}/${path}`,
    instantiateWasm: (imports, receive) => {
      WebAssembly.instantiate(compiled, imports).then(receive).catch((error: unknown) => {
        emit(`ERROR: WebAssembly instantiation failed: ${describe(error)}`);
      });
      return {};
    },
  });

  ensureDirectory(instance.FS, SCRIPT_DIR);
  instance.FS.writeFile(INPUT_PATH, request.source);
  for (const file of request.files) {
    const fullPath = `${SCRIPT_DIR}/${file.path.replace(/^\/+/, "")}`;
    ensureDirectory(instance.FS, fullPath.slice(0, fullPath.lastIndexOf("/")));
    instance.FS.writeFile(fullPath, file.bytes);
  }

  let exitCode: number;
  try {
    exitCode = instance.callMain([INPUT_PATH, "--backend=manifold", "--export-format=binstl", "-o", OUTPUT_PATH]);
  } catch (error) {
    // Emscripten throws an ExitStatus object when main() calls exit().
    const status = typeof error === "object" && error !== null && "status" in error ? Number((error as { status: unknown }).status) : NaN;
    if (Number.isFinite(status)) {
      exitCode = status;
    } else {
      throw new Error(`OpenSCAD crashed: ${describe(error) || "unknown error"}`);
    }
  }

  if (exitCode !== 0) {
    const firstError = log.find((line) => /^(ERROR|WARNING)/.test(line));
    throw new Error(firstError ?? `OpenSCAD exited with status ${exitCode}`);
  }
  if (!instance.FS.analyzePath(OUTPUT_PATH).exists) {
    throw new Error("OpenSCAD produced no output. The script may render an empty object.");
  }
  const bytes = instance.FS.readFile(OUTPUT_PATH, { encoding: "binary" }) as Uint8Array;
  const stl = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  post({ type: "rendered", requestId: request.requestId, stl, log, durationMs: performance.now() - started }, [stl]);
}

self.onmessage = (event: MessageEvent<OpenScadRenderRequest>) => {
  const request = event.data;
  if (request.type !== "render") return;
  render(request).catch((error: unknown) => {
    post({ type: "error", requestId: request.requestId, message: describe(error) || "OpenSCAD render failed", log: [] });
  });
};
