"use client";

import { Activity, Ambulance, Gauge, Route, Settings2, Siren } from "lucide-react";
import { useState } from "react";
import { useSimulationStream } from "@/lib/useSimulationStream";
import { useSimulationState } from "@/components/simulation-provider";

import { getFrontendConfig } from "@/lib/config";
import { describeSimulationError } from "@/lib/simulation-copy";
import type { SimulationPhase } from "@/lib/simulation-state";
import { DispatchForm } from "@/components/hud/DispatchForm";
import { IntersectionList } from "@/components/hud/IntersectionList";
import { ItsConsole } from "@/components/hud/ItsConsole";
import { KpiHeader } from "@/components/hud/KpiHeader";
import { RunSummary } from "@/components/hud/RunSummary";
import { ThemeToggle } from "@/components/hud/ThemeToggle";
import { MapContainer } from "@/components/map/MapContainer";
import {
  DESTINATION_ENDPOINTS,
  ORIGIN_ENDPOINTS,
  type DestinationEndpointId,
  type OriginEndpointId,
} from "@/components/map/dispatch-endpoints";

type DashboardMode = "setup" | "live";

const PHASE_LABELS: Record<SimulationPhase, string> = {
  SETUP: "System ready",
  STARTING: "Computing route",
  RUNNING: "Simulation running",
  FINISHED: "Simulation finished",
  CANCELLED: "Simulation cancelled",
  ERROR: "Simulation error",
};

