import { useEffect, useState, useSyncExternalStore } from "react";

import type { DispatchAdapter } from "@/lib/dispatch-adapter";
import { toSimulationErrorInfo } from "@/lib/transport/errors";
import type { DispatchRankResponse, ErrorCode, Position, VehicleType } from "@/types/telemetry";

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

export type IncidentDispatchState = {
  vehicleType: VehicleType;
  incident: Incident | null;
  ranking: DispatchRankResponse | null;
  rankStatus: RankStatus;
  rankError: string | null;
};

const RANK_ERROR_COPY: Partial<Record<ErrorCode, string>> = {
  DESTINATION_OFF_NETWORK: "Location is off the road network",
  NO_STATION_REACHABLE: "No station of this type can reach this location",
};

export function describeRankError(error: unknown): string {
  const info = toSimulationErrorInfo(error);
  return (info.code && RANK_ERROR_COPY[info.code]) ?? info.message;
}

/**
 * Vehicle type + incident → station ranking, without React. Every change re-ranks:
 * the previous request is aborted and, should it still settle, discarded by its
 * sequence number, so an older response never overwrites a newer one.
 */
export function createIncidentDispatch(adapter: DispatchAdapter) {
  let state: IncidentDispatchState = {
    vehicleType: "AMBULANCE",
    incident: null,
    ranking: null,
    rankStatus: "idle",
    rankError: null,
  };
  const listeners = new Set<() => void>();
  let sequence = 0;
  let inFlight: AbortController | null = null;

  function update(patch: Partial<IncidentDispatchState>) {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  }

  function rank(patch: Partial<IncidentDispatchState>) {
    inFlight?.abort();
    inFlight = null;
    const next = { ...state, ...patch };
    if (next.incident === null) {
      update({ ...patch, ranking: null, rankStatus: "idle", rankError: null });
      return;
    }
    const current = ++sequence;
    const controller = new AbortController();
    inFlight = controller;
    update({ ...patch, ranking: null, rankStatus: "loading", rankError: null });
    adapter
      .rank({ incident: next.incident.position, vehicle_type: next.vehicleType }, controller.signal)
      .then(
        (ranking) => {
          if (current === sequence) update({ ranking, rankStatus: "ready" });
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
    /** Aborts the request in flight; the controller stays usable. */
    dispose() {
      sequence += 1;
      inFlight?.abort();
      inFlight = null;
    },
  };
}

export type IncidentDispatch = IncidentDispatchState & {
  setVehicleType: (vehicleType: VehicleType) => void;
  setIncident: (incident: Incident | null) => void;
};

export function useIncidentDispatch(adapter: DispatchAdapter): IncidentDispatch {
  const [dispatch] = useState(() => createIncidentDispatch(adapter));
  const state = useSyncExternalStore(dispatch.subscribe, dispatch.getState, dispatch.getState);
  useEffect(() => () => dispatch.dispose(), [dispatch]);
  return { ...state, setVehicleType: dispatch.setVehicleType, setIncident: dispatch.setIncident };
}
