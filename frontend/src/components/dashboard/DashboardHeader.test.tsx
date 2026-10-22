import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { DashboardHeader } from "@/components/dashboard/DashboardHeader";
import { initialSimulationState } from "@/lib/simulation-state";

vi.mock("@/components/simulation-provider", () => ({
  useSimulationState: () => initialSimulationState,
}));
vi.mock("@/components/hud/ThemeToggle", () => ({ ThemeToggle: () => null }));

describe("DashboardHeader", () => {
  it.each([
    ["setup", "Dispatch setup", "Live operations"],
    ["live", "Live operations", "Dispatch setup"],
  ] as const)("names the %s view without offering a switch", (mode, shown, hidden) => {
    const markup = renderToStaticMarkup(<DashboardHeader mode={mode} />);

    expect(markup).not.toContain("<button");
    expect(markup).not.toContain('aria-label="Dashboard mode"');
    expect(markup).toContain(shown);
    expect(markup).not.toContain(hidden);
  });
});
