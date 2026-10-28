import { renderToStaticMarkup } from "@/test-utils/render";
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
    const html = renderToStaticMarkup(<ResponsiveNavigation current={current} title="Workspace" />);
    expect(html).toContain('aria-label="Workspace navigation"');
    expect(html).not.toContain("page-menu-trigger");
  }
});
it("uses the compact page menu on phones in every mode", () => {
  viewport.phone = true;
  const html = renderToStaticMarkup(
    <ResponsiveNavigation current="/simulation/standard" title="Standard traffic" />,
  );
  expect(html).toContain("page-menu-trigger");
  expect(html).toContain("Standard traffic");
});

it("shows a concise heading without a duplicate subtitle", () => {
  for (const phone of [false, true]) {
    viewport.phone = phone;
    const html = renderToStaticMarkup(
      <ResponsiveNavigation current="/simulation/green-wave" title="Green Wave" />,
    );
    expect(html).not.toContain("/ Setup");
    expect(html).not.toContain("text-muted-foreground");
  }
});

it("announces the desktop page heading without repeating its visible mode label", () => {
  viewport.phone = false;
  const html = renderToStaticMarkup(
    <ResponsiveNavigation current="/simulation/green-wave" title="Green Wave" />,
  );
  expect(html).toContain('<h1 class="sr-only">Green Wave</h1>');
  expect(html).toContain('aria-current="page"');
});
