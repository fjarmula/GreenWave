import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { WorkspaceControls } from "./WorkspaceControls";
const follow = vi.hoisted(() => ({
  hasRoute: true,
  available: true,
  following: false,
  setFollowing: vi.fn(),
}));
vi.mock("@/components/map/follow-context", () => ({ useFollowControl: () => follow }));

it("groups one camera action and dispatch settings in the same toolbar", () => {
  const html = renderToStaticMarkup(
    <WorkspaceControls>
      <button>Dispatch settings</button>
    </WorkspaceControls>,
  );
  expect(html).toContain('class="workspace-run-controls"');
  expect(html.match(/<button/g)).toHaveLength(2);
  expect(html).toContain("Follow vehicle");
  expect(html).toContain("Dispatch settings");
});
it("keeps Show route after the run ends", () => {
  follow.available = false;
  const html = renderToStaticMarkup(<WorkspaceControls />);
  expect(html).toContain("Show route");
  expect(html).not.toContain("Follow vehicle");
});
it("does not render empty setup chrome", () => {
  follow.hasRoute = false;
  expect(renderToStaticMarkup(<WorkspaceControls />)).toBe("");
});
