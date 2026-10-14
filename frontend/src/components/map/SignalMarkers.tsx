"use client";

import { useEffect } from "react";
import type { Map, Marker } from "maplibre-gl";

type SignalMarkersProps = {
  map: Map | null;
  visible?: boolean;
};

export function SignalMarkers({ map, visible = false }: SignalMarkersProps) {
  useEffect(() => {
    if (!map || !visible) return;

    const markers: Marker[] = [];
    return () => {
      markers.forEach((marker) => marker.remove());
    };
  }, [map, visible]);

  return null;
}
