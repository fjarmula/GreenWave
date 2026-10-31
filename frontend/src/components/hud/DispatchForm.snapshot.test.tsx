import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "@/test-utils/render";
import { describe, expect, it, vi } from "vitest";

import { CascadeToggle } from "@/components/hud/dispatch/CascadeToggle";
import { GreenWaveToggle } from "@/components/hud/dispatch/GreenWaveToggle";
import { PlaybackSpeedSelector } from "@/components/hud/dispatch/PlaybackSpeedSelector";
import { PreflightEstimate } from "@/components/hud/dispatch/PreflightEstimate";
import { TrafficDensityControl } from "@/components/hud/dispatch/TrafficDensityControl";
import { DispatchSettingsFields } from "@/components/hud/dispatch/DispatchSettingsFields";
import { DispatchStartButton } from "@/components/hud/dispatch/DispatchStartButton";
import { DispatchForm } from "@/components/hud/DispatchForm";
import type { SimulationTransport } from "@/lib/config";
import type { PreviousRun } from "@/lib/previous-run";
import { DEFAULT_DISPATCH_SETTINGS, type DispatchSettings } from "@/lib/start-request";
import type { IncidentDispatch } from "@/lib/useIncidentDispatch";
import type { DispatchRankResponse } from "@/types/telemetry";
import { RESOURCES } from "@/lib/transport/__fixtures__/team-dispatch";

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

function dispatchState(patch: Partial<IncidentDispatch> = {}): IncidentDispatch {
  return {
    vehicleType: "FIRE_TRUCK",
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
    resources: null,
    setVehicleType: () => undefined,
    setIncident: () => undefined,
    setTrafficDensity: () => undefined,
    selectStation: () => {},
    setScenarioTime: () => undefined,
    setTeamAvailability: () => undefined,
    setResourceAware: () => undefined,
    setRankTimeMode: () => undefined,
    ...patch,
  };
}

function render(
  dispatch: IncidentDispatch,
  roadTimeRanking = true,
  settings: DispatchSettings = DEFAULT_DISPATCH_SETTINGS,
  resources = false,
) {
  return renderToStaticMarkup(
    <DispatchForm
      settings={settings}
      onSettingsChange={() => undefined}
      dispatch={dispatch}
      capabilities={{ geocode: roadTimeRanking, roadTimeRanking, resources }}
      geocode={async () => []}
      onFocusMap={() => undefined}
    />,
  );
}

const fullStartButton = (markup: string) =>
  markup.match(/<button[^>]*data-testid="start-corridor"[^>]*>[\s\S]*?<\/button>/)?.[0] ?? "";

const startButton = (markup: string) =>
  markup.match(/<button[^>]*data-testid="start-corridor"[^>]*>/)?.[0] ?? "";

describe.each(["mock", "backend"] as const)("DispatchForm markup (%s transport)", (name) => {
  it("matches the recorded markup", async () => {
    transport.current = name;
    const markup = renderToStaticMarkup(
      <DispatchForm
        settings={DEFAULT_DISPATCH_SETTINGS}
        onSettingsChange={() => undefined}
        dispatch={dispatchState()}
        capabilities={{
          geocode: name === "backend",
          roadTimeRanking: name === "backend",
          resources: false,
        }}
        geocode={async () => []}
        onFocusMap={() => undefined}
      />,
    );
    // Trailing newline: the end-of-file-fixer hook adds one to the recorded file.
    await expect(`${markup}\n`).toMatchFileSnapshot(`./__snapshots__/DispatchForm.${name}.html`);
  });
});

const renderStart = (dispatch: IncidentDispatch) =>
  renderToStaticMarkup(
    <DispatchStartButton
      dispatch={dispatch}
      settings={DEFAULT_DISPATCH_SETTINGS}
      pending={false}
      onInitialize={() => undefined}
    />,
  );

describe("DispatchStartButton readiness", () => {
  it.each([
    ["idle", dispatchState({ incident: null, ranking: null, rankStatus: "idle" })],
    ["loading", dispatchState({ ranking: null, rankStatus: "loading" })],
    ["error", dispatchState({ ranking: null, rankStatus: "error", rankError: "x" })],
  ])("is disabled while the ranking is %s", (_name, dispatch) => {
    expect(startButton(renderStart(dispatch))).toMatch(/ disabled=""/);
  });

  it("is enabled once a ranking is ready", () => {
    expect(startButton(renderStart(dispatchState()))).not.toMatch(/ disabled=""/);
  });

  it('labels the start "Dispatch on foot" for an on-site selection', () => {
    const onSite = {
      ...RANKING.candidates[0],
      greenwave_seconds: 0,
      standard_seconds: 0,
      distance_m: 0,
      on_foot: {
        access_point: RANKING.candidates[0].station.position,
        distance_m: 120,
        seconds: 111,
      },
      on_site: true,
    };
    const markup = renderStart(dispatchState({ ranking: { ...RANKING, candidates: [onSite] } }));
    expect(fullStartButton(markup)).toContain("Dispatch on foot");
    expect(startButton(markup)).not.toMatch(/ disabled=""/);
    expect(fullStartButton(renderStart(dispatchState()))).not.toContain("Dispatch on foot");
  });

  it("offers the three vehicle types", () => {
    const markup = render(dispatchState());
    for (const label of ["Ambulance", "Fire", "Police"]) expect(markup).toContain(label);
    expect(markup).toMatch(/aria-pressed="true"[^>]*>[^<]*Fire/);
  });
});

