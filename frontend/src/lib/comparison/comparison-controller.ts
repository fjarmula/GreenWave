import type { SimulationAdapter } from "@/lib/simulation-adapter";
import { connectSimulationStream } from "@/lib/simulation-controller";
import type { createOperationSlot } from "@/lib/operation-slot";
import {
  createRecording,
  sameScenarioRoutes,
  RECORDING_LIMITS,
  type RecordedRun,
} from "./recording";
import type { SimulationStartRequest } from "@/types/telemetry";
export type ComparisonPair = { enabled: RecordedRun; disabled: RecordedRun };
export type ComparisonState = {
  status: "idle" | "recording" | "cancelling" | "ready" | "incomplete";
  mode: "ENABLED" | "DISABLED" | null;
  tick: number;
  bytes: number;
  pair: ComparisonPair | null;
  reason: string | null;
};
const empty: ComparisonState = {
  status: "idle",
  mode: null,
  tick: 0,
  bytes: 0,
  pair: null,
  reason: null,
};
export function createComparisonController(
  adapter: SimulationAdapter,
  slot: ReturnType<typeof createOperationSlot>,
  createId: () => string,
) {
  let state = empty,
    generation = 0,
    busy = false,
    currentId: string | null = null,
    cleanup: (() => void) | null = null,
    rejectCapture: ((error: Error) => void) | null = null;
  const stopListening = () => {
    cleanup?.();
    cleanup = null;
  };
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<ComparisonState>) => {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  };
  async function stopCurrent() {
    if (currentId) await adapter.stop(currentId);
  }
  async function capture(
    request: SimulationStartRequest,
    token: number,
    previousBytes: number,
  ): Promise<RecordedRun> {
    currentId = request.simulation_id;
    const route = await adapter.start(request);
    if (token !== generation) {
      await stopCurrent();
      throw new Error("Recording cancelled");
    }
    const recorder = createRecording(request, route, {
      ...RECORDING_LIMITS,
      bytes: RECORDING_LIMITS.bytes - previousBytes,
    });
    return new Promise((resolve, reject) => {
      rejectCapture = reject;
      cleanup = connectSimulationStream(
        adapter,
        request.simulation_id,
        (action) => {
          if (token !== generation) return;
          try {
            if (action.type === "TICK") {
              recorder.tick(action.event);
              publish({ tick: recorder.frames, bytes: previousBytes + recorder.bytes });
            }
            if (action.type === "ITS_FEEDBACK") recorder.feedback(action.event);
            if (action.type === "ITS_DISPATCH") recorder.dispatch(action.event);
            if (action.type === "TERMINAL") {
              if (action.event.event_type !== "SIMULATION_COMPLETED")
                throw new Error("Recording ended without successful completion");
              resolve(recorder.finish(action.event));
            }
            if (action.type === "ERROR") throw new Error("Recording stream failed or timed out");
          } catch (error) {
            reject(error);
          }
        },
        3000,
        15000,
      );
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
    async startComparison(source: SimulationStartRequest) {
      if (busy) return;
      if (!slot.acquire("comparison")) {
        publish({
          ...empty,
          status: "incomplete",
          reason: "Stop or explicitly replace the active simulation before recording.",
        });
        return;
      }
      busy = true;
      const token = ++generation;
      const frozen = structuredClone(source);
      publish({ ...empty, status: "recording", mode: "ENABLED" });
      try {
        const enabled = await capture(
          {
            ...frozen,
            simulation_id: createId(),
            green_wave_mode: "ENABLED",
            its_scenario: "NOMINAL",
          },
          token,
          0,
        );
        stopListening();
        if (token !== generation) throw new Error("Recording cancelled");
        publish({ mode: "DISABLED", tick: 0 });
        const disabled = await capture(
          {
            ...frozen,
            simulation_id: createId(),
            green_wave_mode: "DISABLED",
            its_scenario: "NOMINAL",
          },
          token,
          enabled.bytes,
        );
        stopListening();
        if (token !== generation) throw new Error("Recording cancelled");
        if (!sameScenarioRoutes(enabled.route, disabled.route))
          throw new Error("Recorded routes do not match");
        publish({
          status: "ready",
          pair: { enabled, disabled },
          bytes: enabled.bytes + disabled.bytes,
          reason: null,
        });
      } catch (error) {
        stopListening();
        let reason = error instanceof Error ? error.message : "Recording failed";
        try {
          await stopCurrent();
        } catch {
          reason += ". Stop failed; retry Cancel before starting another run.";
          publish({ status: "incomplete", pair: null, bytes: 0, reason });
          busy = false;
          return;
        }
        publish({ status: "incomplete", pair: null, bytes: 0, reason });
      } finally {
        rejectCapture = null;
        if (state.status === "ready" || !state.reason?.includes("Stop failed")) {
          slot.release("comparison");
          currentId = null;
        }
        busy = false;
      }
    },
    cancelComparison() {
      if (!busy) {
        if (slot.getOwner() === "comparison")
          void stopCurrent()
            .then(() => {
              currentId = null;
              slot.release("comparison");
              publish({ reason: "Recording cancelled", status: "incomplete" });
            })
            .catch(() => publish({ reason: "Stop failed; retry Cancel." }));
        return;
      }
      generation++;
      publish({ status: "cancelling", pair: null });
      cleanup?.();
      cleanup = null;
      rejectCapture?.(new Error("Recording cancelled"));
    },
  };
}
