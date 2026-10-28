import { expect, it } from "vitest";

import { addToStyle } from "@/components/map/style-guard";

it("adds layers to a loaded style", () => {
  let added = false;
  expect(addToStyle(() => (added = true))).toBe(true);
  expect(added).toBe(true);
});

it("skips quietly mid theme swap: the next style.load re-adds", () => {
  expect(
    addToStyle(() => {
      throw new Error("Style is not done loading.");
    }),
  ).toBe(false);
});

it("never hides any other error", () => {
  expect(() =>
    addToStyle(() => {
      throw new Error('There is already a source with ID "route".');
    }),
  ).toThrow("already a source");
});
