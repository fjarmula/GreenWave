export type CameraMode = "overview" | "following" | "suspended";
type CameraEvent =
  | { type: "zoom"; zoom: number; user: boolean }
  | { type: "pan"; user: boolean }
  | { type: "resume" }
  | { type: "show-route" }
  | { type: "run" };
export function nextCameraMode(current: CameraMode, event: CameraEvent): CameraMode {
  if (event.type === "run" || event.type === "show-route") return "overview";
  if (event.type === "resume") return "following";
  if (!event.user) return current;
  if (event.type === "pan") return current === "overview" ? "overview" : "suspended";
  if (event.zoom < 16) return "overview";
  if (event.zoom > 16.5 && current === "overview") return "following";
  return current;
}
type InputEvent = { originalEvent?: unknown };
type CameraMap = {
  on(name: "zoomend" | "dragstart" | "resize", listener: (event: InputEvent) => void): unknown;
  off(name: "zoomend" | "dragstart" | "resize", listener: (event: InputEvent) => void): unknown;
  getZoom(): number;
  getContainer(): { clientWidth: number; clientHeight: number };
  jumpTo(options: { center: [number, number]; bearing: number; pitch: number }): unknown;
};
/** One writer; receives the marker's displayed point, never creates a second frame loop. */
export function createMapCamera(
  map: CameraMap,
  fit: () => void,
  changed: (mode: CameraMode) => void,
) {
  let mode: CameraMode = "overview",
    fitted = false,
    disposed = false;
  let last: [number, number] | null = null;
  let fresh = false;
  const update = (event: CameraEvent) => {
    mode = nextCameraMode(mode, event);
    changed(mode);
    if (mode === "following" && fresh && last) map.jumpTo({ center: last, bearing: 0, pitch: 0 });
  };
  const fitOnce = () => {
    const { clientWidth: w, clientHeight: h } = map.getContainer();
    if (!fitted && w > 0 && h > 0) {
      fit();
      fitted = true;
    }
  };
  const zoom = (e: InputEvent) =>
    update({ type: "zoom", zoom: map.getZoom(), user: !!e.originalEvent });
  const pan = (e: InputEvent) => update({ type: "pan", user: !!e.originalEvent });
  map.on("zoomend", zoom);
  map.on("dragstart", pan);
  map.on("resize", fitOnce);
  fitOnce();
  changed(mode);
  return {
    display(point: [number, number], active: boolean) {
      if (disposed) return;
      last = point;
      fresh = active;
      if (active && mode === "following") map.jumpTo({ center: point, bearing: 0, pitch: 0 });
    },
    resume() {
      update({ type: "resume" });
    },
    showRoute() {
      update({ type: "show-route" });
      fit();
    },
    dispose() {
      disposed = true;
      map.off("zoomend", zoom);
      map.off("dragstart", pan);
      map.off("resize", fitOnce);
    },
  };
}
