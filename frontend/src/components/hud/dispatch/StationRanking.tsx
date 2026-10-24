import { Info, LoaderCircle, TriangleAlert } from "lucide-react";
import { useId } from "react";

import { formatMinutesSeconds } from "@/lib/format-duration";
import { SOURCE_KIND_LABELS } from "@/lib/station-copy";
import { selectedCandidate, type RankStatus } from "@/lib/useIncidentDispatch";
import type { DispatchRankResponse, RankedCandidate } from "@/types/telemetry";

type StationRankingProps = {
  ranking: DispatchRankResponse | null;
  rankStatus: RankStatus;
  rankError: string | null;
  /** False in mock mode: the choice is straight-line nearest, without road times. */
  roadTimeRanking: boolean;
  selectedStationId: string | null;
  onSelect: (stationId: string) => void;
};

export function StationRanking({
  ranking,
  rankStatus,
  rankError,
  roadTimeRanking,
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

  const [fastest] = ranking.candidates;
  const selectedId = selectedCandidate({ ranking, selectedStationId })?.station.station_id;
  return (
    <div className="mt-4 space-y-2" aria-live="polite">
      {ranking.station_at_incident && (
        <p className="hud-alert tone-caution text-2xs">
          <Info aria-hidden />A station of this type is at this location; dispatching from the next
          fastest.
        </p>
      )}
      <fieldset className="station-choice">
        <legend className="flex w-full items-center justify-between gap-2 pb-1.5">
          <span className="dashboard-eyebrow">Dispatch from</span>
          {!roadTimeRanking && (
            <span className="hud-chip tone-caution text-2xs">Approximate (mock)</span>
          )}
        </legend>
        {ranking.candidates.map((candidate) => (
          <CandidateRow
            key={candidate.station.station_id}
            name={name}
            candidate={candidate}
            fastest={fastest}
            checked={candidate.station.station_id === selectedId}
            roadTimeRanking={roadTimeRanking}
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
  onSelect,
}: {
  name: string;
  candidate: RankedCandidate;
  fastest: RankedCandidate;
  checked: boolean;
  roadTimeRanking: boolean;
  onSelect: (stationId: string) => void;
}) {
  const { station } = candidate;
  const isFastest = candidate === fastest;
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
          {roadTimeRanking
            ? formatMinutesSeconds(Math.round(candidate.greenwave_seconds))
            : `${(candidate.distance_m / 1000).toFixed(1)} km`}
        </span>
        {!isFastest && (
          <span className="block font-mono text-2xs text-muted-foreground">
            {roadTimeRanking
              ? `+${Math.round(candidate.greenwave_seconds - fastest.greenwave_seconds)} s`
              : `+${((candidate.distance_m - fastest.distance_m) / 1000).toFixed(1)} km`}
          </span>
        )}
      </span>
    </label>
  );
}
