import { describe, expect, it } from "vitest";
import { mapPadding, occluderPadding } from "@/lib/workspace-layout";
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

describe("occluderPadding", () => {
  const desktop = { left: 0, top: 0, right: 1440, bottom: 900 };
  const phone = { left: 0, top: 0, right: 390, bottom: 844 };
  const rect = (left: number, top: number, right: number, bottom: number) => ({
    left,
    top,
    right,
    bottom,
  });

  it("margin only without occluders", () => {
    expect(occluderPadding(desktop, [])).toEqual({ top: 32, bottom: 32, left: 32, right: 32 });
  });

  it("top nav reserves the top", () => {
    const p = occluderPadding(desktop, [rect(16, 16, 560, 110)]);
    expect(p.top).toBe(110 + 32);
    expect(p.left).toBe(32);
  });

  it("right inspector reserves the right", () => {
    expect(occluderPadding(desktop, [rect(1048, 76, 1428, 888)]).right).toBe(1440 - 1048 + 32);
  });

  it("phone sheet reserves the bottom", () => {
    expect(occluderPadding(phone, [rect(0, 690, 390, 844)]).bottom).toBe(154 + 32);
  });

  it("takes the largest reservation per edge", () => {
    const p = occluderPadding(desktop, [rect(16, 16, 560, 110), rect(1200, 16, 1428, 70)]);
    expect(p.top).toBe(142);
  });

  it("ignores empty and off-map rects", () => {
    const p = occluderPadding(desktop, [rect(10, 10, 10, 10), rect(2000, 0, 2100, 50)]);
    expect(p).toEqual({ top: 32, bottom: 32, left: 32, right: 32 });
  });

  it("compares intrusion relative to the axis", () => {
    const p = occluderPadding(phone, [rect(0, 300, 390, 844)]);
    expect(p.left).toBe(32);
    expect(p.bottom).toBeGreaterThan(32);
  });

  it("clamps an oversized occluder", () => {
    const p = occluderPadding(phone, [rect(0, 100, 390, 844)]);
    expect(p.left).toBe(32);
    expect(p.top + p.bottom).toBeLessThanOrEqual(0.6 * 844);
    expect(Object.values(p).every((v) => Number.isFinite(v) && v >= 0)).toBe(true);
  });

  it("measures relative to an offset map", () => {
    const map = { left: 100, top: 50, right: 1540, bottom: 950 };
    expect(occluderPadding(map, [rect(100, 50, 600, 150)]).top).toBe(100 + 32);
  });
});
