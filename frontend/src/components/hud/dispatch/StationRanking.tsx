import { Info, LoaderCircle, TriangleAlert } from "lucide-react";

import { formatMinutesSeconds } from "@/lib/format-duration";
import { SOURCE_KIND_LABELS } from "@/lib/station-copy";
import type { RankStatus } from "@/lib/useIncidentDispatch";
import type { DispatchRankResponse, RankedCandidate } from "@/types/telemetry";

type StationRankingProps = {
  ranking: DispatchRankResponse | null;
  rankStatus: RankStatus;
  rankError: string | null;
  /** False in mock mode: the choice is straight-line nearest, without road times. */
  roadTimeRanking: boolean;
};

export function StationRanking({
  ranking,
  rankStatus,
  rankError,
  roadTimeRanking,
}: StationRankingProps) {
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

  const [winner, ...runnersUp] = ranking.candidates;
  return (
    <div className="mt-4 space-y-2" aria-live="polite">
      {ranking.station_at_incident && (
        <p className="hud-alert tone-caution text-[11px]">
          <Info aria-hidden />A station of this type is at this location; dispatching from the next
          fastest.
        </p>
      )}
      <div className="rounded-xl border border-go/30 bg-go/8 p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="dashboard-eyebrow">Dispatching from</p>
          {!roadTimeRanking && (
            <span className="hud-chip tone-caution text-[10px]">Approximate (mock)</span>
          )}
        </div>
        <CandidateRow candidate={winner} roadTimeRanking={roadTimeRanking} emphasis />
      </div>
      {runnersUp.length > 0 && (
        <ol className="space-y-1.5 px-1" aria-label="Runners-up">
          {runnersUp.map((candidate) => (
            <li key={candidate.station.station_id}>
              <CandidateRow candidate={candidate} roadTimeRanking={roadTimeRanking} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function CandidateRow({
  candidate,
  roadTimeRanking,
  emphasis = false,
}: {
  candidate: RankedCandidate;
  roadTimeRanking: boolean;
  emphasis?: boolean;
}) {
  const { station } = candidate;
  return (
    <div className="mt-1 flex items-baseline justify-between gap-3">
      <div className="min-w-0">
        <p
          className={`truncate ${emphasis ? "text-sm font-semibold" : "text-xs"}`}
          title={station.name}
        >
          {station.name}
        </p>
        <p className="text-[10px] text-muted-foreground">
          {SOURCE_KIND_LABELS[station.source_kind]}
        </p>
      </div>
      <span
        className={`shrink-0 font-mono ${
          emphasis
            ? "hud-value text-sm font-semibold text-go"
            : "hud-value text-xs text-muted-foreground"
        }`}
      >
        {roadTimeRanking
          ? formatMinutesSeconds(Math.round(candidate.greenwave_seconds))
          : `${(candidate.distance_m / 1000).toFixed(1)} km`}
      </span>
    </div>
  );
}
