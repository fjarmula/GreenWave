import { LoaderCircle, TriangleAlert } from "lucide-react";
import { useId } from "react";

import { formatSignalDistance } from "@/lib/driver-presentation";
import { formatMinutesSeconds } from "@/lib/format-duration";
import {
  candidateDriveSeconds,
  candidateTotalSeconds,
  orderCandidates,
  pageCandidate,
  type TimeMode,
} from "@/lib/station-choice";
import { SOURCE_KIND_LABELS } from "@/lib/station-copy";
import type { RankStatus } from "@/lib/useIncidentDispatch";
import type { DispatchRankResponse, RankedCandidate } from "@/types/telemetry";

type StationRankingProps = {
  ranking: DispatchRankResponse | null;
  rankStatus: RankStatus;
  rankError: string | null;
  /** False in mock mode: the choice is straight-line nearest, without road times. */
  roadTimeRanking: boolean;
  /** The page's mode: its own times, order and "Fastest" chip; the comparison shows both. */
  timeMode: TimeMode;
  selectedStationId: string | null;
  onSelect: (stationId: string) => void;
};

export function StationRanking({
  ranking,
  rankStatus,
  rankError,
  roadTimeRanking,
  timeMode,
  selectedStationId,
  onSelect,
}: StationRankingProps) {
  const name = useId();
  if (rankStatus === "loading") {
    return (
      <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
        <LoaderCircle className="size-4 animate-spin text-beacon" aria-hidden />
        Ranking stations…
      </p>
    );
  }
  if (rankStatus === "error" && rankError) {
    return (
      <p role="alert" className="hud-alert tone-emergency mt-4">
        <TriangleAlert aria-hidden />
        {rankError}
      </p>
    );
  }
  if (!ranking) {
    return (
      <p className="mt-4 text-xs text-muted-foreground">
        Pick an incident location to choose the fastest station.
      </p>
    );
  }

  const ordered = orderCandidates(ranking.candidates, timeMode);
  const [fastest] = ordered;
  const selectedId = pageCandidate({ ranking, selectedStationId }, timeMode)?.station.station_id;
  return (
    <div className="mt-4 space-y-2" aria-live="polite">
      <fieldset className="station-choice">
        <legend className="flex w-full items-center justify-between gap-2 pb-1.5">
          <span className="dashboard-eyebrow">Dispatch from</span>
          {!roadTimeRanking && (
            <span className="hud-chip tone-caution text-2xs">Approximate (mock)</span>
          )}
        </legend>
        {ordered.map((candidate) => (
          <CandidateRow
            key={candidate.station.station_id}
            name={name}
            candidate={candidate}
            fastest={fastest}
            checked={candidate.station.station_id === selectedId}
            roadTimeRanking={roadTimeRanking}
            timeMode={timeMode}
            onSelect={onSelect}
          />
        ))}
      </fieldset>
    </div>
  );
}

function CandidateRow({
  name,
  candidate,
  fastest,
  checked,
  roadTimeRanking,
  timeMode,
  onSelect,
}: {
  name: string;
  candidate: RankedCandidate;
  fastest: RankedCandidate;
  checked: boolean;
  roadTimeRanking: boolean;
  timeMode: TimeMode;
  onSelect: (stationId: string) => void;
}) {
  const { station, on_foot: onFoot } = candidate;
  const isFastest = candidate === fastest;
  // The comparison keeps the green-wave order, so its deltas are green-wave deltas.
  const deltaMode = timeMode === "STANDARD" ? "STANDARD" : "GREENWAVE";
  const total = (mode: "GREENWAVE" | "STANDARD") =>
    formatMinutesSeconds(Math.round(candidateTotalSeconds(candidate, mode)));
  return (
    <label className="station-choice-row" data-checked={checked || undefined}>
      <input
        type="radio"
        className="sr-only"
        name={name}
        value={station.station_id}
        checked={checked}
        onChange={() => onSelect(station.station_id)}
      />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span
            className={`min-w-0 truncate text-sm ${checked ? "font-semibold" : "font-medium"}`}
            title={station.name}
          >
            {station.name}
          </span>
          {isFastest && <span className="hud-chip tone-go shrink-0 text-2xs">Fastest</span>}
          {candidate.on_site && (
            <span className="hud-chip tone-beacon shrink-0 text-2xs">On site</span>
          )}
        </span>
        <span className="block text-2xs text-muted-foreground">
          {SOURCE_KIND_LABELS[station.source_kind]}
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span
          className={`hud-value block font-mono text-sm ${
            checked ? "font-semibold text-go" : "text-muted-foreground"
          }`}
        >
          {!roadTimeRanking ? (
            `${(candidate.distance_m / 1000).toFixed(1)} km`
          ) : candidate.on_site ? (
            // No drive, so both modes take the same walk.
            total("GREENWAVE")
          ) : timeMode === "BOTH" ? (
            <>
              <span className="block" title="ER Green Wave">
                GW {total("GREENWAVE")}
              </span>
              <span className="block" title="Standard traffic">
                Std {total("STANDARD")}
              </span>
            </>
          ) : (
            total(timeMode)
          )}
        </span>
        {onFoot && (
          <span className="block text-2xs text-muted-foreground">
            {onFootLine(candidate, onFoot, roadTimeRanking, timeMode)}
          </span>
        )}
        {!isFastest && (
          <span className="block font-mono text-2xs text-muted-foreground">
            {roadTimeRanking
              ? `+${Math.round(candidateTotalSeconds(candidate, deltaMode) - candidateTotalSeconds(fastest, deltaMode))} s`
              : `+${((candidate.distance_m - fastest.distance_m) / 1000).toFixed(1)} km`}
          </span>
        )}
      </span>
    </label>
  );
}

/** "07m 02s drive + 09m 10s on foot · 650 m" with the page's own drive; the walk alone otherwise. */
function onFootLine(
  candidate: RankedCandidate,
  onFoot: NonNullable<RankedCandidate["on_foot"]>,
  roadTimeRanking: boolean,
  timeMode: TimeMode,
): string {
  const distance = formatSignalDistance(onFoot.distance_m);
  if (candidate.on_site) return `on foot · ${distance}`;
  if (!roadTimeRanking) return `incl. ${distance} on foot`;
  const walk = formatMinutesSeconds(Math.round(onFoot.seconds));
  if (timeMode === "BOTH") return `incl. ${walk} on foot · ${distance}`;
  const drive = formatMinutesSeconds(Math.round(candidateDriveSeconds(candidate, timeMode)));
  return `${drive} drive + ${walk} on foot · ${distance}`;
}
