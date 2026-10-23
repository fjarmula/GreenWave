"use client";

import { ArrowUpRight, Gauge, Radio, ShieldCheck, Target, TriangleAlert, Zap } from "lucide-react";
import type { ReactNode } from "react";

import { CascadeToggle } from "@/components/hud/dispatch/CascadeToggle";
import { GreenWaveToggle } from "@/components/hud/dispatch/GreenWaveToggle";
import { IncidentInput } from "@/components/hud/dispatch/IncidentInput";
import { PlaybackSpeedSelector } from "@/components/hud/dispatch/PlaybackSpeedSelector";
import { PreflightEstimate } from "@/components/hud/dispatch/PreflightEstimate";
import { PreviousRunCard } from "@/components/hud/dispatch/PreviousRunCard";
import { StationRanking } from "@/components/hud/dispatch/StationRanking";
import { TrafficDensityControl } from "@/components/hud/dispatch/TrafficDensityControl";
import { VehicleTypeControl } from "@/components/hud/dispatch/VehicleTypeControl";
import { getFrontendConfig } from "@/lib/config";
import type { DispatchAdapter } from "@/lib/dispatch-adapter";
import type { PreviousRun } from "@/lib/previous-run";
import type { DispatchSettings } from "@/lib/start-request";
import type { IncidentDispatch } from "@/lib/useIncidentDispatch";

type DispatchFormProps = {
  /** Owned by the dashboard so the chosen settings outlive each run. */
  settings: DispatchSettings;
  intent?: "simulation" | "comparison";
  modeLocked?: boolean;
  replacement?: boolean;
  onSettingsChange: (settings: DispatchSettings) => void;
  /** The last finished run of this page session, shown for comparison. */
  previousRun?: PreviousRun | null;
  /** Why the station list could not be loaded, if it could not. */
  stationsError?: string | null;
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
  settings,
  intent = "simulation",
  modeLocked = false,
  replacement = false,
  onSettingsChange,
  previousRun = null,
  stationsError = null,
  onInitialize,
  pending,
  errorMessage,
  dispatch,
  capabilities,
  geocode,
  onFocusMap,
  children,
}: DispatchFormProps) {
  const { trafficDensity, cascadeEnabled, greenWaveMode, playbackSpeed } = settings;
  const update = (patch: Partial<DispatchSettings>) => onSettingsChange({ ...settings, ...patch });
  const isMockTransport = getFrontendConfig().transport === "mock";
  const { incident, ranking, rankStatus } = dispatch;
  const canStart = rankStatus === "ready" && (ranking?.candidates.length ?? 0) > 0;
  const incidentKey = incident
    ? `${incident.label}@${incident.position.lat},${incident.position.lng}`
    : "none";

  return (
    <aside className="p-5 sm:p-6 lg:h-full lg:overflow-y-auto">
      <div className="hud-head">
        <div>
          <p className="dashboard-eyebrow">Dispatch console / 01</p>
          <h2 className="hud-title text-lg">Incident dispatch</h2>
        </div>
        <span className="hud-icon tone-emergency">
          <Radio aria-hidden />
        </span>
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

      {stationsError && (
        <p role="alert" className="hud-alert tone-emergency mt-3">
          <TriangleAlert aria-hidden />
          {stationsError}
        </p>
      )}

      <button
        type="button"
        onClick={onFocusMap}
        disabled={!incident}
        className="hud-secondary tone-beacon pressable mt-4"
      >
        <Target aria-hidden />
        View station and incident
      </button>

      <div className="hud-divider" />

      <div className="hud-head">
        <div>
          <p className="dashboard-eyebrow">Simulation parameters</p>
          <h3 className="hud-title">Traffic model</h3>
        </div>
        <span className="hud-icon tone-beacon">
          <Gauge aria-hidden />
        </span>
      </div>

      <TrafficDensityControl
        value={trafficDensity}
        onChange={(value) => update({ trafficDensity: value })}
      />
      {intent === "comparison" ? (
        <p className="mt-5 text-sm font-medium">Green Wave and standard traffic · same scenario</p>
      ) : modeLocked ? (
        <p className={`hud-chip mt-5 ${greenWaveMode === "ENABLED" ? "tone-go" : "tone-caution"}`}>
          <span className="hud-dot" aria-hidden />
          {greenWaveMode === "ENABLED"
            ? "Green Wave enabled"
            : "Standard traffic · Green Wave disabled"}
        </p>
      ) : (
        <GreenWaveToggle
          mode={greenWaveMode}
          onChange={(mode) => update({ greenWaveMode: mode })}
        />
      )}
      <CascadeToggle
        enabled={cascadeEnabled}
        onToggle={() => update({ cascadeEnabled: !cascadeEnabled })}
        disabled={intent !== "comparison" && greenWaveMode === "DISABLED"}
      />
      <PlaybackSpeedSelector
        value={playbackSpeed}
        onChange={(speed) => update({ playbackSpeed: speed })}
      />

      {intent === "comparison" && (
        <p className="mt-4 text-sm text-muted-foreground">
          Both modes run at once on one simulated clock, side by side. Every displayed signal state
          is simulated.
        </p>
      )}
      {previousRun && <PreviousRunCard run={previousRun} />}

      <button
        type="button"
        data-testid="start-corridor"
        disabled={pending || !canStart}
        aria-busy={pending}
        onClick={() => onInitialize(settings)}
        className={`hud-primary pressable mt-7 ${pending ? "disabled:cursor-wait" : "disabled:cursor-not-allowed"}`}
      >
        <Zap className="size-4" aria-hidden />
        {pending
          ? "Computing route…"
          : intent === "comparison"
            ? replacement
              ? "Replace run & compare"
              : "Start comparison"
            : replacement
              ? "Replace active simulation"
              : greenWaveMode === "ENABLED"
                ? "Initialize green corridor"
                : "Start standard-traffic run"}
        <ArrowUpRight className="ml-auto size-4" aria-hidden />
      </button>

      {errorMessage && (
        <p role="alert" className="hud-alert tone-emergency mt-3">
          <TriangleAlert aria-hidden />
          {errorMessage}
        </p>
      )}

      <PreflightEstimate
        isMockTransport={isMockTransport}
        trafficDensity={trafficDensity}
        origin={canStart ? (ranking?.candidates[0]?.station.position ?? null) : null}
        incident={incident?.position ?? null}
      />

      <p className="mt-5 flex items-center gap-2 text-2xs leading-relaxed text-muted-foreground">
        <ShieldCheck className="size-4 shrink-0 text-go" aria-hidden />
        {isMockTransport
          ? "Demo uses synthetic route estimates and sample signal telemetry."
          : "Route estimates come from the simulation backend after initialization. All signal states are simulated."}
      </p>

      {children && <div className="mt-6">{children}</div>}
    </aside>
  );
}
