import { applyItsFeedback } from "./its-feedback-state";
import type { ConnectionStatus } from "@/lib/simulation-adapter";
import type { SimulationErrorInfo } from "@/lib/transport/errors";
import type {
  CancelReason,
  ItsDispatchEvent,
  ItsFeedbackEvent,
  ItsRequestSnapshot,
  SimulationCancelledEvent,
  SimulationCompletedEvent,
  SimulationStartRequest,
  SimulationStartResponse,
  SimulationTickEvent,
} from "@/types/telemetry";

export type SimulationPhase = "SETUP" | "STARTING" | "RUNNING" | "FINISHED" | "CANCELLED" | "ERROR";
export type { ConnectionStatus };
export type ItsLogEntry = { messageId: string; text: string };

const ITS_LOG_LIMIT = 20;

/**
 * Flat snapshot of the current run. `startRequest.simulation_id` identifies
 * the run: every action except START_REQUESTED and RESET must carry that id,
 * so late results of an abandoned run can never land in the next one.
 */
export type SimulationState = {
  simulationState: SimulationPhase;
  startRequest: SimulationStartRequest | null;
  routeData: SimulationStartResponse | null;
  liveTelemetry: SimulationTickEvent | null;
  /** Highest accepted tick; 0 before the first one. */
  lastTick: number;
  /** Stream health while RUNNING (and `lost` after a stream error); otherwise null. */
  connection: ConnectionStatus | null;
  itsLog: ItsLogEntry[];
  itsRequests: ItsRequestSnapshot[];
  lastFeedbackSequence: number;
  completion: SimulationCompletedEvent | null;
  cancelReason: CancelReason | null;
  error: SimulationErrorInfo | null;
  /** The user asked to stop the running run; it keeps RUNNING until the stop is confirmed. */
  stopRequested: boolean;
  /** Why the last stop request failed; the run is still going. */
  stopError: string | null;
};

export type SimulationAction =
  | { type: "START_REQUESTED"; request: SimulationStartRequest }
  | { type: "START_SUCCEEDED"; simulationId: string; response: SimulationStartResponse }
  | { type: "START_FAILED"; simulationId: string; error: SimulationErrorInfo }
  | { type: "TICK"; event: SimulationTickEvent }
  | { type: "ITS_FEEDBACK"; event: ItsFeedbackEvent }
  | { type: "ITS_DISPATCH"; event: ItsDispatchEvent }
  | { type: "CONNECTION"; simulationId: string; status: ConnectionStatus }
  | { type: "TERMINAL"; event: SimulationCompletedEvent | SimulationCancelledEvent }
  | { type: "ERROR"; simulationId: string; error: SimulationErrorInfo }
  | { type: "STOP_REQUESTED"; simulationId: string }
  | { type: "STOP_CONFIRMED"; simulationId: string }
  | { type: "STOP_FAILED"; simulationId: string; message: string }
  | { type: "RESET" };

export const initialSimulationState: SimulationState = {
  simulationState: "SETUP",
  startRequest: null,
  routeData: null,
  liveTelemetry: null,
  lastTick: 0,
  connection: null,
  itsLog: [],
  itsRequests: [],
  lastFeedbackSequence: 0,
  completion: null,
  cancelReason: null,
  error: null,
  stopRequested: false,
  stopError: null,
};

export function formatItsDispatch(event: ItsDispatchEvent): string {
  const { action, intersections_group: group, hold_duration_sec: hold } = event.payload;
  return `Simulated ${action} → ${group.join(", ")} · hold ${hold} s · ETA ${formatUtcTime(event.payload.expected_arrival_utc)}`;
}

function formatUtcTime(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  return Number.isNaN(date.getTime()) ? isoTimestamp : `${date.toISOString().slice(11, 19)}Z`;
}

/**
 * True when telemetry was flowing and stopped (reconnecting, lost, ended in an
 * error): the map must not present the last position as live. The initial
 * `connecting` is not stale; nothing has been received yet.
 */
export function isTelemetryStale({
  simulationState,
  connection,
}: Pick<SimulationState, "simulationState" | "connection">): boolean {
  return (
    simulationState === "ERROR" ||
    (simulationState === "RUNNING" && (connection === "reconnecting" || connection === "lost"))
  );
}

function cancelled(state: SimulationState, reason: CancelReason): SimulationState {
  return {
    ...state,
    simulationState: "CANCELLED",
    connection: null,
    cancelReason: reason,
    stopRequested: false,
  };
}

function isCurrentRun(state: SimulationState, simulationId: string): boolean {
  return state.startRequest?.simulation_id === simulationId;
}

