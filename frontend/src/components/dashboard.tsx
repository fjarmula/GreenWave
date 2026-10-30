"use client";
import { useTranslation } from "@/components/language-provider";

import Link from "next/link";
import { DriverStatus } from "@/components/driver/DriverStatus";
import { DispatchSettingsChip } from "@/components/driver/DispatchSettingsChip";
import { DriverSetupCard, DriverSetupDetails } from "@/components/driver/DriverSetupSheet";
import { NextSignalCard } from "@/components/driver/NextSignalCard";
import { nextSignal } from "@/lib/driver-presentation";
import type { SheetSnap } from "@/lib/sheet-physics";
import { isTelemetryStale } from "@/lib/simulation-state";
import type { DispatchSettings } from "@/lib/start-request";
import { ResponsiveNavigation } from "@/components/workspace/ResponsiveNavigation";
import { routeForMode, viewRunPolicy } from "@/lib/workspace-routes";
import { useCallback, useState, useSyncExternalStore } from "react";
import { simulationOperationSlot } from "@/lib/operation-slot";
import { useSimulationActions } from "@/components/simulation-runtime";
import { useSimulationState } from "@/components/simulation-provider";

import { getFrontendConfig } from "@/lib/config";
import { dispatchAdapter } from "@/lib/dispatch-adapter";
import { describeSimulationError } from "@/lib/simulation-copy";
import { useScenario } from "@/components/scenario-provider";
import { captureRunLabels, settingsForMode } from "@/lib/scenario-state";
import { buildStartRequest } from "@/lib/start-request";
import { createSimulationId } from "@/lib/simulation-id";
import {
  onSiteResult,
  pageCandidate,
  plannedRoute,
  runnerUpIds,
  shownOnSite,
  timeModeFor,
  type OnSite,
} from "@/lib/station-choice";
import { pinnedIncident } from "@/lib/useIncidentDispatch";
import type { DashboardMode } from "@/components/dashboard/dashboard-mode";
import { WorkspaceShell, type WorkspaceSheet } from "@/components/workspace/WorkspaceShell";
import { MapContainer } from "@/components/map/MapContainer";
import { useIsPhone } from "@/lib/useIsPhone";
import { setupSheetMinimizable } from "@/lib/driver-setup-sheet";
import { KpiHeader } from "@/components/hud/KpiHeader";
import { RunSummary } from "@/components/hud/RunSummary";
import { PriorityFallbackNotice } from "@/components/hud/PriorityFallbackNotice";
import { IntersectionList } from "@/components/hud/IntersectionList";
import { RoutePreviewStatus } from "@/components/hud/RoutePreviewStatus";
import { ItsConsole } from "@/components/hud/ItsConsole";
import { DispatchStartButton } from "@/components/hud/dispatch/DispatchStartButton";
import { DispatchForm } from "@/components/hud/DispatchForm";
import { OnSiteResult } from "@/components/hud/OnSiteResult";
import type { MapEndpoint } from "@/components/map/EndpointMarkers";
import type { GreenWaveMode, Position } from "@/types/telemetry";

