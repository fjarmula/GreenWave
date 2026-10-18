/** Formats whole seconds as zero-padded `"MMm SSs"`. */
export function formatMinutesSeconds(seconds: number): string {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}m ${String(seconds % 60).padStart(2, "0")}s`;
}
