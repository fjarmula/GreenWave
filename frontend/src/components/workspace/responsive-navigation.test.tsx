import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { ResponsiveNavigation } from "./ResponsiveNavigation";
const viewport = vi.hoisted(() => ({ phone: false }));
vi.mock("@/lib/useIsPhone", () => ({ useIsPhone: () => viewport.phone }));
it("uses standard desktop navigation in every mode", () => {
  for (const current of [
    "/driver",
    "/compare",
    "/simulation/green-wave",
    "/simulation/standard",
    "/diagnostics",
    "/",
  ]) {
    viewport.phone = false;
    const html = renderToStaticMarkup(
      <ResponsiveNavigation current={current} title="Workspace" detail="Setup" />,
    );
    expect(html).toContain('aria-label="Workspace navigation"');
    expect(html).not.toContain("page-menu-trigger");
  }
});
it("uses the compact page menu on phones in every mode", () => {
  viewport.phone = true;
  const html = renderToStaticMarkup(
    <ResponsiveNavigation current="/simulation/standard" title="Standard traffic" detail="Setup" />,
  );
  expect(html).toContain("page-menu-trigger");
  expect(html).toContain("Standard traffic");
});