export function Dashboard({
  selectedMode = "ENABLED",
  driver = false,
}: { selectedMode?: GreenWaveMode; driver?: boolean } = {}) {
  const { t } = useTranslation();
  const { startSimulation, stopSimulation, stopRun } = useSimulationActions();
  const simulation = useSimulationState();
  const operationOwner = useSyncExternalStore(
    simulationOperationSlot.subscribe,
    simulationOperationSlot.getOwner,
    simulationOperationSlot.getOwner,
  );
  const { simulationState, routeData, error } = simulation;
  const config = getFrontendConfig();
  const {
    dispatch,
    stations,
    error: stationsError,
    settings,
    setSettings,
    runLabels,
    setRunLabels,
    previousRun,
    retainResult,
  } = useScenario();
  const { setIncident } = dispatch;
  const onMapClick = useCallback(
    (position: Position) => setIncident(pinnedIncident(position)),
    [setIncident],
  );
  // A failed start has no route yet; errors after the start are shown in the live view.
  const startErrorMessage =
    simulationState === "ERROR" && !routeData && error
      ? describeSimulationError(error, config.apiBaseUrl)
      : null;
  const policy = viewRunPolicy(
    selectedMode,
    simulation.startRequest?.green_wave_mode ?? null,
    simulationState,
  );
  const mode: DashboardMode = routeData && policy.showRun ? "live" : "setup";
  const [mapFocusRequest, setMapFocusRequest] = useState(0);
  // An on-site answer replaces setup until "Back to setup" or a new incident or vehicle.
  const [onSiteAnswer, setOnSiteAnswer] = useState<OnSite | null>(null);
  const onSite = mode === "setup" ? shownOnSite(onSiteAnswer, dispatch) : null;
  // The sheet starts collapsed for setup, for each run and again when the run ends.
  const sheetKey =
    mode === "live"
      ? `${simulation.startRequest?.simulation_id}:${simulationState === "RUNNING" ? "run" : "end"}`
      : "setup";
  const [sheetState, setSheetState] = useState<{ key: string; snap: SheetSnap }>({
    key: sheetKey,
    snap: "collapsed",
  });
  const snap = sheetState.key === sheetKey ? sheetState.snap : "collapsed";
  const phone = useIsPhone();
  const minimizable = setupSheetMinimizable({
    driver: true,
    setup: mode === "setup",
    onSite: !!onSite,
  });
  const setSnap = (next: SheetSnap) => setSheetState({ key: sheetKey, snap: next });
  const timeMode = timeModeFor(selectedMode, "simulation");
  const chosenStation = pageCandidate(dispatch, timeMode)?.station ?? null;
  const backToSetup = () => {
    retainResult(simulation);
    stopSimulation();
  };
  const origin: MapEndpoint | null =
    mode === "live" && runLabels
      ? runLabels.origin
      : chosenStation
        ? { label: chosenStation.name, position: chosenStation.position }
        : null;
  const destination: MapEndpoint | null =
    mode === "live" && runLabels
      ? runLabels.destination
      : dispatch.incident
        ? {
            label: dispatch.incident.label,
            position: dispatch.incident.position,
            osmPosition: dispatch.incident.address?.osmPosition ?? null,
          }
        : null;
  const initialize = (runSettings: DispatchSettings) => {
    const answer = onSiteResult(
      pageCandidate(dispatch, timeMode),
      dispatch.incident,
      dispatch.vehicleType,
    );
    setOnSiteAnswer(answer);
    if (answer) return; // the crew walks: no simulation (ADR 0012)
    if (!chosenStation || !dispatch.incident) return;
    const request = buildStartRequest(
      chosenStation,
      dispatch.incident,
      dispatch.vehicleType,
      settingsForMode(runSettings, selectedMode),
      createSimulationId(),
    );
    if (
      policy.requiresReplacement &&
      !window.confirm(t("Stop the active simulation and replace it with this scenario?"))
    )
      return;
    retainResult(simulation);
    const labels = captureRunLabels(
      { label: chosenStation.name, position: chosenStation.position },
      {
        label: dispatch.incident.label,
        position: dispatch.incident.position,
        osmPosition: dispatch.incident.address?.osmPosition ?? null,
      },
    );
    void startSimulation(request, policy.requiresReplacement).then((started) => {
      if (started) setRunLabels(labels);
    });
  };
  const mapProps = {
    stations,
    selectedVehicleType: dispatch.vehicleType,
    chosenStationId: chosenStation?.station_id ?? null,
    runnerUpIds: runnerUpIds(dispatch.ranking, dispatch.selectedStationId, timeMode),
    // Picking an incident restores the phone setup card in every simulation mode.
    onMapClick:
      mode === "setup"
        ? (position: Position) => {
            onMapClick(position);
            setSnap("collapsed");
          }
        : onMapClick,
    // On phones, using the map folds setup down to its peek row in every mode.
    onUserMove:
      minimizable && phone && snap !== "minimized" ? () => setSnap("minimized") : undefined,
  };

  const notices = (
    <>
      {operationOwner === "comparison" && (
        <p role="status" className="hud-alert tone-beacon m-4 block text-sm">
          {t("A comparison owns the simulation.")}
          {t(" ")}
          <Link className="underline" href="/compare">
            {t("Return to the comparison")}
          </Link>
          {t(".")}
        </p>
      )}
      {policy.requiresReplacement && (
        <p role="status" className="hud-alert tone-caution m-4 block text-sm">
          {t("A")}
          {t(" ")}
          {t(
            simulation.startRequest?.green_wave_mode === "ENABLED"
              ? "Green Wave"
              : "standard traffic",
          )}
          {t(" ")}
          {t("simulation is ")}
          {t(simulationState.toLowerCase())}
          {t(".")}
          {t(" ")}
          <Link className="underline" href={routeForMode(simulation.startRequest!.green_wave_mode)}>
            {t("Return to that run")}
          </Link>
          {t(". Starting here requires explicit replacement.")}
        </p>
      )}
    </>
  );
  const pending = simulationState === "STARTING";
  const startBlockedReason = operationOwner === "comparison" ? "Comparison running" : undefined;
  const signal =
    driver && routeData && simulationState === "RUNNING"
      ? nextSignal(routeData, simulation.liveTelemetry, isTelemetryStale(simulation))
      : null;
  // Setup is the same sheet on every page; the shell hides it while an on-site answer shows.
  const setupSheet: WorkspaceSheet = {
    scrollContent: "all",
    snap,
    onSnapChange: setSnap,
    minimizable,
    collapsed: (
      <DriverSetupCard
        dispatch={dispatch}
        capabilities={dispatchAdapter.capabilities}
        geocode={dispatchAdapter.geocode}
        settings={settingsForMode(settings, selectedMode)}
        detailsOpen={snap === "expanded"}
        onToggleDetails={() => setSnap(snap === "expanded" ? "collapsed" : "expanded")}
        notices={notices}
      />
    ),
    expanded: (
      <DriverSetupDetails
        dispatch={dispatch}
        capabilities={dispatchAdapter.capabilities}
        settings={settingsForMode(settings, selectedMode)}
        onSettingsChange={setSettings}
        stationsError={stationsError}
        onFocusMap={() => setMapFocusRequest((request) => request + 1)}
        previousRun={driver ? null : previousRun}
      />
    ),
  };
  // Green Wave and Standard use the sheet on phones only; desktop keeps the full inspector.
  const workspaceSheet: WorkspaceSheet =
    mode === "setup"
      ? setupSheet
      : driver
        ? {
            snap,
            onSnapChange: setSnap,
            collapsed: (
              <>
                <DriverStatus state={simulation} onStop={stopRun} onBackToSetup={backToSetup} />
                <PriorityFallbackNotice compact />
              </>
            ),
            expanded: (
              <div className="space-y-4 pt-2">
                <PriorityFallbackNotice />
                <IntersectionList />
                <ItsConsole />
              </div>
            ),
          }
        : {
            snap,
            onSnapChange: setSnap,
            // Running: telemetry and the one Stop. Ended: the outcome and the way back to setup.
            collapsed:
              simulationState === "RUNNING" ? (
                <>
                  <KpiHeader onStop={stopRun} />
                  <PriorityFallbackNotice compact />
                </>
              ) : (
                <RunSummary onBackToSetup={backToSetup} onStop={stopRun} showStop={false} />
              ),
            expanded: (
              <div className="space-y-4 pt-1">
                {simulationState !== "RUNNING" && <KpiHeader />}
                <PriorityFallbackNotice />
                <IntersectionList />
                <ItsConsole />
              </div>
            ),
          };

  return (
    <WorkspaceShell
      boundedInspector={mode === "live"}
      primaryAction={
        onSite ? (
          <div className="surface-glass p-4">
            <OnSiteResult
              station={onSite.station}
              walk={onSite.walk}
              onBackToSetup={() => setOnSiteAnswer(null)}
            />
          </div>
        ) : mode === "setup" ? (
          <DispatchStartButton
            dispatch={dispatch}
            settings={settingsForMode(settings, selectedMode)}
            pending={pending}
            replacement={policy.requiresReplacement}
            onInitialize={initialize}
            errorMessage={startErrorMessage}
            blockedReason={startBlockedReason}
          />
        ) : undefined
      }
      sheet={onSite ? undefined : workspaceSheet}
      controls={
        mode === "live" && simulationState === "RUNNING" && simulation.startRequest ? (
          <DispatchSettingsChip request={simulation.startRequest} />
        ) : undefined
      }
      status={
        mode === "live" && simulationState === "RUNNING" && driver && signal ? (
          <div className="driver-overlay">
            <NextSignalCard signal={signal} />
          </div>
        ) : mode === "setup" ? (
          <RoutePreviewStatus dispatch={dispatch} mode={timeMode} />
        ) : undefined
      }
      header={
        <ResponsiveNavigation
          current={driver ? "/driver" : routeForMode(selectedMode)}
          title={t(
            driver
              ? "Driver simulation"
              : selectedMode === "ENABLED"
                ? "Green Wave"
                : "Standard traffic",
          )}
        />
      }
      map={
        <MapContainer
          live={mode === "live"}
          previewGeometry={plannedRoute(dispatch, timeMode)}
          origin={origin}
          destination={destination}
          focusRequest={mapFocusRequest}
          signalLabels={driver ? "driver" : "full"}
          {...mapProps}
        />
      }
      inspector={
        onSite ? undefined : (
          <>
            {t(notices)}
            {mode === "setup" ? (
              <DispatchForm
                settings={settingsForMode(settings, selectedMode)}
                modeLocked
                onSettingsChange={setSettings}
                previousRun={previousRun}
                stationsError={stationsError}
                dispatch={dispatch}
                capabilities={dispatchAdapter.capabilities}
                geocode={dispatchAdapter.geocode}
                onFocusMap={() => setMapFocusRequest((request) => request + 1)}
              />
            ) : (
              <div className="live-inspector">
                <div className="live-inspector-controls space-y-4">
                  <KpiHeader />
                  <RunSummary onBackToSetup={backToSetup} onStop={stopRun} />
                  <PriorityFallbackNotice />
                </div>
                <IntersectionList />
                <ItsConsole />
              </div>
            )}
          </>
        )
      }
    />
  );
}
