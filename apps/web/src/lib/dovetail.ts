import * as THREE from "three";
import type { WorkplaneShape } from "@/types/sketchforge";

/**
 * Dovetail joint component (fork feature, see FORK.md). The profile lies in the X/Y plane
 * (X across the joint, Y up) and is extruded along Z, the direction the parts slide.
 *
 * - Male: a base plate `width` × `base` with a tail on top. The tail is `tailWidth` wide at
 *   its top, narrows by `angle` on both flanks, and is `tailDepth` tall. Base 0 gives the
 *   tail alone, to group onto another part.
 * - Female: a block `width` × (`base` + `tailDepth`) with the matching slot cut from its top,
 *   narrow at the opening and wide at the bottom. `clearance` grows the slot on every face
 *   so a printed male slides in; the male is never changed by it.
 *
 * Flip the male upside down over the female and slide it in along the length.
 */
export type DovetailSide = "male" | "female";

export type DovetailParams = {
  side: DovetailSide;
  length: number;
  width: number;
  base: number;
  tailWidth: number;
  tailDepth: number;
  /** Flank angle from vertical, in degrees. */
  angle: number;
  clearance: number;
};

export const DEFAULT_DOVETAIL_PARAMS: DovetailParams = {
  side: "male",
  length: 30,
  width: 30,
  base: 5,
  tailWidth: 14,
  tailDepth: 6,
  angle: 15,
  clearance: 0.2,
};

export const DOVETAIL_LIMITS = {
  length: [1, 400],
  width: [1, 400],
  base: [0, 100],
  tailWidth: [1, 400],
  tailDepth: [0.5, 100],
  angle: [0, 40],
  clearance: [0, 2],
} as const;

const MIN_NECK = 0.5;
const MIN_WALL = 0.8;
const MIN_FLOOR = 0.4;

function finiteOr(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function normalizeDovetailParams(input: Partial<DovetailParams> | null | undefined): DovetailParams {
  const source = input ?? {};
  const clampKey = (key: keyof typeof DOVETAIL_LIMITS) => {
    const [min, max] = DOVETAIL_LIMITS[key];
    return Math.min(max, Math.max(min, finiteOr(source[key], DEFAULT_DOVETAIL_PARAMS[key])));
  };
  return {
    side: source.side === "female" ? "female" : "male",
    length: clampKey("length"),
    width: clampKey("width"),
    base: clampKey("base"),
    tailWidth: clampKey("tailWidth"),
    tailDepth: clampKey("tailDepth"),
    angle: clampKey("angle"),
    clearance: clampKey("clearance"),
  };
}

function derived(params: DovetailParams) {
  const slope = Math.tan((params.angle * Math.PI) / 180);
  const neck = params.tailWidth - 2 * params.tailDepth * slope;
  const c = params.side === "female" ? params.clearance : 0;
  const flankShift = c / Math.cos((params.angle * Math.PI) / 180);
  return {
    slope,
    neck,
    /** Slot widths, clearance included: at the opening (top) and at the bottom. */
    slotOpening: neck + 2 * flankShift,
    slotBottom: params.tailWidth + 2 * (flankShift + c * slope),
    slotDepth: params.tailDepth + c,
  };
}

/** Problems that make the part unusable; the geometry is still built from safe values. */
export function validateDovetailParams(input: DovetailParams): string[] {
  const params = normalizeDovetailParams(input);
  const d = derived(params);
  const errors: string[] = [];
  if (d.neck < MIN_NECK) errors.push("The tail is too narrow at the neck. Reduce the angle or tail depth, or widen the tail.");
  if (params.side === "male" && params.base > 0 && params.width < params.tailWidth) {
    errors.push("Width must be at least the tail width.");
  }
  if (params.side === "female") {
    if ((params.width - d.slotBottom) / 2 < MIN_WALL) {
      errors.push(`Width must be at least ${(d.slotBottom + 2 * MIN_WALL).toFixed(1)} mm to keep ${MIN_WALL} mm walls beside the slot.`);
    }
    if (params.base - params.clearance < MIN_FLOOR) {
      errors.push(`Floor must be at least ${(params.clearance + MIN_FLOOR).toFixed(1)} mm thick under the slot.`);
    }
  }
  return errors;
}

/** Closed cross-section, counter-clockwise, centred on X with the bottom at y = 0. */
export function dovetailProfile(input: DovetailParams): Array<[number, number]> {
  const params = normalizeDovetailParams(input);
  const d = derived(params);
  const h = params.tailDepth;
  const halfNeck = Math.max(MIN_NECK, d.neck) / 2;
  const halfTail = Math.max(halfNeck, params.tailWidth / 2);
  if (params.side === "male") {
    const t = params.base;
    if (t <= 0) {
      return [[-halfNeck, 0], [halfNeck, 0], [halfTail, h], [-halfTail, h]];
    }
    const halfBase = Math.max(params.width, params.tailWidth) / 2;
    return [[-halfBase, 0], [halfBase, 0], [halfBase, t], [halfNeck, t], [halfTail, t + h], [-halfTail, t + h], [-halfNeck, t], [-halfBase, t]];
  }
  const top = params.base + h;
  const slotDepth = Math.min(d.slotDepth, top - MIN_FLOOR);
  const halfOpening = Math.max(MIN_NECK, d.slotOpening) / 2;
  const halfBottom = Math.max(halfOpening, d.slotBottom / 2);
  const halfBlock = Math.max(params.width / 2, halfBottom + MIN_WALL);
  return [
    [-halfBlock, 0], [halfBlock, 0], [halfBlock, top], [halfOpening, top],
    [halfBottom, top - slotDepth], [-halfBottom, top - slotDepth], [-halfOpening, top], [-halfBlock, top],
  ];
}

/** Triangle soup (x, y, z per vertex) for the extruded part: X/Z centred, base at y = 0. */
export function dovetailPositions(input: DovetailParams): number[] {
  const params = normalizeDovetailParams(input);
  const shape = new THREE.Shape(dovetailProfile(params).map(([x, y]) => new THREE.Vector2(x, y)));
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: params.length, bevelEnabled: false, steps: 1 });
  geometry.translate(0, 0, -params.length / 2);
  const source = geometry.index ? geometry.toNonIndexed() : geometry;
  const positions = Array.from(source.getAttribute("position").array as ArrayLike<number>);
  if (source !== geometry) source.dispose();
  geometry.dispose();
  return positions;
}

/** Shape fields that follow from the parameters: the mesh and the matching size. */
export function dovetailShapePatch(input: DovetailParams): Pick<WorkplaneShape, "dovetail" | "importedMesh" | "width" | "depth" | "height" | "size"> {
  const params = normalizeDovetailParams(input);
  const positions = dovetailPositions(params);
  let maxX = 0;
  let maxY = 0;
  for (let i = 0; i < positions.length; i += 3) {
    maxX = Math.max(maxX, Math.abs(positions[i]));
    maxY = Math.max(maxY, positions[i + 1]);
  }
  const width = maxX * 2;
  const depth = params.length;
  return {
    dovetail: params,
    width,
    depth,
    height: maxY,
    size: Math.max(width, depth),
    importedMesh: {
      positions,
      baseWidth: width,
      baseDepth: depth,
      baseHeight: maxY,
      triangleCount: positions.length / 9,
      sourceFormat: "json",
    },
  };
}
