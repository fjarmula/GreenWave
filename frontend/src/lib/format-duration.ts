/** Formats whole seconds as zero-padded `"MMm SSs"`. */
export function formatMinutesSeconds(seconds: number): string {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}m ${String(seconds % 60).padStart(2, "0")}s`;
}

/** Match Python round() for backend estimates: an exact half-second rounds to even. */
export function roundBackendSeconds(seconds: number): number {
  const lower = Math.floor(seconds);
  return seconds - lower === 0.5 ? lower + (lower % 2) : Math.round(seconds);
}
