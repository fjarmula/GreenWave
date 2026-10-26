/**
 * Which home background to draw. The live map only on a hydrated wide screen with WebGL whose map
 * has not failed; everything else (server render, phones, no WebGL, offline) gets the drawing.
 */
export function backdropKind({
  hydrated,
  phone,
  webgl,
  failed,
}: {
  hydrated: boolean;
  phone: boolean;
  webgl: boolean;
  failed: boolean;
}): "static" | "live" {
  return hydrated && !phone && webgl && !failed ? "live" : "static";
}

export function hasWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

/** The ground-only style (initial, and the fallback after a basemap error) has no sources. */
export function hasBasemap(sourceIds: string[]): boolean {
  return sourceIds.some((id) => !id.startsWith("home-"));
}

/** The live map failed when, after the grace period, it has no basemap or none of its tiles. */
export function basemapFailed({
  sourceIds,
  tilesLoaded,
}: {
  sourceIds: string[];
  tilesLoaded: boolean;
}): boolean {
  return !hasBasemap(sourceIds) || !tilesLoaded;
}
