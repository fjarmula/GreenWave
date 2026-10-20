import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { Dashboard } from "@/components/dashboard";
import { SimulationProvider } from "@/components/simulation-provider";
import type { SimulationTransport } from "@/lib/config";

const transport = vi.hoisted(() => ({ current: "mock" as SimulationTransport }));

vi.mock("@/lib/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/config")>();
  return {
    ...actual,
    getFrontendConfig: () => ({
      ...actual.parseFrontendConfig({ transport: transport.current }, () => undefined),
    }),
  };
});

// MapLibre needs a browser; the map itself is covered by the browser check.
vi.mock("@/components/map/MapContainer", () => ({
  MapContainer: ({ live }: { live: boolean }) => <div data-testid="map" data-live={String(live)} />,
}));

describe.each(["mock", "backend"] as const)("Dashboard setup markup (%s transport)", (name) => {
  it("matches the recorded markup", async () => {
    transport.current = name;
    const markup = renderToStaticMarkup(
      <SimulationProvider>
        <Dashboard />
      </SimulationProvider>,
    );
    await expect(`${markup}\n`).toMatchFileSnapshot(`./__snapshots__/Dashboard.setup.${name}.html`);
  });
});
