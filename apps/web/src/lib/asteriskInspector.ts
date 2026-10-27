import type { ShapePropertyConfig } from "@/components/workplane/ShapeInspector";
import { ASTERISK_LIMITS, DEFAULT_ASTERISK_ROUNDING_RADIUS, maxAsteriskThickness, normalizeAsteriskParams, type AsteriskParams, type AsteriskRounding } from "@/lib/asterisk";
import type { LatchBoxPropertyGroup } from "@/lib/latchBoxInspector";

const ROUNDING_LABELS: Array<{ value: AsteriskRounding | undefined; label: string }> = [
  { value: undefined, label: "None" },
  { value: "all", label: "All edges" },
  { value: "topBottom", label: "Top & bottom edges" },
  { value: "arms", label: "Outward faces" },
];

/** Inspector card for an asterisk (fork feature, see FORK.md). */
export function asteriskPropertyGroups(input: AsteriskParams, onChange: (next: AsteriskParams) => void): LatchBoxPropertyGroup[] {
  const params = normalizeAsteriskParams(input);
  const set = (patch: Partial<AsteriskParams>) => onChange(normalizeAsteriskParams({ ...params, ...patch }));
  const properties: ShapePropertyConfig[] = [
    { label: "Diameter", value: params.diameter, min: ASTERISK_LIMITS.diameter[0], max: 200, step: 0.5, unit: "mm", onChange: (diameter) => set({ diameter }) },
    {
      label: "Arms",
      value: params.arms,
      min: ASTERISK_LIMITS.arms[0],
      max: ASTERISK_LIMITS.arms[1],
      step: 1,
      unit: "none",
      // Keep "show all" when all arms were shown; otherwise keep the shown count (capped).
      onChange: (arms) => set({ arms: Math.round(arms), visibleArms: params.visibleArms === undefined ? undefined : Math.min(params.visibleArms, Math.round(arms)) }),
    },
    {
      label: "Show Arms",
      value: params.visibleArms ?? params.arms,
      min: 1,
      max: params.arms,
      step: 1,
      unit: "none",
      onChange: (visibleArms) => set({ visibleArms: Math.round(visibleArms) }),
    },
    {
      label: "Thickness",
      value: params.thickness,
      min: ASTERISK_LIMITS.thickness[0],
      max: Math.max(ASTERISK_LIMITS.thickness[0], maxAsteriskThickness(params.diameter, params.arms)),
      step: 0.1,
      unit: "mm",
      onChange: (thickness) => set({ thickness }),
    },
    { label: "Height", value: params.height, min: ASTERISK_LIMITS.height[0], max: 160, step: 0.5, unit: "mm", onChange: (height) => set({ height }) },
    {
      type: "select",
      label: "Rounding",
      value: ROUNDING_LABELS.find((option) => option.value === params.rounding)?.label ?? "None",
      options: ROUNDING_LABELS.map((option) => option.label),
      onChange: (label) => set({ rounding: ROUNDING_LABELS.find((option) => option.label === label)?.value }),
    },
  ];
  if (params.rounding) {
    properties.push({
      label: "Rounding Radius",
      value: params.roundingRadius ?? DEFAULT_ASTERISK_ROUNDING_RADIUS,
      min: ASTERISK_LIMITS.roundingRadius[0],
      max: 20,
      step: 0.1,
      unit: "mm",
      onChange: (roundingRadius) => set({ roundingRadius }),
    });
  }
  return [{ title: "Asterisk", properties }];
}