/** The first element of a (hook-free) element tree that matches. */
function findElement(node: ReactNode, matches: (element: ReactElement) => boolean): ReactElement {
  const stack = [node];
  while (stack.length > 0) {
    const next = stack.shift();
    if (Array.isArray(next)) stack.unshift(...next);
    else if (isValidElement<{ children?: ReactNode }>(next)) {
      if (matches(next)) return next;
      stack.unshift(next.props.children);
    }
  }
  throw new Error("element not found");
}

const ofType =
  <P,>(type: (props: P) => ReactNode) =>
  (element: ReactElement) =>
    element.type === type;

function propsOf<P>(tree: ReactNode, type: (props: P) => ReactNode): P {
  return findElement(tree, ofType(type)).props as P;
}

const CHOSEN: DispatchSettings = {
  trafficDensity: 2,
  cascadeEnabled: false,
  playbackSpeed: 10,
  greenWaveMode: "DISABLED",
};

function formProps(
  settings: DispatchSettings,
  onSettingsChange: (settings: DispatchSettings) => void = () => undefined,
): Parameters<typeof DispatchForm>[0] {
  return {
    settings,
    onSettingsChange,
    dispatch: dispatchState(),
    capabilities: { geocode: true, roadTimeRanking: true, resources: false },
    geocode: async () => [],
    onFocusMap: () => undefined,
  };
}

// The settings controls live in the shared fields; their element tree is hook-free.
const formTree = (...args: Parameters<typeof formProps>) =>
  DispatchSettingsFields({ ...formProps(...args), layout: "panel" });

describe("DispatchForm station list failure", () => {
  it("says so in the ranking area", () => {
    const markup = renderToStaticMarkup(
      <DispatchForm
        {...formProps(DEFAULT_DISPATCH_SETTINGS)}
        stationsError="Station list unavailable — check the backend"
      />,
    );
    const alert = markup.indexOf("Station list unavailable — check the backend");

    expect(markup).toMatch(/role="alert"[^>]*>.*Station list unavailable — check the backend/);
    expect(alert).toBeGreaterThan(markup.indexOf("Dispatching from"));
    expect(alert).toBeLessThan(markup.indexOf("View station and incident"));
  });

  it("shows nothing when the list loaded", () => {
    expect(render(dispatchState())).not.toContain("Station list unavailable");
  });
});

