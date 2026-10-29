import {
  advanceMockSession,
  createMockSession,
  mockFallbackIds,
  type MockSession,
} from "@/lib/mock-session";
import { tickIntervalMilliseconds } from "@/lib/playback-speed";
import type { SimulationAdapter, SimulationStreamSubscriber } from "@/lib/simulation-adapter";
import { SimulationAdapterError } from "@/lib/transport/errors";
import type {
  CancelReason,
  SimulationCancelledEvent,
  SimulationCompletedEvent,
  SimulationTickEvent,
} from "@/types/telemetry";

/**
 * Offline demo transport (D22). It plays a scripted sample timeline that
 * imitates the documented thresholds so the dashboard can be shown without the
 * backend; it is not the simulation engine and its signal states are synthetic.
 *
 * Like the backend (ADR 0008) it runs one operation at a time: a single run or a
 * comparison pair. One timer advances every unfinished member by one simulated second
 * per interval, so the two runs of a pair never drift apart. Starting anything
 * supersedes the whole operation; stopping any member stops its live members.
 */
export function createMockSimulationAdapter(): SimulationAdapter {
  /** Unfinished members of the active operation, in start order. */
  let live: MockSession[] = [];
  /** Every member id of the active operation; an arrived member's id still stops the rest. */
  let operation: string[] = [];
  let timer: ReturnType<typeof setInterval> | null = null;
  const subscribers = new Map<string, Set<SimulationStreamSubscriber>>();

  const stopTimer = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };

  const endSession = (
    session: MockSession,
    terminal: SimulationCompletedEvent | SimulationCancelledEvent,
  ) => {
    session.controller.close();
    const id = session.request.simulation_id;
    live = live.filter((member) => member !== session);
    if (live.length === 0) stopTimer();
    const current = [...(subscribers.get(id) ?? [])];
    subscribers.delete(id);
    current.forEach((subscriber) => subscriber.onTerminal(terminal));
  };

  const cancelOperation = (reason: CancelReason) => {
    stopTimer();
    [...live].forEach((session) => endSession(session, cancelledEvent(session, reason)));
  };

  const emitNextTicks = () => {
    for (const session of [...live]) {
      const { tick, dispatch, completed, feedbacks } = advanceMockSession(session);
      const listeners = [...(subscribers.get(session.request.simulation_id) ?? [])];
      feedbacks.forEach((event) =>
        listeners.forEach((subscriber) => subscriber.onItsFeedback(event)),
      );
      if (dispatch) listeners.forEach((subscriber) => subscriber.onItsDispatch(dispatch));
      listeners.forEach((subscriber) => subscriber.onTick(tick));
      // A failed priority request only falls back at its junctions; it never ends the run.
      if (completed) endSession(session, completedEvent(tick, mockFallbackIds(session)));
    }
  };

  // Ticks start once every live member has a subscriber, so no member misses its first tick.
  const startTimer = () => {
    if (timer || live.length === 0) return;
    if (!live.every((session) => subscribers.get(session.request.simulation_id)?.size)) return;
    // One simulated second per tick; playback only shortens the wall-clock gap, as the backend.
    timer = setInterval(emitNextTicks, tickIntervalMilliseconds(live[0].request.playback_speed));
  };

  return {
    async start(request) {
      cancelOperation("SUPERSEDED");
      const session = createMockSession(request);
      live = [session];
      operation = [request.simulation_id];
      return session.route;
    },
    async startComparison(request) {
      if (request.enabled_simulation_id === request.disabled_simulation_id)
        throw new SimulationAdapterError({
          kind: "http",
          status: 422,
          message: "The two runs of a comparison need different simulation ids",
        });
      cancelOperation("SUPERSEDED");
      const { enabled_simulation_id, disabled_simulation_id, ...scenario } = request;
      const enabled = createMockSession({
        ...scenario,
        simulation_id: enabled_simulation_id,
        green_wave_mode: "ENABLED",
      });
      const disabled = createMockSession({
        ...scenario,
        simulation_id: disabled_simulation_id,
        green_wave_mode: "DISABLED",
      });
      live = [enabled, disabled];
      operation = [enabled_simulation_id, disabled_simulation_id];
      return {
        schema_version: "1.0",
        is_simulated: true,
        enabled: enabled.route,
        disabled: disabled.route,
      };
    },
    subscribe(simulationId, subscriber) {
      if (!live.some((session) => session.request.simulation_id === simulationId)) {
        subscriber.onConnectionChange("lost");
        subscriber.onError({
          kind: "http",
          status: 404,
          code: "SIMULATION_NOT_FOUND",
          message: "Simulation no longer exists",
        });
        return () => undefined;
      }
      const listeners = subscribers.get(simulationId) ?? new Set();
      subscribers.set(simulationId, listeners);
      listeners.add(subscriber);
      subscriber.onConnectionChange("open");
      startTimer();

      return () => {
        listeners.delete(subscriber);
        if (listeners.size === 0) subscribers.delete(simulationId);
        if (subscribers.size === 0) stopTimer();
      };
    },
    async stop(simulationId) {
      if (operation.includes(simulationId)) cancelOperation("STOPPED");
    },
  };
}

function cancelledEvent(session: MockSession, reason: CancelReason): SimulationCancelledEvent {
  return {
    schema_version: "1.0",
    is_simulated: true,
    event_type: "SIMULATION_CANCELLED",
    simulation_id: session.request.simulation_id,
    tick: session.tick,
    timestamp: new Date().toISOString(),
    reason,
  };
}

function completedEvent(
  tick: SimulationTickEvent,
  fallbackIntersectionIds: string[],
): SimulationCompletedEvent {
  return {
    schema_version: "1.0",
    is_simulated: true,
    event_type: "SIMULATION_COMPLETED",
    simulation_id: tick.simulation_id,
    tick: tick.tick,
    timestamp: tick.timestamp,
    kpi_metrics: tick.kpi_metrics,
    fallback_intersection_ids: fallbackIntersectionIds,
  };
}
