import type { IncidentDispatchState } from "@/lib/useIncidentDispatch";
import type { DispatchRankResponse, GreenWaveMode, RankedCandidate } from "@/types/telemetry";

/** Which time a page shows: its own run's, or both on the comparison page. */
export type TimeMode = "GREENWAVE" | "STANDARD" | "BOTH";

/** The comparison shows both runs; a single-run page shows its own mode's time. */
export function timeModeFor(
  greenWaveMode: GreenWaveMode,
  intent: "simulation" | "comparison",
): TimeMode {
  if (intent === "comparison") return "BOTH";
  return greenWaveMode === "DISABLED" ? "STANDARD" : "GREENWAVE";
}

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

/**
 * The candidate a page starts from: the dispatcher's pick, else the fastest in the page's order
 * (the comparison keeps the backend's first).
 */
export function pageCandidate(
  state: Pick<IncidentDispatchState, "ranking" | "selectedStationId">,
  mode: TimeMode,
): RankedCandidate | null {
  const candidates = state.ranking?.candidates ?? [];
  return (
    candidates.find((candidate) => candidate.station.station_id === state.selectedStationId) ??
    orderCandidates(candidates, mode)[0] ??
    null
  );
}

/** Candidate IDs other than the resolved selection (`null` → the fastest), in ranking order. */
export function runnerUpIds(
  ranking: DispatchRankResponse | null,
  selectedId: string | null,
  mode: TimeMode = "BOTH",
): string[] {
  const selected = pageCandidate({ ranking, selectedStationId: selectedId }, mode);
  return (ranking?.candidates ?? [])
    .filter((candidate) => candidate !== selected)
    .map((candidate) => candidate.station.station_id);
}
