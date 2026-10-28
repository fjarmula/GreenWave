import { useEffect, useState, useSyncExternalStore } from "react";

import type { DispatchAdapter } from "@/lib/dispatch-adapter";
import { warsawMinute } from "@/lib/local-time";
import { toSimulationErrorInfo } from "@/lib/transport/errors";
import type {
  AddressProvenance,
  DispatchRankResponse,
  ErrorCode,
  GreenWaveMode,
  Position,
  ResourcesResponse,
  VehicleType,
} from "@/types/telemetry";

/** Where a searched address's coordinate comes from (ADR 0013); absent for a map pin. */
export type IncidentAddress = {
  provenance: AddressProvenance;
  osmDeltaM: number | null;
  disagreementM: number | null;
  osmPosition: Position | null;
  osmSameKeyElsewhere: boolean;
};

export type Incident = {
  position: Position;
  label: string;
  source: "address" | "map";
  address?: IncidentAddress;
};

/** A map click becomes the incident, labelled like "Pinned 50.0614, 19.9366". */
export function pinnedIncident(position: Position): Incident {
  return {
    position,
    label: `Pinned ${position.lat.toFixed(4)}, ${position.lng.toFixed(4)}`,
    source: "map",
  };
}

export type RankStatus = "idle" | "loading" | "ready" | "error";

/** A team's simulated status in the scenario; "unknown" sends no override (assumed free). */
export type TeamAvailability = "unknown" | "free" | "busy";

/** Kraków wall-clock "YYYY-MM-DDTHH:MM" (a `datetime-local` value), rounded down to 5 minutes. */
function scenarioTimeAt(date: Date): string {
  return warsawMinute(date, 5);
}

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
  /** The scenario's local time (ADR 0014): which PRM teams are on shift. */
  scenarioTime: string;
  /** Simulated team status by team code; a team left out is unknown (assumed free). */
  availability: Record<string, "free" | "busy">;
  /** Off: ambulances go to the nearest PRM base, ignoring shifts, availability and areas. */
  resourceAware: boolean;
  /** Which estimate the area rule compares: the page's run, green wave on the comparison. */
  rankTimeMode: GreenWaveMode;
  /** The roster and each team's shift at `scenarioTime`; `null` without the capability. */
  resources: ResourcesResponse | null;
};

/** Friendlier copy for some ranking errors; others show the backend's message (its limits). */
const RANK_ERROR_COPY: Partial<Record<ErrorCode, string>> = {
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
export function createIncidentDispatch(
  adapter: DispatchAdapter,
  now: () => Date = () => new Date(),
  initial: { trafficDensity: number } = { trafficDensity: 1 },
) {
  let state: IncidentDispatchState = {
    vehicleType: "AMBULANCE",
    incident: null,
    trafficDensity: initial.trafficDensity,
    ranking: null,
    rankStatus: "idle",
    rankError: null,
    selectedStationId: null,
    scenarioTime: scenarioTimeAt(now()),
    availability: {},
    resourceAware: true,
    rankTimeMode: "ENABLED",
    resources: null,
  };
  const listeners = new Set<() => void>();
  let sequence = 0;
  let inFlight: AbortController | null = null;
  let resourcesSequence = 0;
  let resourcesInFlight: AbortController | null = null;
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
          scenario_time: next.scenarioTime,
          time_mode: next.rankTimeMode,
          // Overrides are PRM ambulance teams; other vehicle types have none.
          availability: next.vehicleType === "AMBULANCE" ? next.availability : {},
          resource_aware: next.resourceAware,
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

  /** Fetches the roster at the scenario time; an older response never overwrites a newer one. */
  function refreshResources() {
    if (!adapter.capabilities.resources) return;
    resourcesInFlight?.abort();
    const controller = new AbortController();
    resourcesInFlight = controller;
    const current = ++resourcesSequence;
    // Shift flags belong to this exact scenario time; never show an older roster as current.
    update({ resources: null });
    adapter.listResources(state.scenarioTime, controller.signal).then(
      (resources) => {
        if (current === resourcesSequence) update({ resources });
      },
      () => {
        // Ranking still reports exclusions if the current roster cannot be loaded.
      },
    );
  }

  /** A team-only change re-ranks ambulances; otherwise it is remembered for the next ranking. */
  function rankIfAmbulance(patch: Partial<IncidentDispatchState>, keepSelection = false) {
    if (state.vehicleType === "AMBULANCE" && state.incident !== null) rank(patch, keepSelection);
    else update(patch);
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
      if (state.incident === null) {
        update({ trafficDensity });
        return;
      }
      // The shown standard times are for the old density: never "ready" until the re-rank.
      inFlight?.abort();
      inFlight = null;
      sequence += 1;
      update({ trafficDensity, rankStatus: "loading", rankError: null });
      cancelDensityRerank();
      densityTimer = setTimeout(() => rank({}, true), DENSITY_RERANK_DELAY_MS);
    },
    refreshResources,
    /** A new scenario time re-ranks (the pick resets: teams change) and re-fetches the roster. */
    setScenarioTime(scenarioTime: string) {
      if (scenarioTime === state.scenarioTime) return;
      if (state.incident === null) update({ scenarioTime });
      else rank({ scenarioTime });
      refreshResources();
    },
    /** "unknown" removes the override: the team is assumed free again. */
    setTeamAvailability(teamCode: string, value: TeamAvailability) {
      const availability = { ...state.availability };
      if (value === "unknown") delete availability[teamCode];
      else availability[teamCode] = value;
      rankIfAmbulance({ availability });
    },
    /** Turns team-aware ranking on or off (the candidates change, so the pick resets). */
    setResourceAware(resourceAware: boolean) {
      if (resourceAware === state.resourceAware) return;
      rankIfAmbulance({ resourceAware });
    },
    /** The page's estimate for the area rule; the same stations, so the pick is kept. */
    setRankTimeMode(rankTimeMode: GreenWaveMode) {
      if (rankTimeMode === state.rankTimeMode) return;
      rankIfAmbulance({ rankTimeMode }, true);
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
      resourcesSequence += 1;
      resourcesInFlight?.abort();
      resourcesInFlight = null;
    },
  };
}

export type IncidentDispatch = IncidentDispatchState & {
  setVehicleType: (vehicleType: VehicleType) => void;
  setIncident: (incident: Incident | null) => void;
  setTrafficDensity: (trafficDensity: number) => void;
  selectStation: (stationId: string) => void;
  setScenarioTime: (scenarioTime: string) => void;
  setTeamAvailability: (teamCode: string, value: TeamAvailability) => void;
  setResourceAware: (resourceAware: boolean) => void;
  setRankTimeMode: (mode: GreenWaveMode) => void;
};

export function useIncidentDispatch(
  adapter: DispatchAdapter,
  initial?: { trafficDensity: number },
): IncidentDispatch {
  const [dispatch] = useState(() => createIncidentDispatch(adapter, undefined, initial));
  const state = useSyncExternalStore(dispatch.subscribe, dispatch.getState, dispatch.getState);
  useEffect(() => {
    dispatch.refreshResources();
    return () => dispatch.dispose();
  }, [dispatch]);
  return {
    ...state,
    setVehicleType: dispatch.setVehicleType,
    setIncident: dispatch.setIncident,
    setTrafficDensity: dispatch.setTrafficDensity,
    selectStation: dispatch.selectStation,
    setScenarioTime: dispatch.setScenarioTime,
    setTeamAvailability: dispatch.setTeamAvailability,
    setResourceAware: dispatch.setResourceAware,
    setRankTimeMode: dispatch.setRankTimeMode,
  };
}
