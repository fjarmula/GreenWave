"use client";

import { useCallback, useEffect, useState } from "react";
import { LoaderCircle, Settings2 } from "lucide-react";
import { useComparison } from "./ComparisonProvider";
import { ComparisonReplay, type ComparisonPane } from "./ComparisonReplay";
import { useScenario } from "@/components/scenario-provider";
import { useSimulationActions } from "@/components/simulation-runtime";
import { useSimulationState } from "@/components/simulation-provider";
import { WorkspaceNavigation } from "@/components/workspace/WorkspaceNavigation";
import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";
import { DispatchForm } from "@/components/hud/DispatchForm";
import { MapContainer } from "@/components/map/MapContainer";
import { dispatchAdapter } from "@/lib/dispatch-adapter";
import { buildStartRequest, type DispatchSettings } from "@/lib/start-request";
import { createSimulationId } from "@/lib/simulation-id";
import { pinnedIncident } from "@/lib/useIncidentDispatch";
import { advanceReplay, completionDelta, comparisonResultLabel } from "@/lib/comparison/replay";
import { formatMinutesSeconds } from "@/lib/format-duration";
import { getFrontendConfig } from "@/lib/config";
import type { PlaybackSpeed } from "@/lib/playback-speed";
import type { Position } from "@/types/telemetry";

