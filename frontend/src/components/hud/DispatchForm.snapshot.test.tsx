import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { PreflightEstimate } from "@/components/hud/dispatch/PreflightEstimate";
import { DispatchForm } from "@/components/hud/DispatchForm";
import type { SimulationTransport } from "@/lib/config";
import type { IncidentDispatch } from "@/lib/useIncidentDispatch";
import type { DispatchRankResponse } from "@/types/telemetry";

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

const RANKING: DispatchRankResponse = {
  schema_version: "1.0",
  incident_snapped: { position: { lat: 50.0617, lng: 19.9373 }, snap_distance_m: 3 },
  candidates: [
    {
      station: {
        station_id: "STN-F-0011",
        vehicle_type: "FIRE_TRUCK",
        source_kind: "fire_state",
        name: "JRG PSP nr 1",
        position: { lat: 50.05, lng: 19.95 },
      },
      greenwave_seconds: 309,
      distance_m: 3290,
    },
  ],
  station_at_incident: null,
};

function dispatchState(patch: Partial<IncidentDispatch> = {}): IncidentDispatch {
  return {
    vehicleType: "FIRE_TRUCK",
    incident: {
      position: { lat: 50.0617, lng: 19.9373 },
      label: "Rynek Główny 1",
      source: "address",
    },
    ranking: RANKING,
    rankStatus: "ready",
    rankError: null,
    setVehicleType: () => undefined,
    setIncident: () => undefined,
    ...patch,
  };
}

function render(dispatch: IncidentDispatch, roadTimeRanking = true) {
  return renderToStaticMarkup(
    <DispatchForm
      onInitialize={() => undefined}
      pending={false}
      errorMessage={null}
      dispatch={dispatch}
      capabilities={{ geocode: roadTimeRanking, roadTimeRanking }}
      geocode={async () => []}
      onFocusMap={() => undefined}
    />,
  );
}

const startButton = (markup: string) =>
  markup.match(/<button[^>]*data-testid="start-corridor"[^>]*>/)?.[0] ?? "";

describe.each(["mock", "backend"] as const)("DispatchForm markup (%s transport)", (name) => {
  it("matches the recorded markup", async () => {
    transport.current = name;
    const markup = renderToStaticMarkup(
      <DispatchForm
        onInitialize={() => undefined}
        pending={false}
        errorMessage="Simulation backend unreachable"
        dispatch={dispatchState()}
        capabilities={{ geocode: name === "backend", roadTimeRanking: name === "backend" }}
        geocode={async () => []}
        onFocusMap={() => undefined}
      />,
    );
    // Trailing newline: the end-of-file-fixer hook adds one to the recorded file.
    await expect(`${markup}\n`).toMatchFileSnapshot(`./__snapshots__/DispatchForm.${name}.html`);
  });
});

describe("DispatchForm start button", () => {
  it.each([
    ["idle", dispatchState({ incident: null, ranking: null, rankStatus: "idle" })],
    ["loading", dispatchState({ ranking: null, rankStatus: "loading" })],
    ["error", dispatchState({ ranking: null, rankStatus: "error", rankError: "x" })],
  ])("is disabled while the ranking is %s", (_name, dispatch) => {
    expect(startButton(render(dispatch))).toMatch(/ disabled=""/);
  });

  it("is enabled once a ranking is ready", () => {
    expect(startButton(render(dispatchState()))).not.toMatch(/ disabled=""/);
  });

  it("stays enabled when a station sits at the incident and others exist", () => {
    const dispatch = dispatchState({
      ranking: {
        ...RANKING,
        station_at_incident: { ...RANKING.candidates[0].station, station_id: "STN-F-0001" },
      },
    });
    expect(startButton(render(dispatch))).not.toMatch(/ disabled=""/);
  });

  it("offers the three vehicle types", () => {
    const markup = render(dispatchState());
    for (const label of ["Ambulance", "Fire", "Police"]) expect(markup).toContain(label);
    expect(markup).toMatch(/aria-pressed="true"[^>]*>[^<]*Fire/);
  });
});

const preflight = (markup: string) => markup.slice(markup.indexOf("pre-flight estimation"));
const referenceIncident = { lat: (5400 / 6_371_000) * (180 / Math.PI), lng: 0 };
const nearIncident = { lat: referenceIncident.lat / 2, lng: 0 };
const referenceRanking: DispatchRankResponse = {
  ...RANKING,
  candidates: [
    {
      ...RANKING.candidates[0],
      station: { ...RANKING.candidates[0].station, position: { lat: 0, lng: 0 } },
    },
  ],
};

describe("mock preflight estimates", () => {
  it.each([
    { incident: null, ranking: null, rankStatus: "idle" as const },
    { ranking: null, rankStatus: "loading" as const },
    { ranking: RANKING, rankStatus: "loading" as const },
  ])("withholds times and percentage before both endpoints are ready (%j)", (patch) => {
    transport.current = "mock";
    const markup = preflight(render(dispatchState(patch), false));
    expect(markup).toContain("Select an incident");
    expect(markup).not.toContain("TIME SAVED");
    expect(markup).not.toContain("Standard time");
    expect(markup).not.toContain("13m 00s");
  });

  it("changes estimates when the incident or selected vehicle station changes", () => {
    transport.current = "mock";
    const far = preflight(
      render(
        dispatchState({
          ranking: referenceRanking,
          incident: { position: referenceIncident, label: "Far", source: "map" },
        }),
        false,
      ),
    );
    const near = preflight(
      render(
        dispatchState({
          ranking: referenceRanking,
          incident: { position: nearIncident, label: "Near", source: "map" },
        }),
        false,
      ),
    );
    const otherStation = preflight(
      render(
        dispatchState({
          vehicleType: "AMBULANCE",
          ranking: {
            ...referenceRanking,
            candidates: [
              {
                ...referenceRanking.candidates[0],
                station: {
                  ...referenceRanking.candidates[0].station,
                  vehicle_type: "AMBULANCE",
                  position: nearIncident,
                },
              },
            ],
          },
          incident: { position: referenceIncident, label: "Far", source: "map" },
        }),
        false,
      ),
    );
    expect(far).toContain("13m 00s");
    expect(far).toContain("06m 20s");
    expect(near).toContain("06m 30s");
    expect(near).toContain("03m 10s");
    expect(otherStation).toContain("06m 30s");
    expect(otherStation).toContain("03m 10s");
    expect(far).toContain("Approximate (mock)");
    expect(far).toContain("straight line");
  });

  it("recomputes normal time with density while retaining the GreenWave baseline", () => {
    const markup = renderToStaticMarkup(
      <PreflightEstimate
        isMockTransport
        trafficDensity={3}
        origin={{ lat: 0, lng: 0 }}
        incident={nearIncident}
      />,
    );
    expect(markup).toContain("13m 00s");
    expect(markup).toContain("03m 10s");
  });

  it("keeps backend estimates after start without mock claims", () => {
    transport.current = "backend";
    const markup = render(dispatchState());
    expect(markup).toContain("AFTER START");
    expect(markup).not.toContain("TIME SAVED");
    expect(markup).not.toContain("Mock pre-flight");
  });
});
