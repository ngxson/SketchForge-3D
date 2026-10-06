// Stages the OpenSCAD WebAssembly runtime (Emscripten glue + ~9.6 MB WASM) into
// the web app's public/ folder so the OpenSCAD workspace can load it lazily in a
// worker. Like occt-wasm, the glue is loaded through a webpackIgnore dynamic
// import from /openscad/, bypassing the Next.js bundler.
//
// The runtime is not on npm in a current form, so this script downloads the
// prebuilt "web" bundle that the official OpenSCAD playground uses from
// files.openscad.org and caches the zip under node_modules/.cache/. The staged
// files are gitignored; this script runs before dev/build to recreate them.
//
// Set SKETCHFORGE_OPENSCAD_WASM_URL to use a different bundle (for example a
// locally built one). Set SKETCHFORGE_REQUIRE_OPENSCAD=1 to make a failed
// download fail the build instead of printing a warning.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";

const DEFAULT_URL = "https://files.openscad.org/playground/OpenSCAD-2025.03.25.wasm24456-WebAssembly-web.zip";
const url = process.env.SKETCHFORGE_OPENSCAD_WASM_URL || DEFAULT_URL;
const required = process.env.SKETCHFORGE_REQUIRE_OPENSCAD === "1";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = join(root, "node_modules", ".cache", "openscad-wasm");
const dest = join(root, "apps", "web", "public", "openscad");
const markerPath = join(dest, "version.json");
const wantedFiles = ["openscad.js", "openscad.wasm"];

function fail(message) {
  if (required) {
    console.error(`[copy-openscad-wasm] ${message}`);
    process.exit(1);
  }
  console.warn(`[copy-openscad-wasm] ${message}`);
  console.warn("[copy-openscad-wasm] The OpenSCAD workspace will report that its runtime is missing until this succeeds.");
  process.exit(0);
}

async function alreadyStaged() {
  if (!wantedFiles.every((name) => existsSync(join(dest, name))) || !existsSync(markerPath)) return false;
  try {
    const marker = JSON.parse(await readFile(markerPath, "utf8"));
    return marker.url === url;
  } catch {
    return false;
  }
}

if (await alreadyStaged()) {
  console.log("[copy-openscad-wasm] runtime already staged in apps/web/public/openscad/");
  process.exit(0);
}

const zipName = url.split("/").pop() || "openscad-wasm.zip";
const zipPath = join(cacheDir, zipName);
let zipBytes;

if (existsSync(zipPath)) {
  zipBytes = new Uint8Array(await readFile(zipPath));
} else {
  console.log(`[copy-openscad-wasm] downloading ${url}`);
  let response;
  try {
    response = await fetch(url);
  } catch (error) {
    fail(`download failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) fail(`download failed with HTTP ${response.status}`);
  zipBytes = new Uint8Array(await response.arrayBuffer());
  await mkdir(cacheDir, { recursive: true });
  await writeFile(zipPath, zipBytes);
}

let entries;
try {
  entries = unzipSync(zipBytes);
} catch (error) {
  fail(`could not unzip ${zipPath}: ${error instanceof Error ? error.message : String(error)}`);
}

const missing = wantedFiles.filter((name) => !entries[name]);
if (missing.length) fail(`bundle is missing ${missing.join(", ")}`);

await mkdir(dest, { recursive: true });
await Promise.all(wantedFiles.map((name) => writeFile(join(dest, name), entries[name])));
await writeFile(markerPath, JSON.stringify({ url, stagedAt: new Date().toISOString() }, null, 2));

console.log(`[copy-openscad-wasm] staged ${wantedFiles.length} files into apps/web/public/openscad/`);
