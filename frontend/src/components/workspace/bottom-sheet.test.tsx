import { renderToStaticMarkup } from "@/test-utils/render";
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

const renderMinimizable = (snap: "minimized" | "collapsed") =>
  renderToStaticMarkup(
    <BottomSheet
      minimizable
      snap={snap}
      onSnapChange={() => {}}
      label="Driver setup"
      collapsed={
        <>
          <h2 data-sheet-peek>Where’s the incident?</h2>
          <button>Initialize green corridor</button>
        </>
      }
      expanded={<p>Settings</p>}
    />,
  );

it("minimizes to its peek row with everything below it out of reach", () => {
  const html = renderMinimizable("minimized");
  expect(html).toContain('data-snap="minimized"');
  expect(html).toMatch(/class="bottom-sheet-collapsed"[^>]*inert=""/);
  expect(html).toContain('aria-label="Show setup"');
  expect(html).toContain('aria-expanded="false"');
});

it("restores the collapsed card to full reach", () => {
  const html = renderMinimizable("collapsed");
  expect(html).not.toMatch(/class="bottom-sheet-collapsed"[^>]*inert=""/);
  expect(html).toContain('aria-label="Show more"');
});

it("keeps the two-snap labels without minimizable", () => {
  expect(render("collapsed")).toContain('aria-label="Show more"');
  expect(render("expanded")).toContain('aria-label="Show less"');
});

it("can scroll the whole expanded setup without changing live-sheet defaults", () => {
  const html = renderToStaticMarkup(
    <BottomSheet
      snap="expanded"
      onSnapChange={() => {}}
      label="Driver setup"
      scrollContent="all"
      collapsed={<h2>Incident setup</h2>}
      expanded={<p>Station choices</p>}
    />,
  );
  expect(html).toContain('data-scroll="all"');
  expect(html).not.toContain('inert=""');
  expect(render("expanded")).not.toContain('data-scroll="all"');
});
