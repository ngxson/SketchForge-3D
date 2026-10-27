import * as THREE from "three";
import { strFromU8, unzipSync } from "fflate";
import { importedShapeFromTriangles } from "@/lib/objImport";
import { zUpToSketchForge } from "@/lib/meshCoordinates";
import type { WorkplaneShape } from "@/types/sketchforge";

/**
 * 3MF import (fork feature, see FORK.md). A 3MF file is a zip holding XML model parts. This
 * reads the root model named by `_rels/.rels` (or `3D/3dmodel.model`), its mesh objects and
 * component objects (including components in other model parts via the production extension's
 * `p:path`, as Bambu Studio and PrusaSlicer write them), every build item with its transform,
 * and the model unit. All build items are merged into one mesh shape, like an STL import.
 * Support objects are skipped. The first build item's base-material colour becomes the shape
 * colour when there is one.
 */

const UNIT_TO_MM: Record<string, number> = {
  micron: 0.001,
  millimeter: 1,
  centimeter: 10,
  inch: 25.4,
  foot: 304.8,
  meter: 1000,
};

const MAX_COMPONENT_DEPTH = 32;

type Attributes = Record<string, string>;

type MeshObject = { kind: "mesh"; vertices: Float64Array; triangles: Uint32Array; pid?: string; pindex?: string };
type ComponentObject = { kind: "components"; components: Array<{ objectId: string; path?: string; transform: THREE.Matrix4 }>; pid?: string; pindex?: string };
type ModelObject = MeshObject | ComponentObject;

type ModelPart = {
  unitScale: number;
  objects: Map<string, ModelObject>;
  build: Array<{ objectId: string; path?: string; transform: THREE.Matrix4 }>;
  colors: Map<string, string[]>;
};

const ATTRIBUTE = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function attributes(source: string): Attributes {
  const result: Attributes = {};
  for (const match of source.matchAll(ATTRIBUTE)) {
    // Drop namespace prefixes except the production extension's path ("p:path" → "path").
    const name = match[1].includes(":") ? match[1].split(":").pop()! : match[1];
    result[name] = match[2] ?? match[3] ?? "";
  }
  return result;
}

/** Elements by local name, ignoring any namespace prefix. */
function elements(source: string, name: string) {
  return source.matchAll(new RegExp(`<(?:[\\w-]+:)?${name}\\b([^>]*?)\\/?>`, "g"));
}

function blocks(source: string, name: string) {
  return source.matchAll(new RegExp(`<(?:[\\w-]+:)?${name}\\b([^>]*)>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${name}>`, "g"));
}

/** 3MF transforms are 4×3 row-vector matrices: "m00 m01 m02 m10 m11 m12 m20 m21 m22 m30 m31 m32". */
function parseTransform(value: string | undefined) {
  const matrix = new THREE.Matrix4();
  if (!value) return matrix;
  const m = value.trim().split(/\s+/).map(Number);
  if (m.length !== 12 || m.some((n) => !Number.isFinite(n))) throw new Error("3MF has an invalid transform");
  matrix.set(m[0], m[3], m[6], m[9], m[1], m[4], m[7], m[10], m[2], m[5], m[8], m[11], 0, 0, 0, 1);
  return matrix;
}

function normalizePath(path: string) {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

function parseModelPart(xml: string): ModelPart {
  const modelTag = xml.match(/<(?:[\w-]+:)?model\b([^>]*)>/);
  if (!modelTag) throw new Error("3MF model part has no <model> element");
  const unit = attributes(modelTag[1]).unit ?? "millimeter";
  const unitScale = UNIT_TO_MM[unit];
  if (!unitScale) throw new Error(`3MF uses an unknown unit '${unit}'`);

  const colors = new Map<string, string[]>();
  for (const [, attrs, body] of blocks(xml, "basematerials")) {
    const id = attributes(attrs).id;
    if (!id) continue;
    colors.set(id, [...elements(body, "base")].map(([, baseAttrs]) => attributes(baseAttrs).displaycolor ?? ""));
  }

  const objects = new Map<string, ModelObject>();
  for (const [, objectAttrs, body] of blocks(xml, "object")) {
    const info = attributes(objectAttrs);
    if (!info.id) continue;
    if (info.type === "support" || info.type === "other") continue;
    const meshBlock = body.match(/<(?:[\w-]+:)?mesh\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?mesh>/);
    if (meshBlock) {
      const vertexList: number[] = [];
      for (const [, vertexAttrs] of elements(meshBlock[1], "vertex")) {
        const v = attributes(vertexAttrs);
        const x = Number(v.x);
        const y = Number(v.y);
        const z = Number(v.z);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) throw new Error("3MF has an invalid vertex");
        vertexList.push(x, y, z);
      }
      const vertexCount = vertexList.length / 3;
      const triangleList: number[] = [];
      for (const [, triangleAttrs] of elements(meshBlock[1], "triangle")) {
        const t = attributes(triangleAttrs);
        const indices = [Number(t.v1), Number(t.v2), Number(t.v3)];
        if (indices.some((index) => !Number.isInteger(index) || index < 0 || index >= vertexCount)) {
          throw new Error("3MF has a triangle with an out-of-range vertex");
        }
        triangleList.push(...indices);
      }
      objects.set(info.id, { kind: "mesh", vertices: Float64Array.from(vertexList), triangles: Uint32Array.from(triangleList), pid: info.pid, pindex: info.pindex });
      continue;
    }
    const components = [...elements(body, "component")].map(([, componentAttrs]) => {
      const c = attributes(componentAttrs);
      return { objectId: c.objectid, path: c.path ? normalizePath(c.path) : undefined, transform: parseTransform(c.transform) };
    }).filter((component) => component.objectId);
    if (components.length) objects.set(info.id, { kind: "components", components, pid: info.pid, pindex: info.pindex });
  }

  const build: ModelPart["build"] = [];
  const buildBlock = xml.match(/<(?:[\w-]+:)?build\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?build>/);
  if (buildBlock) {
    for (const [, itemAttrs] of elements(buildBlock[1], "item")) {
      const item = attributes(itemAttrs);
      if (!item.objectid) continue;
      build.push({ objectId: item.objectid, path: item.path ? normalizePath(item.path) : undefined, transform: parseTransform(item.transform) });
    }
  }

  return { unitScale, objects, build, colors };
}

