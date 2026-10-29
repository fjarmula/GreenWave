"use client";
import { useTranslation } from "@/components/language-provider";

import { useCallback, useState } from "react";
import { useComparison } from "./ComparisonProvider";
import { ComparisonStage } from "./ComparisonStage";
import { useScenario } from "@/components/scenario-provider";
import { useSimulationActions } from "@/components/simulation-runtime";
import { useSimulationState } from "@/components/simulation-provider";
import { ResponsiveNavigation } from "@/components/workspace/ResponsiveNavigation";
import { DriverSetupCard, DriverSetupDetails } from "@/components/driver/DriverSetupSheet";
import type { SheetSnap } from "@/lib/sheet-physics";
import { DispatchSettingsChip } from "@/components/driver/DispatchSettingsChip";
import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";
import { DispatchStartButton } from "@/components/hud/dispatch/DispatchStartButton";
import { DispatchForm } from "@/components/hud/DispatchForm";
import { OnSiteResult } from "@/components/hud/OnSiteResult";
import { MapContainer } from "@/components/map/MapContainer";
import type { ComparisonMode } from "@/lib/comparison/race";
import { getFrontendConfig } from "@/lib/config";
import { dispatchAdapter } from "@/lib/dispatch-adapter";
import { createSimulationId } from "@/lib/simulation-id";
import { normalizeOutcomeSeed, type DispatchSettings } from "@/lib/start-request";
import {
  onSiteResult,
  pageCandidate,
  runnerUpIds,
  shownOnSite,
  type OnSite,
} from "@/lib/station-choice";
import { pinnedIncident } from "@/lib/useIncidentDispatch";
import type { ComparisonStartRequest, Position } from "@/types/telemetry";

export function ComparisonWorkspace() {
  const { t } = useTranslation();
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
  const [snap, setSnap] = useState<SheetSnap>("collapsed");
  const [pane, setPane] = useState<ComparisonMode>("ENABLED");
  const [mapFocusRequest, setMapFocusRequest] = useState(0);
  // An on-site answer never starts a pair (ADR 0012); it replaces setup until dismissed.
  const [onSiteAnswer, setOnSiteAnswer] = useState<OnSite | null>(null);
  const onSite = shownOnSite(onSiteAnswer, dispatch);
  const chosenStation = pageCandidate(dispatch, "BOTH")?.station ?? null;
  const { setIncident } = dispatch;
  const onMapClick = useCallback(
    (position: Position) => setIncident(pinnedIncident(position)),
    [setIncident],
  );
  const config = getFrontendConfig();
  const active =
    simulation.simulationState === "RUNNING" || simulation.simulationState === "STARTING";
  const replacementNotice = (
    <p role="status" className="hud-alert tone-caution block text-sm">
      {t(
        "Starting this comparison explicitly replaces the active simulation after a successful Stop.",
      )}
    </p>
  );
  const starting = state.status === "starting";
  const live = state.status !== "idle" && !starting && !!state.runs.ENABLED.routeData;
  // A start that failed before any route exists is reported on the setup form.
  const running =
    live &&
    (state.runs.ENABLED.simulationState === "RUNNING" ||
      state.runs.DISABLED.simulationState === "RUNNING");
  const runRequest = state.runs.ENABLED.startRequest;
  const setupError = !live && state.status === "error" ? state.reason : null;

  const start = async (runSettings: DispatchSettings) => {
    if (starting) return;
    const answer = onSiteResult(
      pageCandidate(dispatch, "BOTH"),
      dispatch.incident,
      dispatch.vehicleType,
    );
    setOnSiteAnswer(answer);
    if (answer) return;
    if (!chosenStation || !dispatch.incident) return;
    if (active && !window.confirm(t("Stop the active simulation and start this comparison?")))
      return;
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
      its_outcome_seed: normalizeOutcomeSeed(runSettings.itsOutcomeSeed),
    };
    await controller.start(request);
  };

  return (
    <WorkspaceShell
      key={live ? "live" : "setup"}
      primaryAction={
        onSite ? (
          <div className="surface-glass p-4">
            <OnSiteResult
              station={onSite.station}
              walk={onSite.walk}
              onBackToSetup={() => setOnSiteAnswer(null)}
            />
          </div>
        ) : !live ? (
          <DispatchStartButton
            dispatch={dispatch}
            settings={settings}
            pending={starting || simulation.simulationState === "STARTING"}
            replacement={active}
            intent="comparison"
            onInitialize={(values) => void start(values)}
            errorMessage={setupError}
          />
        ) : undefined
      }
      defaultDetails={!live}
      provenance={`${config.transport === "mock" ? "Synthetic mock" : "Backend simulation"} · ${live ? "Both runs live on one simulated clock" : "Comparison scenario"}`}
      controls={running && runRequest ? <DispatchSettingsChip request={runRequest} /> : undefined}
      header={<ResponsiveNavigation current="/compare" title={t("Comparison")} />}
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
                  ? {
                      label: dispatch.incident.label,
                      position: dispatch.incident.position,
                      osmPosition: dispatch.incident.address?.osmPosition ?? null,
                    }
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
      sheet={
        !live && !onSite
          ? {
              scrollContent: "all",
              snap,
              onSnapChange: setSnap,
              minimizable: !onSite,
              collapsed: (
                <DriverSetupCard
                  intent="comparison"
                  dispatch={dispatch}
                  capabilities={dispatchAdapter.capabilities}
                  geocode={dispatchAdapter.geocode}
                  settings={settings}
                  detailsOpen={snap === "expanded"}
                  onToggleDetails={() => setSnap(snap === "expanded" ? "collapsed" : "expanded")}
                  notices={active ? replacementNotice : undefined}
                />
              ),
              expanded: (
                <DriverSetupDetails
                  intent="comparison"
                  dispatch={dispatch}
                  capabilities={dispatchAdapter.capabilities}
                  settings={settings}
                  onSettingsChange={setSettings}
                  stationsError={stationsError}
                  onFocusMap={() => setMapFocusRequest((v) => v + 1)}
                />
              ),
            }
          : undefined
      }
      inspector={
        live || onSite ? undefined : (
          <>
            {active && <div className="m-4">{t(replacementNotice)}</div>}
            <DispatchForm
              intent="comparison"
              settings={settings}
              onSettingsChange={setSettings}
              stationsError={stationsError}
              dispatch={dispatch}
              capabilities={dispatchAdapter.capabilities}
              geocode={dispatchAdapter.geocode}
              onFocusMap={() => setMapFocusRequest((value) => value + 1)}
            />
          </>
        )
      }
    />
  );
}
