import { expect, it } from "vitest";
import { mapPadding } from "@/lib/workspace-layout";
it.each([
  [0, 0],
  [10, 8],
  [320, 250],
  [1440, 720],
])("keeps padding within %s × %s", (w, h) => {
  const p = mapPadding(w, h);
  expect(p.left + p.right).toBeLessThanOrEqual(w / 2);
  expect(p.top + p.bottom).toBeLessThanOrEqual(h / 2);
  expect(Object.values(p).every((v) => Number.isFinite(v) && v >= 0)).toBe(true);
});
