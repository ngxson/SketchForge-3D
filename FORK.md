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

- Box inspector, *Properties* card: **Rounding** (`All edges` / `Vertical edges`) and **Corner Radius** (0 = sharp; capped at half the smallest dimension for `All edges`, and at half the smaller of width and length for `Vertical edges`, since the height does not limit it). `All edges` is upstream's rounded box (all 12 edges, `RoundedBoxGeometry`). `Vertical edges` rounds only the four vertical edges, i.e. a rounded rectangle extruded along the height, with flat top and bottom faces.
- Box inspector, new *Hollow* card: **Wall** (0 = solid) and **Floor** (bottom thickness; defaults to the wall when unset). Any wall above 0 opens the top. With a corner radius, the cavity follows the outer rounding with radius `radius − wall`.
- Everything else works as before: resizing, taper (applied after hollowing, so it deforms the shell), holes, grouping, booleans, STL/OBJ/SVG export (the exporter uses the same geometry builder). B-Rep STEP export lists rounded and hollow boxes as skipped, with a reason; it used to write them as plain boxes. The rest also works as before: OpenSCAD code generation (emits `linear_extrude … offset()` for vertical rounding and `difference()` for hollow boxes), `.skf` and autosave persistence.

### Data model

`WorkplaneShape` (apps/web/src/types/sketchforge.ts) gains `boxCorners?: "all" | "vertical"`, `boxWall?: number`, `boxFloor?: number`. `radius` and `steps` keep their upstream meaning. Undefined values mean upstream behaviour, so existing projects are unchanged. `workplaneShapesEqual` compares the new fields; `sceneShape` in `shapeCatalog.ts` copies them (clipboard paste), and the `.skf` writer spreads the definition so nothing else was needed for persistence (covered by `tests/unit/openscadSkfRoundTrip.test.ts`).

### Geometry (`apps/web/src/lib/boxGeometry.ts`)

- `createBoxGeometry({ width, depth, height, radius, corners, wall, floor, steps })` returns a `THREE.BufferGeometry` centred on the origin.
  - Solid: `BoxGeometry`, or `ExtrudeGeometry` of a rounded-rectangle `THREE.Shape` rotated so the extrusion runs along Y (`vertical`), or `RoundedBoxGeometry` (`all`).
  - Hollow: an inner solid of the same style (`width − 2·wall`, `depth − 2·wall`, radius `max(0, radius − wall)`), raised by `floor` and extended 1 mm above the top, is subtracted with **three-bvh-csg** (`Evaluator`, `SUBTRACTION`, synchronous). The wall is clamped to `maxBoxWall(width, depth)` = `min(width, depth)/2 − 0.2` and the floor to `height − 0.2`, so impossible values degrade to a thin shell instead of failing. The CSG is synchronous so the viewport can build it inside its shared-geometry cache; it costs a few milliseconds for a rounded box.
- `boxIsPlain(shape)` is the fast-path test (no radius, no wall). The viewport keeps drawing plain boxes from one shared unit cube scaled per shape; everything else is built at size and cached by its geometry signature, which now includes the three new fields.
- Callers: `WorkplaneViewport.createShapeObject` (box case, geometry signature, resize fast path), `geometryMeshForShape` in `SketchForgeEditor.tsx` (export/booleans), `openscadCodegen.ts` (box case + `boxSolid` helper), `cadBakeMetadata.cadModifierPrimitiveForAnalyticBox` (returns null for non-plain boxes so fillet/chamfer uses the tessellated mesh).
- Grouping (booleans): upstream's box fast paths in `SketchForgeEditor.tsx` treated every `kind: "box"` as a cuboid, so grouping a rounded or hollow box with a hole, or with an imported/mesh shape, produced a sharp solid box. These paths now require `boxIsPlain`: `isAxisAlignedBoxCutter` (cuboid subtraction in `boxedBooleanMeshShape`, plane clipping in `booleanMeshShape`, box primitive in `shapeToManifoldSolid`), `primitiveManifoldForShape` (Manifold `cube`), and the residual-interior check in `manifoldBooleanMeshShape`. Rounded and hollow boxes go through their tessellated mesh (`meshForShape` → `createBoxGeometry`) instead.

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

## View-relative arrow-key movement

Arrow keys move the selection relative to the camera instead of along fixed workplane axes. Upstream always maps ArrowRight to the workplane's +X and ArrowUp to its −Z, so after orbiting the view (for example 90° or 180°) the keys move objects sideways or backwards on screen.

- ArrowLeft/ArrowRight move along whichever workplane axis (±X or ±Z) points most nearly to screen right; ArrowUp/ArrowDown use the other axis, signed to point away from the camera. "Away" is screen-up plus the view direction, so it works from a top-down view and when the plane is seen edge-on. The pairing of axes is chosen as a whole, which also covers vertical workplanes seen from the side. Ctrl/Cmd+ArrowUp/Down still move along the workplane normal; Shift still moves 5 units.
- Moves stay on the workplane axes (no diagonal moves). The default home view gives the same mapping as upstream.
- Step size follows the **Snap Grid** setting (0.1–5 mm, 8 mm for Brick). Upstream always moves 1 mm. With snapping Off the step stays 1 mm, and Shift still moves five steps. Moved coordinates are rounded to 1e-6 mm, so repeated fine steps don't accumulate float noise. `moveShapesByKeyboard` takes the step as its last argument (default 1), and the editor passes `snapStepForGrid(snapGridRef.current)`.
- Snap Grid fix (upstream bug): after the first Snap Grid change, the viewport stopped reporting later changes to the editor. The editor passes each change back down as the viewport's initial settings. The viewport then waited for those (identical) values to arrive through its state, which never happened, so every later change was swallowed. Dragging was unaffected because it uses the viewport's own copy; keyboard moves and the project's saved snap setting were not. Now `workspaceHydrationPendingFingerprint` (`lib/workplaneSettings.ts`) only waits when the incoming settings differ from the current ones. Used in `WorkplaneViewport.tsx`'s settings hydration; tested in `tests/unit/workplaneSettings.test.ts`.
- `apps/web/src/lib/keyboardMovement.ts`: `keyboardMovementAxes(workplane, view)` and an optional `view` argument (`KeyboardMovementView`: world-space camera right/up/forward) on `moveShapesByKeyboard`. Without a view the old fixed mapping is used.
- `apps/web/src/components/WorkplaneViewport.tsx`: optional `cameraAccessRef` prop, filled with a getter for the live camera. It is a getter because the camera object is replaced when switching projection.
- `apps/web/src/components/SketchForgeEditor.tsx`: passes `cameraAccessRef` and builds the view basis from the camera's world matrix (`keyboardMovementView`) on each key press.
- Tests: `tests/unit/keyboardMovement.test.ts` covers orbited views (±90°, 180°, 30°, 60°), top-down and edge-on views, Ctrl+ArrowUp, snap-grid step sizes (0.5, 2, 5, Brick, Off), Shift, and 0.1 mm steps without drift.

