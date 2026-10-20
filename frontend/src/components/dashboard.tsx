"use client";

import { useState } from "react";
import { useSimulationStream } from "@/lib/useSimulationStream";
import { useSimulationState } from "@/components/simulation-provider";

import { getFrontendConfig } from "@/lib/config";
import { describeSimulationError } from "@/lib/simulation-copy";
import { buildStartRequest } from "@/lib/start-request";
import { DashboardHeader, type DashboardMode } from "@/components/dashboard/DashboardHeader";
import { RoutePreview } from "@/components/dashboard/RoutePreview";
import { DataQualityPanel } from "@/components/hud/DataQualityPanel";
import { DispatchForm } from "@/components/hud/DispatchForm";
import {
  DESTINATION_ENDPOINTS,
  ORIGIN_ENDPOINTS,
  type DestinationEndpointId,
  type OriginEndpointId,
} from "@/components/map/dispatch-endpoints";

export function Dashboard() {
  const { startSimulation, stopSimulation } = useSimulationStream();
  const { simulationState, routeData, error } = useSimulationState();
  const config = getFrontendConfig();
  // A failed start has no route yet; errors after the start are shown in the live view.
  const startErrorMessage =
    simulationState === "ERROR" && !routeData && error
      ? describeSimulationError(error, config.apiBaseUrl)
      : null;
  const [mode, setMode] = useState<DashboardMode>("setup");
  const [originId, setOriginId] = useState<OriginEndpointId>("hospital");
  const [destinationId, setDestinationId] = useState<DestinationEndpointId>("station");
  const [mapFocusRequest, setMapFocusRequest] = useState(0);
  const backToSetup = () => {
    stopSimulation();
    setMode("setup");
  };
  const origin =
    ORIGIN_ENDPOINTS.find((endpoint) => endpoint.id === originId) ?? ORIGIN_ENDPOINTS[0];
  const destination =
    DESTINATION_ENDPOINTS.find((endpoint) => endpoint.id === destinationId) ??
    DESTINATION_ENDPOINTS[0];

  return (
    <main className="dashboard-theme-transition flex min-h-dvh min-w-80 flex-col overflow-x-hidden bg-background text-foreground">
      <DashboardHeader
        mode={mode}
        onModeChange={(nextMode) => {
          if (nextMode === "setup") stopSimulation();
          setMode(nextMode);
        }}
      />

      {mode === "setup" ? (
        <section className="grid min-h-0 flex-1 lg:grid-cols-[370px_minmax(0,1fr)]">
          <div className="order-2 lg:order-1">
            <DispatchForm
              pending={simulationState === "STARTING"}
              errorMessage={startErrorMessage}
              onInitialize={(settings) => {
                const request = buildStartRequest(
                  origin,
                  destination,
                  settings,
                  crypto.randomUUID(),
                );
                void startSimulation(request).then((started) => {
                  if (started) setMode("live");
                });
              }}
              originId={originId}
              destinationId={destinationId}
              onOriginChange={setOriginId}
              onDestinationChange={setDestinationId}
              onFocusNodes={() => setMapFocusRequest((request) => request + 1)}
            >
              <DataQualityPanel mode={config.transport} apiBaseUrl={config.apiBaseUrl} />
            </DispatchForm>
          </div>
          <RoutePreview
            mode="setup"
            origin={origin}
            destination={destination}
            mapFocusRequest={mapFocusRequest}
          />
        </section>
      ) : (
        <RoutePreview
          mode="live"
          origin={origin}
          destination={destination}
          mapFocusRequest={mapFocusRequest}
          onBackToSetup={backToSetup}
        />
      )}
    </main>
  );
}
