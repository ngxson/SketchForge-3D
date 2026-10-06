# Fork changes

This file documents how this fork differs from upstream SketchForge.

## Orthographic projection by default

The editor opens in orthographic projection instead of perspective. Press **O** to switch between orthographic and perspective, as in upstream. The choice is not remembered between loads.

- Changed in `apps/web/src/components/WorkplaneViewport.tsx`: the viewport switches the camera to orthographic right after the initial home view is set.

## Agent instructions

`AGENTS.md` tells coding agents that this is a fork. It says to record changes in this file and to leave `README.md` unchanged.

- Added `AGENTS.md`.

## OpenSCAD mode

A third editor tab, **OpenSCAD**, next to Geometry and Sketch. It shows a code editor beside the normal 3D viewport. The user can turn the current scene (or selection) into an OpenSCAD script, edit it, and render it back into the scene with the real OpenSCAD engine (WebAssembly build, Manifold backend) running in a web worker. The rendered result becomes an ordinary mesh shape that remembers its script, so it can be re-opened and re-rendered later.

### User-facing behaviour

- **Entering the tab.** The editor decides what to show:
  1. If the draft has unsaved edits (differs from the last generated/loaded/rendered text), it is kept untouched. If a single code-backed shape is selected that is not the one being edited, a notice says to use *From selection* to load it.
  2. Otherwise, if exactly one code-backed shape is selected, its stored script is loaded and *Render* will **update** that shape in place.
  3. Otherwise, if shapes are selected, a script is generated from them and *Render* will **replace** them with one mesh (checkbox *Replace source shapes*, on by default, turns this into "add a new shape").
  4. Otherwise, if the draft is still the built-in template and the scene has visible shapes, a script is generated from the whole scene.
  5. Otherwise the built-in template (a cube with a cylinder hole) is shown; *Render* adds a new shape.
- **Buttons.** *From scene* and *From selection* regenerate the script explicitly (they do overwrite the draft). *From selection* with exactly one code-backed shape loads that shape's stored script instead of generating a mesh import for it. *Copy* copies the script. *Render* (also `Ctrl/Cmd+Enter`, `F5`, `F6` inside the editor) renders. *Cancel* appears while rendering.
- **After a successful render** the target becomes "update this shape", so repeated edit → render cycles keep replacing the same shape. The new shape is selected and the status line shows triangle count and render time; OpenSCAD's stdout/stderr appears in the log pane. Parser/evaluation errors highlight the reported line.
- **Code-backed shapes** behave like any imported mesh in Geometry mode (move, resize, hole, group, boolean…). Their script is stored on the shape and survives autosave (IndexedDB) and `.skf` export/import. Moving the shape in Geometry mode does **not** change the script; re-rendering the unchanged script puts the shape back where the script says.
- **Axes and units.** Scripts are in OpenSCAD's Z-up frame, millimetres. SketchForge `(x, y, z)` maps to OpenSCAD `(x, -z, y)`, so width → X, depth → Y, height → Z (same convention as the STL exporter).

### Design decisions

