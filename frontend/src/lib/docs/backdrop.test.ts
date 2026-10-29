import { describe, expect, it } from "vitest";
import { corridor } from "@/lib/home-corridor";
import { crossStreets } from "./backdrop";

describe("crossStreets", () => {
  it("draws one cross street through every corridor signal", () => {
    const segments = crossStreets(corridor).match(/M[^M]+/g) ?? [];
    expect(segments).toHaveLength(corridor.signals.length);
    segments.forEach((segment, index) => {
      const [x1, y1, x2, y2] = segment.slice(1).split(/[L,]/).map(Number);
      const { x, y } = corridor.signals[index];
      // The signal lies on the segment: the two halves point in opposite directions.
      const cross = (x1 - x) * (y2 - y) - (y1 - y) * (x2 - x);
      const dot = (x1 - x) * (x2 - x) + (y1 - y) * (y2 - y);
      const lengths = Math.hypot(x1 - x, y1 - y) * Math.hypot(x2 - x, y2 - y);
      expect(Math.abs(cross) / lengths).toBeLessThan(0.01);
      expect(dot).toBeLessThan(0);
    });
  });
});
