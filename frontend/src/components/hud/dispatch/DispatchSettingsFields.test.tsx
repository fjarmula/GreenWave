import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DispatchSettingsFields } from "@/components/hud/dispatch/DispatchSettingsFields";
import { DEFAULT_DISPATCH_SETTINGS } from "@/lib/start-request";
import type { IncidentDispatch } from "@/lib/useIncidentDispatch";
import { RESOURCES } from "@/lib/transport/__fixtures__/team-dispatch";
import type { DispatchRankResponse } from "@/types/telemetry";

const RANKING: DispatchRankResponse = {
  schema_version: "1.0",
  incident_snapped: { position: { lat: 50.0617, lng: 19.9373 }, snap_distance_m: 3 },
  candidates: [
    {
      station: {
        station_id: "STN-A-0001",
        vehicle_type: "AMBULANCE",
        source_kind: "prm_base",
        name: "Baza ZRM",
        position: { lat: 50.05, lng: 19.95 },
      },
      greenwave_seconds: 309,
      standard_seconds: 372,
      distance_m: 3290,
      on_site: false,
    },
  ],
  scenario_time: "2026-10-27T12:00:00",
  outcome: "OK",
  incident_area: null,
  excluded_teams: [],
  roster: null,
  area_rule: null,
};

const dispatch: IncidentDispatch = {
  vehicleType: "AMBULANCE",
  incident: {
    position: { lat: 50.0617, lng: 19.9373 },
    label: "Rynek Główny 1",
    source: "address",
  },
  trafficDensity: 1,
  ranking: RANKING,
  rankStatus: "ready",
  rankError: null,
  selectedStationId: null,
  scenarioTime: "2026-10-27T12:00",
  availability: {},
  resourceAware: true,
  rankTimeMode: "ENABLED",
  resources: RESOURCES,
  setVehicleType: () => {},
  setIncident: () => {},
  setTrafficDensity: () => {},
  selectStation: () => {},
  setScenarioTime: () => {},
  setTeamAvailability: () => {},
  setResourceAware: () => {},
  setRankTimeMode: () => {},
};

// One marker per control, in the order both layouts must show them.
const CONTROLS = [
  'aria-label="Team-aware dispatch"',
  'id="scenario-time"',
  "Dispatch from",
  "Team availability",
  "View station and incident",
  'id="traffic-density"',
  "Green Wave enabled",
  'aria-label="Simulated ITS feedback"',
  'aria-label="Cascade corridor mode"',
  'id="playback-speed-label"',
  "Times are model estimates",
  "lucide-shield-check",
];

const render = (layout: "panel" | "sheet") =>
  renderToStaticMarkup(
    <DispatchSettingsFields
      layout={layout}
      dispatch={dispatch}
      settings={DEFAULT_DISPATCH_SETTINGS}
      onSettingsChange={() => {}}
      modeLocked
      capabilities={{ geocode: true, roadTimeRanking: true, resources: true }}
      stationsError={null}
      onFocusMap={() => {}}
    />,
  );

describe("DispatchSettingsFields", () => {
  it.each(["panel", "sheet"] as const)(
    "renders every control in the shared order (%s)",
    (layout) => {
      const html = render(layout);
      const positions = CONTROLS.map((marker) => html.indexOf(marker));
      expect(CONTROLS.filter((_, i) => positions[i] < 0)).toEqual([]);
      expect(positions).toEqual([...positions].sort((a, b) => a - b));
    },
  );

  it("keeps the traffic model heading on the desktop panel only", () => {
    expect(render("panel")).toContain("Traffic model");
    expect(render("sheet")).not.toContain("Traffic model");
  });
});