function rootModelPath(files: Record<string, Uint8Array>) {
  const rels = files["_rels/.rels"];
  if (rels) {
    for (const [, relAttrs] of elements(strFromU8(rels), "Relationship")) {
      const rel = attributes(relAttrs);
      if (rel.Type?.endsWith("/3dmodel") && rel.Target) return normalizePath(rel.Target);
    }
  }
  if (files["3D/3dmodel.model"]) return "3D/3dmodel.model";
  const anyModel = Object.keys(files).find((path) => path.toLowerCase().endsWith(".model"));
  if (anyModel) return anyModel;
  throw new Error("3MF has no 3D model part");
}

function colorFor(part: ModelPart, object: ModelObject | undefined) {
  if (!object?.pid) return undefined;
  const palette = part.colors.get(object.pid);
  const color = palette?.[Number(object.pindex ?? 0)];
  const match = color?.match(/^#([0-9a-f]{6})/i);
  return match ? `#${match[1].toLowerCase()}` : undefined;
}

export function importedShapeFrom3mf(fileName: string, bytes: Uint8Array): WorkplaneShape {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error("3MF is not a readable zip archive");
  }
  const rootPath = rootModelPath(files);
  const parts = new Map<string, ModelPart>();
  const partAt = (path: string) => {
    const cached = parts.get(path);
    if (cached) return cached;
    const data = files[path];
    if (!data) throw new Error(`3MF refers to a missing model part '${path}'`);
    const part = parseModelPart(strFromU8(data));
    parts.set(path, part);
    return part;
  };
  const root = partAt(rootPath);

  const rawPositions: number[] = [];
  const point = new THREE.Vector3();
  const addObject = (path: string, objectId: string, transform: THREE.Matrix4, depth: number) => {
    if (depth > MAX_COMPONENT_DEPTH) throw new Error("3MF components are nested too deeply");
    const object = partAt(path).objects.get(objectId);
    if (!object) return;
    if (object.kind === "components") {
      for (const component of object.components) {
        addObject(component.path ?? path, component.objectId, transform.clone().multiply(component.transform), depth + 1);
      }
      return;
    }
    // The model unit converts to millimetres; a mirroring transform flips the winding so faces
    // still point outward.
    const world = new THREE.Matrix4().makeScale(root.unitScale, root.unitScale, root.unitScale).multiply(transform);
    const order = world.determinant() < 0 ? [0, 2, 1] : [0, 1, 2];
    for (let t = 0; t < object.triangles.length; t += 3) {
      for (const corner of order) {
        const index = object.triangles[t + corner] * 3;
        point.set(object.vertices[index], object.vertices[index + 1], object.vertices[index + 2]).applyMatrix4(world);
        rawPositions.push(...zUpToSketchForge([point.x, point.y, point.z]));
      }
    }
  };

  // The root model's unit applies to the whole build (parts written by slicers share it).
  for (const item of root.build) {
    addObject(item.path ?? rootPath, item.objectId, item.transform, 0);
  }
  if (!rawPositions.length) {
    const sliced = Object.keys(files).some((path) => /\.gcode$/i.test(path));
    throw new Error(sliced
      ? "This 3MF is a sliced print file (G-code only, no model); export the project or model 3MF instead"
      : "3MF has no printable mesh geometry");
  }

  const shape = importedShapeFromTriangles(fileName, rawPositions, undefined, "3mf");
  const first = root.build[0];
  const color = first ? colorFor(partAt(first.path ?? rootPath), partAt(first.path ?? rootPath).objects.get(first.objectId)) : undefined;
  return color ? { ...shape, color } : shape;
}
