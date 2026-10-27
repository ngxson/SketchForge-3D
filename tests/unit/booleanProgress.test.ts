import { describe, expect, it } from "vitest";
import { formatBooleanProgress, getBooleanProgress, setBooleanProgress, subscribeBooleanProgress, updateBooleanProgressDetail } from "@/lib/booleanProgress";
import { DEFAULT_MANIFOLD_BOOLEAN_RATE, estimateManifoldBooleanMs, updateManifoldBooleanRate } from "@/lib/manifoldBooleanRuntime";

describe("boolean progress store", () => {
  it("notifies subscribers and merges detail updates", () => {
    let calls = 0;
    const unsubscribe = subscribeBooleanProgress(() => {
      calls += 1;
    });
    setBooleanProgress({ label: "Cutting", detail: "Preparing", startedAt: 0, estimatedMs: 1000, triangles: 10, cancel: () => {} });
    updateBooleanProgressDetail("Cutting…");
    updateBooleanProgressDetail("Cutting…");
    expect(getBooleanProgress()?.detail).toBe("Cutting…");
    expect(getBooleanProgress()?.label).toBe("Cutting");
    expect(calls).toBe(2);
    setBooleanProgress(null);
    expect(getBooleanProgress()).toBeNull();
    unsubscribe();
  });

  it("formats the ETA from the estimate", () => {
    expect(formatBooleanProgress(1000, 4000)).toEqual({ percent: 25, eta: "About 3 s left", elapsed: "1.0 s elapsed" });
    expect(formatBooleanProgress(3900, 4000).eta).toBe("Finishing up…");
    expect(formatBooleanProgress(9000, 4000)).toMatchObject({ percent: 96, eta: "Finishing up…" });
    expect(formatBooleanProgress(12_400, 4000).elapsed).toBe("12 s elapsed");
  });
});

describe("boolean duration model", () => {
  it("scales with triangle count and refines the rate from measurements", () => {
    expect(estimateManifoldBooleanMs(0)).toBe(250);
    expect(estimateManifoldBooleanMs(1_000_000, 3000)).toBe(3250);
    const slower = updateManifoldBooleanRate(100_000, 250 + 1000, DEFAULT_MANIFOLD_BOOLEAN_RATE);
    expect(slower).toBeCloseTo((DEFAULT_MANIFOLD_BOOLEAN_RATE + 10_000) / 2);
    expect(updateManifoldBooleanRate(0, 500, 4000)).toBe(4000);
    expect(updateManifoldBooleanRate(1000, Number.NaN, 4000)).toBe(4000);
    expect(estimateManifoldBooleanMs(1000, Number.NaN)).toBe(estimateManifoldBooleanMs(1000));
  });
});
