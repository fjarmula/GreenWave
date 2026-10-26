import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { BackdropBoundary } from "@/components/workspace/HomeBackdrop";

it("turns a live map crash into a fallback instead of losing the page", () => {
  expect(BackdropBoundary.getDerivedStateFromError()).toEqual({ failed: true });
  const onFail = vi.fn();
  const boundary = new BackdropBoundary({ onFail, fallback: <p>drawing</p>, children: <p>map</p> });
  boundary.state = { failed: true };
  expect(renderToStaticMarkup(<>{boundary.render()}</>)).toBe("<p>drawing</p>");
  boundary.componentDidCatch();
  expect(onFail).toHaveBeenCalledOnce();
});
