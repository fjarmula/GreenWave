"use client";

import { useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { Marker, type Map } from "maplibre-gl";

import { stationFeatures, type StationFeature } from "@/components/map/station-layer";
import { VehicleIcon } from "@/components/map/VehicleIcon";
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
  // Chosen and runner-up stations wear the single accent; every station is beacon blue.
  const ring =
    role === "chosen" ? "ring-4 ring-go" : role === "runner_up" ? "ring-2 ring-go/60" : "";
  return (
    <div
      className={`relative text-[11px] font-semibold text-foreground ${dimmed ? "opacity-35 grayscale" : ""}`}
      title={label}
      aria-label={`Station: ${label}`}
      role="img"
    >
      <span className={`map-dot map-dot--station grid place-items-center ${size} ${ring}`}>
        <VehicleIcon type={vehicle_type} className={role === "chosen" ? "size-4" : "size-3.5"} />
      </span>
      {role === "chosen" && (
        <span className="absolute top-1/2 left-full ml-2 -translate-y-1/2 surface-glass rounded-full! px-2.5 py-1 whitespace-nowrap">
          {name}
        </span>
      )}
    </div>
  );
}
