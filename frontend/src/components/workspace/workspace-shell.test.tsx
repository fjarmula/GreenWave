import Link from "next/link";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";
it("keeps navigation and map visible while focus mode hides the inspector", () => {
  const html = renderToStaticMarkup(
    <WorkspaceShell
      defaultDetails={false}
      map={<div>Vehicle and route</div>}
      inspector={<button>Stop simulation</button>}
      header={<Link href="/">Home</Link>}
    />,
  );
  expect(html).toContain("data-map-slot");
  expect(html).toContain("Vehicle and route");
  expect(html).toContain("Focus Mode");
  expect(html).toContain('aria-pressed="true"');
  // A mode toggle: "pressed" only; aria-expanded alongside it reads as "pressed, collapsed".
  expect(html).not.toMatch(/aria-label="Focus Mode"[^>]*aria-expanded/);
  expect(html).not.toMatch(/<header[^>]*hidden/);
  expect(html).toContain('inert=""');
  expect(html).toContain("Simulated");
});
it("offers one focus toggle for the labelled inspector", () => {
  const html = renderToStaticMarkup(
    <WorkspaceShell
      map={<div>Map</div>}
      inspector={<button>Stop simulation</button>}
      header={<h1>Simulation</h1>}
    />,
  );
  expect(html).toContain('aria-label="Simulation details"');
  expect(html).toContain("Focus Mode");
  expect(html).toContain('aria-pressed="false"');
  expect(html).not.toContain("Enter Focus");
  expect(html).not.toContain(">Details</span>");
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
  expect(html).toContain('aria-pressed="true"');
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

it("keeps a standalone start action outside the hidden details panel", () => {
  const html = renderToStaticMarkup(
    <WorkspaceShell
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