- **One-way per shape.** Scene → code works for everything (analytic primitives become real OpenSCAD primitives; everything else becomes an STL import). Code → scene always produces a single baked mesh. Parsing arbitrary OpenSCAD back into editable SketchForge primitives was deliberately not attempted; this matches how upstream already bakes booleans and fillets.
- **Real OpenSCAD, not a reimplementation.** The official OpenSCAD web build is used so that the full language and the Manifold backend are available. It runs in a worker; the main thread never blocks.
- **The runtime is downloaded at build time, not committed.** It is ~10 MB (9.6 MB WASM) and is GPL-2.0-or-later (compatible with this repo's AGPL-3.0). It is served as static files like the OCCT kernel and loaded through a `webpackIgnore` dynamic import, bypassing the bundler.
- **One module instance per render.** The Emscripten build runs OpenSCAD's `main()` once and cannot be reused afterwards (a second `callMain` reports "program has already aborted"). The WASM is compiled once per worker and re-instantiated per render via Emscripten's `instantiateWasm` hook, so a trivial render takes ~10–60 ms after the first.
- **Latest render wins / cancel terminates.** A running OpenSCAD evaluation cannot be interrupted, so cancelling (or starting a new render) terminates the worker. The next render creates a fresh worker; the browser's HTTP cache makes reloading the WASM cheap. Timeout is 120 s (`OPENSCAD_RENDER_TIMEOUT_MS`).
- **No COOP/COEP headers needed.** The build is single-threaded, so `SharedArrayBuffer` is not required. Nothing in `next.config.ts`, nginx or Electron changed.
- **Mesh-backed shapes are passed as STL files, not inlined as `polyhedron()`.** Keeps generated scripts readable and small. Files live in the worker's virtual filesystem under `/work/meshes/` next to `/work/input.scad`.

### Files

New:

| File | Role |
|---|---|
| `scripts/copy-openscad-wasm.mjs` | Downloads the OpenSCAD web bundle zip (cached in `node_modules/.cache/openscad-wasm/`), unzips it with `fflate`, stages `openscad.js` + `openscad.wasm` + `version.json` into `apps/web/public/openscad/` (gitignored). Skips work when `version.json` matches the URL. Env: `SKETCHFORGE_OPENSCAD_WASM_URL` overrides the bundle URL; `SKETCHFORGE_REQUIRE_OPENSCAD=1` makes a failed download fail the build (default: warn and continue, the tab then reports a missing runtime). |
| `apps/web/src/lib/openscadTypes.ts` | Worker message types (`OpenScadRenderRequest`, `OpenScadWorkerResponse`), `OpenScadInputFile`, `OpenScadRenderResult`, `OPENSCAD_RUNTIME_BASE = "/openscad"`. |
| `apps/web/src/workers/openscad.worker.ts` | The worker. Loads `/openscad/openscad.js` (ES module whose default export is the Emscripten factory), fetches and compiles `/openscad/openscad.wasm` once, and per request: creates a module with `noInitialRun`, writes `/work/input.scad` and the input files, runs `callMain(["/work/input.scad", "--backend=manifold", "--export-format=binstl", "-o", "/output.stl"])`, streams stdout/stderr lines back as `log` messages, and posts the STL `ArrayBuffer` (transferred). Non-zero exit → `error` with the first `ERROR:`/`WARNING:` line as message. Filters the harmless "Could not initialize localization" line. |
| `apps/web/src/lib/openscadRuntime.ts` | Main-thread client: singleton worker, `renderOpenScad(source, { files, timeoutMs, onLog })`, `cancelOpenScadRender()`, `openScadRuntimeAvailable()` (false under `file://`, where the runtime cannot be fetched). |
| `apps/web/src/lib/openscadCodegen.ts` | Scene → script. `generateOpenScadFromShapes(shapes, { localMeshForShape })` returns `{ source, files, shapeIds, warnings }`. `resolveOpenScadImports(source, knownFiles, sceneShapes, options)` collects the STL files a script references (see below). |
| `apps/web/src/lib/openscadImport.ts` | Script output → shape. `openScadShapeFromStl(stl, { source, existing, name })`, `isOpenScadShape(shape)`, `DEFAULT_OPENSCAD_SOURCE`, `OPENSCAD_SHAPE_COLOR`. |
| `apps/web/src/lib/openscadLanguage.ts` | CodeMirror 6 `StreamLanguage` for OpenSCAD syntax highlighting (keywords, builtins, `$variables`, strings, numbers, comments). |
| `apps/web/src/components/OpenScadWorkspace.tsx` | The side panel: toolbar, target description, CodeMirror editor, status line, log pane. Exports `OpenScadRenderStatus` and `errorLineFromLog`. |
| `tests/unit/openscadCodegen.test.ts`, `tests/unit/openscadImport.test.ts`, `tests/unit/openscadSkfRoundTrip.test.ts` | Unit tests (run with `npm test`). |

Modified:

| File | Change |
|---|---|
| `package.json` | `copy:openscad` script; `predev`/`prebuild` now run it after `copy:occt`. New dependencies: `codemirror`, `@codemirror/state`, `@codemirror/view`, `@codemirror/language`, `@codemirror/commands`, `@codemirror/legacy-modes` (installed, currently unused), `@codemirror/theme-one-dark`. |
| `apps/desktop/build-web.mjs` | Runs `scripts/copy-openscad-wasm.mjs` before `next build`, like the OCCT copy. |
| `.gitignore` | Ignores `apps/web/public/openscad/`. |
| `apps/web/src/types/sketchforge.ts` | `WorkplaneShape.openscadSource?: string`. |
| `apps/web/src/lib/workplaneShapes.ts` | `workplaneShapesEqual` compares `openscadSource` (otherwise script edits would not be detected as changes). |
| `apps/web/src/components/SketchForgeEditor.tsx` | `ToolbarMode` gains `"openscad"`; new state, handlers, tab button, toolbar ribbon and the panel mounted in `editor-body`. Details below. |
| `apps/web/src/app/globals.css` | `.openscad-*` styles (light + `html[data-theme="dark"]`), `.editor-body.openscad-mode` responsive rule. |

### Runtime bundle

- Default URL: `https://files.openscad.org/playground/OpenSCAD-2025.03.25.wasm24456-WebAssembly-web.zip` (2.9 MB zip; the same bundle the official openscad-playground downloads via its `libs-config.json`). Contents: `openscad.js` (124 KB Emscripten glue, ES module, `export default OpenSCAD`) and `openscad.wasm` (9.6 MB).
- To upgrade: change `DEFAULT_URL` in `scripts/copy-openscad-wasm.mjs` (check `libs-config.json` in `github.com/openscad/openscad-playground` for the current bundle name) and delete `apps/web/public/openscad/version.json` or run `npm run copy:openscad`.
- To build from source instead: the playground repo documents a Docker build; point `SKETCHFORGE_OPENSCAD_WASM_URL` at the resulting zip (must contain `openscad.js` and `openscad.wasm` at the root).
- The `openscad-wasm-prebuilt` npm package (Jan 2025) and the `openscad-playground` npm package (full React app, 50 MB, Monaco + MUI) were evaluated and rejected: the former is third-party and older, the latter far too heavy.
- Docker: `npm run build` inside the Dockerfile triggers `prebuild`, so the image build needs network access to files.openscad.org (or a pre-populated `node_modules/.cache/openscad-wasm/`). The staged `public/` folder is copied into the runtime image already.
- Static export (`npm run export`) stages the files too; `scripts/verify-static-worker-assets.mjs` was not changed. The static export path was not exercised in this fork.

### Codegen details (`openscadCodegen.ts`)

Every shape is emitted as a comment line plus one statement:

```
// <name>
translate([x, -z, elevation + h/2]) [rotate([rx,0,0])] [rotate([0,0,ry])] [rotate([0,-rz,0])] [scale([mx, mz, my])] <centred primitive>;
```

- Placement at the shape centre mirrors `WorkplaneViewport.createShapeObject`, which positions the group at the centre and offsets geometry by `-height/2`.
- Rotation: three.js Euler `XYZ` (matrix `Rx·Ry·Rz` in the Y-up frame) becomes `Rx(rx)·Rz(ry)·Ry(-rz)` in the Z-up frame; nested `rotate()` calls are written outermost-last so OpenSCAD applies them in that order. Mirror flags map `mirrorX→X`, `mirrorZ→Y`, `mirrorY→Z` as a negative `scale`.
- Holes (`shape.hole`) at any level go into `difference() { union() {solids} holes… }`. Hidden shapes are skipped.
- Groups (`groupedShapes`, no taper) are emitted as their children inside `translate(center) rotations mirror scale([sx, sz, sy]) translate([0,0,-h/2]) {…}` where `s* = size / groupedBase*`, matching `restoreGroupedChildren` in the editor. Children keep their group-local `x/z/elevation`. `groupOperation: "intersection"` becomes `intersection() { union(){solids} union(){holes} }` (approximation of upstream's intersection semantics).
- Per kind (centred, X = width `w`, Y = depth `d`, Z = height `h`):
  - `box` → `cube([w,d,h], center=true)`; with `radius` → `hull()` of 8 spheres.
  - `cylinder` → `cylinder(h, d=w, center=true, $fn=sides)`, wrapped in `scale([1, d/w, 1])` if elliptical. `cone` → `cylinder(h, r1=baseRadius, r2=topRadius, …)`.
  - `sphere` → `sphere(d)` or `scale([w/2,d/2,h/2]) sphere(r=1)`.
  - `pyramid` → `$fn=4` cone rotated 45° (square base aligned with axes), or `$fn=sides` cone rotated −90° (three.js puts the first vertex on +Z, OpenSCAD on +X). `polygon` (hexagonal prism) → `$fn=6` cylinder rotated −90°.
  - `roof` / `wedge` → `rotate([90,0,0]) linear_extrude(d, center=true) polygon(triangle)`. `roundRoof` → extruded half-disc. `halfSphere` → scaled sphere minus lower half. `torus` → `rotate_extrude() translate([R,0]) circle(r)` scaled to the outer diameter. `ring`/`tube` → difference of two cylinders with wall thickness `bevel ?? 4` (same clamping as `createHollowCylinderGeometry`).
  - Sketch extrusions with straight segments only → `linear_extrude(h, center=true) polygon(points[, paths])` using `cadSketchRegions` (outer + holes), points centred on the profile bounding box, Y negated; resized sketches get a `scale`.
  - Everything else (`gear`, `text`, `icosahedron`, `scribble`, tapered shapes, curved sketches, revolves, imported/baked meshes, groups with taper) → `import("meshes/<slug>.stl")` with the mesh written in the shape's **local** frame (X/Z centred, vertically centred, converted to Z-up by `exportMeshesToStl`), so the `translate/rotate` in code stays editable. Imported meshes use `resizedImportedMeshPositions`; native kinds use the `localMeshForShape` callback, which the editor wires to its module-level `geometryMeshForShape`. Taper is applied per vertex with `shapeTaperScaleAt`, matching `transformMesh`.
- File names are `meshes/<slugified shape name>.stl` with `-2`, `-3` suffixes on collisions. Numbers are rounded to 4 decimals. Header sets `$fn = 64` (option `defaultFn`); per-shape `sides` override it.
- `resolveOpenScadImports` runs before every render: files produced by the generation that created the draft are reused; any other `import("meshes/….stl")` in the script (e.g. after reloading a stored script, or hand-written) is regenerated by running the emitter over the current scene, so the name → shape mapping holds as long as the shape still exists with the same name. Missing files make OpenSCAD print a warning and skip that import.

### Import details (`openscadImport.ts`)

- Parses the binary STL with three's `STLLoader`, converts every vertex/normal with `zUpToSketchForge`, and — unlike `importedShapeFromStl` — never guesses the up axis and keeps the world placement: `x`/`z` = bounding-box centre, `elevation` = min Y, dimensions from the box, rotation 0, no mirrors. Local `importedMesh.positions` are X/Z centred with the base at y = 0, `sourceFormat: "json"` (treated as baked geometry by `.skf`, i.e. stored as a derived-mesh asset, not re-imported from a source file).
- With `existing`, keeps `id`, `name`, `color`, `hole`, `locked`; everything else (groups, edge treatments, CAD metadata, transforms) is dropped because the mesh already embodies the script.
- `openscadSource` is set on the shape. Persistence needs no schema work: `skfProject.ts` serialises the whole shape definition (`serializeShapeNode` spreads the record) and IndexedDB autosave spreads shapes too. `tests/unit/openscadSkfRoundTrip.test.ts` proves the round trip.

### Editor wiring (`SketchForgeEditor.tsx`)

- Types: `ToolbarMode = "geometry" | "sketch" | "openscad"`, `OpenScadTarget = { kind: "replace"; shapeIds } | { kind: "update"; shapeId } | null`.
- State: `openscadSource` (draft), `openscadBaseline` (last generated/loaded/rendered text; `source === baseline` means "pristine"), `openscadFiles` (STL inputs from the last generation), `openscadTarget`, `openscadReplaceSources`, `openscadStatus`.
- Handlers (defined right after `commitShapes`): `loadOpenScadShape`, `loadOpenScadFromShapes(shapes, "scene" | "selection")`, `enterOpenScadMode` (the rules listed under *Entering the tab*; called from `onToolbarModeChange` when the mode becomes `"openscad"`), `renderOpenScadToScene` (render → `openScadShapeFromStl` → `canonicalizeShape` → `commitShapes`, replacing the existing shape in place or removing replaced sources; aborts if the project changed meanwhile), `openscadTargetDescription` (memo for the panel's explanation line).
- A `useEffect` on `toolbarMode` dispatches a window `resize` event on the next frame because `WorkplaneViewport` only listens to window resizes; without it the canvas keeps its old width when the panel appears and the scene origin ends up off-screen.
- Layout: `editor-body` gets the `openscad-mode` class; the `OpenScadWorkspace` is rendered before the viewport branch, so the normal viewport stays mounted and interactive next to the code. `SecondaryToolbar` has a third tab button and an `openscad-toolbar-ribbon` branch (Home, help text, Export + Settings).
- Keyboard: the editor's global shortcut handler already ignores `isContentEditable` targets, so typing in CodeMirror does not trigger delete/copy/etc.

### UI (`OpenScadWorkspace.tsx`)

- CodeMirror 6 with `basicSetup`, the custom OpenSCAD language, `oneDark` when `resolvedTheme === "dark"` (swapped through a `Compartment`), `Prec.highest` keymap for `Mod-Enter`, `Ctrl-Enter`, `F5`, `F6` (render) and Tab indentation. External `source` changes are applied by dispatching a full-document replace when the prop differs from the doc.
- Error highlighting: `errorLineFromLog` finds `line N` in the first `ERROR`/`WARNING` log line; a `StateField` decoration adds `.cm-openscad-error-line` to that line and clears on the next status change.
- Panel width `min(46vw, 640px)`; below 980 px it stacks above the viewport.

### Tests and verification

- `npm test` → 50 files / 297 tests pass; `npm run typecheck` passes.
- Verified manually in headless Chrome (DevTools protocol script, not committed) against `npm run dev`: tab appears; scene → code for box + cylinder; render replaces sources (12 triangles); re-entering with the result selected loads it for update; template renders on an empty scene; a gear is exported as `meshes/gear.stl` and renders; syntax errors are reported and the line highlighted; Cmd+Enter renders; dirty drafts survive tab switches; *From selection* loads a stored script; cancel terminates and the next render works; after a page reload the shape still carries its script and loads for update; the viewport canvas shrinks to 860 px when the panel appears.

### Known limitations / ideas for later (OpenSCAD mode)

- `text()` in scripts has no fonts (the playground mounts a separate `fonts.zip`); SketchForge text shapes are exported as STL instead, which works. Standard libraries (BOSL2, MCAD…) are not bundled; `include`/`use` of them fails. Both could be added by writing more files into the worker FS.
- No customizer UI; `$fn` and parameters are edited in code.
- The draft script is editor state only: it survives tab switches but not a page reload (the rendered shape's stored script does). Persisting the draft per project (e.g. `sessionStorage` keyed by project id) would be a small addition.
- Replacing N source shapes produces one mesh; per-shape editability in Geometry mode is gone (same as upstream booleans). Undo restores the sources.
- Scripts are not parsed back into primitives; a code-backed shape stays a mesh. The MCP `create_shape`/`import_mesh` API was not extended; an `openscad_render` MCP command could reuse `renderOpenScad` + `openScadShapeFromStl`.
- Low-`$fn` cylinders may differ from three.js by a 90° phase (first vertex on +X vs +Z); only `pyramid`/`polygon` compensate.
- The render runs under `file://` (desktop static builds) is blocked by `openScadRuntimeAvailable()`; the Electron app uses the standalone HTTP server, so it is fine there.
- Very large scenes regenerate STL files for every mesh-backed shape on each *From scene*; that is proportional to an STL export.

## Box corner rounding styles and hollow boxes

The Box shape gains two options aimed at 3D-printed enclosures: a choice of **which edges the corner radius rounds**, and a **hollow** mode with a wall and floor thickness (open top).

### User-facing behaviour

- Box inspector, *Properties* card: **Rounding** (`All edges` / `Vertical edges`) and **Corner Radius** (0 = sharp, capped at half the smallest dimension). `All edges` is upstream's rounded box (all 12 edges, `RoundedBoxGeometry`). `Vertical edges` rounds only the four vertical edges, i.e. a rounded rectangle extruded along the height, with flat top and bottom faces.
- Box inspector, new *Hollow* card: **Wall** (0 = solid) and **Floor** (bottom thickness; defaults to the wall when unset). Any wall above 0 opens the top. With a corner radius, the cavity follows the outer rounding with radius `radius − wall`.
- Everything else works as before: resizing, taper (applied after hollowing, so it deforms the shell), holes, grouping, booleans, STL/OBJ/STEP/SVG export (the exporter uses the same geometry builder), OpenSCAD code generation (emits `linear_extrude … offset()` for vertical rounding and `difference()` for hollow boxes), `.skf` and autosave persistence.

### Data model

`WorkplaneShape` (apps/web/src/types/sketchforge.ts) gains `boxCorners?: "all" | "vertical"`, `boxWall?: number`, `boxFloor?: number`. `radius` and `steps` keep their upstream meaning. Undefined values mean upstream behaviour, so existing projects are unchanged. `workplaneShapesEqual` compares the new fields; `sceneShape` in `shapeCatalog.ts` copies them (clipboard paste), and the `.skf` writer spreads the definition so nothing else was needed for persistence (covered by `tests/unit/openscadSkfRoundTrip.test.ts`).

### Geometry (`apps/web/src/lib/boxGeometry.ts`)

- `createBoxGeometry({ width, depth, height, radius, corners, wall, floor, steps })` returns a `THREE.BufferGeometry` centred on the origin.
  - Solid: `BoxGeometry`, or `ExtrudeGeometry` of a rounded-rectangle `THREE.Shape` rotated so the extrusion runs along Y (`vertical`), or `RoundedBoxGeometry` (`all`).
  - Hollow: an inner solid of the same style (`width − 2·wall`, `depth − 2·wall`, radius `max(0, radius − wall)`), raised by `floor` and extended 1 mm above the top, is subtracted with **three-bvh-csg** (`Evaluator`, `SUBTRACTION`, synchronous). The wall is clamped to `maxBoxWall(width, depth)` = `min(width, depth)/2 − 0.2` and the floor to `height − 0.2`, so impossible values degrade to a thin shell instead of failing. The CSG is synchronous so the viewport can build it inside its shared-geometry cache; it costs a few milliseconds for a rounded box.
- `boxIsPlain(shape)` is the fast-path test (no radius, no wall). The viewport keeps drawing plain boxes from one shared unit cube scaled per shape; everything else is built at size and cached by its geometry signature, which now includes the three new fields.
- Callers: `WorkplaneViewport.createShapeObject` (box case, geometry signature, resize fast path), `geometryMeshForShape` in `SketchForgeEditor.tsx` (export/booleans), `openscadCodegen.ts` (box case + `boxSolid` helper), `cadBakeMetadata.cadModifierPrimitiveForAnalyticBox` (returns null for non-plain boxes so fillet/chamfer uses the tessellated mesh).

### Tests

`tests/unit/boxGeometry.test.ts` ray-casts the generated geometry to check flat tops with vertical rounding, curved tops with full rounding, the cavity and floor of hollow boxes, and clamping. `tests/unit/openscadCodegen.test.ts` covers the generated OpenSCAD.

### Known limitations

- Hollow boxes are closed at the bottom only; there is no option for a lid or an open side. Use a hole shape for that.
- The selection outline for rounded boxes is hidden (upstream behaviour); hollow sharp boxes show edges normally.
- The fillet/chamfer modifier treats rounded or hollow boxes as meshes, not analytic boxes.

## Latch & screw box generator shape

Adds the "Latch & screw box generator" (the standalone page kept at `.codex/project-thumbnails/Latch & screw box generator.html`) as a shape inside the app: **Shapes → Latch Box** creates the enclosure **body** and its **cover** side by side, and the inspector exposes every generator parameter. Editing a parameter rebuilds both parts.

### User-facing behaviour

- *Shapes* menu, last entry **Latch Box**. It builds both parts in a worker (tens of milliseconds) and places them on the current workplane: body to the left, cover to the right, 6 mm apart, both in their print orientation (body open side up, cover flat on its outer face). Only the body is selected afterwards so the parameters show immediately.
- Inspector for either part: cards **Box** (width, height, depth, wall, front plate, corner radius), **Latches** (count, width, lip protrusion, undercut, hook length, hook neck, hook style, support pad + gap/length/ramp), **Screw** (metric size, edge distance, boss width/length, hole depth, boss in cover, cover boss height, countersink + diameter) and **Cover & Fit** (cover thickness, side rails + width/height, clearance, curve segments). Checkboxes are rendered by the new toggle property. The generic Length/Width/Height and Taper controls are hidden for these shapes because the parameters define the size.
- The generator's validation rules are shown as a red list above the cards; while any rule fails the parameters are stored but the geometry is not rebuilt (the notice shows the first error).
- Body and cover created together share a set id, so editing one rebuilds both. Moving, rotating, colouring, deleting or ungrouping either part independently is fine. Copies keep the parameters and set id, so editing a copy also rebuilds its siblings.
- The parts are ordinary mesh shapes for everything else: booleans, export, OpenSCAD code generation (they become `import("meshes/latch-box-body.stl")` etc.), `.skf` and autosave.

### Architecture

| File | Role |
|---|---|
| `apps/web/src/lib/latchBox.ts` | TypeScript port of the page's `BoxGen` core on **@jscad/modeling** (new dependency, MIT, ~1.6 MB, loaded only in the worker). Exports `LatchBoxParams`, `LATCH_BOX_DEFAULTS` (the measured Xiaomi AAA sensor case defaults, screw M3), `normalizeLatchBoxParams`, `validateLatchBoxParams`, `latchBoxBody`, `latchBoxCover`, `assembleLatchBoxCover`, `latchBoxTriangles` (the page's weld/T-junction `cleanMesh` + flat normals) and `buildLatchBox`. The geometry code is deliberately kept line-for-line equivalent to the page so output matches; the only change is that `screwHole`/`screwClearance` are derived from `screw` as the page's UI did. |
| `apps/web/src/lib/latchBoxTypes.ts` | Worker protocol and `LatchBoxShapeData = { setId, part, params }`, stored on shapes as `WorkplaneShape.latchBox`. |
| `apps/web/src/workers/latchBox.worker.ts` | Runs `buildLatchBox` off the main thread and transfers the triangle buffers. |
| `apps/web/src/lib/latchBoxRuntime.ts` | `buildLatchBoxParts(params)`: singleton worker client with a 60 s timeout; falls back to running in-process when `Worker` is unavailable (tests). |
| `apps/web/src/lib/latchBoxShapes.ts` | `latchBoxShapeFromMesh(part, mesh, { setId, params }, { existing?, placement? })`: converts the Z-up generator mesh with `zUpToSketchForge`, centres it X/Z with the base at y = 0, and returns a `kind: "mesh"` shape (`sourceFormat: "json"`, i.e. baked) carrying `latchBox`. With `existing` it keeps id, name, colour, placement, rotation, mirrors and lock state. `isLatchBoxShape` is the type guard. |
| `apps/web/src/lib/latchBoxInspector.ts` | `latchBoxPropertyGroups(params, onChange)` builds the four inspector cards as `ShapePropertyConfig[]` (ranges with explicit `unit`, selects, toggles). |
| `apps/web/src/lib/shapeCatalog.ts` | `LATCH_BOX_ASSET_ID = "latch-box"` and the toolbar entry (`kind: "mesh"`, reuses the box icon). |
| `apps/web/src/components/SketchForgeEditor.tsx` | `addShape` intercepts the asset id and calls `addLatchBox(point)`; `scheduleLatchBoxUpdate(setId, params)` stores the parameters on every member immediately (no history entry), validates, debounces 150 ms, rebuilds in the worker and commits the regenerated parts; `updateShape` routes any `latchBox` patch to it (same pattern as `scheduleRevolveShapeUpdate`). |
| `apps/web/src/components/workplane/ShapeInspector.tsx` | New `TogglePropertyConfig` + `ToggleProperty`, `unit` override on range properties, exported property types and `ShapePropertyRows`, `LatchBoxCards` (collapsible cards + error list) shown instead of the Properties/Taper cards when `shape.latchBox` is set. |
| `apps/web/src/app/globals.css` | `.toggle-property`, `.property-hint`, `.latch-box-errors`. |

### Coordinates

Generator: box centred on XY, z = 0 front (closed) face, z = D open rim, +Y top (latches), −Y bottom (screw); cover in print orientation with its outer face on z = 0. Scene: generator `(x, y, z)` → SketchForge `(x, z, −y)`, so the body's open rim faces +Y (up) and the latches sit on the −Z side. The assembled transform from the page (`assembleLatchBoxCover`) is ported but not used by the UI yet.

### Tests

`tests/unit/latchBox.test.ts` checks validation of the defaults and of bad inputs, normalisation, the extents of the generated body (43 × 55 × 19) and cover, error throwing and the Y-up shape conversion. `tests/unit/openscadSkfRoundTrip.test.ts` checks that `latchBox` survives `.skf`.

### Known limitations / ideas for later

- No "assembled" or "cut" preview like the page; the parts are always side by side. `assembleLatchBoxCover` exists for a future "assemble" action.
- No 3MF export; use STL (per part) from the normal export panel.
- Resizing a part with the generic handles scales the baked mesh; the next parameter edit regenerates it at the parametric size.
- The shapes menu icon is the plain box icon.