export function simulationReducer(
  state: SimulationState,
  action: SimulationAction,
): SimulationState {
  switch (action.type) {
    case "START_REQUESTED":
      return {
        ...initialSimulationState,
        simulationState: "STARTING",
        startRequest: action.request,
      };
    case "START_SUCCEEDED":
      if (state.simulationState !== "STARTING" || !isCurrentRun(state, action.simulationId)) {
        return state;
      }
      return {
        ...state,
        simulationState: "RUNNING",
        routeData: action.response,
        connection: "connecting",
      };
    case "START_FAILED":
      if (state.simulationState !== "STARTING" || !isCurrentRun(state, action.simulationId)) {
        return state;
      }
      return { ...state, simulationState: "ERROR", error: action.error };
    case "TICK": {
      const { event } = action;
      if (
        state.simulationState !== "RUNNING" ||
        !isCurrentRun(state, event.simulation_id) ||
        event.tick <= state.lastTick
      ) {
        return state;
      }
      return {
        ...state,
        liveTelemetry: event,
        lastTick: event.tick,
        itsRequests: event.its_requests ?? [],
        lastFeedbackSequence: Math.max(
          state.lastFeedbackSequence,
          ...(event.its_requests ?? []).map((r) => r.last_feedback_sequence),
        ),
      };
    }
    case "ITS_FEEDBACK": {
      const { event } = action;
      if (
        state.simulationState !== "RUNNING" ||
        !isCurrentRun(state, event.simulation_id) ||
        event.feedback_sequence <= state.lastFeedbackSequence ||
        !event.intersections_group.every((id) =>
          state.routeData?.intersections_on_route.includes(id),
        )
      )
        return state;
      const itsRequests = applyItsFeedback(state.itsRequests, event, state.lastFeedbackSequence);
      if (!itsRequests) return state;
      return {
        ...state,
        itsRequests,
        lastFeedbackSequence: event.feedback_sequence,
        itsLog: [
          ...state.itsLog,
          {
            messageId: `feedback-${event.feedback_sequence}`,
            text: `Simulated ITS ${event.status} · ${event.request_message_id} · ${event.intersections_group.join(", ")} · ${event.observed_at_simulated_sec} s`,
          },
        ].slice(-ITS_LOG_LIMIT),
      };
    }
    case "ITS_DISPATCH": {
      const { event } = action;
      // A dispatch precedes the tick that produced it (D3), so its tick is always newer.
      if (
        state.simulationState !== "RUNNING" ||
        !isCurrentRun(state, event.simulation_id) ||
        event.tick <= state.lastTick ||
        state.itsLog.some((entry) => entry.messageId === event.message_id)
      ) {
        return state;
      }
      return {
        ...state,
        itsLog: [
          ...state.itsLog,
          { messageId: event.message_id, text: formatItsDispatch(event) },
        ].slice(-ITS_LOG_LIMIT),
      };
    }
    case "CONNECTION":
      if (
        state.simulationState !== "RUNNING" ||
        !isCurrentRun(state, action.simulationId) ||
        state.connection === action.status
      ) {
        return state;
      }
      return { ...state, connection: action.status };
    case "TERMINAL": {
      const { event } = action;
      // Final for the run whatever its tick (it normally repeats the last tick id, D3).
      if (state.simulationState !== "RUNNING" || !isCurrentRun(state, event.simulation_id)) {
        return state;
      }
      return event.event_type === "SIMULATION_COMPLETED"
        ? {
            ...state,
            simulationState: "FINISHED",
            connection: null,
            completion: event,
            stopRequested: false,
          }
        : cancelled(state, event.reason);
    }
    case "ERROR":
      if (
        (state.simulationState !== "STARTING" && state.simulationState !== "RUNNING") ||
        !isCurrentRun(state, action.simulationId)
      ) {
        return state;
      }
      return { ...state, simulationState: "ERROR", connection: "lost", error: action.error };
    case "STOP_REQUESTED":
      if (state.simulationState !== "RUNNING" || !isCurrentRun(state, action.simulationId)) {
        return state;
      }
      return { ...state, stopRequested: true, stopError: null };
    case "STOP_CONFIRMED":
      // The server's own STOPPED terminal may arrive first or not at all (stream down).
      if (state.simulationState !== "RUNNING" || !isCurrentRun(state, action.simulationId)) {
        return state;
      }
      return cancelled(state, "STOPPED");
    case "STOP_FAILED":
      if (state.simulationState !== "RUNNING" || !isCurrentRun(state, action.simulationId)) {
        return state;
      }
      return { ...state, stopRequested: false, stopError: action.message };
    case "RESET":
      return initialSimulationState;
  }
}
