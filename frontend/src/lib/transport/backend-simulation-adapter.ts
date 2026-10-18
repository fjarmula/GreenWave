/**
 * Backend transport: `fetch` for start/stop, `EventSource` for the SSE stream.
 *
 * Stream framing (ADR 0003, D3): named events (`event:` = event_type), so we
 * listen with `addEventListener` per type; `onmessage` would never fire.
 * Events are validated (validate.ts) and de-duplicated by tick: a tick must be
 * newer than the last one, an ITS_DISPATCH must be newer than the last tick and
 * not repeat a message_id (it precedes its own tick), and a terminal event may
 * repeat the last tick id. A terminal event closes the EventSource; otherwise
 * the browser would reconnect to the finished stream forever.
 *
 * 404 detection: EventSource cannot read HTTP status. Per the HTML spec a
 * non-200 or non-`text/event-stream` answer *fails* the connection
 * (`readyState === CLOSED`, no retry), while a dropped connection is retried
 * (`readyState === CONNECTING`). Every failed connection is therefore treated
 * as "simulation no longer exists" (SIMULATION_NOT_FOUND): in practice the
 * stream route's only non-200 answer is 404, because ids are client-generated
 * to the D8 pattern (422 cannot occur) and a 500 is a backend bug. Note that a
 * misconfiguration on the stream (CORS origin mismatch, a proxy error page) also
 * reads as "no longer exists". No follow-up request is made.
 */
import type {
  ConnectionStatus,
  SimulationAdapter,
  SimulationStreamSubscriber,
} from "@/lib/simulation-adapter";
import { SimulationAdapterError, type SimulationErrorInfo } from "@/lib/transport/errors";
import { parseErrorResponse, parseStartResponse, parseStreamEvent } from "@/lib/transport/validate";
import type { SimulationStreamEvent } from "@/types/telemetry";

export type BackendAdapterOptions = {
  startTimeoutMilliseconds: number;
  /** Consecutive failed reconnect attempts tolerated before the stream is reported lost. */
  reconnectAttemptLimit: number;
};

const STREAM_EVENT_TYPES = [
  "SIMULATION_TICK",
  "ITS_DISPATCH",
  "SIMULATION_COMPLETED",
  "SIMULATION_CANCELLED",
] as const satisfies readonly SimulationStreamEvent["event_type"][];

export function unreachableMessage(baseUrl: string): string {
  return `Simulation backend unreachable at ${baseUrl}`;
}

export function createBackendSimulationAdapter(
  baseUrl: string,
  options: BackendAdapterOptions,
): SimulationAdapter {
  const streams = new Map<string, () => void>();
  const simulationUrl = (simulationId: string, action: "stream" | "stop") =>
    `${baseUrl}/api/v1/simulation/${encodeURIComponent(simulationId)}/${action}`;

  /**
   * fetch + JSON body within the timeout (headers and body both count);
   * network failures and timeouts become SimulationAdapterError(kind network).
   */
  async function postJson(url: string, body?: unknown, onTimeout?: () => void) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.startTimeoutMilliseconds);
    const timeoutError = () => {
      onTimeout?.();
      return new SimulationAdapterError({
        kind: "network",
        reason: "timeout",
        message: `Simulation backend at ${baseUrl} did not answer within ${Math.round(options.startTimeoutMilliseconds / 1000)} s`,
      });
    };
    try {
      let response: Response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        });
      } catch {
        throw controller.signal.aborted
          ? timeoutError()
          : new SimulationAdapterError({ kind: "network", message: unreachableMessage(baseUrl) });
      }
      // A body that is not JSON is judged by the caller; an aborted body read is a timeout.
      const json: unknown = await response.json().catch(() => undefined);
      if (controller.signal.aborted) throw timeoutError();
      return { response, json };
    } finally {
      clearTimeout(timer);
    }
  }

  function httpError(status: number, json: unknown): SimulationAdapterError {
    const error = parseErrorResponse(json);
    return new SimulationAdapterError({
      kind: "http",
      status,
      code: error?.error_code,
      message: error?.message ?? `Simulation backend rejected the request (HTTP ${status})`,
    });
  }

  return {
    async start(request) {
      // If the server finishes routing after we gave up, that run must not keep ticking. Best
      // effort: a stop that lands before the run is registered gets 404, and that run keeps
      // going until the next start supersedes it (one active run at a time).
      const stopAbandonedStart = () => {
        postJson(simulationUrl(request.simulation_id, "stop")).catch(() => undefined);
      };
      const { response, json } = await postJson(
        `${baseUrl}/api/v1/simulation/start`,
        request,
        stopAbandonedStart,
      );
      if (!response.ok) throw httpError(response.status, json);
      try {
        return parseStartResponse(json);
      } catch (error) {
        throw new SimulationAdapterError({
          kind: "http",
          status: response.status,
          message: `Simulation backend sent an invalid start response (${error instanceof Error ? error.message : "unknown field"})`,
        });
      }
    },

    subscribe(simulationId, subscriber) {
      streams.get(simulationId)?.();
      const close = openStream(
        simulationUrl(simulationId, "stream"),
        simulationId,
        subscriber,
        baseUrl,
        options,
        () => streams.delete(simulationId),
      );
      streams.set(simulationId, close);
      return close;
    },

    async stop(simulationId) {
      streams.get(simulationId)?.();
      const { response, json } = await postJson(simulationUrl(simulationId, "stop"));
      // 404: the run is already gone, which is what the user asked for.
      if (!response.ok && response.status !== 404) throw httpError(response.status, json);
    },
  };
}

