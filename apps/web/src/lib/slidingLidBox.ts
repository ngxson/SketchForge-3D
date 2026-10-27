import type { ManifoldToplevel } from "manifold-3d";
import { zUpToSketchForge } from "@/lib/meshCoordinates";

/**
 * Parametric sliding lid box (fork feature, see FORK.md). A port of the replicad
 * "sliding-lid-box" configurator (printables.com/model/425966) to Manifold. The original
 * lofts and fillets B-Rep solids; here every convex piece (rounded boxes, chamfered outer
 * box, each segment of the dovetail rail loft, grips) is a convex hull of its outline points,
 * and the pieces are combined with Manifold booleans exactly as the original combines them.
 *
 * The lid slides in from the front (y = 0) along dovetail grooves cut into the side and back
 * walls, stops against a front lip, and clicks over two small latch bumps. Not ported: the
 * engraved lid label (needs a font engine) and the multi-material label body.
 *
 * Coordinates while building are the original's: Z-up, the box's front-left-bottom corner at
 * the origin, x = width, y = depth, z = height.
 */
export type SlidingLidDimensionType = "external" | "internal";

export type SlidingLidBoxParams = {
  /** Whether width/depth/height are the outside size or the usable inside size. */
  dimensionType: SlidingLidDimensionType;
  width: number;
  depth: number;
  height: number;
  /** Corner radius of the vertical edges (0 = square). */
  radius: number;
  wallThickness: number;
  /** Fit clearance between lid and box (0.2 mm in the original). */
  tolerance: number;
  /**
   * Snap latch: height in mm of the ridge across the top of the box's front wall, above the
   * lid's flat underside (0 = no ridge). The lid has a small matching dent under its front lip,
   * so it clicks in when fully closed and stays shut; it rides over the ridge while sliding.
   * The original's small hidden pins are kept.
   */
  latchDepth: number;
};

export type SlidingLidBoxPart = "body" | "lid";

export const DEFAULT_SLIDING_LID_BOX_PARAMS: SlidingLidBoxParams = {
  dimensionType: "external",
  width: 50,
  depth: 35,
  height: 25,
  radius: 5,
  wallThickness: 3,
  tolerance: 0.2,
  latchDepth: 0.25,
};

export const SLIDING_LID_BOX_LIMITS = {
  width: [30, 200],
  depth: [20, 200],
  // The original's slider stops at 15 mm; the real minimum depends on the wall thickness and is
  // checked by validateSlidingLidBoxParams (2 × wall + 3.5 mm: floor, lid, and 2 mm of room).
  height: [8, 200],
  radius: [0, 20],
  wallThickness: [3, 10],
  tolerance: [0, 1],
  latchDepth: [0, 1],
} as const;

const LID_ADDITIONAL_HEIGHT = 1.5;
const ARC_SEGMENTS = 12;
const ROUND_SEGMENTS = 32;

export function normalizeSlidingLidBoxParams(input: Partial<SlidingLidBoxParams> | null | undefined): SlidingLidBoxParams {
  const source = input ?? {};
  const value = (key: keyof typeof SLIDING_LID_BOX_LIMITS) => {
    const [min, max] = SLIDING_LID_BOX_LIMITS[key];
    const raw = source[key];
    const number = typeof raw === "number" && Number.isFinite(raw) ? raw : DEFAULT_SLIDING_LID_BOX_PARAMS[key];
    return Math.min(max, Math.max(min, number));
  };
  return {
    dimensionType: source.dimensionType === "internal" ? "internal" : "external",
    width: value("width"),
    depth: value("depth"),
    height: value("height"),
    radius: value("radius"),
    wallThickness: value("wallThickness"),
    tolerance: value("tolerance"),
    latchDepth: value("latchDepth"),
  };
}

/** Outside size actually built (the original grows the box for internal sizes and a minimum width). */
export function slidingLidBoxOuterSize(input: SlidingLidBoxParams) {
  const p = normalizeSlidingLidBoxParams(input);
  const w = p.wallThickness;
  let width = p.width;
  let depth = p.depth;
  let height = p.height;
  if (p.dimensionType === "internal") {
    width += w * 2;
    depth += w * 2;
    height += w * 2 + LID_ADDITIONAL_HEIGHT;
  }
  width = Math.max(width, 18 + w * 2 + p.tolerance);
  const radius = Math.max(0, Math.min(p.radius, width / 2 - 0.2, depth / 2 - 0.2));
  return { width, depth, height, radius };
}

