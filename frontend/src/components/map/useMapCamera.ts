import { useCallback, useEffect, useRef, useState } from "react";
import type { Map } from "maplibre-gl";
import { createMapCamera, type CameraMode } from "@/lib/camera-policy";
import { observeOccluders } from "@/components/map/occluders";
import { applyRouteFit, routeFitCoordinates } from "@/components/map/useRouteFit";
import type { Position, SimulationStartResponse } from "@/types/telemetry";
export function useMapCamera(
  map: Map | null,
  route: SimulationStartResponse | null,
  active: boolean,
  /** The requested incident; framed with the route when the run ends at an access point. */
  incident: Position | null = null,
) {
  const incidentLat = incident?.lat ?? null;
  const incidentLng = incident?.lng ?? null;
  const camera = useRef<ReturnType<typeof createMapCamera> | null>(null);
  const [mode, setMode] = useState<CameraMode>("overview");
  const activeRef = useRef(active);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);
  useEffect(() => {
    if (!map || !route) return;
    const controller = createMapCamera(
      map,
      () =>
        applyRouteFit(
          map,
          routeFitCoordinates(
            route,
            incidentLat !== null && incidentLng !== null
              ? { lat: incidentLat, lng: incidentLng }
              : null,
          ),
          window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        ),
      setMode,
    );
    camera.current = controller;
    const stopObserving = observeOccluders(map.getContainer(), () => controller.reframe());
    return () => {
      stopObserving();
      controller.dispose();
      camera.current = null;
    };
  }, [map, route, incidentLat, incidentLng]);
  const display = useCallback(
    (point: [number, number]) => camera.current?.display(point, activeRef.current),
    [],
  );
  const resume = useCallback(() => camera.current?.resume(), []);
  const showRoute = useCallback(() => camera.current?.showRoute(), []);
  return { mode, display, resume, showRoute };
}
