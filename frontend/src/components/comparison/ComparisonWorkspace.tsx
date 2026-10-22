"use client";

import { useCallback, useEffect, useState } from "react";
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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="workspace-title">
              {showReplay ? "Green Wave vs standard traffic" : "Comparison setup"}
            </h1>
            <div className="flex items-center gap-2">
              {showReplay && (
                <button
                  className="workspace-button"
                  onClick={() => {
                    setPlaying(false);
                    setEditing(true);
                  }}
                >
                  Change scenario
                </button>
              )}
            </div>
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
                <h2 className="text-xl font-semibold">{preparationLabel}</h2>
                <p className="mt-2 text-sm">
                  {state.mode === "DISABLED" ? "2" : "1"} of 2 recordings · {state.tick} simulated
                  seconds captured
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
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
            <h2 className="text-lg font-semibold">Comparison results</h2>
            <p>
              Actual travel-time difference: {formatMinutesSeconds(Math.abs(completionDelta(pair)))}{" "}
              ({comparisonResultLabel(completionDelta(pair))})
            </p>
            <p className="text-sm text-muted-foreground">
              Final travel times from two complete recordings of the same scenario. Arrival and
              signal-recovery completion are shown separately. Both maps use the playback clock
              below.
            </p>
            <dl className="grid grid-cols-2 gap-3">
              {[pair.enabled, pair.disabled].map((run) => (
                <div key={run.request.green_wave_mode}>
                  <dt className="text-sm text-muted-foreground">
                    {run.request.green_wave_mode === "ENABLED" ? "Green Wave" : "Standard traffic"}
                  </dt>
                  <dd className="mt-1 font-mono text-lg">
                    {formatMinutesSeconds(run.completion.kpi_metrics.total_time_elapsed_sec)}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="text-sm text-muted-foreground">
              {pair.enabled.ticks.length + pair.disabled.ticks.length} validated frames ·{" "}
              {(state.bytes / 1024).toFixed(0)} KiB retained
            </p>
          </div>
        ) : preparing ? (
          <div className="space-y-4 p-5">
            <h2 className="text-lg font-semibold">{preparationLabel}</h2>
            <p className="text-sm text-muted-foreground">
              The backend records one mode at a time at 10×. Then both maps play side by side on the
              same simulated clock.
            </p>
            <p>
              {state.tick} frames · {(state.bytes / 1024).toFixed(0)} KiB
            </p>
          </div>
        ) : (
          <>
            {state.reason && (
              <p role="alert" className="p-4 text-sm text-red-700 dark:text-red-300">
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
              <p role="status" className="p-4 text-sm">
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