export function ComparisonWorkspace() {
  const { controller, state } = useComparison();
  const {
    dispatch,
    settings,
    setSettings,
    stations,
    error: stationsError,
    retainResult,
  } = useScenario();
  const simulation = useSimulationState();
  const { prepareComparison } = useSimulationActions();
  const [editing, setEditing] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<PlaybackSpeed>(settings.playbackSpeed);
  const [pane, setPane] = useState<ComparisonPane>("enabled");
  const [mapFocusRequest, setMapFocusRequest] = useState(0);
  const pair = state.pair;
  const preparing = state.status === "recording" || state.status === "cancelling";
  const showReplay = !!pair && !editing;
  const duration = pair ? Math.max(pair.enabled.completion.tick, pair.disabled.completion.tick) : 0;
  const isPlaying = playing && showReplay && cursor < duration;
  const chosenStation = dispatch.ranking?.candidates[0]?.station ?? null;
  const { setIncident } = dispatch;
  const onMapClick = useCallback(
    (position: Position) => setIncident(pinnedIncident(position)),
    [setIncident],
  );
  const config = getFrontendConfig();
  const active =
    simulation.simulationState === "RUNNING" || simulation.simulationState === "STARTING";

  useEffect(() => {
    if (!isPlaying) return;
    let last = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      const delta = (now - last) / 1000;
      last = now;
      setCursor((current) =>
        advanceReplay(current, delta, true, !document.hidden, duration, speed),
      );
    }, 100);
    const visibility = () => {
      last = performance.now();
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [isPlaying, duration, speed]);

  const start = async (runSettings: DispatchSettings) => {
    if (!chosenStation || !dispatch.incident || preparing) return;
    if (active && !window.confirm("Stop the active simulation and record this comparison?")) return;
    retainResult(simulation);
    if (!(await prepareComparison())) return;
    setEditing(false);
    setCursor(0);
    setPlaying(false);
    setSpeed(runSettings.playbackSpeed);
    await controller.startComparison(
      buildStartRequest(
        chosenStation,
        dispatch.incident,
        dispatch.vehicleType,
        { ...runSettings, playbackSpeed: 10 },
        createSimulationId(),
      ),
    );
    if (controller.getState().status === "ready") setPlaying(true);
  };

  const preparationLabel =
    state.status === "cancelling"
      ? "Cancelling comparison…"
      : `Preparing ${state.mode === "DISABLED" ? "standard traffic" : "Green Wave"}`;
  return (
    <WorkspaceShell
      key={showReplay ? "replay" : "setup"}
      defaultDetails={!showReplay}
      provenance={`${config.transport === "mock" ? "Synthetic mock" : "Backend simulation"} · ${showReplay ? "Synchronized recorded replay" : "Comparison scenario"}`}
      header={
        <div className="min-w-0 flex-1">
          <WorkspaceNavigation current="/compare" />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="workspace-title">
              {showReplay ? "Green Wave vs standard traffic" : "Comparison setup"}
            </h1>
            {showReplay && (
              <button
                className="workspace-button workspace-button--quiet mt-2 max-md:mt-0"
                onClick={() => {
                  setPlaying(false);
                  setEditing(true);
                }}
              >
                <Settings2 aria-hidden />
                Change scenario
              </button>
            )}
          </div>
        </div>
      }
      map={
        showReplay && pair ? (
          <ComparisonReplay
            pair={pair}
            cursor={cursor}
            playing={isPlaying}
            speed={speed}
            pane={pane}
            onPlayPause={() => {
              if (cursor >= duration) setCursor(0);
              setPlaying(!isPlaying);
            }}
            onRestart={() => {
              setCursor(0);
              setPlaying(false);
            }}
            onSeek={setCursor}
            onSpeedChange={setSpeed}
            onPaneChange={setPane}
          />
        ) : (
          <div className="comparison-setup-map">
            <MapContainer
              live={false}
              origin={
                chosenStation
                  ? { label: chosenStation.name, position: chosenStation.position }
                  : null
              }
              destination={
                dispatch.incident
                  ? { label: dispatch.incident.label, position: dispatch.incident.position }
                  : null
              }
              focusRequest={mapFocusRequest}
              stations={stations}
              selectedVehicleType={dispatch.vehicleType}
              chosenStationId={chosenStation?.station_id ?? null}
              runnerUpIds={
                dispatch.ranking?.candidates
                  .slice(1)
                  .map((candidate) => candidate.station.station_id) ?? []
              }
              onMapClick={preparing ? () => {} : onMapClick}
            />
            {preparing && (
              <section
                className="comparison-preparation"
                aria-label="Comparison preparation"
                role="status"
              >
                <div className="flex items-center gap-3">
                  <span className="hud-icon tone-beacon">
                    <LoaderCircle className="motion-safe:animate-spin" aria-hidden />
                  </span>
                  <h2 className="hud-title text-lg">{preparationLabel}</h2>
                </div>
                <ol className="comparison-steps" aria-hidden>
                  <li data-state={state.mode === "DISABLED" ? "done" : "active"}>Green Wave</li>
                  <li data-state={state.mode === "DISABLED" ? "active" : "pending"}>
                    Standard traffic
                  </li>
                </ol>
                <p className="mt-3 text-sm">
                  {state.mode === "DISABLED" ? "2" : "1"} of 2 recordings ·{" "}
                  <span className="hud-value">{state.tick}</span> simulated seconds captured
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Both recordings will play together automatically once ready.
                </p>
                <button
                  className="workspace-button mt-4"
                  onClick={() => controller.cancelComparison()}
                >
                  Cancel recording
                </button>
              </section>
            )}
          </div>
        )
      }
      inspector={
        showReplay && pair ? (
          <div className="space-y-4 p-5">
            <div>
              <p className="dashboard-eyebrow">Recorded comparison</p>
              <h2 className="hud-title text-lg">Comparison results</h2>
            </div>
            <p
              className={`comparison-delta ${
                completionDelta(pair) > 0
                  ? "tone-go"
                  : completionDelta(pair) < 0
                    ? "tone-caution"
                    : ""
              }`}
            >
              <span className="hud-stat-label">Actual travel-time difference: </span>
              <span className="hud-value block text-3xl font-semibold">
                {formatMinutesSeconds(Math.abs(completionDelta(pair)))}
              </span>{" "}
              <span className="hud-chip mt-2">
                ({comparisonResultLabel(completionDelta(pair))})
              </span>
            </p>
            <p className="text-sm text-muted-foreground">
              Final travel times from two complete recordings of the same scenario. Arrival and
              signal-recovery completion are shown separately. Both maps use the playback clock
              below.
            </p>
            <dl className="grid grid-cols-2 gap-3">
              {[pair.enabled, pair.disabled].map((run) => (
                <div
                  key={run.request.green_wave_mode}
                  className={`hud-panel p-3 ${run.request.green_wave_mode === "ENABLED" ? "tone-go" : "tone-caution"}`}
                >
                  <dt className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <span aria-hidden className="size-1.5 rounded-full bg-(--tone)" />
                    {run.request.green_wave_mode === "ENABLED" ? "Green Wave" : "Standard traffic"}
                  </dt>
                  <dd className="hud-value mt-1 text-xl font-semibold">
                    {formatMinutesSeconds(run.completion.kpi_metrics.total_time_elapsed_sec)}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="hud-value text-xs text-muted-foreground">
              {pair.enabled.ticks.length + pair.disabled.ticks.length} validated frames ·{" "}
              {(state.bytes / 1024).toFixed(0)} KiB retained
            </p>
          </div>
        ) : preparing ? (
          <div className="space-y-4 p-5">
            <h2 className="hud-title text-lg">{preparationLabel}</h2>
            <p className="text-sm text-muted-foreground">
              The backend records one mode at a time at 10×. Then both maps play side by side on the
              same simulated clock.
            </p>
            <p className="hud-value text-sm">
              {state.tick} frames · {(state.bytes / 1024).toFixed(0)} KiB
            </p>
          </div>
        ) : (
          <>
            {state.reason && (
              <p role="alert" className="hud-alert tone-emergency m-4 text-sm">
                Incomplete: {state.reason}
              </p>
            )}
            {state.reason?.includes("Stop failed") && (
              <button
                className="workspace-button m-4"
                onClick={() => controller.cancelComparison()}
              >
                Retry Stop
              </button>
            )}
            {active && (
              <p role="status" className="hud-alert tone-caution m-4 block text-sm">
                Starting this comparison explicitly replaces the active simulation after a
                successful Stop.
              </p>
            )}
            {pair && (
              <button className="workspace-button m-4" onClick={() => setEditing(false)}>
                Return to comparison
              </button>
            )}
            <DispatchForm
              intent="comparison"
              settings={settings}
              onSettingsChange={setSettings}
              stationsError={stationsError}
              pending={simulation.simulationState === "STARTING" || preparing}
              replacement={active}
              errorMessage={null}
              dispatch={dispatch}
              capabilities={dispatchAdapter.capabilities}
              geocode={dispatchAdapter.geocode}
              onInitialize={(values) => void start(values)}
              onFocusMap={() => setMapFocusRequest((value) => value + 1)}
            />
          </>
        )
      }
    />
  );
}
