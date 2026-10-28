"use client";
import { useTranslation } from "@/components/language-provider";
import { LoaderCircle, TriangleAlert } from "lucide-react";
import { useId } from "react";

import { ExcludedTeams } from "@/components/hud/dispatch/ExcludedTeams";
import { formatSignalDistance } from "@/lib/driver-presentation";
import { formatMinutesSeconds } from "@/lib/format-duration";
import {
  candidateDriveSeconds,
  candidateTotalSeconds,
  fastestCandidateId,
  isTeamRanked,
  orderCandidates,
  pageCandidate,
  type TimeMode,
} from "@/lib/station-choice";
import { SOURCE_KIND_LABELS } from "@/lib/station-copy";
import {
  ASSUMED_FREE_BADGE,
  noEligibleText,
  rosterBadgeText,
  scenarioClock,
  selectionReasonText,
} from "@/lib/team-dispatch-copy";
import type { RankStatus } from "@/lib/useIncidentDispatch";
import type { DispatchRankResponse, PrmTeam, RankedCandidate } from "@/types/telemetry";

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
  /** The roster at the scenario time, for the hours of excluded teams. */
  teams?: PrmTeam[];
};

export function StationRanking({
  ranking,
  rankStatus,
  rankError,
  roadTimeRanking,
  timeMode,
  selectedStationId,
  onSelect,
  teams,
}: StationRankingProps) {
  const { t } = useTranslation();
  const name = useId();
  if (rankStatus === "loading") {
    return (
      <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
        <LoaderCircle className="size-4 animate-spin text-beacon" aria-hidden />
        {t("Ranking stations…")}
      </p>
    );
  }
  if (rankStatus === "error" && rankError) {
    return (
      <p role="alert" className="hud-alert tone-emergency mt-4">
        <TriangleAlert aria-hidden />
        {t(rankError)}
      </p>
    );
  }
  if (!ranking) {
    return (
      <p className="mt-4 text-xs text-muted-foreground">
        {t("Pick an incident location to choose the fastest station.")}
      </p>
    );
  }

  const roster = ranking.roster && (
    <p className="text-2xs text-muted-foreground">{t(rosterBadgeText(ranking.roster))}</p>
  );
  if (ranking.outcome === "NO_ELIGIBLE_RESOURCE") {
    const count = (reason: string) =>
      ranking.excluded_teams.filter((team) => team.reason === reason).length;
    return (
      <div className="mt-4 space-y-2" aria-live="polite">
        <p role="alert" className="hud-alert tone-caution">
          <TriangleAlert aria-hidden />
          {t(
            noEligibleText(
              scenarioClock(ranking.scenario_time),
              count("OFF_SHIFT"),
              count("BUSY_OVERRIDE"),
            ),
          )}
        </p>
        <ExcludedTeams excluded={ranking.excluded_teams} teams={teams} />
        {t(roster)}
      </div>
    );
  }

  const ordered = orderCandidates(ranking.candidates, timeMode);
  // Team ranking: the first row is recommended (area rule); "Fastest" marks the lowest total.
  const teamRanked = isTeamRanked(ordered);
  const fastestId = teamRanked
    ? fastestCandidateId(ordered, timeMode)
    : ordered[0].station.station_id;
  const fastest = ordered.find((c) => c.station.station_id === fastestId) ?? ordered[0];
  const selectedId = pageCandidate({ ranking, selectedStationId }, timeMode)?.station.station_id;
  return (
    <div className="mt-4 space-y-2" aria-live="polite">
      <fieldset className="station-choice">
        <legend className="flex w-full items-center justify-between gap-2 pb-1.5">
          <span className="dashboard-eyebrow">{t("Dispatch from")}</span>
          {!roadTimeRanking && (
            <span className="hud-chip tone-caution text-2xs">{t("Approximate (mock)")}</span>
          )}
        </legend>
        {ordered.map((candidate) => (
          <CandidateRow
            key={candidate.station.station_id}
            name={name}
            candidate={candidate}
            fastest={fastest}
            recommended={teamRanked && candidate === ordered[0]}
            reason={
              teamRanked && candidate === ordered[0] && ranking.area_rule
                ? selectionReasonText(ranking.area_rule)
                : null
            }
            checked={candidate.station.station_id === selectedId}
            roadTimeRanking={roadTimeRanking}
            timeMode={timeMode}
            onSelect={onSelect}
          />
        ))}
      </fieldset>
      <ExcludedTeams excluded={ranking.excluded_teams} teams={teams} />
      {t(roster)}
    </div>
  );
}

function CandidateRow({
  name,
  candidate,
  fastest,
  recommended,
  reason,
  checked,
  roadTimeRanking,
  timeMode,
  onSelect,
}: {
  name: string;
  candidate: RankedCandidate;
  fastest: RankedCandidate;
  recommended: boolean;
  reason: string | null;
  checked: boolean;
  roadTimeRanking: boolean;
  timeMode: TimeMode;
  onSelect: (stationId: string) => void;
}) {
  const { t } = useTranslation();
  const { station, on_foot: onFoot, team } = candidate;
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
      <span
        className={`station-choice-name text-sm ${checked ? "font-semibold" : "font-medium"}`}
        title={t(station.name)}
      >
        {t(station.name)}
      </span>
      <span className="station-choice-time text-right">
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
              <span className="block" title={t("ER Green Wave")}>
                {t("GW ")}
                {t(total("GREENWAVE"))}
              </span>
              <span className="block" title={t("Standard traffic")}>
                {t("Std ")}
                {t(total("STANDARD"))}
              </span>
            </>
          ) : (
            total(timeMode)
          )}
        </span>
        {!isFastest && (
          <span className="block font-mono text-2xs text-muted-foreground">
            {t(
              roadTimeRanking
                ? `+${Math.round(candidateTotalSeconds(candidate, deltaMode) - candidateTotalSeconds(fastest, deltaMode))} s`
                : `+${((candidate.distance_m - fastest.distance_m) / 1000).toFixed(1)} km`,
            )}
          </span>
        )}
      </span>
      <span className="station-choice-meta text-2xs text-muted-foreground">
        {recommended && <span className="hud-chip tone-beacon text-2xs">{t("Recommended")}</span>}
        {candidate.on_site ? (
          <span className="hud-chip tone-beacon text-2xs">{t("On site")}</span>
        ) : (
          isFastest && <span className="hud-chip tone-go text-2xs">{t("Fastest")}</span>
        )}
        {team ? (
          <>
            <span className="font-mono font-medium text-foreground">{t(team.team_code)}</span>
            <span>{t(team.team_type)}</span>
            {team.in_area !== null && <span>{t(team.in_area ? "In area" : "Outside area")}</span>}
          </>
        ) : (
          <span>{t(SOURCE_KIND_LABELS[station.source_kind])}</span>
        )}
      </span>
      {team?.availability === "assumed_free" && (
        <span className="station-choice-note station-choice-assumption text-2xs">
          {t(ASSUMED_FREE_BADGE)}
        </span>
      )}
      {onFoot && (
        <span className="station-choice-note text-2xs text-muted-foreground">
          {t(onFootLine(candidate, onFoot, roadTimeRanking, timeMode))}
        </span>
      )}
      {reason && (
        <span className="station-choice-note text-2xs text-muted-foreground">{t(reason)}</span>
      )}
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
