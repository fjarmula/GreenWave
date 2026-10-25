import type { Incident, IncidentDispatchState } from "@/lib/useIncidentDispatch";
import type {
  DispatchRankResponse,
  GreenWaveMode,
  OnFootLeg,
  RankedCandidate,
  Station,
  VehicleType,
} from "@/types/telemetry";

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

/** The incident is at the station (ADR 0012): no drive, only the walk; never a simulation. */
export function isOnSite(candidate: RankedCandidate | null): boolean {
  return candidate?.on_site === true;
}

/** An on-site answer, kept for the incident and vehicle type it was started for. */
export type OnSite = {
  station: Station;
  walk: OnFootLeg;
  incident: Incident;
  vehicleType: VehicleType;
};

/** What starting `candidate` shows instead of a run, or `null` when it drives. */
export function onSiteResult(
  candidate: RankedCandidate | null,
  incident: Incident | null,
  vehicleType: VehicleType,
): OnSite | null {
  if (!candidate || !isOnSite(candidate) || !candidate.on_foot || !incident) return null;
  return { station: candidate.station, walk: candidate.on_foot, incident, vehicleType };
}

/** The on-site answer while it still matches the setup; a new incident or vehicle drops it. */
export function shownOnSite(
  onSite: OnSite | null,
  dispatch: Pick<IncidentDispatchState, "incident" | "vehicleType">,
): OnSite | null {
  return onSite &&
    onSite.incident === dispatch.incident &&
    onSite.vehicleType === dispatch.vehicleType
    ? onSite
    : null;
}
