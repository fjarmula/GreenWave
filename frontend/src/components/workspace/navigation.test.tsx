import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { WorkspaceNavigation } from "@/components/workspace/WorkspaceNavigation";
it("names every destination and marks the current page", () => {
  const html = renderToStaticMarkup(<WorkspaceNavigation current="/diagnostics" />);
  expect(html).toContain('aria-label="Workspace navigation"');
  expect(html).toMatch(/<a(?=[^>]*href="\/diagnostics")(?=[^>]*aria-current="page")[^>]*>/);
  for (const name of [
    "Home",
    "Green Wave",
    "Standard traffic",
    "Comparison",
    "Diagnostics",
    "Driver",
  ])
    expect(html).toContain(name);
});
