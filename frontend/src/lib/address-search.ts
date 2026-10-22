import type { Incident } from "@/lib/useIncidentDispatch";
import type { GeocodeResult } from "@/types/telemetry";

export const GEOCODE_DEBOUNCE_MILLISECONDS = 250;
/** The backend rejects shorter queries (`q` is 2–100 characters). */
export const GEOCODE_MIN_QUERY_LENGTH = 2;

export type AddressSearchState = {
  results: GeocodeResult[];
  status: "idle" | "loading" | "ready" | "error";
  /** The trimmed query that `results` (or the error) belongs to. */
  query: string;
};

const IDLE: AddressSearchState = { results: [], status: "idle", query: "" };

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
        update({ ...state, status: "loading" });
        geocode(trimmed, controller.signal).then(
          (results) => {
            if (inFlight === controller) update({ results, status: "ready", query: trimmed });
          },
          () => {
            if (inFlight === controller) update({ results: [], status: "error", query: trimmed });
          },
        );
      }, GEOCODE_DEBOUNCE_MILLISECONDS);
    },
    dispose: cancel,
  };
}

export type SearchFeedback = "error" | "no-match" | null;

/**
 * What to tell the user under the box. "No match" waits until the empty results belong to
 * the text actually in the box, so it never flashes while the debounce is pending.
 */
export function searchFeedback(state: AddressSearchState, inputValue: string): SearchFeedback {
  if (state.status === "error") return "error";
  const settledForInput = state.status === "ready" && state.query === inputValue.trim();
  return settledForInput && state.results.length === 0 ? "no-match" : null;
}

/** Enter picks the highlighted suggestion, else the first; without suggestions it does nothing. */
export function enterSelection(results: GeocodeResult[], active: number): GeocodeResult | null {
  return results[active] ?? results[0] ?? null;
}

export function suggestionToIncident(result: GeocodeResult): Incident {
  return { position: result.position, label: result.label, source: "address" };
}
