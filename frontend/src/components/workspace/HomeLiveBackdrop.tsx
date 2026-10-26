"use client";
import { useEffect, useRef } from "react";
import { useTheme } from "next-themes";
import type { GeoJSONSource, Map } from "maplibre-gl";
import { useMaplibreMap } from "@/components/map/useMaplibreMap";
import { mapPalette } from "@/components/map/map-palette";
import { useCorridorLoop } from "@/components/workspace/useCorridorLoop";
import { basemapFailed } from "@/lib/home-backdrop";
import {
  corridor,
  corridorProgress,
  corridorSnapshot,
  type SignalState,
} from "@/lib/home-corridor";

/** No basemap within this long (offline, CARTO down): the page falls back to the drawing. */
const LOAD_TIMEOUT_MS = 8000;
const ROUTE = corridor.route.lonLat;
const SOURCES = ["home-route", "home-trail", "home-signals", "home-vehicle"];
const LAYERS = ["home-vehicle", "home-vehicle-halo", "home-signals", "home-trail", "home-route"];
const BOUNDS: [[number, number], [number, number]] = [
  [Math.min(...ROUTE.map((c) => c[0])), Math.min(...ROUTE.map((c) => c[1]))],
  [Math.max(...ROUTE.map((c) => c[0])), Math.max(...ROUTE.map((c) => c[1]))],
];

function line(coordinates: [number, number][]) {
  return {
    type: "Feature" as const,
    properties: {},
    geometry: { type: "LineString" as const, coordinates },
  };
}
function point(coordinates: [number, number]) {
  return {
    type: "Feature" as const,
    properties: {},
    geometry: { type: "Point" as const, coordinates },
  };
}
function signalFeatures(states: SignalState[]) {
  return {
    type: "FeatureCollection" as const,
    features: corridor.signals.map((signal, i) => ({
      type: "Feature" as const,
      properties: { state: states[i] },
      geometry: { type: "Point" as const, coordinates: [signal.lon, signal.lat] },
    })),
  };
}
/** The route in the right half, clear of the hero text and the cards. */
function frame(map: Map) {
  const { clientWidth: width, clientHeight: height } = map.getContainer();
  // Padding wider than the map makes fitBounds produce NaN; a hidden or tiny map waits.
  if (width < 480 || height < 400) return;
  map.fitBounds(BOUNDS, {
    padding: { left: width / 2, right: 160, top: 80, bottom: 220 },
    duration: 0,
  });
}

/** The home corridor on the app's own basemap: dimmed, non-interactive, no controls. */
export default function HomeLiveBackdrop({ onFail }: { onFail: () => void }) {
  const { resolvedTheme } = useTheme();
  const theme = resolvedTheme === "dark" ? "dark" : "light";
  const { mapElement, map, styleRevision } = useMaplibreMap(theme, {
    interactive: false,
    controls: false,
  });
  const states = useRef<SignalState[]>(corridor.signals.map(() => "ahead"));

  // The ground style loads at once, so readiness means a basemap source arrived in time.
  const mapRef = useRef(map);
  useEffect(() => {
    mapRef.current = map;
  }, [map]);
  const failRef = useRef(onFail);
  useEffect(() => {
    failRef.current = onFail;
  }, [onFail]);
  // Any basemap tile source finishing a load proves the network path works.
  const tilesLoaded = useRef(false);
  useEffect(() => {
    if (!map) return;
    const loaded = (event: { isSourceLoaded?: boolean; sourceId?: string }) => {
      if (event.isSourceLoaded && event.sourceId && !event.sourceId.startsWith("home-"))
        tilesLoaded.current = true;
    };
    map.on("sourcedata", loaded);
    return () => {
      map.off("sourcedata", loaded);
    };
  }, [map]);
  useEffect(() => {
    const timer = setTimeout(() => {
      // getStyle() is undefined while a style is still loading.
      const sources = mapRef.current?.getStyle()?.sources ?? {};
      if (basemapFailed({ sourceIds: Object.keys(sources), tilesLoaded: tilesLoaded.current }))
        failRef.current();
    }, LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, []);

  // Every style load (first basemap, theme swap) drops these layers; re-add them each time.
  useEffect(() => {
    if (!map) return;
    const palette = mapPalette(theme);
    // Seed the current frame: under reduced motion the loop has already drawn its one frame.
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const now = corridorSnapshot(corridorProgress(performance.now(), reduced));
    states.current = now.states;
    try {
      map.addSource("home-route", { type: "geojson", data: line(ROUTE) });
      map.addSource("home-trail", { type: "geojson", data: line(now.trail) });
      map.addSource("home-signals", { type: "geojson", data: signalFeatures(states.current) });
      map.addSource("home-vehicle", { type: "geojson", data: point(now.point) });
      const round = { "line-cap": "round", "line-join": "round" } as const;
      map.addLayer({
        id: "home-route",
        type: "line",
        source: "home-route",
        layout: round,
        paint: { "line-color": "#22c55e", "line-opacity": 0.25, "line-width": 5 },
      });
      map.addLayer({
        id: "home-trail",
        type: "line",
        source: "home-trail",
        layout: round,
        paint: { "line-color": "#22c55e", "line-width": 5 },
      });
      map.addLayer({
        id: "home-signals",
        type: "circle",
        source: "home-signals",
        paint: {
          "circle-radius": 5,
          "circle-color": [
            "match",
            ["get", "state"],
            "green",
            "#22c55e",
            "ahead",
            "#ef4444",
            palette.routeStandard,
          ],
        },
      });
      map.addLayer({
        id: "home-vehicle-halo",
        type: "circle",
        source: "home-vehicle",
        paint: {
          "circle-radius": 14,
          "circle-color": "#ef4444",
          "circle-opacity": 0.22,
        },
      });
      map.addLayer({
        id: "home-vehicle",
        type: "circle",
        source: "home-vehicle",
        paint: { "circle-radius": 6, "circle-color": "#ef4444" },
      });
      frame(map);
    } catch {
      // Mid theme swap the next style is still loading; its style.load re-runs this effect.
    }
    return () => {
      // On unmount the map may already be removed (its style is gone): nothing to clean.
      if (!map.style) return;
      for (const id of LAYERS) if (map.getLayer(id)) map.removeLayer(id);
      for (const id of SOURCES) if (map.getSource(id)) map.removeSource(id);
    };
  }, [map, styleRevision, theme]);

  useEffect(() => {
    if (!map) return;
    const refit = () => frame(map);
    map.on("resize", refit);
    return () => {
      map.off("resize", refit);
    };
  }, [map]);

  useCorridorLoop((progress) => {
    const vehicle = map?.getSource<GeoJSONSource>("home-vehicle");
    if (!map || !vehicle) return;
    const { point: head, trail, states: next } = corridorSnapshot(progress);
    vehicle.setData(point(head));
    map.getSource<GeoJSONSource>("home-trail")?.setData(line(trail));
    if (next.some((state, i) => state !== states.current[i])) {
      states.current = next;
      map.getSource<GeoJSONSource>("home-signals")?.setData(signalFeatures(next));
    }
  });

  return <div ref={mapElement} className="home-live-map dashboard-map" />;
}
