import type { SimulationAdapter } from "@/lib/simulation-adapter";
import type { SimulationAction } from "@/lib/simulation-state";
import { toSimulationErrorInfo } from "@/lib/transport/errors";
import type { SimulationStartRequest } from "@/types/telemetry";

type Dispatch = (action: SimulationAction) => void;

// The run each store last asked for; a start that resolves after it was replaced reports false.
const latestRequestedRun = new WeakMap<Dispatch, string | null>();

function isLatestRun(dispatch: Dispatch, simulationId: string): boolean {
  return latestRequestedRun.get(dispatch) === simulationId;
}

/**
 * Starts a run and reports the outcome to the reducer. Never rejects. A
 * `SIMULATION_ID_IN_USE` answer is retried once with a fresh id, unless the
 * user has gone back or started another run meanwhile. Resolves true only if
 * this run started and is still the one the user wants; a run that started
 * after it was abandoned is stopped so it does not keep ticking on the server.
 */
export async function requestSimulationStart(
  adapter: SimulationAdapter,
  request: SimulationStartRequest,
  dispatch: Dispatch,
  createSimulationId: () => string,
): Promise<boolean> {
  let current = request;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    latestRequestedRun.set(dispatch, current.simulation_id);
    dispatch({ type: "START_REQUESTED", request: current });
    try {
      const response = await adapter.start(current);
      if (response.simulation_id !== current.simulation_id) {
        dispatch({
          type: "START_FAILED",
          simulationId: current.simulation_id,
          error: { kind: "http", message: "Backend answered for a different simulation" },
        });
        return false;
      }
      if (!isLatestRun(dispatch, current.simulation_id)) {
        adapter.stop(current.simulation_id).catch(() => undefined);
        return false;
      }
      dispatch({ type: "START_SUCCEEDED", simulationId: current.simulation_id, response });
      return true;
    } catch (error) {
      if (!isLatestRun(dispatch, current.simulation_id)) return false;
      const info = toSimulationErrorInfo(error);
      if (info.code === "SIMULATION_ID_IN_USE" && attempt === 0) {
        current = { ...current, simulation_id: createSimulationId() };
        continue;
      }
      dispatch({ type: "START_FAILED", simulationId: current.simulation_id, error: info });
      return false;
    }
  }
  return false;
}

/** Resets the UI immediately and asks the adapter to stop the run in the background. */
export function requestSimulationStop(
  adapter: SimulationAdapter,
  simulationId: string | null,
  dispatch: Dispatch,
): void {
  latestRequestedRun.set(dispatch, null);
  dispatch({ type: "RESET" });
  if (!simulationId) return;
  // Stopping is best effort: an unknown or unreachable run is already gone for the user.
  adapter.stop(simulationId).catch(() => undefined);
}

/**
 * The live view's Stop: the run stays on screen while the stop is requested, then ends as
 * CANCELLED / STOPPED (also when the stream is down and the server's own terminal never arrives).
 * Never rejects; a failed stop leaves the run going and reports why.
 */
export async function requestRunStop(
  adapter: SimulationAdapter,
  simulationId: string,
  dispatch: Dispatch,
): Promise<void> {
  dispatch({ type: "STOP_REQUESTED", simulationId });
  try {
    await adapter.stop(simulationId);
  } catch (error) {
    dispatch({ type: "STOP_FAILED", simulationId, message: toSimulationErrorInfo(error).message });
    return;
  }
  dispatch({ type: "STOP_CONFIRMED", simulationId });
}

/**
 * Effect body for a RUNNING simulation: subscribes to the adapter, forwards
 * events to the reducer and watches for a silent stream. Returns the cleanup.
 * Callbacks arriving after cleanup are ignored, so React Strict Mode's
 * connect → cleanup → connect leaves exactly one live subscription.
 */
export function connectSimulationStream(
  adapter: SimulationAdapter,
  simulationId: string,
  dispatch: Dispatch,
  staleAfterMilliseconds: number,
  lostAfterMilliseconds: number,
): () => void {
  let active = true;
  let staleTimer: ReturnType<typeof setTimeout> | null = null;
  let silenceTimer: ReturnType<typeof setTimeout> | null = null;
  let unsubscribe: () => void = () => undefined;
  let reportedStale = false;
  let open = false;

  const clearStaleTimer = () => {
    if (staleTimer) clearTimeout(staleTimer);
    staleTimer = null;
  };
  const armStaleTimer = () => {
    clearStaleTimer();
    if (!open) return;
    staleTimer = setTimeout(() => {
      if (!active) return;
      reportedStale = true;
      dispatch({ type: "CONNECTION", simulationId, status: "reconnecting" });
    }, staleAfterMilliseconds);
  };
  // No data at all for this long (a backend that accepts the connection but stays silent,
  // or a reconnect that never completes): stop showing a spinner and report the loss.
  const armSilenceTimer = () => {
    if (silenceTimer) clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => {
      if (!active) return;
      stop();
      dispatch({
        type: "ERROR",
        simulationId,
        error: {
          kind: "network",
          reason: "timeout",
          message: `No simulated telemetry for ${Math.round(lostAfterMilliseconds / 1000)} s`,
        },
      });
    }, lostAfterMilliseconds);
  };
  const stop = () => {
    active = false;
    clearStaleTimer();
    if (silenceTimer) clearTimeout(silenceTimer);
    silenceTimer = null;
    unsubscribe();
  };
  const onActivity = () => {
    armSilenceTimer();
    if (reportedStale) {
      reportedStale = false;
      dispatch({ type: "CONNECTION", simulationId, status: "open" });
    }
    armStaleTimer();
  };

  armSilenceTimer();
  unsubscribe = adapter.subscribe(simulationId, {
    onTick: (event) => {
      if (!active) return;
      dispatch({ type: "TICK", event });
      onActivity();
    },
    onItsDispatch: (event) => {
      if (!active) return;
      dispatch({ type: "ITS_DISPATCH", event });
      onActivity();
    },
    onTerminal: (event) => {
      if (!active) return;
      stop();
      dispatch({ type: "TERMINAL", event });
    },
    onConnectionChange: (status) => {
      if (!active) return;
      open = status === "open";
      reportedStale = false;
      dispatch({ type: "CONNECTION", simulationId, status });
      if (open) armStaleTimer();
      else clearStaleTimer();
    },
    onError: (error) => {
      if (!active) return;
      stop();
      dispatch({ type: "ERROR", simulationId, error });
    },
  });

  return stop;
}
