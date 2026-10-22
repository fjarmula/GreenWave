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

/** The station list: empty until it arrives, with `error` set if it cannot be loaded. */
export function useStations(adapter: DispatchAdapter): StationsState {
  const [state, setState] = useState<StationsState>(LOADING);
  useEffect(() => {
    let active = true;
    void loadStations(adapter).then((loaded) => {
      if (active) setState(loaded);
    });
    return () => {
      active = false;
    };
  }, [adapter]);
  return state;
}
