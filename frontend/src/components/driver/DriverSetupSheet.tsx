"use client";
import { ArrowUpRight, ChevronRight, ShieldCheck, Target, TriangleAlert, Zap } from "lucide-react";
import type { ReactNode } from "react";

import { CascadeToggle } from "@/components/hud/dispatch/CascadeToggle";
import { ItsScenarioControl } from "@/components/hud/dispatch/ItsScenarioControl";
import { IncidentInput } from "@/components/hud/dispatch/IncidentInput";
import { PlaybackSpeedSelector } from "@/components/hud/dispatch/PlaybackSpeedSelector";
import { PreviousRunCard } from "@/components/hud/dispatch/PreviousRunCard";
import { PreflightEstimate } from "@/components/hud/dispatch/PreflightEstimate";
import { StationRanking } from "@/components/hud/dispatch/StationRanking";
import { TrafficDensityControl } from "@/components/hud/dispatch/TrafficDensityControl";
import { VehicleTypeControl } from "@/components/hud/dispatch/VehicleTypeControl";
import { getFrontendConfig } from "@/lib/config";
import type { DispatchAdapter } from "@/lib/dispatch-adapter";
import { settingsSummary } from "@/lib/driver-presentation";
import type { PreviousRun } from "@/lib/previous-run";
import type { DispatchSettings } from "@/lib/start-request";
import type { IncidentDispatch } from "@/lib/useIncidentDispatch";
import { pageCandidate, timeModeFor } from "@/lib/station-choice";

export function canStartDispatch(dispatch: IncidentDispatch) {
  return dispatch.rankStatus === "ready" && (dispatch.ranking?.candidates.length ?? 0) > 0;
}

/** Driver setup, always visible: where, which vehicle, a settings summary and the start. */
export function DriverSetupCard({
  dispatch,
  capabilities,
  geocode,
  settings,
  detailsOpen,
  onToggleDetails,
  notices,
  pending,
  replacement,
  errorMessage,
  onInitialize,
  startLabel = "Initialize green corridor",
}: {
  dispatch: IncidentDispatch;
  capabilities: DispatchAdapter["capabilities"];
  geocode: DispatchAdapter["geocode"];
  settings: DispatchSettings;
  detailsOpen: boolean;
  onToggleDetails: () => void;
  /** Ownership and replacement notices, shown above the start. */
  notices?: ReactNode;
  pending: boolean;
  replacement: boolean;
  errorMessage: string | null;
  onInitialize: () => void;
  startLabel?: string;
}) {
  const { incident } = dispatch;
  const incidentKey = incident
    ? `${incident.label}@${incident.position.lat},${incident.position.lng}`
    : "none";
  return (
    <section aria-labelledby="driver-setup-title" className="driver-setup">
      <h2 id="driver-setup-title" className="driver-setup-title">
        Where’s the incident?
      </h2>
      <div className="mt-3 space-y-4">
        <IncidentInput
          key={incidentKey}
          incident={incident}
          geocodeEnabled={capabilities.geocode}
          geocode={geocode}
          onIncidentChange={dispatch.setIncident}
        />
        <VehicleTypeControl value={dispatch.vehicleType} onChange={dispatch.setVehicleType} />
      </div>
      <button
        type="button"
        className="settings-summary pressable"
        aria-expanded={detailsOpen}
        onClick={onToggleDetails}
      >
        <span className="min-w-0 py-2 text-left">{settingsSummary(settings)}</span>
        <ChevronRight aria-hidden data-open={detailsOpen} />
      </button>
      {notices}
      <button
        type="button"
        data-testid="start-corridor"
        disabled={pending || !canStartDispatch(dispatch)}
        aria-busy={pending}
        onClick={onInitialize}
        className={`hud-primary pressable mt-3 ${pending ? "disabled:cursor-wait" : "disabled:cursor-not-allowed"}`}
      >
        <Zap className="size-4" aria-hidden />
        {pending ? "Computing route…" : replacement ? "Replace active simulation" : startLabel}
        <ArrowUpRight className="ml-auto size-4" aria-hidden />
      </button>
      {errorMessage && (
        <p role="alert" className="hud-alert tone-emergency mt-3">
          <TriangleAlert aria-hidden />
          {errorMessage}
        </p>
      )}
    </section>
  );
}

/** The full dispatch settings, one drag (or tap on the summary) away. */
export function DriverSetupDetails({
  dispatch,
  capabilities,
  settings,
  onSettingsChange,
  stationsError,
  onFocusMap,
  previousRun = null,
}: {
  dispatch: IncidentDispatch;
  capabilities: DispatchAdapter["capabilities"];
  settings: DispatchSettings;
  onSettingsChange: (settings: DispatchSettings) => void;
  stationsError: string | null;
  onFocusMap: () => void;
  previousRun?: PreviousRun | null;
}) {
  const update = (patch: Partial<DispatchSettings>) => onSettingsChange({ ...settings, ...patch });
  const isMockTransport = getFrontendConfig().transport === "mock";
  const timeMode = timeModeFor(settings.greenWaveMode, "simulation");
  const { incident, ranking } = dispatch;
  return (
    <section aria-label="Dispatch settings" className="driver-setup-details">
      <StationRanking
        ranking={ranking}
        rankStatus={dispatch.rankStatus}
        rankError={dispatch.rankError}
        roadTimeRanking={capabilities.roadTimeRanking}
        timeMode={timeMode}
        selectedStationId={dispatch.selectedStationId}
        onSelect={dispatch.selectStation}
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
      <TrafficDensityControl
        value={settings.trafficDensity}
        onChange={(value) => update({ trafficDensity: value })}
      />
      <CascadeToggle
        enabled={settings.cascadeEnabled}
        onToggle={() => update({ cascadeEnabled: !settings.cascadeEnabled })}
        disabled={settings.greenWaveMode === "DISABLED"}
      />
      <ItsScenarioControl
        value={settings.itsScenario ?? "NOMINAL"}
        disabled={settings.greenWaveMode === "DISABLED"}
        onChange={(value) => update({ itsScenario: value })}
      />
      <PlaybackSpeedSelector
        value={settings.playbackSpeed}
        onChange={(speed) => update({ playbackSpeed: speed })}
      />
      {previousRun && <PreviousRunCard run={previousRun} />}
      <PreflightEstimate
        isMockTransport={isMockTransport}
        trafficDensity={settings.trafficDensity}
        origin={
          canStartDispatch(dispatch)
            ? (pageCandidate(dispatch, timeMode)?.station.position ?? null)
            : null
        }
        incident={incident?.position ?? null}
        candidate={canStartDispatch(dispatch) ? pageCandidate(dispatch, timeMode) : null}
      />
      <p className="mt-5 flex items-center gap-2 text-2xs leading-relaxed text-muted-foreground">
        <ShieldCheck className="size-4 shrink-0 text-go" aria-hidden />
        {isMockTransport
          ? "Demo uses synthetic route estimates and sample signal telemetry."
          : "Route estimates come from the simulation backend. All signal states are simulated."}
      </p>
    </section>
  );
}
