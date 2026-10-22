"use client";

import { MapContainer } from "@/components/map/MapContainer";
import { selectReplayFrame } from "@/lib/comparison/replay";
import type { ComparisonPair } from "@/lib/comparison/comparison-controller";
import type { RecordedRun } from "@/lib/comparison/recording";
import { PLAYBACK_SPEEDS, type PlaybackSpeed } from "@/lib/playback-speed";
import { formatMinutesSeconds } from "@/lib/format-duration";
import { VEHICLE_NAMES } from "@/lib/station-copy";

export type ComparisonPane = "enabled" | "disabled";

function ReplayPane({ run, cursor, label }: { run: RecordedRun; cursor: number; label: string }) {
  const snapshot = selectReplayFrame(run, cursor);
  const arrival = run.ticks.find((tick) => tick.ambulance.status === "ARRIVED")?.tick;
  return (
    <section className="comparison-pane" aria-label={`${label} recorded replay`}>
      <div className="comparison-pane-title">
        <h2 className="font-semibold">{label}</h2>
        <p className="text-sm text-muted-foreground">
          {VEHICLE_NAMES[run.request.vehicle_type]} ·{" "}
          {snapshot.liveTelemetry?.ambulance.status.replaceAll("_", " ").toLowerCase()}
        </p>
        <p className="text-xs text-muted-foreground">
          Arrival {arrival ?? "unknown"}s · recovery complete {run.completion.tick}s
        </p>
      </div>
      <div className="comparison-pane-map">
        <MapContainer
          live
          snapshot={snapshot}
          origin={{ label: "Recorded station", position: run.request.origin }}
          destination={{ label: "Recorded incident", position: run.request.destination }}
          focusRequest={0}
          stations={[]}
          selectedVehicleType={run.request.vehicle_type}
          chosenStationId={null}
          runnerUpIds={[]}
          onMapClick={() => {}}
        />
      </div>
    </section>
  );
}

type ComparisonReplayProps = {
  pair: ComparisonPair;
  cursor: number;
  playing: boolean;
  speed: PlaybackSpeed;
  pane: ComparisonPane;
  onPlayPause: () => void;
  onRestart: () => void;
  onSeek: (seconds: number) => void;
  onSpeedChange: (speed: PlaybackSpeed) => void;
  onPaneChange: (pane: ComparisonPane) => void;
};

export function ComparisonReplay({
  pair,
  cursor,
  playing,
  speed,
  pane,
  onPlayPause,
  onRestart,
  onSeek,
  onSpeedChange,
  onPaneChange,
}: ComparisonReplayProps) {
  const duration = Math.max(pair.enabled.completion.tick, pair.disabled.completion.tick);
  return (
    <div className="comparison-stage">
      <div className={`comparison-maps comparison-${pane}`}>
        <ReplayPane run={pair.enabled} cursor={cursor} label="Green Wave" />
        <ReplayPane run={pair.disabled} cursor={cursor} label="Standard traffic" />
      </div>
      <section className="comparison-transport" aria-label="Synchronized comparison playback">
        <div className="comparison-transport-actions">
          <button className="workspace-button" onClick={onPlayPause}>
            {playing ? "Pause replay" : cursor >= duration ? "Play again" : "Play replay"}
          </button>
          <button className="workspace-button" onClick={onRestart}>
            Restart replay
          </button>
          <label className="flex items-center gap-2 text-sm">
            Replay speed
            <select
              className="workspace-button"
              aria-label="Replay speed"
              value={speed}
              onChange={(event) => onSpeedChange(Number(event.target.value) as PlaybackSpeed)}
            >
              {PLAYBACK_SPEEDS.map((value) => (
                <option key={value} value={value}>
                  {value}×
                </option>
              ))}
            </select>
          </label>
          <label className="comparison-phone-toggle flex items-center gap-2 text-sm">
            Map
            <select
              className="workspace-button"
              aria-label="Phone pane"
              value={pane}
              onChange={(event) => onPaneChange(event.target.value as ComparisonPane)}
            >
              <option value="enabled">Green Wave</option>
              <option value="disabled">Standard traffic</option>
            </select>
          </label>
          <p className="text-sm text-muted-foreground">Recorded simulation · one shared clock</p>
        </div>
        <label className="comparison-timeline">
          <span className="text-sm tabular-nums">
            {formatMinutesSeconds(Math.floor(cursor))} / {formatMinutesSeconds(duration)}
          </span>
          <input
            aria-label="Replay time"
            type="range"
            min={0}
            max={duration}
            step={0.1}
            value={cursor}
            onChange={(event) => onSeek(Number(event.target.value))}
          />
        </label>
      </section>
    </div>
  );
}
