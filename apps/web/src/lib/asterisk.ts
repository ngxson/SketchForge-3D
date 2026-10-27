import * as THREE from "three";
import type { WorkplaneShape } from "@/types/sketchforge";

/**
 * Asterisk shape (fork feature, see FORK.md): `arms` straight arms of width `thickness`
 * radiating from the centre, with flat (square) ends, extruded to `height`. `diameter` is
 * measured tip to tip across the end faces of opposite arms (for an odd arm count, twice the
 * centre-to-end distance). `visibleArms` keeps the spacing of `arms` but draws only the first N
 * of them (a fan); the rest are blank. The outline is exact: two corners at each arm's end, an
 * inner corner where neighbouring arms meet, and, across a blank sector of 180° or more, a
 * rounded back of the arm's width around the centre.
 */
export type AsteriskParams = {
  diameter: number;
  arms: number;
  thickness: number;
  height: number;
  /** How many of the arms to draw (1…arms); undefined draws all. */
  visibleArms?: number;
  /**
   * Edge rounding (undefined = sharp): "all" rounds the arm-end and inside corners (in plan) and
   * the edges around the top and bottom faces; "topBottom" only the latter; "arms" ("Outward
   * faces") rounds the four long edges along every arm, so each arm is a rod with a
   * rounded-rectangle cross-section (round when thickness = height and the radius is half of
   * it) while the arm ends stay flat at full length. Used as a hole through a tube wall, it cuts
   * rounded holes.
   */
  rounding?: AsteriskRounding;
  /** Radius of the rounding in mm (default 1), limited by the arm thickness and the height. */
  roundingRadius?: number;
};

export type AsteriskRounding = "all" | "topBottom" | "arms";
export const ASTERISK_ROUNDINGS: AsteriskRounding[] = ["all", "topBottom", "arms"];
export const DEFAULT_ASTERISK_ROUNDING_RADIUS = 1;

export const DEFAULT_ASTERISK_PARAMS: AsteriskParams = { diameter: 30, arms: 6, thickness: 6, height: 5 };

export const ASTERISK_LIMITS = {
  diameter: [2, 400],
  arms: [2, 80],
  thickness: [0.4, 200],
  height: [0.2, 400],
  roundingRadius: [0.05, 50],
} as const;

/** Arc segments per quarter turn for rounded corners and edges. */
const ROUND_SEGMENTS = 6;

/** Segments of the rounded back across a wide blank sector, per full turn. */
const HUB_SEGMENTS = 48;

function clampKey(source: Partial<AsteriskParams>, key: keyof typeof ASTERISK_LIMITS) {
  const [min, max] = ASTERISK_LIMITS[key];
  const raw = source[key];
  const fallback = key === "roundingRadius" ? DEFAULT_ASTERISK_ROUNDING_RADIUS : DEFAULT_ASTERISK_PARAMS[key];
  const value = typeof raw === "number" && Number.isFinite(raw) ? raw : fallback;
  return Math.min(max, Math.max(min, value));
}

/** Widest arm that still leaves each arm's end beyond the point where it meets its neighbours. */
export function maxAsteriskThickness(diameter: number, arms: number) {
  const half = Math.PI / Math.max(2, Math.round(arms));
  // Inner corners sit (t/2)/tan(half) along each arm; keep them 10% short of the end.
  return arms <= 2 ? diameter : 2 * 0.9 * (diameter / 2) * Math.tan(half);
}

export function normalizeAsteriskParams(input: Partial<AsteriskParams> | null | undefined): AsteriskParams {
  const source = input ?? {};
  const diameter = clampKey(source, "diameter");
  const arms = Math.round(clampKey(source, "arms"));
  const thickness = Math.min(clampKey(source, "thickness"), maxAsteriskThickness(diameter, arms));
  const params: AsteriskParams = { diameter, arms, thickness, height: clampKey(source, "height") };
  const visible = source.visibleArms;
  if (typeof visible === "number" && Number.isFinite(visible) && Math.round(visible) < arms) {
    params.visibleArms = Math.max(1, Math.round(visible));
  }
  if (source.rounding && ASTERISK_ROUNDINGS.includes(source.rounding)) {
    params.rounding = source.rounding;
    params.roundingRadius = clampKey(source, "roundingRadius");
  }
  return params;
}

type CornerKind = "end" | "inside" | "smooth";
type Point2 = [number, number];

