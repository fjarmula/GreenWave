import type { Incident } from "@/lib/useIncidentDispatch";
import type { GeocodeResult } from "@/types/telemetry";

export const GEOCODE_DEBOUNCE_MILLISECONDS = 250;
/** The backend rejects shorter queries (`q` is 2–100 characters). */
export const GEOCODE_MIN_QUERY_LENGTH = 2;

export type AddressSearchState = {
  results: GeocodeResult[];
  status: "idle" | "loading" | "ready" | "error";
};

const IDLE: AddressSearchState = { results: [], status: "idle" };

/**
 * Debounced address suggestions without React: a query of 2+ characters is sent
 * 250 ms after the last change; the previous request is aborted and, should it
 * still settle, discarded.
 */
export function createAddressSearch(
  geocode: (query: string, signal?: AbortSignal) => Promise<GeocodeResult[]>,
) {
  let state = IDLE;
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: AbortController | null = null;

  function update(next: AddressSearchState) {
    state = next;
    listeners.forEach((listener) => listener());
  }

  function cancel() {
    if (timer) clearTimeout(timer);
    timer = null;
    inFlight?.abort();
    inFlight = null;
  }

  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setQuery(query: string) {
      cancel();
      const trimmed = query.trim();
      if (trimmed.length < GEOCODE_MIN_QUERY_LENGTH) {
        if (state !== IDLE) update(IDLE);
        return;
      }
      timer = setTimeout(() => {
        timer = null;
        const controller = new AbortController();
        inFlight = controller;
        update({ results: state.results, status: "loading" });
        geocode(trimmed, controller.signal).then(
          (results) => {
            if (inFlight === controller) update({ results, status: "ready" });
          },
          () => {
            if (inFlight === controller) update({ results: [], status: "error" });
          },
        );
      }, GEOCODE_DEBOUNCE_MILLISECONDS);
    },
    dispose: cancel,
  };
}

export function suggestionToIncident(result: GeocodeResult): Incident {
  return { position: result.position, label: result.label, source: "address" };
}
