import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ConnectionStatus, SimulationStreamSubscriber } from "@/lib/simulation-adapter";
import {
  cancelledEventExample,
  completedEventExample,
  errorResponseExample,
  itsDispatchEventExample,
  SIMULATION_ID,
  startResponseExample,
  tickEventExample,
} from "@/lib/transport/__fixtures__/architecture-examples";
import { createBackendSimulationAdapter } from "@/lib/transport/backend-simulation-adapter";
import { SimulationAdapterError, type SimulationErrorInfo } from "@/lib/transport/errors";
import type { SimulationStartRequest, SimulationStreamEvent } from "@/types/telemetry";

const BASE_URL = "http://127.0.0.1:8000";

/** Minimal stand-in for the browser EventSource: named events, readyState, close. */
class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static instances: FakeEventSource[] = [];

  readonly url: string;
  readyState = FakeEventSource.CONNECTING;
  closed = false;
  private listeners = new Map<string, Set<(event: MessageEvent | Event) => void>>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent | Event) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)?.add(listener);
  }

  removeEventListener(type: string, listener: (event: MessageEvent | Event) => void) {
    this.listeners.get(type)?.delete(listener);
  }

  close() {
    this.closed = true;
    this.readyState = FakeEventSource.CLOSED;
  }

  hasListener(type: string) {
    return (this.listeners.get(type)?.size ?? 0) > 0;
  }

  open() {
    this.readyState = FakeEventSource.OPEN;
    this.dispatch("open", new Event("open"));
  }

  emit(event: SimulationStreamEvent | Record<string, unknown>, data = JSON.stringify(event)) {
    const type = String(event.event_type);
    this.dispatch(type, new MessageEvent(type, { data, lastEventId: String(event.tick) }));
  }

  /** A dropped connection the browser will retry (CONNECTING) or a failed one (CLOSED). */
  fail(readyState: number) {
    this.readyState = readyState;
    this.dispatch("error", new Event("error"));
  }

  private dispatch(type: string, event: MessageEvent | Event) {
    this.listeners.get(type)?.forEach((listener) => listener(event));
  }
}

function latestSource(): FakeEventSource {
  const source = FakeEventSource.instances.at(-1);
  if (!source) throw new Error("no EventSource was created");
  return source;
}

const request: SimulationStartRequest = {
  green_wave_mode: "ENABLED",
  simulation_id: SIMULATION_ID,
  origin: { lat: 50.0612, lng: 19.9571 },
  destination: { lat: 50.0134, lng: 19.9982 },
  traffic_density_multiplier: 1.5,
  enable_cascade_mode: true,
  playback_speed: 10,
  vehicle_type: "AMBULANCE",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function recorder() {
  const calls: string[] = [];
  const connection: ConnectionStatus[] = [];
  const errors: SimulationErrorInfo[] = [];
  const subscriber: SimulationStreamSubscriber = {
    onTick: (event) => calls.push(`tick:${event.tick}`),
    onItsDispatch: (event) => calls.push(`its:${event.message_id}`),
    onTerminal: (event) => calls.push(`terminal:${event.event_type}`),
    onConnectionChange: (status) => connection.push(status),
    onError: (error) => errors.push(error),
  };
  return { calls, connection, errors, subscriber };
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  fetchMock.mockReset();
  vi.useRealTimers();
});

function adapter() {
  return createBackendSimulationAdapter(BASE_URL, {
    startTimeoutMilliseconds: 10_000,
    reconnectAttemptLimit: 3,
  });
}