/** Sharp outline with each point tagged: arm-end corner, inside corner, or smooth (hub arc). */
function taggedOutline(input: AsteriskParams, thicknessOverride?: number): { points: Point2[]; kinds: CornerKind[] } {
  const { diameter, arms, thickness: baseThickness, visibleArms } = normalizeAsteriskParams(input);
  const thickness = thicknessOverride ?? baseThickness;
  const radius = diameter / 2;
  const halfWidth = thickness / 2;
  const step = (Math.PI * 2) / arms;
  const shown = visibleArms ?? arms;
  // The first arm points to −Z: straight up on screen in the top view, like a typed asterisk.
  const angleOf = (i: number) => -Math.PI / 2 + i * step;
  if (arms === 2 && shown === 2) {
    // A plain bar: the two arms are one rectangle.
    const [ux, uz] = [Math.cos(angleOf(0)), Math.sin(angleOf(0))];
    const [px, pz] = [-uz, ux];
    return {
      points: [
        [radius * ux - halfWidth * px, radius * uz - halfWidth * pz],
        [radius * ux + halfWidth * px, radius * uz + halfWidth * pz],
        [-radius * ux + halfWidth * px, -radius * uz + halfWidth * pz],
        [-radius * ux - halfWidth * px, -radius * uz - halfWidth * pz],
      ],
      kinds: ["end", "end", "end", "end"],
    };
  }
  /** Where the facing edges of two arms meet, on the bisector of the angle `span` after `angle`. */
  const innerCorner = (angle: number, span: number): [number, number] => {
    const bisector = angle + span / 2;
    const distance = halfWidth / Math.sin(span / 2);
    return [distance * Math.cos(bisector), distance * Math.sin(bisector)];
  };
  const points: Point2[] = [];
  const kinds: CornerKind[] = [];
  for (let i = 0; i < shown; i += 1) {
    const angle = angleOf(i);
    const ux = Math.cos(angle);
    const uz = Math.sin(angle);
    const px = -uz;
    const pz = ux;
    points.push([radius * ux - halfWidth * px, radius * uz - halfWidth * pz]);
    points.push([radius * ux + halfWidth * px, radius * uz + halfWidth * pz]);
    kinds.push("end", "end");
    if (i < shown - 1) {
      points.push(innerCorner(angle, step));
      kinds.push("inside");
    }
  }
  // Back from the last shown arm to the first one, across the blank sector.
  const lastAngle = angleOf(shown - 1);
  const gap = Math.PI * 2 - (shown - 1) * step;
  if (gap < Math.PI - 1e-9) {
    points.push(innerCorner(lastAngle, gap));
    kinds.push("inside");
  } else {
    // No neighbour on this side: round the hub with the arm's half width, from the last arm's
    // left edge to the first arm's right edge.
    const start = lastAngle + Math.PI / 2;
    const sweep = gap - Math.PI;
    const segments = Math.max(1, Math.ceil((sweep / (Math.PI * 2)) * HUB_SEGMENTS));
    for (let j = 0; j <= segments; j += 1) {
      const a = start + (sweep * j) / segments;
      points.push([halfWidth * Math.cos(a), halfWidth * Math.sin(a)]);
      kinds.push("smooth");
    }
  }
  return { points, kinds };
}

/**
 * Replaces each selected corner by an arc of `radius` tangent to both edges (a rounded corner
 * where the outline turns outward, a fillet where it turns inward). The tangent distance is
 * limited to half of an edge shared with another rounded corner (all of it otherwise), which
 * caps the radius on short edges, e.g. at most half the arm thickness on an arm end.
 */