export function Dashboard() {
  const { startSimulation, stopSimulation } = useSimulationStream();
  const { simulationState, routeData, error } = useSimulationState();
  // A failed start has no route yet; errors after the start are shown in the live view.
  const startErrorMessage =
    simulationState === "ERROR" && !routeData && error
      ? describeSimulationError(error, getFrontendConfig().apiBaseUrl)
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
              onInitialize={({ trafficDensity, cascadeEnabled, playbackSpeed }) => {
                const request = {
                  simulation_id: crypto.randomUUID(),
                  origin: { lng: origin.coordinates[0], lat: origin.coordinates[1] },
                  destination: { lng: destination.coordinates[0], lat: destination.coordinates[1] },
                  traffic_density_multiplier: trafficDensity,
                  enable_cascade_mode: cascadeEnabled,
                  playback_speed: playbackSpeed,
                };
                void startSimulation(request).then((started) => {
                  if (started) setMode("live");
                });
              }}
              originId={originId}
              destinationId={destinationId}
              onOriginChange={setOriginId}
              onDestinationChange={setDestinationId}
              onFocusNodes={() => setMapFocusRequest((request) => request + 1)}
            />
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

type DashboardHeaderProps = {
  mode: DashboardMode;
  onModeChange: (mode: DashboardMode) => void;
};

function DashboardHeader({ mode, onModeChange }: DashboardHeaderProps) {
  const { simulationState } = useSimulationState();
  return (
    <header className="z-50 flex flex-wrap items-center gap-3 border-b border-border bg-background/92 px-4 py-3 backdrop-blur-xl sm:px-6 lg:min-h-[76px] lg:flex-nowrap">
      <div className="flex min-w-0 flex-1 items-center gap-3 lg:min-w-[285px] lg:flex-none">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-500 text-emerald-950 shadow-lg shadow-emerald-500/25">
          <Siren className="size-5" aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="dashboard-eyebrow truncate">Kraków Municipal Response Network</p>
          <h1 className="truncate text-lg font-bold tracking-[0.09em]">
            ER<span className="text-emerald-500">-</span>GREENWAVE
          </h1>
        </div>
      </div>

      <nav
        className="order-3 flex w-full rounded-lg border border-border bg-muted/45 p-1 sm:order-none sm:ml-auto sm:w-auto"
        aria-label="Dashboard mode"
      >
        <ModeButton
          active={mode === "setup"}
          onClick={() => onModeChange("setup")}
          icon={Settings2}
        >
          Dispatch setup
        </ModeButton>
        <ModeButton
          active={mode === "live"}
          onClick={() => onModeChange("live")}
          icon={Activity}
          live
        >
          Live operations
        </ModeButton>
      </nav>

      <div className="order-2 sm:order-none">
        <ThemeToggle />
      </div>

      <div className="ml-2 hidden items-center gap-2 text-[11px] text-muted-foreground xl:flex">
        <span className="size-2 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.8)]" />
        <span>{PHASE_LABELS[simulationState]}</span>
        <span className="mx-1 h-4 w-px bg-border" />
        <span className="font-mono">SIMULATION ENVIRONMENT</span>
      </div>
    </header>
  );
}

type ModeButtonProps = {
  active: boolean;
  onClick: () => void;
  icon: typeof Settings2;
  live?: boolean;
  children: React.ReactNode;
};

function ModeButton({ active, onClick, icon: Icon, live = false, children }: ModeButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex min-h-9 flex-1 items-center justify-center gap-2 rounded-md px-3 text-[11px] font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/70 sm:flex-none ${
        active
          ? live
            ? "bg-cyan-500/12 text-cyan-700 shadow-sm dark:text-cyan-300"
            : "bg-emerald-500/12 text-emerald-700 shadow-sm dark:text-emerald-300"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      <Icon className="size-3.5" aria-hidden />
      {children}
    </button>
  );
}

function RoutePreview({
  mode,
  origin,
  destination,
  mapFocusRequest,
  onBackToSetup,
}: {
  mode: DashboardMode;
  origin: (typeof ORIGIN_ENDPOINTS)[number];
  destination: (typeof DESTINATION_ENDPOINTS)[number];
  mapFocusRequest: number;
  onBackToSetup?: () => void;
}) {
  const isLive = mode === "live";

  return (
    <section
      className={`dashboard-map relative isolate order-1 overflow-hidden lg:order-2 ${
        isLive
          ? "min-h-[calc(100dvh-126px)] sm:min-h-[calc(100dvh-76px)]"
          : "min-h-[54dvh] lg:min-h-[690px]"
      }`}
      aria-label={isLive ? "Live corridor route preview" : "Planned corridor route preview"}
    >
      <div
        className={
          isLive ? "absolute inset-x-0 top-0 h-[560px] sm:h-[620px] lg:h-full" : "absolute inset-0"
        }
      >
        <MapContainer
          live={isLive}
          origin={origin}
          destination={destination}
          focusRequest={mapFocusRequest}
        />
      </div>

      {isLive ? (
        <>
          <div className="relative z-20 p-3 sm:p-4 lg:p-6">
            <KpiHeader />
          </div>
          <VehicleTelemetry />
          <div className="absolute top-36 right-6 bottom-28 z-20 hidden w-[440px] space-y-3 overflow-y-auto lg:block">
            <div className="ml-auto w-[330px] space-y-3">
              {onBackToSetup && <RunSummary onBackToSetup={onBackToSetup} />}
              <IntersectionList />
            </div>
            <ItsConsole />
          </div>
          <div className="relative z-20 mt-[420px] grid gap-3 px-3 pb-3 sm:mt-[550px] sm:grid-cols-2 sm:px-4 lg:hidden">
            {onBackToSetup && (
              <div className="sm:col-span-2">
                <RunSummary onBackToSetup={onBackToSetup} />
              </div>
            )}
            <IntersectionList />
            <ItsConsole />
          </div>
        </>
      ) : (
        <>
          <div className="absolute top-4 left-4 z-20 flex items-center gap-3 rounded-xl border border-border/80 bg-card/88 px-4 py-3 shadow-xl backdrop-blur-xl sm:top-6 sm:left-6">
            <Route className="size-5 text-cyan-600 dark:text-cyan-300" aria-hidden />
            <div>
              <p className="dashboard-eyebrow">Planned response corridor</p>
              <strong className="mt-1 block font-mono text-xs">KRK-ROUTE-0942</strong>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function VehicleTelemetry() {
  const { liveTelemetry } = useSimulationState();
  return (
    <div className="absolute top-36 left-6 z-20 hidden w-[292px] space-y-3 lg:block">
      <div className="flex gap-3 rounded-xl border border-border/80 bg-card/88 p-4 shadow-xl backdrop-blur-xl">
        <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-cyan-500/12 text-cyan-600 dark:text-cyan-300">
          <Ambulance className="size-5" aria-hidden />
        </div>
        <div>
          <p className="dashboard-eyebrow">Priority vehicle</p>
          <h2 className="mt-1 font-mono text-sm font-bold">
            {liveTelemetry?.ambulance.id ?? "Awaiting telemetry"}
          </h2>
          <p className="mt-1 text-[10px] text-muted-foreground">Simulated vehicle telemetry</p>
        </div>
      </div>
      <div className="rounded-xl border border-border/80 bg-card/88 p-4 shadow-xl backdrop-blur-xl">
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>Vehicle telemetry</span>
          <Gauge className="size-4 text-cyan-600 dark:text-cyan-300" aria-hidden />
        </div>
        <div className="mt-4 flex items-end gap-2">
          <strong className="font-mono text-2xl">
            {liveTelemetry?.ambulance.speed_kmh.toFixed(1) ?? "—"}
          </strong>
          <span className="mb-1 text-[10px] text-muted-foreground">km/h</span>
          <b className="mb-1 ml-auto font-mono text-[10px] text-emerald-600 dark:text-emerald-400">
            {getFrontendConfig().transport === "mock" ? "MOCK" : "SIMULATED"}
          </b>
        </div>
        <div className="mt-2 h-1 rounded-full bg-muted">
          <span className="block h-full w-[72%] rounded-full bg-cyan-500" />
        </div>
        <div className="mt-3 flex justify-between font-mono text-[9px] text-muted-foreground">
          <span>
            POSITION · {getFrontendConfig().transport === "mock" ? "SYNTHETIC" : "SIMULATED"}
          </span>
          <span>TICK · {liveTelemetry?.tick ?? 0}</span>
        </div>
      </div>
    </div>
  );
}
