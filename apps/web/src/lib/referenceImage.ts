import type { WorkplaneShape } from "@/types/sketchforge";

/**
 * Reference images (fork feature, see FORK.md): a PNG/JPG/WebP photo placed in the scene as a
 * translucent overlay to model against. It is an image-plate box marked `reference`, drawn as a
 * flat picture with adjustable opacity, and it is never exported, printed or grouped.
 */
export const REFERENCE_IMAGE_THICKNESS = 0.2;
export const DEFAULT_REFERENCE_IMAGE_OPACITY = 0.5;
export const MIN_REFERENCE_IMAGE_OPACITY = 0.05;

const REFERENCE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const REFERENCE_IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp"]);

export function isReferenceImage(shape: Pick<WorkplaneShape, "imagePlate"> | null | undefined) {
  return Boolean(shape?.imagePlate?.reference);
}

export function referenceImageOpacity(shape: Pick<WorkplaneShape, "imagePlate">) {
  const value = shape.imagePlate?.opacity;
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(1, Math.max(MIN_REFERENCE_IMAGE_OPACITY, value))
    : DEFAULT_REFERENCE_IMAGE_OPACITY;
}

export function isReferenceImageFile(file: Pick<File, "name" | "type">) {
  if (REFERENCE_IMAGE_TYPES.has(file.type)) return true;
  return REFERENCE_IMAGE_EXTENSIONS.has(file.name.split(".").pop()?.toLowerCase() ?? "");
}

/** Shapes that become printable geometry: everything except reference images. */
export function withoutReferenceImages<T extends Pick<WorkplaneShape, "imagePlate">>(shapes: T[]) {
  return shapes.filter((shape) => !isReferenceImage(shape));
}