/** Parameter combinations the original model cannot build sensibly. */
export function validateSlidingLidBoxParams(input: SlidingLidBoxParams): string[] {
  const p = normalizeSlidingLidBoxParams(input);
  const { depth, height } = slidingLidBoxOuterSize(p);
  const w = p.wallThickness;
  const errors: string[] = [];
  if (height < w * 2 + LID_ADDITIONAL_HEIGHT + 2) errors.push(`Height must be at least ${(w * 2 + LID_ADDITIONAL_HEIGHT + 2).toFixed(1)} mm for this wall thickness.`);
  if (depth < w * 2 + 6) errors.push(`Depth must be at least ${(w * 2 + 6).toFixed(1)} mm for this wall thickness.`);
  return errors;
}

type Point2 = [number, number];
/** Corner radii: [front-left, front-right, back-right, back-left] (front = low y). */
type CornerRadii = [number, number, number, number];

/** Counter-clockwise outline of the rectangle [x0, x0+w] × [y0, y0+d] with rounded corners. */
function roundedRectPoints(x0: number, y0: number, w: number, d: number, radii: CornerRadii): Point2[] {
  const limit = Math.max(0, Math.min(w, d) / 2);
  const [fl, fr, br, bl] = radii.map((r) => Math.min(Math.max(0, r), limit));
  const points: Point2[] = [];
  const corner = (cx: number, cy: number, r: number, start: number, px: number, py: number) => {
    if (r <= 1e-6) {
      points.push([px, py]);
      return;
    }
    for (let i = 0; i <= ARC_SEGMENTS; i += 1) {
      const a = start + (i / ARC_SEGMENTS) * (Math.PI / 2);
      points.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  };
  corner(x0 + fl, y0 + fl, fl, Math.PI, x0, y0);
  corner(x0 + w - fr, y0 + fr, fr, -Math.PI / 2, x0 + w, y0);
  corner(x0 + w - br, y0 + d - br, br, 0, x0 + w, y0 + d);
  corner(x0 + bl, y0 + d - bl, bl, Math.PI / 2, x0, y0 + d);
  return points;
}

type Section = { points: Point2[]; z: number };

export type SlidingLidBoxMesh = { positions: number[] };
export type SlidingLidBoxBuild = { body: SlidingLidBoxMesh; lid: SlidingLidBoxMesh; durationMs: number };

/**
 * Builds both parts. By default the lid is laid out in front of the box on the bed, as in the
 * original; `assembled` leaves it in place in the box (used by tests to check the fit).
 */
export function buildSlidingLidBox(runtime: ManifoldToplevel, input: SlidingLidBoxParams, options: { assembled?: boolean } = {}): SlidingLidBoxBuild {
  const started = performance.now();
  const p = normalizeSlidingLidBoxParams(input);
  const { Manifold } = runtime;
  type Solid = InstanceType<typeof Manifold>;
  const created: Solid[] = [];
  const keep = <T extends Solid>(solid: T) => {
    created.push(solid);
    return solid;
  };

  try {
    const tolerance = p.tolerance;
    const wall = p.wallThickness;
    const { width, depth, height, radius } = slidingLidBoxOuterSize(p);

    const lidHeight = wall + LID_ADDITIONAL_HEIGHT;
    const lidWidth = width - wall * 2 - tolerance;
    const lidDepth = depth - wall * 2 - tolerance / 2;
    const latchPosition = depth - (Math.max(radius, wall) + 2);
    const boxDovetailHeight = wall + tolerance;
    const topChamfer = radius > 0 ? Math.min(radius - 0.02, 2) : 2;
    const bottomChamfer = radius > 0 ? Math.min(radius - 0.02, 1) : 1;
    const adjacentLength = radius - wall / 2;
    const oppositeLength = Math.sqrt(radius ** 2 - adjacentLength ** 2);
    const availableSpaceForCutout = wall / 2 - (radius - oppositeLength);

    // --- Primitives ---------------------------------------------------------------------
    const zeroBox = (w: number, d: number, h: number, x = 0, y = 0, z = 0) =>
      keep(Manifold.cube([Math.max(1e-3, w), Math.max(1e-3, d), Math.max(1e-3, h)]).translate([x, y, z]));
    const hullOf = (sections: Section[]) =>
      keep(Manifold.hull(sections.flatMap(({ points, z }) => points.map(([x, y]) => [x, y, z] as [number, number, number]))));
    /** Prism of a convex outline between two heights. */
    const prism = (points: Point2[], z0: number, z1: number) => hullOf([{ points, z: z0 }, { points, z: z1 }]);
    const cylinder = (r: number, h: number, x: number, y: number, z: number) =>
      keep(Manifold.cylinder(h, r, r, ROUND_SEGMENTS).translate([x, y, z]));
    const union = (solids: Solid[]) => keep(Manifold.union(solids));
    const subtract = (a: Solid, b: Solid) => keep(a.subtract(b));
    const intersect = (a: Solid, b: Solid) => keep(a.intersect(b));

    /** The original's buildRect: corners on the far side (high y) rounded, front corners square. */
    const farRoundedRect = (x0: number, y0: number, w: number, d: number, r: number) =>
      roundedRectPoints(x0, y0, w, d, [0, 0, r, r]);

    /**
     * The original's buildDovetail: a loft through four sections, from the top outline at z = 0
     * down to the same outline at z = −h, bulging out by `offset` on both sides (and the back)
     * in the middle. Each loft segment is convex, so it is the hull of its two sections.
     */
    const dovetail = (w: number, d: number, h: number, offset: number, r: number, x: number, y: number, z: number) => {
      const bevel = (h - 0.4) / 2;
      const innerRadius = r > 0 ? Math.max(0, r - offset) : 0;
      const outer = farRoundedRect(x, y, w, d, innerRadius);
      const middle = farRoundedRect(x - offset, y, w + offset * 2, d + offset, Math.max(0, r));
      return union([
        hullOf([{ points: outer, z }, { points: middle, z: z - bevel }]),
        prism(middle, z - bevel - 0.4, z - bevel),
        hullOf([{ points: middle, z: z - bevel - 0.4 }, { points: outer, z: z - h }]),
      ]);
    };

    // --- Box ----------------------------------------------------------------------------
    // Outer box: vertical edges rounded, top and bottom edges chamfered (a convex hull).
    const allRound = (inset: number): CornerRadii => {
      const r = Math.max(0, radius - inset);
      return [r, r, r, r];
    };
    const ring = (inset: number) => roundedRectPoints(inset, inset, width - inset * 2, depth - inset * 2, allRound(inset));
    const topCut = Math.max(0, Math.min(topChamfer, wall - 1));
    const bottomCut = Math.max(0, bottomChamfer);
    const outerBox = hullOf([
      { points: ring(bottomCut), z: 0 },
      { points: ring(0), z: bottomCut },
      { points: ring(0), z: height - topCut },
      { points: ring(topCut), z: height },
    ]);

    const interiorRadius = radius > 0 ? Math.max(0.01, radius - wall) : 0;
    const boxInterior = prism(
      roundedRectPoints(wall, wall, width - wall * 2, depth - wall * 2, [interiorRadius, interiorRadius, interiorRadius, interiorRadius]),
      wall,
      height + 1,
    );

    // Slot in the front wall the lid slides through.
    let box = subtract(
      zeroBox(width, depth, height),
      zeroBox(width - wall * 2, Math.max(radius, wall), lidHeight - tolerance / 2, wall, 0, height - lidHeight + tolerance / 2),
    );

    let boxDovetail = dovetail(
      width - wall * 2,
      depth,
      boxDovetailHeight,
      wall / 2 + tolerance / 2,
      radius - wall / 2,
      wall,
      -wall,
      height - (lidHeight - tolerance - boxDovetailHeight) / 2 - 0.25,
    );

    // --- Lid ----------------------------------------------------------------------------
    const lidDovetailHeight = wall;
    const lidDovetail = dovetail(
      lidWidth,
      lidDepth + radius,
      lidDovetailHeight,
      wall / 2,
      radius - wall / 2 - tolerance / 2,
      wall + tolerance / 2,
      wall - radius,
      height - (lidHeight - tolerance - lidDovetailHeight) / 2 - 0.25,
    );

    let frontStop: Solid;
    let frontCutout: Solid;
    /** Front-to-back depth of the lid's front lip (the front stop). */
    let lipDepth: number;
    if (radius === 0 || !Number.isFinite(availableSpaceForCutout) || availableSpaceForCutout > 1) {
      lipDepth = wall;
      frontStop = zeroBox(width - wall + 0.5, wall, lidHeight - tolerance + 1, wall / 2 - 0.25, 0, height - lidHeight + tolerance);
      frontCutout = zeroBox(
        width - wall + 0.5 + tolerance,
        wall + tolerance / 2 + 2,
        lidHeight - tolerance / 2 + 1,
        wall / 2 - 0.25 - tolerance / 2,
        -2,
        height - lidHeight + tolerance / 2,
      );
    } else {
      lipDepth = radius - oppositeLength + 1;
      frontStop = zeroBox(width, radius - oppositeLength + 1, lidHeight - tolerance, 0, 0, height - lidHeight + tolerance);
      frontCutout = zeroBox(width, radius - oppositeLength + 1 + 2, lidHeight - tolerance / 2, 0, tolerance / 2 - 2, height - lidHeight + tolerance / 2);
    }

    // Lid plate: back vertical edges rounded to follow the box interior.
    const lidPlateRadius = radius > 0 ? Math.max(0, radius - wall - tolerance / 2) : 0;
    let lid = prism(
      farRoundedRect(wall + tolerance / 2, 0, width - wall * 2 - tolerance, lidDepth + wall, lidPlateRadius),
      height - lidHeight + tolerance,
      height,
    );

    // Latch bumps on the box rails and matching dimples in the lid, as in the original.
    const positiveLatches = union([
      cylinder(0.5, wall, wall / 2 - tolerance / 2 - 0.1, latchPosition, height - lidHeight),
      cylinder(0.5, wall, wall / 2 - tolerance / 2 - 0.1 + width - wall + tolerance + 0.2, latchPosition, height - lidHeight),
    ]);
    const negativeLatches = union([
      cylinder(0.6, wall, wall / 2, latchPosition, height - lidHeight),
      cylinder(0.6, wall, wall / 2 + width - wall, latchPosition, height - lidHeight),
    ]);

    // Snap latch (fork addition): a ridge across the top of the front wall, under the lid's
    // front lip when the lid is closed, and a matching dent (ridge + tolerance) under the lip.
    // The rest of the lid's underside stays flat, so the lid rides over the ridge while sliding
    // and drops into it at the end: `latchDepth` (the ridge height above the lid's underside)
    // sets both the click and the sliding friction. The ridge is centred and at most 20 mm long.
    const lipBottom = height - lidHeight + tolerance;
    // On the front wall itself: with a large corner radius the lip is deeper than the wall.
    const ridgeBase = Math.min(lipDepth, wall);
    const ridgeRadius = Math.max(0.3, Math.min(1, ridgeBase / 2 - 0.2));
    const ridgeY = ridgeBase / 2;
    const ridgeZ = lipBottom + p.latchDepth - ridgeRadius;
    const ridgeLength = Math.max(2, Math.min(20, lidWidth - 6));
    const ridgeX0 = width / 2 - ridgeLength / 2;
    const ridgeX1 = width / 2 + ridgeLength / 2;
    const alongX = (r: number, x0: number, x1: number) =>
      keep(keep(Manifold.cylinder(x1 - x0, r, r, ROUND_SEGMENTS)).rotate([0, 90, 0]).translate([x0, ridgeY, ridgeZ]));
    const snapRidge = p.latchDepth > 0 ? alongX(ridgeRadius, ridgeX0, ridgeX1) : null;
    const snapGroove = p.latchDepth > 0 ? alongX(ridgeRadius + tolerance, ridgeX0 - tolerance, ridgeX1 + tolerance) : null;

    // Grip ridges: capsules (cylinders with fully rounded ends) lying along X on the lid.
    const grip = (length: number, r: number, x: number, y: number, z: number) =>
      keep(Manifold.hull([
        keep(Manifold.sphere(r, 16).translate([x + r, y, z])),
        keep(Manifold.sphere(r, 16).translate([x + length - r, y, z])),
      ]));
    const grips = [
      grip(18, 1, width / 2 - 9, 6, height - 0.2),
      grip(16, 1, width / 2 - 8, 9, height - 0.2),
      grip(10, 1, width / 2 - 5, 12, height - 0.2),
    ];

    lid = intersect(union([lid, frontStop, lidDovetail]), outerBox);
    lid = subtract(lid, negativeLatches);
    if (snapGroove) lid = subtract(lid, snapGroove);
    lid = union([lid, ...grips]);

    boxDovetail = subtract(boxDovetail, positiveLatches);
    box = subtract(box, union([boxDovetail, boxInterior]));
    box = subtract(box, frontCutout);
    if (snapRidge) box = union([box, snapRidge]);
    box = intersect(box, outerBox);

    // The original lays the lid out in front of the box, resting on the bed.
    if (!options.assembled) lid = keep(lid.translate([0, -depth, -height + lidHeight - tolerance]));

    return { body: meshOf(box), lid: meshOf(lid), durationMs: performance.now() - started };
  } finally {
    for (const solid of created) solid.delete();
  }
}

/** Triangle soup in SketchForge's Y-up frame. */
function meshOf(solid: { getMesh(): { numProp: number; vertProperties: Float32Array; triVerts: Uint32Array } }): SlidingLidBoxMesh {
  const mesh = solid.getMesh();
  const positions: number[] = new Array(mesh.triVerts.length * 3);
  for (let i = 0; i < mesh.triVerts.length; i += 1) {
    const offset = mesh.triVerts[i] * mesh.numProp;
    const [x, y, z] = zUpToSketchForge([mesh.vertProperties[offset], mesh.vertProperties[offset + 1], mesh.vertProperties[offset + 2]]);
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
  }
  return { positions };
}
