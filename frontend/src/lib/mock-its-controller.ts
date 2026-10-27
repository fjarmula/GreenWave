import type {
  IntersectionState,
  SignalPhaseColor,
  SignalPhaseIndicator,
  SignalMovementKind,
  RouteIntersection,
  Position,
  SimulationStartResponse,
  ItsScenario,
  ItsDispatchEvent,
  ItsFeedbackEvent,
  ItsRequestSnapshot,
  CancelReason,
} from "@/types/telemetry";
import {
  MOCK_SIGNAL_GREEN_SECONDS,
  MOCK_SIGNAL_YELLOW_SECONDS,
  MOCK_SIGNAL_ALL_RED_SECONDS,
  MOCK_RECOVERY_SECONDS,
  MOCK_PRIORITY_GREEN_TTI_SECONDS,
} from "./mock-simulation-config";
const MOCK_SIGNALS = [
  { suffix: "S1", latOffset: -0.0003, lngOffset: 0 },
  { suffix: "S2", latOffset: 0.0001, lngOffset: 0.0006 },
] as const;
export type MockSignal = {
  state: IntersectionState;
  isCascade: boolean;
  recoveryStartedAtSeconds: number | null;
  passed: boolean;
};
type MockSignalHead = { color: SignalPhaseColor; sinceSeconds: number };
type PhaseContext = {
  route: SimulationStartResponse;
  signals: MockSignal[];
  elapsedSeconds: number;
  signalHeads: Map<string, MockSignalHead>;
};
/**
 * (vehicle, pedestrian) colours of `group` in the two-group cycle: a documented duplicate of the
 * backend programme (the frontend cannot import it). Synthetic S1 (the route approach) is group 0,
 * S2 (the crossing street) group 1.
 */
function cycleColors(group: number, nowSeconds: number): [SignalPhaseColor, SignalPhaseColor] {
  const slot = MOCK_SIGNAL_GREEN_SECONDS + MOCK_SIGNAL_YELLOW_SECONDS + MOCK_SIGNAL_ALL_RED_SECONDS;
  const phase = nowSeconds % (slot * MOCK_SIGNALS.length);
  const active = Math.floor(phase / slot);
  const within = phase - active * slot;
  if (group !== active) return ["RED", within < MOCK_SIGNAL_GREEN_SECONDS ? "GREEN" : "RED"];
  const vehicle =
    within < MOCK_SIGNAL_GREEN_SECONDS
      ? "GREEN"
      : within < MOCK_SIGNAL_GREEN_SECONDS + MOCK_SIGNAL_YELLOW_SECONDS
        ? "YELLOW"
        : "RED";
  return [vehicle, "RED"];
}

/** The programme colour of the route vehicle movement (S1) at `seconds`, used by motion. */
export function routeMovementColor(seconds: number): SignalPhaseColor {
  return cycleColors(0, seconds)[0];
}

/** The next shown vehicle light, as the backend limits it: GREEN → YELLOW → RED → GREEN only. */
function nextHead(
  prior: MockSignalHead | undefined,
  target: SignalPhaseColor,
  now: number,
  mayTurnGreen: boolean,
): MockSignalHead {
  if (!prior) return { color: target, sinceSeconds: now };
  if (prior.color === "GREEN") {
    return target === "GREEN" ? prior : { color: "YELLOW", sinceSeconds: now };
  }
  if (prior.color === "YELLOW") {
    return now - prior.sinceSeconds >= MOCK_SIGNAL_YELLOW_SECONDS
      ? { color: "RED", sinceSeconds: now }
      : prior;
  }
  return target === "GREEN" && mayTurnGreen ? { color: "GREEN", sinceSeconds: now } : prior;
}

/** Mirrors the backend projection, then records the shown lights on the session. */
function mockSignalPhases(session: PhaseContext): SignalPhaseIndicator[] {
  const now = session.elapsedSeconds;
  return session.route.route_intersections.flatMap((intersection, index) => {
    const { state } = session.signals[index];
    const signals = MOCK_SIGNALS.map((signal, group) => {
      let [vehicle, pedestrian] = cycleColors(group, now);
      const onRoute = signal.suffix === "S1";
      if (state === "PRIORITY_GREEN") {
        [vehicle, pedestrian] = [onRoute ? "GREEN" : "RED", "RED"];
      } else if (state === "CLEARING") {
        [vehicle, pedestrian] = [onRoute ? vehicle : "RED", "RED"];
      }
      const key = `${intersection.id}-${signal.suffix}`;
      return { signal, key, vehicle, pedestrian, prior: session.signalHeads.get(key) };
    });
    return signals.flatMap(({ signal, key, vehicle, pedestrian, prior }) => {
      // Green only once every light not also turning green has stopped.
      const mayTurnGreen = signals.every(
        (other) =>
          other.key === key || other.vehicle === "GREEN" || (other.prior?.color ?? "RED") === "RED",
      );
      const head = nextHead(prior, vehicle, now, mayTurnGreen);
      session.signalHeads.set(key, head);
      const position = {
        lat: intersection.position.lat + signal.latOffset,
        lng: intersection.position.lng + signal.lngOffset,
      };
      return [
        mockPhase(intersection, key, "VEHICLE", head.color, position),
        mockPhase(
          intersection,
          key,
          "PEDESTRIAN",
          head.color === "RED" ? pedestrian : "RED",
          position,
        ),
      ];
    });
  });
}

