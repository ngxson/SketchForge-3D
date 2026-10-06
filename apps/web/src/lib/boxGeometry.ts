import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { Brush, Evaluator, SUBTRACTION } from "three-bvh-csg";
import type { WorkplaneShape } from "@/types/sketchforge";

/**
 * Box options (fork feature, see FORK.md):
 * - `radius` > 0 rounds the edges; `corners` picks whether all 12 edges are rounded
 *   ("all", upstream behaviour) or only the 4 vertical ones ("vertical", a rounded
 *   rectangle extruded along the height).
 * - `wall` > 0 makes the box hollow with an open top; `floor` is the bottom thickness
 *   (defaults to the wall thickness).
 */
export type BoxCornerStyle = "all" | "vertical";

export type BoxGeometryOptions = {
  width: number;
  depth: number;
  height: number;
  radius?: number;
  corners?: BoxCornerStyle;
  wall?: number;
  floor?: number;
  steps?: number;
};

export const MIN_BOX_WALL = 0.2;

/** True when the box is a plain cuboid that the viewport can draw from a shared unit cube. */
export function boxIsPlain(shape: Pick<WorkplaneShape, "kind" | "radius" | "boxWall">) {
  return shape.kind === "box" && !(shape.radius && shape.radius > 0) && !(shape.boxWall && shape.boxWall > 0);
}

export function boxCornerStyle(shape: Pick<WorkplaneShape, "boxCorners">): BoxCornerStyle {
  return shape.boxCorners === "vertical" ? "vertical" : "all";
}

/** Largest wall thickness that still leaves a cavity. */
export function maxBoxWall(width: number, depth: number) {
  return Math.max(0, Math.min(width, depth) / 2 - MIN_BOX_WALL);
}

export function maxBoxFloor(height: number) {
  return Math.max(0, height - MIN_BOX_WALL);
}

export function boxGeometryOptionsFromShape(shape: WorkplaneShape, width: number, depth: number, height: number): BoxGeometryOptions {
  return {
    width,
    depth,
    height,
    radius: shape.radius,
    corners: boxCornerStyle(shape),
    wall: shape.boxWall,
    floor: shape.boxFloor,
    steps: shape.steps,
  };
}

function roundedRectangleShape(width: number, depth: number, radius: number) {
  const w = width / 2;
  const d = depth / 2;
  const r = Math.min(radius, w, d);
  const shape = new THREE.Shape();
  shape.moveTo(-w + r, -d);
  shape.lineTo(w - r, -d);
  shape.absarc(w - r, -d + r, r, -Math.PI / 2, 0, false);
  shape.lineTo(w, d - r);
  shape.absarc(w - r, d - r, r, 0, Math.PI / 2, false);
  shape.lineTo(-w + r, d);
  shape.absarc(-w + r, d - r, r, Math.PI / 2, Math.PI, false);
  shape.lineTo(-w, -d + r);
  shape.absarc(-w + r, -d + r, r, Math.PI, Math.PI * 1.5, false);
  shape.closePath();
  return shape;
}

/** A solid box centred on the origin with the requested corner treatment. */
function solidBoxGeometry(width: number, depth: number, height: number, radius: number, corners: BoxCornerStyle, steps: number) {
  const r = Math.min(radius, width / 2, depth / 2, corners === "all" ? height / 2 : Number.POSITIVE_INFINITY);
  if (!(r > 0)) {
    return new THREE.BoxGeometry(width, height, depth);
  }
  if (corners === "vertical") {
    const geometry = new THREE.ExtrudeGeometry(roundedRectangleShape(width, depth, r), {
      depth: height,
      bevelEnabled: false,
      steps: 1,
      curveSegments: Math.max(2, Math.round(steps)),
    });
    // ExtrudeGeometry extrudes along +Z; turn that into +Y and centre vertically.
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, -height / 2, 0);
    return geometry;
  }
  return new RoundedBoxGeometry(width, height, depth, Math.max(1, Math.round(steps)), r);
}

const hollowEvaluator = new Evaluator();
hollowEvaluator.useGroups = false;
hollowEvaluator.attributes = ["position", "normal"];

/**
 * Builds the box geometry centred on the origin (y from -height/2 to +height/2).
 * Callers put it on the base themselves, as with every other primitive.
 */
export function createBoxGeometry(options: BoxGeometryOptions): THREE.BufferGeometry {
  const width = Math.max(0.001, options.width);
  const depth = Math.max(0.001, options.depth);
  const height = Math.max(0.001, options.height);
  const radius = Math.max(0, options.radius ?? 0);
  const corners = options.corners ?? "all";
  const steps = options.steps ?? 10;
  const outer = solidBoxGeometry(width, depth, height, radius, corners, steps);

  const wall = Math.min(Math.max(0, options.wall ?? 0), maxBoxWall(width, depth));
  if (!(wall >= MIN_BOX_WALL)) {
    return outer;
  }
  const floor = Math.min(Math.max(0, options.floor ?? wall), maxBoxFloor(height));
  const innerWidth = width - 2 * wall;
  const innerDepth = depth - 2 * wall;
  const cavityHeight = height - floor + 1; // 1 mm above the top so the cut is clean
  const inner = solidBoxGeometry(innerWidth, innerDepth, cavityHeight, Math.max(0, radius - wall), corners, steps);
  inner.translate(0, floor - height / 2 + cavityHeight / 2, 0);

  const outerBrush = new Brush(outer);
  const innerBrush = new Brush(inner);
  outerBrush.updateMatrixWorld(true);
  innerBrush.updateMatrixWorld(true);
  const result = hollowEvaluator.evaluate(outerBrush, innerBrush, SUBTRACTION);
  outer.dispose();
  inner.dispose();
  const geometry = result.geometry;
  if (!geometry.getAttribute("position") || geometry.getAttribute("position").count < 3) {
    geometry.dispose();
    return solidBoxGeometry(width, depth, height, radius, corners, steps);
  }
  return geometry;
}
