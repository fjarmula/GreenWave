"use client";

import { Gauge, Radio, ShieldCheck, Target, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

import { DispatchStartButton } from "./dispatch/DispatchStartButton";
import { ItsScenarioControl } from "./dispatch/ItsScenarioControl";
import { CascadeToggle } from "@/components/hud/dispatch/CascadeToggle";
import { GreenWaveToggle } from "@/components/hud/dispatch/GreenWaveToggle";
import { IncidentInput } from "@/components/hud/dispatch/IncidentInput";
import { PlaybackSpeedSelector } from "@/components/hud/dispatch/PlaybackSpeedSelector";
import { PreflightEstimate } from "@/components/hud/dispatch/PreflightEstimate";
import { PreviousRunCard } from "@/components/hud/dispatch/PreviousRunCard";
import { ScenarioTimeInput } from "@/components/hud/dispatch/ScenarioTimeInput";
import { RankTimeModeSync } from "@/components/hud/dispatch/RankTimeModeSync";
import { ResourceAwareToggle } from "@/components/hud/dispatch/ResourceAwareToggle";
import { StationRanking } from "@/components/hud/dispatch/StationRanking";
import { TeamAvailabilityPanel } from "@/components/hud/dispatch/TeamAvailabilityPanel";
import { TrafficDensityControl } from "@/components/hud/dispatch/TrafficDensityControl";
import { VehicleTypeControl } from "@/components/hud/dispatch/VehicleTypeControl";
import { getFrontendConfig } from "@/lib/config";
import type { DispatchAdapter } from "@/lib/dispatch-adapter";
import type { PreviousRun } from "@/lib/previous-run";
import type { DispatchSettings } from "@/lib/start-request";
import type { IncidentDispatch } from "@/lib/useIncidentDispatch";
import { pageCandidate, timeModeFor } from "@/lib/station-choice";

type DispatchFormProps = {
  /** Owned by the dashboard so the chosen settings outlive each run. */
  settings: DispatchSettings;
  intent?: "simulation" | "comparison";
  modeLocked?: boolean;
  showStartAction?: boolean;
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
  showStartAction = true,
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
  const timeMode = timeModeFor(greenWaveMode, intent);
  const { incident, ranking, rankStatus, setRankTimeMode } = dispatch;
  const teamControls = dispatch.vehicleType === "AMBULANCE" && capabilities.resources;
  const teamDetails = teamControls && dispatch.resourceAware;
  const canStart = rankStatus === "ready" && (ranking?.candidates.length ?? 0) > 0;
  const incidentKey = incident
    ? `${incident.label}@${incident.position.lat},${incident.position.lng}`
    : "none";

  return (
    <aside className="p-5 sm:p-6 lg:h-full lg:overflow-y-auto">
      <RankTimeModeSync
        greenWaveMode={greenWaveMode}
        intent={intent}
        setRankTimeMode={setRankTimeMode}
      />
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
        {teamControls && (
          <ResourceAwareToggle
            enabled={dispatch.resourceAware}
            onChange={dispatch.setResourceAware}
          />
        )}
        {teamDetails && (
          <ScenarioTimeInput value={dispatch.scenarioTime} onChange={dispatch.setScenarioTime} />
        )}
      </div>

      <StationRanking
        ranking={ranking}
        rankStatus={rankStatus}
        rankError={dispatch.rankError}
        roadTimeRanking={capabilities.roadTimeRanking}
        timeMode={timeMode}
        selectedStationId={dispatch.selectedStationId}
        onSelect={dispatch.selectStation}
        teams={dispatch.resources?.teams}
      />
      {teamDetails && (
        <TeamAvailabilityPanel
          resources={dispatch.resources}
          availability={dispatch.availability}
          onChange={dispatch.setTeamAvailability}
        />
      )}

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
      <ItsScenarioControl
        value={settings.itsScenario ?? "NOMINAL"}
        disabled={intent !== "comparison" && greenWaveMode === "DISABLED"}
        onChange={(itsScenario) => update({ itsScenario })}
      />
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
      <p className="mt-3 text-xs text-muted-foreground">
        Times are model estimates. Simulated controller feedback may delay or end a run.
      </p>
      {previousRun && <PreviousRunCard run={previousRun} />}

      {showStartAction && (
        <div className="mt-7">
          <DispatchStartButton
            dispatch={dispatch}
            settings={settings}
            pending={pending}
            replacement={replacement}
            intent={intent}
            onInitialize={onInitialize}
          />
        </div>
      )}

      {errorMessage && (
        <p role="alert" className="hud-alert tone-emergency mt-3">
          <TriangleAlert aria-hidden />
          {errorMessage}
        </p>
      )}

      <PreflightEstimate
        isMockTransport={isMockTransport}
        trafficDensity={trafficDensity}
        origin={canStart ? (pageCandidate(dispatch, timeMode)?.station.position ?? null) : null}
        incident={incident?.position ?? null}
        candidate={canStart ? pageCandidate(dispatch, timeMode) : null}
      />

      <p className="mt-5 flex items-center gap-2 text-2xs leading-relaxed text-muted-foreground">
        <ShieldCheck className="size-4 shrink-0 text-go" aria-hidden />
        {isMockTransport
          ? "Demo uses synthetic route estimates and sample signal telemetry."
          : "Route estimates come from the simulation backend. All signal states are simulated."}
      </p>

      {children && <div className="mt-6">{children}</div>}
    </aside>
  );
}
