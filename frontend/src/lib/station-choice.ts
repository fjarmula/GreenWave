import { selectedCandidate } from "@/lib/useIncidentDispatch";
import type { DispatchRankResponse, RankedCandidate } from "@/types/telemetry";

/** Which time a page shows: its own run's, or both on the comparison page. */
export type TimeMode = "GREENWAVE" | "STANDARD" | "BOTH";

/** The drive estimate of one mode: the green-wave run or the standard-traffic run. */
export function candidateDriveSeconds(
  candidate: RankedCandidate,
  mode: "GREENWAVE" | "STANDARD",
): number {
  return mode === "STANDARD" ? candidate.standard_seconds : candidate.greenwave_seconds;
}

/** Drive estimate plus the walk from an off-road incident's access point. */
export function candidateTotalSeconds(
  candidate: RankedCandidate,
  mode: "GREENWAVE" | "STANDARD",
): number {
  return candidateDriveSeconds(candidate, mode) + (candidate.on_foot?.seconds ?? 0);
}

/**
 * Display order for a page: fastest total of its mode first, ties in backend order. The
 * comparison page keeps the backend (green-wave) order: both runs start from one station.
 */
export function orderCandidates(candidates: RankedCandidate[], mode: TimeMode): RankedCandidate[] {
  if (mode === "BOTH") return [...candidates];
  return [...candidates].sort(
    (a, b) => candidateTotalSeconds(a, mode) - candidateTotalSeconds(b, mode),
  );
}

/** Candidate IDs other than the resolved selection (`null` → the fastest), in ranking order. */
export function runnerUpIds(
  ranking: DispatchRankResponse | null,
  selectedId: string | null,
): string[] {
  const selected = selectedCandidate({ ranking, selectedStationId: selectedId });
  return (ranking?.candidates ?? [])
    .filter((candidate) => candidate !== selected)
    .map((candidate) => candidate.station.station_id);
}
