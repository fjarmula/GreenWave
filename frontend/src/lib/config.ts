/**
 * Frontend runtime configuration (D21, D22). `NEXT_PUBLIC_*` values are
 * inlined into the client bundle at build time, and only literal
 * `process.env.NEXT_PUBLIC_X` references are inlined, so they are read here
 * exactly that way. Invalid values fall back to the defaults with one warning;
 * an invalid transport never selects `backend`.
 */
export type SimulationTransport = "mock" | "backend";

export type FrontendConfig = {
  transport: SimulationTransport;
  apiBaseUrl: string;
  /** An open stream silent for this long is shown as reconnecting. Proposed: 3 missed 1 Hz ticks. */
  staleAfterSeconds: number;
  /** Start request limit (routing on the real graph may take a moment). Proposed value. */
  startTimeoutMilliseconds: number;
  /** Consecutive failed stream reconnects (≈ 2 s apart, `retry: 2000`) before "connection lost". */
  reconnectAttemptLimit: number;
};

export const DEFAULT_TRANSPORT: SimulationTransport = "mock";
export const DEFAULT_API_BASE_URL = "http://127.0.0.1:8000";
export const STALE_AFTER_SECONDS = 3;
export const START_TIMEOUT_MILLISECONDS = 10_000;
export const RECONNECT_ATTEMPT_LIMIT = 5;

function parseTransport(value: string | undefined, warn: (message: string) => void) {
  const transport = value?.trim();
  if (!transport) return DEFAULT_TRANSPORT;
  if (transport === "mock" || transport === "backend") return transport;
  warn(
    `NEXT_PUBLIC_SIMULATION_TRANSPORT=${JSON.stringify(value)} is not "mock" or "backend"; using "${DEFAULT_TRANSPORT}".`,
  );
  return DEFAULT_TRANSPORT;
}

function parseApiBaseUrl(value: string | undefined, warn: (message: string) => void): string {
  const raw = value?.trim();
  if (!raw) return DEFAULT_API_BASE_URL;
  let url: URL | null = null;
  try {
    url = new URL(raw);
  } catch {
    url = null;
  }
  if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) {
    warn(
      `NEXT_PUBLIC_API_BASE_URL=${JSON.stringify(value)} is not an http(s) URL; using ${DEFAULT_API_BASE_URL}.`,
    );
    return DEFAULT_API_BASE_URL;
  }
  return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
}

export function parseFrontendConfig(
  env: { transport?: string; apiBaseUrl?: string },
  warn: (message: string) => void,
): FrontendConfig {
  return {
    transport: parseTransport(env.transport, warn),
    apiBaseUrl: parseApiBaseUrl(env.apiBaseUrl, warn),
    staleAfterSeconds: STALE_AFTER_SECONDS,
    startTimeoutMilliseconds: START_TIMEOUT_MILLISECONDS,
    reconnectAttemptLimit: RECONNECT_ATTEMPT_LIMIT,
  };
}

let cachedConfig: FrontendConfig | null = null;

/** Parsed once per page load, so each invalid value warns once. */
export function getFrontendConfig(): FrontendConfig {
  cachedConfig ??= parseFrontendConfig(
    {
      transport: process.env.NEXT_PUBLIC_SIMULATION_TRANSPORT,
      apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL,
    },
    (message) => console.warn(`[config] ${message}`),
  );
  return cachedConfig;
}
