import { selectedCandidate } from "@/lib/useIncidentDispatch";
import type { DispatchRankResponse } from "@/types/telemetry";

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
