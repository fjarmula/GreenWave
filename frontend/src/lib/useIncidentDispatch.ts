import { useEffect, useState, useSyncExternalStore } from "react";

import type { DispatchAdapter } from "@/lib/dispatch-adapter";
import { toSimulationErrorInfo } from "@/lib/transport/errors";
import type {
  DispatchRankResponse,
  ErrorCode,
  Position,
  RankedCandidate,
  VehicleType,
} from "@/types/telemetry";

export type Incident = { position: Position; label: string; source: "address" | "map" };

/** A map click becomes the incident, labelled like "Pinned 50.0614, 19.9366". */
export function pinnedIncident(position: Position): Incident {
  return {
    position,
    label: `Pinned ${position.lat.toFixed(4)}, ${position.lng.toFixed(4)}`,
    source: "map",
  };
}

export type RankStatus = "idle" | "loading" | "ready" | "error";

/** A density slider drag re-ranks once, this long after its last step. */
export const DENSITY_RERANK_DELAY_MS = 250;

export type IncidentDispatchState = {
  vehicleType: VehicleType;
  incident: Incident | null;
  /** The density the ranking's standard times are computed for (the run's own). */
  trafficDensity: number;
  ranking: DispatchRankResponse | null;
  rankStatus: RankStatus;
  rankError: string | null;
  /** The dispatcher's pick; `null` means the fastest. A re-rank resets it, except a density one. */
  selectedStationId: string | null;
};

/** The candidate the run starts from: the dispatcher's pick, else the fastest. */
export function selectedCandidate(
  state: Pick<IncidentDispatchState, "ranking" | "selectedStationId">,
): RankedCandidate | null {
  const candidates = state.ranking?.candidates ?? [];
  return (
    candidates.find((candidate) => candidate.station.station_id === state.selectedStationId) ??
    candidates[0] ??
    null
  );
}

const RANK_ERROR_COPY: Partial<Record<ErrorCode, string>> = {
  DESTINATION_OFF_NETWORK: "No vehicle access within 800 m of this location",
  NO_STATION_REACHABLE: "No station of this type can reach this location",
};

export function describeRankError(error: unknown): string {
  const info = toSimulationErrorInfo(error);
  return (info.code && RANK_ERROR_COPY[info.code]) ?? info.message;
}

/**
 * Vehicle type + incident + traffic density → station ranking, without React. Every change re-ranks:
 * the previous request is aborted and, should it still settle, discarded by its
 * sequence number, so an older response never overwrites a newer one.
 */
export function createIncidentDispatch(adapter: DispatchAdapter) {
  let state: IncidentDispatchState = {
    vehicleType: "AMBULANCE",
    incident: null,
    trafficDensity: 1,
    ranking: null,
    rankStatus: "idle",
    rankError: null,
    selectedStationId: null,
  };
  const listeners = new Set<() => void>();
  let sequence = 0;
  let inFlight: AbortController | null = null;
  let densityTimer: ReturnType<typeof setTimeout> | null = null;

  function cancelDensityRerank() {
    if (densityTimer !== null) clearTimeout(densityTimer);
    densityTimer = null;
  }

  function update(patch: Partial<IncidentDispatchState>) {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  }

  /** `keepSelection`: a density-only re-rank, whose candidates are the same stations. */
  function rank(patch: Partial<IncidentDispatchState>, keepSelection = false) {
    cancelDensityRerank();
    inFlight?.abort();
    inFlight = null;
    const current = ++sequence;
    const next = { ...state, ...patch };
    if (next.incident === null) {
      update({
        ...patch,
        ranking: null,
        rankStatus: "idle",
        rankError: null,
        selectedStationId: null,
      });
      return;
    }
    const controller = new AbortController();
    inFlight = controller;
    const kept = keepSelection ? state.selectedStationId : null;
    update({
      ...patch,
      ranking: null,
      rankStatus: "loading",
      rankError: null,
      selectedStationId: kept,
    });
    adapter
      .rank(
        {
          incident: next.incident.position,
          vehicle_type: next.vehicleType,
          traffic_density_multiplier: next.trafficDensity,
        },
        controller.signal,
      )
      .then(
        (ranking) => {
          if (current !== sequence) return;
          const stillListed = ranking.candidates.some((c) => c.station.station_id === kept);
          update({ ranking, rankStatus: "ready", selectedStationId: stillListed ? kept : null });
        },
        (error: unknown) => {
          if (current === sequence && !controller.signal.aborted) {
            update({ rankStatus: "error", rankError: describeRankError(error) });
          }
        },
      )
      .finally(() => {
        if (inFlight === controller) inFlight = null;
      });
  }

  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setVehicleType: (vehicleType: VehicleType) => rank({ vehicleType }),
    setIncident: (incident: Incident | null) => rank({ incident }),
    /**
     * Re-ranks for a new density (standard times depend on it), once a slider drag settles and
     * keeping the pick; the same value is a no-op. Without an incident it is only remembered.
     */
    setTrafficDensity(trafficDensity: number) {
      if (trafficDensity === state.trafficDensity) return;
      update({ trafficDensity });
      if (state.incident === null) return;
      cancelDensityRerank();
      densityTimer = setTimeout(() => rank({}, true), DENSITY_RERANK_DELAY_MS);
    },
    /** Picks a listed candidate; an ID outside the current ranking is ignored. */
    selectStation(stationId: string) {
      if (!state.ranking?.candidates.some((c) => c.station.station_id === stationId)) return;
      update({ selectedStationId: stationId });
    },
    /** Aborts the request in flight; the controller stays usable. */
    dispose() {
      cancelDensityRerank();
      sequence += 1;
      inFlight?.abort();
      inFlight = null;
    },
  };
}

export type IncidentDispatch = IncidentDispatchState & {
  setVehicleType: (vehicleType: VehicleType) => void;
  setIncident: (incident: Incident | null) => void;
  setTrafficDensity: (trafficDensity: number) => void;
  selectStation: (stationId: string) => void;
};

export function useIncidentDispatch(adapter: DispatchAdapter): IncidentDispatch {
  const [dispatch] = useState(() => createIncidentDispatch(adapter));
  const state = useSyncExternalStore(dispatch.subscribe, dispatch.getState, dispatch.getState);
  useEffect(() => () => dispatch.dispose(), [dispatch]);
  return {
    ...state,
    setVehicleType: dispatch.setVehicleType,
    setIncident: dispatch.setIncident,
    setTrafficDensity: dispatch.setTrafficDensity,
    selectStation: dispatch.selectStation,
  };
}
