"use client";

import Link from "next/link";
import { DriverStatus } from "@/components/driver/DriverStatus";
import { DispatchSettingsChip } from "@/components/driver/DispatchSettingsChip";
import { DriverSetupCard, DriverSetupDetails } from "@/components/driver/DriverSetupSheet";
import { NextSignalCard } from "@/components/driver/NextSignalCard";
import { nextSignal } from "@/lib/driver-presentation";
import type { SheetSnap } from "@/lib/sheet-physics";
import { isTelemetryStale } from "@/lib/simulation-state";
import type { DispatchSettings } from "@/lib/start-request";
import { WorkspaceNavigation } from "@/components/workspace/WorkspaceNavigation";
import { routeForMode, viewRunPolicy } from "@/lib/workspace-routes";
import { Fragment, useCallback, useState, useSyncExternalStore, type ReactNode } from "react";
import { simulationOperationSlot } from "@/lib/operation-slot";
import { useSimulationStream } from "@/lib/useSimulationStream";
import { useSimulationState } from "@/components/simulation-provider";

import { getFrontendConfig } from "@/lib/config";
import { dispatchAdapter } from "@/lib/dispatch-adapter";
import { describeSimulationError } from "@/lib/simulation-copy";
import { useScenario } from "@/components/scenario-provider";
import { captureRunLabels, settingsForMode } from "@/lib/scenario-state";
import { buildStartRequest } from "@/lib/start-request";
import { createSimulationId } from "@/lib/simulation-id";
import { pinnedIncident } from "@/lib/useIncidentDispatch";
import type { DashboardMode } from "@/components/dashboard/dashboard-mode";
import { WorkspaceShell, type WorkspaceSheet } from "@/components/workspace/WorkspaceShell";
import { MapContainer } from "@/components/map/MapContainer";
import { KpiHeader } from "@/components/hud/KpiHeader";
import { RunSummary } from "@/components/hud/RunSummary";
import { IntersectionList } from "@/components/hud/IntersectionList";
import { ItsConsole } from "@/components/hud/ItsConsole";
import { DispatchForm } from "@/components/hud/DispatchForm";
import type { MapEndpoint } from "@/components/map/EndpointMarkers";
import type { GreenWaveMode, Position } from "@/types/telemetry";