## Tetrahedron shape

A new **Tetrahedron** entry in the Shapes menu, after Wedge. It has 4 faces and is cut from a 20 mm cube. The top face is half of the cube's top square, cut along the diagonal. The tip is at the bottom, straight under the top's right-angle corner. Two side faces are vertical (they lie on the cube's sides) and one slopes.

- It is a `mesh` shape built directly from 4 triangles (`tetrahedronPositions` in `apps/web/src/lib/shapeCatalog.ts`, created in `makeShapeFromAsset`). Rendering, resizing (Length/Width/Height scale it), rotation, taper, holes and booleans, export and `.skf` files all use the existing imported-mesh code.
- It is left out of the per-shape customization picker in workspace settings (`WorkspaceSettingsModal.tsx`), since its kind (`mesh`) is not a customizable primitive.
- Icon: `apps/web/public/assets/sketchforge/shape-icons-gray/tetrahedron.png`.
- Tests: `tests/unit/shapeCatalog.test.ts` checks the 4 faces, the single bottom vertex, and outward winding (signed volume = cube / 6).

## Dovetail component

A new **Dovetail** entry in the Shapes menu, before Latch Box. It creates a parametric dovetail joint part. Its inspector card has a **Side** option: **Male (tail)** or **Female (slot)**.

### User-facing behaviour

- Male: a base plate with a tail on top. The tail is narrow where it meets the base (the neck) and widest at its top. Female: a block with the matching slot cut from its top, narrow at the opening and widest at the bottom. To join them, flip the male upside down over the female and slide it in along the length.
- Options in the *Dovetail* card, which replaces the Properties and Taper cards (as for the Latch Box):
  - **Side**: Male (tail) / Female (slot).
  - **Length**: along the slide direction (the shape's Y/length axis).
  - **Width**: of the base plate (male) or the block (female).
  - **Base**: plate thickness under the tail (male). Set it to 0 to get the tail alone, which you can group onto another part. It is shown as **Floor** for the female and is the thickness under the slot.
  - **Tail Width**: width of the tail at its widest point.
  - **Tail Depth**: how far the tail sticks out, which is also the slot depth.
  - **Angle (°)**: flank angle from vertical (0 to 40°, default 15°).
  - **Clearance**: female only. It grows the slot by this distance on every face (both flanks and the floor), so a printed male slides in. The male is never changed by it.
- Defaults: male, 30 × 30, base 5, tail 14 wide and 6 deep, 15°, clearance 0.2 mm.
- Impossible values show a red message above the card, as the Latch Box does: neck too narrow, male width below the tail width, female walls under 0.8 mm, or female floor under 0.4 mm after clearance. The part is still built, from the nearest valid values.
- Every edit rebuilds the mesh right away, keeping the part's position, rotation, colour and hole/solid mode. Resizing with the viewport handles scales the mesh like any mesh. The next parameter edit rebuilds it at the parameter size.

### Implementation

- `apps/web/src/lib/dovetail.ts`: `DovetailParams`, defaults, limits, `normalizeDovetailParams`, `validateDovetailParams`, `dovetailProfile` (the cross-section polygon), `dovetailPositions` (`THREE.ExtrudeGeometry` along Z, centred), and `dovetailShapePatch` (mesh plus matching width/depth/height).
- `apps/web/src/lib/dovetailInspector.ts`: the inspector card. It reuses the Latch Box card component (`LatchBoxCards`) and its error box.
- `WorkplaneShape.dovetail` (`apps/web/src/types/sketchforge.ts`) stores the parameters on the generated `mesh` shape. It is compared in `workplaneShapesEqual`, copied in `sceneShape` (clipboard), and saved in `.skf` and autosave like `latchBox`.
- `SketchForgeEditor.updateShape`: a `dovetail` patch is expanded with `dovetailShapePatch` before it is applied, so undo/redo and history treat it as an ordinary edit.
- `shapeCatalog.ts`: `DOVETAIL_ASSET_ID`, the menu entry, and creation in `makeShapeFromAsset`. `WorkspaceSettingsModal.tsx` leaves it out of the per-shape customization picker.
- Icon: `apps/web/public/assets/sketchforge/shape-icons-gray/dovetail.png`.
- Tests: `tests/unit/dovetail.test.ts` covers the profile sizes, that the male fits the female with exactly the clearance on the flanks, closed outward-facing meshes, shape sizing, validation, and creation from the menu.

## Dragging and panning past the workplane grid

Objects can be dragged with the mouse past the edge of the workplane grid, and the view can be panned (middle mouse) well past it. Upstream clamps the pointer to the grid area (6 mm inside its edge) while dragging, so objects stop at the border even though arrow keys and typed positions can already put them outside. Upstream also keeps the camera's orbit centre inside the grid, so panning stops at the grid edge.

- `apps/web/src/components/WorkplaneViewport.tsx`: `toPlacementWorkplanePoint` takes a `clampToArea` argument (default `true`, upstream behaviour). The move-drag start and move handlers pass `false`. Rotating several objects together no longer clamps their centres to the grid either.
- `constrainCamera` (same file): the orbit centre may go `2 × max(grid width, grid length)` past the grid on X and Z, and the same margin beyond upstream's height range (−70 to 120 mm). With the default 200 mm grid that is 500 mm from the centre each way. It is still bounded, so the scene can't be lost entirely; Home or the view cube recentres it.
- Still clamped as in upstream: where a newly added or dropped shape is placed, and the ruler.
- Orthographic clipping fix: the orthographic camera stays a fixed distance from its orbit centre (zooming changes its scale, not its position), and upstream gave it a 0.1 mm near plane. After panning far or zooming far out, parts of the model nearer to the viewer than the camera position were cut off along a horizontal line. The orthographic camera now uses a near plane of −6000 mm (`ORTHOGRAPHIC_NEAR`), so it shows geometry on both sides of its position. Perspective keeps 0.1 mm (`PERSPECTIVE_NEAR`), and switching projection no longer copies the near value across. Selection frames and transform handles no longer hide points "behind" an orthographic camera.

### Shift-drag axis lock

Holding **Shift** while dragging an object with the mouse locks the move to the workplane X or Y grid line through the drag's start point, whichever is closer to the drag direction. Pressing or releasing Shift mid-drag updates the position right away, without waiting for the mouse to move. Shift at the start of a click still toggles selection, as in upstream, so press Shift after the drag has started.

- `axisLockedDragDelta` in `apps/web/src/lib/placementWorkplane.ts` (tested in `tests/unit/placementWorkplane.test.ts`). It works on the active workplane's axes, so it also applies on tilted workplanes.
- `WorkplaneViewport.tsx`: the drag update moved from `handlePointerMove` into `updateDrag(clientX, clientY, shiftKey)`. The drag remembers the last pointer position (`DragState.lastClient`), and a window Shift keydown/keyup listener re-runs it.

## Paste to the right of the original

Paste (Ctrl/Cmd+V) puts the copies beside the copied shapes, to their right as seen from the current camera. They stay on the same row, so they don't move toward or away from the camera, and keep the same elevation. Upstream pastes 12 mm diagonally on the fixed X/Z axes and clamps the result to 110 mm.

- "Right" is the workplane axis (±X or ±Z) closest to screen-right, picked with the same `keyboardMovementAxes` mapping as the view-relative arrow keys. In a view between two axes, such as the default angled view, copies follow the grid line closest to screen-right.
- The step is the clipboard's size along that axis (world bounds of all copied shapes together) plus a 5 mm gap (`PASTE_GAP`), rounded up to whole millimetres. Copies never overlap the original, and a multi-shape clipboard moves as one block.
- Pasting the same clipboard again places the next copy one more step to the right (a row of copies). Copying something else starts over. Duplicate (Ctrl/Cmd+D) is unchanged.
- No clamp to the grid area, in line with the dragging change above.
- Changed in `apps/web/src/components/SketchForgeEditor.tsx` (`pasteShape`, `pasteRunRef`, `PASTE_GAP`).

## New shapes spawn at the view centre

A shape added from the Shapes menu (including the Latch Box parts) appears where the centre of the view meets the active workplane, snapped to the grid. Upstream always puts it at the workplane origin, even when you have panned away from it. Dropping a shape onto the plate still places it where it is dropped.

- `viewCenterOnWorkplane` in `apps/web/src/lib/placementWorkplane.ts` intersects the camera's view axis with the workplane and snaps in workplane coordinates. An orthographic camera sees the plane on either side of its position. Tested in `tests/unit/placementWorkplane.test.ts`.
- `SketchForgeEditor.tsx`: `newShapeBasePoint` (used by `addShape` and `addLatchBox` when there is no drop point) reads the camera through `viewportCameraRef` and the snap setting through `snapStepForGrid`. When the view runs along the workplane (edge-on), it falls back to the origin.

## Hollow cylinder

Cylinders can be hollow, like boxes. The cylinder inspector has a *Hollow* card with **Wall Thickness** and **Floor Thickness**. A wall above 0 opens the top. The floor defaults to the wall thickness, and **0 leaves the bottom open**, giving a tube. A new **Hollow Cylinder** entry in the Shapes menu, after Cylinder, adds a 20 × 20 × 20 cylinder with a 2 mm wall and 2 mm floor.

- Data: `WorkplaneShape.cylinderWall` and `cylinderFloor` (`types/sketchforge.ts`), compared in `workplaneShapesEqual` and copied in `sceneShape`. When unset, the cylinder is solid, so existing projects are unchanged.
- Geometry: `apps/web/src/lib/cylinderGeometry.ts`. `buildHollowCylinderGeometry` builds the mesh directly (outer wall, inner wall, top rim, then a floor or an open bottom rim), with no boolean. It uses the same angles as `THREE.CylinderGeometry`, so side count and orientation match solid cylinders. Oval cylinders use inner radii = outer radii − wall. The wall is clamped to leave a 0.2 mm hole (`maxCylinderWall`) and the floor to leave 0.2 mm of height. `cylinderIsPlain` is the fast-path test.
- Callers:
  - `WorkplaneViewport.tsx`: the hollow mesh is built at size and cached by a geometry signature that includes the new fields. Solid cylinders keep the shared unit cylinder and its resize fast path.
  - `geometryMeshForShape` in `SketchForgeEditor.tsx`: export and booleans.
  - `primitiveManifoldForShape`: a hollow cylinder goes through its mesh, not Manifold's solid cylinder.
  - `openscadCodegen.ts`: `difference()` with the inner cylinder overshooting open faces by 1 mm.
  - `stepExport.ts`: an exact B-Rep (cylinder minus cylinder) for round hollow cylinders.
- Inspector: `ShapeInspector.tsx` shows the Hollow card for cylinders as well as boxes. The workspace settings shape picker leaves out the Hollow Cylinder entry, since it shares the Cylinder's customization.
- Icon: `apps/web/public/assets/sketchforge/shape-icons-gray/hollow-cylinder.png`.
- Tests:
  - `tests/unit/cylinderGeometry.test.ts`: closed, outward-facing mesh with the exact volume for a cup and a tube, and the floor default and 0.
  - `tests/unit/openscadCodegen.test.ts`.
  - `tests/e2e/stepRoundTrip.e2e.ts`: real OCCT kernel. Cup and tube volumes are conserved, and the rounded box is skipped.


## Sliding lid box

A new **Sliding Lid Box** entry in the Shapes menu, before Latch Box, builds a parametric box with a lid that slides in along dovetail grooves. It ports the replicad *sliding-lid-box* configurator ([printables.com/model/425966](https://www.printables.com/model/425966-parametric-sliding-lid-box/files)) to Manifold. Like the Latch Box, it creates two mesh parts, a **body** and a **lid**, laid out as in the original: the lid on the bed in front of the box, both ready to print.

### User-facing behaviour

- Selecting either part shows a *Sliding Lid Box* card in place of Properties and Taper. The options are:
  - **Dimensions**: whether the sizes below are the outside or the usable inside size.
  - **Width**, **Depth**, **Height**: 30–200, 20–200 and 8–200 mm. The original's slider stops height at 15 mm, but the real minimum is 2 × wall + 3.5 mm (floor, lid, and 2 mm of room inside), checked with a message.
  - **Corner Radius**: 0–20 mm, on the vertical edges.
  - **Wall Thickness**: 3–10 mm.
  - **Clearance**: the lid/box fit, 0.2 mm in the original. This option is new in the port.
  - **Latch Depth**: 0–1 mm, default 0.25; this option is also new. It sets the height of the snap-latch ridge that keeps the lid closed, described below.
- Defaults are the original's: outside size 50 × 35 × 25 mm, radius 5, wall 3.
- Edits rebuild both parts after a short debounce (a few milliseconds of Manifold work) as one undoable step. Each part keeps its position, rotation and colour. Values that cannot work (a height or depth too small for the wall thickness) show a message, and the parts are left as they were.
- How the model works, as in the original: the lid enters through a slot in the front wall and runs in dovetail grooves cut into the side and back walls. A lip at its front edge fills the slot. A snap latch holds it closed, and three grip ridges sit on top.
- Snap latch (new in the port): a ridge across the top of the box's front wall, in the slot where the lid's front lip rests when closed. It is centred, up to 20 mm long, with a 1 mm radius, and reaches **Latch Depth** above the lid's underside. The lid's underside is flat except for a small matching dent (ridge + clearance) under the front lip. Closed, the ridge sits in the dent and holds the lid. While sliding, the lid rides over the ridge, so Latch Depth sets both the click and the sliding friction; the default 0.25 mm is kept low for that reason. Latch Depth 0 removes the ridge and dent. The original's small hidden latch pins (0.5 mm pins on the rails, dimples in the lid, about 0.2 mm of hold) are kept as they were. Parts made before this option get the default at their next edit.

### Implementation

- `apps/web/src/lib/slidingLidBox.ts`: parameters (`normalizeSlidingLidBoxParams`, `validateSlidingLidBoxParams`, `slidingLidBoxOuterSize`) and `buildSlidingLidBox(runtime, params, { assembled? })`. Each convex piece of the original is a Manifold convex hull of its outline points: the filleted and chamfered outer box, the rounded interior, the lid plate with rounded back corners, each segment of the four-section dovetail loft, and the capsule grips. The pieces are combined with Manifold booleans in the same order as the original. The built mesh is converted from the original's Z-up frame to SketchForge's Y-up frame.
- `apps/web/src/lib/slidingLidBoxShapes.ts`: `SlidingLidBoxShapeData` (set id, part, params) and `slidingLidBoxShapeFromMesh`, the Latch Box pattern. `WorkplaneShape.slidingLidBox` is compared in `workplaneShapesEqual`, copied in `sceneShape`, and saved in `.skf` and autosave with the shape.
- `apps/web/src/lib/slidingLidBoxInspector.ts`: the inspector card. It reuses the Latch Box card component and error box.
- `SketchForgeEditor.tsx`: `addSlidingLidBox` (the menu intercept, at the view centre or drop point) and `scheduleSlidingLidBoxUpdate` (the debounced rebuild of both parts of a set). Both use the editor's shared `getManifoldRuntime()`.
- Icon: `apps/web/public/assets/sketchforge/shape-icons-gray/sliding-lid-box.png`.
- Tests: `tests/unit/slidingLidBox.test.ts` runs the real `manifold-3d` on five variants (rounded, square, small radius, large with thick walls, internal sizes). It checks:
  - both parts are closed solids;
  - the outside size matches;
  - assembled, the lid sits clear of the box (the snap ridge rests in its groove);
  - sliding out through the front, its flat underside rides over the ridge, and it is clear once fully out;
  - lifting the lid 1 mm or pushing it 1 mm back collides, so the rails hold it and the back wall stops it;
  - the print layout puts the lid on the bed in front of the box;
  - the ridge's interference grows with Latch Depth (none at 0), and the only material removed from the lid's underside is the small dent;
  - the lid keeps resting flat on the bed in the print layout;
  - the variants include a large corner radius (deep front lip) and a 10 mm-tall box.

### Known limitations

- The original's engraved **lid label** (and its multi-material text body) is not ported. It needs a font-to-solid step this module does not have.
- After a parameter edit, each part stays where it was. Making the box much deeper can make it overlap the lid until the lid is moved.
- The original's dimension annotations are not drawn (the editor's own rulers can be used).

## 3MF import

**3MF** files can be imported like STL, OBJ, STEP and SVG: from the editor's Import dialog, the dashboard's *Open SKF or import geometry*, or by dropping them on the editor (see below). Upstream has no 3MF import.

- `apps/web/src/lib/threeMfImport.ts` (`importedShapeFrom3mf`) unzips the file with `fflate`. It reads the root model named in `_rels/.rels` (falling back to `3D/3dmodel.model` or any `.model` part) and then:
  - reads mesh objects, and component objects, including components in other model parts via the production extension's `p:path`. That is how Bambu Studio, Orca Slicer and PrusaSlicer write their project files.
  - applies every build item with its transform, composing nested component transforms. Mirroring transforms flip the triangle winding so faces still point outward.
  - converts the model unit (micron, millimetre, centimetre, inch, foot, metre) to millimetres, and the 3MF Z-up frame to SketchForge's Y-up.
  - skips objects marked `support` or `other`.
  - uses the first build item's base-material colour, when it has one, as the shape colour.
- All build items become **one** mesh shape, like an STL import. A slicer project with several plates therefore comes in as all its plates side by side, as laid out in the slicer.
- A sliced `.gcode.3mf` (G-code and thumbnails, no model) is reported as such instead of "no geometry".
- The XML is scanned with small regular expressions for the elements above rather than a DOM parser, so it also runs in Node tests and stays fast. In a test run on 120 real slicer files, 116 imported in 1 ms to 3 s (up to 2.9 M triangles); the other 4 were sliced G-code files, correctly reported.
- Plumbing:
  - `"3mf"` is added to `ProjectAssetSourceFormat` and to `importedMesh.sourceFormat` (`types/sketchforge.ts`).
  - It is accepted by `importExtensionSupported` and `sourceFormatForFileName`, with media type `model/3mf`.
  - The `.skf` source-asset validation accepts it, and the default `.skf` source importer rebuilds the mesh from the stored 3MF.
  - The import branches in `SketchForgeEditor.tsx` and `app/page.tsx`, the file pickers' `accept` lists, and the import hints all include it.
- `importedShapeFromTriangles` in `objImport.ts` (previously the private `importedObjShapeFromTriangles`) is now shared by OBJ and 3MF, with a `format` argument for metadata and error messages.
- Tests: `tests/unit/threeMfImport.test.ts` covers:
  - the build transform and Z-up to Y-up conversion;
  - inch units;
  - components in a separate part via `p:path`;
  - a mirroring transform keeping faces outward;
  - the base-material colour, and support objects being skipped;
  - error cases, including sliced files;
  - an `.skf` round trip through the real default source importer.

## Drop files anywhere to import

Files dragged from the desktop can be dropped anywhere on the editor, not only on the Import dialog's drop zone. A full-window "Drop to import" overlay shows while files are dragged over the editor. Geometry is imported as with the Import button, and a single `.skf` opens as a project.

- `SketchForgeEditor.tsx`: a window-level `dragenter`/`dragover`/`dragleave`/`drop` listener, active while the editor is mounted. It reacts only to drags that carry files (`dataTransfer.types` includes `Files`), so dragging shapes from the Shapes menu onto the plate works as before. It is the only file-drop import path: the dialog's drop zone now only cancels the browser's default (opening the file in the tab) and lets the event reach the window. This avoids a double import, and the overlay always closes. The dialog panel's `onImportFiles` prop was removed as unused.
- `app/globals.css`: `.file-drop-overlay` styles for light and dark themes. The overlay ignores the pointer so drops reach the page.

## Coloured shape outlines

Every shape is drawn with an outline along its creases, in a darker shade of its own colour, so shapes stay readable when many overlap (in the style of Tinkercad). Upstream outlines only "complex" shapes (cones, pyramids, meshes…) in thin dark grey, and plain boxes, cylinders and text not at all until selected.

- `apps/web/src/components/WorkplaneViewport.tsx`, `addShapeEdgeDecorations`:
  - Each unselected shape gets edges where faces meet at more than 30° (`SHAPE_OUTLINE_ANGLE`). That gives box edges and cylinder rims, while spheres and other smooth surfaces stay clean.
  - Colour is the shape colour darkened by 50% (`SHAPE_OUTLINE_DARKEN`), opacity 0.9. Holes keep their grey outline.
  - Outlines are 2.5 px wide (`SHAPE_OUTLINE_WIDTH`). Plain WebGL lines are always 1 px, so they use three.js fat lines (`LineSegments2` + `LineMaterial`). Geometry and materials are cached and shared per edge geometry and per colour (`shapeOutlineGeometryCache`, `shapeOutlineMaterialCache`). The line resolution follows the viewport size (`setShapeOutlineResolution`, at start-up and on resize).
  - Outlines are not pickable themselves; clicks go to the surface they outline.
  - The selection outline is unchanged (thin cyan line).
  - Imported meshes above 40,000 triangles still get no outline, as before, to keep large models fast.
- Shape surface materials use a small polygon offset, so the full width of the outline shows instead of being half-hidden by the faces beside the edge.

## Reference images

A **PNG, JPG or WebP** photo can be imported as a translucent reference image to model against, for example a product photo or a side view to trace. Import it with the Import button or by dropping it anywhere on the editor. Upstream's 3D editor has an unused image-plate importer (`importedShapeFromImage`), which this replaces; the Sketch tab's own reference images are unchanged.

- **Placement:** the image lies flat on the workplane at the view centre, sized like upstream's image plates (longest side 72 mm, aspect kept). The usual handles move, rotate and resize it; rotate it 90° to stand it up as a front or side view.
- **Selecting:** click the photo itself. Upstream never lets image plates be picked by clicking; that rule is relaxed for reference images in the viewport's direct hit test only. The fuzzy "nearest shape" fallback, box (marquee) selection and Select All (Ctrl/Cmd+A) still leave reference images out, so selecting your shapes to group or export them doesn't catch the photo underneath.
- **Inspector:** the *Reference Image* card replaces Properties, Taper and Hollow. It has **Opacity (%)** (5–100, default 50) and **Width**/**Length**, which keep the photo's aspect ratio. The Solid/Hole choice is replaced by a note that the image is never exported.
- **Never part of the model:**
  - left out of STL, OBJ, SVG and STEP exports;
  - grouping or intersecting a selection that contains one is refused with a message;
  - no shadow, and no coloured outline (only the selection outline when selected).
- **Saving:** it is kept in `.skf` projects and autosave like any image plate (the image is stored as a project image asset).
- Implementation:
  - `apps/web/src/lib/referenceImage.ts`: `isReferenceImage`, `referenceImageOpacity`, `isReferenceImageFile`, `withoutReferenceImages`.
  - `WorkplaneShape.imagePlate` gains `reference?: boolean` and `opacity?: number` (`types/sketchforge.ts`). A reference image is a 0.2 mm `box` with an `imagePlate` marked `reference`.
  - `SketchForgeEditor.tsx`: `referenceImageShapeFromFile` replaces the unused `importedShapeFromImage`. `importFiles` turns image files into reference images at the view centre. Select All skips them. The export paths filter with `withoutReferenceImages`, and grouping and intersection refuse them. The Import dialog's file picker and the drop hints mention photos.
  - `WorkplaneViewport.tsx`: the click hit test accepts reference images. `createImagePlateMaterials` draws a reference image as an unlit, double-sided, translucent picture with invisible box sides. It writes depth so the grid behind it doesn't draw over it. `addMesh` and `addShapeEdgeDecorations` skip its shadow and outline.
  - `ShapeInspector.tsx`: the *Reference Image* card and the hint.
- Tests: `tests/unit/referenceImage.test.ts`.

## Asterisk shape

A new **Asterisk** entry in the Shapes menu, before Dovetail: straight arms with square ends radiating from the centre, extruded to a height. Selecting it shows an *Asterisk* card in place of Properties and Taper:
- **Diameter**: tip to tip, measured across the end faces of opposite arms (default 30 mm);
- **Arms**: the number of points, 2–80 (default 6). Odd counts work; 2 gives a plain bar;
- **Show Arms**: how many of those arms to draw, 1…Arms (default all). The arms keep the spacing set by Arms, and only the first N are drawn as a fan, going clockwise in the top view from the top arm; the rest are blank. For example, 24 arms showing 10 gives a 135° fan of arms 15° apart. If the blank sector is 180° or more, the centre gets a rounded back of the arm's width on that side, so a single arm has a round back end. With a smaller blank sector, the two outer arms meet at an inner corner like any neighbours. Changing Arms keeps the shown count (capped), or keeps "all" if all were shown;
- **Thickness**: the width of each arm (default 6 mm). It is limited so every arm keeps an end beyond the point where it meets its neighbours;
- **Height**: the extrusion height (default 5 mm);
- **Rounding**: None (default), **All edges**, **Top & bottom edges** or **Outward faces**, with a **Rounding Radius** (default 1 mm, shown when rounding is on):
  - *All edges* rounds the arm-end corners, fills the inside corners between arms (both in plan view), and rounds the edges around the top and bottom faces.
  - *Top & bottom edges* rounds only the edges around the top and bottom faces.
  - *Outward faces* rounds the four long edges along every arm. Each arm becomes a rod with a rounded-rectangle cross-section, round when thickness = height and the radius is half of it. The arm ends stay flat at full length and the footprint seen from above is unchanged. Intended use: make the asterisk a hole through the wall of a hollow cylinder (centred on it, at the height wanted) to cut evenly spaced rounded holes around it, then group.
  
  In plan view (*All edges*), each corner becomes an exact arc tangent to both edges, capped at half the arm thickness on an arm end. Top and bottom rounding uses a quarter-round extrusion bevel, inset by its own size, so the outline and the height stay as set; that radius is capped at half the height and half the thickness. *Outward faces* is built from stacked outline rings: at each height the cross-section is the same asterisk with arms narrowed by the quarter round (arm sides, inner corners and hub move with the width), joined by walls and closed by flat caps. Its radius is capped at half the height and 98% of half the thickness, so the narrowest cap stays a proper polygon; a "round" hole is therefore within 0.07 mm of a circle for a 6 mm arm.

The first arm points to −Z, straight up on screen in the top view, like a typed asterisk.

- `apps/web/src/lib/asterisk.ts`: `AsteriskParams`, limits, `normalizeAsteriskParams`, `maxAsteriskThickness`, `asteriskOutline` (the exact outline: two corners at each arm's end, one inner corner per pair of neighbouring shown arms, on their bisector at (t/2)/sin(θ/2) from the centre for an angle θ between them, and a half-width arc across a blank sector of 180° or more), `roundCorners` (plan-view arcs on corners tagged as arm-end or inside), `asteriskPositions` (`THREE.ExtrudeGeometry`, Y-up, with the inset bevel for top/bottom rounding) and `asteriskShapePatch` (mesh plus matching size, centred on its bounding box so odd arm counts are centred).
- It follows the Dovetail pattern: a `mesh` shape carrying `WorkplaneShape.asterisk`, which is compared in `workplaneShapesEqual`, copied in `sceneShape` and saved with the shape. An `asterisk` patch is expanded in `SketchForgeEditor.updateShape`, so edits are ordinary undoable steps. The inspector card is `lib/asteriskInspector.ts`, the menu entry is `ASTERISK_ASSET_ID` in `shapeCatalog.ts`, and the entry is left out of the workspace-settings shape picker.
- Icon: `apps/web/public/assets/sketchforge/shape-icons-gray/asterisk.png`.
- Tests: `tests/unit/asterisk.test.ts` checks the outline area against the closed form (central N-gon plus N arm strips) for 6, 5, 8 and 2 arms. Partial fans (10 of 24, 1, 2 and 4 of 6, 3 of 4, 40 of 80) are checked against a sampled reference area, the shown arm rectangles plus the rounded back. Rounding is checked against the exact area change per corner, r²(cot(θ/2) − (π − θ)/2), for *All edges*. *Outward faces* is checked so that every vertex of an arm's end face lies exactly on the rounded-rectangle profile, and that thickness = height with half the radius gives a circle (within the cap). The footprint and height are checked to be unchanged. The tests also check that top/bottom rounding keeps the size and height and reduces the volume, and that rounding works with partial fans and odd arm counts. It also checks closed, outward-facing meshes, the diameter and size, the centring of odd counts, the thickness limit, and creation from the menu.

## Grow / Shrink (surface offset)

A *Grow / Shrink* card in the inspector (collapsed by default) moves every face of the selected shapes outward by a **Distance** (−5 to 5 mm, default 0.1 mm); negative values shrink. Typical use: duplicate a shaft, grow it by 0.1–0.2 mm and make it a hole, giving the hole it fits in with printing tolerance. Or shrink a copy of a hole to get a matching peg.

- Works on any selected, unlocked, visible shape (primitives, groups, imported meshes, generated parts), but not on reference images. Each shape is replaced in place by a mesh shape with the same id, name, colour, solid/hole mode and visibility, as one undoable step. The shape's own settings (box radius, asterisk arms, generator parameters…) are baked in and can no longer be edited, as the card says.
- An offset that would turn a shape inside out (shrinking by half its thickness or more) or lose volume when growing is refused with a message, and nothing changes.
- Algorithm (`apps/web/src/lib/meshOffset.ts`, `offsetTriangleSoup`):
  - takes the shape's world-space mesh (`meshForShape`) and welds its vertices;
  - moves each vertex so it lies the distance away from every distinct face plane meeting there. With up to three independent planes, this is solved exactly as the smallest such move (Gram system), so box corners, inside corners, cylinder rims and most CAD vertices are exact and every face ends up exactly the distance from where it was. More planes (spheres, cone tips) use a least-squares fit, with a regularised fallback only for degenerate cases;
  - caps each move at 6× the distance against needle-sharp vertices. The triangle count and topology are kept.
  
  `meshShapeFromWorldPositions` turns the result back into a shape.
- Limitations: like any mesh offset, a distance larger than a feature (shrinking a wall thinner than twice the distance, growing into a slot narrower than twice the distance) makes the surface intersect itself, and only the inside-out cases are detected. Curved surfaces keep their facets, so a grown cylinder's radius grows by the distance at its flat facets (exactly) and slightly more at the facet edges.
- `SketchForgeEditor.tsx`: `offsetSelected(distance)`, passed to the inspector through `WorkplaneViewport`'s `onOffsetSelection` prop (`ShapeInspector`'s `onOffset`).
- Tests: `tests/unit/meshOffset.test.ts` checks that every face moves exactly by the distance (to 1e-9 mm) for a box, a shrunk box, an L-shape with an inside corner, and grown and shrunk cylinders. It also checks the grown box's size and volume, a shaft becoming its hole (radius and length), a sphere (within 0.02 mm), the zero distance and invalid input.

## Fill Hollow

A *Fill Hollow* card in the inspector (collapsed by default) adds a new solid that fills the selected shape's hollow part: a lid, plug or insert that fits into it. It is made smaller by a **Clearance** (0–2 mm, default 0.1 mm) so it fits after printing. The new shape (amber, named "<shape> fill") is placed exactly in the hollow and selected; the original shape is left as it is.

- What counts as the hollow: the empty space between the shape and its convex hull (its shrink-wrapped outline). That covers the inside of open boxes and cups, through-openings of extruded profiles, and enclosed voids. When there are several separate empty regions (a handle, a notch on the outside), the largest is used and the message says so. A shape with no hollow (such as a sphere) gets a message instead.
- To make a thin lid rather than a full plug, resize or cut the fill afterwards; to make it fit tighter or looser, change the clearance or use *Grow / Shrink* on it.
- Implementation:
  - `apps/web/src/lib/cavityFill.ts` (`cavityFillPositions(runtime, worldTriangleSoup, clearance)`), with Manifold:
    1. builds the solid;
    2. takes its hull, subtracts the solid, and splits the result into separate regions (`decompose`);
    3. ignores regions under 0.01% of the hull volume as tessellation noise, and keeps the largest;
    4. shrinks it by the clearance with the *Grow / Shrink* offset (`offsetTriangleSoup`).
  - The editor action is `fillSelectedHollow` in `SketchForgeEditor.tsx`. It is passed to the inspector through `WorkplaneViewport`'s `onFillHollow` prop, and the new shape is created with `meshShapeFromWorldPositions`.
- T-junction repair: meshes such as hollow boxes (built with three-bvh-csg) have vertices lying in the middle of neighbouring triangles' edges. They are closed but not edge-manifold, so Manifold rejects them. `apps/web/src/lib/meshRepair.ts` (`repairTJunctions`) splits those edges at the vertices on them, using a spatial grid, and re-triangulates each affected triangle as a fan around its centroid. Fill Hollow uses it when Manifold rejects a mesh as it is.
- Tests: `tests/unit/cavityFill.test.ts` covers:
  - an open box filled exactly, and with clearance (position and size);
  - an arched hollow profile like the reference picture, where the fill volume equals the opening's area × length;
  - a notched box, where the largest region wins;
  - no hollow, and too large a clearance;
  - the editor's own hollow box geometry, which needs the repair;
  - the T-junction repair itself, which makes a split cube edge-manifold with its volume kept.

## Faster moves in busy scenes

Moving a shape (dragging it, or nudging it with the arrow keys) in a project with many shapes and holes was slow: with 16 boxes each cut by a cylinder hole, every pointer move during a drag took about 250 ms of main-thread time, and each arrow-key step about 220 ms. Two causes, both in `apps/web/src/components/WorkplaneViewport.tsx`:

1. **The cut previews were recomputed from scratch on every move.** The translucent dark overlays that show where a hole cuts a solid are real CSG intersections (three-bvh-csg). On every pointer move, every arrow key and every other shape change, all overlays were thrown away and the intersection of *every* hole with *every* solid it touches was computed again, even when neither of them had moved.
2. **Overlay materials were recreated and disposed every move.** The cut-preview overlays, the move-dimension lines and arrows (the "moved by X / Y" readout drawn in the scene) and the dashed transform guides each got a fresh `LineMaterial` / `MeshBasicMaterial` per rebuild, and the previous one was disposed. Disposing a material releases its shader program in three.js, so the next frame compiled and linked the same shader again (and `getProgramInfoLog` stalls the GPU pipeline). In a CPU profile this was more time than the CSG itself.

What changed:

- **Cut previews are cached per hole/solid pair** (`ThreeState.cutPreviewPairs`). Each entry is keyed by both objects' geometry and child-matrix signature (the existing `cutPreviewObjectSignature`), their world matrices, and the hole's size (its brush is padded by its own size). `syncCutPreviewOverlays` now only runs CSG for pairs whose key changed, re-attaches cached overlays for unchanged pairs and drops pairs that no longer intersect. Dragging one shape therefore only recomputes the previews that shape takes part in. `rebuildShapes` and the start of a scale/rotate transform *detach* the overlays (`detachCutPreviewOverlays`) instead of clearing them, so the cache survives; it is only emptied (`clearCutPreviewOverlays`) when the shape layer is rebuilt for the official modifier rendering. All overlays share one `cutPreviewMaterial`.
- **Overlay materials are shared**: `sharedOverlayLineMaterial` (fat lines, keyed by colour, width, opacity and dash settings; the resolution uniform is refreshed on each use) and `sharedOverlayFillMaterial` (the arrow heads). They are marked `userData.cached`, which the existing `disposeMaterialResource` already respects, so the per-move `disposeChildren` of those layers only frees geometry.
- `syncShapeObjectDimensions`, which runs for every visible shape on every shape change, now returns early when the object's scale and vertical placement already match, instead of rewriting and re-propagating the matrices of every shape.

Measured with headless Chrome (SwiftShader, so absolute numbers are pessimistic) on a 4×4 grid of boxes each cut by a hole, dragging one box for 40 pointer moves: time inside the drag handler fell from 3.8 s to 60 ms in total, shader compilation during the drag from 6.0 s to 0.18 s (one-off first use of the shared materials), and the main thread was idle for 82% of the drag afterwards. With 64 boxes and 64 holes, each arrow-key step fell from about 420 ms to under the frame time. The behaviour is unchanged: the same overlays appear in the same places, including while dragging.

Files: `apps/web/src/components/WorkplaneViewport.tsx` only.

## Larger fillet and chamfer sizes

The **Radius** (fillet) / **Distance** (chamfer) slider in the edge tool was capped at 99% of the selected shape's *smallest* dimension. On a thin plate that made it impossible to round the vertical edges with a radius wider than the plate's thickness, even though those edges only need to fit the plate's width and depth. The cap is now 99% of the *largest* dimension.

- The CAD kernel still validates the result: a size that does not fit the chosen edges is refused with the existing message "The chosen size creates invalid or overlapping edge geometry", and nothing is applied.
- Changed: `edgeModifierMaxAmount` in `apps/web/src/components/SketchForgeEditor.tsx`. The typed value and the MCP `amount` go through the same clamp.

## Cutting large imported meshes

Grouping an imported mesh with a hole ("cut") failed with "Could not cut this imported mesh cleanly" for any mesh over 150,000 triangles, before any boolean was attempted, and the same message was shown when the mesh was simply not watertight. Three changes in `apps/web/src/components/SketchForgeEditor.tsx`:

- **A separate, higher triangle cap for Manifold.** Upstream's `IMPORTED_EXACT_BOOLEAN_TRIANGLE_LIMIT` (150,000) applied to both the Manifold cut and the three-bvh-csg fallback. The fallback is slow and memory-hungry, so that cap stays for it; the Manifold cut, union and intersection paths now use `MANIFOLD_BOOLEAN_TRIANGLE_LIMIT` (2,000,000). Verified in headless Chrome: a 358,800-triangle closed sphere cut by a box hole groups in about 2.3 s (314,130 triangles out).
- **T-junction repair retry.** `shapeToManifoldSolid` goes through `manifoldSolidFromMeshData`, which rebuilds the mesh with `repairTJunctions` (`lib/meshRepair.ts`, the same repair Fill Hollow uses) when Manifold reports the first attempt as non-manifold, then gives up only if that fails too.
- **The notice says why.** `manifoldBooleanMeshShape` takes an optional `diagnostics` object and records `"tooLarge"` or `"notClosed"`; `buildGroupedShapeFromSelection` turns that into "Could not cut this imported mesh: N triangles is over the 2,000,000 limit. Simplify it before importing" or "Could not cut this imported mesh: it is not a closed (watertight) solid. Repair it in a mesh tool and import it again". The generic message remains for other failures. `GroupBuildResult` carries the reason as `manifoldFailure`.

Notes: an open mesh under 150,000 triangles still gets the three-bvh-csg hollow-subtraction fallback, which can bite a hole into a non-watertight surface; above that it needs to be closed. The boolean runs on the main thread, so very large meshes freeze the UI for a few seconds while cutting.

## Cutting without freezing the editor

Cutting a large imported mesh (grouping it with a hole) ran Manifold on the main thread, so the editor froze for the whole boolean with no feedback. The Manifold call is a single WebAssembly function and cannot yield, so the boolean now runs in a Web Worker while the editor shows a progress dialog that updates every 500 ms with an ETA and a Cancel button.

User-facing behaviour:

- For cuts of at least 20,000 triangles, a "Cutting imported mesh" dialog appears right away (before the mesh is even prepared) with the current stage (preparing the mesh / solid / hole, cutting, reading the result, building the shape), the triangle count, a progress bar, "About N s left" and the elapsed time. Below 20,000 triangles the cut runs on the main thread as before; those take a few tens of milliseconds and the worker round trip would cost more than it saves.
- **Cancel** stops the cut: the worker is terminated (a WASM call cannot be interrupted any other way), the scene is left unchanged and the notice says "Cut cancelled". The worker is recreated on the next cut.
- The ETA is a model, not a measurement: Manifold reports no progress. It starts from a default rate of 3 µs per input triangle plus 250 ms overhead and is refined after every cut (exponential moving average, half weight on the latest run, stored in `localStorage` as `sketchForge.booleanRateNsPerTriangle`). Once the estimate is passed the dialog says "Finishing up…".

Implementation:

- `apps/web/src/lib/manifoldOperands.ts`: boolean operands as plain data that survive `postMessage`: analytic primitives with their 4×4 matrix (`cube`, `sphere`, `cylinder`, exactly the primitives the main-thread path built), axis-aligned box `bounds`, or a triangle soup `mesh`. `buildManifoldOperand` turns one into a Manifold solid; `manifoldSolidFromPositions` retries a soup after `repairTJunctions` when Manifold rejects it. The editor's `shapeToManifoldSolid` now goes through the same description (`primitiveOperandForShape` / `manifoldOperandForShape` in `SketchForgeEditor.tsx`), so the worker and the main thread build identical operands.
- `apps/web/src/workers/manifoldBoolean.worker.ts`: loads `manifold.js` / `manifold.wasm` from the page's asset base (passed in the request), unions the solids and the cutters, subtracts, posts `progress` stages and the result positions as a transferable `Float32Array`. `apps/web/src/lib/manifoldBooleanTypes.ts` holds the message types.
- `apps/web/src/lib/manifoldBooleanRuntime.ts`: persistent worker client (`subtractInManifoldWorker`, with an `AbortSignal` that terminates the worker, a 10 minute timeout, and `canUseManifoldBooleanWorker`, which is false for `file:` builds where the worker cannot import the kernel), plus the ETA model (`estimateManifoldBooleanMs`, `updateManifoldBooleanRate`, `load`/`saveManifoldBooleanRate`) and the stage labels.
- `apps/web/src/lib/booleanProgress.ts`: a small external store (`setBooleanProgress`, `updateBooleanProgressDetail`, `subscribeBooleanProgress`) read by the editor with `useSyncExternalStore`, and `formatBooleanProgress` for the dialog text. `BooleanProgressDialog` in `SketchForgeEditor.tsx` ticks every 500 ms; styles are the `.boolean-progress-*` rules in `globals.css`.
- `SketchForgeEditor.tsx`: `manifoldBooleanMeshShape` shows the dialog, yields one frame so it paints, then runs the synchronous preparation and `manifoldSubtractPositions`, which picks the worker or the main-thread path. The group result gains `manifoldFailure: "cancelled"`.
- Union and intersection of imported meshes still run on the main thread (they were not the reported problem); they can be moved to the same worker later.
- Tests: `tests/unit/booleanProgress.test.ts` covers the store, the dialog text and the ETA model. Behaviour was checked in headless Chrome with a 358,800-triangle sphere: the dialog appears within a few milliseconds, the ETA reads "About 2 s left" for a cut that finishes in about 2.4 s in total, frames keep rendering during the cut, Cancel returns "Cut cancelled" with the scene unchanged, and a non-watertight mesh still gets the "not a closed (watertight) solid" notice through the worker.

Remaining main-thread work: building the merged mesh data, the triangle-inside-hole validation passes and converting the result into a shape still run synchronously around the worker call, so a very large mesh still has short pauses (a few hundred milliseconds) before and after the cut itself.
