import type { ShapePropertyConfig } from "@/components/workplane/ShapeInspector";
import type { LatchBoxPropertyGroup } from "@/lib/latchBoxInspector";
import { normalizeSlidingLidBoxParams, SLIDING_LID_BOX_LIMITS, type SlidingLidBoxParams } from "@/lib/slidingLidBox";

const DIMENSION_LABELS = { external: "Outside size", internal: "Inside size" } as const;

type NumericKey = Exclude<keyof SlidingLidBoxParams, "dimensionType">;

/** Inspector card for a sliding lid box part (fork feature, see FORK.md). */
export function slidingLidBoxPropertyGroups(input: SlidingLidBoxParams, onChange: (next: SlidingLidBoxParams) => void): LatchBoxPropertyGroup[] {
  const params = normalizeSlidingLidBoxParams(input);
  const set = (patch: Partial<SlidingLidBoxParams>) => onChange(normalizeSlidingLidBoxParams({ ...params, ...patch }));
  const num = (label: string, key: NumericKey, step = 0.5): ShapePropertyConfig => ({
    label,
    value: params[key],
    min: SLIDING_LID_BOX_LIMITS[key][0],
    max: SLIDING_LID_BOX_LIMITS[key][1],
    step,
    unit: "mm",
    onChange: (value) => set({ [key]: value } as Partial<SlidingLidBoxParams>),
  });
  return [
    {
      title: "Sliding Lid Box",
      properties: [
        {
          type: "select",
          label: "Dimensions",
          value: DIMENSION_LABELS[params.dimensionType],
          options: [DIMENSION_LABELS.external, DIMENSION_LABELS.internal],
          onChange: (label) => set({ dimensionType: label === DIMENSION_LABELS.internal ? "internal" : "external" }),
        },
        num("Width", "width"),
        num("Depth", "depth"),
        num("Height", "height"),
        num("Corner Radius", "radius"),
        num("Wall Thickness", "wallThickness", 0.1),
        num("Clearance", "tolerance", 0.05),
        num("Latch Depth", "latchDepth", 0.05),
      ],
    },
  ];
}