function mockPhase(
  intersection: RouteIntersection,
  signalKey: string,
  kind: SignalMovementKind,
  color: SignalPhaseColor,
  position: Position,
): SignalPhaseIndicator {
  return {
    intersection_id: intersection.id,
    signal_key: signalKey,
    kind,
    controlled_edge_ids: [], // Synthetic signals have no real road-edge/lane identity.
    is_route_movement: kind === "VEHICLE" && signalKey.endsWith("-S1"),
    color,
    position,
    accessible_label: `Simulated mock ${kind.toLowerCase()} signal ${signalKey} at ${intersection.id}: ${color.toLowerCase()}`,
  };
}

/** Pure synthetic controller. Decisions, target states and reported indications are separate. */
export class MockItsController {
  readonly signals: MockSignal[];
  readonly signalHeads = new Map<string, MockSignalHead>();
  readonly requests: ItsRequestSnapshot[] = [];
  private dispatches: ItsDispatchEvent[] = [];
  private sequence = 0;
  private closed = false;
  phases: SignalPhaseIndicator[] = [];
  failure: CancelReason | null = null;
  constructor(
    readonly route: SimulationStartResponse,
    readonly scenario: ItsScenario,
  ) {
    this.signals = route.route_intersections.map(() => ({
      state: "NORMAL",
      isCascade: false,
      recoveryStartedAtSeconds: null,
      passed: false,
    }));
    this.phases = mockSignalPhases({
      route,
      signals: this.signals,
      elapsedSeconds: 0,
      signalHeads: this.signalHeads,
    });
  }
  submit(event: ItsDispatchEvent, now: number) {
    if (this.closed) return;
    const old = this.dispatches.find((d) => d.message_id === event.message_id);
    if (old) {
      if (JSON.stringify(old) !== JSON.stringify(event)) throw new Error("Conflicting request");
      return;
    }
    this.dispatches.push(event);
    this.requests.push({
      message_id: event.message_id,
      intersections_group: event.payload.intersections_group,
      status: "REQUESTED",
      submitted_at_simulated_sec: now,
      acknowledged_at_simulated_sec: null,
      last_updated_at_simulated_sec: now,
      last_feedback_sequence: 0,
      reason: null,
    });
  }
  advance(now: number, ttis: number[], passed: boolean[], timestamp: string): ItsFeedbackEvent[] {
    if (this.closed) return [];
    const feedbacks: ItsFeedbackEvent[] = [];
    this.requests.forEach((r, n) => {
      const indexes = r.intersections_group.map((id) =>
        this.route.intersections_on_route.indexOf(id),
      );
      let status = r.status;
      if (["REQUESTED", "ACCEPTED"].includes(status) && indexes.every((i) => passed[i]))
        status = "RELEASED";
      else if (
        status === "REQUESTED" &&
        now >= r.submitted_at_simulated_sec + (this.scenario === "DELAYED" ? 5 : 1) &&
        this.scenario !== "NO_FEEDBACK"
      )
        status = this.scenario === "REJECTED" ? "REJECTED" : "ACCEPTED";
      else if (status === "REQUESTED" && now >= r.submitted_at_simulated_sec + 8)
        status = "TIMED_OUT";
      else if (
        status === "ACCEPTED" &&
        now >= r.submitted_at_simulated_sec + this.dispatches[n].payload.hold_duration_sec
      )
        status = "EXPIRED";
      if (status !== r.status) {
        const reason =
          status === "REJECTED"
            ? "CONTROLLER_REJECTED"
            : status === "TIMED_OUT"
              ? "ACK_TIMEOUT"
              : status === "EXPIRED"
                ? "HOLD_EXPIRED"
                : null;
        r.status = status;
        r.reason = reason;
        r.last_feedback_sequence = ++this.sequence;
        r.last_updated_at_simulated_sec = now;
        if (status === "ACCEPTED") r.acknowledged_at_simulated_sec = now;
        feedbacks.push({
          schema_version: "1.0",
          is_simulated: true,
          event_type: "ITS_FEEDBACK",
          simulation_id: this.route.simulation_id,
          tick: now,
          timestamp,
          request_message_id: r.message_id,
          feedback_sequence: this.sequence,
          status,
          intersections_group: r.intersections_group,
          observed_at_simulated_sec: now,
          reason,
        });
        if (status === "REJECTED") this.failure = "ITS_REJECTED";
        if (status === "TIMED_OUT") this.failure = "ITS_TIMEOUT";
        if (status === "EXPIRED") this.failure = "ITS_HOLD_EXPIRED";
      }
    });
    this.signals.forEach((signal, i) => {
      const request = this.requests.find((r) =>
        r.intersections_group.includes(this.route.intersections_on_route[i]),
      );
      if (passed[i]) {
        if (!signal.passed) {
          signal.passed = true;
          signal.recoveryStartedAtSeconds = now;
        }
        signal.state =
          request && now - (signal.recoveryStartedAtSeconds ?? now) < MOCK_RECOVERY_SECONDS
            ? "RECOVERY"
            : "NORMAL";
      } else if (request?.status === "ACCEPTED")
        signal.state = ttis[i] <= MOCK_PRIORITY_GREEN_TTI_SECONDS ? "PRIORITY_GREEN" : "CLEARING";
      else signal.state = "NORMAL";
    });
    this.phases = mockSignalPhases({
      route: this.route,
      signals: this.signals,
      elapsedSeconds: now,
      signalHeads: this.signalHeads,
    });
    this.signals.forEach((signal, i) => {
      if (
        signal.state === "PRIORITY_GREEN" &&
        !this.phases.some(
          (p) =>
            p.intersection_id === this.route.intersections_on_route[i] &&
            p.signal_key.endsWith("S1") &&
            p.kind === "VEHICLE" &&
            p.color === "GREEN",
        )
      )
        signal.state = "CLEARING";
    });
    return feedbacks;
  }
  close() {
    this.closed = true;
  }
}
