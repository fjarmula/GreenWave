import { advanceMockSession, createMockSession, type MockSession } from "@/lib/mock-session";
import { MOCK_STREAM_INTERVAL_MILLISECONDS } from "@/lib/mock-simulation-config";
import type { SimulationAdapter, SimulationStreamSubscriber } from "@/lib/simulation-adapter";
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
 */
export function createMockSimulationAdapter(): SimulationAdapter {
  let session: MockSession | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  const subscribers = new Set<SimulationStreamSubscriber>();

  const stopTimer = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };

  const endSession = (terminal: SimulationCompletedEvent | SimulationCancelledEvent) => {
    stopTimer();
    session = null;
    const current = [...subscribers];
    subscribers.clear();
    current.forEach((subscriber) => subscriber.onTerminal(terminal));
  };

  const cancel = (reason: CancelReason) => {
    if (!session) return;
    endSession(cancelledEvent(session, reason));
  };

  const emitNextTick = () => {
    if (!session) return;
    const { tick, dispatch, completed } = advanceMockSession(session);
    if (dispatch) subscribers.forEach((subscriber) => subscriber.onItsDispatch(dispatch));
    subscribers.forEach((subscriber) => subscriber.onTick(tick));
    if (completed) {
      endSession(completedEvent(tick));
    }
  };

  const startTimer = () => {
    if (!session || timer || subscribers.size === 0) return;
    timer = setInterval(emitNextTick, MOCK_STREAM_INTERVAL_MILLISECONDS);
  };

  return {
    async start(request) {
      cancel("SUPERSEDED");
      session = createMockSession(request);
      return session.route;
    },
    subscribe(simulationId, subscriber) {
      if (session?.request.simulation_id !== simulationId) {
        subscriber.onConnectionChange("lost");
        subscriber.onError({
          kind: "http",
          status: 404,
          code: "SIMULATION_NOT_FOUND",
          message: "Simulation no longer exists",
        });
        return () => undefined;
      }
      subscribers.add(subscriber);
      subscriber.onConnectionChange("open");
      startTimer();

      return () => {
        subscribers.delete(subscriber);
        if (subscribers.size === 0) stopTimer();
      };
    },
    async stop(simulationId) {
      if (session?.request.simulation_id === simulationId) cancel("STOPPED");
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

function completedEvent(tick: SimulationTickEvent): SimulationCompletedEvent {
  return {
    schema_version: "1.0",
    is_simulated: true,
    event_type: "SIMULATION_COMPLETED",
    simulation_id: tick.simulation_id,
    tick: tick.tick,
    timestamp: tick.timestamp,
    kpi_metrics: tick.kpi_metrics,
  };
}
