import { useEffect, useState } from "react";

import type { DispatchAdapter } from "@/lib/dispatch-adapter";
import type { Station } from "@/types/telemetry";

/** The station list, loaded once; empty until it arrives or if it cannot be loaded. */
export function useStations(adapter: DispatchAdapter): Station[] {
  const [stations, setStations] = useState<Station[]>([]);
  useEffect(() => {
    let active = true;
    adapter.listStations().then(
      (loaded) => {
        if (active) setStations(loaded);
      },
      (error: unknown) => console.warn("[dispatch] station list unavailable", error),
    );
    return () => {
      active = false;
    };
  }, [adapter]);
  return stations;
}
