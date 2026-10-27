import { describe, expect, it } from "vitest";
import {
  DEFAULT_REFERENCE_IMAGE_OPACITY,
  isReferenceImage,
  isReferenceImageFile,
  referenceImageOpacity,
  withoutReferenceImages,
} from "@/lib/referenceImage";
import type { WorkplaneShape } from "@/types/sketchforge";

const plate = { dataUrl: "data:image/png;base64,AA==", mimeType: "image/png", pixelWidth: 4, pixelHeight: 2 };

function shape(id: string, imagePlate?: WorkplaneShape["imagePlate"]): WorkplaneShape {
  return { id, name: id, kind: "box", color: "#ffffff", x: 0, z: 0, size: 10, width: 10, depth: 5, height: 0.2, rotation: 0, imagePlate };
}

describe("reference images", () => {
  it("accepts PNG, JPG and WebP photos by type or extension", () => {
    expect(isReferenceImageFile({ name: "photo.JPG", type: "" })).toBe(true);
    expect(isReferenceImageFile({ name: "photo", type: "image/png" })).toBe(true);
    expect(isReferenceImageFile({ name: "side.webp", type: "" })).toBe(true);
    expect(isReferenceImageFile({ name: "logo.svg", type: "image/svg+xml" })).toBe(false);
    expect(isReferenceImageFile({ name: "part.stl", type: "" })).toBe(false);
  });

  it("tells reference images from printable image plates and other shapes", () => {
    const reference = shape("ref", { ...plate, reference: true });
    const printable = shape("plate", plate);
    const box = shape("box");
    expect([reference, printable, box].map(isReferenceImage)).toEqual([true, false, false]);
    expect(withoutReferenceImages([reference, printable, box]).map((entry) => entry.id)).toEqual(["plate", "box"]);
  });

  it("clamps the opacity and defaults it to 50%", () => {
    expect(referenceImageOpacity(shape("a", { ...plate, reference: true }))).toBe(DEFAULT_REFERENCE_IMAGE_OPACITY);
    expect(referenceImageOpacity(shape("b", { ...plate, reference: true, opacity: 0 }))).toBe(0.05);
    expect(referenceImageOpacity(shape("c", { ...plate, reference: true, opacity: 3 }))).toBe(1);
    expect(referenceImageOpacity(shape("d", { ...plate, reference: true, opacity: 0.3 }))).toBe(0.3);
  });
});
