/** Bounded padding works even while a sheet or browser keyboard shrinks the map. */
export function mapPadding(width: number, height: number) {
  return {
    top: Math.min(64, Math.max(0, height) / 4),
    bottom: Math.min(48, Math.max(0, height) / 4),
    left: Math.min(40, Math.max(0, width) / 4),
    right: Math.min(40, Math.max(0, width) / 4),
  };
}
