import { useCallback, useEffect, useRef } from "react";
import type { Map } from "maplibre-gl";

import { mapPalette } from "@/components/map/map-palette";
import { attachVehicleWake } from "@/components/map/vehicle-wake";
import type { ResolvedTheme } from "@/lib/theme-transition";
import type { RouteGeometry } from "@/types/telemetry";

/**
 * Draws the green wake in Green Wave runs and re-adds it after every style load. Returns a callback
 * for each displayed vehicle position, so the wake follows the animated marker, not the ticks.
 */
export function useVehicleWake(
  map: Map | null,
  route: RouteGeometry | null,
  enabled: boolean,
  styleRevision: number,
  theme: ResolvedTheme,
) {
  const wake = useRef<ReturnType<typeof attachVehicleWake> | null>(null);
  const last = useRef<[number, number] | null>(null);
  useEffect(() => {
    if (!map || !route || !enabled) return;
    const attached = attachVehicleWake(map, mapPalette(theme));
    wake.current = attached;
    if (last.current) attached.show(route, last.current);
    return () => {
      attached.remove();
      wake.current = null;
    };
  }, [map, route, enabled, styleRevision, theme]);
  return useCallback(
    (position: [number, number]) => {
      last.current = position;
      if (route) wake.current?.show(route, position);
    },
    [route],
  );
}
