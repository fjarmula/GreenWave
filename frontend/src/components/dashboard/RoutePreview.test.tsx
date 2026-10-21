import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { DashboardMode } from "@/components/dashboard/DashboardHeader";
import { RoutePreview } from "@/components/dashboard/RoutePreview";
import type { MapEndpoint } from "@/components/map/EndpointMarkers";

// MapLibre needs a browser; live HUD panels are covered by their own tests.
vi.mock("@/components/map/MapContainer", () => ({
  MapContainer: ({ live }: { live: boolean }) => <div data-testid="map" data-live={String(live)} />,
}));
vi.mock("@/components/dashboard/VehicleTelemetry", () => ({ VehicleTelemetry: () => null }));
vi.mock("@/components/hud/IntersectionList", () => ({ IntersectionList: () => null }));
vi.mock("@/components/hud/ItsConsole", () => ({ ItsConsole: () => null }));
vi.mock("@/components/hud/KpiHeader", () => ({ KpiHeader: () => null }));
vi.mock("@/components/hud/RunSummary", () => ({ RunSummary: () => null }));

const STATION: MapEndpoint = { label: "JRG-1 Kraków", position: { lat: 50.06, lng: 19.94 } };
const INCIDENT: MapEndpoint = {
  label: "Aleja 29 Listopada 32",
  position: { lat: 50.08, lng: 19.95 },
};
const OTHER_INCIDENT: MapEndpoint = {
  label: "Rynek Główny 1",
  position: { lat: 50.06, lng: 19.94 },
};

function render(mode: DashboardMode, origin: MapEndpoint | null, destination: MapEndpoint | null) {
  return renderToStaticMarkup(
    <RoutePreview
      mode={mode}
      origin={origin}
      destination={destination}
      mapFocusRequest={0}
      map={{
        stations: [],
        selectedVehicleType: "AMBULANCE",
        chosenStationId: null,
        runnerUpIds: [],
        onMapClick: () => {},
      }}
    />,
  );
}

function expectNoFabricatedRoute(markup: string) {
  expect(markup).not.toContain("KRK-ROUTE");
  expect(markup).not.toMatch(/planned/i);
}

describe("RoutePreview setup status", () => {
  it("prompts for an incident before selection", () => {
    const markup = render("setup", null, null);
    expectNoFabricatedRoute(markup);
    expect(markup).toContain("Choose an incident");
    expect(markup).not.toContain("Route computed when simulation starts");
    expect(markup).toContain('role="status"');
  });

  it("says the route is computed at start once both endpoints are selected", () => {
    const markup = render("setup", STATION, INCIDENT);
    expectNoFabricatedRoute(markup);
    expect(markup).toContain("Route computed when simulation starts");
    expect(markup).toContain(INCIDENT.label);
    expect(markup).not.toContain("Choose an incident");
  });

  it("follows a changed incident without stale text", () => {
    const markup = render("setup", STATION, OTHER_INCIDENT);
    expectNoFabricatedRoute(markup);
    expect(markup).toContain("Route computed when simulation starts");
    expect(markup).toContain(OTHER_INCIDENT.label);
    expect(markup).not.toContain(INCIDENT.label);
  });

  it("does not claim a route when no station is available", () => {
    const markup = render("setup", null, INCIDENT);
    expectNoFabricatedRoute(markup);
    expect(markup).not.toContain("Route computed when simulation starts");
    expect(markup).not.toContain("Choose an incident");
  });

  it("omits the setup status in live mode", () => {
    const markup = render("live", STATION, INCIDENT);
    expect(markup).toContain('data-live="true"');
    expect(markup).not.toContain("Choose an incident");
    expect(markup).not.toContain("Route computed when simulation starts");
    expect(markup).not.toContain('role="status"');
  });
});
