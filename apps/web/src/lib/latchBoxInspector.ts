import type { ShapePropertyConfig } from "@/components/workplane/ShapeInspector";
import { normalizeLatchBoxParams, type LatchBoxHookStyle, type LatchBoxParams } from "@/lib/latchBox";

export type LatchBoxPropertyGroup = { title: string; properties: ShapePropertyConfig[] };

const HOOK_STYLE_LABELS: Array<{ value: LatchBoxHookStyle; label: string }> = [
  { value: "solid", label: "Solid wedge" },
  { value: "tab", label: "Plain tab" },
  { value: "thin", label: "Thin L-hook" },
];

type NumericKey = { [K in keyof LatchBoxParams]: LatchBoxParams[K] extends number ? K : never }[keyof LatchBoxParams];
type BooleanKey = { [K in keyof LatchBoxParams]: LatchBoxParams[K] extends boolean ? K : never }[keyof LatchBoxParams];

/**
 * Inspector property groups for a latch box part. Mirrors the sections of the original
 * generator page (Box, Latches, Screw, Cover & fit). Every change produces a complete,
 * normalized parameter set.
 */
export function latchBoxPropertyGroups(input: LatchBoxParams, onChange: (next: LatchBoxParams) => void): LatchBoxPropertyGroup[] {
  const params = normalizeLatchBoxParams(input);
  const set = (patch: Partial<LatchBoxParams>) => onChange(normalizeLatchBoxParams({ ...params, ...patch }));
  const num = (label: string, key: NumericKey, min: number, max: number, step = 0.1, unit: "mm" | "none" = "mm"): ShapePropertyConfig => ({
    label,
    value: params[key],
    min,
    max,
    step,
    unit,
    onChange: (value) => set({ [key]: step >= 1 ? Math.round(value) : value } as Partial<LatchBoxParams>),
  });
  const toggle = (label: string, key: BooleanKey): ShapePropertyConfig => ({
    type: "toggle",
    label,
    value: params[key],
    onChange: (value) => set({ [key]: value } as Partial<LatchBoxParams>),
  });

  return [
    {
      title: "Box",
      properties: [
        num("Width", "W", 10, 200, 0.5),
        num("Height", "H", 10, 200, 0.5),
        num("Depth", "D", 6, 120, 0.5),
        num("Wall", "wall", 1, 8),
        num("Front Plate", "front", 0.4, 8),
        num("Corner Radius", "radius", 0, 20, 0.5),
      ],
    },
    {
      title: "Latches",
      properties: [
        num("Latch Count", "latchCount", 0, 12, 1, "none"),
        num("Latch Width", "latchWidth", 3, 80, 0.5),
        num("Lip Protrusion", "lipIn", 0.4, 6),
        num("Undercut", "undercut", 0.4, 6),
        num("Hook Length", "hookDrop", 2, 20),
        num("Hook Neck", "hookNeck", 0.6, 10),
        {
          type: "select",
          label: "Hook Style",
          value: HOOK_STYLE_LABELS.find((option) => option.value === params.hookStyle)?.label ?? HOOK_STYLE_LABELS[0].label,
          options: HOOK_STYLE_LABELS.map((option) => option.label),
          onChange: (label) => set({ hookStyle: HOOK_STYLE_LABELS.find((option) => option.label === label)?.value ?? "solid" }),
        },
        toggle("Support Pad", "padOn"),
        num("Pad Gap", "padGap", 0, 20),
        num("Pad Length", "padLength", 1, 20, 0.5),
        num("Pad Ramp", "padRamp", 0, 20, 0.5),
      ],
    },
    {
      title: "Screw",
      properties: [
        num("Screw (M)", "screw", 1.6, 6, 0.5, "none"),
        num("Edge Distance", "screwEdge", 3, 60, 0.5),
        num("Boss Width", "bossWidth", 4, 40, 0.5),
        num("Boss Length", "bossLength", 4, 60, 0.5),
        num("Hole Depth", "holeDepth", 2, 40, 0.5),
        toggle("Boss In Cover", "coverBoss"),
        num("Cover Boss Height", "bossDrop", 0.5, 20),
        toggle("Countersink", "countersink"),
        num("Countersink Dia", "csDia", 2, 20),
      ],
    },
    {
      title: "Cover & Fit",
      properties: [
        num("Cover Thickness", "coverThick", 0.8, 8),
        toggle("Side Rails", "coverRim"),
        num("Rail Width", "coverRimWidth", 0.6, 6),
        num("Rail Height", "coverRimHeight", 0.3, 6),
        num("Clearance", "clearance", 0, 1, 0.05),
        num("Curve Segments", "segments", 16, 128, 8, "none"),
      ],
    },
  ];
}
