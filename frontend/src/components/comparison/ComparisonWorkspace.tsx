"use client";

import { useCallback, useState } from "react";
import { useComparison } from "./ComparisonProvider";
import { ComparisonStage } from "./ComparisonStage";
import { useScenario } from "@/components/scenario-provider";
import { useSimulationActions } from "@/components/simulation-runtime";
import { useSimulationState } from "@/components/simulation-provider";
import { WorkspaceNavigation } from "@/components/workspace/WorkspaceNavigation";
import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";
import { DispatchForm } from "@/components/hud/DispatchForm";
import { OnSiteResult } from "@/components/hud/OnSiteResult";
import { MapContainer } from "@/components/map/MapContainer";
import type { ComparisonMode } from "@/lib/comparison/race";
import { getFrontendConfig } from "@/lib/config";
import { dispatchAdapter } from "@/lib/dispatch-adapter";
import { createSimulationId } from "@/lib/simulation-id";
import type { DispatchSettings } from "@/lib/start-request";
import { onSiteResult, runnerUpIds, shownOnSite, type OnSite } from "@/lib/station-choice";
import { pinnedIncident, selectedCandidate } from "@/lib/useIncidentDispatch";
import type { ComparisonStartRequest, Position } from "@/types/telemetry";

export function ComparisonWorkspace() {
  const { controller, state } = useComparison();
  const {
    dispatch,
    settings,
    setSettings,
    stations,
    error: stationsError,
    retainResult,
  } = useScenario();
  const simulation = useSimulationState();
  const { prepareComparison } = useSimulationActions();
  const [pane, setPane] = useState<ComparisonMode>("ENABLED");
  const [mapFocusRequest, setMapFocusRequest] = useState(0);
  // An on-site answer never starts a pair (ADR 0012); it replaces setup until dismissed.
  const [onSiteAnswer, setOnSiteAnswer] = useState<OnSite | null>(null);
  const onSite = shownOnSite(onSiteAnswer, dispatch);
  const chosenStation = selectedCandidate(dispatch)?.station ?? null;
  const { setIncident } = dispatch;
  const onMapClick = useCallback(
    (position: Position) => setIncident(pinnedIncident(position)),
    [setIncident],
  );
  const config = getFrontendConfig();
  const active =
    simulation.simulationState === "RUNNING" || simulation.simulationState === "STARTING";
  const starting = state.status === "starting";
  const live = state.status !== "idle" && !starting && !!state.runs.ENABLED.routeData;
  // A start that failed before any route exists is reported on the setup form.
  const setupError = !live && state.status === "error" ? state.reason : null;

  const start = async (runSettings: DispatchSettings) => {
    if (starting) return;
    const answer = onSiteResult(
      selectedCandidate(dispatch),
      dispatch.incident,
      dispatch.vehicleType,
    );
    setOnSiteAnswer(answer);
    if (answer) return;
    if (!chosenStation || !dispatch.incident) return;
    if (active && !window.confirm("Stop the active simulation and start this comparison?")) return;
    retainResult(simulation);
    if (!(await prepareComparison())) return;
    setPane("ENABLED");
    const request: ComparisonStartRequest = {
      enabled_simulation_id: createSimulationId(),
      disabled_simulation_id: createSimulationId(),
      origin: chosenStation.position,
      destination: dispatch.incident.position,
      traffic_density_multiplier: runSettings.trafficDensity,
      enable_cascade_mode: runSettings.cascadeEnabled,
      playback_speed: runSettings.playbackSpeed,
      vehicle_type: dispatch.vehicleType,
      its_scenario: runSettings.itsScenario ?? "NOMINAL",
    };
    await controller.start(request);
  };

  return (
    <WorkspaceShell
      key={live ? "live" : "setup"}
      defaultDetails={!live}
      provenance={`${config.transport === "mock" ? "Synthetic mock" : "Backend simulation"} · ${live ? "Both runs live on one simulated clock" : "Comparison scenario"}`}
      header={
        <div className="min-w-0 flex-1">
          <WorkspaceNavigation current="/compare" />
          <h1 className="workspace-title">
            {live ? "Green Wave vs standard traffic" : "Comparison setup"}
          </h1>
        </div>
      }
      map={
        live ? (
          <ComparisonStage
            state={state}
            pane={pane}
            onPaneChange={setPane}
            onStop={() => void controller.stop()}
            onReset={() => controller.reset()}
          />
        ) : (
          <div className="comparison-setup-map">
            <MapContainer
              live={false}
              origin={
                chosenStation
                  ? { label: chosenStation.name, position: chosenStation.position }
                  : null
              }
              destination={
                dispatch.incident
                  ? { label: dispatch.incident.label, position: dispatch.incident.position }
                  : null
              }
              focusRequest={mapFocusRequest}
              stations={stations}
              selectedVehicleType={dispatch.vehicleType}
              chosenStationId={chosenStation?.station_id ?? null}
              runnerUpIds={runnerUpIds(dispatch.ranking, dispatch.selectedStationId)}
              onMapClick={starting ? () => {} : onMapClick}
            />
          </div>
        )
      }
      inspector={
        live ? undefined : (
          <>
            {active && (
              <p role="status" className="hud-alert tone-caution m-4 block text-sm">
                Starting this comparison explicitly replaces the active simulation after a
                successful Stop.
              </p>
            )}
            {onSite ? (
              <div className="p-4">
                <OnSiteResult
                  station={onSite.station}
                  walk={onSite.walk}
                  onBackToSetup={() => setOnSiteAnswer(null)}
                />
              </div>
            ) : (
              <DispatchForm
                intent="comparison"
                settings={settings}
                onSettingsChange={setSettings}
                stationsError={stationsError}
                pending={simulation.simulationState === "STARTING" || starting}
                replacement={active}
                errorMessage={setupError}
                dispatch={dispatch}
                capabilities={dispatchAdapter.capabilities}
                geocode={dispatchAdapter.geocode}
                onInitialize={(values) => void start(values)}
                onFocusMap={() => setMapFocusRequest((value) => value + 1)}
              />
            )}
          </>
        )
      }
    />
  );
}