export function Dashboard({
  selectedMode = "ENABLED",
  driver = false,
}: { selectedMode?: GreenWaveMode; driver?: boolean } = {}) {
  const { startSimulation, stopSimulation, stopRun } = useSimulationStream();
  const simulation = useSimulationState();
  const operationOwner = useSyncExternalStore(
    simulationOperationSlot.subscribe,
    simulationOperationSlot.getOwner,
    () => null,
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
  const setSnap = (next: SheetSnap) => setSheetState({ key: sheetKey, snap: next });
  const chosenStation = dispatch.ranking?.candidates[0]?.station ?? null;
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
        ? { label: dispatch.incident.label, position: dispatch.incident.position }
        : null;
  const initialize = (runSettings: DispatchSettings) => {
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
      !window.confirm("Stop the active simulation and replace it with this scenario?")
    )
      return;
    retainResult(simulation);
    const labels = captureRunLabels(
      { label: chosenStation.name, position: chosenStation.position },
      { label: dispatch.incident.label, position: dispatch.incident.position },
    );
    void startSimulation(request, policy.requiresReplacement).then((started) => {
      if (started) setRunLabels(labels);
    });
  };
  const mapProps = {
    stations,
    selectedVehicleType: dispatch.vehicleType,
    chosenStationId: chosenStation?.station_id ?? null,
    runnerUpIds: dispatch.ranking?.candidates.slice(1).map((c) => c.station.station_id) ?? [],
    onMapClick,
  };

  const notices = (
    <>
      {operationOwner === "comparison" && (
        <p role="status" className="hud-alert tone-beacon m-4 block text-sm">
          A comparison owns the simulation.{" "}
          <Link className="underline" href="/compare">
            Return to recording or cancel it
          </Link>
          .
        </p>
      )}
      {policy.requiresReplacement && (
        <p role="status" className="hud-alert tone-caution m-4 block text-sm">
          A{" "}
          {simulation.startRequest?.green_wave_mode === "ENABLED"
            ? "Green Wave"
            : "standard traffic"}{" "}
          simulation is {simulationState.toLowerCase()}.{" "}
          <Link className="underline" href={routeForMode(simulation.startRequest!.green_wave_mode)}>
            Return to that run
          </Link>
          . Starting here requires explicit replacement.
        </p>
      )}
    </>
  );
  const pending = simulationState === "STARTING" || operationOwner === "comparison";
  const signal =
    driver && routeData && simulationState === "RUNNING"
      ? nextSignal(routeData, simulation.liveTelemetry, isTelemetryStale(simulation))
      : null;
  const driverSheet: WorkspaceSheet | undefined = !driver
    ? undefined
    : mode === "setup"
      ? {
          snap,
          onSnapChange: setSnap,
          collapsed: (
            <DriverSetupCard
              dispatch={dispatch}
              capabilities={dispatchAdapter.capabilities}
              geocode={dispatchAdapter.geocode}
              settings={settingsForMode(settings, selectedMode)}
              detailsOpen={snap === "expanded"}
              onToggleDetails={() => setSnap(snap === "expanded" ? "collapsed" : "expanded")}
              notices={notices}
              pending={pending}
              replacement={policy.requiresReplacement}
              errorMessage={startErrorMessage}
              onInitialize={() => initialize(settingsForMode(settings, selectedMode))}
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
            />
          ),
        }
      : {
          snap,
          onSnapChange: setSnap,
          detailsLabel: "Route signals",
          collapsed: (
            <DriverStatus state={simulation} onStop={stopRun} onBackToSetup={backToSetup} />
          ),
          expanded: (
            <div className="space-y-4 pt-2">
              <IntersectionList />
              <ItsConsole />
            </div>
          ),
        };

  return (
    <WorkspaceShell
      sheet={driverSheet}
      status={
        driver && mode === "live" && simulationState === "RUNNING" ? (
          <div className="driver-overlay">
            {signal && <NextSignalCard signal={signal} />}
            {simulation.startRequest && <DispatchSettingsChip request={simulation.startRequest} />}
          </div>
        ) : undefined
      }
      header={
        <div className="min-w-0 flex-1">
          <WorkspaceNavigation current={driver ? "/driver" : routeForMode(selectedMode)} />
          <h1 className="workspace-title">
            {driver
              ? "Driver simulation"
              : selectedMode === "ENABLED"
                ? "Green Wave"
                : "Standard traffic"}{" "}
            <span className="text-muted-foreground">
              / {mode === "live" ? "Simulation" : "Setup"}
            </span>
          </h1>
        </div>
      }
      map={
        <MapContainer
          live={mode === "live"}
          origin={origin}
          destination={destination}
          focusRequest={mapFocusRequest}
          {...mapProps}
        />
      }
      inspector={
        <>
          {notices}
          {mode === "setup" ? (
            <DispatchForm
              settings={settingsForMode(settings, selectedMode)}
              modeLocked
              replacement={policy.requiresReplacement}
              onSettingsChange={setSettings}
              previousRun={previousRun}
              stationsError={stationsError}
              pending={pending}
              errorMessage={startErrorMessage}
              dispatch={dispatch}
              capabilities={dispatchAdapter.capabilities}
              geocode={dispatchAdapter.geocode}
              onInitialize={initialize}
              onFocusMap={() => setMapFocusRequest((request) => request + 1)}
            />
          ) : (
            <div className="space-y-4 p-4">
              <KpiHeader />
              <RunSummary onBackToSetup={backToSetup} onStop={stopRun} />
              <IntersectionList />
              <ItsConsole />
            </div>
          )}
        </>
      }
    />
  );
}

/**
 * Setup and live share one element path to the route preview, so React keeps the
 * MapLibre instance across mode switches. Live uses `contents`, so the preview stays a
 * flex child of `main` as before.
 */
export function DashboardLayout({
  mode,
  form,
  preview,
}: {
  mode: DashboardMode;
  form: ReactNode;
  preview: ReactNode;
}) {
  return (
    <section
      className={
        mode === "setup" ? "grid min-h-0 flex-1 lg:grid-cols-[370px_minmax(0,1fr)]" : "contents"
      }
    >
      {mode === "setup" && <div className="order-2 min-w-0 lg:order-1">{form}</div>}
      <Fragment key="route-preview">{preview}</Fragment>
    </section>
  );
}
