import Link from "next/link";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";
it("keeps map content while focused controls are absent from interaction", () => {
  const html = renderToStaticMarkup(
    <WorkspaceShell
      defaultFocus
      map={<div>Vehicle and route</div>}
      inspector={<button>Stop simulation</button>}
      header={<Link href="/">Home</Link>}
    />,
  );
  expect(html).toContain("data-map-slot");
  expect(html).toContain("Vehicle and route");
  expect(html).toContain("Exit Focus");
  expect(html).toContain('inert=""');
  expect(html).toContain("Simulated");
});
it("offers a labelled bounded inspector and focus on entry", () => {
  const html = renderToStaticMarkup(
    <WorkspaceShell
      map={<div>Map</div>}
      inspector={<button>Stop simulation</button>}
      header={<h1>Simulation</h1>}
    />,
  );
  expect(html).toContain('aria-label="Simulation details"');
  expect(html).toContain("Enter Focus");
  expect(html).toContain("Stop simulation");
});
it("can open replay with full-width maps and an initially closed inspector", () => {
  const html = renderToStaticMarkup(
    <WorkspaceShell
      defaultDetails={false}
      map={<div>Both maps</div>}
      inspector={<p>Results</p>}
      header={<h1>Comparison</h1>}
    />,
  );
  expect(html).toContain('data-details="false"');
  expect(html).toContain('aria-expanded="false"');
  expect(html).toContain("Both maps");
});
it("renders the map slot beneath floating header and inspector", () => {
  const html = renderToStaticMarkup(
    <WorkspaceShell map={<div>Map</div>} inspector={<p>Details</p>} header={<h1>Green Wave</h1>} />,
  );
  expect(html).toContain('data-layout="map-first"');
  const slot = html.indexOf("data-map-slot");
  expect(slot).toBeGreaterThan(-1);
  expect(slot).toBeLessThan(html.indexOf("<header"));
  expect(slot).toBeLessThan(html.indexOf('aria-label="Simulation details"'));
  expect(html).toMatch(/class="workspace-inspector surface-glass"/);
});
it("renders the shared header with map variant", () => {
  const html = renderToStaticMarkup(
    <WorkspaceShell map={<div>Map</div>} header={<h1>Simulation</h1>} />,
  );
  expect(html).toContain('data-variant="map"');
  expect(html).toContain('class="workspace-actions"');
});

it("uses the full inspector on desktop regardless of phone sheet state", () => {
  const html = renderToStaticMarkup(
    <WorkspaceShell
      map={<div />}
      header={<h1>Driver</h1>}
      inspector={<p>Desktop dispatch form</p>}
      sheet={{
        snap: "minimized",
        minimizable: true,
        onSnapChange: () => {},
        collapsed: <p>Phone card</p>,
        expanded: <p>Phone details</p>,
      }}
    />,
  );
  expect(html).toContain("Desktop dispatch form");
  expect(html).not.toContain("Phone card");
  expect(html).not.toContain("sheet-pill");
});

it("keeps a standalone start action outside hidden details and focus chrome", () => {
  const html = renderToStaticMarkup(
    <WorkspaceShell
      defaultFocus
      defaultDetails={false}
      map={<div />}
      header={<h1>Green Wave</h1>}
      inspector={<p>Settings</p>}
      primaryAction={<button>Initialize corridor</button>}
    />,
  );
  expect(html).toMatch(/class="workspace-primary-action"[^>]*><button>Initialize corridor/);
  expect(html).toMatch(/aria-label="ER–GreenWave home"/);
});
