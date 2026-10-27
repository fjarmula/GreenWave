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
type InputEvent = { originalEvent?: unknown; greenwaveCameraTransition?: number };
type CameraEventName = "zoomstart" | "zoomend" | "dragstart" | "moveend" | "resize";
type CameraMap = {
  on(name: CameraEventName, listener: (event: InputEvent) => void): unknown;
  off(name: CameraEventName, listener: (event: InputEvent) => void): unknown;
  getZoom(): number;
  getContainer(): { clientWidth: number; clientHeight: number };
  jumpTo(options: { center: [number, number]; bearing: number; pitch: number }): unknown;
  easeTo(
    options: {
      center: [number, number];
      zoom: number;
      bearing: number;
      pitch: number;
      duration: number;
    },
    eventData: { greenwaveCameraTransition: number },
  ): unknown;
  stop(): unknown;
};
/** One writer; receives the marker's displayed point, never creates a second frame loop. */
export function createMapCamera(
  map: CameraMap,
  fit: () => void,
  changed: (mode: CameraMode) => void,
  reduceMotion: () => boolean = () => false,
) {
  let mode: CameraMode = "overview";
  let fitted = false,
    disposed = false,
    userMoved = false,
    userZooming = false;
  let transition: number | null = null;
  let sequence = 0;
  let last: [number, number] | null = null;
  let fresh = false;
  const update = (event: CameraEvent) => {
    mode = nextCameraMode(mode, event);
    changed(mode);
  };
  const cancelTransition = () => {
    const pending = transition !== null;
    transition = null; // stop() emits moveend synchronously
    if (pending) map.stop();
  };
  const track = () => {
    if (!disposed && mode === "following" && fresh && last && transition === null && !userZooming)
      map.jumpTo({ center: last, bearing: 0, pitch: 0 });
  };
  const approach = (zoom: number) => {
    if (disposed || !fresh || !last) return;
    transition = null;
    // Stop an existing route fit before taking ownership of the next transition's events.
    map.stop();
    // stop() can finish a user zoom synchronously. Apply Follow after that trailing event,
    // so its old zoom level cannot turn the first click back into overview.
    userZooming = false;
    update({ type: "resume" });
    transition = ++sequence;
    map.easeTo(
      { center: last, zoom, bearing: 0, pitch: 0, duration: reduceMotion() ? 0 : 280 },
      { greenwaveCameraTransition: transition },
    );
  };
  const fitOnce = () => {
    const { clientWidth: w, clientHeight: h } = map.getContainer();
    if (!fitted && w > 0 && h > 0) {
      fit();
      fitted = true;
      userMoved = false;
    }
  };
  const zoomStart = (event: InputEvent) => {
    if (!event.originalEvent) return;
    userMoved = true;
    userZooming = true;
    transition = null;
  };
  const zoom = (event: InputEvent) => {
    if (!event.originalEvent) return;
    userMoved = true;
    userZooming = false;
    const previous = mode;
    update({ type: "zoom", zoom: map.getZoom(), user: true });
    if (mode === "following" && previous === "overview" && fresh && last) {
      // MapLibre is still finishing the wheel gesture here. Starting easeTo in this
      // event stack can leave its render callback scheduled after its frame was deleted.
      const pending = ++sequence;
      transition = pending;
      const zoom = map.getZoom();
      queueMicrotask(() => {
        if (!disposed && mode === "following" && transition === pending) approach(zoom);
      });
    }
  };
  const pan = (event: InputEvent) => {
    if (!event.originalEvent) return;
    userMoved = true;
    transition = null;
    update({ type: "pan", user: true });
  };
  const settled = (event: InputEvent) => {
    // zoomend may start an ease before the user gesture emits its own trailing moveend.
    if (disposed || transition === null || event.greenwaveCameraTransition !== transition) return;
    // Resume only on the next displayed-marker frame. stop() can emit this event
    // before announcing the gesture that interrupted the ease.
    transition = null;
  };
  const listeners = {
    zoomstart: zoomStart,
    zoomend: zoom,
    dragstart: pan,
    moveend: settled,
    resize: fitOnce,
  };
  for (const [name, listener] of Object.entries(listeners))
    map.on(name as CameraEventName, listener);
  fitOnce();
  changed(mode);
  return {
    display(point: [number, number], active: boolean) {
      if (disposed) return;
      last = point;
      fresh = active;
      if (!active) cancelTransition();
      track();
    },
    pause() {
      fresh = false;
      cancelTransition();
    },
    resume() {
      if (disposed || !fresh || !last) return;
      approach(Math.max(17, map.getZoom()));
    },
    showRoute() {
      if (disposed) return;
      cancelTransition();
      update({ type: "show-route" });
      userMoved = false;
      userZooming = false;
      fit();
    },
    reframe() {
      if (!disposed && mode === "overview" && !userMoved && fitted) fit();
    },
    dispose() {
      disposed = true;
      cancelTransition();
      for (const [name, listener] of Object.entries(listeners))
        map.off(name as CameraEventName, listener);
    },
  };
}