function roundCorners(points: Point2[], selected: boolean[], radius: number): Point2[] {
  const n = points.length;
  const out: Point2[] = [];
  for (let i = 0; i < n; i += 1) {
    const v = points[i];
    if (!selected[i]) {
      out.push(v);
      continue;
    }
    const prev = (i - 1 + n) % n;
    const next = (i + 1) % n;
    const a = points[prev];
    const b = points[next];
    const lengthA = Math.hypot(a[0] - v[0], a[1] - v[1]);
    const lengthB = Math.hypot(b[0] - v[0], b[1] - v[1]);
    const u: Point2 = [(a[0] - v[0]) / lengthA, (a[1] - v[1]) / lengthA];
    const w: Point2 = [(b[0] - v[0]) / lengthB, (b[1] - v[1]) / lengthB];
    const angle = Math.acos(Math.min(1, Math.max(-1, u[0] * w[0] + u[1] * w[1])));
    if (angle > Math.PI - 1e-3 || angle < 1e-3) {
      out.push(v);
      continue;
    }
    const half = angle / 2;
    const limit = Math.min(lengthA * (selected[prev] ? 0.5 : 0.999), lengthB * (selected[next] ? 0.5 : 0.999));
    const tangent = Math.min(radius / Math.tan(half), limit);
    const r = tangent * Math.tan(half);
    const p1: Point2 = [v[0] + u[0] * tangent, v[1] + u[1] * tangent];
    const p2: Point2 = [v[0] + w[0] * tangent, v[1] + w[1] * tangent];
    const bisector: Point2 = [u[0] + w[0], u[1] + w[1]];
    const bisectorLength = Math.hypot(...bisector);
    const centre: Point2 = [v[0] + (bisector[0] / bisectorLength) * (r / Math.sin(half)), v[1] + (bisector[1] / bisectorLength) * (r / Math.sin(half))];
    const start = Math.atan2(p1[1] - centre[1], p1[0] - centre[0]);
    let sweep = Math.atan2(p2[1] - centre[1], p2[0] - centre[0]) - start;
    if (sweep > Math.PI) sweep -= Math.PI * 2;
    if (sweep < -Math.PI) sweep += Math.PI * 2;
    const steps = Math.max(2, Math.ceil((Math.abs(sweep) / (Math.PI / 2)) * ROUND_SEGMENTS));
    for (let k = 0; k <= steps; k += 1) {
      const t = start + (sweep * k) / steps;
      out.push([centre[0] + r * Math.cos(t), centre[1] + r * Math.sin(t)]);
    }
  }
  return out;
}

/**
 * Counter-clockwise outline in the X/Z plane (centre at the origin), as [x, z] points, with the
 * plan-view rounding of the "all" style applied. (This is the footprint; with "arms" the arms
 * narrow above and below it.)
 */
export function asteriskOutline(input: AsteriskParams): Point2[] {
  const params = normalizeAsteriskParams(input);
  const { points, kinds } = taggedOutline(params);
  if (params.rounding !== "all") return points;
  const selected = kinds.map((kind) => kind === "end" || kind === "inside");
  return roundCorners(points, selected, params.roundingRadius ?? DEFAULT_ASTERISK_ROUNDING_RADIUS);
}

/**
 * "Outward faces" rounding: the four long edges of every arm are rounded with radius r. At
 * height y the cross-section is the same asterisk with arms narrower by 2(r − √(r² − (r − d)²)),
 * d being the distance to the nearer of top and bottom inside the rounding zone, so the solid is
 * built from stacked outline rings (same points; arm sides, inner corners and hub move with the
 * width) joined by walls, with flat caps. The arm ends stay flat at the full length. Exact,
 * closed and outward-facing.
 */
function armRoundedPositions(params: AsteriskParams): number[] {
  // Keep the narrowest (cap) arms a sliver wide so the caps stay proper polygons.
  const r = Math.max(0, Math.min(params.roundingRadius ?? DEFAULT_ASTERISK_ROUNDING_RADIUS, params.height / 2, params.thickness / 2 * 0.98));
  const levels: Array<{ y: number; width: number }> = [];
  for (let j = 0; j <= ROUND_SEGMENTS; j += 1) {
    const phi = (j / ROUND_SEGMENTS) * (Math.PI / 2);
    levels.push({ y: r * (1 - Math.cos(phi)), width: params.thickness - 2 * r * (1 - Math.sin(phi)) });
  }
  for (let j = ROUND_SEGMENTS; j >= 0; j -= 1) {
    const phi = (j / ROUND_SEGMENTS) * (Math.PI / 2);
    const y = params.height - r * (1 - Math.cos(phi));
    if (y > levels[levels.length - 1].y + 1e-9) levels.push({ y, width: params.thickness - 2 * r * (1 - Math.sin(phi)) });
  }
  const rings = levels.map(({ y, width }) => ({ y, points: taggedOutline(params, width).points }));
  const n = rings[0].points.length;
  const out: number[] = [];
  const push = (a: [number, number, number], b: [number, number, number], c: [number, number, number]) => out.push(...a, ...b, ...c);
  const at = (ring: number, i: number): [number, number, number] => {
    const [x, z] = rings[ring].points[i % n];
    return [x, rings[ring].y, z];
  };
  // Walls between consecutive rings (wound outward for a counter-clockwise outline in x/z).
  for (let k = 0; k + 1 < rings.length; k += 1) {
    for (let i = 0; i < n; i += 1) {
      push(at(k, i), at(k + 1, i + 1), at(k, i + 1));
      push(at(k, i), at(k + 1, i), at(k + 1, i + 1));
    }
  }
  // Caps: bottom faces down, top faces up.
  for (const [cap, up] of [[0, false], [rings.length - 1, true]] as const) {
    const triangles = THREE.ShapeUtils.triangulateShape(rings[cap].points.map(([x, z]) => new THREE.Vector2(x, z)), []);
    for (const [a, b, c] of triangles) {
      const pa = at(cap, a), pb = at(cap, b), pc = at(cap, c);
      const normalY = (pb[2] - pa[2]) * (pc[0] - pa[0]) - (pb[0] - pa[0]) * (pc[2] - pa[2]);
      if ((normalY > 0) === up) push(pa, pb, pc);
      else push(pa, pc, pb);
    }
  }
  // The walls' winding assumes a counter-clockwise outline; flip them if the volume says otherwise.
  let volume = 0;
  for (let i = 0; i < out.length; i += 9) {
    volume += out[i] * (out[i + 4] * out[i + 8] - out[i + 5] * out[i + 7]) - out[i + 1] * (out[i + 3] * out[i + 8] - out[i + 5] * out[i + 6]) + out[i + 2] * (out[i + 3] * out[i + 7] - out[i + 4] * out[i + 6]);
  }
  if (volume < 0) {
    const wallFloats = (rings.length - 1) * n * 2 * 9;
    for (let i = 0; i < wallFloats; i += 9) {
      for (let k = 0; k < 3; k += 1) [out[i + 3 + k], out[i + 6 + k]] = [out[i + 6 + k], out[i + 3 + k]];
    }
  }
  return out;
}

