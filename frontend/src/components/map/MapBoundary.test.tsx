import { isValidElement } from "react";
import { renderToStaticMarkup } from "@/test-utils/render";
import { expect, it, vi } from "vitest";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { MAP_UNAVAILABLE, MapBoundary } from "@/components/map/MapBoundary";
import { MapContainer } from "@/components/map/MapContainer";

it("shows a map fallback, not a blank page, when the map throws", () => {
  expect(ErrorBoundary.getDerivedStateFromError()).toEqual({ failed: true });
  const boundary = new ErrorBoundary({ fallback: <p>fallback</p>, children: <p>map</p> });
  boundary.state = { failed: true };

  expect(renderToStaticMarkup(<>{boundary.render()}</>)).toBe("<p>fallback</p>");
});

it("names the likely cause in the map fallback", () => {
  expect(MAP_UNAVAILABLE).toBe("Map unavailable — WebGL may be disabled in this browser");
  const element = MapBoundary({ children: <p>map</p> });
  if (!isValidElement<{ fallback: React.ReactNode }>(element)) throw new Error("no element");
  expect(renderToStaticMarkup(<>{element.props.fallback}</>)).toContain(MAP_UNAVAILABLE);
});

it("wraps every map in the boundary, so the panels beside it keep working", () => {
  const element = MapContainer({} as Parameters<typeof MapContainer>[0]);
  expect(isValidElement(element) && element.type).toBe(MapBoundary);
});

it("reports the failure to its owner", () => {
  const onFail = vi.fn();
  new ErrorBoundary({ onFail, fallback: null, children: null }).componentDidCatch();
  expect(onFail).toHaveBeenCalledOnce();
});

// These tests inspect callback props by calling controls directly, outside React rendering.
vi.mock("@/components/language-provider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/language-provider")>();
  return { ...actual, useTranslation: () => ({ language: "en", t: <T,>(value: T) => value }) };
});
