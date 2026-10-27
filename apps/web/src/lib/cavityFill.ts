import type { ManifoldToplevel } from "manifold-3d";
import { offsetTriangleSoup, triangleSoupVolume } from "@/lib/meshOffset";
import { repairTJunctions } from "@/lib/meshRepair";

/**
 * Fill Hollow (fork feature, see FORK.md): the solid that fills the hollow part of a shape,
 * e.g. a lid or plug that fits into it. The hollow is the empty space between the shape and its
 * convex hull; when that space has several separate regions (a handle, an outside recess), the
 * largest one is used. The result is shrunk by `clearance` (a surface offset) so it fits.
 *
 * Input and output are world-space triangle soups (x, y, z per corner, outward winding).
 */
export type CavityFillResult =
  | { ok: true; positions: number[]; volume: number; regions: number }
  | { ok: false; reason: string };

/** Hollow regions smaller than this share of the hull's volume are treated as tessellation noise. */
const MIN_CAVITY_SHARE = 1e-4;

export function cavityFillPositions(runtime: ManifoldToplevel, positions: number[], clearance = 0): CavityFillResult {
  const { Manifold, Mesh } = runtime;
  const created: Array<{ delete(): void }> = [];
  const keep = <T extends { delete(): void }>(value: T) => {
    created.push(value);
    return value;
  };
  try {
    // Mesh is a plain JS object (nothing to free); the Manifold solids below are WASM-backed.
    const solidFrom = (soup: number[]) => {
      const mesh = new Mesh({
        numProp: 3,
        vertProperties: new Float32Array(soup),
        triVerts: Uint32Array.from({ length: soup.length / 3 }, (_, i) => i),
      });
      mesh.merge();
      try {
        const candidate = keep(new Manifold(mesh));
        return candidate.status() === "NoError" ? candidate : null;
      } catch {
        return null;
      }
    };
    // Meshes with T-junctions (e.g. three-bvh-csg results) are closed but not edge-manifold:
    // split those edges and try again.
    const solid = solidFrom(positions) ?? solidFrom(repairTJunctions(positions).positions);
    if (!solid) return { ok: false, reason: "The shape is not a closed solid, so its hollow can't be found" };
    const hull = keep(solid.hull());
    const empty = keep(hull.subtract(solid));
    const regions = empty.decompose();
    regions.forEach((region) => keep(region));
    const significant = regions.filter((region) => region.volume() > hull.volume() * MIN_CAVITY_SHARE);
    if (!significant.length) return { ok: false, reason: "This shape has no hollow part to fill" };
    const largest = significant.reduce((best, region) => (region.volume() > best.volume() ? region : best));
    const result = largest.getMesh();
    let soup: number[] = new Array(result.triVerts.length * 3);
    for (let i = 0; i < result.triVerts.length; i += 1) {
      const offset = result.triVerts[i] * result.numProp;
      soup[i * 3] = result.vertProperties[offset];
      soup[i * 3 + 1] = result.vertProperties[offset + 1];
      soup[i * 3 + 2] = result.vertProperties[offset + 2];
    }
    if (clearance > 0) {
      soup = offsetTriangleSoup(soup, -clearance);
      if (!(triangleSoupVolume(soup) > 0)) return { ok: false, reason: `A clearance of ${clearance} mm is too large for this hollow` };
    }
    return { ok: true, positions: soup, volume: triangleSoupVolume(soup), regions: significant.length };
  } finally {
    for (const value of created) value.delete();
  }
}
