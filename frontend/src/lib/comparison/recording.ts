import type {
  ItsDispatchEvent,
  ItsFeedbackEvent,
  SimulationCompletedEvent,
  SimulationStartRequest,
  SimulationStartResponse,
  SimulationTickEvent,
} from "@/types/telemetry";
export type RecordedRun = {
  request: SimulationStartRequest;
  route: SimulationStartResponse;
  ticks: SimulationTickEvent[];
  dispatches: ItsDispatchEvent[];
  feedbacks: ItsFeedbackEvent[];
  completion: SimulationCompletedEvent;
  bytes: number;
};
export const RECORDING_LIMITS = { frames: 10000, bytes: 32 * 1024 * 1024 };
export function sameScenarioRoutes(a: SimulationStartResponse, b: SimulationStartResponse) {
  return (
    JSON.stringify([
      a.route_geometry,
      a.origin_snapped,
      a.destination_snapped,
      a.total_distance_m,
    ]) ===
    JSON.stringify([b.route_geometry, b.origin_snapped, b.destination_snapped, b.total_distance_m])
  );
}
export function createRecording(
  request: SimulationStartRequest,
  route: SimulationStartResponse,
  limits = RECORDING_LIMITS,
) {
  if (route.simulation_id !== request.simulation_id) throw new Error("Recording run mismatch");
  if (route.green_wave_mode !== request.green_wave_mode) throw new Error("Recording mode mismatch");
  const ticks: SimulationTickEvent[] = [],
    dispatches: ItsDispatchEvent[] = [];
  const feedbacks: ItsFeedbackEvent[] = [];
  // Conservative allowance covers run/pair keys, array brackets and bytes metadata.
  let bytes = 256;
  const count = (value: unknown) => {
    bytes += new TextEncoder().encode(JSON.stringify(value)).byteLength + 1;
    if (bytes > limits.bytes) throw new Error("Recording byte limit exceeded");
  };
  const checkId = (id: string) => {
    if (id !== request.simulation_id) throw new Error("Recording run mismatch");
  };
  count(request);
  count(route);
  return {
    tick(event: SimulationTickEvent) {
      checkId(event.simulation_id);
      if (event.tick <= ticks.length) {
        if (JSON.stringify(ticks[event.tick - 1]) !== JSON.stringify(event))
          throw new Error("Conflicting duplicate tick");
        return;
      }
      if (event.tick !== ticks.length + 1) throw new Error("Incomplete tick coverage");
      if (ticks.length >= limits.frames) throw new Error("Recording frame limit exceeded");
      count(event);
      ticks.push(event);
    },
    dispatch(event: ItsDispatchEvent) {
      checkId(event.simulation_id);
      if (dispatches.some((d) => d.message_id === event.message_id)) return;
      count(event);
      dispatches.push(event);
    },
    feedback(event: ItsFeedbackEvent) {
      checkId(event.simulation_id);
      if (feedbacks.some((f) => f.feedback_sequence === event.feedback_sequence)) return;
      count(event);
      feedbacks.push(event);
    },
    finish(event: SimulationCompletedEvent): RecordedRun {
      checkId(event.simulation_id);
      if (!ticks.length || event.tick !== ticks.length)
        throw new Error("Incomplete terminal coverage");
      if (
        ticks.some((t) =>
          (t.its_requests ?? []).some((r) =>
            ["REJECTED", "TIMED_OUT", "EXPIRED"].includes(r.status),
          ),
        ) ||
        feedbacks.some((f) => ["REJECTED", "TIMED_OUT", "EXPIRED"].includes(f.status))
      )
        throw new Error("Recording contains failed ITS requests");
      count(event);
      return { request, route, ticks, dispatches, feedbacks, completion: event, bytes };
    },
    get bytes() {
      return bytes;
    },
    get frames() {
      return ticks.length;
    },
  };
}
