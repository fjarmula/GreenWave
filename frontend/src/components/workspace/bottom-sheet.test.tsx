import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { BottomSheet } from "./BottomSheet";

const render = (snap: "collapsed" | "expanded") =>
  renderToStaticMarkup(
    <BottomSheet
      snap={snap}
      onSnapChange={() => {}}
      label="Driver"
      collapsed={<p>Speed</p>}
      expanded={<p>Route signals</p>}
    />,
  );

it("is a collapsed sheet whose details are inert", () => {
  const html = render("collapsed");
  expect(html).toContain('aria-expanded="false"');
  expect(html).toMatch(/<div[^>]*id="([^"]+)"[^>]*inert=""/);
  const controls = html.match(/aria-controls="([^"]+)"/)?.[1];
  expect(controls).toBeTruthy();
  expect(html).toContain(`id="${controls}"`);
  expect(html).toContain("Speed");
  expect(html).toContain("Route signals");
});

it("exposes the details once expanded", () => {
  const html = render("expanded");
  expect(html).toContain('aria-expanded="true"');
  expect(html).not.toContain('inert=""');
  expect(html).toContain('data-snap="expanded"');
});
