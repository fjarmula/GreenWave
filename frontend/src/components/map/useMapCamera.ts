import { useCallback, useEffect, useRef, useState } from "react";
import type { Map } from "maplibre-gl";
import { createMapCamera, type CameraMode } from "@/lib/camera-policy";
import { applyRouteFit } from "@/components/map/useRouteFit";
import type { SimulationStartResponse } from "@/types/telemetry";
export function useMapCamera(
  map: Map | null,
  route: SimulationStartResponse | null,
  active: boolean,
) {
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
          route.route_geometry.coordinates,
          window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        ),
      setMode,
    );
    camera.current = controller;
    return () => {
      controller.dispose();
      camera.current = null;
    };
  }, [map, route]);
  const display = useCallback(
    (point: [number, number]) => camera.current?.display(point, activeRef.current),
    [],
  );
  return {
    mode,
    display,
    resume: () => camera.current?.resume(),
    showRoute: () => camera.current?.showRoute(),
  };
}
