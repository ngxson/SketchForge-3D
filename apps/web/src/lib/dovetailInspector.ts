import type { ShapePropertyConfig } from "@/components/workplane/ShapeInspector";
import { DOVETAIL_LIMITS, normalizeDovetailParams, type DovetailParams, type DovetailSide } from "@/lib/dovetail";
import type { LatchBoxPropertyGroup } from "@/lib/latchBoxInspector";

const SIDE_LABELS: Array<{ value: DovetailSide; label: string }> = [
  { value: "male", label: "Male (tail)" },
  { value: "female", label: "Female (slot)" },
];

type NumericKey = Exclude<keyof DovetailParams, "side">;

/** Inspector card for a dovetail part (fork feature, see FORK.md). Every change yields normalized params. */
export function dovetailPropertyGroups(input: DovetailParams, onChange: (next: DovetailParams) => void): LatchBoxPropertyGroup[] {
  const params = normalizeDovetailParams(input);
  const set = (patch: Partial<DovetailParams>) => onChange(normalizeDovetailParams({ ...params, ...patch }));
  const num = (label: string, key: NumericKey, step = 0.1, unit: "mm" | "none" = "mm"): ShapePropertyConfig => ({
    label,
    value: params[key],
    min: DOVETAIL_LIMITS[key][0],
    max: Math.min(DOVETAIL_LIMITS[key][1], key === "angle" ? 40 : key === "clearance" ? 1 : 120),
    step,
    unit,
    onChange: (value) => set({ [key]: value } as Partial<DovetailParams>),
  });
  return [
    {
      title: "Dovetail",
      properties: [
        {
          type: "select",
          label: "Side",
          value: SIDE_LABELS.find((option) => option.value === params.side)?.label ?? SIDE_LABELS[0].label,
          options: SIDE_LABELS.map((option) => option.label),
          onChange: (label) => set({ side: SIDE_LABELS.find((option) => option.label === label)?.value ?? "male" }),
        },
        num("Length", "length"),
        num("Width", "width"),
        num(params.side === "female" ? "Floor" : "Base", "base"),
        num("Tail Width", "tailWidth"),
        num("Tail Depth", "tailDepth"),
        num("Angle (°)", "angle", 0.5, "none"),
        num("Clearance", "clearance", 0.05),
      ],
    },
  ];
}