function openStream(
  url: string,
  simulationId: string,
  subscriber: SimulationStreamSubscriber,
  baseUrl: string,
  options: BackendAdapterOptions,
  onClosed: () => void,
): () => void {
  const EventSourceImpl = globalThis.EventSource;
  const source = new EventSourceImpl(url);
  let closed = false;
  let lastTick = 0;
  let failedAttempts = 0;
  const seenMessageIds = new Set<string>();

  const close = () => {
    if (closed) return;
    closed = true;
    source.close();
    onClosed();
  };
  const report = (status: ConnectionStatus) => subscriber.onConnectionChange(status);
  const giveUp = (error: SimulationErrorInfo) => {
    close();
    report("lost");
    subscriber.onError(error);
  };

  source.addEventListener("open", () => {
    if (closed) return;
    failedAttempts = 0;
    report("open");
  });

  source.addEventListener("error", () => {
    if (closed) return;
    if (source.readyState === EventSourceImpl.CLOSED) {
      giveUp({
        kind: "http",
        status: 404,
        code: "SIMULATION_NOT_FOUND",
        message: "Simulation no longer exists",
      });
      return;
    }
    failedAttempts += 1;
    if (failedAttempts > options.reconnectAttemptLimit) {
      giveUp({ kind: "network", message: unreachableMessage(baseUrl) });
      return;
    }
    report("reconnecting");
  });

  const handle = (eventType: SimulationStreamEvent["event_type"], message: MessageEvent) => {
    if (closed) return;
    const event = decodeStreamFrame(eventType, message, simulationId);
    if (!event) {
      // The server closes the stream after a terminal frame and re-sends the same retained
      // terminal on every reconnect; dropping it silently would reconnect forever.
      if (eventType === "SIMULATION_COMPLETED" || eventType === "SIMULATION_CANCELLED") {
        giveUp({ kind: "http", message: "Simulation backend sent an invalid terminal event" });
      }
      return;
    }

    switch (event.event_type) {
      case "SIMULATION_TICK":
        if (event.tick <= lastTick) return;
        lastTick = event.tick;
        subscriber.onTick(event);
        return;
      case "ITS_DISPATCH":
        if (event.tick <= lastTick || seenMessageIds.has(event.message_id)) return;
        seenMessageIds.add(event.message_id);
        subscriber.onItsDispatch(event);
        return;
      case "SIMULATION_COMPLETED":
      case "SIMULATION_CANCELLED":
        // A terminal is final for this run whatever its tick: dropping one would leave the
        // server re-sending it on every reconnect.
        close();
        subscriber.onTerminal(event);
        return;
    }
  };
  for (const eventType of STREAM_EVENT_TYPES) {
    source.addEventListener(eventType, (message) => handle(eventType, message));
  }

  report("connecting");
  return close;
}

/** The validated event of one named SSE frame, or null when it is not valid JSON of that type. */
function decodeStreamFrame(
  eventType: SimulationStreamEvent["event_type"],
  message: MessageEvent,
  simulationId: string,
): SimulationStreamEvent | null {
  let payload: unknown = undefined;
  try {
    payload = JSON.parse(String(message.data));
  } catch {
    if (process.env.NODE_ENV !== "production") {
      console.warn(`[simulation stream] dropped ${eventType}: invalid JSON`);
    }
  }
  const event = payload === undefined ? null : parseStreamEvent(payload, simulationId);
  return event && event.event_type === eventType ? event : null;
}
