// Every tick is one simulated second at every speed; playback only shortens the wall-clock gap
// between ticks (supersedes D9's fixed 1 Hz batching), so a run is identical at every speed.
export const PLAYBACK_SPEEDS = [1, 2, 5, 10] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

const SIMULATED_SECOND_MILLISECONDS = 1000;

/** Wall-clock time per tick (one simulated second): also the vehicle marker's slide duration. */
export function tickIntervalMilliseconds(playbackSpeed: number): number {
  return SIMULATED_SECOND_MILLISECONDS / playbackSpeed;
}
