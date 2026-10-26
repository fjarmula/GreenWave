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
  const displayedPoint = useRef<[number, number] | null>(null);
  const activeRef = useRef(active);
  useEffect(() => {
    activeRef.current = active;
    if (displayedPoint.current) camera.current?.display(displayedPoint.current, active);
    else if (!active) camera.current?.pause();
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
      () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    );
    camera.current = controller;
    // Marker child effects can run before camera creation on the first live frame.
    if (displayedPoint.current) controller.display(displayedPoint.current, activeRef.current);
    const stopObserving = observeOccluders(map.getContainer(), () => controller.reframe());
    return () => {
      stopObserving();
      controller.dispose();
      camera.current = null;
    };
  }, [map, route, incidentLat, incidentLng]);
  const display = useCallback((point: [number, number]) => {
    displayedPoint.current = point;
    camera.current?.display(point, activeRef.current);
  }, []);
  const resume = useCallback(() => camera.current?.resume(), []);
  const showRoute = useCallback(() => camera.current?.showRoute(), []);
  return { mode, display, resume, showRoute };
}
