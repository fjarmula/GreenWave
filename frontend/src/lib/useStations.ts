import { useEffect, useState } from "react";

import type { DispatchAdapter } from "@/lib/dispatch-adapter";
import type { Station } from "@/types/telemetry";

export const STATIONS_UNAVAILABLE = "Station list unavailable — check the backend";

export type StationsState = { stations: Station[]; error: string | null };

const LOADING: StationsState = { stations: [], error: null };

/** Loads the station list once; a failure is reported, not only logged. */
export async function loadStations(adapter: DispatchAdapter): Promise<StationsState> {
  try {
    return { stations: await adapter.listStations(), error: null };
  } catch (error: unknown) {
    console.warn("[dispatch] station list unavailable", error);
    return { stations: [], error: STATIONS_UNAVAILABLE };
  }
}

/** Waits between attempts while the backend is down, then every 30 s until it answers. */
export const STATIONS_RETRY_DELAYS_MS = [2000, 5000, 10000, 20000];
const STATIONS_RETRY_EVERY_MS = 30000;

/**
 * Loads the station list, retrying failures until it arrives (a backend started after the
 * page); each attempt's result goes to `onState`. Returns `stop` for unmount.
 */
export function watchStations(
  adapter: DispatchAdapter,
  onState: (state: StationsState) => void,
): () => void {
  let active = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const attempt = (failures: number) => {
    void loadStations(adapter).then((loaded) => {
      if (!active) return;
      onState(loaded);
      if (loaded.error === null) return;
      const delay = STATIONS_RETRY_DELAYS_MS[failures] ?? STATIONS_RETRY_EVERY_MS;
      timer = setTimeout(() => attempt(failures + 1), delay);
    });
  };
  attempt(0);
  return () => {
    active = false;
    if (timer !== null) clearTimeout(timer);
  };
}

/** The station list: empty until it arrives, with `error` set while it cannot be loaded. */
export function useStations(adapter: DispatchAdapter): StationsState {
  const [state, setState] = useState<StationsState>(LOADING);
  useEffect(() => watchStations(adapter, setState), [adapter]);
  return state;
}