describe("DispatchForm settings", () => {
  it("renders the controls from the settings prop", () => {
    const markup = render(dispatchState(), true, CHOSEN);
    expect(markup).toContain(">2.0x</output>");
    expect(markup).toMatch(/role="radio" aria-checked="true"[^>]*>Disabled</);
    expect(markup).toMatch(/role="radio" aria-checked="true"[^>]*>10×</);
    expect(markup).toMatch(/role="switch" aria-checked="false"[^>]*disabled=""/);
    const start = renderToStaticMarkup(
      <DispatchStartButton
        dispatch={dispatchState()}
        settings={CHOSEN}
        pending={false}
        onInitialize={() => {}}
      />,
    );
    expect(start).toContain("Start standard-traffic run");
  });

  it("reports the full updated settings when a control changes", () => {
    const onSettingsChange = vi.fn<(settings: DispatchSettings) => void>();
    const tree = formTree(CHOSEN, onSettingsChange);

    propsOf(tree, GreenWaveToggle).onChange("ENABLED");
    propsOf(tree, TrafficDensityControl).onChange(2.7);
    propsOf(tree, PlaybackSpeedSelector).onChange(5);
    propsOf(tree, CascadeToggle).onToggle();

    expect(onSettingsChange.mock.calls).toEqual([
      [{ ...CHOSEN, greenWaveMode: "ENABLED" }],
      [{ ...CHOSEN, trafficDensity: 2.7 }],
      [{ ...CHOSEN, playbackSpeed: 5 }],
      [{ ...CHOSEN, cascadeEnabled: true }],
    ]);
  });

  it("keeps the cascade toggle disabled only while ER Green Wave is disabled", () => {
    expect(propsOf(formTree(CHOSEN), CascadeToggle).disabled).toBe(true);
    expect(propsOf(formTree({ ...CHOSEN, greenWaveMode: "ENABLED" }), CascadeToggle).disabled).toBe(
      false,
    );
  });

  it("shows the previous run above the start button only when there is one", () => {
    const previousRun: PreviousRun = {
      greenWaveMode: "ENABLED",
      totalSeconds: 400,
      savedSeconds: 380,
      standardEstimateSeconds: 780,
      stationName: "JRG PSP nr 1",
      incidentLabel: "Rynek Główny 1",
      trafficDensity: 1.5,
    };
    const withRun = renderToStaticMarkup(
      <DispatchForm {...formProps(CHOSEN)} previousRun={previousRun} />,
    );
    const card = withRun.indexOf("Previous simulated run");

    expect(card).toBeGreaterThan(withRun.indexOf("Playback speed"));
    expect(render(dispatchState(), true, CHOSEN)).not.toContain("Previous simulated run");
  });

  it("starts with the settings it was given", () => {
    const onInitialize = vi.fn<(settings: DispatchSettings) => void>();
    const start = findElement(
      DispatchStartButton({
        dispatch: dispatchState(),
        settings: CHOSEN,
        pending: false,
        onInitialize,
      }),
      (element) =>
        (element.props as { "data-testid"?: string })["data-testid"] === "start-corridor",
    );
    (start.props as { onClick: () => void }).onClick();
    expect(onInitialize).toHaveBeenCalledExactlyOnceWith(CHOSEN);
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
    expect(far).toContain("06m 50s");
    expect(far).toContain("06m 20s");
    expect(near).toContain("03m 25s");
    expect(near).toContain("03m 10s");
    expect(otherStation).toContain("03m 25s");
    expect(otherStation).toContain("03m 10s");
    expect(far).toContain("Approximate (mock)");
    expect(far).toContain("straight line");
  });

  it("uses the capped standard crossing time at high density", () => {
    const markup = renderToStaticMarkup(
      <PreflightEstimate
        isMockTransport
        trafficDensity={3}
        origin={{ lat: 0, lng: 0 }}
        incident={nearIncident}
      />,
    );
    expect(markup).toContain("03m 25s");
    expect(markup).toContain("03m 10s");
  });

  it("shows only the walk for an on-site pick, with no simulated runs", () => {
    const station = RANKING.candidates[0].station;
    const markup = renderToStaticMarkup(
      <PreflightEstimate
        isMockTransport={false}
        trafficDensity={1}
        origin={null}
        incident={null}
        candidate={{
          ...RANKING.candidates[0],
          greenwave_seconds: 0,
          standard_seconds: 0,
          distance_m: 0,
          on_foot: { access_point: station.position, distance_m: 60, seconds: 45 },
          on_site: true,
        }}
      />,
    );
    expect(markup).toContain("On site · no drive · on foot about 00m 45s (60 m)");
    for (const absent of ["Simulated runs", "Standard time", "GreenWave time", "TIME SAVED"])
      expect(markup).not.toContain(absent);
  });

  it("shows no time saved when the standard run is the shorter one", () => {
    const candidate = { ...RANKING.candidates[0], standard_seconds: 220, greenwave_seconds: 246 };
    const markup = renderToStaticMarkup(
      <PreflightEstimate
        isMockTransport={false}
        trafficDensity={1}
        origin={null}
        incident={null}
        candidate={candidate}
      />,
    );
    expect(markup).toContain("NO TIME SAVED");
    expect(markup).toContain("+00m 26s");
    expect(markup).not.toMatch(/−-|m -|% TIME SAVED/);
    expect(markup).not.toContain('text-go"><svg');
  });

  it("shows backend standard and green-wave estimates before start", () => {
    transport.current = "backend";
    const markup = render(dispatchState());
    expect(markup).not.toContain("AFTER START");
    expect(markup).not.toContain("Mock pre-flight");
    const preflight = markup.slice(markup.indexOf("Pre-flight estimation"));
    expect(preflight).toContain("06m 12s"); // standard_seconds 372
    expect(preflight).toContain("05m 09s"); // greenwave_seconds 309
    expect(preflight).toContain("−01m 03s");
  });
});

it("uses the shared dispatch controls to configure both comparison modes", () => {
  const props = { ...formProps(CHOSEN), intent: "comparison" as const };
  const tree = DispatchSettingsFields({ ...props, layout: "panel" });
  const html = renderToStaticMarkup(<DispatchForm {...props} />);
  expect(
    renderToStaticMarkup(
      <DispatchStartButton
        dispatch={dispatchState()}
        settings={CHOSEN}
        pending={false}
        intent="comparison"
        onInitialize={() => {}}
      />,
    ),
  ).toContain("Start comparison");
  expect(html).toContain("Green Wave and standard traffic");
  expect(html).not.toContain('aria-label="ER Green Wave mode"');
  expect(propsOf(tree, CascadeToggle).disabled).toBe(false);
  // Live comparison: no replay, the runs play at the chosen playback speed.
  expect(propsOf(tree, PlaybackSpeedSelector).label).toBeUndefined();
  expect(html).toContain("one simulated clock");
  expect(html).not.toContain("Replay");
});

