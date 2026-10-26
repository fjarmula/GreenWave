import { describe, expect, it } from "vitest";

import { cartoRequestUrl } from "@/components/map/carto";

describe("CARTO browser credentials", () => {
  it.each([
    "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
    "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/sprite.json",
    "https://basemaps.cartocdn.com/fonts/Open%20Sans/0-255.pbf",
    "https://basemaps.cartocdn.com/tiles/12/2275/1403.pbf",
    "https://a.basemaps.cartocdn.com/tiles/12/2275/1403.pbf",
  ])("authenticates the CARTO resource %s", (url) => {
    expect(new URL(cartoRequestUrl(url, "browser-key")).searchParams.get("key")).toBe(
      "browser-key",
    );
  });

  it("preserves query parameters and replaces an old key", () => {
    expect(cartoRequestUrl("https://basemaps.cartocdn.com/tile.pbf?foo=bar&key=old", "a+b&c")).toBe(
      "https://basemaps.cartocdn.com/tile.pbf?foo=bar&key=a%2Bb%26c",
    );
  });

  it.each([
    "https://example.com/tile.pbf",
    "https://basemaps.cartocdn.com.example.com/tile.pbf",
    "https://evilbasemaps.cartocdn.com/tile.pbf",
    "http://basemaps.cartocdn.com/tile.pbf",
    "/api/v1/health",
    "blob:https://example.com/123",
  ])("never sends the key to an unrelated or insecure resource %s", (url) => {
    expect(cartoRequestUrl(url, "browser-key")).toBe(url);
  });

  it("keeps unconfigured local development requests unchanged", () => {
    const url = "https://basemaps.cartocdn.com/style.json";
    expect(cartoRequestUrl(url, "")).toBe(url);
  });
});