describe("start", () => {
  it("POSTs the request as JSON and returns the validated response", async () => {
    fetchMock.mockResolvedValue(jsonResponse(startResponseExample));
    await expect(adapter().start(request)).resolves.toEqual(startResponseExample);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE_URL}/api/v1/simulation/start`);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual(request);
  });

  it("maps 409 to SIMULATION_ID_IN_USE", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { schema_version: "1.0", error_code: "SIMULATION_ID_IN_USE", message: "in use" },
        409,
      ),
    );
    await expect(adapter().start(request)).rejects.toMatchObject({
      kind: "http",
      status: 409,
      code: "SIMULATION_ID_IN_USE",
    });
  });

  it("maps a 422 ErrorResponse to its code", async () => {
    fetchMock.mockResolvedValue(jsonResponse(errorResponseExample, 422));
    await expect(adapter().start(request)).rejects.toMatchObject({
      kind: "http",
      status: 422,
      code: "ORIGIN_OFF_NETWORK",
    });
  });

  it("maps FastAPI's default 422 body to an http error without a code", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: [{ loc: ["body"], msg: "x" }] }, 422));
    const error = await adapter()
      .start(request)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SimulationAdapterError);
    expect(error).toMatchObject({ kind: "http", status: 422, code: undefined });
  });

  it("maps a network failure to kind network with the backend URL", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    await expect(adapter().start(request)).rejects.toMatchObject({
      kind: "network",
      message: `Simulation backend unreachable at ${BASE_URL}`,
    });
  });

  it("times out a backend that never answers", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    const started = adapter()
      .start(request)
      .catch((caught: unknown) => caught);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await started).toMatchObject({
      kind: "network",
      reason: "timeout",
      message: `Simulation backend at ${BASE_URL} did not answer within 10 s`,
    });
  });

  it("reports a body that is still arriving at the timeout as a timeout, not invalid JSON", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async (_url, init) => {
      if (String(_url).endsWith("/stop")) return jsonResponse({}, 404);
      const body = new ReadableStream({
        start(controller) {
          init?.signal?.addEventListener("abort", () =>
            controller.error(new DOMException("aborted", "AbortError")),
          );
        },
      });
      return new Response(body, { status: 200 });
    });
    const started = adapter()
      .start(request)
      .catch((caught: unknown) => caught);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await started).toMatchObject({
      kind: "network",
      message: `Simulation backend at ${BASE_URL} did not answer within 10 s`,
    });
  });

  it("asks the backend to stop a run whose start timed out on the client", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation((url, init) => {
      if (String(url).endsWith("/stop")) return Promise.resolve(jsonResponse({}, 404));
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      });
    });
    const started = adapter()
      .start(request)
      .catch((caught: unknown) => caught);
    await vi.advanceTimersByTimeAsync(10_000);
    await started;
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toContain(
      `${BASE_URL}/api/v1/simulation/${SIMULATION_ID}/stop`,
    );
  });

  it("rejects an invalid 2xx body as an http error", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ...startResponseExample, is_simulated: false }));
    await expect(adapter().start(request)).rejects.toMatchObject({ kind: "http", status: 200 });
  });
});

describe("subscribe", () => {
  it("opens the stream URL and listens to the named events (not onmessage)", () => {
    const events = recorder();
    adapter().subscribe(SIMULATION_ID, events.subscriber);
    const source = latestSource();
    expect(source.url).toBe(`${BASE_URL}/api/v1/simulation/${SIMULATION_ID}/stream`);
    for (const type of [
      "SIMULATION_TICK",
      "ITS_DISPATCH",
      "SIMULATION_COMPLETED",
      "SIMULATION_CANCELLED",
    ]) {
      expect(source.hasListener(type)).toBe(true);
    }
    expect(events.connection).toEqual(["connecting"]);
  });

  it("delivers the happy path in order and closes on the terminal event", () => {
    const events = recorder();
    adapter().subscribe(SIMULATION_ID, events.subscriber);
    const source = latestSource();
    source.open();
    source.emit({ ...itsDispatchEventExample, tick: 42 });
    source.emit(tickEventExample);
    source.emit({ ...tickEventExample, tick: 43 });
    source.emit({ ...completedEventExample, tick: 43 });
    expect(events.connection).toEqual(["connecting", "open"]);
    expect(events.calls).toEqual([
      "its:MSG-ITS-88392",
      "tick:42",
      "tick:43",
      "terminal:SIMULATION_COMPLETED",
    ]);
    expect(source.closed).toBe(true);
  });

  it("closes on SIMULATION_CANCELLED", () => {
    const events = recorder();
    adapter().subscribe(SIMULATION_ID, events.subscriber);
    const source = latestSource();
    source.open();
    source.emit(cancelledEventExample);
    expect(events.calls).toEqual(["terminal:SIMULATION_CANCELLED"]);
    expect(source.closed).toBe(true);
  });

  it("drops a duplicate or older tick and a repeated ITS dispatch", () => {
    const events = recorder();
    adapter().subscribe(SIMULATION_ID, events.subscriber);
    const source = latestSource();
    source.open();
    source.emit({ ...itsDispatchEventExample, tick: 42 });
    source.emit(tickEventExample);
    source.emit(tickEventExample);
    source.emit({ ...tickEventExample, tick: 41 });
    source.emit({ ...itsDispatchEventExample, tick: 42 });
    expect(events.calls).toEqual(["its:MSG-ITS-88392", "tick:42"]);
  });

  it("drops an event of a foreign simulation_id, malformed JSON and unknown event types", () => {
    const events = recorder();
    adapter().subscribe(SIMULATION_ID, events.subscriber);
    const source = latestSource();
    source.open();
    source.emit({ ...tickEventExample, simulation_id: "SIM-OTHER" });
    source.emit(tickEventExample, "{not json");
    source.emit({ ...tickEventExample, event_type: "SIMULATION_PAUSED" });
    expect(events.calls).toEqual([]);
    expect(events.errors).toEqual([]);
  });

  it("reports reconnecting on a dropped stream, then open again on reconnect", () => {
    const events = recorder();
    adapter().subscribe(SIMULATION_ID, events.subscriber);
    const source = latestSource();
    source.open();
    source.emit(tickEventExample);
    source.fail(FakeEventSource.CONNECTING);
    source.open();
    source.emit({ ...tickEventExample, tick: 50 });
    expect(events.connection).toEqual(["connecting", "open", "reconnecting", "open"]);
    expect(events.calls).toEqual(["tick:42", "tick:50"]);
    expect(source.closed).toBe(false);
  });

  it("treats a failed (CLOSED) connection as a 404: lost + SIMULATION_NOT_FOUND", () => {
    const events = recorder();
    adapter().subscribe(SIMULATION_ID, events.subscriber);
    const source = latestSource();
    source.open();
    source.fail(FakeEventSource.CONNECTING);
    source.fail(FakeEventSource.CLOSED);
    expect(events.connection).toEqual(["connecting", "open", "reconnecting", "lost"]);
    expect(events.errors).toEqual([
      expect.objectContaining({ kind: "http", status: 404, code: "SIMULATION_NOT_FOUND" }),
    ]);
    expect(source.closed).toBe(true);
  });

  it("gives up after the reconnect limit with a network error and closes", () => {
    const events = recorder();
    adapter().subscribe(SIMULATION_ID, events.subscriber);
    const source = latestSource();
    for (let attempt = 0; attempt < 4; attempt += 1) source.fail(FakeEventSource.CONNECTING);
    expect(events.connection.at(-1)).toBe("lost");
    expect(events.errors).toEqual([
      expect.objectContaining({
        kind: "network",
        message: `Simulation backend unreachable at ${BASE_URL}`,
      }),
    ]);
    expect(source.closed).toBe(true);
  });

  it("delivers several ITS dispatches before one tick (playback_speed > 1)", () => {
    const events = recorder();
    adapter().subscribe(SIMULATION_ID, events.subscriber);
    const source = latestSource();
    source.open();
    source.emit({ ...tickEventExample, tick: 40 });
    source.emit({ ...itsDispatchEventExample, tick: 43, message_id: "MSG-ITS-1" });
    source.emit({ ...itsDispatchEventExample, tick: 46, message_id: "MSG-ITS-2" });
    source.emit({ ...tickEventExample, tick: 50 });
    expect(events.calls).toEqual(["tick:40", "its:MSG-ITS-1", "its:MSG-ITS-2", "tick:50"]);
  });

  it("accepts a terminal event older than the last tick (it is final) and closes", () => {
    const events = recorder();
    adapter().subscribe(SIMULATION_ID, events.subscriber);
    const source = latestSource();
    source.open();
    source.emit(tickEventExample);
    source.emit({ ...cancelledEventExample, tick: 41 });
    expect(events.calls).toEqual(["tick:42", "terminal:SIMULATION_CANCELLED"]);
    expect(source.closed).toBe(true);
  });

  it("accepts a terminal equal to the last tick after a reconnect snapshot", () => {
    const events = recorder();
    adapter().subscribe(SIMULATION_ID, events.subscriber);
    const source = latestSource();
    source.open();
    source.emit(tickEventExample);
    source.fail(FakeEventSource.CONNECTING);
    source.open();
    source.emit(tickEventExample); // reconnect snapshot repeats tick 42
    source.emit({ ...completedEventExample, tick: 42 });
    expect(events.calls).toEqual(["tick:42", "terminal:SIMULATION_COMPLETED"]);
    expect(source.closed).toBe(true);
  });

  it("closes and reports an error instead of reconnecting forever on an invalid terminal event", () => {
    const events = recorder();
    adapter().subscribe(SIMULATION_ID, events.subscriber);
    const source = latestSource();
    source.open();
    source.emit({ ...cancelledEventExample, reason: "CRASHED" });
    expect(source.closed).toBe(true);
    expect(events.connection.at(-1)).toBe("lost");
    expect(events.errors).toEqual([expect.objectContaining({ kind: "http" })]);
  });

  it("unsubscribe closes the stream and silences late events", () => {
    const events = recorder();
    const unsubscribe = adapter().subscribe(SIMULATION_ID, events.subscriber);
    const source = latestSource();
    source.open();
    unsubscribe();
    source.emit(tickEventExample);
    expect(source.closed).toBe(true);
    expect(events.calls).toEqual([]);
  });
});

describe("stop", () => {
  it("POSTs to the stop URL and closes that simulation's stream", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        schema_version: "1.0",
        is_simulated: true,
        simulation_id: SIMULATION_ID,
        status: "STOPPED",
      }),
    );
    const backend = adapter();
    backend.subscribe(SIMULATION_ID, recorder().subscriber);
    await backend.stop(SIMULATION_ID);
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE_URL}/api/v1/simulation/${SIMULATION_ID}/stop`);
    expect(fetchMock.mock.calls[0][1]?.method).toBe("POST");
    expect(latestSource().closed).toBe(true);
  });

  it("treats 404 as already gone", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { schema_version: "1.0", error_code: "SIMULATION_NOT_FOUND", message: "gone" },
        404,
      ),
    );
    await expect(adapter().stop(SIMULATION_ID)).resolves.toBeUndefined();
  });

  it("rejects with a network error when the backend is unreachable", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    await expect(adapter().stop(SIMULATION_ID)).rejects.toMatchObject({ kind: "network" });
  });
});
