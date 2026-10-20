"use client";

import { useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { Marker, type Map } from "maplibre-gl";

import { stationFeatures, type StationFeature } from "@/components/map/station-layer";
import { VehicleIcon } from "@/components/map/VehicleIcon";
import { VEHICLE_ICON_COLORS } from "@/components/map/vehicle-icons";
import { SOURCE_KIND_LABELS } from "@/lib/station-copy";
import type { Station, VehicleType } from "@/types/telemetry";

type StationLayerProps = {
  map: Map | null;
  stations: Station[];
  selectedType: VehicleType;
  chosenId: string | null;
  runnerUpIds: string[];
};

/** Every station with its type icon: other types dimmed, chosen highlighted, runners-up outlined. */
export function StationLayer({
  map,
  stations,
  selectedType,
  chosenId,
  runnerUpIds,
}: StationLayerProps) {
  // Primitive key: the parent builds a new array on every render.
  const runnerUpKey = runnerUpIds.join(",");
  const features = useMemo(
    () =>
      stationFeatures(stations, selectedType, chosenId, runnerUpKey ? runnerUpKey.split(",") : [])
        .features,
    [stations, selectedType, chosenId, runnerUpKey],
  );
  // One DOM node per station, browser only (the map exists only there); pins are portalled in.
  const elements = useMemo(() => {
    if (!map) return new globalThis.Map<string, HTMLElement>();
    return new globalThis.Map(
      stations.map((station) => [station.station_id, document.createElement("div")] as const),
    );
  }, [map, stations]);

  useEffect(() => {
    if (!map) return;
    const markers = stations.flatMap((station) => {
      const element = elements.get(station.station_id);
      if (!element) return [];
      return [
        new Marker({ element, anchor: "center" })
          .setLngLat([station.position.lng, station.position.lat])
          .addTo(map),
      ];
    });
    return () => markers.forEach((marker) => marker.remove());
  }, [elements, map, stations]);

  useEffect(() => {
    for (const feature of features) {
      const element = elements.get(feature.properties.station_id);
      if (element) element.style.zIndex = feature.properties.role === "chosen" ? "2" : "1";
    }
  }, [elements, features]);

  return features.map((feature) => {
    const element = elements.get(feature.properties.station_id);
    return element
      ? createPortal(<StationPin feature={feature} />, element, feature.properties.station_id)
      : null;
  });
}

function StationPin({ feature }: { feature: StationFeature }) {
  const { name, vehicle_type, source_kind, dimmed, role } = feature.properties;
  const label = `${name} (${SOURCE_KIND_LABELS[source_kind]})`;
  const size = role === "chosen" ? "size-8" : "size-6";
  const ring =
    role === "chosen"
      ? "ring-4 ring-emerald-400"
      : role === "runner_up"
        ? "ring-2 ring-emerald-400/70 ring-offset-1 ring-offset-background"
        : "";
  return (
    <div
      className={`relative font-mono text-[10px] font-bold text-foreground ${dimmed ? "opacity-35 grayscale" : ""}`}
      title={label}
      aria-label={`Station: ${label}`}
      role="img"
    >
      <span
        className={`grid place-items-center rounded-full border-2 border-background shadow-md ${size} ${ring} ${VEHICLE_ICON_COLORS[vehicle_type]}`}
      >
        <VehicleIcon type={vehicle_type} className={role === "chosen" ? "size-4" : "size-3.5"} />
      </span>
      {role === "chosen" && (
        <span className="absolute top-1/2 left-full ml-2 -translate-y-1/2 rounded-md border border-border/80 bg-card/95 px-2 py-1 whitespace-nowrap shadow-lg backdrop-blur">
          {name}
        </span>
      )}
    </div>
  );
}
