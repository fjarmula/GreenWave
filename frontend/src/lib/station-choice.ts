import { selectedCandidate } from "@/lib/useIncidentDispatch";
import type { DispatchRankResponse, RankedCandidate } from "@/types/telemetry";

/** Drive estimate plus the walk from an off-road incident's access point: the ranking order. */
export function candidateTotalSeconds(candidate: RankedCandidate): number {
  return candidate.greenwave_seconds + (candidate.on_foot?.seconds ?? 0);
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
