/** A file written into the OpenSCAD worker's virtual filesystem before a render. */
export type OpenScadInputFile = {
  /** Path relative to the script directory, for example "meshes/gear.stl". */
  path: string;
  bytes: Uint8Array;
};

export type OpenScadRenderRequest = {
  type: "render";
  requestId: number;
  source: string;
  files: OpenScadInputFile[];
};

export type OpenScadWorkerResponse =
  | { type: "log"; requestId: number; line: string }
  | { type: "rendered"; requestId: number; stl: ArrayBuffer; log: string[]; durationMs: number }
  | { type: "error"; requestId: number; message: string; log: string[] };

export type OpenScadRenderResult = {
  stl: ArrayBuffer;
  log: string[];
  durationMs: number;
};

/** Public URL prefix where scripts/copy-openscad-wasm.mjs stages the runtime. */
export const OPENSCAD_RUNTIME_BASE = "/openscad";
