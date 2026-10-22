"use client";

import { useCallback, useEffect, useState } from "react";
import { useSimulationStream } from "@/lib/useSimulationStream";
import { useSimulationState } from "@/components/simulation-provider";

import { getFrontendConfig } from "@/lib/config";
import { dispatchAdapter } from "@/lib/dispatch-adapter";
import { describeSimulationError } from "@/lib/simulation-copy";
import { nextPreviousRun, type PreviousRun } from "@/lib/previous-run";
import { buildStartRequest, DEFAULT_DISPATCH_SETTINGS } from "@/lib/start-request";
import { pinnedIncident, useIncidentDispatch } from "@/lib/useIncidentDispatch";
import { useStations } from "@/lib/useStations";
import { scrollViewToTop } from "@/lib/view-scroll";
import { DashboardHeader, type DashboardMode } from "@/components/dashboard/DashboardHeader";
import { RoutePreview } from "@/components/dashboard/RoutePreview";
import { DataQualityPanel } from "@/components/hud/DataQualityPanel";
import { DispatchForm } from "@/components/hud/DispatchForm";
import type { MapEndpoint } from "@/components/map/EndpointMarkers";
import type { Position } from "@/types/telemetry";

export function Dashboard() {
  const { startSimulation, stopSimulation, stopRun } = useSimulationStream();
  const simulation = useSimulationState();
  const { simulationState, routeData, error } = simulation;
  const config = getFrontendConfig();
  const dispatch = useIncidentDispatch(dispatchAdapter);
  const stations = useStations(dispatchAdapter);
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
  const [mode, setMode] = useState<DashboardMode>("setup");
  const [mapFocusRequest, setMapFocusRequest] = useState(0);
  // Kept here, not in the form, so they survive every setup ↔ live switch.
  const [settings, setSettings] = useState(DEFAULT_DISPATCH_SETTINGS);
  const [previousRun, setPreviousRun] = useState<PreviousRun | null>(null);
  useEffect(() => {
    scrollViewToTop(window);
  }, [mode]);
  const chosenStation = dispatch.ranking?.candidates[0]?.station ?? null;
  const backToSetup = () => {
    // Captured before the stop resets the run; only a finished run replaces the previous one.
    setPreviousRun((current) =>
      nextPreviousRun(
        current,
        simulation,
        chosenStation?.name ?? "Unknown station",
        dispatch.incident?.label ?? "Unknown incident",
      ),
    );
    stopSimulation();
    setMode("setup");
  };
  const origin: MapEndpoint | null = chosenStation
    ? { label: chosenStation.name, position: chosenStation.position }
    : null;
  const destination: MapEndpoint | null = dispatch.incident
    ? { label: dispatch.incident.label, position: dispatch.incident.position }
    : null;
  const mapProps = {
    stations,
    selectedVehicleType: dispatch.vehicleType,
    chosenStationId: chosenStation?.station_id ?? null,
    runnerUpIds: dispatch.ranking?.candidates.slice(1).map((c) => c.station.station_id) ?? [],
    onMapClick,
  };

  return (
    <main className="dashboard-theme-transition flex min-h-dvh min-w-80 flex-col overflow-x-hidden bg-background text-foreground">
      <DashboardHeader mode={mode} />

      {mode === "setup" ? (
        <section className="grid min-h-0 flex-1 lg:grid-cols-[370px_minmax(0,1fr)]">
          <div className="order-2 min-w-0 lg:order-1">
            <DispatchForm
              settings={settings}
              onSettingsChange={setSettings}
              previousRun={previousRun}
              pending={simulationState === "STARTING"}
              errorMessage={startErrorMessage}
              dispatch={dispatch}
              capabilities={dispatchAdapter.capabilities}
              geocode={dispatchAdapter.geocode}
              onInitialize={(runSettings) => {
                if (!chosenStation || !dispatch.incident) return;
                const request = buildStartRequest(
                  chosenStation,
                  dispatch.incident,
                  dispatch.vehicleType,
                  runSettings,
                  crypto.randomUUID(),
                );
                void startSimulation(request).then((started) => {
                  if (started) setMode("live");
                });
              }}
              onFocusMap={() => setMapFocusRequest((request) => request + 1)}
            >
              <DataQualityPanel mode={config.transport} apiBaseUrl={config.apiBaseUrl} />
            </DispatchForm>
          </div>
          <RoutePreview
            mode="setup"
            origin={origin}
            destination={destination}
            mapFocusRequest={mapFocusRequest}
            map={mapProps}
          />
        </section>
      ) : (
        <RoutePreview
          mode="live"
          origin={origin}
          destination={destination}
          mapFocusRequest={mapFocusRequest}
          onBackToSetup={backToSetup}
          onStop={stopRun}
          map={mapProps}
        />
      )}
    </main>
  );
}