/** Triangle soup of the extruded asterisk, Y-up: X/Z centred, base at y = 0. */
export function asteriskPositions(input: AsteriskParams): number[] {
  const params = normalizeAsteriskParams(input);
  if (params.rounding === "arms") return armRoundedPositions(params);
  // Shape in X/Y with Y = −Z, extruded along +Z, then turned so the extrusion runs up +Y.
  const shape = new THREE.Shape(asteriskOutline(params).map(([x, z]) => new THREE.Vector2(x, -z)));
  // Rounded top and bottom edges ("all", "topBottom"): a bevel with a quarter-round profile,
  // inset by its own size so the outline and the height stay as set.
  const edgeRadius = params.rounding === "all" || params.rounding === "topBottom"
    ? Math.min(params.roundingRadius ?? DEFAULT_ASTERISK_ROUNDING_RADIUS, params.height / 2 - 0.01, params.thickness / 2 - 0.01)
    : 0;
  const geometry = edgeRadius > 0
    ? new THREE.ExtrudeGeometry(shape, {
        depth: params.height - edgeRadius * 2,
        bevelEnabled: true,
        bevelThickness: edgeRadius,
        bevelSize: edgeRadius,
        bevelOffset: -edgeRadius,
        bevelSegments: ROUND_SEGMENTS,
        steps: 1,
      })
    : new THREE.ExtrudeGeometry(shape, { depth: params.height, bevelEnabled: false, steps: 1 });
  if (edgeRadius > 0) geometry.translate(0, 0, edgeRadius);
  geometry.rotateX(-Math.PI / 2);
  const source = geometry.index ? geometry.toNonIndexed() : geometry;
  const positions = Array.from(source.getAttribute("position").array as ArrayLike<number>);
  if (source !== geometry) source.dispose();
  geometry.dispose();
  return positions;
}

/** Shape fields that follow from the parameters: the mesh and the matching size. */
export function asteriskShapePatch(input: AsteriskParams): Pick<WorkplaneShape, "asterisk" | "importedMesh" | "width" | "depth" | "height" | "size"> {
  const params = normalizeAsteriskParams(input);
  const positions = asteriskPositions(params);
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    minX = Math.min(minX, positions[i]);
    maxX = Math.max(maxX, positions[i]);
    minZ = Math.min(minZ, positions[i + 2]);
    maxZ = Math.max(maxZ, positions[i + 2]);
  }
  // Centre the bounding box (odd arm counts are not symmetric about the origin).
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] -= cx;
    positions[i + 2] -= cz;
  }
  const width = maxX - minX;
  const depth = maxZ - minZ;
  return {
    asterisk: params,
    width,
    depth,
    height: params.height,
    size: Math.max(width, depth),
    importedMesh: {
      positions,
      baseWidth: width,
      baseDepth: depth,
      baseHeight: params.height,
      triangleCount: positions.length / 9,
      sourceFormat: "json",
    },
  };
}
