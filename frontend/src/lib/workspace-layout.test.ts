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
it("leaves room for the floating desktop inspector when details are open", () => {
  expect(mapPadding(1440, 900, true).right).toBeGreaterThanOrEqual(380 + 12);
  expect(mapPadding(1440, 900, false).right).toBeLessThan(380);
});
it("leaves room for the docked phone inspector when details are open", () => {
  const p = mapPadding(390, 844, true);
  expect(p.bottom).toBeGreaterThanOrEqual(0.45 * 844);
  expect(p.top + p.bottom).toBeLessThan(844);
});
