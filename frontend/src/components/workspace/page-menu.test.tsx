import { renderToStaticMarkup } from "@/test-utils/render";
import { expect, it } from "vitest";
import { PageMenu } from "@/components/workspace/PageMenu";
import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";

it("names the current page and keeps the destinations behind a closed menu", () => {
  const html = renderToStaticMarkup(<PageMenu current="/driver" title="Driver simulation" />);
  expect(html).toMatch(/<button[^>]*aria-expanded="false"/);
  expect(html).toMatch(/class="page-menu[ "][^>]*hidden=""/);
  expect(html.match(/<h1/g)).toHaveLength(1);
  expect(html).toMatch(/<h1[^>]*><button[\s\S]*Driver simulation[\s\S]*<\/button><\/h1>/);
  expect(html.match(/<a /g)).toHaveLength(6);
  expect(html).not.toContain("/ Setup");
});

it("keeps Details available regardless of simulation mode", () => {
  const html = renderToStaticMarkup(
    <WorkspaceShell map={<div />} header={<p>Driver</p>} inspector={<p>Setup</p>} />,
  );
  expect(html).not.toContain("data-compact");
  expect(html).toContain('aria-controls="workspace-inspector"');
});

it("keeps the Details button on the other workspaces", () => {
  const html = renderToStaticMarkup(
    <WorkspaceShell map={<div />} header={<p>Green Wave</p>} inspector={<p>Setup</p>} />,
  );
  expect(html).toContain('aria-controls="workspace-inspector"');
});
