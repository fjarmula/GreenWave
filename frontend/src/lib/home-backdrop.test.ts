import { expect, it } from "vitest";
import { backdropKind, basemapFailed, hasBasemap } from "@/lib/home-backdrop";

it.each([
  [{ hydrated: false, phone: false, webgl: true, failed: false }, "static"],
  [{ hydrated: true, phone: true, webgl: true, failed: false }, "static"],
  [{ hydrated: true, phone: false, webgl: false, failed: false }, "static"],
  [{ hydrated: true, phone: false, webgl: true, failed: true }, "static"],
  [{ hydrated: true, phone: false, webgl: true, failed: false }, "live"],
] as const)("%o → %s", (input, kind) => {
  expect(backdropKind(input)).toBe(kind);
});

it("counts only a real basemap source as loaded, not the ground or our own layers", () => {
  expect(hasBasemap([])).toBe(false);
  expect(hasBasemap(["home-route", "home-vehicle"])).toBe(false);
  expect(hasBasemap(["carto", "home-route"])).toBe(true);
});

it("fails the live map when the basemap or its tiles never arrived", () => {
  expect(basemapFailed({ sourceIds: ["carto"], tilesLoaded: true })).toBe(false);
  expect(basemapFailed({ sourceIds: ["carto"], tilesLoaded: false })).toBe(true);
  expect(basemapFailed({ sourceIds: ["home-route"], tilesLoaded: true })).toBe(true);
});
