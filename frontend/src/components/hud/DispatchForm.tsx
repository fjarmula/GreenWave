"use client";

import { ArrowUpRight, Gauge, Radio, ShieldCheck, Target, TriangleAlert, Zap } from "lucide-react";
import { useState, type ReactNode } from "react";

import { CascadeToggle } from "@/components/hud/dispatch/CascadeToggle";
import { GreenWaveToggle } from "@/components/hud/dispatch/GreenWaveToggle";
import { IncidentInput } from "@/components/hud/dispatch/IncidentInput";
import { PlaybackSpeedSelector } from "@/components/hud/dispatch/PlaybackSpeedSelector";
import { PreflightEstimate } from "@/components/hud/dispatch/PreflightEstimate";
import { StationRanking } from "@/components/hud/dispatch/StationRanking";
import { TrafficDensityControl } from "@/components/hud/dispatch/TrafficDensityControl";
import { VehicleTypeControl } from "@/components/hud/dispatch/VehicleTypeControl";
import { getFrontendConfig } from "@/lib/config";
import type { DispatchAdapter } from "@/lib/dispatch-adapter";
import { DEFAULT_TRAFFIC_DENSITY_MULTIPLIER } from "@/lib/mock-simulation-config";
import type { PlaybackSpeed } from "@/lib/playback-speed";
import type { DispatchSettings } from "@/lib/start-request";
import type { IncidentDispatch } from "@/lib/useIncidentDispatch";
import type { GreenWaveMode } from "@/types/telemetry";

type DispatchFormProps = {
  /** Called only when a ranking exists; the dashboard starts from its best station. */
  onInitialize: (settings: DispatchSettings) => void;
  /** True while the start request is in flight (STARTING). */
  pending: boolean;
  /** Readable reason the last initialization failed, if any. */
  errorMessage: string | null;
  dispatch: IncidentDispatch;
  capabilities: DispatchAdapter["capabilities"];
  geocode: DispatchAdapter["geocode"];
  onFocusMap: () => void;
  /** Extra HUD panels rendered at the end of the console (e.g. data quality). */
  children?: ReactNode;
};

export function DispatchForm({
  onInitialize,
  pending,
  errorMessage,
  dispatch,
  capabilities,
  geocode,
  onFocusMap,
  children,
}: DispatchFormProps) {
  const [trafficDensity, setTrafficDensity] = useState(DEFAULT_TRAFFIC_DENSITY_MULTIPLIER);
  const [cascadeEnabled, setCascadeEnabled] = useState(true);
  const [greenWaveMode, setGreenWaveMode] = useState<GreenWaveMode>("ENABLED");
  const [playbackSpeed, setPlaybackSpeed] = useState<PlaybackSpeed>(1);
  const isMockTransport = getFrontendConfig().transport === "mock";
  const { incident, ranking, rankStatus } = dispatch;
  const canStart = rankStatus === "ready" && (ranking?.candidates.length ?? 0) > 0;
  const incidentKey = incident
    ? `${incident.label}@${incident.position.lat},${incident.position.lng}`
    : "none";

  return (
    <aside className="border-border/80 bg-card/95 p-5 shadow-2xl backdrop-blur-xl sm:p-6 lg:h-full lg:overflow-y-auto lg:border-r">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="dashboard-eyebrow">Dispatch console / 01</p>
          <h2 className="mt-1 text-lg font-semibold tracking-tight">Incident dispatch</h2>
        </div>
        <Radio className="size-5 text-emerald-500" aria-hidden />
      </div>

      <div className="mt-6 space-y-5">
        <VehicleTypeControl value={dispatch.vehicleType} onChange={dispatch.setVehicleType} />
        <IncidentInput
          key={incidentKey}
          incident={incident}
          geocodeEnabled={capabilities.geocode}
          geocode={geocode}
          onIncidentChange={dispatch.setIncident}
        />
      </div>

      <StationRanking
        ranking={ranking}
        rankStatus={rankStatus}
        rankError={dispatch.rankError}
        roadTimeRanking={capabilities.roadTimeRanking}
      />

      <button
        type="button"
        onClick={onFocusMap}
        disabled={!incident}
        className="mt-4 flex w-full items-center gap-2 rounded-lg border border-cyan-500/30 bg-cyan-500/8 px-3 py-2.5 text-left text-xs font-semibold text-cyan-700 transition hover:bg-cyan-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/70 disabled:cursor-not-allowed disabled:opacity-60 dark:text-cyan-300"
      >
        <Target className="size-4" aria-hidden />
        View station and incident
      </button>

      <div className="my-6 h-px bg-border" />

      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="dashboard-eyebrow">Simulation parameters</p>
          <h3 className="mt-1 text-sm font-semibold">Traffic model</h3>
        </div>
        <Gauge className="size-5 text-emerald-500" aria-hidden />
      </div>

      <TrafficDensityControl value={trafficDensity} onChange={setTrafficDensity} />
      <GreenWaveToggle mode={greenWaveMode} onChange={setGreenWaveMode} />
      <CascadeToggle
        enabled={cascadeEnabled}
        onToggle={() => setCascadeEnabled((enabled) => !enabled)}
        disabled={greenWaveMode === "DISABLED"}
      />
      <PlaybackSpeedSelector value={playbackSpeed} onChange={setPlaybackSpeed} />

      <button
        type="button"
        data-testid="start-corridor"
        disabled={pending || !canStart}
        aria-busy={pending}
        onClick={() =>
          onInitialize({ trafficDensity, cascadeEnabled, playbackSpeed, greenWaveMode })
        }
        className={`mt-7 flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-emerald-500 px-4 text-xs font-extrabold tracking-[0.08em] text-emerald-950 uppercase shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 disabled:opacity-70 disabled:hover:bg-emerald-500 ${pending ? "disabled:cursor-wait" : "disabled:cursor-not-allowed"}`}
      >
        <Zap className="size-4" aria-hidden />
        {pending
          ? "Computing route…"
          : greenWaveMode === "ENABLED"
            ? "Initialize green corridor"
            : "Start standard-traffic run"}
        <ArrowUpRight className="ml-auto size-4" aria-hidden />
      </button>

      {errorMessage && (
        <p
          role="alert"
          className="mt-3 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/8 px-3 py-2.5 text-xs font-medium text-red-700 dark:text-red-300"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {errorMessage}
        </p>
      )}

      <PreflightEstimate isMockTransport={isMockTransport} trafficDensity={trafficDensity} />

      <p className="mt-5 flex items-center gap-2 text-[10px] leading-relaxed text-muted-foreground">
        <ShieldCheck className="size-4 shrink-0 text-emerald-500" aria-hidden />
        {isMockTransport
          ? "Demo uses synthetic route estimates and sample signal telemetry."
          : "Route estimates come from the simulation backend after initialization. All signal states are simulated."}
      </p>

      {children && <div className="mt-6">{children}</div>}
    </aside>
  );
}
