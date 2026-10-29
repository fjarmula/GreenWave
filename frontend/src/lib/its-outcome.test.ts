import { describe, expect, it } from "vitest";
import { mixedOutcome } from "./its-outcome";

describe("mixedOutcome", () => {
  // Values computed by the backend's greenwave.its.controller.mixed_outcome.
  it.each([
    [0, ["INT-9001"], "NO_RESPONSE"],
    [0, ["INT-9002"], "ACCEPT_DELAYED"],
    [1, ["INT-9001", "INT-9002"], "REJECT"],
    [42, ["INT-9002", "INT-9001"], "NO_RESPONSE"],
    [4294967295, ["INT-9001"], "REJECT"],
    [7, ["INT-0361"], "ACCEPT"],
  ] as const)("matches the backend draw for seed %i and %j", (seed, ids, outcome) => {
    expect(mixedOutcome(seed, ids)).toBe(outcome);
  });

  it("ignores target order and covers every outcome across seeds", () => {
    expect(mixedOutcome(3, ["B", "A"])).toBe(mixedOutcome(3, ["A", "B"]));
    const seen = new Set(Array.from({ length: 64 }, (_, seed) => mixedOutcome(seed, ["INT-1"])));
    expect(seen.size).toBe(4);
  });
});