it("labels the start as blocked, not busy, while a comparison runs", () => {
  const markup = renderToStaticMarkup(
    <DispatchStartButton
      dispatch={dispatchState()}
      settings={DEFAULT_DISPATCH_SETTINGS}
      pending={false}
      blockedReason="Comparison running"
      onInitialize={() => {}}
    />,
  );
  expect(markup).toContain("Comparison running");
  expect(markup).not.toContain("Computing route");
  expect(markup).toMatch(/<button[^>]*disabled=""/);
  expect(markup).toMatch(/aria-busy="false"/);
});

it("shows start failures beside the standalone action", () => {
  const markup = renderToStaticMarkup(
    <DispatchStartButton
      dispatch={dispatchState()}
      settings={DEFAULT_DISPATCH_SETTINGS}
      pending={false}
      onInitialize={() => {}}
      errorMessage="No drivable route found"
    />,
  );
  expect(markup).toMatch(/role="alert"[^>]*>.*No drivable route found/);
});

describe("DispatchForm PRM team controls (ADR 0014)", () => {
  const ambulance = dispatchState({ vehicleType: "AMBULANCE", resources: RESOURCES });

  it("shows the scenario time and team availability for ambulances with a roster", () => {
    const markup = render(ambulance, true, DEFAULT_DISPATCH_SETTINGS, true);
    expect(markup).toContain('type="datetime-local"');
    expect(markup).toContain("Team availability");
    expect(markup).toMatch(/role="switch" aria-checked="true" aria-label="Team-aware dispatch"/);
  });

  it("keeps only the switch when team-aware dispatch is off", () => {
    const off = dispatchState({ ...ambulance, resourceAware: false });
    const markup = render(off, true, DEFAULT_DISPATCH_SETTINGS, true);
    expect(markup).toMatch(/role="switch" aria-checked="false" aria-label="Team-aware dispatch"/);
    expect(markup).toContain("Nearest PRM base");
    expect(markup).not.toContain('type="datetime-local"');
    expect(markup).not.toContain("Team availability");
  });

  it("hides them without the resources capability (mock)", () => {
    const markup = render(ambulance, true, DEFAULT_DISPATCH_SETTINGS, false);
    expect(markup).not.toContain('type="datetime-local"');
    expect(markup).not.toContain("Team availability");
    expect(markup).not.toContain("Team-aware dispatch");
  });

  it("hides them for other vehicle types", () => {
    const fire = dispatchState({ vehicleType: "FIRE_TRUCK", resources: RESOURCES });
    const markup = render(fire, true, DEFAULT_DISPATCH_SETTINGS, true);
    expect(markup).not.toContain('type="datetime-local"');
    expect(markup).not.toContain("Team availability");
  });
});

// These tests inspect callback props by calling controls directly, outside React rendering.
vi.mock("@/components/language-provider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/language-provider")>();
  return { ...actual, useTranslation: () => ({ language: "en", t: <T,>(value: T) => value }) };
});

describe("standard-mode preflight", () => {
  it.each(["backend", "mock"] as const)("shows only the selected run's estimate (%s)", (kind) => {
    transport.current = kind;
    const markup = render(dispatchState({ rankTimeMode: "DISABLED" }), true, {
      ...DEFAULT_DISPATCH_SETTINGS,
      greenWaveMode: "DISABLED",
    });
    const card = markup.slice(
      markup.indexOf("pre-flight estimation") >= 0
        ? markup.indexOf("pre-flight estimation")
        : markup.indexOf("Pre-flight estimation"),
    );
    expect(card).toContain("Standard time");
    if (kind === "backend") expect(card).toContain("06m 12s");
    expect(card).not.toContain("GreenWave time");
    expect(card).not.toContain("TIME SAVED");
    expect(card).not.toContain("without and with");
  });
});

it.each([
  [372.5, "06m 12s"],
  [373.5, "06m 14s"],
] as const)(
  "rounds backend standard time %s consistently with the start response",
  (seconds, expected) => {
    const markup = renderToStaticMarkup(
      <PreflightEstimate
        isMockTransport={false}
        greenWaveMode="DISABLED"
        trafficDensity={1}
        origin={null}
        incident={null}
        candidate={{ ...RANKING.candidates[0], standard_seconds: seconds }}
      />,
    );
    expect(markup).toContain(expected);
  },
);
