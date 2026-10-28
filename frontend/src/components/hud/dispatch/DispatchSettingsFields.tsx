"use client";

import { Gauge, ShieldCheck, Target, TriangleAlert } from "lucide-react";

import { CascadeToggle } from "@/components/hud/dispatch/CascadeToggle";
import { GreenWaveToggle } from "@/components/hud/dispatch/GreenWaveToggle";
import { ItsScenarioControl } from "@/components/hud/dispatch/ItsScenarioControl";
import { PlaybackSpeedSelector } from "@/components/hud/dispatch/PlaybackSpeedSelector";
import { PreflightEstimate } from "@/components/hud/dispatch/PreflightEstimate";
import { PreviousRunCard } from "@/components/hud/dispatch/PreviousRunCard";
import { RankTimeModeSync } from "@/components/hud/dispatch/RankTimeModeSync";
import { ResourceAwareToggle } from "@/components/hud/dispatch/ResourceAwareToggle";
import { ScenarioTimeInput } from "@/components/hud/dispatch/ScenarioTimeInput";
import { StationRanking } from "@/components/hud/dispatch/StationRanking";
import { TeamAvailabilityPanel } from "@/components/hud/dispatch/TeamAvailabilityPanel";
import { TrafficDensityControl } from "@/components/hud/dispatch/TrafficDensityControl";
import { getFrontendConfig } from "@/lib/config";
import type { DispatchAdapter } from "@/lib/dispatch-adapter";
import type { PreviousRun } from "@/lib/previous-run";
import type { DispatchSettings } from "@/lib/start-request";
import type { IncidentDispatch } from "@/lib/useIncidentDispatch";
import { canStart, pageCandidate, timeModeFor } from "@/lib/station-choice";

/** Every dispatch setting below the incident, in one order for the desktop panel and phone sheet. */
export function DispatchSettingsFields({
  dispatch,
  settings,
  onSettingsChange,
  intent = "simulation",
  modeLocked = false,
  capabilities,
  stationsError = null,
  onFocusMap,
  previousRun = null,
  layout,
}: {
  dispatch: IncidentDispatch;
  /** Owned by the page so the chosen settings outlive each run. */
  settings: DispatchSettings;
  onSettingsChange: (settings: DispatchSettings) => void;
  intent?: "simulation" | "comparison";
  /** The page fixes the Green Wave mode; it is shown, not toggled. */
  modeLocked?: boolean;
  capabilities: DispatchAdapter["capabilities"];
  /** Why the station list could not be loaded, if it could not. */
  stationsError?: string | null;
  onFocusMap: () => void;
  /** The last finished run of this page session, shown for comparison. */
  previousRun?: PreviousRun | null;
  /** The desktop panel titles the traffic model; the phone sheet stays compact. */
  layout: "panel" | "sheet";
}) {
  const { trafficDensity, cascadeEnabled, greenWaveMode, playbackSpeed } = settings;
  const update = (patch: Partial<DispatchSettings>) => onSettingsChange({ ...settings, ...patch });
  const isMockTransport = getFrontendConfig().transport === "mock";
  const timeMode = timeModeFor(greenWaveMode, intent);
  const { incident } = dispatch;
  const teamControls = dispatch.vehicleType === "AMBULANCE" && capabilities.resources;
  const teamDetails = teamControls && dispatch.resourceAware;
  const candidate = canStart(dispatch) ? pageCandidate(dispatch, timeMode) : null;
  const greenWaveOff = intent !== "comparison" && greenWaveMode === "DISABLED";

  return (
    <>
      <RankTimeModeSync
        greenWaveMode={greenWaveMode}
        intent={intent}
        setRankTimeMode={dispatch.setRankTimeMode}
      />
      {teamControls && (
        <div className="mt-5 space-y-5">
          <ResourceAwareToggle
            enabled={dispatch.resourceAware}
            onChange={dispatch.setResourceAware}
          />
          {teamDetails && (
            <ScenarioTimeInput value={dispatch.scenarioTime} onChange={dispatch.setScenarioTime} />
          )}
        </div>
      )}

      <StationRanking
        ranking={dispatch.ranking}
        rankStatus={dispatch.rankStatus}
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

      {layout === "panel" && (
        <div className="hud-head">
          <div>
            <p className="dashboard-eyebrow">Simulation parameters</p>
            <h3 className="hud-title">Traffic model</h3>
          </div>
          <span className="hud-icon tone-beacon">
            <Gauge aria-hidden />
          </span>
        </div>
      )}

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
        disabled={greenWaveOff}
        onChange={(itsScenario) => update({ itsScenario })}
      />
      <CascadeToggle
        enabled={cascadeEnabled}
        onToggle={() => update({ cascadeEnabled: !cascadeEnabled })}
        disabled={greenWaveOff}
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

      <PreflightEstimate
        isMockTransport={isMockTransport}
        trafficDensity={trafficDensity}
        origin={candidate?.station.position ?? null}
        incident={incident?.position ?? null}
        candidate={candidate}
      />

      <p className="mt-5 flex items-center gap-2 text-2xs leading-relaxed text-muted-foreground">
        <ShieldCheck className="size-4 shrink-0 text-go" aria-hidden />
        {isMockTransport
          ? "Demo uses synthetic route estimates and sample signal telemetry."
          : "Route estimates come from the simulation backend. All signal states are simulated."}
      </p>
    </>
  );
}
