import { cancelReasonLabel } from "@/lib/simulation-copy";
import type { createOperationSlot } from "@/lib/operation-slot";
import type { SimulationAdapter } from "@/lib/simulation-adapter";
import { connectSimulationStream } from "@/lib/simulation-controller";
import {
  initialSimulationState,
  simulationReducer,
  type SimulationAction,
  type SimulationState,
} from "@/lib/simulation-state";
import type { ComparisonStartRequest, SimulationStartRequest } from "@/types/telemetry";
import type { ComparisonMode, ComparisonRuns } from "./race";

export type { ComparisonMode };

export type LiveComparisonState = {
  status: "idle" | "starting" | "running" | "finished" | "cancelled" | "error";
  runs: ComparisonRuns;
  /** Route intersections that reached PRIORITY_GREEN in the Green Wave run. */
  priorityIds: string[];
  reason: string | null;
  /** Stop was requested and not yet answered. */
  stopping: boolean;
};

export const REPLACED_REASON = "Comparison replaced by another simulation";

const MODES: readonly ComparisonMode[] = ["ENABLED", "DISABLED"];

const idle: LiveComparisonState = {
  status: "idle",
  runs: { ENABLED: initialSimulationState, DISABLED: initialSimulationState },
  priorityIds: [],
  reason: null,
  stopping: false,
};

/** The single-run request of one pair member; both share every scenario field. */
export function comparisonMember(
  request: ComparisonStartRequest,
  mode: ComparisonMode,
): SimulationStartRequest {
  const { enabled_simulation_id, disabled_simulation_id, ...scenario } = request;
  return {
    ...scenario,
    simulation_id: mode === "ENABLED" ? enabled_simulation_id : disabled_simulation_id,
    green_wave_mode: mode,
  };
}

const ended = (run: SimulationState) =>
  run.simulationState === "FINISHED" ||
  run.simulationState === "CANCELLED" ||
  run.simulationState === "ERROR";

/**
 * Live comparison (ADR 0008): one comparison start, then both runs streamed at once. Each
 * run is its own `SimulationState`, driven by the same reducer and stream watchdog as a
 * single run. The comparison owns the operation slot until both runs have ended.
 */
export function createLiveComparisonController(
  adapter: SimulationAdapter,
  slot: ReturnType<typeof createOperationSlot>,
  timing: { staleAfterMilliseconds: number; lostAfterMilliseconds: number },
) {
  let state = idle;
  let generation = 0;
  let request: ComparisonStartRequest | null = null;
  let streams: (() => void)[] = [];
  const listeners = new Set<() => void>();

  const publish = (next: LiveComparisonState) => {
    state = next;
    listeners.forEach((listener) => listener());
  };
  const closeStreams = () => {
    const current = streams;
    streams = [];
    current.forEach((close) => close());
  };
  const finish = (status: LiveComparisonState["status"], reason: string | null) => {
    closeStreams();
    slot.release("comparison");
    publish({ ...state, status, reason, stopping: false });
  };

  const settle = () => {
    if (state.status !== "running" || !MODES.every((mode) => ended(state.runs[mode]))) return;
    const runs = MODES.map((mode) => state.runs[mode]);
    if (runs.some((run) => run.cancelReason === "SUPERSEDED")) finish("cancelled", REPLACED_REASON);
    else if (runs.some((run) => run.simulationState === "ERROR"))
      finish("error", runs.find((run) => run.error)?.error?.message ?? "Telemetry stopped");
    else if (runs.some((run) => run.cancelReason === "SERVER_ERROR"))
      finish("error", "The simulation stopped on the server");
    else if (runs.some((run) => run.cancelReason?.startsWith("ITS_"))) {
      const failed = runs.find((run) => run.cancelReason?.startsWith("ITS_"))!;
      finish("error", cancelReasonLabel(failed.cancelReason!));
    } else finish("finished", null);
  };

  const dispatchFor = (mode: ComparisonMode, token: number) => (action: SimulationAction) => {
    if (token !== generation) return;
    const run = simulationReducer(state.runs[mode], action);
    let priorityIds = state.priorityIds;
    if (mode === "ENABLED" && action.type === "TICK" && run !== state.runs[mode]) {
      const green = action.event.intersections
        .filter((intersection) => intersection.state === "PRIORITY_GREEN")
        .map((intersection) => intersection.id)
        .filter((id) => !priorityIds.includes(id));
      if (green.length) priorityIds = [...priorityIds, ...green];
    }
    publish({ ...state, runs: { ...state.runs, [mode]: run }, priorityIds });
    settle();
  };

  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async start(next: ComparisonStartRequest) {
      if (state.status === "starting" || state.status === "running") return;
      if (!slot.acquire("comparison")) {
        publish({
          ...idle,
          status: "error",
          reason: "Stop or explicitly replace the active simulation before comparing.",
        });
        return;
      }
      const token = ++generation;
      request = next;
      let runs = { ...idle.runs };
      for (const mode of MODES)
        runs = {
          ...runs,
          [mode]: simulationReducer(initialSimulationState, {
            type: "START_REQUESTED",
            request: comparisonMember(next, mode),
          }),
        };
      publish({ ...idle, status: "starting", runs });
      let pair;
      try {
        pair = await adapter.startComparison(next);
      } catch (error) {
        if (token !== generation) return;
        slot.release("comparison");
        publish({
          ...state,
          status: "error",
          reason: error instanceof Error ? error.message : "The comparison could not start",
        });
        return;
      }
      if (token !== generation) {
        // Reset while routing: the pair must not keep running unseen.
        void adapter.stop(next.enabled_simulation_id).catch(() => undefined);
        return;
      }
      const responses = { ENABLED: pair.enabled, DISABLED: pair.disabled };
      for (const mode of MODES)
        runs = {
          ...runs,
          [mode]: simulationReducer(runs[mode], {
            type: "START_SUCCEEDED",
            simulationId: responses[mode].simulation_id,
            response: responses[mode],
          }),
        };
      publish({ ...state, status: "running", runs });
      streams = MODES.map((mode) =>
        connectSimulationStream(
          adapter,
          responses[mode].simulation_id,
          dispatchFor(mode, token),
          timing.staleAfterMilliseconds,
          timing.lostAfterMilliseconds,
        ),
      );
    },
    /** Stops the pair: either id stops every live member (ADR 0008). */
    async stop() {
      if (state.status !== "running" || state.stopping || !request) return;
      const token = generation;
      publish({ ...state, stopping: true, reason: null });
      try {
        await adapter.stop(request.enabled_simulation_id);
      } catch (error) {
        if (token !== generation || state.status !== "running") return;
        publish({
          ...state,
          stopping: false,
          reason: `Could not stop: ${error instanceof Error ? error.message : "unknown error"}`,
        });
      }
    },
    /** Back to setup; a pair still running is stopped first (best effort). */
    reset() {
      const wasActive = state.status === "starting" || state.status === "running";
      generation++;
      closeStreams();
      if (wasActive && request)
        void adapter.stop(request.enabled_simulation_id).catch(() => undefined);
      request = null;
      slot.release("comparison");
      publish(idle);
    },
  };
}
