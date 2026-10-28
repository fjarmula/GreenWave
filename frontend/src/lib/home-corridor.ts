import corridorData from "@/data/home-corridor.json";

/** One junction on the home corridor; `t` is its share of the route (0 start, 1 end). */
type CorridorSignal = {
  id: string;
  name: string;
  t: number;
  x: number;
  y: number;
  lon: number;
  lat: number;
};
export type Corridor = {
  viewBox: number[];
  phoneViewBox: number[];
  route: { path: string; lonLat: [number, number][] };
  signals: CorridorSignal[];
};
export type SignalState = "ahead" | "green" | "passed";

/** The baked Aleje Trzech Wieszczów corridor (backend/scripts/export_home_corridor.py). */
export const corridor = corridorData as unknown as Corridor;

export const LOOP_MS = 16000;
/** A signal turns green when the vehicle is this share of the route away... */
const GREEN_LEAD = 0.14;
/** ...and stays green this long after it passed. */
const GREEN_HOLD = 0.05;
/** The green wake behind the vehicle, as a share of the route. */
export const TRAIL = 0.22;
/** Reduced motion shows one still frame: mid-corridor, the signal ahead already green. */
export const REDUCED_PROGRESS = 0.55;

const LON_SCALE = Math.cos((50.06 * Math.PI) / 180);

export function corridorProgress(timeMs: number, reduced: boolean): number {
  return reduced ? REDUCED_PROGRESS : (timeMs % LOOP_MS) / LOOP_MS;
}

export function signalState(signalT: number, progress: number): SignalState {
  const ahead = signalT - progress;
  if (ahead >= GREEN_LEAD) return "ahead";
  return ahead > -GREEN_HOLD ? "green" : "passed";
}

/** The vehicle's lon/lat at `progress` and the trail behind it, by distance along the route. */
export function pointAlong(
  lonLat: [number, number][],
  progress: number,
): { point: [number, number]; trail: [number, number][] } {
  const lengths = lonLat
    .slice(1)
    .map((b, i) => Math.hypot((b[0] - lonLat[i][0]) * LON_SCALE, b[1] - lonLat[i][1]));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  const at = (share: number): { point: [number, number]; index: number } => {
    let rest = Math.max(0, Math.min(1, share)) * total;
    for (let i = 0; i < lengths.length; i++) {
      if (rest <= lengths[i] || i === lengths.length - 1) {
        const f = lengths[i] ? Math.min(1, rest / lengths[i]) : 0;
        const [a, b] = [lonLat[i], lonLat[i + 1]];
        return { point: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], index: i };
      }
      rest -= lengths[i];
    }
    return { point: lonLat[0], index: 0 };
  };
  const head = at(progress);
  const tail = at(progress - TRAIL);
  const trail = [tail.point, ...lonLat.slice(tail.index + 1, head.index + 1), head.point];
  return { point: head.point, trail };
}

/** One frame of the corridor: where the vehicle is, its trail and each signal's state. */
export function corridorSnapshot(progress: number): {
  point: [number, number];
  trail: [number, number][];
  states: SignalState[];
} {
  const { point, trail } = pointAlong(corridor.route.lonLat, progress);
  return { point, trail, states: corridor.signals.map((s) => signalState(s.t, progress)) };
}
