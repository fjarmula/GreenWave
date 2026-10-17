import { describe, expect, it } from "vitest";

import { isCascadeClearing } from "@/lib/signal-visuals";

describe("isCascadeClearing", () => {
  it("is true only for a cascade-triggered CLEARING", () => {
    expect(isCascadeClearing({ state: "CLEARING", is_cascade: true })).toBe(true);
    expect(isCascadeClearing({ state: "CLEARING", is_cascade: false })).toBe(false);
    expect(isCascadeClearing({ state: "PRIORITY_GREEN", is_cascade: true })).toBe(false);
    expect(isCascadeClearing({ state: "RECOVERY", is_cascade: true })).toBe(false);
  });
});
