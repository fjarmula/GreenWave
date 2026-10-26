import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DriverSetupCard, DriverSetupDetails } from "./DriverSetupSheet";
import { DispatchSettingsChip } from "./DispatchSettingsChip";
import { FinishedRunSummary } from "@/components/hud/RunSummary";
import { ComparisonResultCard } from "@/components/comparison/ComparisonResultCard";
import { completed, request, route } from "@/lib/comparison/fixtures.test-support";
import { DEFAULT_DISPATCH_SETTINGS } from "@/lib/start-request";
import { settingsSummary } from "@/lib/driver-presentation";
import { initialSimulationState, type SimulationState } from "@/lib/simulation-state";
import type { IncidentDispatch } from "@/lib/useIncidentDispatch";
const dispatch: IncidentDispatch = {
  vehicleType: "AMBULANCE",
  incident: null,
  trafficDensity: 1,
  ranking: null,
  rankStatus: "idle",
  rankError: null,
  selectedStationId: null,
  setVehicleType: () => {},
  setIncident: () => {},
  setTrafficDensity: () => {},
  selectStation: () => {},
};
const settings = { ...DEFAULT_DISPATCH_SETTINGS, itsScenario: "REJECTED" as const };
const leg = { access_point: { lat: 50, lng: 20 }, distance_m: 420, seconds: 300 };
const offroad = { ...route(), destination_on_foot: leg };
const member = (seconds: number): SimulationState => ({
  ...initialSimulationState,
  simulationState: "FINISHED",
  completion: completed(seconds),
  routeData: offroad,
});
describe("dispatch scenario visibility", () => {
  it.each(["ENABLED", "DISABLED"] as const)("shows the effective scenario in %s setup", (mode) => {
    const effective = { ...settings, greenWaveMode: mode };
    const html = renderToStaticMarkup(
      <DriverSetupDetails
        dispatch={dispatch}
        capabilities={{ geocode: false, roadTimeRanking: false }}
        settings={effective}
        onSettingsChange={() => {}}
        stationsError={null}
        onFocusMap={() => {}}
      />,
    );
    expect(html).toContain('aria-label="Simulated ITS feedback"');
    const its = html.match(
      /<div role="radiogroup" aria-label="Simulated ITS feedback".*?<\/div>/,
    )?.[0];
    const checked = its?.match(/<button[^>]*aria-checked="true"[^>]*>.*?<\/button>/)?.[0];
    expect(checked).toContain(mode === "DISABLED" ? "Nominal" : "Rejected");
    expect(its?.includes('disabled=""')).toBe(mode === "DISABLED");
    expect(settingsSummary(effective)).toContain(
      mode === "DISABLED" ? "ITS Nominal" : "ITS Rejected",
    );
  });
  it.each(["ENABLED", "DISABLED"] as const)("discloses %s active feedback", (mode) => {
    const html = renderToStaticMarkup(
      <DispatchSettingsChip
        request={{ ...request, green_wave_mode: mode, its_scenario: "REJECTED" }}
      />,
    );
    expect(html).toContain("Simulated ITS feedback");
    expect(html).toContain(mode === "DISABLED" ? "Nominal" : "Rejected");
  });
});
describe("off-road completed summaries", () => {
  it("distinguishes the completed drive and the estimated walk", () => {
    const html = renderToStaticMarkup(
      <FinishedRunSummary route={offroad} completion={completed(120)} onBackToSetup={() => {}} />,
    );
    expect(html).toContain("Drive to access point");
    expect(html).not.toContain("Total travel time");
    expect(html).toContain("On foot to incident (estimate)");
    expect(html).toContain("420 m");
    expect(html).toContain("05m 00s");
    expect(html).toContain("02m 00s");
  });
  it("keeps comparison savings as the drive difference and shows each completed walk", () => {
    const html = renderToStaticMarkup(
      <ComparisonResultCard
        state={{
          status: "finished",
          runs: { ENABLED: member(120), DISABLED: member(165) },
          priorityIds: [],
          reason: null,
          stopping: false,
        }}
        onReset={() => {}}
      />,
    );
    expect(html).toContain("Actual drive-time difference");
    expect(html).toContain("00m 45s");
    expect(html.match(/Drive to access point/g)).toHaveLength(2);
    expect(html.match(/420 m/g)).toHaveLength(2);
    expect(html.match(/05m 00s/g)).toHaveLength(2);
  });
  it("does not present a stopped member as a completed drive or walk", () => {
    const stopped = {
      ...member(165),
      simulationState: "CANCELLED" as const,
      completion: null,
      cancelReason: "STOPPED" as const,
    };
    const html = renderToStaticMarkup(
      <ComparisonResultCard
        state={{
          status: "finished",
          runs: { ENABLED: member(120), DISABLED: stopped },
          priorityIds: [],
          reason: null,
          stopping: false,
        }}
        onReset={() => {}}
      />,
    );
    expect(html).toContain("Stopped");
    expect(html).not.toContain("Actual drive-time difference");
    expect(html.match(/Drive to access point/g)).toHaveLength(1);
  });
});

it("shows the configured comparison feedback after visiting standard traffic", () => {
  const html = renderToStaticMarkup(
    <DriverSetupCard
      intent="comparison"
      dispatch={dispatch}
      capabilities={{ geocode: false, roadTimeRanking: false }}
      geocode={async () => []}
      settings={{ ...settings, greenWaveMode: "DISABLED" }}
      detailsOpen={false}
      onToggleDetails={() => {}}
      pending={false}
      replacement={false}
      errorMessage={null}
      onInitialize={() => {}}
    />,
  );
  expect(html).toContain("ITS Rejected");
});
