import { describe, expect, it } from "vitest";

import { isCascadeClearing, signalVisual } from "@/lib/signal-visuals";

describe("isCascadeClearing", () => {
  it("is true only for a cascade-triggered CLEARING", () => {
    expect(isCascadeClearing({ state: "CLEARING", is_cascade: true })).toBe(true);
    expect(isCascadeClearing({ state: "CLEARING", is_cascade: false })).toBe(false);
    expect(isCascadeClearing({ state: "PRIORITY_GREEN", is_cascade: true })).toBe(false);
    expect(isCascadeClearing({ state: "RECOVERY", is_cascade: true })).toBe(false);
  });
});

describe("signalVisual", () => {
  it("gives only a priority-green lamp the soft halo", () => {
    for (const state of ["NORMAL", "CLEARING", "PRIORITY_GREEN", "RECOVERY"] as const) {
      expect(signalVisual({ state, is_cascade: false }).halo).toBe(state === "PRIORITY_GREEN");
    }
    expect(signalVisual({ state: "CLEARING", is_cascade: true })).toEqual({
      cascade: true,
      halo: false,
    });
  });
});
