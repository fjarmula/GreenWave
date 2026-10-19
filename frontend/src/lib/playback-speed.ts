// D9: wall clock stays 1 Hz; each tick advances this many simulated seconds.
export const PLAYBACK_SPEEDS = [1, 2, 5, 10] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];
