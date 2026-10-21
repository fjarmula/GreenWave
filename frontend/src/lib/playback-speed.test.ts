import { expect, it } from "vitest";
import { PLAYBACK_SPEEDS, tickIntervalMilliseconds } from "@/lib/playback-speed";

it("exports the D9 playback-speed options in selector order", () => {
  expect(PLAYBACK_SPEEDS).toEqual([1, 2, 5, 10]);
});

it.each([
  [1, 1000],
  [2, 500],
  [5, 200],
  [10, 100],
] as const)("at %s× streams one simulated second every %s ms", (speed, milliseconds) => {
  expect(tickIntervalMilliseconds(speed)).toBe(milliseconds);
});
